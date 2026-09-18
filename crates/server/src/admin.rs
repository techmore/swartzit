use super::*;

#[derive(Deserialize, Default)]
pub struct Filter {
    q: Option<String>,
    before: Option<i64>,
    level: Option<String>,
    kind: Option<String>,
}
impl Filter {
    fn search(&self) -> Result<String, ApiError> {
        let q = self.q.as_deref().unwrap_or("").trim();
        if q.len() > 200 {
            return Err(ApiError::Invalid("Search is limited to 200 bytes"));
        }
        Ok(q.to_owned())
    }
}
async fn rows(
    db: &PgPool,
    sql: &str,
    q: &str,
    before: Option<i64>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    Ok(Json(
        sqlx::query_scalar(sql)
            .bind(q)
            .bind(before)
            .fetch_all(db)
            .await?,
    ))
}
pub async fn users(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Query(f): Query<Filter>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_admin(&headers, &db).await?;
    rows(&db, "SELECT row_to_json(t) FROM (SELECT a.id,a.handle,a.is_admin,a.created_at,(a.password_hash IS NOT NULL) AS registered,(SELECT count(*) FROM posts WHERE author_id=a.id) AS posts,(SELECT count(*) FROM comments WHERE author_id=a.id) AS comments,(SELECT count(*) FROM sessions WHERE author_id=a.id AND expires_at>now()) AS sessions FROM authors a WHERE strpos(lower(a.handle),lower($1))>0 AND ($2::bigint IS NULL OR a.id<$2) ORDER BY a.id DESC LIMIT 50) t", &f.search()?,f.before).await
}
pub async fn revoke(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    if actor == id {
        return Err(ApiError::Invalid("Use Sign out to end your own session"));
    }
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM authors WHERE id=$1)")
        .bind(id)
        .fetch_one(&db)
        .await?;
    if !exists {
        return Err(ApiError::Missing);
    }
    let count = sqlx::query("DELETE FROM sessions WHERE author_id=$1")
        .bind(id)
        .execute(&db)
        .await?
        .rows_affected();
    log_event(
        &db,
        "info",
        "admin.sessions_revoked",
        serde_json::json!({"actor_id":actor,"user_id":id,"sessions":count}),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn content(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Query(f): Query<Filter>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_admin(&headers, &db).await?;
    let sql = match f.kind.as_deref().unwrap_or("posts") {
        "posts" => {
            "SELECT row_to_json(t) FROM (SELECT p.id,p.view_count,p.engaged_view_count,p.deep_view_count,p.title,p.body,p.created_at,a.handle AS author,c.slug AS community,(SELECT count(*) FROM comments WHERE post_id=p.id) AS comments FROM posts p JOIN authors a ON a.id=p.author_id JOIN communities c ON c.id=p.community_id WHERE strpos(lower(p.title || ' ' || p.body),lower($1))>0 AND ($2::bigint IS NULL OR p.id<$2) ORDER BY p.id DESC LIMIT 50) t"
        }
        "comments" => {
            "SELECT row_to_json(t) FROM (SELECT c.id,c.post_id,c.body,c.created_at,a.handle AS author FROM comments c JOIN authors a ON a.id=c.author_id WHERE strpos(lower(c.body),lower($1))>0 AND ($2::bigint IS NULL OR c.id<$2) ORDER BY c.id DESC LIMIT 50) t"
        }
        "communities" => {
            "SELECT row_to_json(t) FROM (SELECT c.id,c.slug,c.name,c.description,(SELECT count(*) FROM posts WHERE community_id=c.id) AS posts FROM communities c WHERE strpos(lower(c.slug || ' ' || c.name),lower($1))>0 AND ($2::bigint IS NULL OR c.id<$2) ORDER BY c.id DESC LIMIT 50) t"
        }
        _ => return Err(ApiError::Invalid("Unknown content type")),
    };
    rows(&db, sql, &f.search()?, f.before).await
}
pub async fn reports(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Query(f): Query<Filter>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_admin(&headers, &db).await?;
    rows(&db,"SELECT row_to_json(t) FROM (SELECT r.id,r.reason,r.post_id,r.comment_id,COALESCE(r.post_id,c.post_id) AS discussion_id,r.created_at,r.resolved_at,a.handle AS reporter FROM reports r JOIN authors a ON a.id=r.reporter_id LEFT JOIN comments c ON c.id=r.comment_id WHERE strpos(lower(r.reason),lower($1))>0 AND ($2::bigint IS NULL OR r.id<$2) ORDER BY r.id DESC LIMIT 50) t",&f.search()?,f.before).await
}
pub async fn resolve(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let n = sqlx::query(
        "UPDATE reports SET resolved_at=now(),resolved_by=$2 WHERE id=$1 AND resolved_at IS NULL",
    )
    .bind(id)
    .bind(actor)
    .execute(&db)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(ApiError::Invalid("Report is absent or already resolved"));
    }
    log_event(
        &db,
        "info",
        "admin.report_resolved",
        serde_json::json!({"actor_id":actor,"report_id":id}),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn logs(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Query(f): Query<Filter>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_admin(&headers, &db).await?;
    let level = f.level.as_deref().unwrap_or("");
    if !["", "info", "warn", "error"].contains(&level) {
        return Err(ApiError::Invalid("Unknown log level"));
    }
    Ok(Json(sqlx::query_scalar("SELECT row_to_json(t) FROM (SELECT id,level,event,detail,created_at FROM system_logs WHERE ($1='' OR level=$1) AND strpos(lower(event || ' ' || detail::text),lower($2))>0 AND ($3::bigint IS NULL OR id<$3) ORDER BY id DESC LIMIT 100) t").bind(level).bind(f.search()?).bind(f.before).fetch_all(&db).await?))
}
pub async fn analytics(
    State(db): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_admin(&headers, &db).await?;
    Ok(Json(sqlx::query_scalar("SELECT row_to_json(t) FROM (SELECT d::date AS day,(SELECT count(*) FROM authors WHERE password_hash IS NOT NULL AND (created_at AT TIME ZONE 'UTC')::date=d::date) AS users,(SELECT count(*) FROM posts WHERE (created_at AT TIME ZONE 'UTC')::date=d::date) AS posts,(SELECT count(*) FROM comments WHERE (created_at AT TIME ZONE 'UTC')::date=d::date) AS comments FROM generate_series((now() AT TIME ZONE 'UTC')::date-13,(now() AT TIME ZONE 'UTC')::date,interval '1 day') d ORDER BY d) t").fetch_all(&db).await?))
}
