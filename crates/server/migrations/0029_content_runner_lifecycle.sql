-- Operational lifecycle and execution policy for content runners.
ALTER TABLE content_runners
    ADD COLUMN state TEXT NOT NULL DEFAULT 'draft',
    ADD COLUMN timeout_seconds INTEGER NOT NULL DEFAULT 900,
    ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN retry_backoff_seconds INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN failure_threshold INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN current_attempt INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN retention_days INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN paused_reason TEXT,
    ADD COLUMN archived_at TIMESTAMPTZ,
    ADD COLUMN last_success_at TIMESTAMPTZ,
    ADD COLUMN config_version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN updated_by BIGINT REFERENCES authors(id) ON DELETE SET NULL;

UPDATE content_runners
SET state = CASE WHEN enabled THEN 'enabled' ELSE 'draft' END;

ALTER TABLE content_runners
    ADD CONSTRAINT content_runners_state_check CHECK (state IN ('draft', 'enabled', 'paused', 'retrying', 'archived')),
    ADD CONSTRAINT content_runners_timeout_check CHECK (timeout_seconds BETWEEN 30 AND 86400),
    ADD CONSTRAINT content_runners_attempts_check CHECK (max_attempts BETWEEN 1 AND 10),
    ADD CONSTRAINT content_runners_backoff_check CHECK (retry_backoff_seconds BETWEEN 10 AND 86400),
    ADD CONSTRAINT content_runners_failure_threshold_check CHECK (failure_threshold BETWEEN 1 AND 100),
    ADD CONSTRAINT content_runners_consecutive_failures_check CHECK (consecutive_failures >= 0),
    ADD CONSTRAINT content_runners_current_attempt_check CHECK (current_attempt >= 0),
    ADD CONSTRAINT content_runners_retention_check CHECK (retention_days BETWEEN 1 AND 3650),
    ADD CONSTRAINT content_runners_config_version_check CHECK (config_version >= 1);

ALTER TABLE content_runner_runs
    DROP CONSTRAINT IF EXISTS content_runner_runs_status_check,
    ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN config_version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN exit_code INTEGER,
    ADD COLUMN duration_ms BIGINT,
    ADD COLUMN timed_out BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN stdout TEXT NOT NULL DEFAULT '',
    ADD COLUMN stderr TEXT NOT NULL DEFAULT '',
    ADD COLUMN retry_at TIMESTAMPTZ,
    ADD COLUMN requested_by BIGINT REFERENCES authors(id) ON DELETE SET NULL,
    ADD CONSTRAINT content_runner_runs_status_check CHECK (status IN ('running', 'success', 'failed', 'timeout', 'skipped', 'cancelled')),
    ADD CONSTRAINT content_runner_runs_attempt_check CHECK (attempt >= 1),
    ADD CONSTRAINT content_runner_runs_output_check CHECK (length(stdout) <= 20000 AND length(stderr) <= 20000);

CREATE INDEX content_runner_runs_recent_idx ON content_runner_runs(runner_id, started_at DESC);

-- Existing rows are still valid runners, but are now explicitly represented as
-- draft/paused rather than relying on a boolean with no reason attached.
UPDATE content_runners SET enabled = FALSE, state = 'draft' WHERE state = 'draft';
