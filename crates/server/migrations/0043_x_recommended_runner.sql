-- The worker timer already wakes once per minute. Allow content runners to use
-- that cadence for small, bounded collectors such as the X Recommended recipe.
ALTER TABLE content_runners
    DROP CONSTRAINT IF EXISTS content_runners_interval_seconds_check,
    ADD CONSTRAINT content_runners_interval_seconds_check CHECK (interval_seconds BETWEEN 60 AND 604800);

-- Seed a disabled draft when the standard scheduler identity and X destination
-- exist. It is intentionally not enabled: the worker needs a dedicated signed-in
-- Ego Lite task space before this browser-backed collector can be used.
INSERT INTO content_runners(
    name, kind, command, prompt, author_id, community_id, interval_seconds,
    days_of_week, priority, enabled, next_run_at, state, environment_keys,
    capture_output, max_log_bytes
)
SELECT
    'X Recommended · one unique link',
    'cross_post',
    '["node", "scripts/x-recommended-session-runner.mjs"]'::jsonb,
    'Collect one unseen public post from the X Recommended timeline.',
    a.id,
    c.id,
    60,
    '[1, 2, 3, 4, 5, 6, 7]'::jsonb,
    100,
    FALSE,
    now(),
    'draft',
    '["EGO_BROWSER_SPACE_ID", "EGO_BROWSER_CLI"]'::jsonb,
    TRUE,
    20000
FROM authors a
CROSS JOIN communities c
WHERE a.handle = 'import_scheduler'
  AND c.slug = 'x_imports'
ON CONFLICT (name) DO NOTHING;
