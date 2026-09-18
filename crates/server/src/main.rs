use argon2::PasswordVerifier;
use argon2::{
    Argon2, PasswordHasher,
    password_hash::{SaltString, rand_core::OsRng},
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
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
mod imports;
mod operations;
mod views;

static STARTED_AT: std::sync::OnceLock<DateTime<Utc>> = std::sync::OnceLock::new();

#[derive(Debug)]
enum ApiError {
    Unauthorized,
    Forbidden,
    Missing,
    Invalid(&'static str),
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
            Self::Missing => (StatusCode::NOT_FOUND, "Not found"),
            Self::Invalid(message) => (StatusCode::BAD_REQUEST, message),
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
#[derive(Serialize, FromRow)]
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
    title: String,
    community: String,
}
#[derive(Deserialize)]
struct CreateCommentRequest {
    body: String,
    parent_id: Option<i64>,
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
        Ok((page - 1) * 20)
    }
}
const POST_SELECT: &str = "SELECT (SELECT to_jsonb(e)-'post_id' FROM external_posts e WHERE e.post_id=p.id) AS source, p.view_count, p.engaged_view_count, p.deep_view_count, p.id, p.title, p.body, p.created_at, a.handle AS author, c.slug AS community, c.name AS community_name, (SELECT count(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count, (SELECT COALESCE(sum(value), 0)::bigint FROM post_votes v WHERE v.post_id = p.id) AS score FROM posts p JOIN authors a ON a.id = p.author_id JOIN communities c ON c.id = p.community_id";
async fn health(State(db): State<PgPool>) -> Result<Json<serde_json::Value>, ApiError> {
    sqlx::query("SELECT 1").execute(&db).await?;
    Ok(Json(serde_json::json!({"status":"ok"})))
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
    sqlx::query("DELETE FROM sessions WHERE expires_at <= now()")
        .execute(db)
        .await?;
    sqlx::query_scalar(
        "SELECT author_id FROM sessions WHERE token_hash = $1 AND expires_at > now()",
    )
    .bind(token_hash)
    .fetch_optional(db)
    .await?
    .ok_or(ApiError::Invalid("Authentication required"))
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
    let row = sqlx::query_as::<_, (i64, i64, i64, i64, i64, i64, i64, i64, i64)>(
        "SELECT
          (SELECT count(*) FROM authors WHERE password_hash IS NOT NULL),
          (SELECT count(*) FROM sessions WHERE expires_at > now()),
          (SELECT count(*) FROM communities),
          (SELECT count(*) FROM posts),
          (SELECT count(*) FROM comments),
          (SELECT count(*) FROM reports WHERE resolved_at IS NULL),
          (SELECT count(*) FROM media_assets),
          pg_database_size(current_database()),
          (SELECT count(*) FROM system_logs)",
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
    }))
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
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM posts WHERE id = $1)")
            .bind(post_id)
            .fetch_one(&db)
            .await?
    } else {
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM comments WHERE id = $1)")
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
    let author_id = authenticated_author(&headers, &db).await?;
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
) -> Result<Json<MediaAsset>, ApiError> {
    Ok(Json(sqlx::query_as::<_, MediaAsset>("SELECT id, content_hash, media_type, byte_size, magnet_uri FROM media_assets WHERE id = $1").bind(id).fetch_optional(&db).await?.ok_or(ApiError::Missing)?))
}
async fn create_post(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<CreatePostRequest>,
) -> Result<(StatusCode, Json<CreatedPost>), ApiError> {
    let author_id = authenticated_author(&headers, &db).await?;
    let title = input.title.trim();
    let body = input.body.trim();
    let community = input.community.trim().to_ascii_lowercase();
    if title.is_empty() || title.len() > 300 || body.len() > 50000 {
        return Err(ApiError::Invalid(
            "Title or body is outside the allowed length",
        ));
    }
    let result = sqlx::query_as::<_, CreatedPost>("INSERT INTO posts (community_id, author_id, title, body) SELECT id, $1, $2, $3 FROM communities WHERE slug = $4 RETURNING id, title, $4::text AS community").bind(author_id).bind(title).bind(body).bind(&community).fetch_optional(&db).await?;
    Ok((StatusCode::CREATED, Json(result.ok_or(ApiError::Missing)?)))
}
async fn create_comment(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(post_id): Path<i64>,
    Json(input): Json<CreateCommentRequest>,
) -> Result<(StatusCode, Json<CreatedComment>), ApiError> {
    let author_id = authenticated_author(&headers, &db).await?;
    let body = input.body.trim();
    if body.is_empty() || body.len() > 10000 {
        return Err(ApiError::Invalid(
            "Comment must be between 1 and 10000 characters",
        ));
    }
    let result = sqlx::query_as::<_, CreatedComment>("INSERT INTO comments (post_id, author_id, parent_id, body) SELECT $1, $2, $3, $4 WHERE EXISTS (SELECT 1 FROM posts WHERE id = $1) AND ($3::bigint IS NULL OR EXISTS (SELECT 1 FROM comments WHERE id = $3 AND post_id = $1)) RETURNING id, post_id, parent_id, body, (SELECT handle FROM authors WHERE id = $2) AS author").bind(post_id).bind(author_id).bind(input.parent_id).bind(body).fetch_optional(&db).await?;
    Ok((
        StatusCode::CREATED,
        Json(result.ok_or(ApiError::Invalid("Post or parent comment was not found"))?),
    ))
}
async fn vote(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(post_id): Path<i64>,
    Json(input): Json<VoteRequest>,
) -> Result<Json<VoteResponse>, ApiError> {
    let author_id = authenticated_author(&headers, &db).await?;
    if ![-1, 0, 1].contains(&input.value) {
        return Err(ApiError::Invalid("Vote must be -1, 0, or 1"));
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
    Ok(Json(VoteResponse {
        post_id,
        score,
        your_vote: (input.value != 0).then_some(input.value),
    }))
}
async fn communities(State(db): State<PgPool>) -> Result<Json<Vec<Community>>, ApiError> {
    Ok(Json(sqlx::query_as("SELECT c.slug, c.name, c.description, (SELECT count(*) FROM posts p WHERE p.community_id = c.id) AS post_count FROM communities c ORDER BY c.name").fetch_all(&db).await?))
}
async fn community(
    State(db): State<PgPool>,
    Path(slug): Path<String>,
) -> Result<Json<Community>, ApiError> {
    Ok(Json(sqlx::query_as("SELECT c.slug, c.name, c.description, (SELECT count(*) FROM posts p WHERE p.community_id = c.id) AS post_count FROM communities c WHERE c.slug = $1").bind(slug).fetch_optional(&db).await?.ok_or(ApiError::Missing)?))
}
async fn posts(
    State(db): State<PgPool>,
    Query(query): Query<FeedQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let offset = query.validate()?;
    let q = query.q.as_deref().unwrap_or("").trim();
    let order = imports::order(query.sort.as_deref())?;
    let sql = format!(
        "{POST_SELECT} WHERE ($1::text IS NULL OR c.slug = $1) AND ($2 = '' OR p.search_document @@ websearch_to_tsquery('english', $2)) ORDER BY {order}, p.id DESC LIMIT 21 OFFSET $3"
    );
    let mut posts: Vec<Post> = sqlx::query_as(&sql)
        .bind(&query.community)
        .bind(q)
        .bind(offset)
        .fetch_all(&db)
        .await?;
    let has_more = posts.len() > 20;
    posts.truncate(20);
    Ok(Json(
        serde_json::json!({"posts": posts, "has_more": has_more}),
    ))
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
        "{POST_SELECT} JOIN community_subscriptions s ON s.community_id = p.community_id AND s.author_id = $1 WHERE ($2 = '' OR p.search_document @@ websearch_to_tsquery('english', $2)) ORDER BY {order}, p.id DESC LIMIT 21 OFFSET $3"
    );
    let mut posts: Vec<Post> = sqlx::query_as(&sql)
        .bind(author_id)
        .bind(query.q.as_deref().unwrap_or("").trim())
        .bind(offset)
        .fetch_all(&db)
        .await?;
    let has_more = posts.len() > 20;
    posts.truncate(20);
    Ok(Json(
        serde_json::json!({"posts": posts, "has_more": has_more}),
    ))
}
async fn post(
    State(db): State<PgPool>,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let post: Post = sqlx::query_as(&format!("{POST_SELECT} WHERE p.id = $1"))
        .bind(id)
        .fetch_optional(&db)
        .await?
        .ok_or(ApiError::Missing)?;
    // Bounded for the initial reader; expose truncation instead of silently losing replies.
    let mut comments: Vec<Comment> = sqlx::query_as("SELECT cm.id, cm.parent_id, cm.body, a.handle AS author, cm.created_at FROM comments cm JOIN authors a ON a.id = cm.author_id WHERE cm.post_id = $1 ORDER BY cm.id LIMIT 501").bind(id).fetch_all(&db).await?;
    let comments_truncated = comments.len() > 500;
    comments.truncate(500);
    let media: Vec<MediaAsset> = sqlx::query_as("SELECT m.id, m.content_hash, m.media_type, m.byte_size, m.magnet_uri FROM post_media pm JOIN media_assets m ON m.id = pm.media_id WHERE pm.post_id = $1 ORDER BY pm.position, m.id").bind(id).fetch_all(&db).await?;
    Ok(Json(
        serde_json::json!({"post": post, "comments": comments, "comments_truncated": comments_truncated, "media": media}),
    ))
}
async fn export(
    State(db): State<PgPool>,
    Query(query): Query<FeedQuery>,
) -> Result<Json<ExportBundle>, ApiError> {
    query.validate()?;
    let communities: Vec<CommunityExport> = sqlx::query_as("SELECT slug, name, description FROM communities WHERE ($1::text IS NULL OR slug = $1) ORDER BY slug")
        .bind(&query.community).fetch_all(&db).await?;
    let posts: Vec<PostExport> = sqlx::query_as("SELECT p.id, c.slug AS community, a.handle AS author, p.title, p.body, p.created_at FROM posts p JOIN communities c ON c.id = p.community_id JOIN authors a ON a.id = p.author_id WHERE ($1::text IS NULL OR c.slug = $1) ORDER BY p.id LIMIT 10000")
        .bind(&query.community).fetch_all(&db).await?;
    let comments: Vec<CommentExport> = sqlx::query_as("SELECT cm.id, cm.post_id, cm.parent_id, a.handle AS author, cm.body, cm.created_at FROM comments cm JOIN authors a ON a.id = cm.author_id JOIN posts p ON p.id = cm.post_id JOIN communities c ON c.id = p.community_id WHERE ($1::text IS NULL OR c.slug = $1) ORDER BY cm.id LIMIT 50000")
        .bind(&query.community).fetch_all(&db).await?;
    let media: Vec<ExportMedia> = sqlx::query_as("SELECT pm.post_id, pm.media_id, pm.position, m.content_hash, m.media_type, m.byte_size, m.magnet_uri FROM post_media pm JOIN media_assets m ON m.id = pm.media_id JOIN posts p ON p.id = pm.post_id JOIN communities c ON c.id = p.community_id WHERE ($1::text IS NULL OR c.slug = $1) ORDER BY pm.post_id, pm.position LIMIT 50000")
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
        "{POST_SELECT} ORDER BY p.created_at DESC, p.id DESC LIMIT 50"
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
    let db = PgPoolOptions::new()
        .max_connections(5)
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
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);
    let app = Router::new()
        .route("/health", get(health))
        .route("/.well-known/nodeinfo", get(nodeinfo))
        .route("/api/accounts", post_method(signup))
        .route("/api/sessions", post_method(login).delete(logout))
        .route("/api/me", get(me))
        .route("/api/admin/overview", get(admin_overview))
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
        .route("/api/admin/imports", post_method(imports::ingest))
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
        .route("/api/posts/{id}/views", post_method(views::record))
        .route("/api/reports", post_method(report))
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
            20
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
    fn database_error_does_not_expose_details() {
        assert_eq!(
            ApiError::Database(sqlx::Error::RowNotFound)
                .into_response()
                .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}
