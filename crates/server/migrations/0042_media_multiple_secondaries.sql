-- Allow more than one durable secondary without breaking the original
-- singular secondary_provider setting/API. An empty array means disabled.
ALTER TABLE media_settings
    ADD COLUMN secondary_providers TEXT[] NOT NULL DEFAULT '{}'::text[];

UPDATE media_settings
SET secondary_providers = CASE
    WHEN secondary_provider = 'disabled' THEN '{}'::text[]
    ELSE ARRAY[secondary_provider]
END
WHERE cardinality(secondary_providers) = 0;

ALTER TABLE media_settings
    ADD CONSTRAINT media_settings_secondary_providers_values_check
      CHECK (secondary_providers <@ ARRAY['filesystem', 's3', 'ipfs']::text[]),
    ADD CONSTRAINT media_settings_secondary_providers_distinct_check
      CHECK (NOT (primary_provider = ANY(secondary_providers)));
