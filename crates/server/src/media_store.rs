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
    time::{Duration, SystemTime},
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
pub struct IpfsConfig {
    pub api_url: String,
    pub gateway_url: Option<String>,
    pub api_token: Option<String>,
}

#[derive(Clone, Debug)]
pub struct MediaConfig {
    pub primary_provider: String,
    /// Durable providers that receive a copy after the primary write. The
    /// first entry is exposed as `secondary_provider` for older callers.
    pub secondary_provider: String,
    pub secondary_providers: Vec<String>,
    pub share_provider: String,
    pub cache_enabled: bool,
    pub cache_max_bytes: u64,
    pub media_root: PathBuf,
    pub cache_root: PathBuf,
    pub s3: Option<S3Config>,
    pub ipfs: Option<IpfsConfig>,
    pub catbox_userhash: Option<String>,
    pub primary_source: String,
    pub secondary_source: String,
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
    pub secondaries: Vec<StoredReplica>,
}

#[derive(Serialize, Clone, Debug)]
pub struct StoredReplica {
    pub backend: String,
    pub variants: Vec<StoredVariant>,
}

#[derive(FromRow)]
struct DbMediaSettings {
    primary_provider: String,
    secondary_provider: String,
    secondary_providers: Vec<String>,
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

fn normalize_provider_list(
    name: &str,
    values: impl IntoIterator<Item = String>,
    allowed: &[&str],
) -> Result<Vec<String>, String> {
    let mut normalized = Vec::new();
    for value in values {
        let value = value.trim().to_ascii_lowercase();
        if value.is_empty() || value == "disabled" {
            continue;
        }
        if !allowed.contains(&value.as_str()) {
            return Err(format!("{name} must contain only {}", allowed.join(", ")));
        }
        if !normalized.contains(&value) {
            normalized.push(value);
        }
    }
    Ok(normalized)
}

fn env_provider_list(
    list_name: &str,
    legacy_name: &str,
    database_values: &[String],
    legacy_database_value: &str,
    allowed: &[&str],
) -> Result<(Vec<String>, String), String> {
    if let Some(value) = env::var(list_name)
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        let values =
            normalize_provider_list(list_name, value.split(',').map(str::to_owned), allowed)?;
        return Ok((values, "environment".to_owned()));
    }
    if let Some(value) = env::var(legacy_name)
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        let values = normalize_provider_list(legacy_name, [value], allowed)?;
        return Ok((values, "environment".to_owned()));
    }
    if !database_values.is_empty() {
        return Ok((
            normalize_provider_list(
                "media_settings.secondary_providers",
                database_values.iter().cloned(),
                allowed,
            )?,
            "database".to_owned(),
        ));
    }
    Ok((
        normalize_provider_list(
            "media_settings.secondary_provider",
            [legacy_database_value.to_owned()],
            allowed,
        )?,
        "database".to_owned(),
    ))
}

pub async fn load_config(db: &PgPool) -> Result<MediaConfig, String> {
    let settings = sqlx::query_as::<_, DbMediaSettings>(
        "SELECT primary_provider, secondary_provider, secondary_providers,
                cache_enabled, cache_max_bytes, share_provider
         FROM media_settings WHERE singleton = TRUE",
    )
    .fetch_optional(db)
    .await
    .map_err(|error| format!("could not load media settings: {error}"))?
    .unwrap_or(DbMediaSettings {
        primary_provider: "filesystem".to_owned(),
        secondary_provider: "disabled".to_owned(),
        secondary_providers: Vec::new(),
        cache_enabled: true,
        cache_max_bytes: 5 * 1024 * 1024 * 1024,
        share_provider: "disabled".to_owned(),
    });
    let (primary_provider, primary_source) = env_choice(
        "SWARTZIT_MEDIA_PRIMARY",
        &settings.primary_provider,
        &["filesystem", "s3", "ipfs"],
    )?;
    let (secondary_providers, secondary_source) = env_provider_list(
        "SWARTZIT_MEDIA_SECONDARIES",
        "SWARTZIT_MEDIA_SECONDARY",
        &settings.secondary_providers,
        &settings.secondary_provider,
        &["filesystem", "s3", "ipfs"],
    )?;
    let secondary_provider = secondary_providers
        .first()
        .cloned()
        .unwrap_or_else(|| "disabled".to_owned());
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
    let ipfs = load_ipfs_config()?;
    if secondary_providers
        .iter()
        .any(|provider| provider == &primary_provider)
    {
        return Err("media secondary providers must differ from the primary provider".to_owned());
    }
    let catbox_userhash = env::var("SWARTZIT_CATBOX_USERHASH")
        .or_else(|_| env::var("CATBOX_USERHASH"))
        .ok()
        .filter(|value| !value.trim().is_empty());
    Ok(MediaConfig {
        primary_provider,
        secondary_provider,
        secondary_providers,
        share_provider,
        cache_enabled: settings.cache_enabled,
        cache_max_bytes,
        media_root,
        cache_root,
        s3,
        ipfs,
        catbox_userhash,
        primary_source,
        secondary_source,
        share_source,
    })
}

fn load_ipfs_config() -> Result<Option<IpfsConfig>, String> {
    let api_url =
        env::var("SWARTZIT_IPFS_API_URL").unwrap_or_else(|_| "http://127.0.0.1:5001".to_owned());
    let api_url = normalize_http_base_url(&api_url, "SWARTZIT_IPFS_API_URL")?;
    let gateway_url = env::var("SWARTZIT_IPFS_GATEWAY_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(|value| normalize_http_base_url(&value, "SWARTZIT_IPFS_GATEWAY_URL"))
        .transpose()?;
    let api_token = env::var("SWARTZIT_IPFS_API_TOKEN")
        .ok()
        .filter(|value| !value.trim().is_empty());
    Ok(Some(IpfsConfig {
        api_url,
        gateway_url,
        api_token,
    }))
}

fn normalize_http_base_url(value: &str, name: &str) -> Result<String, String> {
    let value = value.trim().trim_end_matches('/');
    let url = Url::parse(value).map_err(|error| format!("{name} is invalid: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(format!("{name} must be an http(s) URL"));
    }
    Ok(value.to_owned())
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
    let cache = directory_stats(&config.cache_root).await?;
    Ok(serde_json::json!({
        "primary": config.primary_provider,
        "primary_source": config.primary_source,
        "secondary": config.secondary_provider,
        "secondaries": config.secondary_providers,
        "secondary_source": config.secondary_source,
        "share": config.share_provider,
        "share_source": config.share_source,
        "cache_enabled": config.cache_enabled,
        "cache_max_bytes": config.cache_max_bytes,
        "cache_bytes": cache.bytes,
        "cache_files": cache.files,
        "media_root": config.media_root,
        "cache_root": config.cache_root,
        "s3_configured": config.s3.is_some(),
        "ipfs_configured": config.ipfs.is_some(),
        "ipfs_gateway_configured": config.ipfs.as_ref().is_some_and(|ipfs| ipfs.gateway_url.is_some()),
        "catbox_configured": config.catbox_userhash.is_some(),
    }))
}

#[derive(Serialize, Clone, Debug)]
pub struct StorageContentSummary {
    pub media_type: String,
    pub asset_count: i64,
    pub bytes: i64,
}

#[derive(Serialize, Clone, Debug)]
pub struct StorageReplicaSummary {
    pub provider: String,
    pub role: String,
    pub state: String,
    pub replica_count: i64,
    pub bytes: i64,
}

#[derive(Default, Serialize, Clone, Debug)]
pub struct StorageReplicationSummary {
    pub pending_jobs: i64,
    pub running_jobs: i64,
    pub ready_jobs: i64,
    pub failed_jobs: i64,
    pub attempts: i64,
}

#[derive(Serialize, Clone, Debug)]
pub struct StorageOverview {
    pub database_size_bytes: i64,
    pub canonical_media_assets: i64,
    pub canonical_media_bytes: i64,
    pub local_media_files: i64,
    pub local_media_bytes: i64,
    pub cache_files: i64,
    pub cache_bytes: i64,
    pub project_size_bytes: i64,
    pub content: Vec<StorageContentSummary>,
    pub replicas: Vec<StorageReplicaSummary>,
    pub replication: StorageReplicationSummary,
}

pub async fn storage_overview(db: &PgPool) -> Result<StorageOverview, String> {
    let config = load_config(db).await?;
    let database_size_bytes: i64 =
        sqlx::query_scalar("SELECT pg_database_size(current_database())")
            .fetch_one(db)
            .await
            .map_err(|error| format!("could not measure database size: {error}"))?;
    let (canonical_media_assets, canonical_media_bytes): (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*)::bigint, COALESCE(SUM(byte_size), 0)::bigint
         FROM media_assets WHERE status <> 'deleted'",
    )
    .fetch_one(db)
    .await
    .map_err(|error| format!("could not measure media size: {error}"))?;
    let content = sqlx::query_as::<_, (String, i64, i64)>(
        "SELECT media_type, COUNT(*)::bigint, COALESCE(SUM(byte_size), 0)::bigint
         FROM media_assets
         WHERE status <> 'deleted'
         GROUP BY media_type
         ORDER BY media_type",
    )
    .fetch_all(db)
    .await
    .map_err(|error| format!("could not group media size: {error}"))?
    .into_iter()
    .map(|(media_type, asset_count, bytes)| StorageContentSummary {
        media_type,
        asset_count,
        bytes,
    })
    .collect();
    let replicas = sqlx::query_as::<_, (String, String, String, i64, i64)>(
        "SELECT provider, role, state, COUNT(*)::bigint,
                COALESCE(SUM(byte_size), 0)::bigint
         FROM media_replicas
         GROUP BY provider, role, state
         ORDER BY provider, role, state",
    )
    .fetch_all(db)
    .await
    .map_err(|error| format!("could not group media replicas: {error}"))?
    .into_iter()
    .map(
        |(provider, role, state, replica_count, bytes)| StorageReplicaSummary {
            provider,
            role,
            state,
            replica_count,
            bytes,
        },
    )
    .collect();
    let job_rows = sqlx::query_as::<_, (String, i64, i64)>(
        "SELECT status, COUNT(*)::bigint, COALESCE(SUM(attempts), 0)::bigint
         FROM media_replication_jobs
         GROUP BY status",
    )
    .fetch_all(db)
    .await
    .map_err(|error| format!("could not measure media replication jobs: {error}"))?;
    let mut replication = StorageReplicationSummary::default();
    for (status, count, attempts) in job_rows {
        match status.as_str() {
            "pending" => replication.pending_jobs = count,
            "running" => replication.running_jobs = count,
            "ready" => replication.ready_jobs = count,
            "failed" => replication.failed_jobs = count,
            _ => {}
        }
        replication.attempts += attempts;
    }
    let local_media = directory_stats(&config.media_root).await?;
    let cache = directory_stats(&config.cache_root).await?;
    let project_size_bytes = u64::try_from(database_size_bytes.max(0))
        .unwrap_or_default()
        .saturating_add(local_media.bytes)
        .saturating_add(cache.bytes)
        .min(i64::MAX as u64) as i64;
    Ok(StorageOverview {
        database_size_bytes,
        canonical_media_assets,
        canonical_media_bytes,
        local_media_files: local_media.files.min(i64::MAX as u64) as i64,
        local_media_bytes: local_media.bytes.min(i64::MAX as u64) as i64,
        cache_files: cache.files.min(i64::MAX as u64) as i64,
        cache_bytes: cache.bytes.min(i64::MAX as u64) as i64,
        project_size_bytes,
        content,
        replicas,
        replication,
    })
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

pub struct VariantRead<'a> {
    pub hash: &'a str,
    pub provider: &'a str,
    pub key: Option<&'a str>,
    pub variant: &'a str,
    pub legacy_bytes: Option<&'a [u8]>,
    pub expected_checksum: Option<&'a str>,
    pub secondaries: Vec<(&'a str, &'a str)>,
}

pub async fn read_variant(
    config: &MediaConfig,
    source: VariantRead<'_>,
) -> Result<Vec<u8>, String> {
    if config.cache_enabled
        && let Some(bytes) = read_cache(&config.cache_root, source.hash, source.variant).await?
    {
        if source
            .expected_checksum
            .is_none_or(|expected| checksum(&bytes) == expected)
        {
            return Ok(bytes);
        }
        tracing::warn!(
            hash = source.hash,
            variant = source.variant,
            "media cache checksum mismatch; refetching"
        );
    }
    let mut attempts = Vec::new();
    if source.provider == "legacy" {
        attempts.push((
            source.provider,
            source.key.unwrap_or_default(),
            source.legacy_bytes.map(|bytes| bytes.to_vec()),
        ));
    } else if let Some(key) = source.key {
        attempts.push((source.provider, key, None));
    }
    for (secondary_provider, secondary_key) in source.secondaries {
        if secondary_provider != source.provider {
            attempts.push((secondary_provider, secondary_key, None));
        }
    }
    if attempts.is_empty() {
        return Err("media storage record has no readable object".to_owned());
    }
    let mut errors = Vec::new();
    for (candidate_provider, candidate_key, inline_bytes) in attempts {
        let result = match inline_bytes {
            Some(bytes) => Ok(bytes),
            None => read_primary(config, candidate_provider, candidate_key).await,
        };
        match result {
            Ok(bytes)
                if source
                    .expected_checksum
                    .is_none_or(|expected| checksum(&bytes) == expected) =>
            {
                if config.cache_enabled
                    && let Err(error) =
                        write_cache(config, source.hash, source.variant, &bytes).await
                {
                    tracing::warn!(
                        %error,
                        hash = source.hash,
                        variant = source.variant,
                        "could not populate media cache"
                    );
                }
                return Ok(bytes);
            }
            Ok(_) => errors.push(format!("{candidate_provider}: checksum mismatch")),
            Err(error) => errors.push(format!("{candidate_provider}: {error}")),
        }
    }
    Err(format!(
        "could not read media variant: {}",
        errors.join("; ")
    ))
}

/// Validate and write the canonical primary variants. Secondary providers are
/// queued after the asset row is recorded so partner latency does not block the
/// upload request.
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
        let stored = store_variant(config, hash, &variant, &mime_type, &payload).await?;
        variants.push(stored);
    }
    Ok(StoredAsset {
        backend: config.primary_provider.clone(),
        object_key: variants
            .first()
            .map(|variant| variant.object_key.clone())
            .unwrap_or_default(),
        variants,
        secondaries: Vec::new(),
    })
}

pub async fn store_variant(
    config: &MediaConfig,
    hash: &str,
    variant: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<StoredVariant, String> {
    store_variant_on_provider(
        config,
        &config.primary_provider,
        hash,
        variant,
        mime_type,
        bytes,
    )
    .await
}

pub async fn store_variant_on_provider(
    config: &MediaConfig,
    provider: &str,
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
    let key = put_provider(config, provider, &key, mime_type, bytes).await?;
    Ok(StoredVariant {
        variant: variant.to_owned(),
        object_key: key.clone(),
        byte_size: bytes.len() as u64,
        mime_type: mime_type.to_owned(),
        checksum: checksum(bytes),
        external_url: public_url(config, provider, &key),
    })
}

pub async fn store_variant_replicated(
    config: &MediaConfig,
    hash: &str,
    variant: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<(StoredVariant, Vec<(String, StoredVariant)>), String> {
    let primary = store_variant(config, hash, variant, mime_type, bytes).await?;
    let mut secondaries = Vec::new();
    for provider in &config.secondary_providers {
        let requested_key = object_key(hash, variant);
        let key = put_provider(config, provider, &requested_key, mime_type, bytes)
            .await
            .map_err(|error| {
                format!(
                    "secondary {} write failed after primary write: {error}",
                    provider
                )
            })?;
        secondaries.push((
            provider.clone(),
            StoredVariant {
                variant: variant.to_owned(),
                object_key: key.clone(),
                byte_size: bytes.len() as u64,
                mime_type: mime_type.to_owned(),
                checksum: checksum(bytes),
                external_url: public_url(config, provider, &key),
            },
        ));
    }
    Ok((primary, secondaries))
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

async fn put_provider(
    config: &MediaConfig,
    provider: &str,
    key: &str,
    content_type: &str,
    bytes: &[u8],
) -> Result<String, String> {
    match provider {
        "filesystem" => {
            write_filesystem(&config.media_root, key, bytes).await?;
            Ok(key.to_owned())
        }
        "s3" => {
            let s3 = config.s3.as_ref().ok_or_else(|| {
                "S3 storage is selected but credentials are not configured".to_owned()
            })?;
            let response =
                s3_request(s3, Method::PUT, Some(key), Some(bytes), Some(content_type)).await?;
            ensure_success(response, "S3 upload").await?;
            Ok(key.to_owned())
        }
        "ipfs" => {
            let ipfs = config
                .ipfs
                .as_ref()
                .ok_or_else(|| "IPFS storage is not configured".to_owned())?;
            ipfs_add(ipfs, bytes, content_type).await
        }
        other => Err(format!("unsupported media provider: {other}")),
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
        "ipfs" => {
            let ipfs = config
                .ipfs
                .as_ref()
                .ok_or_else(|| "IPFS storage is not configured".to_owned())?;
            ipfs_cat(ipfs, key).await
        }
        other => Err(format!("unsupported media provider: {other}")),
    }
}

fn ipfs_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("could not create IPFS client: {error}"))
}

fn ipfs_rpc_url(config: &IpfsConfig, command: &str) -> String {
    format!("{}/api/v0/{command}", config.api_url)
}

fn ipfs_authorize(
    request: reqwest::RequestBuilder,
    config: &IpfsConfig,
) -> reqwest::RequestBuilder {
    match &config.api_token {
        Some(token) => request.bearer_auth(token),
        None => request,
    }
}

async fn ipfs_add(config: &IpfsConfig, bytes: &[u8], content_type: &str) -> Result<String, String> {
    let part = reqwest::multipart::Part::bytes(bytes.to_vec())
        .file_name("media.bin")
        .mime_str(content_type)
        .map_err(|error| format!("invalid IPFS media type: {error}"))?;
    let form = reqwest::multipart::Form::new().part("file", part);
    let client = ipfs_client()?;
    let response = ipfs_authorize(
        client
            .post(ipfs_rpc_url(config, "add"))
            .query(&[
                ("pin", "true"),
                ("cid-version", "1"),
                ("raw-leaves", "true"),
                ("wrap-with-directory", "false"),
            ])
            .multipart(form),
        config,
    )
    .send()
    .await
    .map_err(|error| format!("IPFS add failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("IPFS add response could not be read: {error}"))?;
    if !status.is_success() {
        return Err(format!("IPFS add failed with HTTP {status}: {body}"));
    }
    ipfs_cid_from_add_response(&body)
}

fn ipfs_cid_from_add_response(body: &str) -> Result<String, String> {
    for line in body.lines().rev() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let cid = value
            .get("Hash")
            .and_then(Value::as_str)
            .or_else(|| value.get("Cid").and_then(Value::as_str))
            .or_else(|| {
                value
                    .get("Cid")
                    .and_then(|cid| cid.get("/"))
                    .and_then(Value::as_str)
            });
        if let Some(cid) = cid.filter(|cid| valid_ipfs_key(cid)) {
            return Ok(cid.to_owned());
        }
    }
    Err("IPFS add returned no valid CID".to_owned())
}

fn valid_ipfs_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 256 && key.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

async fn ipfs_cat(config: &IpfsConfig, key: &str) -> Result<Vec<u8>, String> {
    if !valid_ipfs_key(key) {
        return Err("IPFS object key is not a valid CID".to_owned());
    }
    let client = ipfs_client()?;
    let response = ipfs_authorize(
        client
            .post(ipfs_rpc_url(config, "cat"))
            .query(&[("arg", key)]),
        config,
    )
    .send()
    .await
    .map_err(|error| format!("IPFS cat failed: {error}"))?;
    let response = ensure_response(response, "IPFS cat").await?;
    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|error| format!("could not read IPFS media: {error}"))
}

async fn ipfs_unpin(config: &IpfsConfig, key: &str) -> Result<(), String> {
    if !valid_ipfs_key(key) {
        return Err("IPFS object key is not a valid CID".to_owned());
    }
    let client = ipfs_client()?;
    let response = ipfs_authorize(
        client
            .post(ipfs_rpc_url(config, "pin/rm"))
            .query(&[("arg", key), ("recursive", "true")]),
        config,
    )
    .send()
    .await
    .map_err(|error| format!("IPFS unpin failed: {error}"))?;
    ensure_success(response, "IPFS unpin").await
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
struct DirectoryStats {
    bytes: u64,
    files: u64,
}

async fn directory_stats(root: &Path) -> Result<DirectoryStats, String> {
    let mut files = Vec::new();
    collect_cache_files(root, &mut files).await?;
    Ok(DirectoryStats {
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

async fn test_provider(config: &MediaConfig, provider: &str) -> Result<(), String> {
    let bytes = format!(
        "swartzit-media-storage-test:{}:{}",
        provider,
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    )
    .into_bytes();
    let hash = checksum(&bytes);
    let key = format!("health/{hash}");
    match provider {
        "filesystem" => {
            write_filesystem(&config.media_root, &key, &bytes).await?;
            tokio::fs::remove_file(config.media_root.join(key))
                .await
                .map_err(|error| format!("could not clean storage test object: {error}"))?;
            Ok(())
        }
        "s3" => {
            let s3 = config.s3.as_ref().ok_or_else(|| {
                "S3 storage is selected but credentials are not configured".to_owned()
            })?;
            let response = s3_request(
                s3,
                Method::PUT,
                Some(&key),
                Some(&bytes),
                Some("text/plain"),
            )
            .await?;
            ensure_success(response, "S3 storage test upload").await?;
            let response = s3_request(s3, Method::DELETE, Some(&key), None, None).await?;
            ensure_success(response, "S3 storage test cleanup").await
        }
        "ipfs" => {
            let ipfs = config
                .ipfs
                .as_ref()
                .ok_or_else(|| "IPFS storage is not configured".to_owned())?;
            let cid = ipfs_add(ipfs, &bytes, "text/plain").await?;
            let read_result = ipfs_cat(ipfs, &cid).await;
            let unpin_result = ipfs_unpin(ipfs, &cid).await;
            match (read_result, unpin_result) {
                (Ok(read), Ok(())) if read == bytes => Ok(()),
                (Ok(_), Ok(())) => Err("IPFS storage test checksum mismatch".to_owned()),
                (Err(error), Ok(())) => Err(error),
                (Ok(_), Err(error)) => Err(error),
                (Err(read_error), Err(unpin_error)) => {
                    Err(format!("{read_error}; cleanup also failed: {unpin_error}"))
                }
            }
        }
        "disabled" => Ok(()),
        other => Err(format!("unsupported media provider: {other}")),
    }
}

pub async fn test_configured(config: &MediaConfig) -> Result<Vec<String>, String> {
    let mut tested = Vec::new();
    test_provider(config, &config.primary_provider).await?;
    tested.push(config.primary_provider.clone());
    for provider in &config.secondary_providers {
        test_provider(config, provider).await?;
        tested.push(provider.clone());
    }
    Ok(tested)
}

pub fn public_url(config: &MediaConfig, provider: &str, key: &str) -> Option<String> {
    match provider {
        "s3" => config.s3.as_ref().and_then(|s3| {
            s3.public_base_url
                .as_ref()
                .map(|base| format!("{}/{}", base.trim_end_matches('/'), key))
        }),
        "ipfs" => config.ipfs.as_ref().and_then(|ipfs| {
            ipfs.gateway_url
                .as_ref()
                .map(|base| format!("{}/ipfs/{key}", base.trim_end_matches('/')))
        }),
        _ => None,
    }
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

    #[test]
    fn secondary_provider_lists_are_normalized_and_deduplicated() {
        let providers = normalize_provider_list(
            "SWARTZIT_MEDIA_SECONDARIES",
            [
                " S3 ".to_owned(),
                "ipfs".to_owned(),
                "s3".to_owned(),
                "disabled".to_owned(),
            ],
            &["filesystem", "s3", "ipfs"],
        )
        .expect("valid provider list");
        assert_eq!(providers, vec!["s3", "ipfs"]);
    }

    #[test]
    fn secondary_provider_lists_reject_unknown_backends() {
        let error = normalize_provider_list(
            "SWARTZIT_MEDIA_SECONDARIES",
            ["catbox".to_owned()],
            &["filesystem", "s3", "ipfs"],
        )
        .expect_err("unknown provider should fail");
        assert!(error.contains("SWARTZIT_MEDIA_SECONDARIES"));
    }

    #[test]
    fn database_provider_lists_fall_back_to_the_legacy_setting() {
        let (providers, source) = env_provider_list(
            "SWARTZIT_MEDIA_SECONDARIES_TEST_UNSET",
            "SWARTZIT_MEDIA_SECONDARY_TEST_UNSET",
            &[],
            "s3",
            &["filesystem", "s3", "ipfs"],
        )
        .expect("legacy provider setting");
        assert_eq!(providers, vec!["s3"]);
        assert_eq!(source, "database");
    }

    #[test]
    fn ipfs_add_response_reads_the_final_streaming_cid() {
        let body = concat!(
            "{\"Name\":\"media.bin\",\"Hash\":\"bafyfirst\",\"Size\":\"1\"}\n",
            "{\"Name\":\"media.bin\",\"Hash\":\"bafyfinal\",\"Size\":\"2\"}\n"
        );
        assert_eq!(
            ipfs_cid_from_add_response(body).expect("IPFS CID"),
            "bafyfinal"
        );
    }

    #[test]
    fn ipfs_object_keys_cannot_escape_the_cid_path() {
        assert!(valid_ipfs_key("bafybeigdyrzt"));
        assert!(!valid_ipfs_key("https://gateway.example/ipfs/bafy"));
        assert!(!valid_ipfs_key(""));
    }
}
