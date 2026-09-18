use axum::{
    extract::{MatchedPath, Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use serde::Serialize;
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
    response
}
