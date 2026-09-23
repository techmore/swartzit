use argon2::PasswordVerifier;
use argon2::{
    Argon2, PasswordHasher,
    password_hash::{SaltString, rand_core::OsRng},
};
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post as post_method},
};
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool, postgres::PgPoolOptions};
use tower_http::cors::{Any, CorsLayer};
mod admin;
mod bookmarks;
mod imports;
mod media_store;
mod moderation;
mod operations;
mod views;

static STARTED_AT: std::sync::OnceLock<DateTime<Utc>> = std::sync::OnceLock::new();

#[derive(Debug)]
enum ApiError {
    Unauthorized,
    Forbidden,
    Suspended,
    Missing,
    Invalid(&'static str),
    Storage(String),
    Database(sqlx::Error),
}
impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        Self::Database(e)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "Authentication required"),
            Self::Forbidden => (StatusCode::FORBIDDEN, "Administrator access required"),
            Self::Suspended => (
                StatusCode::FORBIDDEN,
                "This account is temporarily suspended",
            ),
            Self::Missing => (StatusCode::NOT_FOUND, "Not found"),
            Self::Invalid(message) => (StatusCode::BAD_REQUEST, message),
            Self::Storage(error) => {
                tracing::error!(%error, "media storage request failed");
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Media storage is temporarily unavailable",
                )
            }
            Self::Database(error) => {
                tracing::error!(%error, "database request failed");
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Discussions are temporarily unavailable",
                )
            }
        };
        (status, Json(serde_json::json!({"error": message}))).into_response()
    }
}
#[derive(Deserialize, Serialize, FromRow)]
struct Community {
    slug: String,
    name: String,
    description: String,
    post_count: i64,
}
#[derive(Serialize, FromRow)]
struct Post {
    source: Option<serde_json::Value>,
    view_count: i64,
    engaged_view_count: i64,
    deep_view_count: i64,
    id: i64,
    public_id: String,
    title: String,
    body: String,
    created_at: DateTime<Utc>,
    author: String,
    community: String,
    community_name: String,
    comment_count: i64,
    score: i64,
}
#[derive(Serialize, FromRow)]
struct Comment {
    id: i64,
    parent_id: Option<i64>,
    body: String,
    author: String,
    created_at: DateTime<Utc>,
}
#[derive(Serialize)]
struct ExportBundle {
    format: &'static str,
    exported_at: DateTime<Utc>,
    communities: Vec<CommunityExport>,
    posts: Vec<PostExport>,
    comments: Vec<CommentExport>,
    media: Vec<ExportMedia>,
}
#[derive(Serialize, FromRow)]
struct CommunityExport {
    slug: String,
    name: String,
    description: String,
}
#[derive(Serialize, FromRow)]
struct PostExport {
    id: i64,
    community: String,
    author: String,
    title: String,
    body: String,
    created_at: DateTime<Utc>,
}
#[derive(Serialize, FromRow)]
struct CommentExport {
    id: i64,
    post_id: i64,
    parent_id: Option<i64>,
    author: String,
    body: String,
    created_at: DateTime<Utc>,
}
#[derive(Serialize, FromRow)]
struct ExportMedia {
    post_id: i64,
    media_id: i64,
    position: i16,
    content_hash: String,
    media_type: String,
    byte_size: i64,
    magnet_uri: Option<String>,
}
#[derive(Deserialize, Default)]
struct FeedQuery {
    sort: Option<String>,
    community: Option<String>,
    q: Option<String>,
    page: Option<i64>,
}
const FEED_PAGE_SIZE: i64 = 12;
#[derive(Deserialize, Default)]
struct ProfileQuery {
    tab: Option<String>,
}
#[derive(Deserialize)]
struct SignupRequest {
    handle: String,
    password: String,
}
#[derive(Serialize)]
struct SignupResponse {
    handle: String,
}
#[derive(Deserialize)]
struct LoginRequest {
    handle: String,
    password: String,
}
#[derive(Serialize)]
struct LoginResponse {
    token: String,
    expires_at: DateTime<Utc>,
}
#[derive(Deserialize)]
struct CreatePostRequest {
    community: String,
    title: String,
    body: String,
}
#[derive(Serialize, FromRow)]
struct CreatedPost {
    id: i64,
    public_id: String,
    title: String,
    community: String,
}
#[derive(Deserialize)]
struct CreateCommentRequest {
    body: String,
    parent_id: Option<i64>,
}
#[derive(Deserialize)]
struct ProfileUpdateRequest {
    display_name: String,
    bio: String,
    avatar_url: Option<String>,
}
#[derive(Serialize, FromRow)]
struct CreatedComment {
    id: i64,
    post_id: i64,
    parent_id: Option<i64>,
    body: String,
    author: String,
}
#[derive(Deserialize)]
struct VoteRequest {
    value: i16,
}
#[derive(Serialize)]
struct VoteResponse {
    post_id: i64,
    score: i64,
    your_vote: Option<i16>,
}
#[derive(Deserialize)]
struct DrawThingsFeedbackRequest {
    overall: i16,
    prompt_match: Option<i16>,
    natural_color: Option<i16>,
    realism: Option<i16>,
    likeness: Option<i16>,
    composition: Option<i16>,
    detail: Option<i16>,
}
#[derive(Serialize, FromRow)]
struct DrawThingsFeedbackMine {
    overall: i16,
    prompt_match: Option<i16>,
    natural_color: Option<i16>,
    realism: Option<i16>,
    likeness: Option<i16>,
    composition: Option<i16>,
    detail: Option<i16>,
}
#[derive(Serialize, FromRow)]
struct CurrentUser {
    handle: String,
    is_admin: bool,
}
#[derive(Serialize)]
struct AdminOverview {
    runtime: operations::Snapshot,
    started_at: DateTime<Utc>,
    users: i64,
    active_sessions: i64,
    communities: i64,
    posts: i64,
    comments: i64,
    open_reports: i64,
    media_assets: i64,
    database_size_bytes: i64,
    log_entries: i64,
    pending_moderation: i64,
}
#[derive(Deserialize)]
struct CreateCommunityRequest {
    slug: String,
    name: String,
    description: Option<String>,
}
#[derive(Serialize)]
struct SubscriptionResponse {
    community: String,
    subscribed: bool,
}
#[derive(Deserialize)]
struct ReportRequest {
    reason: String,
    post_id: Option<i64>,
    comment_id: Option<i64>,
}
#[derive(Serialize, FromRow)]
struct ReportResponse {
    id: i64,
    reason: String,
}
#[derive(Deserialize)]
struct RegisterMediaRequest {
    content_hash: String,
    media_type: String,
    byte_size: i64,
    magnet_uri: Option<String>,
}
#[derive(Serialize, FromRow)]
struct MediaAsset {
    id: i64,
    content_hash: String,
    media_type: String,
    byte_size: i64,
    magnet_uri: Option<String>,
}
#[derive(FromRow)]
struct MediaServeRow {
    content_hash: String,
    content_bytes: Option<Vec<u8>>,
    byte_size: i64,
    mime_type: Option<String>,
    content_type: String,
    storage_backend: String,
    object_key: Option<String>,
    status: String,
    variants: serde_json::Value,
}
#[derive(FromRow)]
struct MediaOverviewRow {
    id: i64,
    content_hash: String,
    media_type: String,
    byte_size: i64,
    magnet_uri: Option<String>,
    mime_type: String,
    storage_backend: String,
    variants: serde_json::Value,
}
#[derive(Deserialize)]
struct AttachMediaRequest {
    media_id: i64,
    position: Option<i16>,
}
impl FeedQuery {
    fn validate(&self) -> Result<i64, ApiError> {
        if self.q.as_ref().is_some_and(|q| q.len() > 200) {
            return Err(ApiError::Invalid("Search must be at most 200 bytes"));
        }
        let page = self.page.unwrap_or(1);
        if !(1..=10000).contains(&page) {
            return Err(ApiError::Invalid("Page must be between 1 and 10000"));
        }
        Ok((page - 1) * FEED_PAGE_SIZE)
    }
}
const POST_SELECT: &str = "SELECT (SELECT to_jsonb(e) FROM external_posts e WHERE e.post_id=p.id) AS source, COALESCE(ps.view_count, p.view_count) AS view_count, COALESCE(ps.engaged_view_count, p.engaged_view_count) AS engaged_view_count, COALESCE(ps.deep_view_count, p.deep_view_count) AS deep_view_count, p.id, p.public_id, p.title, p.body, p.created_at, a.handle AS author, c.slug AS community, c.name AS community_name, COALESCE(ps.comment_count, 0) AS comment_count, COALESCE(ps.score, 0) AS score FROM posts p JOIN authors a ON a.id = p.author_id JOIN communities c ON c.id = p.community_id LEFT JOIN post_stats ps ON ps.post_id = p.id";

fn is_draw_things_source(source: &Option<serde_json::Value>) -> bool {
    source
        .as_ref()
        .and_then(|value| value.get("generation_config"))
        .and_then(|value| value.get("provider"))
        .and_then(serde_json::Value::as_str)
        == Some("draw_things")
}

async fn draw_things_feedback_summary(
    db: &PgPool,
    post_id: i64,
) -> Result<serde_json::Value, ApiError> {
    Ok(sqlx::query_scalar(
        "SELECT json_build_object(
           'responses', count(*)::bigint,
           'overall', round(avg(overall)::numeric, 2),
           'prompt_match', round(avg(prompt_match)::numeric, 2),
           'natural_color', round(avg(natural_color)::numeric, 2),
           'realism', round(avg(realism)::numeric, 2),
           'likeness', round(avg(likeness)::numeric, 2),
           'composition', round(avg(composition)::numeric, 2),
           'detail', round(avg(detail)::numeric, 2)
         )
         FROM draw_things_feedback
         WHERE post_id = $1",
    )
    .bind(post_id)
    .fetch_one(db)
    .await?)
}

async fn require_draw_things_post(db: &PgPool, post_id: i64) -> Result<(), ApiError> {
    let available: bool = sqlx::query_scalar(
        "SELECT EXISTS (
           SELECT 1
           FROM posts p
           JOIN external_posts e ON e.post_id = p.id
           WHERE p.id = $1
             AND p.moderation_status = 'approved'
             AND e.provider = 'runner'
             AND e.generation_config->>'provider' = 'draw_things'
         )",
    )
    .bind(post_id)
    .fetch_one(db)
    .await?;
    if available {
        Ok(())
    } else {
        Err(ApiError::Missing)
    }
}

fn validate_draw_things_feedback(input: &DrawThingsFeedbackRequest) -> Result<(), ApiError> {
    if !(1..=5).contains(&input.overall) {
        return Err(ApiError::Invalid(
            "Overall feedback must be between 1 and 5",
        ));
    }
    for (value, label) in [
        (input.prompt_match, "Prompt-match feedback"),
        (input.natural_color, "Natural-color feedback"),
        (input.realism, "Realism feedback"),
        (input.likeness, "Likeness feedback"),
        (input.composition, "Composition feedback"),
        (input.detail, "Detail feedback"),
    ] {
        if value.is_some_and(|score| !(1..=5).contains(&score)) {
            return Err(ApiError::Invalid(label));
        }
    }
    Ok(())
}

async fn draw_things_feedback_get(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(post_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let author_id = authenticated_author(&headers, &db).await?;
    require_draw_things_post(&db, post_id).await?;
    let mine: Option<DrawThingsFeedbackMine> = sqlx::query_as(
        "SELECT overall, prompt_match, natural_color, realism, likeness, composition, detail
         FROM draw_things_feedback
         WHERE post_id = $1 AND author_id = $2",
    )
    .bind(post_id)
    .bind(author_id)
    .fetch_optional(&db)
    .await?;
    Ok(Json(serde_json::json!({
        "summary": draw_things_feedback_summary(&db, post_id).await?,
        "mine": mine
    })))
}

async fn draw_things_feedback_submit(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(post_id): Path<i64>,
    Json(input): Json<DrawThingsFeedbackRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let author_id = active_author(&headers, &db).await?;
    validate_draw_things_feedback(&input)?;
    require_draw_things_post(&db, post_id).await?;
    sqlx::query(
        "INSERT INTO draw_things_feedback(
           post_id, author_id, overall, prompt_match, natural_color, realism,
           likeness, composition, detail
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (post_id, author_id) DO UPDATE SET
           overall = EXCLUDED.overall,
           prompt_match = EXCLUDED.prompt_match,
           natural_color = EXCLUDED.natural_color,
           realism = EXCLUDED.realism,
           likeness = EXCLUDED.likeness,
           composition = EXCLUDED.composition,
           detail = EXCLUDED.detail,
           updated_at = now()",
    )
    .bind(post_id)
    .bind(author_id)
    .bind(input.overall)
    .bind(input.prompt_match)
    .bind(input.natural_color)
    .bind(input.realism)
    .bind(input.likeness)
    .bind(input.composition)
    .bind(input.detail)
    .execute(&db)
    .await?;
    Ok(Json(serde_json::json!({
        "summary": draw_things_feedback_summary(&db, post_id).await?,
        "message": "Your Draw Things feedback was saved."
    })))
}

async fn profile_image(Path(id): Path<i64>) -> Result<Response, ApiError> {
    if id <= 0 {
        return Err(ApiError::Missing);
    }
    let root =
        std::env::var("PROFILE_IMAGE_CACHE_DIR").unwrap_or_else(|_| ".local/profile-cache".into());
    let base = std::path::PathBuf::from(root);
    for (ext, mime) in [
        ("jpg", "image/jpeg"),
        ("jpeg", "image/jpeg"),
        ("png", "image/png"),
        ("webp", "image/webp"),
        ("gif", "image/gif"),
    ] {
        let path = base.join(format!("{id}.{ext}"));
        if let Ok(bytes) = tokio::fs::read(&path).await {
            return Ok(Response::builder()
                .status(StatusCode::OK)
                .header("content-type", mime)
                .header("cache-control", "public, max-age=86400")
                .body(Body::from(bytes))
                .map_err(|_| ApiError::Missing)
                .unwrap());
        }
    }
    Err(ApiError::Missing)
}
async fn runner_media(State(db): State<PgPool>, Path(id): Path<i64>) -> Result<Response, ApiError> {
    serve_media(db, id, "original").await
}

async fn runner_media_variant(
    State(db): State<PgPool>,
    Path((id, variant)): Path<(i64, String)>,
) -> Result<Response, ApiError> {
    serve_media(db, id, &variant).await
}

async fn serve_media(db: PgPool, id: i64, variant: &str) -> Result<Response, ApiError> {
    if id <= 0 {
        return Err(ApiError::Missing);
    }
    if !matches!(variant, "original" | "thumbnail") {
        return Err(ApiError::Missing);
    }
    let row: Option<MediaServeRow> = sqlx::query_as(
        "SELECT content_hash, content_bytes, byte_size, mime_type, content_type,
                storage_backend, object_key, status, variants
         FROM media_assets WHERE id=$1",
    )
    .bind(id)
    .fetch_optional(&db)
    .await?;
    let Some(row) = row else {
        return Err(ApiError::Missing);
    };
    if row.status == "deleted" {
        return Err(ApiError::Missing);
    }
    let metadata = media_store::variant_metadata(&row.variants, variant).unwrap_or_else(|| {
        media_store::StoredVariant {
            variant: variant.to_owned(),
            object_key: if variant == "original" {
                row.object_key.clone().unwrap_or_default()
            } else {
                String::new()
            },
            byte_size: row.byte_size.max(0) as u64,
            mime_type: row
                .mime_type
                .clone()
                .unwrap_or_else(|| row.content_type.clone()),
            checksum: if variant == "original" {
                row.content_hash.clone()
            } else {
                String::new()
            },
            external_url: None,
        }
    });
    if variant == "thumbnail" && metadata.object_key.is_empty() {
        return Err(ApiError::Missing);
    }
    let config = media_store::load_config(&db)
        .await
        .map_err(ApiError::Storage)?;
    let secondary: Option<(String, String)> = if config.secondary_provider == "disabled" {
        None
    } else {
        sqlx::query_as(
            "SELECT provider, object_key
             FROM media_replicas
             WHERE media_id = $1 AND role = 'secondary' AND provider = $3
               AND variant = $2 AND state = 'ready' AND object_key IS NOT NULL
             ORDER BY id DESC
             LIMIT 1",
        )
        .bind(id)
        .bind(variant)
        .bind(&config.secondary_provider)
        .fetch_optional(&db)
        .await?
    };
    let bytes = media_store::read_variant(
        &config,
        media_store::VariantRead {
            hash: &row.content_hash,
            provider: &row.storage_backend,
            key: (!metadata.object_key.is_empty()).then_some(metadata.object_key.as_str()),
            variant,
            legacy_bytes: row.content_bytes.as_deref(),
            expected_checksum: (!metadata.checksum.is_empty())
                .then_some(metadata.checksum.as_str()),
            secondary: secondary
                .as_ref()
                .map(|(provider, key)| (provider.as_str(), key.as_str())),
        },
    )
    .await
    .map_err(ApiError::Storage)?;
    if !metadata.checksum.is_empty() && media_store::checksum(&bytes) != metadata.checksum {
        return Err(ApiError::Storage(format!(
            "checksum verification failed for media {} {}",
            id, variant
        )));
    }
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("content-type", metadata.mime_type)
        .header("cache-control", "public, max-age=31536000, immutable")
        .header("etag", format!("\"{}\"", metadata.checksum))
        .body(Body::from(bytes))
        .map_err(|_| ApiError::Missing)
        .unwrap())
}
async fn health(State(db): State<PgPool>) -> Result<Json<serde_json::Value>, ApiError> {
    operations::timed_query("health", sqlx::query("SELECT 1").execute(&db)).await?;
    let started_at = STARTED_AT.get().copied().unwrap_or_else(Utc::now);
    let uptime_seconds = Utc::now()
        .signed_duration_since(started_at)
        .num_seconds()
        .max(0);
    Ok(Json(serde_json::json!({
        "status": "ok",
        "started_at": started_at,
        "uptime_seconds": uptime_seconds
    })))
}
async fn ready(State(db): State<PgPool>) -> Result<Json<serde_json::Value>, ApiError> {
    operations::timed_query("readiness", sqlx::query("SELECT 1").execute(&db)).await?;
    Ok(Json(serde_json::json!({"status": "ready"})))
}
fn uptime_pulse_path() -> std::path::PathBuf {
    if let Ok(path) = std::env::var("SWARTZIT_PULSE_FILE") {
        return path.into();
    }
    if let Ok(path) = std::env::var("SWARTZIT_STATE_DIR") {
        return std::path::PathBuf::from(path).join("uptime-pulse.json");
    }
    if let Ok(path) = std::env::var("SWARTZIT_DATA_DIR") {
        return std::path::PathBuf::from(path).join("uptime-pulse.json");
    }
    std::path::PathBuf::from(".local/uptime-pulse.json")
}

async fn instance_module_enabled(db: &PgPool, module_key: &str) -> Result<bool, ApiError> {
    Ok(
        sqlx::query_scalar::<_, bool>("SELECT enabled FROM instance_modules WHERE module_key = $1")
            .bind(module_key)
            .fetch_optional(db)
            .await?
            .unwrap_or(true),
    )
}

async fn log_event(db: &PgPool, level: &str, event: &str, detail: serde_json::Value) {
    if let Err(error) =
        sqlx::query("INSERT INTO system_logs (level, event, detail) VALUES ($1, $2, $3) ON CONFLICT (slot) DO UPDATE SET id = EXCLUDED.id, level = EXCLUDED.level, event = EXCLUDED.event, detail = EXCLUDED.detail, created_at = EXCLUDED.created_at")
            .bind(level)
            .bind(event)
            .bind(detail)
            .execute(db)
            .await
    {
        tracing::warn!(%error, "could not write system log");
    }
}
async fn nodeinfo() -> Json<serde_json::Value> {
    Json(
        serde_json::json!({"version":"2.0","software":{"name":"swartzit","version":env!("CARGO_PKG_VERSION")},"protocols":[],"usage":{"users":{"total":null},"localPosts":null},"openRegistrations":true}),
    )
}
async fn signup(
    State(db): State<PgPool>,
    Json(input): Json<SignupRequest>,
) -> Result<(StatusCode, Json<SignupResponse>), ApiError> {
    let handle = input.handle.trim().to_ascii_lowercase();
    if !(3..=32).contains(&handle.len())
        || !handle
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    {
        return Err(ApiError::Invalid(
            "Handle must be 3-32 lowercase letters, numbers, or underscores",
        ));
    }
    if input.password.len() < 12 || input.password.len() > 256 {
        return Err(ApiError::Invalid(
            "Password must be between 12 and 256 characters",
        ));
    }
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(input.password.as_bytes(), &salt)
        .map_err(|_| ApiError::Invalid("Could not create account"))?
        .to_string();
    let inserted = sqlx::query_scalar::<_, String>("INSERT INTO authors (handle, password_hash) VALUES ($1, $2) ON CONFLICT (handle) DO NOTHING RETURNING handle").bind(&handle).bind(hash).fetch_optional(&db).await?;
    if inserted.is_none() {
        return Err(ApiError::Invalid("That handle is already in use"));
    }
    log_event(
        &db,
        "info",
        "account.created",
        serde_json::json!({"handle": handle}),
    )
    .await;
    Ok((StatusCode::CREATED, Json(SignupResponse { handle })))
}
async fn login(
    State(db): State<PgPool>,
    Json(input): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let handle = input.handle.trim().to_ascii_lowercase();
    let hash: Option<(i64, String)> = sqlx::query_as(
        "SELECT id, password_hash FROM authors WHERE handle = $1 AND password_hash IS NOT NULL",
    )
    .bind(&handle)
    .fetch_optional(&db)
    .await?;
    let Some((author_id, password_hash)) = hash else {
        return Err(ApiError::Invalid("Invalid handle or password"));
    };
    let parsed = argon2::PasswordHash::new(&password_hash)
        .map_err(|_| ApiError::Invalid("Invalid handle or password"))?;
    Argon2::default()
        .verify_password(input.password.as_bytes(), &parsed)
        .map_err(|_| ApiError::Invalid("Invalid handle or password"))?;
    let mut token_bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut token_bytes);
    let token = hex::encode(token_bytes);
    let token_hash = Sha256::digest(token.as_bytes()).to_vec();
    let expires_at = Utc::now() + chrono::Duration::days(30);
    sqlx::query("INSERT INTO sessions (token_hash, author_id, expires_at) VALUES ($1, $2, $3)")
        .bind(token_hash)
        .bind(author_id)
        .bind(expires_at)
        .execute(&db)
        .await?;
    Ok(Json(LoginResponse { token, expires_at }))
}
async fn authenticated_author(headers: &HeaderMap, db: &PgPool) -> Result<i64, ApiError> {
    let value = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let Some(token) = value.strip_prefix("Bearer ") else {
        return Err(ApiError::Invalid("Authentication required"));
    };
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(ApiError::Invalid("Authentication required"));
    }
    let token_hash = Sha256::digest(token.as_bytes()).to_vec();
    sqlx::query_scalar(
        "SELECT author_id FROM sessions WHERE token_hash = $1 AND expires_at > now()",
    )
    .bind(token_hash)
    .fetch_optional(db)
    .await?
    .ok_or(ApiError::Invalid("Authentication required"))
}

async fn active_author(headers: &HeaderMap, db: &PgPool) -> Result<i64, ApiError> {
    let author_id = authenticated_author(headers, db).await?;
    let suspended_until: Option<DateTime<Utc>> =
        sqlx::query_scalar("SELECT suspended_until FROM authors WHERE id = $1")
            .bind(author_id)
            .fetch_one(db)
            .await?;
    if suspended_until.is_some_and(|until| until > Utc::now()) {
        return Err(ApiError::Suspended);
    }
    Ok(author_id)
}

async fn analyze_user_content(
    db: &PgPool,
    author_id: i64,
    text: &str,
) -> Result<moderation::Analysis, ApiError> {
    let mut result = moderation::analyze(text);
    let recent: Vec<String> = sqlx::query_scalar(
        "SELECT body FROM (
           SELECT body, created_at FROM posts WHERE author_id = $1 AND created_at > now() - interval '10 minutes'
           UNION ALL
           SELECT body, created_at FROM comments WHERE author_id = $1 AND created_at > now() - interval '10 minutes'
         ) recent ORDER BY created_at DESC LIMIT 50",
    )
    .bind(author_id)
    .fetch_all(db)
    .await?;
    if recent.len() >= 5 {
        result.add_flag("spam", "medium", "spam.burst");
    }
    let key = moderation::comparison_key(text);
    if key.len() >= 20
        && recent
            .iter()
            .any(|previous| moderation::comparison_key(previous) == key)
    {
        result.add_flag("spam", "medium", "spam.repeated_text");
    }
    Ok(result)
}

fn flags_json(analysis: &moderation::Analysis) -> serde_json::Value {
    serde_json::to_value(&analysis.flags).unwrap_or_else(|_| serde_json::json!([]))
}

fn validate_profile_update(
    input: ProfileUpdateRequest,
) -> Result<(String, String, Option<String>), ApiError> {
    let display_name = input.display_name.trim().to_owned();
    let bio = input.bio.trim().to_owned();
    let avatar_url = input.avatar_url.as_deref().unwrap_or("").trim().to_owned();
    if display_name.chars().count() > 80 || bio.chars().count() > 2000 {
        return Err(ApiError::Invalid(
            "Display name or bio is outside the allowed length",
        ));
    }
    let avatar_url = if avatar_url.is_empty() {
        None
    } else {
        let parsed = url::Url::parse(&avatar_url)
            .map_err(|_| ApiError::Invalid("Avatar URL must be a valid HTTPS URL"))?;
        if parsed.scheme() != "https"
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.port().is_some()
            || avatar_url.len() > 2048
        {
            return Err(ApiError::Invalid(
                "Avatar URL must use HTTPS without credentials or a custom port",
            ));
        }
        Some(avatar_url)
    };
    Ok((display_name, bio, avatar_url))
}

async fn me(State(db): State<PgPool>, headers: HeaderMap) -> Result<Json<CurrentUser>, ApiError> {
    let author_id = authenticated_author(&headers, &db).await?;
    let user =
        sqlx::query_as::<_, CurrentUser>("SELECT handle, is_admin FROM authors WHERE id = $1")
            .bind(author_id)
            .fetch_optional(&db)
            .await?
            .ok_or(ApiError::Invalid("Authentication required"))?;
    Ok(Json(user))
}

async fn profile_payload(
    db: &PgPool,
    handle: &str,
    tab: Option<&str>,
) -> Result<serde_json::Value, ApiError> {
    let profile = operations::timed_query(
        "profile.summary",
        sqlx::query_scalar::<_, serde_json::Value>(
            "SELECT row_to_json(t) FROM (
               SELECT a.handle,
                      NULLIF(a.display_name, '') AS display_name,
                      NULLIF(a.bio, '') AS bio,
                      a.avatar_url,
                      a.created_at AS joined_at,
                      (SELECT count(*) FROM posts p WHERE p.author_id = a.id AND p.moderation_status = 'approved') AS post_count,
                  (SELECT count(*)
                   FROM comments cm
                   JOIN posts p ON p.id = cm.post_id
                   WHERE cm.author_id = a.id
                     AND cm.moderation_status = 'approved'
                     AND p.moderation_status = 'approved') AS comment_count,
                  (SELECT count(*)
                   FROM posts p
                   JOIN external_posts e ON e.post_id = p.id
                   WHERE p.author_id = a.id
                     AND p.moderation_status = 'approved'
                     AND jsonb_typeof(e.media) = 'array'
                     AND jsonb_array_length(e.media) > 0) AS media_count
               FROM authors a
               WHERE a.handle = $1
             ) t",
        )
        .bind(handle)
        .fetch_optional(db),
    )
    .await?
    .ok_or(ApiError::Missing)?;

    let selected = tab.unwrap_or("all");
    let mut activity: Vec<serde_json::Value> = Vec::new();
    let mut posts: Vec<serde_json::Value> = Vec::new();
    let mut replies: Vec<serde_json::Value> = Vec::new();
    let mut media: Vec<serde_json::Value> = Vec::new();
    if matches!(selected, "all" | "activity") {
        activity = operations::timed_query(
            "profile.activity",
            sqlx::query_scalar(
                "SELECT row_to_json(activity) FROM (
                   SELECT kind, public_id, title, body, created_at, community FROM (
                     SELECT 'post'::text AS kind, p.public_id, p.title, p.body, p.created_at, c.slug AS community
                     FROM posts p
                     JOIN communities c ON c.id = p.community_id
                     JOIN authors a ON a.id = p.author_id
                     WHERE a.handle = $1 AND p.moderation_status = 'approved'
                     UNION ALL
                     SELECT 'comment'::text AS kind, p.public_id, NULL::text AS title, cm.body, cm.created_at, c.slug AS community
                     FROM comments cm
                     JOIN posts p ON p.id = cm.post_id
                     JOIN communities c ON c.id = p.community_id
                     JOIN authors a ON a.id = cm.author_id
                     WHERE a.handle = $1 AND cm.moderation_status = 'approved' AND p.moderation_status = 'approved'
                   ) activity
                   ORDER BY created_at DESC
                   LIMIT 20
                 ) activity",
            )
            .bind(handle)
            .fetch_all(db),
        )
        .await?;
    }
    if matches!(selected, "all" | "posts") {
        posts = operations::timed_query(
            "profile.posts",
            sqlx::query_scalar::<_, serde_json::Value>(
                "SELECT row_to_json(t) FROM (
                   SELECT p.public_id,
                          p.title,
                          p.body,
                          p.created_at,
                          c.slug AS community,
                          COALESCE(ps.comment_count, 0) AS comment_count,
                          COALESCE(ps.score, 0) AS score,
                          (SELECT to_jsonb(e) FROM external_posts e WHERE e.post_id = p.id) AS source
                   FROM posts p
                   JOIN communities c ON c.id = p.community_id
                   JOIN authors a ON a.id = p.author_id
                   LEFT JOIN post_stats ps ON ps.post_id = p.id
                   WHERE a.handle = $1 AND p.moderation_status = 'approved'
                   ORDER BY p.created_at DESC, p.id DESC
                   LIMIT 50
                 ) t",
            )
            .bind(handle)
            .fetch_all(db),
        )
        .await?;
    }
    if matches!(selected, "all" | "replies") {
        replies = operations::timed_query(
            "profile.replies",
            sqlx::query_scalar::<_, serde_json::Value>(
                "SELECT row_to_json(t) FROM (
                   SELECT cm.id,
                          cm.body,
                          cm.created_at,
                          p.public_id AS post_public_id,
                          p.title AS post_title,
                          c.slug AS community
                   FROM comments cm
                   JOIN posts p ON p.id = cm.post_id
                   JOIN communities c ON c.id = p.community_id
                   JOIN authors a ON a.id = cm.author_id
                   WHERE a.handle = $1
                     AND cm.moderation_status = 'approved'
                     AND p.moderation_status = 'approved'
                   ORDER BY cm.created_at DESC, cm.id DESC
                   LIMIT 50
                 ) t",
            )
            .bind(handle)
            .fetch_all(db),
        )
        .await?;
    }
    if matches!(selected, "all" | "media") {
        media = operations::timed_query(
            "profile.media",
            sqlx::query_scalar::<_, serde_json::Value>(
                "SELECT row_to_json(t) FROM (
                   SELECT p.public_id,
                          p.title,
                          p.created_at,
                          c.slug AS community,
                          (SELECT to_jsonb(e) FROM external_posts e WHERE e.post_id = p.id) AS source
                   FROM posts p
                   JOIN communities c ON c.id = p.community_id
                   JOIN authors a ON a.id = p.author_id
                   WHERE a.handle = $1
                     AND p.moderation_status = 'approved'
                     AND EXISTS (
                       SELECT 1
                       FROM external_posts e
                       WHERE e.post_id = p.id
                         AND jsonb_typeof(e.media) = 'array'
                         AND jsonb_array_length(e.media) > 0
                     )
                   ORDER BY p.created_at DESC, p.id DESC
                   LIMIT 50
                 ) t",
            )
            .bind(handle)
            .fetch_all(db),
        )
        .await?;
    }
    Ok(serde_json::json!({
        "profile": profile,
        "activity": activity,
        "posts": posts,
        "replies": replies,
        "media": media
    }))
}

async fn user_profile(
    State(db): State<PgPool>,
    Path(handle): Path<String>,
    Query(query): Query<ProfileQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let handle = handle.trim().trim_start_matches("u/").to_ascii_lowercase();
    if !(3..=32).contains(&handle.len())
        || !handle
            .bytes()
            .all(|value| value.is_ascii_lowercase() || value.is_ascii_digit() || value == b'_')
    {
        return Err(ApiError::Missing);
    }
    let tab = match query.tab.as_deref() {
        Some("activity") | Some("posts") | Some("replies") | Some("media") => query.tab.as_deref(),
        _ => Some("posts"),
    };
    Ok(Json(profile_payload(&db, &handle, tab).await?))
}

async fn my_profile(
    State(db): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let author_id = authenticated_author(&headers, &db).await?;
    let handle: String = sqlx::query_scalar("SELECT handle FROM authors WHERE id = $1")
        .bind(author_id)
        .fetch_one(&db)
        .await?;
    let mut payload = profile_payload(&db, &handle, None).await?;
    if let Some(object) = payload.as_object_mut() {
        // Profile changes are deliberately outside the publication moderation
        // queue. Keep the field for API compatibility with older clients.
        object.insert("pending_change".into(), serde_json::Value::Null);
    }
    Ok(Json(payload))
}

async fn update_profile(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<ProfileUpdateRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let author_id = active_author(&headers, &db).await?;
    let (display_name, bio, avatar_url) = validate_profile_update(input)?;
    let current: (String, String, Option<String>) =
        sqlx::query_as("SELECT display_name, bio, avatar_url FROM authors WHERE id = $1")
            .bind(author_id)
            .fetch_one(&db)
            .await?;
    if current == (display_name.clone(), bio.clone(), avatar_url.clone()) {
        return Err(ApiError::Invalid("There are no profile changes to submit"));
    }
    sqlx::query(
        "UPDATE authors
         SET display_name = $2, bio = $3, avatar_url = NULLIF($4, ''), profile_updated_at = now()
         WHERE id = $1",
    )
    .bind(author_id)
    .bind(&display_name)
    .bind(&bio)
    .bind(&avatar_url)
    .execute(&db)
    .await?;
    log_event(
        &db,
        "info",
        "profile.updated",
        serde_json::json!({
            "author_id": author_id,
            "moderation": "bypassed",
            "reason": "profile_changes_are_not_reviewed"
        }),
    )
    .await;
    Ok(Json(serde_json::json!({
        "status": "approved",
        "moderation_id": null,
        "severity": "none",
        "flags": [],
        "display_name": display_name,
        "bio": bio,
        "avatar_url": avatar_url.as_deref().filter(|value| !value.is_empty()).map_or(serde_json::Value::Null, |value| serde_json::Value::String(value.to_owned())),
        "message": "Profile updated immediately. Profile changes are not sent to moderation review."
    })))
}

async fn require_admin(headers: &HeaderMap, db: &PgPool) -> Result<i64, ApiError> {
    let author_id = authenticated_author(headers, db)
        .await
        .map_err(|e| match e {
            ApiError::Invalid(_) => ApiError::Unauthorized,
            other => other,
        })?;
    let is_admin: bool = sqlx::query_scalar("SELECT is_admin FROM authors WHERE id = $1")
        .bind(author_id)
        .fetch_optional(db)
        .await?
        .ok_or(ApiError::Invalid("Authentication required"))?;
    if !is_admin {
        return Err(ApiError::Forbidden);
    }
    Ok(author_id)
}
async fn admin_overview(
    State(db): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<AdminOverview>, ApiError> {
    require_admin(&headers, &db).await?;
    let row = sqlx::query_as::<_, (i64, i64, i64, i64, i64, i64, i64, i64, i64, i64)>(
        "SELECT
          (SELECT count(*) FROM authors WHERE password_hash IS NOT NULL),
          (SELECT count(*) FROM sessions WHERE expires_at > now()),
          (SELECT count(*) FROM communities),
          (SELECT count(*) FROM posts WHERE moderation_status = 'approved'),
          (SELECT count(*) FROM comments WHERE moderation_status = 'approved'),
          (SELECT count(*) FROM reports WHERE resolved_at IS NULL),
          (SELECT count(*) FROM media_assets),
          pg_database_size(current_database()),
          (SELECT count(*) FROM system_logs),
          (SELECT count(*) FROM moderation_items WHERE kind <> 'profile' AND status IN ('pending', 'escalated'))",
    )
    .fetch_one(&db)
    .await?;
    Ok(Json(AdminOverview {
        runtime: operations::snapshot(&db),
        started_at: *STARTED_AT.get().expect("server start time"),
        users: row.0,
        active_sessions: row.1,
        communities: row.2,
        posts: row.3,
        comments: row.4,
        open_reports: row.5,
        media_assets: row.6,
        database_size_bytes: row.7,
        log_entries: row.8,
        pending_moderation: row.9,
    }))
}

async fn admin_uptime(
    State(db): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&headers, &db).await?;
    let pulse = tokio::fs::read_to_string(uptime_pulse_path())
        .await
        .ok()
        .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
        .unwrap_or_else(|| serde_json::json!({"status":"unknown","recent":[]}));
    let pulse_url = pulse
        .get("url")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let configured_url = std::env::var("SWARTZIT_CHECK_URL")
        .or_else(|_| std::env::var("SWARTZIT_ORIGIN"))
        .unwrap_or_else(|_| pulse_url.to_owned());
    let interval_seconds = std::env::var("SWARTZIT_CHECK_INTERVAL")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| {
            pulse
                .get("interval_seconds")
                .and_then(serde_json::Value::as_u64)
        });
    let timeout_seconds = std::env::var("SWARTZIT_CHECK_TIMEOUT")
        .ok()
        .and_then(|value| value.parse::<u64>().ok());
    let configured = !configured_url.is_empty();
    Ok(Json(serde_json::json!({
        "pulse": pulse,
        "configuration": {
            "url": configured_url,
            "interval_seconds": interval_seconds,
            "timeout_seconds": timeout_seconds,
            "configured": configured
        }
    })))
}

async fn activity(State(db): State<PgPool>) -> Result<Json<serde_json::Value>, ApiError> {
    let orchard_enabled = instance_module_enabled(&db, "orchard").await?;
    let windows = if let Some(value) = operations::public_cache_get("activity.windows") {
        value
    } else {
        let value = operations::timed_query(
            "activity.windows",
            sqlx::query_scalar::<_, serde_json::Value>(
                "SELECT jsonb_agg(jsonb_build_object(
                    'label', label,
                    'minutes', minutes,
                    'users', (SELECT count(DISTINCT author_id) FROM (SELECT author_id FROM posts WHERE created_at >= now()-make_interval(mins => minutes) UNION SELECT author_id FROM comments WHERE created_at >= now()-make_interval(mins => minutes)) active),
                    'posts', (SELECT count(*) FROM posts WHERE created_at >= now()-make_interval(mins => minutes)),
                    'comments', (SELECT count(*) FROM comments WHERE created_at >= now()-make_interval(mins => minutes))
                 ) ORDER BY minutes)
                 FROM (VALUES ('last 5 minutes',5),('last 30 minutes',30),('last 4 hours',240)) windows(label,minutes)",
            )
            .fetch_one(&db),
        )
        .await?;
        operations::public_cache_put("activity.windows", value.clone());
        value
    };
    Ok(Json(serde_json::json!({
        "windows": windows,
        "features": {
            "orchard_enabled": orchard_enabled
        }
    })))
}
async fn subscriptions(
    State(db): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<String>>, ApiError> {
    let author_id = authenticated_author(&headers, &db).await?;
    let slugs = operations::timed_query(
        "subscriptions.batch",
        sqlx::query_scalar::<_, String>(
            "SELECT c.slug
             FROM community_subscriptions s
             JOIN communities c ON c.id = s.community_id
             WHERE s.author_id = $1
             ORDER BY c.slug",
        )
        .bind(author_id)
        .fetch_all(&db),
    )
    .await?;
    Ok(Json(slugs))
}
async fn logout(State(db): State<PgPool>, headers: HeaderMap) -> Result<StatusCode, ApiError> {
    let value = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let Some(token) = value.strip_prefix("Bearer ") else {
        return Err(ApiError::Invalid("Authentication required"));
    };
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(ApiError::Invalid("Authentication required"));
    }
    let token_hash = Sha256::digest(token.as_bytes()).to_vec();
    sqlx::query("DELETE FROM sessions WHERE token_hash = $1")
        .bind(token_hash)
        .execute(&db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn create_community(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<CreateCommunityRequest>,
) -> Result<(StatusCode, Json<Community>), ApiError> {
    let _author_id = authenticated_author(&headers, &db).await?;
    let slug = input.slug.trim().to_ascii_lowercase();
    let name = input.name.trim();
    let description = input.description.as_deref().unwrap_or("").trim();
    if !(1..=40).contains(&slug.len())
        || !slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    {
        return Err(ApiError::Invalid(
            "Slug must be 1-40 lowercase letters, numbers, or underscores",
        ));
    }
    if name.is_empty() || name.len() > 100 || description.len() > 1000 {
        return Err(ApiError::Invalid(
            "Community name or description is outside the allowed length",
        ));
    }
    let community = sqlx::query_as::<_, Community>("INSERT INTO communities (slug, name, description) VALUES ($1, $2, $3) RETURNING slug, name, description, 0::bigint AS post_count").bind(&slug).bind(name).bind(description).fetch_optional(&db).await.map_err(|e| if matches!(e, sqlx::Error::Database(ref db) if db.constraint() == Some("communities_slug_key")) { ApiError::Invalid("That community slug is already in use") } else { ApiError::Database(e) })?;
    operations::clear_public_cache();
    Ok((
        StatusCode::CREATED,
        Json(community.ok_or(ApiError::Invalid("Could not create community"))?),
    ))
}
async fn subscribe(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(slug): Path<String>,
) -> Result<Json<SubscriptionResponse>, ApiError> {
    let author_id = authenticated_author(&headers, &db).await?;
    let community = slug.trim().to_ascii_lowercase();
    let inserted = sqlx::query("INSERT INTO community_subscriptions (community_id, author_id) SELECT id, $1 FROM communities WHERE slug = $2 ON CONFLICT DO NOTHING").bind(author_id).bind(&community).execute(&db).await?;
    if inserted.rows_affected() == 0 {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM communities WHERE slug = $1)")
                .bind(&community)
                .fetch_one(&db)
                .await?;
        if !exists {
            return Err(ApiError::Missing);
        }
    }
    Ok(Json(SubscriptionResponse {
        community,
        subscribed: true,
    }))
}
async fn unsubscribe(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(slug): Path<String>,
) -> Result<Json<SubscriptionResponse>, ApiError> {
    let author_id = authenticated_author(&headers, &db).await?;
    let community = slug.trim().to_ascii_lowercase();
    sqlx::query("DELETE FROM community_subscriptions WHERE author_id = $1 AND community_id = (SELECT id FROM communities WHERE slug = $2)").bind(author_id).bind(&community).execute(&db).await?;
    Ok(Json(SubscriptionResponse {
        community,
        subscribed: false,
    }))
}
async fn subscription_status(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(slug): Path<String>,
) -> Result<Json<SubscriptionResponse>, ApiError> {
    let author_id = authenticated_author(&headers, &db).await?;
    let community = slug.trim().to_ascii_lowercase();
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM communities WHERE slug = $1)")
            .bind(&community)
            .fetch_one(&db)
            .await?;
    if !exists {
        return Err(ApiError::Missing);
    }
    let subscribed: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM community_subscriptions s JOIN communities c ON c.id = s.community_id WHERE s.author_id = $1 AND c.slug = $2)").bind(author_id).bind(&community).fetch_one(&db).await?;
    Ok(Json(SubscriptionResponse {
        community,
        subscribed,
    }))
}
async fn report(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<ReportRequest>,
) -> Result<(StatusCode, Json<ReportResponse>), ApiError> {
    let reporter_id = authenticated_author(&headers, &db).await?;
    let reason = input.reason.trim();
    if reason.is_empty()
        || reason.len() > 1000
        || input.post_id.is_some() == input.comment_id.is_some()
    {
        return Err(ApiError::Invalid(
            "Provide a reason and exactly one post_id or comment_id",
        ));
    }
    let valid: bool = if let Some(post_id) = input.post_id {
        sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM posts WHERE id = $1 AND moderation_status = 'approved')",
        )
        .bind(post_id)
        .fetch_one(&db)
        .await?
    } else {
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM comments WHERE id = $1 AND moderation_status = 'approved')")
            .bind(input.comment_id)
            .fetch_one(&db)
            .await?
    };
    if !valid {
        return Err(ApiError::Missing);
    }
    let row = sqlx::query_as::<_, ReportResponse>("INSERT INTO reports (reporter_id, post_id, comment_id, reason) VALUES ($1, $2, $3, $4) RETURNING id, reason").bind(reporter_id).bind(input.post_id).bind(input.comment_id).bind(reason).fetch_one(&db).await?;
    Ok((StatusCode::CREATED, Json(row)))
}
async fn register_media(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<RegisterMediaRequest>,
) -> Result<(StatusCode, Json<MediaAsset>), ApiError> {
    let _author_id = authenticated_author(&headers, &db).await?;
    let hash = input.content_hash.trim().to_ascii_lowercase();
    let media_type = input.media_type.trim().to_ascii_lowercase();
    if hash.len() < 32 || hash.len() > 128 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(ApiError::Invalid(
            "Content hash must be a hexadecimal digest",
        ));
    }
    if !["image", "video", "audio", "file"].contains(&media_type.as_str()) || input.byte_size < 0 {
        return Err(ApiError::Invalid("Media type or size is invalid"));
    }
    // X display standard: in-feed images are 1200x675 at most 5 MB.
    if media_type == "image" && input.byte_size > 5_242_880 {
        return Err(ApiError::Invalid("Images must be at most 5 MB"));
    }
    if input
        .magnet_uri
        .as_ref()
        .is_some_and(|uri| !uri.starts_with("magnet:?"))
    {
        return Err(ApiError::Invalid("Magnet URI must start with magnet:?"));
    }
    let row = sqlx::query_as::<_, MediaAsset>("INSERT INTO media_assets (content_hash, media_type, byte_size, magnet_uri) VALUES ($1, $2, $3, $4) ON CONFLICT (content_hash) DO UPDATE SET magnet_uri = COALESCE(EXCLUDED.magnet_uri, media_assets.magnet_uri) RETURNING id, content_hash, media_type, byte_size, magnet_uri").bind(hash).bind(media_type).bind(input.byte_size).bind(input.magnet_uri).fetch_one(&db).await?;
    Ok((StatusCode::CREATED, Json(row)))
}
async fn attach_media(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(post_id): Path<i64>,
    Json(input): Json<AttachMediaRequest>,
) -> Result<StatusCode, ApiError> {
    let author_id = active_author(&headers, &db).await?;
    let position = input.position.unwrap_or(0);
    if position < 0 {
        return Err(ApiError::Invalid("Media position must be non-negative"));
    }
    let result = sqlx::query("INSERT INTO post_media (post_id, media_id, position) SELECT p.id, m.id, $3 FROM posts p CROSS JOIN media_assets m WHERE p.id = $1 AND p.author_id = $2 AND m.id = $4 ON CONFLICT (post_id, media_id) DO UPDATE SET position = EXCLUDED.position").bind(post_id).bind(author_id).bind(position).bind(input.media_id).execute(&db).await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::Invalid("Post or media asset was not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}
async fn media(
    State(db): State<PgPool>,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let row: Option<MediaOverviewRow> = sqlx::query_as(
        "SELECT id, content_hash, media_type, byte_size, magnet_uri,
                COALESCE(NULLIF(mime_type, ''), content_type), storage_backend, variants
         FROM media_assets WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&db)
    .await?;
    let Some(row) = row else {
        return Err(ApiError::Missing);
    };
    Ok(Json(serde_json::json!({
        "id": row.id,
        "content_hash": row.content_hash,
        "media_type": row.media_type,
        "byte_size": row.byte_size,
        "magnet_uri": row.magnet_uri,
        "mime_type": row.mime_type,
        "storage_backend": row.storage_backend,
        "src": format!("/media/{}", row.id),
        "original_src": format!("/media/{}/original", row.id),
        "thumbnail_src": row.variants.get("thumbnail").map(|_| format!("/media/{}/thumbnail", row.id)),
    })))
}
async fn create_post(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<CreatePostRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    let author_id = active_author(&headers, &db).await?;
    let title = input.title.trim();
    let body = input.body.trim();
    let community = input.community.trim().to_ascii_lowercase();
    if title.is_empty() || title.len() > 300 || body.len() > 50000 {
        return Err(ApiError::Invalid(
            "Title or body is outside the allowed length",
        ));
    }
    let moderation_enabled = instance_module_enabled(&db, "moderation").await?;
    let (severity, flags, urgent) = if moderation_enabled {
        let analysis = analyze_user_content(&db, author_id, &format!("{title}\n{body}")).await?;
        (
            analysis.severity.clone(),
            flags_json(&analysis),
            analysis.urgent,
        )
    } else {
        ("none".to_owned(), serde_json::json!([]), false)
    };
    let publication_status = if moderation_enabled {
        "pending"
    } else {
        "approved"
    };
    let mut tx = db.begin().await?;
    let result = sqlx::query_as::<_, CreatedPost>(
        "INSERT INTO posts (
           community_id, author_id, title, body, moderation_status
         )
         SELECT id, $1, $2, $3, $5
         FROM communities
         WHERE slug = $4
         RETURNING id, public_id, title, $4::text AS community",
    )
    .bind(author_id)
    .bind(title)
    .bind(body)
    .bind(&community)
    .bind(publication_status)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::Missing)?;
    let moderation_id = if moderation_enabled {
        let moderation_id: i64 = sqlx::query_scalar(
            "INSERT INTO moderation_items(
               kind, target_id, author_id, status, severity, flags, rule_version, urgent
             ) VALUES ('post', $1, $2, 'pending', $3, $4, $5, $6)
             RETURNING id",
        )
        .bind(result.id)
        .bind(author_id)
        .bind(&severity)
        .bind(flags.clone())
        .bind(moderation::RULE_VERSION)
        .bind(urgent)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query("UPDATE posts SET moderation_item_id = $2 WHERE id = $1")
            .bind(result.id)
            .bind(moderation_id)
            .execute(&mut *tx)
            .await?;
        Some(moderation_id)
    } else {
        None
    };
    tx.commit().await?;
    operations::clear_public_cache();
    log_event(
        &db,
        "info",
        if moderation_enabled {
            "moderation.submitted"
        } else {
            "post.published"
        },
        serde_json::json!({
            "kind": "post",
            "moderation_id": moderation_id,
            "author_id": author_id,
            "severity": severity,
            "urgent": urgent,
            "moderation": if moderation_enabled { "enabled" } else { "disabled" }
        }),
    )
    .await;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": result.id,
            "public_id": result.public_id,
            "title": result.title,
            "community": result.community,
            "status": publication_status,
            "severity": severity,
            "flags": flags,
            "moderation_id": moderation_id,
            "message": if moderation_enabled { "Your discussion is waiting for moderator review." } else { "Your discussion is published." }
        })),
    ))
}
async fn create_comment(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(post_id): Path<i64>,
    Json(input): Json<CreateCommentRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    let author_id = active_author(&headers, &db).await?;
    let body = input.body.trim();
    if body.is_empty() || body.len() > 10000 {
        return Err(ApiError::Invalid(
            "Comment must be between 1 and 10000 characters",
        ));
    }
    let moderation_enabled = instance_module_enabled(&db, "moderation").await?;
    let (severity, flags, urgent) = if moderation_enabled {
        let analysis = analyze_user_content(&db, author_id, body).await?;
        (
            analysis.severity.clone(),
            flags_json(&analysis),
            analysis.urgent,
        )
    } else {
        ("none".to_owned(), serde_json::json!([]), false)
    };
    let publication_status = if moderation_enabled {
        "pending"
    } else {
        "approved"
    };
    let mut tx = db.begin().await?;
    let result = sqlx::query_as::<_, CreatedComment>(
        "INSERT INTO comments (
           post_id, author_id, parent_id, body, moderation_status
         )
         SELECT $1, $2, $3, $4, $5
         WHERE EXISTS (
           SELECT 1 FROM posts WHERE id = $1 AND moderation_status = 'approved'
         )
         AND (
           $3::bigint IS NULL OR EXISTS (
             SELECT 1 FROM comments
             WHERE id = $3 AND post_id = $1 AND moderation_status = 'approved'
           )
         )
         RETURNING id, post_id, parent_id, body, (SELECT handle FROM authors WHERE id = $2) AS author",
    )
    .bind(post_id)
    .bind(author_id)
    .bind(input.parent_id)
    .bind(body)
    .bind(publication_status)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::Invalid(
        "Post or parent comment is not available for replies",
    ))?;
    let moderation_id = if moderation_enabled {
        let moderation_id: i64 = sqlx::query_scalar(
            "INSERT INTO moderation_items(
               kind, target_id, author_id, status, severity, flags, rule_version, urgent
             ) VALUES ('comment', $1, $2, 'pending', $3, $4, $5, $6)
             RETURNING id",
        )
        .bind(result.id)
        .bind(author_id)
        .bind(&severity)
        .bind(flags.clone())
        .bind(moderation::RULE_VERSION)
        .bind(urgent)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query("UPDATE comments SET moderation_item_id = $2 WHERE id = $1")
            .bind(result.id)
            .bind(moderation_id)
            .execute(&mut *tx)
            .await?;
        Some(moderation_id)
    } else {
        None
    };
    tx.commit().await?;
    operations::clear_public_cache();
    log_event(
        &db,
        "info",
        if moderation_enabled {
            "moderation.submitted"
        } else {
            "comment.published"
        },
        serde_json::json!({
            "kind": "comment",
            "moderation_id": moderation_id,
            "author_id": author_id,
            "severity": severity,
            "urgent": urgent,
            "moderation": if moderation_enabled { "enabled" } else { "disabled" }
        }),
    )
    .await;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": result.id,
            "post_id": result.post_id,
            "parent_id": result.parent_id,
            "body": result.body,
            "author": result.author,
            "status": publication_status,
            "severity": severity,
            "flags": flags,
            "moderation_id": moderation_id,
            "message": if moderation_enabled { "Your comment is waiting for moderator review." } else { "Your comment is published." }
        })),
    ))
}
async fn vote(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(post_id): Path<i64>,
    Json(input): Json<VoteRequest>,
) -> Result<Json<VoteResponse>, ApiError> {
    let author_id = active_author(&headers, &db).await?;
    if ![-1, 0, 1].contains(&input.value) {
        return Err(ApiError::Invalid("Vote must be -1, 0, or 1"));
    }
    let approved: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM posts WHERE id = $1 AND moderation_status = 'approved')",
    )
    .bind(post_id)
    .fetch_one(&db)
    .await?;
    if !approved {
        return Err(ApiError::Missing);
    }
    let mut tx = db.begin().await?;
    if input.value == 0 {
        sqlx::query("DELETE FROM post_votes WHERE post_id = $1 AND author_id = $2")
            .bind(post_id)
            .bind(author_id)
            .execute(&mut *tx)
            .await?;
    } else {
        sqlx::query("INSERT INTO post_votes (post_id, author_id, value) VALUES ($1, $2, $3) ON CONFLICT (post_id, author_id) DO UPDATE SET value = EXCLUDED.value").bind(post_id).bind(author_id).bind(input.value).execute(&mut *tx).await?;
    }
    let exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM posts WHERE id = $1)")
        .bind(post_id)
        .fetch_one(&mut *tx)
        .await?;
    if !exists {
        return Err(ApiError::Missing);
    }
    let score: i64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(value), 0)::bigint FROM post_votes WHERE post_id = $1",
    )
    .bind(post_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    operations::clear_public_cache();
    Ok(Json(VoteResponse {
        post_id,
        score,
        your_vote: (input.value != 0).then_some(input.value),
    }))
}
async fn communities(State(db): State<PgPool>) -> Result<Json<Vec<Community>>, ApiError> {
    if let Some(value) = operations::public_cache_get("communities")
        && let Ok(rows) = serde_json::from_value::<Vec<Community>>(value)
    {
        return Ok(Json(rows));
    }
    let rows: Vec<Community> = operations::timed_query(
        "communities.list",
        sqlx::query_as("SELECT c.slug, c.name, c.description, (SELECT count(*) FROM posts p WHERE p.community_id = c.id AND p.moderation_status = 'approved') AS post_count FROM communities c ORDER BY c.name").fetch_all(&db),
    )
    .await?;
    if let Ok(value) = serde_json::to_value(&rows) {
        operations::public_cache_put("communities", value);
    }
    Ok(Json(rows))
}
async fn community(
    State(db): State<PgPool>,
    Path(slug): Path<String>,
) -> Result<Json<Community>, ApiError> {
    Ok(Json(sqlx::query_as("SELECT c.slug, c.name, c.description, (SELECT count(*) FROM posts p WHERE p.community_id = c.id AND p.moderation_status = 'approved') AS post_count FROM communities c WHERE c.slug = $1").bind(slug).fetch_optional(&db).await?.ok_or(ApiError::Missing)?))
}
async fn posts(
    State(db): State<PgPool>,
    Query(query): Query<FeedQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let offset = query.validate()?;
    let q = query.q.as_deref().unwrap_or("").trim();
    let order = imports::order(query.sort.as_deref())?;
    let sql = format!(
        "{POST_SELECT} WHERE p.moderation_status = 'approved' AND ($1::text IS NULL OR c.slug = $1) AND ($2 = '' OR p.search_document @@ websearch_to_tsquery('english', $2)) ORDER BY {order}, p.id DESC LIMIT {} OFFSET $3",
        FEED_PAGE_SIZE + 1
    );
    let cache_key = if offset == 0 && q.is_empty() && query.community.is_none() {
        Some(format!(
            "posts:{}",
            query.sort.as_deref().unwrap_or("newest")
        ))
    } else {
        None
    };
    if let Some(key) = &cache_key
        && let Some(value) = operations::public_cache_get(key)
    {
        return Ok(Json(value));
    }
    let mut posts: Vec<Post> = operations::timed_query(
        "feed.public",
        sqlx::query_as(&sql)
            .bind(&query.community)
            .bind(q)
            .bind(offset)
            .fetch_all(&db),
    )
    .await?;
    let has_more = posts.len() > FEED_PAGE_SIZE as usize;
    posts.truncate(FEED_PAGE_SIZE as usize);
    let value = serde_json::json!({"posts": posts, "has_more": has_more});
    if let Some(key) = cache_key {
        operations::public_cache_put(key, value.clone());
    }
    Ok(Json(value))
}
async fn home_feed(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Query(query): Query<FeedQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let author_id = authenticated_author(&headers, &db).await?;
    let order = imports::order(query.sort.as_deref())?;
    let offset = query.validate()?;
    let sql = format!(
        "{POST_SELECT} JOIN community_subscriptions s ON s.community_id = p.community_id AND s.author_id = $1 WHERE p.moderation_status = 'approved' AND ($2 = '' OR p.search_document @@ websearch_to_tsquery('english', $2)) AND ($3::text IS NULL OR c.slug = $3) ORDER BY {order}, p.id DESC LIMIT {} OFFSET $4",
        FEED_PAGE_SIZE + 1
    );
    let mut posts: Vec<Post> = operations::timed_query(
        "feed.following",
        sqlx::query_as(&sql)
            .bind(author_id)
            .bind(query.q.as_deref().unwrap_or("").trim())
            .bind(&query.community)
            .bind(offset)
            .fetch_all(&db),
    )
    .await?;
    let has_more = posts.len() > FEED_PAGE_SIZE as usize;
    posts.truncate(FEED_PAGE_SIZE as usize);
    Ok(Json(
        serde_json::json!({"posts": posts, "has_more": has_more}),
    ))
}
async fn post(
    State(db): State<PgPool>,
    Path(raw_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let post: Post = if let Ok(id) = raw_id.parse::<i64>() {
        sqlx::query_as(&format!(
            "{POST_SELECT} WHERE p.moderation_status = 'approved' AND p.id = $1"
        ))
        .bind(id)
        .fetch_optional(&db)
        .await?
    } else {
        sqlx::query_as(&format!(
            "{POST_SELECT} WHERE p.moderation_status = 'approved' AND p.public_id = $1"
        ))
        .bind(&raw_id)
        .fetch_optional(&db)
        .await?
    }
    .ok_or(ApiError::Missing)?;
    let id = post.id;
    // Bounded for the initial reader; expose truncation instead of silently losing replies.
    let mut comments: Vec<Comment> = sqlx::query_as("SELECT cm.id, cm.parent_id, cm.body, a.handle AS author, cm.created_at FROM comments cm JOIN authors a ON a.id = cm.author_id WHERE cm.post_id = $1 AND cm.moderation_status = 'approved' ORDER BY cm.id LIMIT 501").bind(id).fetch_all(&db).await?;
    let comments_truncated = comments.len() > 500;
    comments.truncate(500);
    let media: Vec<MediaAsset> = sqlx::query_as("SELECT m.id, m.content_hash, m.media_type, m.byte_size, m.magnet_uri FROM post_media pm JOIN media_assets m ON m.id = pm.media_id WHERE pm.post_id = $1 ORDER BY pm.position, m.id").bind(id).fetch_all(&db).await?;
    let draw_feedback = if is_draw_things_source(&post.source) {
        Some(draw_things_feedback_summary(&db, id).await?)
    } else {
        None
    };
    Ok(Json(
        serde_json::json!({"post": post, "comments": comments, "comments_truncated": comments_truncated, "media": media, "draw_feedback": draw_feedback}),
    ))
}
async fn export(
    State(db): State<PgPool>,
    Query(query): Query<FeedQuery>,
) -> Result<Json<ExportBundle>, ApiError> {
    query.validate()?;
    let communities: Vec<CommunityExport> = sqlx::query_as("SELECT slug, name, description FROM communities WHERE ($1::text IS NULL OR slug = $1) ORDER BY slug")
        .bind(&query.community).fetch_all(&db).await?;
    let posts: Vec<PostExport> = sqlx::query_as("SELECT p.id, c.slug AS community, a.handle AS author, p.title, p.body, p.created_at FROM posts p JOIN communities c ON c.id = p.community_id JOIN authors a ON a.id = p.author_id WHERE p.moderation_status = 'approved' AND ($1::text IS NULL OR c.slug = $1) ORDER BY p.id LIMIT 10000")
        .bind(&query.community).fetch_all(&db).await?;
    let comments: Vec<CommentExport> = sqlx::query_as("SELECT cm.id, cm.post_id, cm.parent_id, a.handle AS author, cm.body, cm.created_at FROM comments cm JOIN authors a ON a.id = cm.author_id JOIN posts p ON p.id = cm.post_id JOIN communities c ON c.id = p.community_id WHERE cm.moderation_status = 'approved' AND p.moderation_status = 'approved' AND ($1::text IS NULL OR c.slug = $1) ORDER BY cm.id LIMIT 50000")
        .bind(&query.community).fetch_all(&db).await?;
    let media: Vec<ExportMedia> = sqlx::query_as("SELECT pm.post_id, pm.media_id, pm.position, m.content_hash, m.media_type, m.byte_size, m.magnet_uri FROM post_media pm JOIN media_assets m ON m.id = pm.media_id JOIN posts p ON p.id = pm.post_id JOIN communities c ON c.id = p.community_id WHERE p.moderation_status = 'approved' AND ($1::text IS NULL OR c.slug = $1) ORDER BY pm.post_id, pm.position LIMIT 50000")
        .bind(&query.community).fetch_all(&db).await?;
    Ok(Json(ExportBundle {
        format: "swartzit-public-v1",
        exported_at: Utc::now(),
        communities,
        posts,
        comments,
        media,
    }))
}
async fn feed(State(db): State<PgPool>) -> Result<axum::response::Response, ApiError> {
    let posts: Vec<Post> = sqlx::query_as(&format!(
        "{POST_SELECT} WHERE p.moderation_status = 'approved' ORDER BY p.created_at DESC, p.id DESC LIMIT 50"
    ))
    .fetch_all(&db)
    .await?;
    fn xml(value: &str) -> String {
        value
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    }
    let items = posts.into_iter().map(|p| format!("<item><title>{}</title><link>/post/{}</link><guid>/post/{}</guid><description>{}</description><author>u/{}</author><category>c/{}</category><pubDate>{}</pubDate></item>", xml(&p.title), p.id, p.id, xml(&p.body), xml(&p.author), xml(&p.community), p.created_at.to_rfc2822())).collect::<String>();
    let body = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><rss version=\"2.0\"><channel><title>Swartzit</title><description>Public discussions for communities that belong to their members.</description><link>/</link>{items}</channel></rss>"
    );
    Ok((
        [(
            axum::http::header::CONTENT_TYPE,
            "application/rss+xml; charset=utf-8",
        )],
        body,
    )
        .into_response())
}
async fn shutdown() {
    let _ = tokio::signal::ctrl_c().await;
}

fn spawn_maintenance(db: PgPool) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        // Do not make startup wait on housekeeping. The first tick is consumed
        // here so cleanup never competes with the first request after launch.
        interval.tick().await;
        loop {
            interval.tick().await;
            for (label, statement) in [
                ("sessions", "DELETE FROM sessions WHERE expires_at <= now()"),
                (
                    "view visits",
                    "DELETE FROM post_view_visits WHERE started_at < now() - interval '1 hour'",
                ),
                (
                    "ip activity",
                    "DELETE FROM ip_activity WHERE created_at < now() - interval '7 days'",
                ),
                (
                    "content runner logs",
                    "DELETE FROM content_runner_runs r USING content_runners c WHERE r.runner_id=c.id AND r.finished_at IS NOT NULL AND r.finished_at < now() - make_interval(days => c.retention_days)",
                ),
            ] {
                if let Err(error) = sqlx::query(statement).execute(&db).await {
                    tracing::warn!(%error, maintenance = label, "periodic maintenance failed");
                }
            }
            if let Err(error) = admin::process_media_replication_jobs(&db).await {
                tracing::warn!(%error, maintenance = "media replication", "periodic maintenance failed");
            }
            if let Err(error) = sqlx::query("UPDATE content_runner_runs SET status='failed', finished_at=now(), error='Worker lease expired', detail=jsonb_build_object('reaped', true), progress_phase='failed', eta_seconds=NULL, progress_updated_at=now() WHERE status='running' AND started_at < now() - interval '2 hours'").execute(&db).await {
                tracing::warn!(%error, maintenance = "content runner leases", "periodic maintenance failed");
            }
        }
    });
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    STARTED_AT.set(Utc::now()).ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "swartzit_server=info".into()),
        )
        .init();
    let database_url = std::env::var("DATABASE_URL").map_err(|_| "DATABASE_URL is required")?;
    let max_connections = std::env::var("SWARTZIT_DB_MAX_CONNECTIONS")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(5)
        .clamp(1, 32);
    let db = PgPoolOptions::new()
        .max_connections(max_connections)
        .connect(&database_url)
        .await?;
    sqlx::migrate!().run(&db).await?;
    if std::env::args().any(|a| a == "--seed-communities") {
        let inserted = sqlx::raw_sql(include_str!("../starter-communities.sql"))
            .execute(&db)
            .await?
            .rows_affected();
        let total: i64 = sqlx::query_scalar("SELECT count(*) FROM communities")
            .fetch_one(&db)
            .await?;
        println!(
            "Starter communities ready: {total} total ({inserted} newly added). Existing communities preserved."
        );
        return Ok(());
    }
    if std::env::args().any(|a| a == "--bootstrap-admin") {
        let handle = std::env::var("ADMIN_HANDLE")
            .unwrap_or_else(|_| "techmore".into())
            .trim()
            .to_ascii_lowercase();
        let mut tx = db.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(738129)")
            .execute(&mut *tx)
            .await?;
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM authors WHERE handle = $1 AND password_hash IS NOT NULL)",
        )
        .bind(&handle)
        .fetch_one(&mut *tx)
        .await?;
        if exists && std::env::var("RESET_ADMIN_PASSWORD").as_deref() != Ok("1") {
            sqlx::query("UPDATE authors SET is_admin = TRUE WHERE handle = $1")
                .bind(&handle)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            log_event(
                &db,
                "info",
                "admin.promoted",
                serde_json::json!({"handle": handle}),
            )
            .await;
            println!(
                "Administrator ready: u/{handle}. Existing password preserved. Sign in at /login, then open /admin."
            );
            return Ok(());
        }
        let supplied = std::env::var("ADMIN_PASSWORD").ok();
        let password = supplied.clone().unwrap_or_else(|| {
            let mut bytes = [0u8; 24];
            rand::rng().fill_bytes(&mut bytes);
            hex::encode(bytes)
        });
        if !(12..=256).contains(&password.len())
            || !(3..=32).contains(&handle.len())
            || !handle
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        {
            return Err("Invalid handle or password length".into());
        }
        let salt = SaltString::generate(&mut OsRng);
        let hash = Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map_err(|_| "could not hash administrator password")?
            .to_string();
        sqlx::query("INSERT INTO authors (handle, password_hash, is_admin) VALUES ($1, $2, TRUE) ON CONFLICT (handle) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_admin = TRUE")
            .bind(&handle).bind(hash).execute(&mut *tx).await?;
        sqlx::query(
            "DELETE FROM sessions WHERE author_id = (SELECT id FROM authors WHERE handle = $1)",
        )
        .bind(&handle)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        log_event(
            &db,
            "info",
            "admin.bootstrapped",
            serde_json::json!({"handle": handle}),
        )
        .await;
        println!("Administrator account ready: u/{handle}");
        if supplied.is_none() {
            println!("Generated password (save now): {password}");
        }
        return Ok(());
    }
    if std::env::args().any(|a| a == "--seed-demo") {
        seed(&db).await?;
        return Ok(());
    }
    spawn_maintenance(db.clone());
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);
    let app = Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/.well-known/nodeinfo", get(nodeinfo))
        .route("/api/accounts", post_method(signup))
        .route("/api/sessions", post_method(login).delete(logout))
        .route("/api/me", get(me))
        .route("/api/me/profile", get(my_profile).post(update_profile))
        .route("/api/users/{handle}", get(user_profile))
        .route("/api/bookmarks", get(bookmarks::list))
        .route("/api/bookmarks/status", get(bookmarks::batch_status))
        .route(
            "/api/bookmark-folders",
            get(bookmarks::folders).post(bookmarks::create_folder),
        )
        .route(
            "/api/bookmark-folders/{id}",
            post_method(bookmarks::rename_folder).delete(bookmarks::delete_folder),
        )
        .route(
            "/api/posts/{id}/bookmark",
            get(bookmarks::status)
                .post(bookmarks::save)
                .delete(bookmarks::remove),
        )
        .route("/api/admin/overview", get(admin_overview))
        .route("/api/admin/uptime", get(admin_uptime))
        .route(
            "/api/admin/settings",
            get(admin::settings).post(admin::update_settings),
        )
        .route("/api/admin/storage", get(admin::storage))
        .route("/api/admin/moderation", get(admin::moderation))
        .route(
            "/api/admin/moderation/{id}",
            post_method(admin::decide_moderation),
        )
        .route(
            "/api/admin/moderation-history",
            get(admin::moderation_history),
        )
        .route("/api/activity", get(activity))
        .route("/api/subscriptions", get(subscriptions))
        .route("/api/admin/logs", get(admin::logs))
        .route("/api/admin/users", get(admin::users))
        .route(
            "/api/admin/users/{id}/revoke-sessions",
            post_method(admin::revoke),
        )
        .route("/api/admin/content", get(admin::content))
        .route("/api/admin/reports", get(admin::reports))
        .route(
            "/api/admin/reports/{id}/resolve",
            post_method(admin::resolve),
        )
        .route("/api/admin/analytics", get(admin::analytics))
        .route(
            "/api/admin/security",
            get(admin::security).post(admin::block_ip),
        )
        .route(
            "/api/admin/security/{id}",
            axum::routing::delete(admin::unblock_ip),
        )
        .route(
            "/api/admin/crawler-jobs",
            get(admin::crawler_jobs).post(admin::create_crawler_job),
        )
        .route(
            "/api/admin/crawler-jobs/{id}/toggle",
            post_method(admin::toggle_crawler_job),
        )
        .route(
            "/api/admin/crawler-jobs/{id}/run-now",
            post_method(admin::run_crawler_job_now),
        )
        .route(
            "/api/admin/crawler-jobs/{id}",
            axum::routing::delete(admin::delete_crawler_job),
        )
        .route("/api/admin/crawler-runs", get(admin::crawler_runs))
        .route(
            "/api/admin/crawler-jobs/{id}/claim",
            post_method(admin::claim_crawler_job),
        )
        .route(
            "/api/admin/crawler-runs/{run_id}/complete",
            post_method(admin::complete_crawler_job),
        )
        .route(
            "/api/admin/content-runners",
            get(admin::content_runners).post(admin::create_content_runner),
        )
        .route(
            "/api/admin/content-runners/{id}",
            get(admin::content_runner)
                .post(admin::update_content_runner)
                .delete(admin::delete_content_runner),
        )
        .route(
            "/api/admin/content-runners/{id}/toggle",
            post_method(admin::toggle_content_runner),
        )
        .route(
            "/api/admin/content-runners/{id}/run-now",
            post_method(admin::run_content_runner_now),
        )
        .route(
            "/api/admin/content-runners/{id}/test",
            post_method(admin::test_content_runner),
        )
        .route(
            "/api/admin/content-runners/{id}/archive",
            post_method(admin::archive_content_runner),
        )
        .route(
            "/api/admin/content-runners/{id}/claim",
            post_method(admin::claim_content_runner),
        )
        .route(
            "/api/admin/content-runner-runs/{run_id}/complete",
            post_method(admin::complete_content_runner),
        )
        .route(
            "/api/admin/content-runner-runs/{run_id}/progress",
            post_method(admin::update_content_runner_progress),
        )
        .route(
            "/api/admin/content-runner-runs",
            get(admin::content_runner_runs),
        )
        .route(
            "/api/admin/content-runner-runs/{run_id}/replay",
            post_method(admin::replay_content_runner),
        )
        .route(
            "/api/admin/content-runners/publish",
            post_method(admin::publish_content_runner),
        )
        .route(
            "/api/admin/content-runners/media",
            post_method(admin::upload_content_runner_media)
                // Runner uploads are JSON-wrapped hex, so the request is
                // roughly twice the size of the original image. Keep this
                // larger limit scoped to the admin runner-media endpoint.
                .layer(DefaultBodyLimit::max(12 * 1024 * 1024)),
        )
        .route(
            "/api/admin/content-runners/media/raw",
            post_method(admin::upload_content_runner_media_raw)
                .layer(DefaultBodyLimit::max(6 * 1024 * 1024)),
        )
        .route("/api/admin/media/test", post_method(admin::media_test))
        .route(
            "/api/admin/media/migrate",
            post_method(admin::media_migrate),
        )
        .route("/api/admin/media/verify", post_method(admin::media_verify))
        .route(
            "/api/admin/media/cache/clear",
            post_method(admin::media_clear_cache),
        )
        .route(
            "/api/admin/media/{id}/share",
            post_method(admin::share_media).delete(admin::unshare_media),
        )
        .route("/api/admin/imports", post_method(imports::ingest))
        .route("/api/posts/cross-post", post_method(imports::cross_post))
        .route("/profile-images/{id}", get(profile_image))
        .route("/media/{id}", get(runner_media))
        .route("/media/{id}/{variant}", get(runner_media_variant))
        .route("/api/views", post_method(operations::view))
        .route("/api/posts", post_method(create_post).get(posts))
        .route(
            "/api/communities",
            post_method(create_community).get(communities),
        )
        .route("/api/communities/{slug}", get(community))
        .route(
            "/api/communities/{slug}/subscription",
            post_method(subscribe)
                .delete(unsubscribe)
                .get(subscription_status),
        )
        .route("/api/posts/{id}", get(post))
        .route("/api/home", get(home_feed))
        .route("/api/posts/{id}/comments", post_method(create_comment))
        .route("/api/posts/{id}/vote", post_method(vote))
        .route(
            "/api/posts/{id}/draw-feedback",
            get(draw_things_feedback_get).post(draw_things_feedback_submit),
        )
        .route("/api/posts/{id}/views", post_method(views::record))
        .route("/api/reports", post_method(report))
        .route("/api/media/upload", post_method(admin::upload_media))
        .route("/api/media", post_method(register_media))
        .route("/api/posts/{id}/media", post_method(attach_media))
        .route("/api/media/{id}", get(media))
        .route("/api/export", get(export))
        .route("/feed.xml", get(feed))
        .layer(axum::middleware::from_fn_with_state(
            db.clone(),
            operations::observe,
        ))
        .layer(cors)
        .with_state(db.clone());
    let bind = std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, "Swartzit API listening");
    log_event(
        &db,
        "info",
        "server.started",
        serde_json::json!({"version": env!("CARGO_PKG_VERSION")}),
    )
    .await;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}
async fn seed(db: &PgPool) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    // Serialize seed runs; starter list is idempotent so demo and
    // post-install seeding can coexist in any order.
    sqlx::query("LOCK TABLE communities, authors, posts IN EXCLUSIVE MODE")
        .execute(&mut *tx)
        .await?;
    sqlx::raw_sql(include_str!("../starter-communities.sql"))
        .execute(&mut *tx)
        .await?;
    let demo_present: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM posts WHERE title = 'What would an internet built for its communities look like?')",
    )
    .fetch_one(&mut *tx)
    .await?;
    if demo_present {
        tx.commit().await?;
        tracing::info!("Seed skipped: demo discussions already exist");
        return Ok(());
    }
    sqlx::raw_sql(include_str!("../demo.sql"))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    tracing::info!("Demo discussions created");
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unbounded_pagination() {
        for page in [0, -1, 10001, i64::MAX] {
            assert!(
                FeedQuery {
                    page: Some(page),
                    ..Default::default()
                }
                .validate()
                .is_err()
            );
        }
        assert_eq!(FeedQuery::default().validate().unwrap(), 0);
        assert_eq!(
            FeedQuery {
                page: Some(2),
                ..Default::default()
            }
            .validate()
            .unwrap(),
            FEED_PAGE_SIZE
        );
    }
    #[test]
    fn bounds_search_input() {
        assert!(
            FeedQuery {
                q: Some("x".repeat(201)),
                ..Default::default()
            }
            .validate()
            .is_err()
        );
    }
    #[test]
    fn draw_things_feedback_accepts_optional_dimensions() {
        let valid = DrawThingsFeedbackRequest {
            overall: 5,
            prompt_match: Some(4),
            natural_color: None,
            realism: Some(3),
            likeness: None,
            composition: Some(4),
            detail: Some(5),
        };
        assert!(validate_draw_things_feedback(&valid).is_ok());
        assert!(
            validate_draw_things_feedback(&DrawThingsFeedbackRequest {
                overall: 0,
                ..valid
            })
            .is_err()
        );
    }
    #[test]
    fn database_error_does_not_expose_details() {
        assert_eq!(
            ApiError::Database(sqlx::Error::RowNotFound)
                .into_response()
                .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}
