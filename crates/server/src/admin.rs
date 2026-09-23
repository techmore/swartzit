use super::*;
use axum::body::Bytes;

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

#[derive(Deserialize)]
pub struct CreateContentRunner {
    name: String,
    kind: String,
    command: Option<serde_json::Value>,
    prompt: Option<String>,
    author: String,
    community: String,
    interval_seconds: i32,
    days_of_week: Option<serde_json::Value>,
    priority: Option<i32>,
    timeout_seconds: Option<i32>,
    max_attempts: Option<i32>,
    retry_backoff_seconds: Option<i32>,
    failure_threshold: Option<i32>,
    retention_days: Option<i32>,
    environment_keys: Option<serde_json::Value>,
    capture_output: Option<bool>,
    max_log_bytes: Option<i32>,
}

#[derive(Deserialize, Default)]
pub struct UpdateContentRunner {
    name: Option<String>,
    kind: Option<String>,
    command: Option<serde_json::Value>,
    prompt: Option<String>,
    author: Option<String>,
    community: Option<String>,
    interval_seconds: Option<i32>,
    days_of_week: Option<serde_json::Value>,
    priority: Option<i32>,
    timeout_seconds: Option<i32>,
    max_attempts: Option<i32>,
    retry_backoff_seconds: Option<i32>,
    failure_threshold: Option<i32>,
    retention_days: Option<i32>,
    environment_keys: Option<serde_json::Value>,
    capture_output: Option<bool>,
    max_log_bytes: Option<i32>,
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
           WHERE mi.kind <> 'profile'
             AND mi.status IN ('pending', 'escalated')
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
    content_runners_enabled: Option<bool>,
    moderation_enabled: Option<bool>,
    media_primary: Option<String>,
    media_secondary: Option<String>,
    media_cache_enabled: Option<bool>,
    media_cache_max_bytes: Option<i64>,
    media_share: Option<String>,
}

pub async fn settings(
    State(db): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&headers, &db).await?;
    let orchard_enabled = instance_module_enabled(&db, "orchard").await?;
    let content_runners_enabled = instance_module_enabled(&db, "content_runners").await?;
    let moderation_enabled = instance_module_enabled(&db, "moderation").await?;
    let media = media_store::settings_view(&db)
        .await
        .map_err(ApiError::Storage)?;
    Ok(Json(serde_json::json!({
        "modules": {
            "orchard": {
                "enabled": orchard_enabled
            },
            "content_runners": {
                "enabled": content_runners_enabled
            },
            "moderation": {
                "enabled": moderation_enabled
            }
        },
        "media": media
    })))
}

pub async fn storage(
    State(db): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<media_store::StorageOverview>, ApiError> {
    require_admin(&headers, &db).await?;
    Ok(Json(
        media_store::storage_overview(&db)
            .await
            .map_err(ApiError::Storage)?,
    ))
}

pub async fn update_settings(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<UpdateSettings>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    if input.orchard_enabled.is_none()
        && input.content_runners_enabled.is_none()
        && input.moderation_enabled.is_none()
        && input.media_primary.is_none()
        && input.media_secondary.is_none()
        && input.media_cache_enabled.is_none()
        && input.media_cache_max_bytes.is_none()
        && input.media_share.is_none()
    {
        return Err(ApiError::Invalid("No supported setting was provided"));
    }
    if let Some(orchard_enabled) = input.orchard_enabled {
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
    }
    if let Some(enabled) = input.content_runners_enabled {
        sqlx::query(
            "INSERT INTO instance_modules(module_key, enabled, updated_by, updated_at)
             VALUES ('content_runners', $1, $2, now())
             ON CONFLICT (module_key) DO UPDATE SET enabled=EXCLUDED.enabled, updated_by=EXCLUDED.updated_by, updated_at=now()",
        ).bind(enabled).bind(actor).execute(&db).await?;
        log_event(
            &db,
            "info",
            "admin.module_toggled",
            serde_json::json!({"actor_id": actor, "module": "content_runners", "enabled": enabled}),
        )
        .await;
    }
    if let Some(enabled) = input.moderation_enabled {
        sqlx::query(
            "INSERT INTO instance_modules(module_key, enabled, updated_by, updated_at)
             VALUES ('moderation', $1, $2, now())
             ON CONFLICT (module_key) DO UPDATE SET enabled=EXCLUDED.enabled, updated_by=EXCLUDED.updated_by, updated_at=now()",
        )
        .bind(enabled)
        .bind(actor)
        .execute(&db)
        .await?;
        log_event(
            &db,
            "info",
            "admin.module_toggled",
            serde_json::json!({"actor_id": actor, "module": "moderation", "enabled": enabled}),
        )
        .await;
    }
    if let Some(primary) = input.media_primary.as_deref()
        && !["filesystem", "s3", "ipfs"].contains(&primary)
    {
        return Err(ApiError::Invalid(
            "Media primary must be filesystem, s3, or ipfs",
        ));
    }
    if let Some(secondary) = input.media_secondary.as_deref()
        && !["disabled", "filesystem", "s3", "ipfs"].contains(&secondary)
    {
        return Err(ApiError::Invalid(
            "Media secondary must be disabled, filesystem, s3, or ipfs",
        ));
    }
    if let Some(share) = input.media_share.as_deref()
        && !["disabled", "catbox"].contains(&share)
    {
        return Err(ApiError::Invalid(
            "Media sharing must be disabled or catbox",
        ));
    }
    if let Some(max_bytes) = input.media_cache_max_bytes
        && !(1_048_576..=1_099_511_627_776).contains(&max_bytes)
    {
        return Err(ApiError::Invalid(
            "Media cache size must be between 1 MiB and 1 TiB",
        ));
    }
    if input.media_primary.is_some() || input.media_secondary.is_some() {
        let current = media_store::load_config(&db)
            .await
            .map_err(ApiError::Storage)?;
        let mut candidate = current;
        if let Some(primary) = input.media_primary.as_deref() {
            if candidate.primary_source == "environment" && candidate.primary_provider != primary {
                return Err(ApiError::Invalid(
                    "SWARTZIT_MEDIA_PRIMARY is set in the environment; change that override first",
                ));
            }
            candidate.primary_provider = primary.to_owned();
        }
        if let Some(secondary) = input.media_secondary.as_deref() {
            if candidate.secondary_source == "environment"
                && candidate.secondary_provider != secondary
            {
                return Err(ApiError::Invalid(
                    "SWARTZIT_MEDIA_SECONDARY is set in the environment; change that override first",
                ));
            }
            candidate.secondary_provider = secondary.to_owned();
        }
        if candidate.secondary_provider != "disabled"
            && candidate.secondary_provider == candidate.primary_provider
        {
            return Err(ApiError::Invalid(
                "Media secondary must differ from the primary provider",
            ));
        }
        media_store::test_configured(&candidate)
            .await
            .map_err(ApiError::Storage)?;
    }
    if input.media_primary.is_some()
        || input.media_secondary.is_some()
        || input.media_cache_enabled.is_some()
        || input.media_cache_max_bytes.is_some()
        || input.media_share.is_some()
    {
        sqlx::query(
            "UPDATE media_settings
             SET primary_provider = COALESCE($1, primary_provider),
                 secondary_provider = COALESCE($2, secondary_provider),
                 cache_enabled = COALESCE($3, cache_enabled),
                 cache_max_bytes = COALESCE($4, cache_max_bytes),
                 share_provider = COALESCE($5, share_provider),
                 updated_by = $6,
                 updated_at = now()
             WHERE singleton = TRUE",
        )
        .bind(input.media_primary.as_deref())
        .bind(input.media_secondary.as_deref())
        .bind(input.media_cache_enabled)
        .bind(input.media_cache_max_bytes)
        .bind(input.media_share.as_deref())
        .bind(actor)
        .execute(&db)
        .await?;
        log_event(
            &db,
            "info",
            "admin.media_settings_updated",
            serde_json::json!({
                "actor_id": actor,
                "primary": input.media_primary,
                "secondary": input.media_secondary,
                "cache_enabled": input.media_cache_enabled,
                "cache_max_bytes": input.media_cache_max_bytes,
                "share": input.media_share
            }),
        )
        .await;
    }
    let orchard_enabled = instance_module_enabled(&db, "orchard").await?;
    let content_runners_enabled = instance_module_enabled(&db, "content_runners").await?;
    let moderation_enabled = instance_module_enabled(&db, "moderation").await?;
    let media = media_store::settings_view(&db)
        .await
        .map_err(ApiError::Storage)?;
    Ok(Json(serde_json::json!({
        "modules": {
            "orchard": {
                "enabled": orchard_enabled
            },
            "content_runners": {
                "enabled": content_runners_enabled
            },
            "moderation": {
                "enabled": moderation_enabled
            }
        },
        "media": media
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
    let access: Vec<serde_json::Value> = sqlx::query_scalar("SELECT row_to_json(t) FROM (SELECT id,ip_hash,route,method,status,created_at FROM ip_activity ORDER BY id DESC LIMIT 100) t").fetch_all(&db).await?;
    Ok(Json(
        serde_json::json!({"proxy_trust_enabled":super::operations::proxy_trust_enabled(),"blocks":blocks,"activity":activity,"access":access}),
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

fn validate_runner_command(command: &serde_json::Value) -> Result<(), ApiError> {
    let Some(args) = command.as_array() else {
        return Err(ApiError::Invalid("Command must be an argv array"));
    };
    if args.is_empty()
        || args.len() > 32
        || args.iter().any(|value| {
            value.as_str().is_none() || value.as_str().is_some_and(|value| value.len() > 4096)
        })
    {
        return Err(ApiError::Invalid(
            "Command must contain 1-32 strings of at most 4096 bytes",
        ));
    }
    Ok(())
}

fn validate_draw_things_config(command: &serde_json::Value) -> Result<(), ApiError> {
    let Some(config) = command.as_object() else {
        return Err(ApiError::Invalid(
            "Draw Things configuration must be an object",
        ));
    };
    let string_field = |key: &str, required: bool| -> Result<(), ApiError> {
        match config.get(key) {
            Some(value)
                if value.as_str().is_some_and(|value| {
                    !value.trim().is_empty() && value.len() <= 4096 && !value.contains('\0')
                }) =>
            {
                Ok(())
            }
            Some(_) => Err(ApiError::Invalid("Draw Things text setting is invalid")),
            None if required => Err(ApiError::Invalid(
                "Draw Things is missing a required setting",
            )),
            None => Ok(()),
        }
    };
    string_field("executable", true)?;
    string_field("model", true)?;
    string_field("models_dir", false)?;
    string_field("output_path", false)?;
    string_field("title_prefix", false)?;
    let bounded_u64 = |key: &str, min: u64, max: u64| -> Result<(), ApiError> {
        if let Some(value) = config.get(key)
            && value
                .as_u64()
                .is_none_or(|value| !(min..=max).contains(&value))
        {
            return Err(ApiError::Invalid("Draw Things numeric setting is invalid"));
        }
        Ok(())
    };
    bounded_u64("width", 64, 4096)?;
    bounded_u64("height", 64, 4096)?;
    bounded_u64("steps", 1, 200)?;
    bounded_u64("posts_per_run", 1, 8)?;
    if let Some(value) = config.get("cfg")
        && value
            .as_f64()
            .is_none_or(|value| !value.is_finite() || !(0.0..=50.0).contains(&value))
    {
        return Err(ApiError::Invalid("Draw Things CFG setting is invalid"));
    }
    if let Some(value) = config.get("seed")
        && !(value.is_null() || value.as_i64().is_some_and(|seed| seed >= 0))
    {
        return Err(ApiError::Invalid("Draw Things seed setting is invalid"));
    }
    if let Some(loras) = config.get("loras") {
        let Some(loras) = loras.as_array() else {
            return Err(ApiError::Invalid("Draw Things LoRAs must be an array"));
        };
        if loras.len() > 16 {
            return Err(ApiError::Invalid("Draw Things supports at most 16 LoRAs"));
        }
        for lora in loras {
            let Some(lora) = lora.as_object() else {
                return Err(ApiError::Invalid("Each Draw Things LoRA must be an object"));
            };
            if lora
                .get("file")
                .and_then(serde_json::Value::as_str)
                .is_none_or(|file| {
                    file.trim().is_empty() || file.len() > 4096 || file.contains('\0')
                })
            {
                return Err(ApiError::Invalid("Each Draw Things LoRA needs a file"));
            }
            if lora
                .get("version")
                .and_then(serde_json::Value::as_str)
                .is_none_or(|version| version.trim().is_empty() || version.len() > 64)
            {
                return Err(ApiError::Invalid("Each Draw Things LoRA needs a version"));
            }
            if lora
                .get("weight")
                .and_then(serde_json::Value::as_f64)
                .is_none_or(|weight| !weight.is_finite() || !(-5.0..=5.0).contains(&weight))
            {
                return Err(ApiError::Invalid(
                    "Each Draw Things LoRA needs a valid weight",
                ));
            }
        }
    }
    Ok(())
}

fn validate_runner_definition(kind: &str, command: &serde_json::Value) -> Result<(), ApiError> {
    match kind {
        "draw_things" => validate_draw_things_config(command),
        "command" | "cross_post" => validate_runner_command(command),
        _ => Err(ApiError::Invalid("Invalid runner type")),
    }
}

fn validate_days_of_week(days: &serde_json::Value) -> Result<(), ApiError> {
    let Some(days) = days.as_array() else {
        return Err(ApiError::Invalid("Runner days must be an array"));
    };
    if days.is_empty() || days.len() > 7 {
        return Err(ApiError::Invalid("Choose at least one runner day"));
    }
    let mut seen = [false; 8];
    for day in days {
        let Some(day) = day.as_u64().filter(|day| (1..=7).contains(day)) else {
            return Err(ApiError::Invalid("Runner days must use ISO weekdays 1-7"));
        };
        if seen[day as usize] {
            return Err(ApiError::Invalid("Runner days cannot repeat"));
        }
        seen[day as usize] = true;
    }
    Ok(())
}

#[derive(FromRow)]
struct ExistingContentRunner {
    name: String,
    kind: String,
    command: serde_json::Value,
    prompt: String,
    author: String,
    interval_seconds: i32,
    days_of_week: serde_json::Value,
    priority: i32,
    timeout_seconds: i32,
    max_attempts: i32,
    retry_backoff_seconds: i32,
    failure_threshold: i32,
    retention_days: i32,
    environment_keys: serde_json::Value,
    capture_output: bool,
    max_log_bytes: i32,
}

fn validate_runner_policy(
    interval_seconds: i32,
    priority: i32,
    timeout_seconds: i32,
    attempts: i32,
    backoff: i32,
    threshold: i32,
    retention: i32,
) -> Result<(), ApiError> {
    if !(300..=604800).contains(&interval_seconds)
        || !(0..=10000).contains(&priority)
        || !(30..=86400).contains(&timeout_seconds)
        || !(1..=10).contains(&attempts)
        || !(10..=86400).contains(&backoff)
        || !(1..=100).contains(&threshold)
        || !(1..=3650).contains(&retention)
    {
        return Err(ApiError::Invalid(
            "Runner policy is outside its allowed range",
        ));
    }
    Ok(())
}

fn validate_environment_keys(keys: &serde_json::Value) -> Result<(), ApiError> {
    let Some(keys) = keys.as_array() else {
        return Err(ApiError::Invalid("Environment keys must be an array"));
    };
    if keys.len() > 32
        || keys.iter().any(|key| {
            key.as_str().is_none()
                || key.as_str().is_some_and(|key| {
                    key.is_empty()
                        || key.len() > 128
                        || !key.bytes().enumerate().all(|(index, byte)| {
                            byte == b'_'
                                || byte.is_ascii_uppercase()
                                || (index > 0 && byte.is_ascii_digit())
                        })
                })
        })
    {
        return Err(ApiError::Invalid(
            "Environment keys must be up to 32 POSIX-style names",
        ));
    }
    Ok(())
}

const RUNNER_SELECT: &str = "SELECT row_to_json(t) FROM (SELECT r.id,r.name,r.kind,r.command,r.prompt,a.handle AS author,c.slug AS community,r.interval_seconds,r.days_of_week,r.priority,r.enabled,r.state,r.test_requested,r.timeout_seconds,r.max_attempts,r.retry_backoff_seconds,r.failure_threshold,r.consecutive_failures,r.current_attempt,r.retention_days,r.environment_keys,r.capture_output,r.max_log_bytes,r.paused_reason,r.archived_at,r.last_success_at,r.next_run_at,r.last_run_at,r.last_status,r.last_error,r.config_version,r.created_at,r.updated_at,(SELECT row_to_json(x) FROM (SELECT id,status,attempt,config_version,dry_run,started_at,finished_at,post_id,error,exit_code,duration_ms,timed_out,retry_at,stdout,stderr,detail,progress_percent,progress_phase,progress_message,current_step,total_steps,eta_seconds,progress_updated_at FROM content_runner_runs WHERE runner_id=r.id ORDER BY id DESC LIMIT 1) x) AS latest_run,(SELECT count(*) FROM content_runner_runs WHERE runner_id=r.id) AS run_count FROM content_runners r JOIN authors a ON a.id=r.author_id JOIN communities c ON c.id=r.community_id";

pub async fn content_runners(
    State(db): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_admin(&headers, &db).await?;
    Ok(Json(sqlx::query_scalar(&format!("{} ORDER BY CASE r.state WHEN 'enabled' THEN 0 WHEN 'retrying' THEN 1 WHEN 'paused' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END,r.priority,r.id DESC) t", RUNNER_SELECT)).fetch_all(&db).await?))
}

pub async fn content_runner(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&headers, &db).await?;
    sqlx::query_scalar::<_, serde_json::Value>(&format!("{} WHERE r.id=$1) t", RUNNER_SELECT))
        .bind(id)
        .fetch_optional(&db)
        .await?
        .map(Json)
        .ok_or(ApiError::Missing)
}

pub async fn create_content_runner(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<CreateContentRunner>,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    let actor = require_admin(&headers, &db).await?;
    if !instance_module_enabled(&db, "content_runners").await? {
        return Err(ApiError::Invalid(
            "Content runners are disabled in Settings",
        ));
    }
    let name = input.name.trim();
    let kind = input.kind.trim();
    let author = input.author.trim();
    let community = input.community.trim().to_ascii_lowercase();
    let priority = input.priority.unwrap_or(100);
    let timeout = input.timeout_seconds.unwrap_or(900);
    let attempts = input.max_attempts.unwrap_or(3);
    let backoff = input.retry_backoff_seconds.unwrap_or(60);
    let threshold = input.failure_threshold.unwrap_or(3);
    let retention = input.retention_days.unwrap_or(30);
    let days_of_week = input
        .days_of_week
        .unwrap_or_else(|| serde_json::json!([1, 2, 3, 4, 5, 6, 7]));
    let environment_keys = input
        .environment_keys
        .unwrap_or_else(|| serde_json::json!([]));
    let capture_output = input.capture_output.unwrap_or(true);
    let max_log_bytes = input.max_log_bytes.unwrap_or(20000);
    if name.is_empty()
        || name.len() > 80
        || !["command", "cross_post", "draw_things"].contains(&kind)
    {
        return Err(ApiError::Invalid("Invalid runner name or type"));
    }
    validate_runner_policy(
        input.interval_seconds,
        priority,
        timeout,
        attempts,
        backoff,
        threshold,
        retention,
    )?;
    validate_days_of_week(&days_of_week)?;
    validate_environment_keys(&environment_keys)?;
    if !(1024..=20000).contains(&max_log_bytes) {
        return Err(ApiError::Invalid(
            "Log size must be between 1024 and 20000 bytes",
        ));
    }
    let author_id: i64 = sqlx::query_scalar("SELECT id FROM authors WHERE handle=$1")
        .bind(author)
        .fetch_optional(&db)
        .await?
        .ok_or(ApiError::Invalid("Author not found"))?;
    let community_id: i64 = sqlx::query_scalar("SELECT id FROM communities WHERE slug=$1")
        .bind(&community)
        .fetch_optional(&db)
        .await?
        .ok_or(ApiError::Invalid("Community not found"))?;
    let command = input.command.unwrap_or_else(|| serde_json::json!([]));
    validate_runner_definition(kind, &command)?;
    let prompt = input.prompt.unwrap_or_default();
    if prompt.len() > 20000 {
        return Err(ApiError::Invalid("Prompt is too long"));
    }
    let row=sqlx::query_scalar::<_,serde_json::Value>("INSERT INTO content_runners(name,kind,command,prompt,author_id,community_id,interval_seconds,days_of_week,priority,timeout_seconds,max_attempts,retry_backoff_seconds,failure_threshold,retention_days,environment_keys,capture_output,max_log_bytes,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING row_to_json(content_runners.*)").bind(name).bind(kind).bind(command).bind(prompt.trim()).bind(author_id).bind(community_id).bind(input.interval_seconds).bind(days_of_week).bind(priority).bind(timeout).bind(attempts).bind(backoff).bind(threshold).bind(retention).bind(environment_keys).bind(capture_output).bind(max_log_bytes).bind(actor).fetch_one(&db).await.map_err(|e|if matches!(&e,sqlx::Error::Database(d) if d.constraint()==Some("content_runners_name_key")){ApiError::Invalid("A runner with that name already exists")}else{ApiError::Database(e)})?;
    log_event(
        &db,
        "info",
        "admin.content_runner_created",
        serde_json::json!({"actor_id":actor,"name":name,"kind":kind}),
    )
    .await;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn update_content_runner(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<UpdateContentRunner>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let existing: Option<ExistingContentRunner>=sqlx::query_as("SELECT name,kind,command,prompt,(SELECT handle FROM authors WHERE id=author_id) AS author,interval_seconds,days_of_week,priority,timeout_seconds,max_attempts,retry_backoff_seconds,failure_threshold,retention_days,environment_keys,capture_output,max_log_bytes FROM content_runners WHERE id=$1 AND state<>'archived'").bind(id).fetch_optional(&db).await?;
    let Some(existing) = existing else {
        return Err(ApiError::Missing);
    };
    let name = input.name.as_deref().unwrap_or(&existing.name).trim();
    let kind = input.kind.as_deref().unwrap_or(&existing.kind).trim();
    let prompt = input.prompt.as_deref().unwrap_or(&existing.prompt);
    let interval = input.interval_seconds.unwrap_or(existing.interval_seconds);
    let days_of_week = input.days_of_week.unwrap_or(existing.days_of_week);
    let priority = input.priority.unwrap_or(existing.priority);
    let timeout = input.timeout_seconds.unwrap_or(existing.timeout_seconds);
    let attempts = input.max_attempts.unwrap_or(existing.max_attempts);
    let backoff = input
        .retry_backoff_seconds
        .unwrap_or(existing.retry_backoff_seconds);
    let threshold = input
        .failure_threshold
        .unwrap_or(existing.failure_threshold);
    let retention = input.retention_days.unwrap_or(existing.retention_days);
    let command = input.command.unwrap_or(existing.command);
    let environment_keys = input.environment_keys.unwrap_or(existing.environment_keys);
    let capture_output = input.capture_output.unwrap_or(existing.capture_output);
    let max_log_bytes = input.max_log_bytes.unwrap_or(existing.max_log_bytes);
    if name.is_empty()
        || name.len() > 80
        || !["command", "cross_post", "draw_things"].contains(&kind)
    {
        return Err(ApiError::Invalid("Invalid runner name or type"));
    }
    validate_runner_policy(
        interval, priority, timeout, attempts, backoff, threshold, retention,
    )?;
    validate_days_of_week(&days_of_week)?;
    validate_runner_definition(kind, &command)?;
    validate_environment_keys(&environment_keys)?;
    if !(1024..=20000).contains(&max_log_bytes) {
        return Err(ApiError::Invalid(
            "Log size must be between 1024 and 20000 bytes",
        ));
    }
    if prompt.len() > 20000 {
        return Err(ApiError::Invalid("Prompt is too long"));
    }
    let author_id: i64 = if let Some(handle) = input.author.as_deref() {
        sqlx::query_scalar::<_, i64>("SELECT id FROM authors WHERE handle=$1")
            .bind(handle.trim())
            .fetch_optional(&db)
            .await?
            .ok_or(ApiError::Invalid("Author not found"))?
    } else {
        sqlx::query_scalar::<_, i64>("SELECT id FROM authors WHERE handle=$1")
            .bind(&existing.author)
            .fetch_one(&db)
            .await?
    };
    let community_id: i64 = if let Some(slug) = input.community.as_deref() {
        sqlx::query_scalar::<_, i64>("SELECT id FROM communities WHERE slug=$1")
            .bind(slug.trim().to_ascii_lowercase())
            .fetch_optional(&db)
            .await?
            .ok_or(ApiError::Invalid("Community not found"))?
    } else {
        sqlx::query_scalar::<_, i64>("SELECT community_id FROM content_runners WHERE id=$1")
            .bind(id)
            .fetch_one(&db)
            .await?
    };
    let row=sqlx::query_scalar::<_,serde_json::Value>("UPDATE content_runners SET name=$2,kind=$3,command=$4,prompt=$5,author_id=$6,community_id=$7,interval_seconds=$8,days_of_week=$9,priority=$10,timeout_seconds=$11,max_attempts=$12,retry_backoff_seconds=$13,failure_threshold=$14,retention_days=$15,environment_keys=$16,capture_output=$17,max_log_bytes=$18,config_version=config_version+1,updated_by=$19,updated_at=now() WHERE id=$1 RETURNING row_to_json(content_runners.*)").bind(id).bind(name).bind(kind).bind(command).bind(prompt.trim()).bind(author_id).bind(community_id).bind(interval).bind(days_of_week).bind(priority).bind(timeout).bind(attempts).bind(backoff).bind(threshold).bind(retention).bind(environment_keys).bind(capture_output).bind(max_log_bytes).bind(actor).fetch_one(&db).await.map_err(|e|if matches!(&e,sqlx::Error::Database(d) if d.constraint()==Some("content_runners_name_key")){ApiError::Invalid("A runner with that name already exists")}else{ApiError::Database(e)})?;
    log_event(&db,"info","admin.content_runner_updated",serde_json::json!({"actor_id":actor,"runner_id":id,"config_version":row.get("config_version").and_then(|v|v.as_i64())})).await;
    Ok(Json(row))
}

pub async fn toggle_content_runner(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let state: Option<String> = sqlx::query_scalar("SELECT state FROM content_runners WHERE id=$1")
        .bind(id)
        .fetch_optional(&db)
        .await?;
    let Some(state) = state else {
        return Err(ApiError::Missing);
    };
    if state == "archived" {
        return Err(ApiError::Invalid("Archived runners cannot be enabled"));
    }
    let (enabled, next_state) = if state == "enabled" || state == "retrying" {
        (false, "paused")
    } else {
        (true, "enabled")
    };
    sqlx::query("UPDATE content_runners SET enabled=$2,state=$3,current_attempt=CASE WHEN $2 THEN 0 ELSE current_attempt END,paused_reason=CASE WHEN $2 THEN NULL ELSE 'Paused by administrator' END,next_run_at=CASE WHEN $2 THEN now() ELSE next_run_at END,updated_at=now() WHERE id=$1").bind(id).bind(enabled).bind(next_state).execute(&db).await?;
    log_event(
        &db,
        "info",
        "admin.content_runner_toggled",
        serde_json::json!({"actor_id":actor,"runner_id":id,"state":next_state}),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn run_content_runner_now(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let n=sqlx::query("UPDATE content_runners SET enabled=TRUE,state='enabled',next_run_at=now(),last_error=NULL,paused_reason=NULL,updated_at=now() WHERE id=$1 AND state<>'archived'").bind(id).execute(&db).await?.rows_affected();
    if n == 0 {
        return Err(ApiError::Missing);
    }
    log_event(
        &db,
        "info",
        "admin.content_runner_run_requested",
        serde_json::json!({"actor_id":actor,"runner_id":id}),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

/// Queue one host-side execution that records output but never publishes a
/// post. A draft runner may be tested without changing its lifecycle state.
pub async fn test_content_runner(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    if !instance_module_enabled(&db, "content_runners").await? {
        return Err(ApiError::Invalid(
            "Enable Content Runners in Settings before testing one",
        ));
    }
    let n = sqlx::query(
        "UPDATE content_runners SET test_requested=TRUE,last_error=NULL,updated_by=$2,updated_at=now() WHERE id=$1 AND state<>'archived'",
    )
    .bind(id)
    .bind(actor)
    .execute(&db)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(ApiError::Missing);
    }
    log_event(
        &db,
        "info",
        "admin.content_runner_test_requested",
        serde_json::json!({"actor_id":actor,"runner_id":id}),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn archive_content_runner(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let n=sqlx::query("UPDATE content_runners SET enabled=FALSE,state='archived',archived_at=COALESCE(archived_at,now()),updated_at=now() WHERE id=$1 AND state<>'archived'").bind(id).execute(&db).await?.rows_affected();
    if n == 0 {
        return Err(ApiError::Missing);
    }
    log_event(
        &db,
        "info",
        "admin.content_runner_archived",
        serde_json::json!({"actor_id":actor,"runner_id":id}),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn delete_content_runner(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let n = sqlx::query("DELETE FROM content_runners WHERE id=$1")
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
        "admin.content_runner_deleted",
        serde_json::json!({"actor_id":actor,"runner_id":id}),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, Default)]
pub struct RunnerRunFilter {
    pub runner_id: Option<i64>,
}
pub async fn content_runner_runs(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Query(filter): Query<RunnerRunFilter>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_admin(&headers, &db).await?;
    Ok(Json(sqlx::query_scalar("SELECT row_to_json(t) FROM (SELECT r.id,r.runner_id,c.name,r.status,r.attempt,r.config_version,r.dry_run,r.started_at,r.finished_at,r.post_id,r.error,r.exit_code,r.duration_ms,r.timed_out,r.retry_at,r.stdout,r.stderr,r.detail,r.progress_percent,r.progress_phase,r.progress_message,r.current_step,r.total_steps,r.eta_seconds,r.progress_updated_at FROM content_runner_runs r JOIN content_runners c ON c.id=r.runner_id WHERE ($1::bigint IS NULL OR r.runner_id=$1) ORDER BY r.id DESC LIMIT 200) t").bind(filter.runner_id).fetch_all(&db).await?))
}

#[derive(Deserialize, Default)]
pub struct UpdateContentRunnerProgress {
    progress_percent: Option<i16>,
    phase: Option<String>,
    message: Option<String>,
    current_step: Option<i32>,
    total_steps: Option<i32>,
    eta_seconds: Option<i32>,
}

pub async fn update_content_runner_progress(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(run_id): Path<i64>,
    Json(input): Json<UpdateContentRunnerProgress>,
) -> Result<StatusCode, ApiError> {
    require_admin(&headers, &db).await?;
    let percent = input
        .progress_percent
        .ok_or(ApiError::Invalid("Runner progress requires a percentage"))?;
    if !(0..=100).contains(&percent) {
        return Err(ApiError::Invalid(
            "Runner progress must be between 0 and 100",
        ));
    }
    let phase = input
        .phase
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if phase.as_ref().is_some_and(|value| value.len() > 64) {
        return Err(ApiError::Invalid("Runner progress phase is too long"));
    }
    let message = input
        .message
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if message.as_ref().is_some_and(|value| value.len() > 300) {
        return Err(ApiError::Invalid("Runner progress message is too long"));
    }
    if input.current_step.is_some_and(|value| value < 0)
        || input.total_steps.is_some_and(|value| value < 0)
        || input
            .current_step
            .zip(input.total_steps)
            .is_some_and(|(current, total)| current > total)
    {
        return Err(ApiError::Invalid("Runner progress steps are invalid"));
    }
    if input
        .eta_seconds
        .is_some_and(|value| !(0..=604_800).contains(&value))
    {
        return Err(ApiError::Invalid("Runner progress ETA is invalid"));
    }
    let updated = sqlx::query(
        "UPDATE content_runner_runs
         SET progress_percent=$2, progress_phase=$3, progress_message=$4,
             current_step=$5, total_steps=$6, eta_seconds=$7,
             progress_updated_at=now()
         WHERE id=$1 AND status='running'",
    )
    .bind(run_id)
    .bind(percent)
    .bind(phase)
    .bind(message)
    .bind(input.current_step)
    .bind(input.total_steps)
    .bind(input.eta_seconds)
    .execute(&db)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(ApiError::Missing);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn replay_content_runner(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(run_id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let n=sqlx::query("UPDATE content_runners SET enabled=TRUE,state='enabled',next_run_at=now(),current_attempt=0,last_error=NULL,paused_reason=NULL,updated_at=now() WHERE id=(SELECT runner_id FROM content_runner_runs WHERE id=$1) AND state<>'archived'").bind(run_id).execute(&db).await?.rows_affected();
    if n == 0 {
        return Err(ApiError::Missing);
    }
    log_event(
        &db,
        "info",
        "admin.content_runner_replayed",
        serde_json::json!({"actor_id":actor,"run_id":run_id}),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(FromRow)]
struct ClaimedContentRunner {
    id: i64,
    name: String,
    kind: String,
    command: serde_json::Value,
    prompt: String,
    author: String,
    community: String,
    interval_seconds: i32,
    priority: i32,
    timeout_seconds: i32,
    max_attempts: i32,
    retry_backoff_seconds: i32,
    failure_threshold: i32,
    current_attempt: i32,
    config_version: i32,
    state: String,
    test_requested: bool,
    environment_keys: serde_json::Value,
    capture_output: bool,
    max_log_bytes: i32,
}

pub async fn claim_content_runner(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&headers, &db).await?;
    let mut tx = db.begin().await?;
    // The worker timer is normally singleton, but the database gate also
    // protects against overlapping worker processes or a second host.
    sqlx::query("SELECT pg_advisory_xact_lock(90127431)")
        .execute(&mut *tx)
        .await?;
    let r:Option<ClaimedContentRunner>=sqlx::query_as("SELECT r.id,r.name,r.kind,r.command,r.prompt,a.handle AS author,c.slug AS community,r.interval_seconds,r.priority,r.timeout_seconds,r.max_attempts,r.retry_backoff_seconds,r.failure_threshold,r.current_attempt,r.config_version,r.state,r.test_requested,r.environment_keys,r.capture_output,r.max_log_bytes FROM content_runners r JOIN authors a ON a.id=r.author_id JOIN communities c ON c.id=r.community_id CROSS JOIN instance_modules m WHERE r.id=$1 AND m.module_key='content_runners' AND m.enabled AND ( (r.test_requested AND r.state<>'archived') OR (r.enabled AND r.state IN ('enabled','retrying') AND r.next_run_at<=now() AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(r.days_of_week) day WHERE day::int=EXTRACT(ISODOW FROM now())::int) ) ) AND NOT EXISTS (SELECT 1 FROM content_runner_runs active WHERE active.status='running') FOR UPDATE SKIP LOCKED").bind(id).fetch_optional(&mut *tx).await?;
    let Some(r) = r else {
        return Err(ApiError::Invalid(
            "Runner is disabled, not due, archived, or already running",
        ));
    };
    let attempt = if r.state == "retrying" {
        r.current_attempt + 1
    } else {
        1
    };
    let run_id:i64=sqlx::query_scalar("INSERT INTO content_runner_runs(runner_id,status,attempt,config_version,dry_run) VALUES($1,'running',$2,$3,$4) RETURNING id").bind(r.id).bind(attempt).bind(r.config_version).bind(r.test_requested).fetch_one(&mut *tx).await?;
    sqlx::query("UPDATE content_runners SET test_requested=FALSE,last_run_at=now(),last_status=CASE WHEN $3 THEN 'testing' ELSE 'running' END,last_error=NULL,current_attempt=$2,next_run_at=CASE WHEN $3 THEN next_run_at ELSE now()+make_interval(secs=>interval_seconds) END,updated_at=now() WHERE id=$1").bind(r.id).bind(attempt).bind(r.test_requested).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        serde_json::json!({"run_id":run_id,"id":r.id,"name":r.name,"kind":r.kind,"command":r.command,"prompt":r.prompt,"author":r.author,"community":r.community,"interval_seconds":r.interval_seconds,"priority":r.priority,"timeout_seconds":r.timeout_seconds,"max_attempts":r.max_attempts,"retry_backoff_seconds":r.retry_backoff_seconds,"failure_threshold":r.failure_threshold,"attempt":attempt,"config_version":r.config_version,"dry_run":r.test_requested,"environment_keys":r.environment_keys,"capture_output":r.capture_output,"max_log_bytes":r.max_log_bytes}),
    ))
}

#[derive(Deserialize)]
pub struct CompleteContentRunner {
    status: String,
    post_id: Option<i64>,
    error: Option<String>,
    detail: Option<serde_json::Value>,
    stdout: Option<String>,
    stderr: Option<String>,
    exit_code: Option<i32>,
    duration_ms: Option<i64>,
    timed_out: Option<bool>,
}
pub async fn complete_content_runner(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(run_id): Path<i64>,
    Json(input): Json<CompleteContentRunner>,
) -> Result<StatusCode, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    if !["success", "failed", "timeout", "skipped", "cancelled"].contains(&input.status.as_str()) {
        return Err(ApiError::Invalid("Unknown runner run status"));
    }
    let mut tx = db.begin().await?;
    type C = (i64, i32, i32, i32, i32, i32, String, bool);
    let run:Option<C>=sqlx::query_as("SELECT r.runner_id,r.attempt,c.max_attempts,c.retry_backoff_seconds,c.failure_threshold,c.consecutive_failures,c.state,r.dry_run FROM content_runner_runs r JOIN content_runners c ON c.id=r.runner_id WHERE r.id=$1 AND r.status='running' FOR UPDATE").bind(run_id).fetch_optional(&mut *tx).await?;
    let Some((runner_id, attempt, max_attempts, backoff, threshold, consecutive, _state, dry_run)) =
        run
    else {
        return Err(ApiError::Missing);
    };
    let stdout = input.stdout.unwrap_or_default();
    let stderr = input.stderr.unwrap_or_default();
    if stdout.len() > 20000 || stderr.len() > 20000 {
        return Err(ApiError::Invalid(
            "Runner logs are limited to 20000 bytes each",
        ));
    }
    let detail = input.detail.unwrap_or_else(|| serde_json::json!({}));
    sqlx::query("UPDATE content_runner_runs SET finished_at=now(),status=$2,post_id=$3,error=$4,detail=$5,stdout=$6,stderr=$7,exit_code=$8,duration_ms=$9,timed_out=$10,progress_percent=CASE WHEN $2 IN ('success','skipped') THEN 100 ELSE progress_percent END,progress_phase=CASE WHEN $2 IN ('success','skipped') THEN 'complete' ELSE progress_phase END,eta_seconds=NULL,progress_updated_at=now() WHERE id=$1").bind(run_id).bind(&input.status).bind(input.post_id).bind(&input.error).bind(detail).bind(&stdout).bind(&stderr).bind(input.exit_code).bind(input.duration_ms).bind(input.timed_out.unwrap_or(input.status=="timeout")).execute(&mut *tx).await?;
    if dry_run {
        sqlx::query("UPDATE content_runners SET last_status=$2,last_error=$3,paused_reason=NULL,updated_by=$4,updated_at=now() WHERE id=$1 AND state<>'archived'")
            .bind(runner_id)
            .bind(format!("test_{}", input.status))
            .bind(&input.error)
            .bind(actor)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Ok(StatusCode::NO_CONTENT);
    }
    let failed = input.status == "failed" || input.status == "timeout";
    let exhausted = failed && attempt >= max_attempts;
    let new_failures = if exhausted {
        consecutive + 1
    } else {
        consecutive
    };
    if input.status == "success" || input.status == "skipped" {
        sqlx::query("UPDATE content_runners SET enabled=TRUE,state='enabled',current_attempt=0,consecutive_failures=0,last_success_at=CASE WHEN $2='success' THEN now() ELSE last_success_at END,last_status=$2,last_error=NULL,paused_reason=NULL,next_run_at=now()+make_interval(secs=>interval_seconds),updated_by=$3,updated_at=now() WHERE id=$1 AND state<>'archived'").bind(runner_id).bind(&input.status).bind(actor).execute(&mut *tx).await?;
    } else if failed && !exhausted {
        let shift = std::cmp::min(attempt - 1, 10);
        let delay = (backoff as i64) * (1_i64 << shift);
        sqlx::query(
            "UPDATE content_runner_runs SET retry_at=now()+make_interval(secs=>$2) WHERE id=$1",
        )
        .bind(run_id)
        .bind(delay as i32)
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE content_runners SET enabled=TRUE,state='retrying',current_attempt=$2,last_status='retrying',last_error=$3,paused_reason=NULL,next_run_at=now()+make_interval(secs=>$4),updated_by=$5,updated_at=now() WHERE id=$1 AND state<>'archived'").bind(runner_id).bind(attempt).bind(&input.error).bind(delay as i32).bind(actor).execute(&mut *tx).await?;
    } else if failed {
        let paused = new_failures >= threshold;
        sqlx::query("UPDATE content_runners SET enabled=NOT $2,state=CASE WHEN $2 THEN 'paused' ELSE 'enabled' END,current_attempt=0,consecutive_failures=$3,last_status=$4,last_error=$5,paused_reason=CASE WHEN $2 THEN 'Failure threshold reached' ELSE NULL END,next_run_at=CASE WHEN $2 THEN next_run_at ELSE now()+make_interval(secs=>interval_seconds) END,updated_by=$6,updated_at=now() WHERE id=$1 AND state<>'archived'").bind(runner_id).bind(paused).bind(new_failures).bind(&input.status).bind(&input.error).bind(actor).execute(&mut *tx).await?;
    } else {
        sqlx::query("UPDATE content_runners SET last_status=$2,last_error=$3,updated_by=$4,updated_at=now() WHERE id=$1 AND state<>'archived'").bind(runner_id).bind(&input.status).bind(&input.error).bind(actor).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct RunnerPost {
    title: String,
    body: Option<String>,
    content_rating: Option<String>,
    author: String,
    community: String,
    provider: Option<String>,
    source_url: Option<String>,
    source_author: Option<String>,
    published_at: Option<chrono::DateTime<chrono::Utc>>,
    source_views: Option<i64>,
    source_likes: Option<i64>,
    source_reposts: Option<i64>,
    source_replies: Option<i64>,
    media: Option<serde_json::Value>,
    source_comments: Option<serde_json::Value>,
    attribution: Option<String>,
    profile_image_url: Option<String>,
    profile_url: Option<String>,
    profile_display_name: Option<String>,
    profile_bio: Option<String>,
    profile_followers: Option<i64>,
    profile_following: Option<i64>,
    profile_verified: Option<bool>,
    generation_config: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct RunnerMediaUpload {
    data_hex: String,
    content_type: String,
}

const RUNNER_IMAGE_MAX_BYTES: usize = 5_242_880;

fn runner_media_content_type(headers: &HeaderMap) -> Result<String, ApiError> {
    let content_type = headers
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !matches!(
        content_type.as_str(),
        "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    ) {
        return Err(ApiError::Invalid(
            "Runner media must be a supported image type",
        ));
    }
    Ok(content_type)
}

async fn store_content_runner_media(
    db: &PgPool,
    content_type: &str,
    bytes: &[u8],
) -> Result<Json<serde_json::Value>, ApiError> {
    if bytes.is_empty() || bytes.len() > RUNNER_IMAGE_MAX_BYTES {
        return Err(ApiError::Invalid(
            "Runner images must be between 1 byte and 5 MB",
        ));
    }
    let digest = media_store::checksum(bytes);
    let config = media_store::load_config(db)
        .await
        .map_err(ApiError::Storage)?;
    let stored = media_store::store_asset(&config, &digest, content_type, bytes)
        .await
        .map_err(ApiError::Storage)?;
    let row = persist_stored_asset(
        db,
        "image",
        content_type,
        bytes,
        &digest,
        &stored,
        &config.secondary_provider,
    )
    .await?;
    Ok(Json(serde_json::json!({
        "id": row.0,
        "src": format!("/media/{}", row.0),
        "original_src": format!("/media/{}/original", row.0),
        "thumbnail_src": row.3.get("thumbnail").map(|_| format!("/media/{}/thumbnail", row.0)),
        "kind": "image",
        "content_type": row.1,
        "storage_backend": row.2,
    })))
}

#[derive(FromRow)]
struct MediaSource {
    id: i64,
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

async fn media_source(db: &PgPool, id: i64) -> Result<MediaSource, ApiError> {
    sqlx::query_as(
        "SELECT id, content_hash, content_bytes, byte_size, mime_type, content_type,
                storage_backend, object_key, status, variants
         FROM media_assets WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or(ApiError::Missing)
}

fn source_variant(
    source: &MediaSource,
    variant: &str,
) -> Result<media_store::StoredVariant, ApiError> {
    if variant != "original" && variant != "thumbnail" {
        return Err(ApiError::Missing);
    }
    if let Some(metadata) = media_store::variant_metadata(&source.variants, variant) {
        return Ok(metadata);
    }
    if variant == "original" {
        return Ok(media_store::StoredVariant {
            variant: variant.to_owned(),
            object_key: source.object_key.clone().unwrap_or_default(),
            byte_size: source.byte_size.max(0) as u64,
            mime_type: source
                .mime_type
                .clone()
                .unwrap_or_else(|| source.content_type.clone()),
            checksum: source.content_hash.clone(),
            external_url: None,
        });
    }
    Err(ApiError::Missing)
}

async fn load_media_variant(
    db: &PgPool,
    config: &media_store::MediaConfig,
    id: i64,
    variant: &str,
) -> Result<(MediaSource, media_store::StoredVariant, Vec<u8>), ApiError> {
    let source = media_source(db, id).await?;
    if source.status == "deleted" {
        return Err(ApiError::Missing);
    }
    let metadata = source_variant(&source, variant)?;
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
        .fetch_optional(db)
        .await?
    };
    let bytes = media_store::read_variant(
        config,
        media_store::VariantRead {
            hash: &source.content_hash,
            provider: &source.storage_backend,
            key: (!metadata.object_key.is_empty()).then_some(metadata.object_key.as_str()),
            variant,
            legacy_bytes: source.content_bytes.as_deref(),
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
            source.id, variant
        )));
    }
    Ok((source, metadata, bytes))
}

async fn record_replicas(
    db: &PgPool,
    media_id: i64,
    role: &str,
    stored: &media_store::StoredAsset,
    variants: &[media_store::StoredVariant],
) -> Result<(), ApiError> {
    for variant in variants {
        sqlx::query(
            "INSERT INTO media_replicas
                (media_id, provider, role, variant, object_key, external_url,
                 checksum, byte_size, mime_type, state, error, updated_at, last_verified_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ready', '', now(), now())
             ON CONFLICT (media_id, provider, role, variant) DO UPDATE SET
                object_key = EXCLUDED.object_key,
                external_url = EXCLUDED.external_url,
                checksum = EXCLUDED.checksum,
                byte_size = EXCLUDED.byte_size,
                mime_type = EXCLUDED.mime_type,
                state = 'ready',
                error = '',
                updated_at = now(),
                last_verified_at = now()",
        )
        .bind(media_id)
        .bind(&stored.backend)
        .bind(role)
        .bind(&variant.variant)
        .bind(&variant.object_key)
        .bind(variant.external_url.as_deref())
        .bind(&variant.checksum)
        .bind(variant.byte_size as i64)
        .bind(&variant.mime_type)
        .execute(db)
        .await?;
    }
    Ok(())
}

async fn record_primary_replicas(
    db: &PgPool,
    media_id: i64,
    stored: &media_store::StoredAsset,
) -> Result<(), ApiError> {
    record_replicas(db, media_id, "primary", stored, &stored.variants).await
}

async fn record_secondary_replicas(
    db: &PgPool,
    media_id: i64,
    stored: &media_store::StoredAsset,
) -> Result<(), ApiError> {
    if let Some(secondary) = stored.secondary.as_ref() {
        let replica = media_store::StoredAsset {
            backend: secondary.backend.clone(),
            object_key: secondary
                .variants
                .first()
                .map(|variant| variant.object_key.clone())
                .unwrap_or_default(),
            variants: secondary.variants.clone(),
            secondary: None,
        };
        record_replicas(db, media_id, "secondary", &replica, &secondary.variants).await?;
        for variant in &secondary.variants {
            sqlx::query(
                "UPDATE media_replication_jobs
                 SET status = 'ready', locked_at = NULL, last_error = '',
                     completed_at = COALESCE(completed_at, now()), updated_at = now()
                 WHERE media_id = $1 AND provider = $2 AND variant = $3",
            )
            .bind(media_id)
            .bind(&secondary.backend)
            .bind(&variant.variant)
            .execute(db)
            .await?;
        }
    }
    Ok(())
}

async fn queue_secondary_replicas(
    db: &PgPool,
    media_id: i64,
    stored: &media_store::StoredAsset,
    provider: &str,
) -> Result<(), ApiError> {
    if provider == "disabled" {
        return Ok(());
    }
    for variant in &stored.variants {
        sqlx::query(
            "INSERT INTO media_replicas
                (media_id, provider, role, variant, checksum, byte_size, mime_type, state, error)
             VALUES ($1, $2, 'secondary', $3, $4, $5, $6, 'uploading', '')
             ON CONFLICT (media_id, provider, role, variant) DO NOTHING",
        )
        .bind(media_id)
        .bind(provider)
        .bind(&variant.variant)
        .bind(&variant.checksum)
        .bind(variant.byte_size as i64)
        .bind(&variant.mime_type)
        .execute(db)
        .await?;
        sqlx::query(
            "INSERT INTO media_replication_jobs
                (media_id, provider, variant, status, available_at, updated_at)
             VALUES ($1, $2, $3, 'pending', now(), now())
             ON CONFLICT (media_id, provider, variant) DO NOTHING",
        )
        .bind(media_id)
        .bind(provider)
        .bind(&variant.variant)
        .execute(db)
        .await?;
    }
    Ok(())
}

async fn persist_stored_asset(
    db: &PgPool,
    media_type: &str,
    content_type: &str,
    bytes: &[u8],
    digest: &str,
    stored: &media_store::StoredAsset,
    secondary_provider: &str,
) -> Result<(i64, String, String, serde_json::Value), ApiError> {
    let variants = media_store::variants_json(&stored.variants);
    let row: (i64, String, String, serde_json::Value) = sqlx::query_as(
        "INSERT INTO media_assets
            (content_hash, media_type, byte_size, content_type, storage_backend,
             object_key, mime_type, status, variants, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $4, 'ready', $7, now())
         ON CONFLICT (content_hash) DO UPDATE SET
            byte_size = EXCLUDED.byte_size,
            media_type = CASE WHEN media_assets.storage_backend = 'legacy'
                              THEN EXCLUDED.media_type ELSE media_assets.media_type END,
            content_type = CASE WHEN media_assets.content_bytes IS NULL
                                 THEN EXCLUDED.content_type ELSE media_assets.content_type END,
            storage_backend = CASE WHEN media_assets.storage_backend = 'legacy'
                                   THEN EXCLUDED.storage_backend ELSE media_assets.storage_backend END,
            object_key = CASE WHEN media_assets.storage_backend = 'legacy'
                              THEN EXCLUDED.object_key ELSE media_assets.object_key END,
            mime_type = CASE WHEN media_assets.storage_backend = 'legacy'
                             THEN EXCLUDED.mime_type ELSE media_assets.mime_type END,
            status = CASE WHEN media_assets.storage_backend = 'legacy'
                          THEN 'ready' ELSE media_assets.status END,
            variants = CASE WHEN media_assets.storage_backend = 'legacy'
                            THEN EXCLUDED.variants ELSE media_assets.variants END,
            updated_at = now()
         RETURNING id, content_type, storage_backend, variants",
    )
    .bind(digest)
    .bind(media_type)
    .bind(bytes.len() as i64)
    .bind(content_type)
    .bind(&stored.backend)
    .bind(&stored.object_key)
    .bind(variants)
    .fetch_one(db)
    .await?;
    if row.2 == stored.backend {
        record_primary_replicas(db, row.0, stored).await?;
        record_secondary_replicas(db, row.0, stored).await?;
        queue_secondary_replicas(db, row.0, stored, secondary_provider).await?;
    }
    Ok(row)
}

#[derive(Deserialize)]
pub struct MediaUploadRequest {
    data_hex: String,
    content_type: String,
}

pub async fn upload_media(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<MediaUploadRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    let _author_id = active_author(&headers, &db).await?;
    let content_type = input.content_type.trim().to_ascii_lowercase();
    let media_type = if content_type.starts_with("image/") {
        "image"
    } else if content_type.starts_with("video/") {
        "video"
    } else if content_type.starts_with("audio/") {
        "audio"
    } else if content_type.starts_with("application/") {
        "file"
    } else {
        return Err(ApiError::Invalid("Unsupported media content type"));
    };
    let max_bytes = match media_type {
        "image" => 5_242_880,
        "audio" => 52_428_800,
        "video" => 104_857_600,
        _ => 25_165_824,
    };
    if input.data_hex.is_empty()
        || input.data_hex.len() > max_bytes * 2
        || input.data_hex.len() % 2 != 0
    {
        return Err(ApiError::Invalid("Media upload is outside the size limit"));
    }
    let bytes = hex::decode(input.data_hex.trim())
        .map_err(|_| ApiError::Invalid("Media is not valid hexadecimal data"))?;
    if bytes.is_empty() || bytes.len() > max_bytes {
        return Err(ApiError::Invalid("Media upload is outside the size limit"));
    }
    let digest = media_store::checksum(&bytes);
    let config = media_store::load_config(&db)
        .await
        .map_err(ApiError::Storage)?;
    let stored = media_store::store_asset(&config, &digest, &content_type, &bytes)
        .await
        .map_err(ApiError::Storage)?;
    let row = persist_stored_asset(
        &db,
        media_type,
        &content_type,
        &bytes,
        &digest,
        &stored,
        &config.secondary_provider,
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": row.0,
            "src": format!("/media/{}", row.0),
            "original_src": format!("/media/{}/original", row.0),
            "thumbnail_src": row.3.get("thumbnail").map(|_| format!("/media/{}/thumbnail", row.0)),
            "kind": media_type,
            "content_type": row.1,
            "storage_backend": row.2,
        })),
    ))
}

/// Store a bounded image produced by a worker-side command. The worker sends
/// hex rather than a filesystem path because the API host and the worker may
/// be different machines. This endpoint is admin-only and never exposes a
/// worker filesystem path to the web process.
pub async fn upload_content_runner_media(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<RunnerMediaUpload>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&headers, &db).await?;
    let content_type = input.content_type.trim().to_ascii_lowercase();
    if !matches!(
        content_type.as_str(),
        "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    ) {
        return Err(ApiError::Invalid(
            "Runner media must be a supported image type",
        ));
    }
    if input.data_hex.is_empty()
        || input.data_hex.len() > RUNNER_IMAGE_MAX_BYTES * 2
        || input.data_hex.len() % 2 != 0
    {
        return Err(ApiError::Invalid(
            "Runner images must be between 1 byte and 5 MB",
        ));
    }
    let bytes = hex::decode(input.data_hex.trim())
        .map_err(|_| ApiError::Invalid("Runner media is not valid hexadecimal data"))?;
    store_content_runner_media(&db, &content_type, &bytes).await
}

/// Binary companion to the legacy JSON/hex endpoint above. Hex doubles the
/// request body and makes otherwise valid Draw Things output cross small
/// reverse-proxy limits. The worker prefers this endpoint and falls back to
/// the legacy contract for older servers.
pub async fn upload_content_runner_media_raw(
    State(db): State<PgPool>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&headers, &db).await?;
    let content_type = runner_media_content_type(&headers)?;
    store_content_runner_media(&db, &content_type, &body).await
}

#[derive(FromRow)]
struct MediaReplicationJob {
    id: i64,
    media_id: i64,
    provider: String,
    variant: String,
    attempts: i32,
}

async fn claim_media_replication_job(db: &PgPool) -> Result<Option<MediaReplicationJob>, String> {
    sqlx::query_as(
        "WITH stale AS (
             UPDATE media_replication_jobs
             SET status = 'pending', locked_at = NULL, updated_at = now()
             WHERE status = 'running'
               AND locked_at < now() - interval '10 minutes'
         ), candidate AS (
             SELECT id
             FROM media_replication_jobs
             WHERE status IN ('pending', 'failed')
               AND available_at <= now()
             ORDER BY id
             FOR UPDATE SKIP LOCKED
             LIMIT 1
         )
         UPDATE media_replication_jobs AS job
         SET status = 'running', attempts = job.attempts + 1,
             locked_at = now(), updated_at = now()
         FROM candidate
         WHERE job.id = candidate.id
         RETURNING job.id, job.media_id, job.provider, job.variant, job.attempts",
    )
    .fetch_optional(db)
    .await
    .map_err(|error| format!("could not claim media replication job: {error}"))
}

async fn complete_media_replication_job(
    db: &PgPool,
    job: &MediaReplicationJob,
    config: &media_store::MediaConfig,
) -> Result<(), String> {
    let source = sqlx::query_as::<_, MediaSource>(
        "SELECT id, content_hash, content_bytes, byte_size, mime_type, content_type,
                storage_backend, object_key, status, variants
         FROM media_assets WHERE id = $1",
    )
    .bind(job.media_id)
    .fetch_optional(db)
    .await
    .map_err(|error| format!("could not load media asset: {error}"))?
    .ok_or_else(|| "media asset no longer exists".to_owned())?;
    if source.status == "deleted" {
        return Err("media asset is deleted".to_owned());
    }
    let metadata = source_variant(&source, &job.variant)
        .map_err(|_| format!("media variant {} is unavailable", job.variant))?;
    let bytes = if source.storage_backend == "legacy" {
        source
            .content_bytes
            .as_deref()
            .map(ToOwned::to_owned)
            .ok_or_else(|| "legacy media has no database content".to_owned())?
    } else {
        media_store::read_primary(config, &source.storage_backend, &metadata.object_key).await?
    };
    if !metadata.checksum.is_empty() && media_store::checksum(&bytes) != metadata.checksum {
        return Err(format!("checksum mismatch for {}", job.variant));
    }
    let stored = media_store::store_variant_on_provider(
        config,
        &job.provider,
        &source.content_hash,
        &job.variant,
        &metadata.mime_type,
        &bytes,
    )
    .await?;
    let verified = media_store::read_primary(config, &job.provider, &stored.object_key).await?;
    if media_store::checksum(&verified) != stored.checksum {
        return Err(format!(
            "secondary {} checksum mismatch after upload",
            job.provider
        ));
    }
    sqlx::query(
        "INSERT INTO media_replicas
            (media_id, provider, role, variant, object_key, external_url,
             checksum, byte_size, mime_type, state, error, updated_at, last_verified_at)
         VALUES ($1, $2, 'secondary', $3, $4, $5, $6, $7, $8, 'ready', '', now(), now())
         ON CONFLICT (media_id, provider, role, variant) DO UPDATE SET
            object_key = EXCLUDED.object_key,
            external_url = EXCLUDED.external_url,
            checksum = EXCLUDED.checksum,
            byte_size = EXCLUDED.byte_size,
            mime_type = EXCLUDED.mime_type,
            state = 'ready', error = '', updated_at = now(), last_verified_at = now()",
    )
    .bind(job.media_id)
    .bind(&job.provider)
    .bind(&job.variant)
    .bind(&stored.object_key)
    .bind(stored.external_url.as_deref())
    .bind(&stored.checksum)
    .bind(stored.byte_size as i64)
    .bind(&stored.mime_type)
    .execute(db)
    .await
    .map_err(|error| format!("could not record media replica: {error}"))?;
    sqlx::query(
        "UPDATE media_replication_jobs
         SET status = 'ready', locked_at = NULL, last_error = '',
             completed_at = now(), updated_at = now()
         WHERE id = $1",
    )
    .bind(job.id)
    .execute(db)
    .await
    .map_err(|error| format!("could not complete media replication job: {error}"))?;
    Ok(())
}

async fn fail_media_replication_job(
    db: &PgPool,
    job: &MediaReplicationJob,
    error: &str,
) -> Result<(), String> {
    let shift = job.attempts.saturating_sub(1).min(7) as u32;
    let delay_seconds = 30_i64.saturating_mul(1_i64 << shift);
    let available_at = Utc::now() + chrono::Duration::seconds(delay_seconds);
    let error = error.chars().take(2000).collect::<String>();
    sqlx::query(
        "UPDATE media_replication_jobs
         SET status = 'failed', locked_at = NULL, available_at = $2,
             last_error = $3, updated_at = now()
         WHERE id = $1",
    )
    .bind(job.id)
    .bind(available_at)
    .bind(&error)
    .execute(db)
    .await
    .map_err(|update_error| {
        format!("could not record media replication failure: {update_error}")
    })?;
    sqlx::query(
        "UPDATE media_replicas
         SET state = 'failed', error = $4, updated_at = now()
         WHERE media_id = $1 AND provider = $2 AND role = 'secondary' AND variant = $3",
    )
    .bind(job.media_id)
    .bind(&job.provider)
    .bind(&job.variant)
    .bind(&error)
    .execute(db)
    .await
    .map_err(|update_error| format!("could not record media replica failure: {update_error}"))?;
    Ok(())
}

async fn reconcile_media_replication_jobs(db: &PgPool) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO media_replication_jobs
            (media_id, provider, variant, status, available_at, updated_at)
         SELECT media_id, provider, variant, 'pending', now(), now()
         FROM media_replicas
         WHERE role = 'secondary' AND state IN ('uploading', 'failed')
         ON CONFLICT (media_id, provider, variant) DO NOTHING",
    )
    .execute(db)
    .await
    .map(|_| ())
    .map_err(|error| format!("could not reconcile media replication jobs: {error}"))
}

pub async fn process_media_replication_jobs(db: &PgPool) -> Result<u64, String> {
    let config = media_store::load_config(db).await?;
    reconcile_media_replication_jobs(db).await?;
    let mut processed = 0_u64;
    for _ in 0..4 {
        let Some(job) = claim_media_replication_job(db).await? else {
            break;
        };
        match complete_media_replication_job(db, &job, &config).await {
            Ok(()) => processed += 1,
            Err(error) => {
                tracing::warn!(
                    media_id = job.media_id,
                    provider = %job.provider,
                    variant = %job.variant,
                    attempts = job.attempts,
                    %error,
                    "media replication attempt failed"
                );
                fail_media_replication_job(db, &job, &error).await?;
            }
        }
    }
    Ok(processed)
}

#[derive(Deserialize, Default)]
pub struct ShareMediaRequest {
    variant: Option<String>,
}

pub async fn media_test(
    State(db): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let config = media_store::load_config(&db)
        .await
        .map_err(ApiError::Storage)?;
    let tested = media_store::test_configured(&config)
        .await
        .map_err(ApiError::Storage)?;
    log_event(
        &db,
        "info",
        "admin.media_storage_tested",
        serde_json::json!({"actor_id": actor, "providers": tested}),
    )
    .await;
    Ok(Json(serde_json::json!({
        "status": "ok",
        "providers": tested,
        "primary_source": config.primary_source,
        "secondary_source": config.secondary_source,
    })))
}

pub async fn media_clear_cache(
    State(db): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let config = media_store::load_config(&db)
        .await
        .map_err(ApiError::Storage)?;
    media_store::clear_cache(&config.cache_root)
        .await
        .map_err(ApiError::Storage)?;
    log_event(
        &db,
        "info",
        "admin.media_cache_cleared",
        serde_json::json!({"actor_id": actor}),
    )
    .await;
    Ok(Json(serde_json::json!({"status": "cleared"})))
}

pub async fn media_migrate(
    State(db): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let config = media_store::load_config(&db)
        .await
        .map_err(ApiError::Storage)?;
    let sources: Vec<MediaSource> = sqlx::query_as(
        "SELECT id, content_hash, content_bytes, byte_size, mime_type, content_type,
                storage_backend, object_key, status, variants
         FROM media_assets
         WHERE status = 'ready'
         ORDER BY id",
    )
    .fetch_all(&db)
    .await?;
    let mut migrated = 0_u64;
    let mut failures = Vec::new();
    for source in sources {
        let mut stored_variants = Vec::new();
        let mut secondary_variants = Vec::new();
        let mut source_error = None;
        for variant in ["original", "thumbnail"] {
            let metadata = match source_variant(&source, variant) {
                Ok(metadata) => metadata,
                Err(ApiError::Missing) => continue,
                Err(_) => continue,
            };
            let bytes = if source.storage_backend == "legacy" {
                match source.content_bytes.as_deref() {
                    Some(bytes) => bytes.to_vec(),
                    None => {
                        source_error = Some("legacy media has no database content".to_owned());
                        break;
                    }
                }
            } else {
                match media_store::read_primary(
                    &config,
                    &source.storage_backend,
                    &metadata.object_key,
                )
                .await
                {
                    Ok(bytes) => bytes,
                    Err(error) => {
                        source_error = Some(error);
                        break;
                    }
                }
            };
            if !metadata.checksum.is_empty() && media_store::checksum(&bytes) != metadata.checksum {
                source_error = Some(format!("checksum mismatch for {variant}"));
                break;
            }
            match media_store::store_variant_replicated(
                &config,
                &source.content_hash,
                variant,
                &metadata.mime_type,
                &bytes,
            )
            .await
            {
                Ok((stored, secondary)) => {
                    stored_variants.push(stored);
                    if let Some(secondary) = secondary {
                        secondary_variants.push(secondary);
                    }
                }
                Err(error) => {
                    source_error = Some(error);
                    break;
                }
            }
        }
        let Some(stored_original) = stored_variants
            .iter()
            .find(|variant| variant.variant == "original")
        else {
            source_error.get_or_insert_with(|| "original media variant is unavailable".to_owned());
            failures.push(serde_json::json!({
                "id": source.id,
                "error": source_error.unwrap_or_else(|| "media migration failed".to_owned())
            }));
            continue;
        };
        if let Some(error) = source_error {
            failures.push(serde_json::json!({"id": source.id, "error": error}));
            continue;
        }
        let original_key = stored_original.object_key.clone();
        let original_byte_size = stored_original.byte_size;
        let original_mime_type = stored_original.mime_type.clone();
        let stored = media_store::StoredAsset {
            backend: config.primary_provider.clone(),
            object_key: original_key,
            variants: stored_variants,
            secondary: (config.secondary_provider != "disabled").then_some(
                media_store::StoredReplica {
                    backend: config.secondary_provider.clone(),
                    variants: secondary_variants,
                },
            ),
        };
        let variants = media_store::variants_json(&stored.variants);
        sqlx::query(
            "UPDATE media_assets
             SET storage_backend = $2, object_key = $3, mime_type = $4,
                 byte_size = $5, content_type = $4, status = 'ready',
                 variants = $6, updated_at = now()
             WHERE id = $1",
        )
        .bind(source.id)
        .bind(&stored.backend)
        .bind(&stored.object_key)
        .bind(&original_mime_type)
        .bind(original_byte_size as i64)
        .bind(variants)
        .execute(&db)
        .await?;
        sqlx::query(
            "UPDATE media_replicas
             SET state = 'deleted', updated_at = now()
             WHERE media_id = $1 AND role = 'secondary' AND provider <> $2",
        )
        .bind(source.id)
        .bind(&config.secondary_provider)
        .execute(&db)
        .await?;
        if source.storage_backend != "legacy" {
            sqlx::query(
                "UPDATE media_replicas AS replica
                 SET role = 'backup', updated_at = now()
                 WHERE replica.media_id = $1 AND replica.provider = $2 AND replica.role = 'primary'
                   AND NOT EXISTS (
                     SELECT 1 FROM media_replicas existing
                     WHERE existing.media_id = $1 AND existing.provider = $2
                       AND existing.role = 'backup' AND existing.variant = replica.variant
                   )",
            )
            .bind(source.id)
            .bind(&source.storage_backend)
            .execute(&db)
            .await?;
        }
        record_primary_replicas(&db, source.id, &stored).await?;
        record_secondary_replicas(&db, source.id, &stored).await?;
        migrated += 1;
    }
    log_event(
        &db,
        if failures.is_empty() { "info" } else { "warn" },
        "admin.media_migrated",
        serde_json::json!({
            "actor_id": actor,
            "provider": config.primary_provider,
            "migrated": migrated,
            "failures": failures.len()
        }),
    )
    .await;
    Ok(Json(serde_json::json!({
        "provider": config.primary_provider,
        "migrated": migrated,
        "failures": failures
    })))
}

pub async fn media_verify(
    State(db): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let config = media_store::load_config(&db)
        .await
        .map_err(ApiError::Storage)?;
    let sources: Vec<MediaSource> = sqlx::query_as(
        "SELECT id, content_hash, content_bytes, byte_size, mime_type, content_type,
                storage_backend, object_key, status, variants
         FROM media_assets
         WHERE storage_backend <> 'legacy' AND status = 'ready'
         ORDER BY id",
    )
    .fetch_all(&db)
    .await?;
    let mut checked = 0_u64;
    let mut failures = Vec::new();
    for source in sources {
        for variant in ["original", "thumbnail"] {
            let Ok(metadata) = source_variant(&source, variant) else {
                continue;
            };
            let mut targets = vec![(
                "primary".to_owned(),
                source.storage_backend.clone(),
                metadata.object_key.clone(),
            )];
            if config.secondary_provider != "disabled"
                && let Some((provider, object_key)) = sqlx::query_as::<_, (String, String)>(
                    "SELECT provider, object_key
                     FROM media_replicas
                     WHERE media_id = $1 AND role = 'secondary' AND provider = $3
                       AND variant = $2 AND state = 'ready' AND object_key IS NOT NULL
                     ORDER BY id DESC
                     LIMIT 1",
                )
                .bind(source.id)
                .bind(variant)
                .bind(&config.secondary_provider)
                .fetch_optional(&db)
                .await?
            {
                targets.push(("secondary".to_owned(), provider, object_key));
            }
            for (role, provider, object_key) in targets {
                if object_key.is_empty() {
                    failures.push(serde_json::json!({
                        "id": source.id,
                        "variant": variant,
                        "role": role,
                        "provider": provider,
                        "error": "missing object key"
                    }));
                    continue;
                }
                let result = media_store::read_primary(&config, &provider, &object_key)
                    .await
                    .and_then(|bytes| {
                        if media_store::checksum(&bytes) != metadata.checksum {
                            Err("checksum mismatch".to_owned())
                        } else {
                            Ok(bytes)
                        }
                    });
                match result {
                    Ok(_) => {
                        checked += 1;
                        sqlx::query(
                            "UPDATE media_replicas
                             SET last_verified_at = now(), updated_at = now(), state = 'ready', error = ''
                             WHERE media_id = $1 AND provider = $2 AND role = $3 AND variant = $4",
                        )
                        .bind(source.id)
                        .bind(&provider)
                        .bind(&role)
                        .bind(variant)
                        .execute(&db)
                        .await?;
                    }
                    Err(error) => failures.push(serde_json::json!({
                        "id": source.id,
                        "variant": variant,
                        "role": role,
                        "provider": provider,
                        "error": error
                    })),
                }
            }
        }
    }
    log_event(
        &db,
        if failures.is_empty() { "info" } else { "warn" },
        "admin.media_verified",
        serde_json::json!({
            "actor_id": actor,
            "checked": checked,
            "failures": failures.len()
        }),
    )
    .await;
    Ok(Json(serde_json::json!({
        "checked": checked,
        "failures": failures
    })))
}

pub async fn share_media(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<ShareMediaRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let variant = input.variant.as_deref().unwrap_or("original");
    let config = media_store::load_config(&db)
        .await
        .map_err(ApiError::Storage)?;
    let (source, metadata, bytes) = load_media_variant(&db, &config, id, variant).await?;
    let extension = metadata
        .mime_type
        .rsplit('/')
        .next()
        .filter(|value| value.len() <= 8)
        .unwrap_or("bin");
    let filename = format!("swartzit-{}-{}.{}", id, variant, extension);
    let (external_url, external_id) =
        media_store::share_catbox(&config, &bytes, &metadata.mime_type, &filename)
            .await
            .map_err(ApiError::Storage)?;
    sqlx::query(
        "INSERT INTO media_replicas
            (media_id, provider, role, variant, external_url, external_id,
             checksum, byte_size, mime_type, state, error, updated_at, last_verified_at)
         VALUES ($1, 'catbox', 'share', $2, $3, $4, $5, $6, $7, 'ready', '', now(), now())
         ON CONFLICT (media_id, provider, role, variant) DO UPDATE SET
            external_url = EXCLUDED.external_url,
            external_id = EXCLUDED.external_id,
            checksum = EXCLUDED.checksum,
            byte_size = EXCLUDED.byte_size,
            mime_type = EXCLUDED.mime_type,
            state = 'ready',
            error = '',
            updated_at = now(),
            last_verified_at = now()",
    )
    .bind(source.id)
    .bind(variant)
    .bind(&external_url)
    .bind(&external_id)
    .bind(media_store::checksum(&bytes))
    .bind(bytes.len() as i64)
    .bind(&metadata.mime_type)
    .execute(&db)
    .await?;
    log_event(
        &db,
        "info",
        "admin.media_shared",
        serde_json::json!({
            "actor_id": actor,
            "media_id": id,
            "variant": variant,
            "provider": "catbox"
        }),
    )
    .await;
    Ok(Json(serde_json::json!({
        "media_id": id,
        "variant": variant,
        "url": external_url,
        "external_id": external_id
    })))
}

pub async fn unshare_media(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let config = media_store::load_config(&db)
        .await
        .map_err(ApiError::Storage)?;
    let external_id: String = sqlx::query_scalar(
        "SELECT external_id FROM media_replicas
         WHERE media_id = $1 AND provider = 'catbox' AND role = 'share'
           AND variant = 'original' AND state = 'ready'",
    )
    .bind(id)
    .fetch_optional(&db)
    .await?
    .ok_or(ApiError::Missing)?;
    media_store::delete_catbox(&config, &external_id)
        .await
        .map_err(ApiError::Storage)?;
    sqlx::query(
        "UPDATE media_replicas
         SET state = 'deleted', updated_at = now(), last_verified_at = NULL
         WHERE media_id = $1 AND provider = 'catbox' AND role = 'share' AND variant = 'original'",
    )
    .bind(id)
    .execute(&db)
    .await?;
    log_event(
        &db,
        "info",
        "admin.media_unshared",
        serde_json::json!({"actor_id": actor, "media_id": id, "provider": "catbox"}),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

/// The worker calls this after a host-side command has produced its JSON
/// receipt. It intentionally enters the normal moderation queue; enabling a
/// runner never silently bypasses review.
pub async fn publish_content_runner(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<RunnerPost>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&headers, &db).await?;
    let title = input.title.trim();
    let body = input.body.clone().unwrap_or_default();
    let content_rating = input
        .content_rating
        .as_deref()
        .map(|rating| validate_content_rating(Some(rating)))
        .transpose()?;
    let content_rating_value = content_rating
        .clone()
        .unwrap_or_else(|| "general".to_owned());
    let author = input.author.trim();
    let community = input.community.trim().to_ascii_lowercase();
    let provider = input
        .provider
        .clone()
        .unwrap_or_else(|| "runner".to_owned())
        .trim()
        .to_ascii_lowercase();
    let source_url = input
        .source_url
        .clone()
        .filter(|source| !source.trim().is_empty());
    let canonical_source = match (provider.as_str(), source_url.as_deref()) {
        ("runner", source) => source.map(str::to_owned),
        (_, Some(source)) => Some(imports::canonical(&provider, source)?),
        (_, None) => {
            return Err(ApiError::Invalid(
                "A provider-backed runner post needs a source URL",
            ));
        }
    };
    if !["runner", "x", "reddit", "rss", "commons"].contains(&provider.as_str()) {
        return Err(ApiError::Invalid("Runner provider is not supported"));
    }
    let source_author = input
        .source_author
        .clone()
        .unwrap_or_else(|| author.to_owned());
    let media = input.media.clone().unwrap_or_else(|| serde_json::json!([]));
    let source_comments = input
        .source_comments
        .clone()
        .unwrap_or_else(|| serde_json::json!([]));
    let attribution = input
        .attribution
        .clone()
        .unwrap_or_else(|| "Generated by a configured Swartzit content runner".to_owned());
    let generation_config = input
        .generation_config
        .clone()
        .unwrap_or_else(|| serde_json::json!({}));
    if title.is_empty() || title.len() > 300 || body.len() > 50000 {
        return Err(ApiError::Invalid(
            "Runner post title or body is outside the allowed length",
        ));
    }
    if source_author.trim().is_empty() || source_author.len() > 200 {
        return Err(ApiError::Invalid("Runner source author is invalid"));
    }
    if !media.is_array() || media.as_array().is_some_and(|media| media.len() > 8) {
        return Err(ApiError::Invalid(
            "Runner posts may contain at most 8 media items",
        ));
    }
    if !source_comments.is_array()
        || source_comments
            .as_array()
            .is_some_and(|comments| comments.len() > 50)
    {
        return Err(ApiError::Invalid("Runner source comments are too large"));
    }
    if attribution.len() > 2000 {
        return Err(ApiError::Invalid("Runner attribution is too long"));
    }
    if !generation_config.is_object() {
        return Err(ApiError::Invalid(
            "Runner generation settings must be an object",
        ));
    }
    if [
        input.source_views,
        input.source_likes,
        input.source_reposts,
        input.source_replies,
    ]
    .into_iter()
    .flatten()
    .any(|value| !(0..=9_007_199_254_740_991).contains(&value))
    {
        return Err(ApiError::Invalid(
            "Runner metrics must be nonnegative safe integers",
        ));
    }
    if provider == "x" {
        let typed_media: Vec<imports::Media> = serde_json::from_value(media.clone())
            .map_err(|_| ApiError::Invalid("X runner media is invalid"))?;
        for item in &typed_media {
            imports::validate_media(item, "x")?;
        }
    }
    let author_id: i64 = sqlx::query_scalar("SELECT id FROM authors WHERE handle=$1")
        .bind(author)
        .fetch_optional(&db)
        .await?
        .ok_or(ApiError::Missing)?;
    let community_id: i64 = sqlx::query_scalar("SELECT id FROM communities WHERE slug=$1")
        .bind(&community)
        .fetch_optional(&db)
        .await?
        .ok_or(ApiError::Missing)?;
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
    let mut tx = db.begin().await?;
    if let Some(source) = canonical_source.as_ref() {
        let existing_id = sqlx::query_scalar::<_, i64>(
            "SELECT post_id FROM external_posts WHERE source_url=$1 FOR UPDATE",
        )
        .bind(source)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(existing_id) = existing_id {
            sqlx::query(
                "UPDATE external_posts SET provider=$2,source_author=$3,
                 published_at=COALESCE($4,published_at),observed_at=now(),
                 source_views=COALESCE($5,source_views),source_likes=COALESCE($6,source_likes),
                 source_reposts=COALESCE($7,source_reposts),source_replies=COALESCE($8,source_replies),
                 media=$9,source_comments=$10,attribution=$11,profile_image_url=$12,
                 profile_url=$13,profile_display_name=$14,profile_bio=$15,
                 profile_followers=$16,profile_following=$17,profile_verified=$18,
                 generation_config=$19 WHERE post_id=$1",
            )
            .bind(existing_id)
            .bind(&provider)
            .bind(&source_author)
            .bind(input.published_at)
            .bind(input.source_views)
            .bind(input.source_likes)
            .bind(input.source_reposts)
            .bind(input.source_replies)
            .bind(&media)
            .bind(&source_comments)
            .bind(&attribution)
            .bind(&input.profile_image_url)
            .bind(&input.profile_url)
            .bind(&input.profile_display_name)
            .bind(&input.profile_bio)
            .bind(input.profile_followers)
            .bind(input.profile_following)
            .bind(input.profile_verified)
            .bind(&generation_config)
            .execute(&mut *tx)
            .await?;
            if let Some(rating) = content_rating.as_deref() {
                sqlx::query("UPDATE posts SET content_rating=$2,content_rating_source='automatic',content_rating_confidence=NULL,content_rating_updated_at=now() WHERE id=$1")
                    .bind(existing_id)
                    .bind(rating)
                    .execute(&mut *tx)
                    .await?;
            }
            tx.commit().await?;
            log_event(
                &db,
                "info",
                "runner.post_deduplicated",
                serde_json::json!({"post_id":existing_id,"provider":provider}),
            )
            .await;
            return Ok(Json(serde_json::json!({
                "post_id": existing_id,
                "status": "existing",
                "moderation_id": null,
                "flags": []
            })));
        }
    }
    let publication_status = if moderation_enabled {
        "pending"
    } else {
        "approved"
    };
    let post_id:i64=sqlx::query_scalar("INSERT INTO posts(community_id,author_id,title,body,content_rating,content_rating_source,moderation_status) VALUES($1,$2,$3,$4,$5,'automatic',$6) RETURNING id").bind(community_id).bind(author_id).bind(title).bind(body.trim()).bind(&content_rating_value).bind(publication_status).fetch_one(&mut *tx).await?;
    let moderation_id = if moderation_enabled {
        let moderation_id:i64=sqlx::query_scalar("INSERT INTO moderation_items(kind,target_id,author_id,status,severity,flags,rule_version,urgent) VALUES('post',$1,$2,'pending',$3,$4,$5,$6) RETURNING id").bind(post_id).bind(author_id).bind(&severity).bind(flags.clone()).bind(moderation::RULE_VERSION).bind(urgent).fetch_one(&mut *tx).await?;
        sqlx::query("UPDATE posts SET moderation_item_id=$2 WHERE id=$1")
            .bind(post_id)
            .bind(moderation_id)
            .execute(&mut *tx)
            .await?;
        Some(moderation_id)
    } else {
        None
    };
    if let Some(source) = canonical_source {
        sqlx::query("INSERT INTO external_posts(post_id,provider,source_url,source_author,published_at,observed_at,source_views,source_likes,source_reposts,source_replies,media,source_comments,attribution,profile_image_url,profile_url,profile_display_name,profile_bio,profile_followers,profile_following,profile_verified,generation_config) VALUES($1,$2,$3,$4,$5,now(),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)")
            .bind(post_id)
            .bind(&provider)
            .bind(source)
            .bind(&source_author)
            .bind(input.published_at)
            .bind(input.source_views)
            .bind(input.source_likes)
            .bind(input.source_reposts)
            .bind(input.source_replies)
            .bind(&media)
            .bind(&source_comments)
            .bind(&attribution)
            .bind(&input.profile_image_url)
            .bind(&input.profile_url)
            .bind(&input.profile_display_name)
            .bind(&input.profile_bio)
            .bind(input.profile_followers)
            .bind(input.profile_following)
            .bind(input.profile_verified)
            .bind(&generation_config)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    operations::clear_public_cache();
    log_event(
        &db,
        "info",
        "runner.post_submitted",
        serde_json::json!({"post_id":post_id,"author_id":author_id,"community":community,"provider":provider,"moderation":if moderation_enabled {"enabled"} else {"disabled"}}),
    )
    .await;
    Ok(Json(
        serde_json::json!({"post_id":post_id,"status":publication_status,"moderation_id":moderation_id,"flags":flags}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runner_policy_bounds_are_enforced() {
        assert!(validate_runner_policy(300, 0, 30, 1, 10, 1, 1).is_ok());
        assert!(validate_runner_policy(299, 0, 30, 1, 10, 1, 1).is_err());
        assert!(validate_runner_policy(300, 10_001, 30, 1, 10, 1, 1).is_err());
        assert!(validate_runner_policy(300, 0, 30, 11, 10, 1, 1).is_err());
    }

    #[test]
    fn runner_environment_allowlist_rejects_secret_shaped_names() {
        assert!(
            validate_environment_keys(&serde_json::json!(["DRAW_THINGS_HOME", "MODEL_1"])).is_ok()
        );
        assert!(validate_environment_keys(&serde_json::json!(["draw_things_home"])).is_err());
        assert!(validate_environment_keys(&serde_json::json!(["DB-PASSWORD"])).is_err());
    }

    #[test]
    fn runner_commands_are_argv_only() {
        assert!(
            validate_runner_command(&serde_json::json!(["draw-things-cli", "generate"])).is_ok()
        );
        assert!(validate_runner_command(&serde_json::json!([])).is_err());
        assert!(validate_runner_command(&serde_json::json!("draw-things-cli generate")).is_err());
    }

    #[test]
    fn draw_things_configuration_accepts_loras_and_rejects_bad_ranges() {
        let config = serde_json::json!({
            "executable": "draw-things-cli",
            "models_dir": "~/DrawThings/Models",
            "model": "flux_1_schnell_q5p.ckpt",
            "width": 1024,
            "height": 1024,
            "steps": 4,
            "cfg": 3.5,
            "seed": 42,
            "loras": [{"file": "style.ckpt", "version": "flux1", "weight": 0.8}],
            "posts_per_run": 2,
            "output_path": "~/DrawThings/lighthouse-{index}.png"
        });
        assert!(validate_runner_definition("draw_things", &config).is_ok());
        assert!(
            validate_runner_definition(
                "draw_things",
                &serde_json::json!({"executable":"draw-things-cli","model":"flux.ckpt","width":8})
            )
            .is_err()
        );
    }

    #[test]
    fn runner_days_are_unique_iso_weekdays() {
        assert!(validate_days_of_week(&serde_json::json!([1, 3, 7])).is_ok());
        assert!(validate_days_of_week(&serde_json::json!([])).is_err());
        assert!(validate_days_of_week(&serde_json::json!([1, 1])).is_err());
        assert!(validate_days_of_week(&serde_json::json!([0, 7])).is_err());
    }
}
