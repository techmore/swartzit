-- Seed the Sydney Sweeney content runner. The worker uses the existing public
-- X and Reddit adapters; imports remain in review mode until approved.
INSERT INTO communities(slug,name,description)
VALUES (
    'sydney_sweeney',
    'Sydney Sweeney',
    'An independent fan community for publicly sourced Sydney Sweeney content and discussion. Not affiliated with Sydney Sweeney.'
)
ON CONFLICT(slug) DO NOTHING;

INSERT INTO crawler_jobs(
    name, provider, source, community_id, interval_seconds, max_items, mode, filters
)
SELECT
    'Sydney Sweeney · X',
    'x',
    'search:("Sydney Sweeney" OR "SydneySweeney") has:media -is:retweet -is:reply',
    c.id,
    86400,
    10,
    'review',
    '{}'::jsonb
FROM communities c
WHERE c.slug = 'sydney_sweeney'
ON CONFLICT(name) DO NOTHING;

INSERT INTO crawler_jobs(
    name, provider, source, community_id, interval_seconds, max_items, mode, filters
)
SELECT
    'Sydney Sweeney · Reddit',
    'reddit',
    'r/SydneySweeney',
    c.id,
    86400,
    10,
    'review',
    '{}'::jsonb
FROM communities c
WHERE c.slug = 'sydney_sweeney'
ON CONFLICT(name) DO NOTHING;
