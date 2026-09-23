use chrono::Utc;
use hmac::{Hmac, Mac};
use image::ImageFormat;
use reqwest::{Client, Method, header};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool};
use std::{
    cmp::Reverse,
    env,
    path::{Path, PathBuf},
    time::SystemTime,
};
use tokio::io::AsyncWriteExt;
use url::Url;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Debug)]
pub struct S3Config {
    pub endpoint: String,
    pub bucket: String,
    pub region: String,
    pub access_key: String,
    pub secret_key: String,
    pub public_base_url: Option<String>,
}

#[derive(Clone, Debug)]
pub struct MediaConfig {
    pub primary_provider: String,
    pub share_provider: String,
    pub cache_enabled: bool,
    pub cache_max_bytes: u64,
    pub media_root: PathBuf,
    pub cache_root: PathBuf,
    pub s3: Option<S3Config>,
    pub catbox_userhash: Option<String>,
    pub primary_source: String,
    pub share_source: String,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct StoredVariant {
    pub variant: String,
    pub object_key: String,
    pub byte_size: u64,
    pub mime_type: String,
    pub checksum: String,
    pub external_url: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct StoredAsset {
    pub backend: String,
    pub object_key: String,
    pub variants: Vec<StoredVariant>,
}

#[derive(FromRow)]
struct DbMediaSettings {
    primary_provider: String,
    cache_enabled: bool,
    cache_max_bytes: i64,
    share_provider: String,
}

fn data_root() -> PathBuf {
    if let Ok(path) = env::var("SWARTZIT_DATA_DIR") {
        return PathBuf::from(path);
    }
    if let Ok(path) = env::var("SWARTZIT_STATE_DIR") {
        return PathBuf::from(path);
    }
    if let Ok(home) = env::var("HOME") {
        return PathBuf::from(home).join("Library/Application Support/Swartzit");
    }
    PathBuf::from(".local")
}

fn env_choice(name: &str, fallback: &str, allowed: &[&str]) -> Result<(String, String), String> {
    let Some(value) = env::var(name).ok().filter(|value| !value.trim().is_empty()) else {
        return Ok((fallback.to_owned(), "database".to_owned()));
    };
    let value = value.trim().to_ascii_lowercase();
    if !allowed.contains(&value.as_str()) {
        return Err(format!("{name} must be one of {}", allowed.join(", ")));
    }
    Ok((value, "environment".to_owned()))
}

pub async fn load_config(db: &PgPool) -> Result<MediaConfig, String> {
    let settings = sqlx::query_as::<_, DbMediaSettings>(
        "SELECT primary_provider, cache_enabled, cache_max_bytes, share_provider
         FROM media_settings WHERE singleton = TRUE",
    )
    .fetch_optional(db)
    .await
    .map_err(|error| format!("could not load media settings: {error}"))?
    .unwrap_or(DbMediaSettings {
        primary_provider: "filesystem".to_owned(),
        cache_enabled: true,
        cache_max_bytes: 5 * 1024 * 1024 * 1024,
        share_provider: "disabled".to_owned(),
    });
    let (primary_provider, primary_source) = env_choice(
        "SWARTZIT_MEDIA_PRIMARY",
        &settings.primary_provider,
        &["filesystem", "s3"],
    )?;
    let (share_provider, share_source) = env_choice(
        "SWARTZIT_MEDIA_SHARE",
        &settings.share_provider,
        &["disabled", "catbox"],
    )?;
    let cache_max_bytes = env::var("SWARTZIT_MEDIA_CACHE_MAX_BYTES")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(settings.cache_max_bytes.max(1_048_576) as u64);
    let media_root = env::var("SWARTZIT_MEDIA_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| data_root().join("media"));
    let cache_root = env::var("SWARTZIT_MEDIA_CACHE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| data_root().join("cache"));
    let s3 = load_s3_config();
    let catbox_userhash = env::var("SWARTZIT_CATBOX_USERHASH")
        .or_else(|_| env::var("CATBOX_USERHASH"))
        .ok()
        .filter(|value| !value.trim().is_empty());
    Ok(MediaConfig {
        primary_provider,
        share_provider,
        cache_enabled: settings.cache_enabled,
        cache_max_bytes,
        media_root,
        cache_root,
        s3,
        catbox_userhash,
        primary_source,
        share_source,
    })
}

fn load_s3_config() -> Option<S3Config> {
    let endpoint = env::var("SWARTZIT_S3_ENDPOINT").ok()?;
    let bucket = env::var("SWARTZIT_S3_BUCKET").ok()?;
    let access_key = env::var("SWARTZIT_S3_ACCESS_KEY").ok()?;
    let secret_key = env::var("SWARTZIT_S3_SECRET_KEY").ok()?;
    if endpoint.trim().is_empty()
        || bucket.trim().is_empty()
        || access_key.trim().is_empty()
        || secret_key.trim().is_empty()
    {
        return None;
    }
    Some(S3Config {
        endpoint: endpoint.trim_end_matches('/').to_owned(),
        bucket,
        region: env::var("SWARTZIT_S3_REGION").unwrap_or_else(|_| "us-east-1".to_owned()),
        access_key,
        secret_key,
        public_base_url: env::var("SWARTZIT_S3_PUBLIC_BASE_URL")
            .ok()
            .filter(|value| !value.trim().is_empty()),
    })
}

pub async fn settings_view(db: &PgPool) -> Result<Value, String> {
    let config = load_config(db).await?;
    let cache = cache_stats(&config.cache_root).await?;
    Ok(serde_json::json!({
        "primary": config.primary_provider,
        "primary_source": config.primary_source,
        "share": config.share_provider,
        "share_source": config.share_source,
        "cache_enabled": config.cache_enabled,
        "cache_max_bytes": config.cache_max_bytes,
        "cache_bytes": cache.bytes,
        "cache_files": cache.files,
        "media_root": config.media_root,
        "cache_root": config.cache_root,
        "s3_configured": config.s3.is_some(),
        "catbox_configured": config.catbox_userhash.is_some(),
    }))
}

pub fn object_key(hash: &str, variant: &str) -> String {
    let prefix = hash.get(..2).unwrap_or("00");
    format!("media/{prefix}/{hash}/{variant}")
}

pub fn variants_json(variants: &[StoredVariant]) -> Value {
    let mut object = serde_json::Map::new();
    for variant in variants {
        object.insert(
            variant.variant.clone(),
            serde_json::json!({
                "object_key": variant.object_key,
                "byte_size": variant.byte_size,
                "mime_type": variant.mime_type,
                "checksum": variant.checksum,
                "external_url": variant.external_url,
            }),
        );
    }
    Value::Object(object)
}

pub fn checksum(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub fn variant_metadata(variants: &Value, variant: &str) -> Option<StoredVariant> {
    let mut value = variants.get(variant)?.clone();
    if let Some(object) = value.as_object_mut() {
        object.insert("variant".to_owned(), Value::String(variant.to_owned()));
    }
    serde_json::from_value(value).ok()
}

pub async fn read_variant(
    config: &MediaConfig,
    hash: &str,
    provider: &str,
    key: Option<&str>,
    variant: &str,
    legacy_bytes: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    if config.cache_enabled {
        if let Some(bytes) = read_cache(&config.cache_root, hash, variant).await? {
            return Ok(bytes);
        }
    }
    let bytes = if provider == "legacy" {
        legacy_bytes
            .map(|bytes| bytes.to_vec())
            .ok_or_else(|| "legacy media has no database content".to_owned())?
    } else {
        let key = key.ok_or_else(|| "media storage record has no object key".to_owned())?;
        read_primary(config, provider, key).await?
    };
    if config.cache_enabled {
        if let Err(error) = write_cache(config, hash, variant, &bytes).await {
            tracing::warn!(%error, hash, variant, "could not populate media cache");
        }
    }
    Ok(bytes)
}

pub async fn store_asset(
    config: &MediaConfig,
    hash: &str,
    content_type: &str,
    bytes: &[u8],
) -> Result<StoredAsset, String> {
    if bytes.is_empty() {
        return Err("media cannot be empty".to_owned());
    }
    if content_type.starts_with("image/") {
        let detected = image::guess_format(bytes)
            .map_err(|error| format!("could not identify image content: {error}"))?;
        let detected_type = match detected {
            ImageFormat::Gif => "image/gif",
            ImageFormat::Jpeg => "image/jpeg",
            ImageFormat::Png => "image/png",
            ImageFormat::WebP => "image/webp",
            _ => return Err("image format is not supported".to_owned()),
        };
        if detected_type != content_type {
            return Err("declared image type does not match the file content".to_owned());
        }
    }
    let actual_hash = checksum(bytes);
    if actual_hash != hash {
        return Err("media checksum did not match the content".to_owned());
    }
    let mut payloads = vec![(
        "original".to_owned(),
        content_type.to_owned(),
        bytes.to_vec(),
    )];
    if content_type.starts_with("image/") {
        let thumbnail = make_thumbnail(bytes)?;
        payloads.push(("thumbnail".to_owned(), "image/jpeg".to_owned(), thumbnail));
    }
    let mut variants = Vec::with_capacity(payloads.len());
    for (variant, mime_type, payload) in payloads {
        variants.push(store_variant(config, hash, &variant, &mime_type, &payload).await?);
    }
    Ok(StoredAsset {
        backend: config.primary_provider.clone(),
        object_key: variants
            .first()
            .map(|variant| variant.object_key.clone())
            .unwrap_or_default(),
        variants,
    })
}

pub async fn store_variant(
    config: &MediaConfig,
    hash: &str,
    variant: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<StoredVariant, String> {
    if variant.is_empty()
        || !variant.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'_'
        })
    {
        return Err("media variant name is invalid".to_owned());
    }
    let key = object_key(hash, variant);
    put_primary(config, &key, mime_type, bytes).await?;
    Ok(StoredVariant {
        variant: variant.to_owned(),
        object_key: key.clone(),
        byte_size: bytes.len() as u64,
        mime_type: mime_type.to_owned(),
        checksum: checksum(bytes),
        external_url: public_url(config, &key),
    })
}

fn make_thumbnail(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory(bytes)
        .map_err(|error| format!("could not decode image for thumbnail: {error}"))?;
    let image = image.thumbnail(512, 512);
    let mut output = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut output, ImageFormat::Jpeg)
        .map_err(|error| format!("could not encode image thumbnail: {error}"))?;
    Ok(output.into_inner())
}

async fn put_primary(
    config: &MediaConfig,
    key: &str,
    content_type: &str,
    bytes: &[u8],
) -> Result<(), String> {
    match config.primary_provider.as_str() {
        "filesystem" => write_filesystem(&config.media_root, key, bytes).await,
        "s3" => {
            let s3 = config.s3.as_ref().ok_or_else(|| {
                "S3 storage is selected but credentials are not configured".to_owned()
            })?;
            let response =
                s3_request(s3, Method::PUT, Some(key), Some(bytes), Some(content_type)).await?;
            ensure_success(response, "S3 upload").await
        }
        other => Err(format!("unsupported primary media provider: {other}")),
    }
}

pub async fn read_primary(
    config: &MediaConfig,
    provider: &str,
    key: &str,
) -> Result<Vec<u8>, String> {
    match provider {
        "filesystem" => tokio::fs::read(config.media_root.join(key))
            .await
            .map_err(|error| format!("could not read local media: {error}")),
        "s3" => {
            let s3 = config.s3.as_ref().ok_or_else(|| {
                "S3 storage is selected but credentials are not configured".to_owned()
            })?;
            let response = s3_request(s3, Method::GET, Some(key), None, None).await?;
            let response = ensure_response(response, "S3 download").await?;
            response
                .bytes()
                .await
                .map(|bytes| bytes.to_vec())
                .map_err(|error| format!("could not read S3 media: {error}"))
        }
        other => Err(format!("unsupported media provider: {other}")),
    }
}

pub async fn write_cache(
    config: &MediaConfig,
    hash: &str,
    variant: &str,
    bytes: &[u8],
) -> Result<(), String> {
    if !config.cache_enabled {
        return Ok(());
    }
    let path = cache_path(&config.cache_root, hash, variant);
    write_filesystem_path(&path, bytes).await?;
    sweep_cache(&config.cache_root, config.cache_max_bytes).await
}

pub async fn read_cache(
    cache_root: &Path,
    hash: &str,
    variant: &str,
) -> Result<Option<Vec<u8>>, String> {
    let path = cache_path(cache_root, hash, variant);
    match tokio::fs::read(path).await {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not read media cache: {error}")),
    }
}

pub async fn clear_cache(cache_root: &Path) -> Result<(), String> {
    match tokio::fs::remove_dir_all(cache_root).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not clear media cache: {error}")),
    }
}

#[derive(Default)]
struct CacheStats {
    bytes: u64,
    files: u64,
}

async fn cache_stats(root: &Path) -> Result<CacheStats, String> {
    let mut files = Vec::new();
    collect_cache_files(root, &mut files).await?;
    Ok(CacheStats {
        bytes: files.iter().map(|(_, size, _)| *size).sum(),
        files: files.len() as u64,
    })
}

async fn sweep_cache(root: &Path, max_bytes: u64) -> Result<(), String> {
    let mut files = {
        let mut files = Vec::new();
        collect_cache_files(root, &mut files).await?;
        files
    };
    let mut total: u64 = files.iter().map(|(_, size, _)| *size).sum();
    if total <= max_bytes {
        return Ok(());
    }
    files.sort_by_key(|(_, _, modified)| Reverse(*modified));
    for (path, size, _) in files.into_iter().rev() {
        if total <= max_bytes {
            break;
        }
        if tokio::fs::remove_file(path).await.is_ok() {
            total = total.saturating_sub(size);
        }
    }
    Ok(())
}

async fn collect_cache_files(
    root: &Path,
    files: &mut Vec<(PathBuf, u64, SystemTime)>,
) -> Result<(), String> {
    let mut entries = match tokio::fs::read_dir(root).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("could not inspect media cache: {error}")),
    };
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| format!("could not inspect media cache: {error}"))?
    {
        let metadata = entry
            .metadata()
            .await
            .map_err(|error| format!("could not inspect media cache: {error}"))?;
        if metadata.is_file() {
            files.push((
                entry.path(),
                metadata.len(),
                metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            ));
        } else if metadata.is_dir() {
            Box::pin(collect_cache_files(&entry.path(), files)).await?;
        }
    }
    Ok(())
}

fn cache_path(root: &Path, hash: &str, variant: &str) -> PathBuf {
    root.join(hash.get(..2).unwrap_or("00"))
        .join(hash)
        .join(variant)
}

async fn write_filesystem(root: &Path, key: &str, bytes: &[u8]) -> Result<(), String> {
    write_filesystem_path(&root.join(key), bytes).await
}

async fn write_filesystem_path(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "media storage path has no parent".to_owned())?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| format!("could not create media directory: {error}"))?;
    let temporary = parent.join(format!(
        ".{}.{}.{}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy(),
        std::process::id(),
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    let mut file = tokio::fs::File::create(&temporary)
        .await
        .map_err(|error| format!("could not create temporary media file: {error}"))?;
    file.write_all(bytes)
        .await
        .map_err(|error| format!("could not write media file: {error}"))?;
    file.flush()
        .await
        .map_err(|error| format!("could not flush media file: {error}"))?;
    drop(file);
    tokio::fs::rename(&temporary, path)
        .await
        .map_err(|error| format!("could not finalize media file: {error}"))
}

pub async fn test_primary(config: &MediaConfig) -> Result<(), String> {
    let bytes = b"swartzit-media-storage-test";
    let hash = hex::encode(Sha256::digest(bytes));
    let key = format!("health/{hash}");
    match config.primary_provider.as_str() {
        "filesystem" => {
            write_filesystem(&config.media_root, &key, bytes).await?;
            tokio::fs::remove_file(config.media_root.join(key))
                .await
                .map_err(|error| format!("could not clean storage test object: {error}"))?;
            Ok(())
        }
        "s3" => {
            let s3 = config.s3.as_ref().ok_or_else(|| {
                "S3 storage is selected but credentials are not configured".to_owned()
            })?;
            let response =
                s3_request(s3, Method::PUT, Some(&key), Some(bytes), Some("text/plain")).await?;
            ensure_success(response, "S3 storage test upload").await?;
            let response = s3_request(s3, Method::DELETE, Some(&key), None, None).await?;
            ensure_success(response, "S3 storage test cleanup").await
        }
        other => Err(format!("unsupported primary media provider: {other}")),
    }
}

pub fn public_url(config: &MediaConfig, key: &str) -> Option<String> {
    config.s3.as_ref().and_then(|s3| {
        s3.public_base_url
            .as_ref()
            .map(|base| format!("{}/{}", base.trim_end_matches('/'), key))
    })
}

pub async fn share_catbox(
    config: &MediaConfig,
    bytes: &[u8],
    content_type: &str,
    filename: &str,
) -> Result<(String, String), String> {
    if config.share_provider != "catbox" {
        return Err("external media sharing is disabled".to_owned());
    }
    let mut form = reqwest::multipart::Form::new().text("reqtype", "fileupload");
    if let Some(userhash) = &config.catbox_userhash {
        form = form.text("userhash", userhash.clone());
    }
    let part = reqwest::multipart::Part::bytes(bytes.to_vec())
        .file_name(filename.to_owned())
        .mime_str(content_type)
        .map_err(|error| format!("invalid Catbox media type: {error}"))?;
    let response = Client::new()
        .post("https://catbox.moe/user/api.php")
        .multipart(form.part("fileToUpload", part))
        .send()
        .await
        .map_err(|error| format!("Catbox upload failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Catbox response could not be read: {error}"))?;
    let url = body.trim().to_owned();
    if !status.is_success() || !url.starts_with("https://files.catbox.moe/") {
        return Err(format!("Catbox rejected the upload: HTTP {status} {body}"));
    }
    let external_id = url.rsplit('/').next().unwrap_or_default().to_owned();
    Ok((url, external_id))
}

pub async fn delete_catbox(config: &MediaConfig, external_id: &str) -> Result<(), String> {
    let userhash = config
        .catbox_userhash
        .as_deref()
        .ok_or_else(|| "Catbox deletion requires SWARTZIT_CATBOX_USERHASH".to_owned())?;
    let response = Client::new()
        .post("https://catbox.moe/user/api.php")
        .form(&[
            ("reqtype", "deletefiles"),
            ("userhash", userhash),
            ("files", external_id),
        ])
        .send()
        .await
        .map_err(|error| format!("Catbox deletion failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Catbox deletion failed with HTTP {}",
            response.status()
        ));
    }
    Ok(())
}

async fn s3_request(
    config: &S3Config,
    method: Method,
    key: Option<&str>,
    body: Option<&[u8]>,
    content_type: Option<&str>,
) -> Result<reqwest::Response, String> {
    let endpoint =
        Url::parse(&config.endpoint).map_err(|error| format!("invalid S3 endpoint: {error}"))?;
    let suffix = match key {
        Some(key) => format!("{}/{}", config.bucket, key),
        None => config.bucket.clone(),
    };
    let base_path = endpoint.path().trim_end_matches('/');
    let path = if base_path.is_empty() {
        format!("/{suffix}")
    } else {
        format!("{base_path}/{suffix}")
    };
    let mut url = endpoint.clone();
    url.set_path(&path);
    url.set_query(None);
    let host = match url.port() {
        Some(port) => format!("{}:{port}", url.host_str().unwrap_or_default()),
        None => url.host_str().unwrap_or_default().to_owned(),
    };
    let payload_hash = hex::encode(Sha256::digest(body.unwrap_or(&[])));
    let amz_date = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let short_date = &amz_date[..8];
    let canonical_headers = if let Some(content_type) = content_type {
        format!(
            "content-type:{content_type}\nhost:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
        )
    } else {
        format!("host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n")
    };
    let signed_headers = if content_type.is_some() {
        "content-type;host;x-amz-content-sha256;x-amz-date"
    } else {
        "host;x-amz-content-sha256;x-amz-date"
    };
    let canonical_request = format!(
        "{}\n{}\n\n{}\n{}\n{}",
        method.as_str(),
        url.path(),
        canonical_headers,
        signed_headers,
        payload_hash
    );
    let scope = format!("{short_date}/{}/{}/aws4_request", config.region, "s3");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
        hex::encode(Sha256::digest(canonical_request.as_bytes()))
    );
    let signing_key = signing_key(&config.secret_key, short_date, &config.region, "s3")?;
    let signature = hmac_hex(&signing_key, string_to_sign.as_bytes())?;
    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed_headers}, Signature={signature}",
        config.access_key
    );
    let client = Client::new();
    let mut request = client
        .request(method, url)
        .header("host", host)
        .header("x-amz-content-sha256", payload_hash)
        .header("x-amz-date", amz_date)
        .header("authorization", authorization);
    if let Some(content_type) = content_type {
        request = request.header(header::CONTENT_TYPE, content_type);
    }
    if let Some(body) = body {
        request = request.body(body.to_vec());
    }
    request
        .send()
        .await
        .map_err(|error| format!("S3 request failed: {error}"))
}

fn signing_key(secret: &str, date: &str, region: &str, service: &str) -> Result<Vec<u8>, String> {
    let date_key = hmac_bytes(format!("AWS4{secret}").as_bytes(), date.as_bytes())?;
    let region_key = hmac_bytes(&date_key, region.as_bytes())?;
    let service_key = hmac_bytes(&region_key, service.as_bytes())?;
    hmac_bytes(&service_key, b"aws4_request")
}

fn hmac_bytes(key: &[u8], value: &[u8]) -> Result<Vec<u8>, String> {
    let mut mac =
        HmacSha256::new_from_slice(key).map_err(|error| format!("HMAC error: {error}"))?;
    mac.update(value);
    Ok(mac.finalize().into_bytes().to_vec())
}

fn hmac_hex(key: &[u8], value: &[u8]) -> Result<String, String> {
    Ok(hex::encode(hmac_bytes(key, value)?))
}

async fn ensure_response(
    response: reqwest::Response,
    operation: &str,
) -> Result<reqwest::Response, String> {
    if response.status().is_success() {
        Ok(response)
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(format!("{operation} failed with HTTP {status}: {body}"))
    }
}

async fn ensure_success(response: reqwest::Response, operation: &str) -> Result<(), String> {
    ensure_response(response, operation).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn object_keys_are_content_addressed_and_variant_specific() {
        let hash = "abcdef0123456789";
        assert_eq!(
            object_key(hash, "original"),
            "media/ab/abcdef0123456789/original"
        );
        assert_ne!(object_key(hash, "original"), object_key(hash, "thumbnail"));
    }

    #[test]
    fn variant_metadata_recovers_the_variant_name_from_the_map_key() {
        let variants = serde_json::json!({
            "thumbnail": {
                "object_key": "media/ab/hash/thumbnail",
                "byte_size": 12,
                "mime_type": "image/jpeg",
                "checksum": "deadbeef",
                "external_url": null
            }
        });
        assert_eq!(
            variant_metadata(&variants, "thumbnail")
                .expect("thumbnail metadata")
                .variant,
            "thumbnail"
        );
    }

    #[test]
    fn checksum_is_sha256_hex() {
        assert_eq!(
            checksum(b"swartzit"),
            "b552eaf72ef6b99b1df32220a7b5ca058167b3119a5912c9e04a284d3b0098ca"
        );
    }
}
