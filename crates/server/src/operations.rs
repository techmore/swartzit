use axum::{
    extract::{MatchedPath, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::{
    sync::atomic::{AtomicU64, Ordering::Relaxed},
    time::Instant,
};

static REQUESTS: AtomicU64 = AtomicU64::new(0);
static VIEWS: AtomicU64 = AtomicU64::new(0);
static ERRORS: AtomicU64 = AtomicU64::new(0);
static IN_FLIGHT: AtomicU64 = AtomicU64::new(0);
static LATENCY_US: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
pub struct Snapshot {
    requests: u64,
    page_views: u64,
    server_errors: u64,
    in_flight: u64,
    mean_latency_ms: f64,
    requests_per_second: f64,
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
    if !route.starts_with("/api/admin/")
        && route != "/api/views"
        && route != "/api/posts/{id}/views"
        && route != "/health"
    {
        super::log_event(&db, if status.is_server_error() { "error" } else if status.is_client_error() { "warn" } else { "info" }, "http.request",
            serde_json::json!({"route":route,"method":method,"status":status.as_u16(),"duration_ms":elapsed.as_millis()})).await;
    }
    if let Some(hash) = ip_hash {
        let _ =
            sqlx::query("INSERT INTO ip_activity(ip_hash,route,method,status) VALUES($1,$2,$3,$4)")
                .bind(hash)
                .bind(&route)
                .bind(&method)
                .bind(status.as_u16() as i32)
                .execute(&db)
                .await;
        if REQUESTS.load(Relaxed).is_multiple_of(100) {
            let _ =
                sqlx::query("DELETE FROM ip_activity WHERE created_at < now() - interval '7 days'")
                    .execute(&db)
                    .await;
        }
    }
    response
}

pub fn client_ip_hash(request: &Request) -> Option<String> {
    if std::env::var("TRUST_PROXY").ok().as_deref() != Some("true") {
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
pub fn hash_ip(ip: std::net::IpAddr) -> String {
    let secret =
        std::env::var("IP_HASH_SECRET").unwrap_or_else(|_| "change-this-ip-hash-secret".into());
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hasher.update([0]);
    hasher.update(ip.to_string().as_bytes());
    hex::encode(hasher.finalize())
}
