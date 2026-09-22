CREATE TABLE crawler_jobs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL CHECK (provider IN ('x', 'reddit', 'rss', 'commons')),
    source TEXT NOT NULL,
    community_id BIGINT REFERENCES communities(id) ON DELETE SET NULL,
    interval_seconds INTEGER NOT NULL CHECK (interval_seconds BETWEEN 300 AND 604800),
    max_items INTEGER NOT NULL CHECK (max_items BETWEEN 1 AND 100),
    mode TEXT NOT NULL DEFAULT 'review' CHECK (mode IN ('review', 'automatic')),
    filters JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_run_at TIMESTAMPTZ,
    last_status TEXT NOT NULL DEFAULT 'never_run',
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX crawler_jobs_due_idx ON crawler_jobs(enabled, next_run_at);

CREATE TABLE crawler_runs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES crawler_jobs(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed', 'skipped')),
    imported_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX crawler_runs_job_idx ON crawler_runs(job_id, started_at DESC);
