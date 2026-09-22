use super::*;
#[derive(Deserialize)]
pub struct FolderInput {
    name: String,
}
#[derive(Deserialize)]
pub struct SaveInput {
    folder_id: Option<i64>,
}
#[derive(Deserialize)]
pub struct ListInput {
    folder_id: Option<i64>,
    unfiled: Option<bool>,
    page: Option<i64>,
}
#[derive(Serialize, FromRow)]
pub struct Folder {
    id: i64,
    name: String,
    count: i64,
}
#[derive(Serialize, FromRow)]
pub struct Saved {
    post_id: i64,
    folder_id: Option<i64>,
    title: String,
    community: String,
    created_at: DateTime<Utc>,
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
    Ok(Json(sqlx::query_as("SELECT f.id,f.name,count(b.post_id) AS count FROM bookmark_folders f LEFT JOIN bookmarks b ON b.author_id=f.author_id AND b.folder_id=f.id WHERE f.author_id=$1 GROUP BY f.id ORDER BY lower(f.name),f.id").bind(uid).fetch_all(&db).await?))
}
async fn write_folder(
    db: &PgPool,
    uid: i64,
    id: Option<i64>,
    name: String,
) -> Result<Json<serde_json::Value>, ApiError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(ApiError::Invalid("Folder names must be 1–80 characters"));
    }
    let result = if let Some(id) = id {
        sqlx::query_scalar::<_, i64>(
            "UPDATE bookmark_folders SET name=$3 WHERE author_id=$1 AND id=$2 RETURNING id",
        )
        .bind(uid)
        .bind(id)
        .bind(name)
        .fetch_optional(db)
        .await
    } else {
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO bookmark_folders(author_id,name) VALUES ($1,$2) RETURNING id",
        )
        .bind(uid)
        .bind(name)
        .fetch_optional(db)
        .await
    };
    match result {
        Ok(Some(id)) => Ok(Json(serde_json::json!({"id":id}))),
        Ok(None) => Err(ApiError::Missing),
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            Err(ApiError::Invalid("A folder with this name already exists"))
        }
        Err(e) => Err(e.into()),
    }
}
pub async fn create_folder(
    State(db): State<PgPool>,
    h: HeaderMap,
    Json(input): Json<FolderInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let uid = owner(&h, &db).await?;
    write_folder(&db, uid, None, input.name).await
}
pub async fn rename_folder(
    State(db): State<PgPool>,
    h: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<FolderInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let uid = owner(&h, &db).await?;
    write_folder(&db, uid, Some(id), input.name).await
}
pub async fn delete_folder(
    State(db): State<PgPool>,
    h: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let uid = owner(&h, &db).await?;
    let mut tx = db.begin().await?;
    let found: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM bookmark_folders WHERE author_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(uid)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    if found.is_none() {
        return Err(ApiError::Missing);
    }
    sqlx::query("UPDATE bookmarks SET folder_id=NULL WHERE author_id=$1 AND folder_id=$2")
        .bind(uid)
        .bind(id)
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
pub async fn status(
    State(db): State<PgPool>,
    h: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let uid = owner(&h, &db).await?;
    let row: Option<(Option<i64>,)> =
        sqlx::query_as("SELECT folder_id FROM bookmarks WHERE author_id=$1 AND post_id=$2")
            .bind(uid)
            .bind(id)
            .fetch_optional(&db)
            .await?;
    Ok(Json(
        serde_json::json!({"saved":row.is_some(),"folder_id":row.and_then(|r|r.0)}),
    ))
}
pub async fn save(
    State(db): State<PgPool>,
    h: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<SaveInput>,
) -> Result<StatusCode, ApiError> {
    let uid = owner(&h, &db).await?;
    // The composite foreign key enforces ownership even during concurrent folder changes.
    let result=sqlx::query("INSERT INTO bookmarks(author_id,post_id,folder_id) VALUES ($1,$2,$3) ON CONFLICT(author_id,post_id) DO UPDATE SET folder_id=excluded.folder_id").bind(uid).bind(id).bind(input.folder_id).execute(&db).await;
    match result {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
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
    let mut rows:Vec<Saved>=sqlx::query_as("SELECT b.post_id,b.folder_id,p.title,c.slug AS community,b.created_at FROM bookmarks b JOIN posts p ON p.id=b.post_id JOIN communities c ON c.id=p.community_id WHERE b.author_id=$1 AND ($2::bigint IS NULL OR b.folder_id=$2) AND (NOT $3 OR b.folder_id IS NULL) ORDER BY b.created_at DESC,b.post_id DESC LIMIT 51 OFFSET $4").bind(uid).bind(q.folder_id).bind(q.unfiled.unwrap_or(false)).bind((page-1)*50).fetch_all(&db).await?;
    let has_more = rows.len() > 50;
    rows.truncate(50);
    Ok(Json(serde_json::json!({"items":rows,"has_more":has_more})))
}

#[cfg(test)]
mod tests {
    use super::*;
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
        let post:i64=sqlx::query_scalar("INSERT INTO posts(community_id,author_id,title) VALUES ($1,$2,'Saved discussion') RETURNING id").bind(c).bind(a).fetch_one(&db).await.unwrap();
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
        let folder = write_folder(&db, a, None, " Research ".into())
            .await
            .unwrap()
            .0["id"]
            .as_i64()
            .unwrap();
        assert!(matches!(
            write_folder(&db, a, None, "research".into()).await,
            Err(ApiError::Invalid(_))
        ));
        assert!(write_folder(&db, b, None, "Research".into()).await.is_ok());
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
            write_folder(&db, b, Some(folder), "Stolen".into()).await,
            Err(ApiError::Missing)
        ));
        assert!(matches!(
            delete_folder(State(db.clone()), headers[1].clone(), Path(folder)).await,
            Err(ApiError::Missing)
        ));
        let _ = write_folder(&db, a, Some(folder), "Reading".into())
            .await
            .unwrap();
        delete_folder(State(db.clone()), headers[0].clone(), Path(folder))
            .await
            .unwrap();
        let status = status(State(db.clone()), headers[0].clone(), Path(post))
            .await
            .unwrap()
            .0;
        assert_eq!(status["saved"], true);
        assert!(status["folder_id"].is_null());
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
}
