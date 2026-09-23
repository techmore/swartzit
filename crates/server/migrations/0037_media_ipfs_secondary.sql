-- Add IPFS as a durable media provider and make the optional second copy
-- explicit. Catbox remains a share/export provider, not a storage replica.
ALTER TABLE media_assets
    DROP CONSTRAINT IF EXISTS media_assets_storage_backend_check;

ALTER TABLE media_assets
    ADD CONSTRAINT media_assets_storage_backend_check
      CHECK (storage_backend IN ('legacy', 'filesystem', 's3', 'ipfs'));

ALTER TABLE media_settings
    DROP CONSTRAINT IF EXISTS media_settings_primary_provider_check;

ALTER TABLE media_settings
    ADD CONSTRAINT media_settings_primary_provider_check
      CHECK (primary_provider IN ('filesystem', 's3', 'ipfs'));

ALTER TABLE media_settings
    ADD COLUMN secondary_provider TEXT NOT NULL DEFAULT 'disabled';

ALTER TABLE media_settings
    ADD CONSTRAINT media_settings_secondary_provider_check
      CHECK (secondary_provider IN ('disabled', 'filesystem', 's3', 'ipfs')),
    ADD CONSTRAINT media_settings_distinct_providers_check
      CHECK (secondary_provider = 'disabled' OR secondary_provider <> primary_provider);

ALTER TABLE media_replicas
    DROP CONSTRAINT IF EXISTS media_replicas_provider_check,
    DROP CONSTRAINT IF EXISTS media_replicas_role_check;

ALTER TABLE media_replicas
    ADD CONSTRAINT media_replicas_provider_check
      CHECK (provider IN ('legacy_db', 'filesystem', 's3', 'ipfs', 'catbox')),
    ADD CONSTRAINT media_replicas_role_check
      CHECK (role IN ('primary', 'secondary', 'cache', 'backup', 'share'));
