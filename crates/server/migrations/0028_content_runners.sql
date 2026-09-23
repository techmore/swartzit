-- Administrator-controlled, host-side publishing runners.  The command is
-- stored as an argv array (never a shell string) so the worker does not need
-- to invoke a shell or interpolate untrusted content.
CREATE TABLE content_runners (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 80),
    kind TEXT NOT NULL CHECK (kind IN ('command', 'cross_post')),
    command JSONB NOT NULL DEFAULT '[]'::jsonb,
    prompt TEXT NOT NULL DEFAULT '' CHECK (length(prompt) <= 20000),
    author_id BIGINT NOT NULL REFERENCES authors(id),
    community_id BIGINT NOT NULL REFERENCES communities(id),
    interval_seconds INTEGER NOT NULL CHECK (interval_seconds BETWEEN 300 AND 604800),
    priority INTEGER NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 10000),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_run_at TIMESTAMPTZ,
    last_status TEXT,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (jsonb_typeof(command) = 'array')
);
CREATE INDEX content_runners_due_idx ON content_runners(enabled, next_run_at, priority, id);

CREATE TABLE content_runner_runs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    runner_id BIGINT NOT NULL REFERENCES content_runners(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'skipped')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    post_id BIGINT REFERENCES posts(id) ON DELETE SET NULL,
    error TEXT,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX content_runner_runs_runner_idx ON content_runner_runs(runner_id, id DESC);

INSERT INTO instance_modules(module_key, enabled)
VALUES ('content_runners', FALSE)
ON CONFLICT (module_key) DO NOTHING;

-- Runner-produced posts use the same attribution-shaped media payload as
-- imported posts, while remaining distinguishable in the source metadata.
ALTER TABLE external_posts DROP CONSTRAINT IF EXISTS external_posts_provider_check;
ALTER TABLE external_posts ADD CONSTRAINT external_posts_provider_check CHECK(provider IN ('x','reddit','rss','commons','runner'));
