ALTER TABLE authors ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE system_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
    event TEXT NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    slot BIGINT GENERATED ALWAYS AS (id % 1000) STORED UNIQUE
);
CREATE INDEX system_logs_created_idx ON system_logs(created_at DESC, id DESC);

-- Keep operational history bounded. This is deliberately small for the local
-- prototype and can be made configurable when the deployment story matures.
-- ON CONFLICT(slot) replaces old entries, bounded even with concurrent writers.
