-- Draw Things runners need a structured configuration instead of a shell
-- command, an explicit weekly schedule, and a dry-run queue. Generated media
-- is stored as a bounded asset so a local Draw Things process can publish an
-- image without exposing its filesystem to the browser.
ALTER TABLE content_runners
    DROP CONSTRAINT IF EXISTS content_runners_command_check,
    ADD COLUMN days_of_week JSONB NOT NULL DEFAULT '[1,2,3,4,5,6,7]'::jsonb,
    ADD COLUMN test_requested BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT content_runners_days_of_week_check CHECK (jsonb_typeof(days_of_week) = 'array'),
    ADD CONSTRAINT content_runners_command_check CHECK (
        (kind = 'draw_things' AND jsonb_typeof(command) = 'object')
        OR (kind IN ('command', 'cross_post') AND jsonb_typeof(command) = 'array')
    );

ALTER TABLE content_runners
    DROP CONSTRAINT IF EXISTS content_runners_kind_check,
    ADD CONSTRAINT content_runners_kind_check CHECK (kind IN ('command', 'cross_post', 'draw_things'));

ALTER TABLE content_runner_runs
    ADD COLUMN dry_run BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE external_posts
    ADD COLUMN generation_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT external_posts_generation_config_object_check
      CHECK (jsonb_typeof(generation_config) = 'object');

ALTER TABLE media_assets
    ADD COLUMN content_bytes BYTEA,
    ADD COLUMN content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    ADD CONSTRAINT media_assets_content_bytes_size_check
      CHECK (content_bytes IS NULL OR octet_length(content_bytes) <= 5242880);

CREATE INDEX content_runners_test_idx ON content_runners(test_requested, priority, id)
    WHERE test_requested;
