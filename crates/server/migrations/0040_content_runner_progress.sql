-- Live execution telemetry for long-running local generators such as Draw Things.
-- These fields are intentionally nullable: generic runners may only expose
-- elapsed time, while a Draw Things runner can report phase and percentage.
ALTER TABLE content_runner_runs
    ADD COLUMN progress_percent SMALLINT,
    ADD COLUMN progress_phase TEXT,
    ADD COLUMN progress_message TEXT,
    ADD COLUMN current_step INTEGER,
    ADD COLUMN total_steps INTEGER,
    ADD COLUMN eta_seconds INTEGER,
    ADD COLUMN progress_updated_at TIMESTAMPTZ;

ALTER TABLE content_runner_runs
    ADD CONSTRAINT content_runner_runs_progress_percent_check
        CHECK (progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100),
    ADD CONSTRAINT content_runner_runs_progress_step_check
        CHECK (current_step IS NULL OR current_step >= 0),
    ADD CONSTRAINT content_runner_runs_progress_total_step_check
        CHECK (total_steps IS NULL OR total_steps >= 0),
    ADD CONSTRAINT content_runner_runs_progress_eta_check
        CHECK (eta_seconds IS NULL OR eta_seconds >= 0);
