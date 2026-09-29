use super::*;
#[derive(Deserialize)]
pub struct FolderInput {
    name: String,
    #[serde(default, deserialize_with = "deserialize_optional_parent")]
    parent_id: Option<Option<i64>>,
}

#[derive(Deserialize)]
pub struct ImportFolderPathInput {
    path: Vec<String>,
    parent_id: Option<i64>,
}

fn deserialize_optional_parent<'de, D>(deserializer: D) -> Result<Option<Option<i64>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<i64>::deserialize(deserializer).map(Some)
}
#[derive(Deserialize)]
pub struct SaveInput {
    folder_id: Option<i64>,
}
#[derive(Deserialize)]
pub struct ImportXInput {
    source_url: String,
    folder_id: Option<i64>,
}
#[derive(Deserialize)]
pub struct ListInput {
    folder_id: Option<i64>,
    unfiled: Option<bool>,
    page: Option<i64>,
}
#[derive(Deserialize)]
pub struct BatchStatusInput {
    post_ids: String,
}
#[derive(Serialize, FromRow)]
pub struct Folder {
    id: i64,
    name: String,
    parent_id: Option<i64>,
    count: i64,
}
#[derive(Serialize, FromRow)]
pub struct Saved {
    post_id: i64,
    public_id: String,
    folder_id: Option<i64>,
    title: String,
    community: String,
    created_at: DateTime<Utc>,
    moderation_status: String,
}
async fn owner(h: &HeaderMap, db: &PgPool) -> Result<i64, ApiError> {
    authenticated_author(h, db).await.map_err(|e| match e {
        ApiError::Invalid(_) => ApiError::Unauthorized,
        other => other,
    })
}
pub async fn folders(
    State(db): State<PgPool>,
    h: HeaderMap,
) -> Result<Json<Vec<Folder>>, ApiError> {
    let uid = owner(&h, &db).await?;
    Ok(Json(crate::operations::timed_query(
        "bookmarks.folders",
        sqlx::query_as("SELECT f.id,f.name,f.parent_id,count(b.post_id) FILTER (WHERE p.moderation_status='approved' OR (p.author_id=$1 AND p.moderation_status='pending')) AS count FROM bookmark_folders f LEFT JOIN bookmarks b ON b.author_id=f.author_id AND b.folder_id=f.id LEFT JOIN posts p ON p.id=b.post_id WHERE f.author_id=$1 GROUP BY f.id ORDER BY lower(f.name),f.id").bind(uid).fetch_all(&db),
    ).await?))
}

pub async fn import_folder_path(
    State(db): State<PgPool>,
    h: HeaderMap,
    Json(input): Json<ImportFolderPathInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let uid = owner(&h, &db).await?;
    if input.path.is_empty() || input.path.len() > 12 {
        return Err(ApiError::Invalid("Folder paths must contain 1–12 names"));
    }
    let path = input
        .path
        .iter()
        .map(|name| name.trim())
        .collect::<Vec<_>>();
    if path
        .iter()
        .any(|name| name.is_empty() || name.chars().count() > 80)
    {
        return Err(ApiError::Invalid("Folder names must be 1–80 characters"));
    }
    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("bookmark-folders:{uid}"))
        .execute(&mut *tx)
        .await?;
    let mut parent_id = input.parent_id;
    if let Some(id) = parent_id {
        let owned: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM bookmark_folders WHERE author_id=$1 AND id=$2)",
        )
        .bind(uid)
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        if !owned {
            return Err(ApiError::Missing);
        }
    }
    for name in path {
        let existing: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM bookmark_folders WHERE author_id=$1 AND parent_id IS NOT DISTINCT FROM $2 AND lower(name)=lower($3)",
        ).bind(uid).bind(parent_id).bind(name).fetch_optional(&mut *tx).await?;
        let id = if let Some(id) = existing {
            id
        } else {
            sqlx::query_scalar::<_, i64>(
                "INSERT INTO bookmark_folders(author_id,name,parent_id) VALUES ($1,$2,$3) RETURNING id",
            ).bind(uid).bind(name).bind(parent_id).fetch_one(&mut *tx).await?
        };
        parent_id = Some(id);
    }
    tx.commit().await?;
    Ok(Json(serde_json::json!({"id": parent_id})))
}
async fn write_folder(
    db: &PgPool,
    uid: i64,
    id: Option<i64>,
    name: String,
    requested_parent: Option<Option<i64>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(ApiError::Invalid("Folder names must be 1–80 characters"));
    }
    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("bookmark-folders:{uid}"))
        .execute(&mut *tx)
        .await?;
    let parent_id = if let Some(parent_id) = requested_parent {
        parent_id
    } else if let Some(id) = id {
        sqlx::query_scalar::<_, Option<i64>>(
            "SELECT parent_id FROM bookmark_folders WHERE author_id=$1 AND id=$2 FOR UPDATE",
        )
        .bind(uid)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(ApiError::Missing)?
    } else {
        None
    };

    if let Some(parent_id) = parent_id {
        let parent_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM bookmark_folders WHERE author_id=$1 AND id=$2)",
        )
        .bind(uid)
        .bind(parent_id)
        .fetch_one(&mut *tx)
        .await?;
        if !parent_exists {
            return Err(ApiError::Missing);
        }
        if let Some(id) = id {
            let would_cycle: bool = sqlx::query_scalar(
                "WITH RECURSIVE descendants(id) AS (
                     SELECT id FROM bookmark_folders WHERE author_id=$1 AND id=$2
                     UNION ALL
                     SELECT child.id FROM bookmark_folders child
                     JOIN descendants parent ON child.parent_id=parent.id
                     WHERE child.author_id=$1
                 )
                 SELECT EXISTS(SELECT 1 FROM descendants WHERE id=$3)",
            )
            .bind(uid)
            .bind(id)
            .bind(parent_id)
            .fetch_one(&mut *tx)
            .await?;
            if would_cycle {
                return Err(ApiError::Invalid("A folder cannot be moved inside itself"));
            }
        }
    }

    let result = if let Some(id) = id {
        sqlx::query_scalar::<_, i64>(
            "UPDATE bookmark_folders SET name=$3,parent_id=$4 WHERE author_id=$1 AND id=$2 RETURNING id",
        )
        .bind(uid)
        .bind(id)
        .bind(name)
        .bind(parent_id)
        .fetch_optional(&mut *tx)
        .await
    } else {
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO bookmark_folders(author_id,name,parent_id) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(uid)
        .bind(name)
        .bind(parent_id)
        .fetch_optional(&mut *tx)
        .await
    };
    match result {
        Ok(Some(id)) => {
            tx.commit().await?;
            Ok(Json(serde_json::json!({"id":id,"parent_id":parent_id})))
        }
        Ok(None) => Err(ApiError::Missing),
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => Err(ApiError::Invalid(
            "A folder with this name already exists here",
        )),
        Err(e) => Err(e.into()),
    }
}
pub async fn create_folder(
    State(db): State<PgPool>,
    h: HeaderMap,
    Json(input): Json<FolderInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let uid = owner(&h, &db).await?;
    write_folder(&db, uid, None, input.name, input.parent_id).await
}
pub async fn rename_folder(
    State(db): State<PgPool>,
    h: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<FolderInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let uid = owner(&h, &db).await?;
    write_folder(&db, uid, Some(id), input.name, input.parent_id).await
}
pub async fn delete_folder(
    State(db): State<PgPool>,
    h: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let uid = owner(&h, &db).await?;
    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("bookmark-folders:{uid}"))
        .execute(&mut *tx)
        .await?;
    let found: Option<Option<i64>> = sqlx::query_scalar(
        "SELECT parent_id FROM bookmark_folders WHERE author_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(uid)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let parent_id = found.ok_or(ApiError::Missing)?;
    let has_promote_conflict: bool = sqlx::query_scalar(
        "SELECT EXISTS(
             SELECT 1
             FROM bookmark_folders child
             JOIN bookmark_folders sibling
               ON sibling.author_id=child.author_id
              AND sibling.parent_id IS NOT DISTINCT FROM $3
              AND lower(sibling.name)=lower(child.name)
              AND sibling.id<>$2
             WHERE child.author_id=$1 AND child.parent_id=$2
         )",
    )
    .bind(uid)
    .bind(id)
    .bind(parent_id)
    .fetch_one(&mut *tx)
    .await?;
    if has_promote_conflict {
        return Err(ApiError::Invalid(
            "Rename the conflicting subfolder before deleting this folder",
        ));
    }
    sqlx::query("UPDATE bookmarks SET folder_id=$3 WHERE author_id=$1 AND folder_id=$2")
        .bind(uid)
        .bind(id)
        .bind(parent_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE bookmark_folders SET parent_id=$3 WHERE author_id=$1 AND parent_id=$2")
        .bind(uid)
        .bind(id)
        .bind(parent_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM bookmark_folders WHERE author_id=$1 AND id=$2")
        .bind(uid)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn import_x_source(
    State(db): State<PgPool>,
    h: HeaderMap,
    Json(input): Json<ImportXInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let uid = owner(&h, &db).await?;
    let source = crate::imports::canonical("x", &input.source_url)?;
    let mut tx = db.begin().await?;
    let inserted: Option<i64> = sqlx::query_scalar(
        "INSERT INTO bookmarks(author_id,post_id,folder_id)
         SELECT $1,p.id,$3
         FROM external_posts e
         JOIN posts p ON p.id=e.post_id
         WHERE e.source_url=$2
           AND (p.moderation_status='approved'
                OR (p.author_id=$1 AND p.moderation_status='pending'))
         ON CONFLICT(author_id,post_id) DO UPDATE SET folder_id=excluded.folder_id
         RETURNING post_id",
    )
    .bind(uid)
    .bind(source)
    .bind(input.folder_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| match error {
        sqlx::Error::Database(database) if database.is_foreign_key_violation() => ApiError::Missing,
        other => ApiError::from(other),
    })?;
    let Some(post_id) = inserted else {
        tx.rollback().await?;
        return Ok(Json(serde_json::json!({"found": false, "saved": false})));
    };
    let status: String = sqlx::query_scalar("SELECT moderation_status FROM posts WHERE id=$1")
        .bind(post_id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(serde_json::json!({
        "found": true,
        "saved": true,
        "id": post_id,
        "status": status
    })))
}
pub async fn status(
    State(db): State<PgPool>,
    h: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let uid = owner(&h, &db).await?;
    let row: Option<(Option<i64>,)> = crate::operations::timed_query(
        "bookmarks.status",
        sqlx::query_as("SELECT folder_id FROM bookmarks WHERE author_id=$1 AND post_id=$2")
            .bind(uid)
            .bind(id)
            .fetch_optional(&db),
    )
    .await?;
    Ok(Json(
        serde_json::json!({"saved":row.is_some(),"folder_id":row.and_then(|r|r.0)}),
    ))
}
pub async fn batch_status(
    State(db): State<PgPool>,
    h: HeaderMap,
    Query(input): Query<BatchStatusInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let uid = owner(&h, &db).await?;
    let mut ids = input
        .post_ids
        .split(',')
        .filter_map(|value| value.trim().parse::<i64>().ok())
        .filter(|value| *value > 0)
        .collect::<Vec<_>>();
    ids.sort_unstable();
    ids.dedup();
    if ids.is_empty() || ids.len() > 100 {
        return Err(ApiError::Invalid("Provide between 1 and 100 post ids"));
    }
    let rows: Vec<(i64, Option<i64>)> = crate::operations::timed_query(
        "bookmarks.batch_status",
        sqlx::query_as(
            "SELECT post_id, folder_id
             FROM bookmarks
             WHERE author_id = $1 AND post_id = ANY($2::bigint[])",
        )
        .bind(uid)
        .bind(&ids)
        .fetch_all(&db),
    )
    .await?;
    let saved = rows
        .into_iter()
        .map(|(post_id, folder_id)| {
            (
                post_id.to_string(),
                serde_json::json!({"saved": true, "folder_id": folder_id}),
            )
        })
        .collect::<serde_json::Map<_, _>>();
    Ok(Json(serde_json::json!({"items": saved})))
}
pub async fn save(
    State(db): State<PgPool>,
    h: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<SaveInput>,
) -> Result<StatusCode, ApiError> {
    let uid = owner(&h, &db).await?;
    // The composite foreign key enforces ownership even during concurrent folder changes.
    let result=sqlx::query("INSERT INTO bookmarks(author_id,post_id,folder_id) SELECT $1,$2,$3 WHERE EXISTS (SELECT 1 FROM posts WHERE id=$2 AND (moderation_status='approved' OR (author_id=$1 AND moderation_status='pending'))) ON CONFLICT(author_id,post_id) DO UPDATE SET folder_id=excluded.folder_id").bind(uid).bind(id).bind(input.folder_id).execute(&db).await;
    match result {
        Ok(result) if result.rows_affected() == 1 => Ok(StatusCode::NO_CONTENT),
        Ok(_) => Err(ApiError::Missing),
        Err(sqlx::Error::Database(e)) if e.is_foreign_key_violation() => Err(ApiError::Missing),
        Err(e) => Err(e.into()),
    }
}
pub async fn remove(
    State(db): State<PgPool>,
    h: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let uid = owner(&h, &db).await?;
    sqlx::query("DELETE FROM bookmarks WHERE author_id=$1 AND post_id=$2")
        .bind(uid)
        .bind(id)
        .execute(&db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn list(
    State(db): State<PgPool>,
    h: HeaderMap,
    Query(q): Query<ListInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let uid = owner(&h, &db).await?;
    let page = q.page.unwrap_or(1);
    if !(1..=100000).contains(&page) {
        return Err(ApiError::Invalid("Invalid page"));
    }
    let mut rows:Vec<Saved>=sqlx::query_as("SELECT b.post_id,p.public_id,b.folder_id,p.title,c.slug AS community,b.created_at,p.moderation_status FROM bookmarks b JOIN posts p ON p.id=b.post_id JOIN communities c ON c.id=p.community_id WHERE b.author_id=$1 AND (p.moderation_status='approved' OR (p.author_id=$1 AND p.moderation_status='pending')) AND ($2::bigint IS NULL OR b.folder_id=$2) AND (NOT $3 OR b.folder_id IS NULL) ORDER BY b.created_at DESC,b.post_id DESC LIMIT 51 OFFSET $4").bind(uid).bind(q.folder_id).bind(q.unfiled.unwrap_or(false)).bind((page-1)*50).fetch_all(&db).await?;
    let has_more = rows.len() > 50;
    rows.truncate(50);
    Ok(Json(serde_json::json!({"items":rows,"has_more":has_more})))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_parent_distinguishes_omitted_from_root() {
        let omitted: FolderInput = serde_json::from_str(r#"{"name":"Saved"}"#).unwrap();
        assert_eq!(omitted.parent_id, None);

        let root: FolderInput =
            serde_json::from_str(r#"{"name":"Saved","parent_id":null}"#).unwrap();
        assert_eq!(root.parent_id, Some(None));

        let nested: FolderInput =
            serde_json::from_str(r#"{"name":"Saved","parent_id":7}"#).unwrap();
        assert_eq!(nested.parent_id, Some(Some(7)));
    }

    #[sqlx::test(migrations = "./migrations")]
    #[ignore = "requires DATABASE_URL and permission to create an isolated test database"]
    async fn private_bookmarks_and_folder_lifecycle(db: PgPool) {
        let a: i64 =
            sqlx::query_scalar("INSERT INTO authors(handle) VALUES ('alice') RETURNING id")
                .fetch_one(&db)
                .await
                .unwrap();
        let b: i64 = sqlx::query_scalar("INSERT INTO authors(handle) VALUES ('bob') RETURNING id")
            .fetch_one(&db)
            .await
            .unwrap();
        let mut headers = Vec::new();
        for (uid, token) in [(a, "a".repeat(64)), (b, "b".repeat(64))] {
            sqlx::query("INSERT INTO sessions(token_hash,author_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')").bind(Sha256::digest(token.as_bytes()).to_vec()).bind(uid).execute(&db).await.unwrap();
            let mut h = HeaderMap::new();
            h.insert("authorization", format!("Bearer {token}").parse().unwrap());
            headers.push(h);
        }
        let c: i64 = sqlx::query_scalar(
            "INSERT INTO communities(slug,name) VALUES ('test','Test') RETURNING id",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        let post:i64=sqlx::query_scalar("INSERT INTO posts(community_id,author_id,title,moderation_status) VALUES ($1,$2,'Saved discussion','approved') RETURNING id").bind(c).bind(a).fetch_one(&db).await.unwrap();
        assert!(matches!(
            list(
                State(db.clone()),
                HeaderMap::new(),
                Query(ListInput {
                    folder_id: None,
                    unfiled: None,
                    page: None
                })
            )
            .await,
            Err(ApiError::Unauthorized)
        ));
        let folder = write_folder(&db, a, None, " Research ".into(), None)
            .await
            .unwrap()
            .0["id"]
            .as_i64()
            .unwrap();
        let child = write_folder(&db, a, None, "Articles".into(), Some(Some(folder)))
            .await
            .unwrap()
            .0["id"]
            .as_i64()
            .unwrap();
        assert!(matches!(
            write_folder(&db, a, None, "research".into(), None).await,
            Err(ApiError::Invalid(_))
        ));
        assert!(matches!(
            write_folder(&db, a, Some(folder), "Research".into(), Some(Some(child))).await,
            Err(ApiError::Invalid(_))
        ));
        assert!(
            write_folder(&db, b, None, "Research".into(), None)
                .await
                .is_ok()
        );
        let _root_conflict = write_folder(&db, a, None, "Articles".into(), None)
            .await
            .unwrap()
            .0["id"]
            .as_i64()
            .unwrap();
        sqlx::query("INSERT INTO external_posts(post_id,provider,source_url,source_author,observed_at) VALUES ($1,'x','https://x.com/i/status/123','@alice',now())")
            .bind(post)
            .execute(&db)
            .await
            .unwrap();
        let imported = import_x_source(
            State(db.clone()),
            headers[0].clone(),
            Json(ImportXInput {
                source_url: "https://x.com/alice/status/123?ref=bookmark".into(),
                folder_id: Some(folder),
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(imported["found"], true);
        assert_eq!(imported["saved"], true);
        assert_eq!(imported["id"], post);
        assert!(matches!(
            save(
                State(db.clone()),
                headers[1].clone(),
                Path(post),
                Json(SaveInput {
                    folder_id: Some(folder)
                })
            )
            .await,
            Err(ApiError::Missing)
        ));
        for _ in 0..2 {
            save(
                State(db.clone()),
                headers[0].clone(),
                Path(post),
                Json(SaveInput {
                    folder_id: Some(folder),
                }),
            )
            .await
            .unwrap();
        }
        let result = list(
            State(db.clone()),
            headers[0].clone(),
            Query(ListInput {
                folder_id: Some(folder),
                unfiled: None,
                page: None,
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(result["items"].as_array().unwrap().len(), 1);
        let other = list(
            State(db.clone()),
            headers[1].clone(),
            Query(ListInput {
                folder_id: Some(folder),
                unfiled: None,
                page: None,
            }),
        )
        .await
        .unwrap()
        .0;
        assert!(other["items"].as_array().unwrap().is_empty());
        assert_eq!(
            status(State(db.clone()), headers[1].clone(), Path(post))
                .await
                .unwrap()
                .0["saved"],
            false
        );
        assert!(matches!(
            write_folder(&db, b, Some(folder), "Stolen".into(), None).await,
            Err(ApiError::Missing)
        ));
        assert!(matches!(
            delete_folder(State(db.clone()), headers[1].clone(), Path(folder)).await,
            Err(ApiError::Missing)
        ));
        let _ = write_folder(&db, a, Some(folder), "Reading".into(), None)
            .await
            .unwrap();
        assert!(matches!(
            delete_folder(State(db.clone()), headers[0].clone(), Path(folder)).await,
            Err(ApiError::Invalid(_))
        ));
        let moved = write_folder(&db, a, Some(child), "Papers".into(), Some(Some(folder)))
            .await
            .unwrap()
            .0;
        assert_eq!(moved["parent_id"], folder);
        delete_folder(State(db.clone()), headers[0].clone(), Path(folder))
            .await
            .unwrap();
        let status = status(State(db.clone()), headers[0].clone(), Path(post))
            .await
            .unwrap()
            .0;
        assert_eq!(status["saved"], true);
        assert!(status["folder_id"].is_null());
        let reparented: Option<i64> = sqlx::query_scalar(
            "SELECT parent_id FROM bookmark_folders WHERE author_id=$1 AND id=$2",
        )
        .bind(a)
        .bind(child)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(reparented, None);
        remove(State(db.clone()), headers[1].clone(), Path(post))
            .await
            .unwrap();
        let rows = list(
            State(db.clone()),
            headers[0].clone(),
            Query(ListInput {
                folder_id: None,
                unfiled: Some(true),
                page: None,
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(rows["items"].as_array().unwrap().len(), 1);
        remove(State(db.clone()), headers[0].clone(), Path(post))
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM bookmarks")
                .fetch_one(&db)
                .await
                .unwrap(),
            0
        );
    }
    #[sqlx::test(migrations = "./migrations")]
    #[ignore = "requires DATABASE_URL and permission to create an isolated test database"]
    async fn import_paths_and_pending_bookmarks(db: PgPool) {
        let alice: i64 =
            sqlx::query_scalar("INSERT INTO authors(handle) VALUES ('alice') RETURNING id")
                .fetch_one(&db)
                .await
                .unwrap();
        let bob: i64 =
            sqlx::query_scalar("INSERT INTO authors(handle) VALUES ('bob') RETURNING id")
                .fetch_one(&db)
                .await
                .unwrap();
        let mut headers = Vec::new();
        for (uid, token) in [(alice, "a".repeat(64)), (bob, "b".repeat(64))] {
            sqlx::query("INSERT INTO sessions(token_hash,author_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')").bind(Sha256::digest(token.as_bytes()).to_vec()).bind(uid).execute(&db).await.unwrap();
            let mut h = HeaderMap::new();
            h.insert("authorization", format!("Bearer {token}").parse().unwrap());
            headers.push(h);
        }
        let root = write_folder(&db, alice, None, "X archive".into(), None)
            .await
            .unwrap()
            .0["id"]
            .as_i64()
            .unwrap();
        let input = || ImportFolderPathInput {
            path: vec![" Research ".into(), "Linux".into()],
            parent_id: Some(root),
        };
        let (first, second) = tokio::join!(
            import_folder_path(State(db.clone()), headers[0].clone(), Json(input())),
            import_folder_path(State(db.clone()), headers[0].clone(), Json(input()))
        );
        let folder = first.unwrap().0["id"].as_i64().unwrap();
        assert_eq!(second.unwrap().0["id"], folder);
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM bookmark_folders WHERE author_id=$1"
            )
            .bind(alice)
            .fetch_one(&db)
            .await
            .unwrap(),
            3
        );
        assert!(matches!(
            import_folder_path(State(db.clone()), headers[1].clone(), Json(input())).await,
            Err(ApiError::Missing)
        ));
        assert!(matches!(
            import_folder_path(State(db.clone()), HeaderMap::new(), Json(input())).await,
            Err(ApiError::Unauthorized)
        ));
        assert!(matches!(
            import_folder_path(
                State(db.clone()),
                headers[0].clone(),
                Json(ImportFolderPathInput {
                    path: vec!["bad".into(), " ".into()],
                    parent_id: Some(root)
                })
            )
            .await,
            Err(ApiError::Invalid(_))
        ));
        let community: i64 = sqlx::query_scalar(
            "INSERT INTO communities(slug,name) VALUES ('test','Test') RETURNING id",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        let mine: i64 = sqlx::query_scalar("INSERT INTO posts(community_id,author_id,title,moderation_status) VALUES ($1,$2,'My pending import','pending') RETURNING id").bind(community).bind(alice).fetch_one(&db).await.unwrap();
        let theirs: i64 = sqlx::query_scalar("INSERT INTO posts(community_id,author_id,title,moderation_status) VALUES ($1,$2,'Other pending import','approved') RETURNING id").bind(community).bind(bob).fetch_one(&db).await.unwrap();
        for post in [mine, theirs] {
            save(
                State(db.clone()),
                headers[0].clone(),
                Path(post),
                Json(SaveInput {
                    folder_id: Some(folder),
                }),
            )
            .await
            .unwrap();
        }
        sqlx::query("UPDATE posts SET moderation_status='pending' WHERE id=$1")
            .bind(theirs)
            .execute(&db)
            .await
            .unwrap();
        let listed = list(
            State(db.clone()),
            headers[0].clone(),
            Query(ListInput {
                folder_id: Some(folder),
                unfiled: None,
                page: None,
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(listed["items"].as_array().unwrap().len(), 1);
        assert_eq!(listed["items"][0]["post_id"], mine);
        assert_eq!(listed["items"][0]["moderation_status"], "pending");
        let counts = folders(State(db.clone()), headers[0].clone())
            .await
            .unwrap()
            .0;
        assert_eq!(counts.iter().find(|f| f.id == folder).unwrap().count, 1);
        assert!(matches!(
            save(
                State(db.clone()),
                headers[1].clone(),
                Path(mine),
                Json(SaveInput { folder_id: None })
            )
            .await,
            Err(ApiError::Missing)
        ));
        sqlx::query("UPDATE posts SET moderation_status='rejected' WHERE id=$1")
            .bind(mine)
            .execute(&db)
            .await
            .unwrap();
        let counts = folders(State(db.clone()), headers[0].clone())
            .await
            .unwrap()
            .0;
        assert_eq!(counts.iter().find(|f| f.id == folder).unwrap().count, 0);
    }
}
