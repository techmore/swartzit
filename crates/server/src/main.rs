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

#[derive(Debug)]
enum ApiError {
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
#[derive(Deserialize, Default)]
struct FeedQuery {
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
const POST_SELECT: &str = "SELECT p.id, p.title, p.body, p.created_at, a.handle AS author, c.slug AS community, c.name AS community_name, (SELECT count(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count, (SELECT COALESCE(sum(value), 0)::bigint FROM post_votes v WHERE v.post_id = p.id) AS score FROM posts p JOIN authors a ON a.id = p.author_id JOIN communities c ON c.id = p.community_id";
async fn health(State(db): State<PgPool>) -> Result<Json<serde_json::Value>, ApiError> {
    sqlx::query("SELECT 1").execute(&db).await?;
    Ok(Json(serde_json::json!({"status":"ok"})))
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
    Ok((StatusCode::CREATED, Json(SignupResponse { handle })))
}
async fn login(
    State(db): State<PgPool>,
    Json(input): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let handle = input.handle.trim().to_ascii_lowercase();
    let hash: Option<(i64, String)> =
        sqlx::query_as("SELECT id, password_hash FROM authors WHERE handle = $1")
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
    let sql = format!(
        "{POST_SELECT} WHERE ($1::text IS NULL OR c.slug = $1) AND ($2 = '' OR p.search_document @@ websearch_to_tsquery('english', $2)) ORDER BY p.created_at DESC, p.id DESC LIMIT 21 OFFSET $3"
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
    Ok(Json(
        serde_json::json!({"post": post, "comments": comments, "comments_truncated": comments_truncated}),
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
    Ok(Json(ExportBundle {
        format: "swartzit-public-v1",
        exported_at: Utc::now(),
        communities,
        posts,
        comments,
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
        .route("/api/accounts", post_method(signup))
        .route("/api/sessions", post_method(login))
        .route("/api/posts", post_method(create_post).get(posts))
        .route("/api/communities", get(communities))
        .route("/api/communities/{slug}", get(community))
        .route("/api/posts/{id}", get(post))
        .route("/api/posts/{id}/comments", post_method(create_comment))
        .route("/api/posts/{id}/vote", post_method(vote))
        .route("/api/export", get(export))
        .route("/feed.xml", get(feed))
        .layer(cors)
        .with_state(db);
    let bind = std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, "Swartzit API listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}
async fn seed(db: &PgPool) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    // Serialize seed runs and refuse to mix fixtures with existing communities.
    sqlx::query("LOCK TABLE communities IN EXCLUSIVE MODE")
        .execute(&mut *tx)
        .await?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM communities")
        .fetch_one(&mut *tx)
        .await?;
    if count > 0 {
        tracing::info!("Seed skipped: communities already exist");
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
