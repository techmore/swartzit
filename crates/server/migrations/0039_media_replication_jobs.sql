-- Secondary provider writes are durable background work. The primary media
-- object is committed first; this queue records partner replication attempts
-- so a process restart or partner outage does not lose the intent to copy it.
CREATE TABLE media_replication_jobs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    media_id BIGINT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('filesystem', 's3', 'ipfs')),
    variant TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'running', 'ready', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_at TIMESTAMPTZ,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    UNIQUE (media_id, provider, variant)
);

CREATE INDEX media_replication_jobs_claim_idx
    ON media_replication_jobs(status, available_at, id);

CREATE INDEX media_replication_jobs_media_idx
    ON media_replication_jobs(media_id, provider, variant);
