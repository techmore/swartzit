use super::*;
use url::Url;

#[derive(Deserialize)]
pub struct Import {
    pub community: String,
    pub provider: String,
    pub source_url: String,
    pub source_author: String,
    pub title: String,
    pub body: String,
    pub published_at: Option<DateTime<Utc>>,
    pub observed_at: DateTime<Utc>,
    pub source_views: Option<i64>,
    pub source_likes: Option<i64>,
    pub source_reposts: Option<i64>,
    pub source_replies: Option<i64>,
    #[serde(default)]
    pub media: Vec<String>,
    #[serde(default)]
    pub attribution: String,
}
fn https(raw: &str) -> Result<Url, ApiError> {
    let u = Url::parse(raw).map_err(|_| ApiError::Invalid("Invalid source URL"))?;
    if raw.len() > 2048
        || u.scheme() != "https"
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
        || u.port().is_some()
    {
        return Err(ApiError::Invalid(
            "Source URLs must use HTTPS without credentials or a custom port",
        ));
    }
    Ok(u)
}
fn canonical(provider: &str, raw: &str) -> Result<String, ApiError> {
    let u = https(raw)?;
    match provider {
        "x" if ["x.com", "www.x.com", "twitter.com", "www.twitter.com"]
            .contains(&u.host_str().unwrap_or("")) =>
        {
            let p: Vec<_> = u.path().split('/').filter(|s| !s.is_empty()).collect();
            if p.len() == 3
                && p[1] == "status"
                && !p[2].is_empty()
                && p[2].len() <= 24
                && p[2].bytes().all(|b| b.is_ascii_digit())
            {
                return Ok(format!("https://x.com/i/status/{}", p[2]));
            }
        }
        "commons"
            if u.host_str() == Some("commons.wikimedia.org")
                && u.path().starts_with("/wiki/File:") =>
        {
            let mut u = u;
            u.set_query(None);
            u.set_fragment(None);
            return Ok(u.to_string());
        }
        _ => {}
    }
    Err(ApiError::Invalid(
        "Use an X status URL or a Wikimedia Commons File page",
    ))
}
pub async fn ingest(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<Import>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor = require_admin(&headers, &db).await?;
    let source = canonical(&input.provider, &input.source_url)?;
    if input.title.trim().is_empty()
        || input.title.len() > 300
        || input.body.len() > 50000
        || input.source_author.trim().is_empty()
        || input.source_author.len() > 200
        || input.attribution.len() > 2000
        || input.media.len() > 8
        || input.observed_at > Utc::now() + chrono::Duration::minutes(5)
    {
        return Err(ApiError::Invalid("Imported content exceeds allowed bounds"));
    }
    for n in [
        input.source_views,
        input.source_likes,
        input.source_reposts,
        input.source_replies,
    ]
    .into_iter()
    .flatten()
    {
        if !(0..=9_007_199_254_740_991).contains(&n) {
            return Err(ApiError::Invalid(
                "Metrics must be nonnegative safe integers or null",
            ));
        }
    }
    for media in &input.media {
        let u = https(media)?;
        if !matches!(
            (u.host_str(), input.provider.as_str()),
            (Some("pbs.twimg.com"), "x") | (Some("upload.wikimedia.org"), "commons")
        ) {
            return Err(ApiError::Invalid(
                "Media must use the source platform's public image CDN",
            ));
        }
    }
    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(&source)
        .execute(&mut *tx)
        .await?;
    let community: Option<i64> = sqlx::query_scalar("SELECT id FROM communities WHERE slug=$1")
        .bind(&input.community)
        .fetch_optional(&mut *tx)
        .await?;
    let community = community.ok_or(ApiError::Invalid("Community not found"))?;
    let existing: Option<i64> =
        sqlx::query_scalar("SELECT post_id FROM external_posts WHERE source_url=$1")
            .bind(&source)
            .fetch_optional(&mut *tx)
            .await?;
    let id = if let Some(id) = existing {
        id
    } else {
        sqlx::query_scalar(
            "INSERT INTO posts(community_id,author_id,title,body) VALUES($1,$2,$3,$4) RETURNING id",
        )
        .bind(community)
        .bind(actor)
        .bind(input.title.trim())
        .bind(&input.body)
        .fetch_one(&mut *tx)
        .await?
    };
    let changed=sqlx::query("INSERT INTO external_posts(post_id,provider,source_url,source_author,published_at,observed_at,source_views,source_likes,source_reposts,source_replies,media,attribution) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(post_id) DO UPDATE SET source_author=EXCLUDED.source_author,published_at=COALESCE(EXCLUDED.published_at,external_posts.published_at),observed_at=EXCLUDED.observed_at,source_views=EXCLUDED.source_views,source_likes=EXCLUDED.source_likes,source_reposts=EXCLUDED.source_reposts,source_replies=EXCLUDED.source_replies,media=EXCLUDED.media,attribution=EXCLUDED.attribution WHERE EXCLUDED.observed_at>=external_posts.observed_at")
        .bind(id).bind(&input.provider).bind(&source).bind(&input.source_author).bind(input.published_at).bind(input.observed_at).bind(input.source_views).bind(input.source_likes).bind(input.source_reposts).bind(input.source_replies).bind(serde_json::json!(input.media)).bind(&input.attribution).execute(&mut *tx).await?.rows_affected()>0;
    if changed {
        sqlx::query("UPDATE posts SET title=$2,body=$3 WHERE id=$1")
            .bind(id)
            .bind(input.title.trim())
            .bind(&input.body)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    log_event(&db,"info","admin.source_import",serde_json::json!({"actor_id":actor,"post_id":id,"created":existing.is_none(),"updated":changed})).await;
    Ok(Json(
        serde_json::json!({"id":id,"created":existing.is_none(),"updated":changed}),
    ))
}
pub fn order(sort: Option<&str>) -> Result<&'static str, ApiError> {
    Ok(match sort.unwrap_or("newest") {
        "newest" => "p.created_at DESC",
        "score" => "score DESC",
        "comments" => "comment_count DESC",
        "views" => "p.view_count DESC",
        "engaged" => "p.engaged_view_count DESC",
        "source_views" => {
            "(SELECT source_views FROM external_posts WHERE post_id=p.id) DESC NULLS LAST"
        }
        "source_likes" => {
            "(SELECT source_likes FROM external_posts WHERE post_id=p.id) DESC NULLS LAST"
        }
        "source_reposts" => {
            "(SELECT source_reposts FROM external_posts WHERE post_id=p.id) DESC NULLS LAST"
        }
        "source_replies" => {
            "(SELECT source_replies FROM external_posts WHERE post_id=p.id) DESC NULLS LAST"
        }
        _ => return Err(ApiError::Invalid("Unknown sort order")),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canonical_identity() {
        assert_eq!(
            canonical("x", "https://twitter.com/person/status/123?s=20").unwrap(),
            "https://x.com/i/status/123"
        );
        for u in [
            "https://x.com.evil.test/a/status/123",
            "http://x.com/a/status/123",
            "https://user:pass@x.com/a/status/123",
            "https://x.com/a/status/no",
        ] {
            assert!(canonical("x", u).is_err());
        }
        assert!(order(Some("score; DROP TABLE posts")).is_err());
    }
}
