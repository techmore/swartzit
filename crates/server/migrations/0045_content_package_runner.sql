-- Optional long-form/content-package runners. The executable remains an
-- administrator-configured host-side adapter; the core server only stores
-- lifecycle state, progress, and the final package receipt.
ALTER TABLE content_runners
    DROP CONSTRAINT IF EXISTS content_runners_kind_check,
    DROP CONSTRAINT IF EXISTS content_runners_command_check,
    ADD CONSTRAINT content_runners_kind_check CHECK (
        kind IN ('command', 'cross_post', 'draw_things', 'content_package')
    ),
    ADD CONSTRAINT content_runners_command_check CHECK (
        (kind = 'draw_things' AND jsonb_typeof(command) = 'object')
        OR (kind = 'content_package' AND jsonb_typeof(command) = 'object')
        OR (kind IN ('command', 'cross_post') AND jsonb_typeof(command) = 'array')
    );

ALTER TABLE content_runner_runs
    DROP CONSTRAINT IF EXISTS content_runner_runs_status_check,
    ADD COLUMN control_request TEXT,
    ADD CONSTRAINT content_runner_runs_status_check CHECK (
        status IN ('running', 'success', 'failed', 'timeout', 'skipped', 'cancelled', 'paused')
    ),
    ADD CONSTRAINT content_runner_runs_control_request_check CHECK (
        control_request IS NULL OR control_request IN ('pause', 'cancel')
    );

CREATE INDEX content_runner_runs_control_idx
    ON content_runner_runs(status, control_request)
    WHERE status = 'running' AND control_request IS NOT NULL;
