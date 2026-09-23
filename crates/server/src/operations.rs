use axum::{
    extract::{MatchedPath, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::{
    collections::HashMap,
    future::Future,
    sync::atomic::{AtomicU64, Ordering::Relaxed},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

static REQUESTS: AtomicU64 = AtomicU64::new(0);
static VIEWS: AtomicU64 = AtomicU64::new(0);
static ERRORS: AtomicU64 = AtomicU64::new(0);
static IN_FLIGHT: AtomicU64 = AtomicU64::new(0);
static LATENCY_US: AtomicU64 = AtomicU64::new(0);
static QUERY_COUNT: AtomicU64 = AtomicU64::new(0);
static QUERY_DURATION_US: AtomicU64 = AtomicU64::new(0);
static POOL_WAIT_COUNT: AtomicU64 = AtomicU64::new(0);
static POOL_WAIT_US: AtomicU64 = AtomicU64::new(0);

struct CacheEntry {
    expires_at: Instant,
    value: Value,
}

static PUBLIC_CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();

fn public_cache() -> &'static Mutex<HashMap<String, CacheEntry>> {
    PUBLIC_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn public_cache_ttl() -> Duration {
    let millis = std::env::var("SWARTZIT_PUBLIC_CACHE_TTL_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(5_000)
        .clamp(250, 60_000);
    Duration::from_millis(millis)
}

pub fn public_cache_get(key: &str) -> Option<Value> {
    let now = Instant::now();
    let mut cache = public_cache().lock().ok()?;
    cache.retain(|_, entry| entry.expires_at > now);
    cache.get(key).map(|entry| entry.value.clone())
}

pub fn public_cache_put(key: impl Into<String>, value: Value) {
    let key = key.into();
    let mut cache = match public_cache().lock() {
        Ok(cache) => cache,
        Err(_) => return,
    };
    let now = Instant::now();
    cache.retain(|_, entry| entry.expires_at > now);
    if cache.len() >= 32
        && !cache.contains_key(&key)
        && let Some(oldest) = cache
            .iter()
            .min_by_key(|(_, entry)| entry.expires_at)
            .map(|(key, _)| key.clone())
    {
        cache.remove(&oldest);
    }
    cache.insert(
        key,
        CacheEntry {
            expires_at: now + public_cache_ttl(),
            value,
        },
    );
}

pub fn clear_public_cache() {
    if let Ok(mut cache) = public_cache().lock() {
        cache.clear();
    }
}

pub fn public_cache_entries() -> usize {
    public_cache().lock().map(|cache| cache.len()).unwrap_or(0)
}

pub fn db_telemetry_enabled() -> bool {
    std::env::var("SWARTZIT_DB_TELEMETRY")
        .map(|value| value != "0")
        .unwrap_or(false)
}

pub async fn timed_query<F, T>(label: &'static str, future: F) -> T
where
    F: Future<Output = T>,
{
    let started = Instant::now();
    let result = future.await;
    let elapsed = started.elapsed();
    QUERY_COUNT.fetch_add(1, Relaxed);
    QUERY_DURATION_US.fetch_add(elapsed.as_micros() as u64, Relaxed);
    if db_telemetry_enabled() {
        tracing::debug!(target: "swartzit::query", query = label, duration_ms = elapsed.as_secs_f64() * 1000.0, "database query completed");
    }
    result
}

async fn measure_pool_wait(db: &PgPool) {
    if !db_telemetry_enabled() {
        return;
    }
    let started = Instant::now();
    match db.acquire().await {
        Ok(connection) => drop(connection),
        Err(error) => tracing::warn!(%error, "database pool probe failed"),
    }
    let elapsed = started.elapsed();
    POOL_WAIT_COUNT.fetch_add(1, Relaxed);
    POOL_WAIT_US.fetch_add(elapsed.as_micros() as u64, Relaxed);
}

#[derive(Serialize)]
pub struct Snapshot {
    requests: u64,
    page_views: u64,
    server_errors: u64,
    in_flight: u64,
    mean_latency_ms: f64,
    requests_per_second: f64,
    query_count: u64,
    mean_query_ms: f64,
    pool_wait_count: u64,
    mean_pool_wait_ms: f64,
    public_cache_entries: usize,
    db_connections: u32,
    db_idle: usize,
    host_load: Option<[f64; 3]>,
}
pub fn snapshot(db: &PgPool) -> Snapshot {
    let requests = REQUESTS.load(Relaxed);
    let elapsed = (chrono::Utc::now() - *super::STARTED_AT.get().unwrap())
        .num_seconds()
        .max(1) as f64;
    Snapshot {
        requests,
        page_views: VIEWS.load(Relaxed),
        server_errors: ERRORS.load(Relaxed),
        in_flight: IN_FLIGHT.load(Relaxed),
        mean_latency_ms: LATENCY_US.load(Relaxed) as f64 / requests.max(1) as f64 / 1000.0,
        requests_per_second: requests as f64 / elapsed,
        query_count: QUERY_COUNT.load(Relaxed),
        mean_query_ms: QUERY_DURATION_US.load(Relaxed) as f64
            / QUERY_COUNT.load(Relaxed).max(1) as f64
            / 1000.0,
        pool_wait_count: POOL_WAIT_COUNT.load(Relaxed),
        mean_pool_wait_ms: POOL_WAIT_US.load(Relaxed) as f64
            / POOL_WAIT_COUNT.load(Relaxed).max(1) as f64
            / 1000.0,
        public_cache_entries: public_cache_entries(),
        db_connections: db.size(),
        db_idle: db.num_idle(),
        host_load: host_load(),
    }
}
fn host_load() -> Option<[f64; 3]> {
    let mut values = [0.0; 3];
    // getloadavg is available on the supported Linux and macOS hosts.
    unsafe extern "C" {
        fn getloadavg(values: *mut f64, count: i32) -> i32;
    }
    if unsafe { getloadavg(values.as_mut_ptr(), 3) } == 3 {
        Some(values)
    } else {
        None
    }
}
pub async fn view() -> StatusCode {
    VIEWS.fetch_add(1, Relaxed);
    StatusCode::NO_CONTENT
}
struct Active;
impl Drop for Active {
    fn drop(&mut self) {
        IN_FLIGHT.fetch_sub(1, Relaxed);
    }
}
pub async fn observe(State(db): State<PgPool>, request: Request, next: Next) -> Response {
    // This is intentionally diagnostic-only: SQLx performs the real checkout
    // for each query. The probe gives us a measured pool-wait signal without
    // changing the normal request path in production.
    measure_pool_wait(&db).await;
    let ip_hash = client_ip_hash(&request);
    if let Some(hash) = &ip_hash {
        let blocked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM ip_blocks WHERE ip_hash=$1 AND (expires_at IS NULL OR expires_at>now()))")
            .bind(hash).fetch_one(&db).await.unwrap_or(false);
        if blocked {
            return (
                StatusCode::FORBIDDEN,
                "Request blocked by instance administrator",
            )
                .into_response();
        }
    }
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(|p| p.as_str())
        .unwrap_or("unmatched")
        .to_owned();
    let method: String = request.method().as_str().chars().take(16).collect();
    IN_FLIGHT.fetch_add(1, Relaxed);
    let _active = Active;
    let start = Instant::now();
    let mut response = next.run(request).await;
    if route.starts_with("/api/admin/") {
        response
            .headers_mut()
            .insert("cache-control", "no-store".parse().unwrap());
    }
    let elapsed = start.elapsed();
    REQUESTS.fetch_add(1, Relaxed);
    LATENCY_US.fetch_add(elapsed.as_micros() as u64, Relaxed);
    let status = response.status();
    if status.is_server_error() {
        ERRORS.fetch_add(1, Relaxed);
    }
    // Only bounded route templates and method/status/timing; no IPs, headers,
    // passwords, tokens, bodies, query strings, or user-supplied paths.
    let log_successes = env_flag("SWARTZIT_HTTP_SUCCESS_LOGS", false);
    if (status.is_client_error() || status.is_server_error() || log_successes)
        && !route.starts_with("/api/admin/")
        && route != "/api/views"
        && route != "/api/posts/{id}/views"
        && route != "/health"
        && route != "/ready"
    {
        let level = if status.is_server_error() {
            "error"
        } else if status.is_client_error() {
            "warn"
        } else {
            "info"
        };
        let detail = serde_json::json!({"route":route,"method":method,"status":status.as_u16(),"duration_ms":elapsed.as_millis()});
        let log_db = db.clone();
        tokio::spawn(async move {
            super::log_event(&log_db, level, "http.request", detail).await;
        });
    }
    if let Some(hash) = ip_hash {
        let record_successes = env_flag("SWARTZIT_IP_ACTIVITY_SUCCESS", false);
        if record_successes || status.is_client_error() || status.is_server_error() {
            let _ = sqlx::query(
                "INSERT INTO ip_activity(ip_hash,route,method,status) VALUES($1,$2,$3,$4)
                 ON CONFLICT (slot) DO UPDATE SET
                   id=EXCLUDED.id,
                   ip_hash=EXCLUDED.ip_hash,
                   route=EXCLUDED.route,
                   method=EXCLUDED.method,
                   status=EXCLUDED.status,
                   created_at=EXCLUDED.created_at",
            )
            .bind(hash)
            .bind(&route)
            .bind(&method)
            .bind(status.as_u16() as i32)
            .execute(&db)
            .await;
        }
    }
    response
}

pub fn client_ip_hash(request: &Request) -> Option<String> {
    if !env_flag("TRUST_PROXY", false) {
        return None;
    }
    let raw = request
        .headers()
        .get("cf-connecting-ip")
        .or_else(|| request.headers().get("x-real-ip"))
        .or_else(|| request.headers().get("x-forwarded-for"))?
        .to_str()
        .ok()?
        .split(',')
        .next()?
        .trim();
    let ip: std::net::IpAddr = raw.parse().ok()?;
    Some(hash_ip(ip))
}

pub fn proxy_trust_enabled() -> bool {
    env_flag("TRUST_PROXY", false)
}

fn env_flag(name: &str, default: bool) -> bool {
    match std::env::var(name).ok().as_deref() {
        Some(value)
            if ["1", "true", "yes", "on"].contains(&value.to_ascii_lowercase().as_str()) =>
        {
            true
        }
        Some(value)
            if ["0", "false", "no", "off"].contains(&value.to_ascii_lowercase().as_str()) =>
        {
            false
        }
        Some(_) => default,
        None => default,
    }
}

pub fn hash_ip(ip: std::net::IpAddr) -> String {
    let secret =
        std::env::var("IP_HASH_SECRET").unwrap_or_else(|_| "change-this-ip-hash-secret".into());
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hasher.update([0]);
    hasher.update(ip.to_string().as_bytes());
    hex::encode(hasher.finalize())
}
