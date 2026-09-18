use super::*;

#[derive(Deserialize)]
pub struct ViewInput {
    visit_id: String,
    visible_seconds: i16,
}
#[derive(Serialize, FromRow)]
pub struct ViewCounts {
    pub view_count: i64,
    pub engaged_view_count: i64,
    pub deep_view_count: i64,
}
pub async fn record(
    State(db): State<PgPool>,
    Path(id): Path<i64>,
    Json(input): Json<ViewInput>,
) -> Result<Json<ViewCounts>, ApiError> {
    if input.visit_id.len() != 64
        || !input.visit_id.bytes().all(|b| b.is_ascii_hexdigit())
        || ![0, 10, 30].contains(&input.visible_seconds)
    {
        return Err(ApiError::Invalid(
            "Provide a 64-character hex visit_id and visible_seconds of 0, 10, or 30",
        ));
    }
    let hash = Sha256::digest(input.visit_id.to_ascii_lowercase().as_bytes()).to_vec();
    let mut tx = db.begin().await?;
    // Lock the parent first: all milestones for a post use one consistent order.
    let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM posts WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    if exists.is_none() {
        return Err(ApiError::Missing);
    }
    // Bounded cleanup work per write; aggregate counters survive expiry.
    sqlx::query("DELETE FROM post_view_visits WHERE (post_id,visit_hash) IN (SELECT post_id,visit_hash FROM post_view_visits WHERE started_at<now()-interval '1 hour' ORDER BY started_at LIMIT 100)").execute(&mut *tx).await?;
    let added = if input.visible_seconds == 0 {
        sqlx::query("INSERT INTO post_view_visits(post_id,visit_hash) VALUES ($1,$2) ON CONFLICT DO NOTHING").bind(id).bind(&hash).execute(&mut *tx).await?.rows_affected() as i64
    } else {
        0
    };
    let visit: Option<(i16, DateTime<Utc>)> = sqlx::query_as(
        "SELECT seconds,started_at FROM post_view_visits WHERE post_id=$1 AND visit_hash=$2",
    )
    .bind(id)
    .bind(&hash)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((previous, started)) = visit else {
        return Err(ApiError::Invalid(
            "Start a view before reporting engagement",
        ));
    };
    if input.visible_seconds > previous
        && (Utc::now() - started).num_seconds() < i64::from(input.visible_seconds)
    {
        return Err(ApiError::Invalid("Engagement milestone arrived too early"));
    }
    let next = previous.max(input.visible_seconds);
    sqlx::query("UPDATE post_view_visits SET seconds=$3 WHERE post_id=$1 AND visit_hash=$2")
        .bind(id)
        .bind(&hash)
        .bind(next)
        .execute(&mut *tx)
        .await?;
    let counts=sqlx::query_as::<_,ViewCounts>("UPDATE posts SET view_count=view_count+$2,engaged_view_count=engaged_view_count+$3,deep_view_count=deep_view_count+$4 WHERE id=$1 RETURNING view_count,engaged_view_count,deep_view_count")
        .bind(id).bind(added).bind(i64::from(previous<10 && next>=10)).bind(i64::from(previous<30 && next>=30)).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(counts))
}
