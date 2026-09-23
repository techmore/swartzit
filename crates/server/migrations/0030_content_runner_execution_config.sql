ALTER TABLE content_runners
    ADD COLUMN environment_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN capture_output BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN max_log_bytes INTEGER NOT NULL DEFAULT 20000,
    ADD CONSTRAINT content_runners_environment_keys_check CHECK (jsonb_typeof(environment_keys) = 'array'),
    ADD CONSTRAINT content_runners_log_bytes_check CHECK (max_log_bytes BETWEEN 1024 AND 20000);
