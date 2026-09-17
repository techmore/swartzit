use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
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
}
#[derive(Serialize, FromRow)]
struct Comment {
    id: i64,
    parent_id: Option<i64>,
    body: String,
    author: String,
    created_at: DateTime<Utc>,
}
#[derive(Deserialize, Default)]
struct FeedQuery {
    community: Option<String>,
    q: Option<String>,
    page: Option<i64>,
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
const POST_SELECT: &str = "SELECT p.id, p.title, p.body, p.created_at, a.handle AS author, c.slug AS community, c.name AS community_name, (SELECT count(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count FROM posts p JOIN authors a ON a.id = p.author_id JOIN communities c ON c.id = p.community_id";
async fn health(State(db): State<PgPool>) -> Result<Json<serde_json::Value>, ApiError> {
    sqlx::query("SELECT 1").execute(&db).await?;
    Ok(Json(serde_json::json!({"status":"ok"})))
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
        .route("/api/communities", get(communities))
        .route("/api/communities/{slug}", get(community))
        .route("/api/posts", get(posts))
        .route("/api/posts/{id}", get(post))
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
