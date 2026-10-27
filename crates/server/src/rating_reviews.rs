use super::*;

pub const POLICY: &str = "suggestive-r-explicit-x-v1";

async fn snapshot(
    conn: &mut sqlx::SqliteConnection,
    id: i64,
) -> Result<(serde_json::Value, String), ApiError> {
    let mut value: serde_json::Value = sqlx::query_scalar("SELECT json_object('post_id',p.id,'public_id',p.public_id,'title',p.title,'body',p.body,'provider',e.provider,'source_url',e.source_url,'source_author',e.source_author,'media',json(COALESCE(e.media,'[]'))) FROM posts p LEFT JOIN external_posts e ON e.post_id=p.id WHERE p.id=?1 AND p.moderation_status IN ('approved','pending')")
        .bind(id).fetch_optional(&mut *conn).await?.ok_or(ApiError::Missing)?;
    let uploaded: Vec<serde_json::Value> = sqlx::query_scalar("SELECT json_object('kind',m.media_type,'src','/media/'||m.id||'/original','content_hash',m.content_hash) FROM post_media pm JOIN media_assets m ON m.id=pm.media_id WHERE pm.post_id=?1 AND m.media_type IN ('image','video') AND m.status='ready' ORDER BY pm.position,m.id")
        .bind(id).fetch_all(&mut *conn).await?;
    if let Some(media) = value.get_mut("media").and_then(|m| m.as_array_mut()) {
        media.extend(uploaded);
    }
    let hash = Sha256::digest(
        serde_json::to_vec(&value).map_err(|_| ApiError::Invalid("Invalid review input"))?,
    )
    .iter()
    .map(|b| format!("{b:02x}"))
    .collect();
    Ok((value, hash))
}

#[derive(Deserialize, Default)]
pub struct ListQuery {
    status: Option<String>,
    rating: Option<String>,
    after: Option<i64>,
    limit: Option<i64>,
}

pub async fn candidates(
    State(db): State<SqlitePool>,
    h: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&h, &db).await?;
    let pending: i64 =
        sqlx::query_scalar("SELECT count(*) FROM rating_reviews WHERE status='pending'")
            .fetch_one(&db)
            .await?;
    if pending >= 100 {
        return Ok(Json(serde_json::json!({"items":[],"queue_full":true})));
    }
    // Reviewed content stays reviewed; explicit re-review is a separate action.
    let ids: Vec<i64> = sqlx::query_scalar("SELECT p.id FROM posts p WHERE p.moderation_status IN ('approved','pending') AND p.content_rating_source<>'moderator' AND NOT EXISTS(SELECT 1 FROM rating_reviews r WHERE r.post_id=p.id) ORDER BY CASE WHEN p.content_rating IN ('r','x') THEN 0 ELSE 1 END,p.id DESC LIMIT 20")
        .fetch_all(&db).await?;
    let mut conn = db.acquire().await?;
    let mut items = Vec::new();
    for id in ids.into_iter().take((100 - pending).min(20) as usize) {
        let (input, hash) = snapshot(&mut conn, id).await?;
        items.push(serde_json::json!({"post_id":id,"content_hash":hash,"snapshot":input,"policy_version":POLICY}));
    }
    Ok(Json(serde_json::json!({"items":items})))
}

#[derive(Deserialize)]
pub struct Proposal {
    post_id: i64,
    content_hash: String,
    model: String,
    model_digest: String,
    policy_version: String,
    proposed_rating: Option<String>,
    #[serde(default)]
    details: serde_json::Value,
    #[serde(default)]
    artifacts: Vec<serde_json::Value>,
}
pub async fn propose(
    State(db): State<SqlitePool>,
    h: HeaderMap,
    Json(input): Json<Proposal>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&h, &db).await?;
    if input.policy_version != POLICY
        || input.model.is_empty()
        || input.model.len() > 100
        || input.model_digest.is_empty()
        || input.model_digest.len() > 100
        || input.artifacts.len() > 8
        || serde_json::json!(input.artifacts).to_string().len() > 16000
        || !input.details.is_object()
        || input.details.to_string().len() > 8000
    {
        return Err(ApiError::Invalid("Invalid review metadata"));
    }
    let normalized_rating = input
        .proposed_rating
        .as_deref()
        .map(|rating| validate_content_rating(Some(rating)))
        .transpose()?;
    for artifact in &input.artifacts {
        let hash = artifact["sha256"].as_str().unwrap_or("");
        if hash.len() != 64
            || !hash.bytes().all(|b| b.is_ascii_hexdigit())
            || artifact["cache_key"].as_str() != Some(&format!("{hash}.jpg"))
        {
            return Err(ApiError::Invalid("Invalid review image artifact"));
        }
    }
    let mut tx = crate::db::begin_immediate(&db).await?;
    let (value, hash) = snapshot(&mut tx, input.post_id).await?;
    if hash != input.content_hash {
        return Err(ApiError::Invalid("Post changed; collect a new review"));
    }
    let id:i64=sqlx::query_scalar("INSERT INTO rating_reviews(post_id,content_hash,model,model_digest,policy_version,snapshot,proposed_rating,details,artifacts) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(post_id,content_hash,model_digest,policy_version) DO UPDATE SET model=rating_reviews.model RETURNING id")
        .bind(input.post_id).bind(hash).bind(input.model).bind(input.model_digest).bind(input.policy_version).bind(value).bind(normalized_rating).bind(input.details).bind(serde_json::json!(input.artifacts)).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(serde_json::json!({"id":id})))
}

pub async fn list(
    State(db): State<SqlitePool>,
    h: HeaderMap,
    Query(q): Query<ListQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&h, &db).await?;
    let status = q.status.unwrap_or_else(|| "pending".into());
    if !matches!(status.as_str(), "pending" | "reviewed" | "dismissed") {
        return Err(ApiError::Invalid("Invalid review status"));
    }
    let rating = q.rating.as_deref();
    if rating.is_some_and(|r| !matches!(r, "general" | "r" | "x" | "unrated")) {
        return Err(ApiError::Invalid("Invalid review rating filter"));
    }
    let items:Vec<serde_json::Value>=sqlx::query_scalar("SELECT json_object('id',r.id,'post_id',r.post_id,'model',r.model,'model_digest',r.model_digest,'policy_version',r.policy_version,'snapshot',json(r.snapshot),'proposed_rating',r.proposed_rating,'details',json(r.details),'artifacts',json(r.artifacts),'status',r.status,'final_rating',r.final_rating,'created_at',r.created_at,'reviewed_at',r.reviewed_at,'reviewer',a.handle,'current_rating',p.content_rating,'current_rating_source',p.content_rating_source,'history',json(COALESCE((SELECT json_group_array(json(entry)) FROM (SELECT json_object('rating',t.label,'reviewer',u.handle,'notes',t.notes,'reviewed_at',t.created_at) AS entry FROM rating_training_labels t LEFT JOIN authors u ON u.id=t.reviewer_id WHERE t.review_id=r.id ORDER BY t.id DESC)), '[]'))) FROM rating_reviews r JOIN posts p ON p.id=r.post_id LEFT JOIN authors a ON a.id=r.reviewer_id WHERE r.status=?1 AND r.id>?2 AND (?3 IS NULL OR COALESCE(CASE WHEN r.status='reviewed' THEN r.final_rating ELSE r.proposed_rating END,'unrated')=?3) ORDER BY r.id LIMIT 20")
        .bind(&status).bind(q.after.unwrap_or(0)).bind(rating).fetch_all(&db).await?;
    let counts:serde_json::Value=sqlx::query_scalar("SELECT json_object('pending',count(*) FILTER(WHERE status='pending'),'reviewed',count(*) FILTER(WHERE status='reviewed'),'dismissed',count(*) FILTER(WHERE status='dismissed')) FROM rating_reviews").fetch_one(&db).await?;
    let distribution:serde_json::Value=sqlx::query_scalar("SELECT json_object('pending',json_object('general',count(*) FILTER(WHERE status='pending' AND proposed_rating='general'),'r',count(*) FILTER(WHERE status='pending' AND proposed_rating='r'),'x',count(*) FILTER(WHERE status='pending' AND proposed_rating='x'),'unrated',count(*) FILTER(WHERE status='pending' AND proposed_rating IS NULL)),'reviewed',json_object('general',count(*) FILTER(WHERE status='reviewed' AND final_rating='general'),'r',count(*) FILTER(WHERE status='reviewed' AND final_rating='r'),'x',count(*) FILTER(WHERE status='reviewed' AND final_rating='x'),'unrated',count(*) FILTER(WHERE status='reviewed' AND final_rating IS NULL))) FROM rating_reviews").fetch_one(&db).await?;
    Ok(Json(
        serde_json::json!({"items":items,"counts":counts,"distribution":distribution}),
    ))
}

#[derive(Deserialize)]
pub struct Decision {
    rating: Option<String>,
    #[serde(default)]
    dismiss: bool,
    notes: Option<String>,
}
pub async fn decide(
    State(db): State<SqlitePool>,
    h: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<Decision>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor = require_admin(&h, &db).await?;
    let notes = input.notes.unwrap_or_default();
    if notes.len() > 1000 {
        return Err(ApiError::Invalid("Review notes are limited to 1000 bytes"));
    }
    let mut tx = crate::db::begin_immediate(&db).await?;
    let (post_id, old_hash): (i64, String) =
        sqlx::query_as("SELECT post_id,content_hash FROM rating_reviews WHERE id=?1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(ApiError::Missing)?;
    if input.dismiss {
        sqlx::query("UPDATE rating_reviews SET status='dismissed',reviewer_id=?2,reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1").bind(id).bind(actor).execute(&mut *tx).await?;
    } else {
        let raw = input
            .rating
            .as_deref()
            .ok_or(ApiError::Invalid("Choose a human rating"))?;
        let rating = validate_content_rating(Some(raw))?;
        let (_, current_hash) = snapshot(&mut tx, post_id).await?;
        if current_hash != old_hash {
            return Err(ApiError::Invalid(
                "Post changed; dismiss this item and request a new review",
            ));
        }
        sqlx::query("INSERT INTO rating_training_labels(review_id,post_id,content_hash,label,reviewer_id,notes) VALUES(?1,?2,?3,?4,?5,?6)").bind(id).bind(post_id).bind(old_hash).bind(&rating).bind(actor).bind(notes).execute(&mut *tx).await?;
        sqlx::query("UPDATE posts SET content_rating=?2,content_rating_source='moderator',content_rating_confidence=NULL,content_rating_updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1").bind(post_id).bind(&rating).execute(&mut *tx).await?;
        sqlx::query("UPDATE rating_reviews SET status='reviewed',final_rating=?2,reviewer_id=?3,reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1").bind(id).bind(rating).bind(actor).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    operations::clear_public_cache();
    log_event(&db,"info","admin.rating_review_decided",serde_json::json!({"actor_id":actor,"review_id":id,"post_id":post_id,"dismissed":input.dismiss})).await;
    Ok(Json(
        serde_json::json!({"saved":true,"training_label_saved":!input.dismiss}),
    ))
}

pub async fn training(
    State(db): State<SqlitePool>,
    h: HeaderMap,
    Query(q): Query<ListQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&h, &db).await?;
    let limit = q.limit.unwrap_or(200).clamp(1, 200);
    let mut items:Vec<serde_json::Value>=sqlx::query_scalar("SELECT json_object('id',t.id,'post_id',t.post_id,'content_hash',t.content_hash,'label',t.label,'label_source','human','reviewer_id',t.reviewer_id,'notes',t.notes,'reviewed_at',t.created_at,'model',r.model,'model_digest',r.model_digest,'policy_version',r.policy_version,'model_suggestion',r.proposed_rating,'input',json(r.snapshot),'artifacts',json(r.artifacts)) FROM rating_training_labels t JOIN rating_reviews r ON r.id=t.review_id WHERE t.id>?1 AND t.id=(SELECT max(t2.id) FROM rating_training_labels t2 WHERE t2.post_id=t.post_id AND t2.content_hash=t.content_hash) ORDER BY t.id LIMIT ?2")
        .bind(q.after.unwrap_or(0)).bind(limit+1).fetch_all(&db).await?;
    let has_more = items.len() > limit as usize;
    items.truncate(limit as usize);
    let next_after = items
        .last()
        .and_then(|item| item["id"].as_i64())
        .unwrap_or(q.after.unwrap_or(0));
    Ok(Json(
        serde_json::json!({"items":items,"has_more":has_more,"next_after":next_after}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn fixture(db: &SqlitePool) -> (HeaderMap, i64) {
        let actor: i64 = sqlx::query_scalar(
            "INSERT INTO authors(handle,is_admin) VALUES('reviewer',true) RETURNING id",
        )
        .fetch_one(db)
        .await
        .unwrap();
        let token = "b".repeat(64);
        sqlx::query("INSERT INTO sessions(token_hash,author_id,expires_at) VALUES(?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'))").bind(Sha256::digest(token.as_bytes()).to_vec()).bind(actor).execute(db).await.unwrap();
        let community: i64 = sqlx::query_scalar("SELECT id FROM communities WHERE slug='general'")
            .fetch_one(db)
            .await
            .unwrap();
        let post:i64=sqlx::query_scalar("INSERT INTO posts(author_id,community_id,title,body,moderation_status) VALUES(?1,?2,'Sample','Review this content','approved') RETURNING id").bind(actor).bind(community).fetch_one(db).await.unwrap();
        let mut h = HeaderMap::new();
        h.insert("authorization", format!("Bearer {token}").parse().unwrap());
        (h, post)
    }
    fn proposal(post: i64, hash: String) -> Proposal {
        Proposal {
            post_id: post,
            content_hash: hash,
            model: "qwen3.5:2b".into(),
            model_digest: "a".repeat(64),
            policy_version: POLICY.into(),
            proposed_rating: Some("r".into()),
            details: serde_json::json!({"uncertain":false}),
            artifacts: vec![],
        }
    }
    #[sqlx::test(migrations = "./sqlite-migrations")]
    async fn only_human_decisions_train_and_relabels_export_once(db: SqlitePool) {
        let (h, post) = fixture(&db).await;
        let (_, hash) = snapshot(&mut db.acquire().await.unwrap(), post)
            .await
            .unwrap();
        let first = propose(
            State(db.clone()),
            h.clone(),
            Json(proposal(post, hash.clone())),
        )
        .await
        .unwrap()
        .0;
        let duplicate = propose(State(db.clone()), h.clone(), Json(proposal(post, hash)))
            .await
            .unwrap()
            .0;
        assert_eq!(first["id"], duplicate["id"]);
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT content_rating FROM posts WHERE id=?1")
                .bind(post)
                .fetch_one(&db)
                .await
                .unwrap(),
            "general"
        );
        let empty = training(State(db.clone()), h.clone(), Query(ListQuery::default()))
            .await
            .unwrap()
            .0;
        assert_eq!(empty["items"].as_array().unwrap().len(), 0);
        let id = first["id"].as_i64().unwrap();
        let pending = list(State(db.clone()), h.clone(), Query(ListQuery::default()))
            .await
            .unwrap()
            .0;
        assert_eq!(pending["distribution"]["pending"]["r"], 1);
        assert_eq!(pending["distribution"]["reviewed"]["r"], 0);
        for rating in ["r", "x"] {
            let _ = decide(
                State(db.clone()),
                h.clone(),
                Path(id),
                Json(Decision {
                    rating: Some(rating.into()),
                    dismiss: false,
                    notes: Some("Human correction".into()),
                }),
            )
            .await
            .unwrap();
        }
        let exported = training(State(db.clone()), h.clone(), Query(ListQuery::default()))
            .await
            .unwrap()
            .0;
        assert_eq!(exported["items"].as_array().unwrap().len(), 1);
        assert_eq!(exported["items"][0]["label"], "x");
        assert_eq!(exported["items"][0]["label_source"], "human");
        let reviewed = list(
            State(db.clone()),
            h.clone(),
            Query(ListQuery {
                status: Some("reviewed".into()),
                rating: Some("x".into()),
                ..Default::default()
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(reviewed["distribution"]["reviewed"]["x"], 1);
        assert_eq!(reviewed["items"][0]["reviewer"], "reviewer");
        assert_eq!(reviewed["items"][0]["history"].as_array().unwrap().len(), 2);
        assert_eq!(
            reviewed["items"][0]["history"][0]["notes"],
            "Human correction"
        );
        assert_eq!(reviewed["items"][0]["history"][0]["rating"], "x");
        assert_eq!(exported["items"][0]["input"]["body"], "Review this content");
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM rating_training_labels")
                .fetch_one(&db)
                .await
                .unwrap(),
            2
        );
        assert!(matches!(
            training(
                State(db.clone()),
                HeaderMap::new(),
                Query(ListQuery::default())
            )
            .await,
            Err(ApiError::Unauthorized)
        ));
    }
    #[sqlx::test(migrations = "./sqlite-migrations")]
    async fn stale_content_cannot_be_labeled_and_dismissal_never_trains(db: SqlitePool) {
        let (h, post) = fixture(&db).await;
        let (_, hash) = snapshot(&mut db.acquire().await.unwrap(), post)
            .await
            .unwrap();
        let id = propose(State(db.clone()), h.clone(), Json(proposal(post, hash)))
            .await
            .unwrap()
            .0["id"]
            .as_i64()
            .unwrap();
        sqlx::query("UPDATE posts SET body='Changed content' WHERE id=?1")
            .bind(post)
            .execute(&db)
            .await
            .unwrap();
        assert!(matches!(
            decide(
                State(db.clone()),
                h.clone(),
                Path(id),
                Json(Decision {
                    rating: Some("x".into()),
                    dismiss: false,
                    notes: None
                })
            )
            .await,
            Err(ApiError::Invalid(_))
        ));
        let _ = decide(
            State(db.clone()),
            h,
            Path(id),
            Json(Decision {
                rating: None,
                dismiss: true,
                notes: None,
            }),
        )
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM rating_training_labels")
                .fetch_one(&db)
                .await
                .unwrap(),
            0
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT content_rating FROM posts WHERE id=?1")
                .bind(post)
                .fetch_one(&db)
                .await
                .unwrap(),
            "general"
        );
    }
}
