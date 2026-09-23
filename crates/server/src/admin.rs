use super::*;

#[derive(Deserialize)]
pub struct CreateCrawlerJob {
    name: String,
    provider: String,
    source: String,
    community: Option<String>,
    interval_seconds: i32,
    max_items: i32,
    mode: Option<String>,
    filters: Option<serde_json::Value>,
}

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
    rows(&db, "SELECT row_to_json(t) FROM (SELECT a.id,a.handle,a.is_admin,a.created_at,a.suspended_until,(a.password_hash IS NOT NULL) AS registered,(SELECT count(*) FROM posts WHERE author_id=a.id AND moderation_status='approved') AS posts,(SELECT count(*) FROM comments WHERE author_id=a.id AND moderation_status='approved') AS comments,(SELECT count(*) FROM sessions WHERE author_id=a.id AND expires_at>now()) AS sessions FROM authors a WHERE strpos(lower(a.handle),lower($1))>0 AND ($2::bigint IS NULL OR a.id<$2) ORDER BY a.id DESC LIMIT 50) t", &f.search()?,f.before).await
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
    Ok(Json(sqlx::query_scalar("SELECT row_to_json(t) FROM (SELECT d::date AS day,(SELECT count(*) FROM authors WHERE password_hash IS NOT NULL AND (created_at AT TIME ZONE 'UTC')::date=d::date) AS users,(SELECT count(*) FROM posts WHERE moderation_status='approved' AND (created_at AT TIME ZONE 'UTC')::date=d::date) AS posts,(SELECT count(*) FROM comments WHERE moderation_status='approved' AND (created_at AT TIME ZONE 'UTC')::date=d::date) AS comments FROM generate_series((now() AT TIME ZONE 'UTC')::date-13,(now() AT TIME ZONE 'UTC')::date,interval '1 day') d ORDER BY d) t").fetch_all(&db).await?))
}

#[derive(FromRow)]
struct ModerationTarget {
    kind: String,
    target_id: i64,
    author_id: i64,
    status: String,
    payload: serde_json::Value,
}

#[derive(Deserialize)]
pub struct ModerationDecision {
    action: String,
    note: Option<String>,
    duration_minutes: Option<i64>,
}

pub async fn moderation(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Query(f): Query<Filter>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_admin(&headers, &db).await?;
    let kind = match f.kind.as_deref().unwrap_or("").trim() {
        "" | "all" => "",
        "posts" | "post" => "post",
        "comments" | "comment" => "comment",
        "profiles" | "profile" => "profile",
        _ => return Err(ApiError::Invalid("Unknown moderation type")),
    };
    Ok(Json(sqlx::query_scalar(
        "SELECT row_to_json(t) FROM (
           SELECT mi.id, mi.kind, mi.target_id, mi.status, mi.severity, mi.flags,
                  mi.rule_version, mi.urgent, mi.created_at, a.handle AS author,
                  CASE WHEN mi.kind = 'profile' THEN '' ELSE COALESCE(p.title, '') END AS title,
                  CASE
                    WHEN mi.kind = 'profile'
                      THEN concat_ws(E'\\n', NULLIF(mi.payload->>'display_name', ''), NULLIF(mi.payload->>'bio', ''))
                    ELSE COALESCE(p.body, cm.body, '')
                  END AS body,
                  c.slug AS community,
                  CASE WHEN mi.kind = 'profile' THEN mi.payload ELSE NULL::jsonb END AS profile
           FROM moderation_items mi
           JOIN authors a ON a.id = mi.author_id
           LEFT JOIN posts p ON mi.kind = 'post' AND p.id = mi.target_id
           LEFT JOIN comments cm ON mi.kind = 'comment' AND cm.id = mi.target_id
           LEFT JOIN communities c ON c.id = p.community_id
           WHERE mi.status IN ('pending', 'escalated')
             AND ($1 = '' OR strpos(lower(
               a.handle || ' ' || COALESCE(p.title, '') || ' ' ||
               COALESCE(p.body, cm.body, '') || ' ' || COALESCE(mi.payload::text, '')
             ), lower($1)) > 0)
             AND ($2 = '' OR mi.kind = $2)
             AND ($3::bigint IS NULL OR mi.id < $3)
           ORDER BY mi.urgent DESC, mi.created_at ASC, mi.id ASC
           LIMIT 50
         ) t",
    )
    .bind(f.search()?)
    .bind(kind)
    .bind(f.before)
    .fetch_all(&db)
    .await?))
}

pub async fn moderation_history(
    State(db): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_admin(&headers, &db).await?;
    Ok(Json(
        sqlx::query_scalar(
            "SELECT row_to_json(t) FROM (
           SELECT ma.id, ma.moderation_item_id, ma.action, ma.from_status, ma.to_status,
                  ma.note, ma.detail, ma.created_at, actor.handle AS actor,
                  mi.kind, subject.handle AS subject
           FROM moderation_actions ma
           JOIN moderation_items mi ON mi.id = ma.moderation_item_id
           JOIN authors actor ON actor.id = ma.actor_id
           JOIN authors subject ON subject.id = mi.author_id
           ORDER BY ma.id DESC
           LIMIT 100
         ) t",
        )
        .fetch_all(&db)
        .await?,
    ))
}

pub async fn decide_moderation(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<ModerationDecision>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let action = input.action.trim().to_ascii_lowercase();
    if !["approve", "reject", "dismiss", "suspend", "escalate"].contains(&action.as_str()) {
        return Err(ApiError::Invalid("Unknown moderation action"));
    }
    let note = input.note.unwrap_or_default().trim().to_owned();
    if note.len() > 1000 {
        return Err(ApiError::Invalid("Moderation note is too long"));
    }
    let duration_minutes = input.duration_minutes.unwrap_or(1440);
    if action == "suspend" && !(1..=43_200).contains(&duration_minutes) {
        return Err(ApiError::Invalid(
            "Suspension duration must be between 1 minute and 30 days",
        ));
    }
    let mut tx = db.begin().await?;
    let item: ModerationTarget = sqlx::query_as(
        "SELECT kind, target_id, author_id, status, payload
         FROM moderation_items
         WHERE id = $1
         FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::Missing)?;
    if !["pending", "escalated"].contains(&item.status.as_str()) {
        return Err(ApiError::Invalid(
            "This moderation item has already been decided",
        ));
    }
    let from_status = item.status.clone();
    let to_status = match action.as_str() {
        "escalate" => "escalated",
        "approve" => "approved",
        "dismiss" => "dismissed",
        "reject" | "suspend" => "rejected",
        _ => unreachable!(),
    };
    let publishes = matches!(action.as_str(), "approve" | "dismiss");
    if action == "escalate" {
        // Escalation keeps the content hidden and asks for urgent human review.
        sqlx::query(
            "UPDATE moderation_items
             SET status = 'escalated', urgent = TRUE, reviewed_by = $2,
                 reviewed_at = now(), review_note = $3
             WHERE id = $1",
        )
        .bind(id)
        .bind(actor)
        .bind(&note)
        .execute(&mut *tx)
        .await?;
    } else {
        if item.kind == "post" {
            sqlx::query(
                "UPDATE posts
                 SET moderation_status = $2, moderation_reviewed_by = $3,
                     moderation_reviewed_at = now()
                 WHERE id = $1",
            )
            .bind(item.target_id)
            .bind(if publishes { "approved" } else { "rejected" })
            .bind(actor)
            .execute(&mut *tx)
            .await?;
        } else if item.kind == "comment" {
            sqlx::query(
                "UPDATE comments
                 SET moderation_status = $2, moderation_reviewed_by = $3,
                     moderation_reviewed_at = now()
                 WHERE id = $1",
            )
            .bind(item.target_id)
            .bind(if publishes { "approved" } else { "rejected" })
            .bind(actor)
            .execute(&mut *tx)
            .await?;
        } else if item.kind == "profile" && publishes {
            let display_name = item
                .payload
                .get("display_name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let bio = item
                .payload
                .get("bio")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let avatar_url = item
                .payload
                .get("avatar_url")
                .and_then(serde_json::Value::as_str);
            sqlx::query(
                "UPDATE authors
                 SET display_name = $2, bio = $3, avatar_url = $4, profile_updated_at = now()
                 WHERE id = $1",
            )
            .bind(item.author_id)
            .bind(display_name)
            .bind(bio)
            .bind(avatar_url)
            .execute(&mut *tx)
            .await?;
        }
        if action == "suspend" {
            let until = Utc::now() + chrono::Duration::minutes(duration_minutes);
            sqlx::query(
                "UPDATE authors
                 SET suspended_until = GREATEST(COALESCE(suspended_until, now()), $2),
                     suspension_reason = $3
                 WHERE id = $1",
            )
            .bind(item.author_id)
            .bind(until)
            .bind(if note.is_empty() {
                "Moderator suspension"
            } else {
                &note
            })
            .execute(&mut *tx)
            .await?;
        }
        sqlx::query(
            "UPDATE moderation_items
             SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4
             WHERE id = $1",
        )
        .bind(id)
        .bind(to_status)
        .bind(actor)
        .bind(&note)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "INSERT INTO moderation_actions(
           moderation_item_id, actor_id, action, from_status, to_status, note, detail
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(id)
    .bind(actor)
    .bind(&action)
    .bind(&from_status)
    .bind(to_status)
    .bind(&note)
    .bind(serde_json::json!({
        "duration_minutes": if action == "suspend" { Some(duration_minutes) } else { None::<i64> },
        "urgent": item.kind == "profile" && item.status == "escalated"
    }))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    log_event(
        &db,
        if action == "escalate" || action == "suspend" {
            "warn"
        } else {
            "info"
        },
        "moderation.action",
        serde_json::json!({
            "moderation_id": id,
            "actor_id": actor,
            "kind": item.kind,
            "action": action,
            "from_status": from_status,
            "to_status": to_status
        }),
    )
    .await;
    Ok(Json(serde_json::json!({
        "id": id,
        "action": action,
        "status": to_status
    })))
}

#[derive(Deserialize)]
pub struct UpdateSettings {
    orchard_enabled: Option<bool>,
}

pub async fn settings(
    State(db): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&headers, &db).await?;
    let orchard_enabled = instance_module_enabled(&db, "orchard").await?;
    Ok(Json(serde_json::json!({
        "modules": {
            "orchard": {
                "enabled": orchard_enabled
            }
        }
    })))
}

pub async fn update_settings(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<UpdateSettings>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let Some(orchard_enabled) = input.orchard_enabled else {
        return Err(ApiError::Invalid(
            "No supported module setting was provided",
        ));
    };
    sqlx::query(
        "INSERT INTO instance_modules(module_key, enabled, updated_by, updated_at)
         VALUES ('orchard', $1, $2, now())
         ON CONFLICT (module_key) DO UPDATE
         SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()",
    )
    .bind(orchard_enabled)
    .bind(actor)
    .execute(&db)
    .await?;
    log_event(
        &db,
        "info",
        "admin.module_toggled",
        serde_json::json!({"actor_id": actor, "module": "orchard", "enabled": orchard_enabled}),
    )
    .await;
    Ok(Json(serde_json::json!({
        "modules": {
            "orchard": {
                "enabled": orchard_enabled
            }
        }
    })))
}

#[derive(Deserialize)]
pub struct BlockIp {
    ip: String,
    reason: Option<String>,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
}
pub async fn security(
    State(db): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&headers, &db).await?;
    let blocks: Vec<serde_json::Value> = sqlx::query_scalar("SELECT row_to_json(t) FROM (SELECT id,label,reason,expires_at,created_at FROM ip_blocks WHERE expires_at IS NULL OR expires_at>now() ORDER BY created_at DESC) t").fetch_all(&db).await?;
    let activity: Vec<serde_json::Value> = sqlx::query_scalar("SELECT row_to_json(t) FROM (SELECT ip_hash, count(*)::bigint AS requests, count(*) FILTER (WHERE status>=400)::bigint AS errors, max(created_at) AS last_seen FROM ip_activity WHERE created_at>now()-interval '24 hours' GROUP BY ip_hash ORDER BY requests DESC LIMIT 100) t").fetch_all(&db).await?;
    Ok(Json(
        serde_json::json!({"proxy_trust_enabled":std::env::var("TRUST_PROXY").ok().as_deref()==Some("true"),"blocks":blocks,"activity":activity}),
    ))
}
pub async fn block_ip(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<BlockIp>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let ip: std::net::IpAddr = input
        .ip
        .trim()
        .parse()
        .map_err(|_| ApiError::Invalid("Enter a valid IPv4 or IPv6 address"))?;
    let hash = super::operations::hash_ip(ip);
    let reason = input.reason.unwrap_or_default();
    if reason.len() > 500 {
        return Err(ApiError::Invalid("Reason is too long"));
    }
    let row = sqlx::query_scalar::<_,serde_json::Value>("INSERT INTO ip_blocks(ip_hash,label,reason,expires_at,created_by) VALUES($1,'manual',$2,$3,$4) ON CONFLICT(ip_hash) DO UPDATE SET reason=EXCLUDED.reason,expires_at=EXCLUDED.expires_at,label=EXCLUDED.label RETURNING row_to_json(ip_blocks.*)").bind(&hash).bind(reason.trim()).bind(input.expires_at).bind(actor).fetch_one(&db).await?;
    log_event(
        &db,
        "warn",
        "admin.ip_blocked",
        serde_json::json!({"actor_id":actor,"ip_hash":hash}),
    )
    .await;
    Ok(Json(row))
}
pub async fn unblock_ip(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let n = sqlx::query("DELETE FROM ip_blocks WHERE id=$1")
        .bind(id)
        .execute(&db)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(ApiError::Missing);
    }
    log_event(
        &db,
        "info",
        "admin.ip_unblocked",
        serde_json::json!({"actor_id":actor,"block_id":id}),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn crawler_jobs(
    State(db): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_admin(&headers, &db).await?;
    Ok(Json(sqlx::query_scalar("SELECT row_to_json(t) FROM (SELECT j.id,j.name,j.provider,j.source,c.slug AS community,j.interval_seconds,j.max_items,j.mode,j.filters,j.enabled,j.next_run_at,j.last_run_at,j.last_status,j.last_error,j.created_at,j.updated_at,(SELECT count(*) FROM crawler_runs r WHERE r.job_id=j.id) AS runs,(SELECT row_to_json(r) FROM (SELECT id,status,started_at,finished_at,imported_count,error FROM crawler_runs WHERE job_id=j.id ORDER BY id DESC LIMIT 1) r) AS latest_run FROM crawler_jobs j LEFT JOIN communities c ON c.id=j.community_id ORDER BY j.enabled DESC,j.id DESC) t").fetch_all(&db).await?))
}

pub async fn create_crawler_job(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<CreateCrawlerJob>,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let name = input.name.trim();
    let provider = input.provider.trim().to_ascii_lowercase();
    let source = input.source.trim();
    let mode = input.mode.as_deref().unwrap_or("review");
    if name.is_empty() || name.len() > 80 || source.is_empty() || source.len() > 2048 {
        return Err(ApiError::Invalid(
            "Job name or source is outside the allowed length",
        ));
    }
    if !["x", "reddit", "rss", "commons"].contains(&provider.as_str()) {
        return Err(ApiError::Invalid("Unknown crawler provider"));
    }
    if !(300..=604800).contains(&input.interval_seconds) || !(1..=100).contains(&input.max_items) {
        return Err(ApiError::Invalid(
            "Interval must be 5 minutes to 7 days and max items 1-100",
        ));
    }
    if !["review", "automatic"].contains(&mode) {
        return Err(ApiError::Invalid("Unknown moderation mode"));
    }
    let community_id: Option<i64> = match input
        .community
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(slug) => sqlx::query_scalar("SELECT id FROM communities WHERE slug=$1")
            .bind(slug)
            .fetch_optional(&db)
            .await?
            .or(Some(-1)),
        None => None,
    };
    if community_id == Some(-1) {
        return Err(ApiError::Invalid("Community not found"));
    }
    let row = sqlx::query_scalar::<_, serde_json::Value>("INSERT INTO crawler_jobs(name,provider,source,community_id,interval_seconds,max_items,mode,filters) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING row_to_json(crawler_jobs.*)")
        .bind(name).bind(&provider).bind(source).bind(community_id).bind(input.interval_seconds).bind(input.max_items).bind(mode).bind(input.filters.unwrap_or_else(|| serde_json::json!({}))).fetch_one(&db).await.map_err(|e| if matches!(&e, sqlx::Error::Database(d) if d.constraint()==Some("crawler_jobs_name_key")) { ApiError::Invalid("A job with that name already exists") } else { ApiError::Database(e) })?;
    log_event(
        &db,
        "info",
        "admin.crawler_job_created",
        serde_json::json!({"actor_id":actor,"name":name,"provider":provider}),
    )
    .await;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn toggle_crawler_job(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let n = sqlx::query("UPDATE crawler_jobs SET enabled=NOT enabled,updated_at=now() WHERE id=$1")
        .bind(id)
        .execute(&db)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(ApiError::Missing);
    }
    log_event(
        &db,
        "info",
        "admin.crawler_job_toggled",
        serde_json::json!({"actor_id":actor,"job_id":id}),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn run_crawler_job_now(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let n = sqlx::query("UPDATE crawler_jobs SET enabled=TRUE,next_run_at=now(),last_error=NULL,updated_at=now() WHERE id=$1").bind(id).execute(&db).await?.rows_affected();
    if n == 0 {
        return Err(ApiError::Missing);
    }
    log_event(
        &db,
        "info",
        "admin.crawler_job_run_requested",
        serde_json::json!({"actor_id":actor,"job_id":id}),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, Default)]
pub struct RunFilter {
    pub job_id: Option<i64>,
}

pub async fn crawler_runs(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Query(f): Query<RunFilter>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_admin(&headers, &db).await?;
    Ok(Json(sqlx::query_scalar("SELECT row_to_json(t) FROM (SELECT r.id,r.job_id,j.name,r.started_at,r.finished_at,r.status,r.imported_count,r.error,r.detail FROM crawler_runs r JOIN crawler_jobs j ON j.id=r.job_id WHERE ($1::bigint IS NULL OR r.job_id=$1) ORDER BY r.id DESC LIMIT 100) t").bind(f.job_id).fetch_all(&db).await?))
}

pub async fn delete_crawler_job(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let n = sqlx::query("DELETE FROM crawler_jobs WHERE id=$1")
        .bind(id)
        .execute(&db)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(ApiError::Missing);
    }
    log_event(
        &db,
        "info",
        "admin.crawler_job_deleted",
        serde_json::json!({"actor_id":actor,"job_id":id}),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct CompleteCrawlerRun {
    pub status: String,
    pub imported_count: Option<i32>,
    pub error: Option<String>,
    pub detail: Option<serde_json::Value>,
}

pub async fn claim_crawler_job(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&headers, &db).await?;
    let mut tx = db.begin().await?;
    type ClaimedJob = (
        i64,
        String,
        String,
        String,
        Option<String>,
        i32,
        i32,
        String,
    );
    let job: Option<ClaimedJob> = sqlx::query_as("SELECT j.id,j.name,j.provider,j.source,(SELECT slug FROM communities WHERE id=j.community_id),j.interval_seconds,j.max_items,j.mode FROM crawler_jobs j WHERE j.id=$1 AND j.enabled AND j.next_run_at<=now() FOR UPDATE SKIP LOCKED")
        .bind(id).fetch_optional(&mut *tx).await?;
    let Some((id, name, provider, source, community, interval_seconds, max_items, mode)) = job
    else {
        return Err(ApiError::Invalid(
            "Job is disabled, not due, or already running",
        ));
    };
    let run_id: i64 = sqlx::query_scalar(
        "INSERT INTO crawler_runs(job_id,status) VALUES($1,'running') RETURNING id",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("UPDATE crawler_jobs SET last_run_at=now(),last_status='running',last_error=NULL,next_run_at=now() + make_interval(secs => interval_seconds),updated_at=now() WHERE id=$1").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        serde_json::json!({"run_id":run_id,"id":id,"name":name,"provider":provider,"source":source,"community":community,"interval_seconds":interval_seconds,"max_items":max_items,"mode":mode}),
    ))
}

pub async fn complete_crawler_job(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(run_id): Path<i64>,
    Json(input): Json<CompleteCrawlerRun>,
) -> Result<StatusCode, ApiError> {
    require_admin(&headers, &db).await?;
    if !["success", "failed", "skipped"].contains(&input.status.as_str()) {
        return Err(ApiError::Invalid("Unknown crawler run status"));
    }
    let n = sqlx::query("UPDATE crawler_runs SET finished_at=now(),status=$2,imported_count=COALESCE($3,0),error=$4,detail=COALESCE($5,'{}'::jsonb) WHERE id=$1")
        .bind(run_id).bind(&input.status).bind(input.imported_count).bind(&input.error).bind(input.detail.unwrap_or_else(||serde_json::json!({}))).execute(&db).await?.rows_affected();
    if n == 0 {
        return Err(ApiError::Missing);
    }
    sqlx::query("UPDATE crawler_jobs SET last_status=$2,last_error=$3,updated_at=now() WHERE id=(SELECT job_id FROM crawler_runs WHERE id=$1)").bind(run_id).bind(&input.status).bind(&input.error).execute(&db).await?;
    Ok(StatusCode::NO_CONTENT)
}
