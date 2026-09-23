-- Provider-neutral media storage. Existing database-backed assets remain
-- readable as `legacy` until an administrator migrates them.
ALTER TABLE media_assets
    ADD COLUMN storage_backend TEXT NOT NULL DEFAULT 'legacy',
    ADD COLUMN object_key TEXT,
    ADD COLUMN mime_type TEXT,
    ADD COLUMN status TEXT NOT NULL DEFAULT 'ready',
    ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public',
    ADD COLUMN variants JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE media_assets
    ADD CONSTRAINT media_assets_storage_backend_check
      CHECK (storage_backend IN ('legacy', 'filesystem', 's3')),
    ADD CONSTRAINT media_assets_status_check
      CHECK (status IN ('uploading', 'ready', 'failed', 'quarantined', 'deleted')),
    ADD CONSTRAINT media_assets_visibility_check
      CHECK (visibility IN ('public', 'private')),
    ADD CONSTRAINT media_assets_variants_object_check
      CHECK (jsonb_typeof(variants) = 'object');

UPDATE media_assets
SET mime_type = NULLIF(content_type, 'application/octet-stream')
WHERE mime_type IS NULL;

CREATE TABLE media_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    primary_provider TEXT NOT NULL DEFAULT 'filesystem'
      CHECK (primary_provider IN ('filesystem', 's3')),
    cache_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    cache_max_bytes BIGINT NOT NULL DEFAULT 5368709120
      CHECK (cache_max_bytes BETWEEN 1048576 AND 1099511627776),
    share_provider TEXT NOT NULL DEFAULT 'disabled'
      CHECK (share_provider IN ('disabled', 'catbox')),
    updated_by BIGINT REFERENCES authors(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO media_settings(singleton)
VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE media_replicas (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    media_id BIGINT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('legacy_db', 'filesystem', 's3', 'catbox')),
    role TEXT NOT NULL CHECK (role IN ('primary', 'cache', 'backup', 'share')),
    variant TEXT NOT NULL DEFAULT 'original',
    object_key TEXT,
    external_url TEXT,
    external_id TEXT,
    checksum TEXT,
    byte_size BIGINT NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    state TEXT NOT NULL DEFAULT 'ready'
      CHECK (state IN ('uploading', 'ready', 'failed', 'deleted')),
    error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_verified_at TIMESTAMPTZ,
    UNIQUE (media_id, provider, role, variant)
);

CREATE INDEX media_replicas_media_idx ON media_replicas(media_id, variant, role);
CREATE INDEX media_replicas_verification_idx ON media_replicas(state, last_verified_at);
