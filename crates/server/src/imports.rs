use super::*;
use url::Url;

#[derive(Deserialize, Serialize)]
#[serde(untagged)]
pub enum Media {
    Image(String),
    Attachment {
        kind: String,
        src: String,
        poster: Option<String>,
        alt: Option<String>,
    },
}
fn validate_media(media: &Media, provider: &str) -> Result<(), ApiError> {
    let (kind, src, poster, alt) = match media {
        Media::Image(src) => ("image", src, None, None),
        Media::Attachment {
            kind,
            src,
            poster,
            alt,
        } => (kind.as_str(), src, poster.as_ref(), alt.as_ref()),
    };
    let u = https(src)?;
    let valid = matches!(
        (provider, kind, u.host_str()),
        ("x", "image", Some("pbs.twimg.com"))
            | ("commons", "image", Some("upload.wikimedia.org"))
            | ("reddit", "image", Some("i.redd.it"))
            | ("reddit", "image", Some("preview.redd.it"))
            | ("reddit", "video", Some("v.redd.it"))
    ) || (provider == "x"
        && kind == "video"
        && u.host_str() == Some("video.twimg.com")
        && u.path().ends_with(".mp4"));
    if !valid || alt.is_some_and(|s| s.len() > 1000) {
        return Err(ApiError::Invalid("Invalid source media"));
    }
    if let Some(poster) = poster {
        let poster_url = https(poster)?;
        let poster_host = poster_url.host_str().unwrap_or("");
        let valid_poster = kind == "video"
            && ((provider == "x" && poster_host == "pbs.twimg.com")
                || (provider == "reddit"
                    && matches!(poster_host, "i.redd.it" | "preview.redd.it")));
        if !valid_poster {
            return Err(ApiError::Invalid("Invalid video poster"));
        }
    }
    Ok(())
}

#[derive(Deserialize, Serialize)]
pub struct SourceComment {
    pub author: String,
    pub body: String,
    pub score: Option<i64>,
    pub created_at: Option<DateTime<Utc>>,
}

fn validate_source_comments(comments: &[SourceComment]) -> Result<(), ApiError> {
    if comments.len() > 50
        || comments.iter().any(|comment| {
            comment.author.trim().is_empty()
                || comment.author.len() > 200
                || comment.body.trim().is_empty()
                || comment.body.len() > 5000
                || comment
                    .score
                    .is_some_and(|score| !(0..=9_007_199_254_740_991).contains(&score))
        })
    {
        return Err(ApiError::Invalid(
            "Imported source comments exceed allowed bounds",
        ));
    }
    Ok(())
}

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
    pub media: Vec<Media>,
    #[serde(default)]
    pub attribution: String,
    #[serde(default)]
    pub source_comments: Vec<SourceComment>,
    pub profile_image_url: Option<String>,
    pub profile_url: Option<String>,
    pub profile_display_name: Option<String>,
    pub profile_bio: Option<String>,
    pub profile_followers: Option<i64>,
    pub profile_following: Option<i64>,
    pub profile_verified: Option<bool>,
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
        "reddit"
            if ["reddit.com", "www.reddit.com", "old.reddit.com"]
                .contains(&u.host_str().unwrap_or("")) =>
        {
            let parts: Vec<_> = u.path().split('/').filter(|s| !s.is_empty()).collect();
            let is_subreddit_post = parts.len() >= 4
                && parts[0].eq_ignore_ascii_case("r")
                && !parts[1].is_empty()
                && parts[2].eq_ignore_ascii_case("comments")
                && !parts[3].is_empty()
                && parts[3].len() <= 16
                && parts[3].bytes().all(|byte| byte.is_ascii_alphanumeric());
            let is_global_post = parts.len() >= 2
                && parts[0].eq_ignore_ascii_case("comments")
                && !parts[1].is_empty()
                && parts[1].len() <= 16
                && parts[1].bytes().all(|byte| byte.is_ascii_alphanumeric());
            if is_subreddit_post || is_global_post {
                let mut u = u;
                u.set_scheme("https").ok();
                u.set_host(Some("www.reddit.com")).ok();
                u.set_query(None);
                u.set_fragment(None);
                return Ok(u.to_string().trim_end_matches('/').to_owned());
            }
        }
        "reddit" if u.host_str() == Some("redd.it") => {
            let parts: Vec<_> = u.path().split('/').filter(|s| !s.is_empty()).collect();
            if parts.len() == 1
                && parts[0].len() <= 16
                && parts[0].bytes().all(|byte| byte.is_ascii_alphanumeric())
            {
                return Ok(format!("https://www.reddit.com/comments/{}", parts[0]));
            }
        }
        "rss" => {
            let mut u = u;
            u.set_query(None);
            u.set_fragment(None);
            return Ok(u.to_string());
        }
        _ => {}
    }
    Err(ApiError::Invalid(
        "Use a supported X, Reddit, RSS, or Wikimedia Commons source URL",
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
        validate_media(media, &input.provider)?;
    }
    validate_source_comments(&input.source_comments)?;
    if let Some(url) = &input.profile_image_url {
        let u = https(url)?;
        if input.provider != "x"
            || u.host_str() != Some("pbs.twimg.com")
            || !u.path().contains("/profile_images/")
        {
            return Err(ApiError::Invalid("Invalid profile image source"));
        }
    }
    if let Some(url) = &input.profile_url {
        let u = https(url)?;
        if input.provider != "x"
            || !matches!(u.host_str(), Some("x.com") | Some("www.x.com"))
            || u.path().split('/').filter(|s| !s.is_empty()).count() != 1
        {
            return Err(ApiError::Invalid("Invalid profile URL"));
        }
    }
    if input
        .profile_display_name
        .as_ref()
        .is_some_and(|s| s.len() > 200)
        || input.profile_bio.as_ref().is_some_and(|s| s.len() > 2000)
        || [input.profile_followers, input.profile_following]
            .into_iter()
            .flatten()
            .any(|n| !(0..=9_007_199_254_740_991).contains(&n))
    {
        return Err(ApiError::Invalid("Invalid profile metadata"));
    }
    let analysis = analyze_user_content(
        &db,
        actor,
        &format!("{}\n{}", input.title.trim(), input.body),
    )
    .await?;
    let analysis_flags = flags_json(&analysis);
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
    let created = existing.is_none();
    let id = if let Some(id) = existing {
        id
    } else {
        sqlx::query_scalar(
            "INSERT INTO posts(community_id,author_id,title,body,moderation_status)
             VALUES($1,$2,$3,$4,'pending') RETURNING id",
        )
        .bind(community)
        .bind(actor)
        .bind(input.title.trim())
        .bind(&input.body)
        .fetch_one(&mut *tx)
        .await?
    };
    let (moderation_id, moderation_severity, moderation_flags) = if created {
        let moderation_id: i64 = sqlx::query_scalar(
            "INSERT INTO moderation_items(
               kind, target_id, author_id, status, severity, flags, rule_version, urgent
             ) VALUES ('post', $1, $2, 'pending', $3, $4, $5, $6)
             RETURNING id",
        )
        .bind(id)
        .bind(actor)
        .bind(&analysis.severity)
        .bind(analysis_flags.clone())
        .bind(moderation::RULE_VERSION)
        .bind(analysis.urgent)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query("UPDATE posts SET moderation_item_id = $2 WHERE id = $1")
            .bind(id)
            .bind(moderation_id)
            .execute(&mut *tx)
            .await?;
        (Some(moderation_id), analysis.severity, analysis_flags)
    } else {
        (None, "none".to_owned(), serde_json::json!([]))
    };
    let changed=sqlx::query("INSERT INTO external_posts(post_id,provider,source_url,source_author,published_at,observed_at,source_views,source_likes,source_reposts,source_replies,media,source_comments,attribution,profile_image_url,profile_url,profile_display_name,profile_bio,profile_followers,profile_following,profile_verified) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT(post_id) DO UPDATE SET source_author=EXCLUDED.source_author,published_at=COALESCE(EXCLUDED.published_at,external_posts.published_at),observed_at=EXCLUDED.observed_at,source_views=EXCLUDED.source_views,source_likes=EXCLUDED.source_likes,source_reposts=EXCLUDED.source_reposts,source_replies=EXCLUDED.source_replies,media=EXCLUDED.media,source_comments=EXCLUDED.source_comments,attribution=EXCLUDED.attribution,profile_image_url=COALESCE(EXCLUDED.profile_image_url,external_posts.profile_image_url),profile_url=COALESCE(EXCLUDED.profile_url,external_posts.profile_url),profile_display_name=COALESCE(EXCLUDED.profile_display_name,external_posts.profile_display_name),profile_bio=COALESCE(EXCLUDED.profile_bio,external_posts.profile_bio),profile_followers=COALESCE(EXCLUDED.profile_followers,external_posts.profile_followers),profile_following=COALESCE(EXCLUDED.profile_following,external_posts.profile_following),profile_verified=COALESCE(EXCLUDED.profile_verified,external_posts.profile_verified) WHERE EXCLUDED.observed_at>=external_posts.observed_at")
        .bind(id).bind(&input.provider).bind(&source).bind(&input.source_author).bind(input.published_at).bind(input.observed_at).bind(input.source_views).bind(input.source_likes).bind(input.source_reposts).bind(input.source_replies).bind(serde_json::json!(input.media)).bind(serde_json::json!(input.source_comments)).bind(&input.attribution).bind(&input.profile_image_url).bind(&input.profile_url).bind(&input.profile_display_name).bind(&input.profile_bio).bind(input.profile_followers).bind(input.profile_following).bind(input.profile_verified).execute(&mut *tx).await?.rows_affected()>0;
    if changed {
        sqlx::query("UPDATE posts SET title=$2,body=$3 WHERE id=$1")
            .bind(id)
            .bind(input.title.trim())
            .bind(&input.body)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    log_event(&db,"info","admin.source_import",serde_json::json!({"actor_id":actor,"post_id":id,"created":created,"updated":changed,"moderation_id":moderation_id,"status":if created {"pending"} else {"existing"}})).await;
    Ok(Json(
        serde_json::json!({"id":id,"created":created,"updated":changed,"status":if created {"pending"} else {"existing"},"moderation_id":moderation_id,"severity":moderation_severity,"flags":moderation_flags}),
    ))
}

pub async fn cross_post(
    State(db): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<Import>,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    let actor = active_author(&headers, &db).await?;
    if !matches!(input.provider.as_str(), "x" | "reddit") {
        return Err(ApiError::Invalid(
            "Only public X or Reddit post links are supported",
        ));
    }
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
    for value in [
        input.source_views,
        input.source_likes,
        input.source_reposts,
        input.source_replies,
    ]
    .into_iter()
    .flatten()
    {
        if !(0..=9_007_199_254_740_991).contains(&value) {
            return Err(ApiError::Invalid(
                "Metrics must be nonnegative safe integers or null",
            ));
        }
    }
    for media in &input.media {
        validate_media(media, &input.provider)?;
    }
    validate_source_comments(&input.source_comments)?;
    if let Some(url) = &input.profile_image_url {
        let u = https(url)?;
        if u.host_str() != Some("pbs.twimg.com") || !u.path().contains("/profile_images/") {
            return Err(ApiError::Invalid("Invalid profile image source"));
        }
    }
    if let Some(url) = &input.profile_url {
        let u = https(url)?;
        if !matches!(u.host_str(), Some("x.com") | Some("www.x.com"))
            || u.path().split('/').filter(|part| !part.is_empty()).count() != 1
        {
            return Err(ApiError::Invalid("Invalid profile URL"));
        }
    }
    if input
        .profile_display_name
        .as_ref()
        .is_some_and(|s| s.len() > 200)
        || input.profile_bio.as_ref().is_some_and(|s| s.len() > 2000)
        || [input.profile_followers, input.profile_following]
            .into_iter()
            .flatten()
            .any(|n| !(0..=9_007_199_254_740_991).contains(&n))
    {
        return Err(ApiError::Invalid("Invalid profile metadata"));
    }

    let community_slug = input.community.trim().to_ascii_lowercase();
    let analysis = analyze_user_content(
        &db,
        actor,
        &format!("{}\n{}", input.title.trim(), input.body),
    )
    .await?;
    let flags = flags_json(&analysis);
    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(&source)
        .execute(&mut *tx)
        .await?;
    let existing: Option<(String, String)> = sqlx::query_as(
        "SELECT p.public_id,c.slug FROM external_posts e JOIN posts p ON p.id=e.post_id JOIN communities c ON c.id=p.community_id WHERE e.source_url=$1"
    ).bind(&source).fetch_optional(&mut *tx).await?;
    if let Some((public_id, community)) = existing {
        tx.rollback().await?;
        return Ok((
            StatusCode::OK,
            Json(serde_json::json!({
                "already_shared": true, "public_id": public_id, "community": community
            })),
        ));
    }
    let community_id: Option<i64> = sqlx::query_scalar("SELECT id FROM communities WHERE slug=$1")
        .bind(&community_slug)
        .fetch_optional(&mut *tx)
        .await?;
    let community_id = community_id.ok_or(ApiError::Invalid("Community not found"))?;
    let (id, public_id): (i64, String) = sqlx::query_as(
        "INSERT INTO posts(community_id,author_id,title,body,moderation_status)
         VALUES($1,$2,$3,$4,'pending') RETURNING id,public_id",
    )
    .bind(community_id)
    .bind(actor)
    .bind(input.title.trim())
    .bind(&input.body)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO external_posts(post_id,provider,source_url,source_author,published_at,observed_at,source_views,source_likes,source_reposts,source_replies,media,source_comments,attribution,profile_image_url,profile_url,profile_display_name,profile_bio,profile_followers,profile_following,profile_verified) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)")
        .bind(id).bind(&input.provider).bind(&source).bind(&input.source_author).bind(input.published_at).bind(input.observed_at)
        .bind(input.source_views).bind(input.source_likes).bind(input.source_reposts).bind(input.source_replies)
        .bind(serde_json::json!(input.media)).bind(serde_json::json!(input.source_comments)).bind(&input.attribution).bind(&input.profile_image_url)
        .bind(&input.profile_url).bind(&input.profile_display_name).bind(&input.profile_bio)
        .bind(input.profile_followers).bind(input.profile_following).bind(input.profile_verified)
        .execute(&mut *tx).await?;
    let moderation_id: i64 = sqlx::query_scalar(
        "INSERT INTO moderation_items(
           kind, target_id, author_id, status, severity, flags, rule_version, urgent
         ) VALUES ('post', $1, $2, 'pending', $3, $4, $5, $6)
         RETURNING id",
    )
    .bind(id)
    .bind(actor)
    .bind(&analysis.severity)
    .bind(flags.clone())
    .bind(moderation::RULE_VERSION)
    .bind(analysis.urgent)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("UPDATE posts SET moderation_item_id = $2 WHERE id = $1")
        .bind(id)
        .bind(moderation_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    log_event(
        &db,
        "info",
        "source.cross_posted",
        serde_json::json!({
            "actor_id": actor, "post_id": id, "community": community_slug, "provider": input.provider,
            "moderation_id": moderation_id, "severity": analysis.severity, "urgent": analysis.urgent
        }),
    )
    .await;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": id, "public_id": public_id, "created": true,
            "already_shared": false, "community": community_slug,
            "status": "pending", "moderation_id": moderation_id,
            "severity": analysis.severity, "flags": flags,
            "message": "The shared post is waiting for moderator review."
        })),
    ))
}

pub fn order(sort: Option<&str>) -> Result<&'static str, ApiError> {
    Ok(match sort.unwrap_or("newest") {
        "recommended" => {
            "(2.0*LN(1.0+p.engaged_view_count)+1.5*LN(1.0+(SELECT count(*) FROM comments cm WHERE cm.post_id=p.id))+LN(1.0+GREATEST(0,(SELECT COALESCE(sum(value),0) FROM post_votes v WHERE v.post_id=p.id)))+0.5*LN(1.0+p.view_count))/(1.0+GREATEST(0.0,EXTRACT(EPOCH FROM(now()-p.created_at))/604800.0)) DESC"
        }
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
    fn media_validation() {
        let video = |src: &str| Media::Attachment {
            kind: "video".into(),
            src: src.into(),
            poster: Some("https://pbs.twimg.com/poster.jpg".into()),
            alt: None,
        };
        assert!(validate_media(&video("https://video.twimg.com/clip.mp4"), "x").is_ok());
        for url in [
            "https://evil.test/clip.mp4",
            "https://video.twimg.com.evil.test/clip.mp4",
            "blob:https://x.com/id",
            "https://video.twimg.com/clip.m3u8",
        ] {
            assert!(validate_media(&video(url), "x").is_err());
        }
        assert!(validate_media(&video("https://video.twimg.com/clip.mp4"), "commons").is_err());
        assert!(
            validate_media(&Media::Image("https://pbs.twimg.com/photo.jpg".into()), "x").is_ok()
        );
        let reddit_video = Media::Attachment {
            kind: "video".into(),
            src: "https://v.redd.it/clip/DASH_720.mp4?source=fallback".into(),
            poster: Some("https://preview.redd.it/poster.jpg".into()),
            alt: None,
        };
        assert!(validate_media(&reddit_video, "reddit").is_ok());
        assert!(validate_media(&reddit_video, "x").is_err());
    }
    #[test]
    fn canonical_identity() {
        assert_eq!(
            canonical("x", "https://twitter.com/person/status/123?s=20").unwrap(),
            "https://x.com/i/status/123"
        );
        assert_eq!(
            canonical(
                "reddit",
                "https://old.reddit.com/r/photos/comments/abc123/a-photo?utm_source=x"
            )
            .unwrap(),
            "https://www.reddit.com/r/photos/comments/abc123/a-photo"
        );
        assert_eq!(
            canonical("reddit", "https://redd.it/xyz789").unwrap(),
            "https://www.reddit.com/comments/xyz789"
        );
        for u in [
            "https://x.com.evil.test/a/status/123",
            "http://x.com/a/status/123",
            "https://user:pass@x.com/a/status/123",
            "https://x.com/a/status/no",
        ] {
            assert!(canonical("x", u).is_err());
        }
        for u in [
            "https://www.reddit.com/r/photos",
            "https://www.reddit.com/r/photos/comments/not%20valid/title",
            "https://www.reddit.com/user/person",
        ] {
            assert!(canonical("reddit", u).is_err());
        }
        assert!(order(Some("score; DROP TABLE posts")).is_err());
    }
}
