-- Seed a review-only X source for the Protestant-first content stream.
-- The standalone x-faith-runner.mjs can be used when multi-query ranking is
-- desired; this job remains compatible with the regular worker scheduler.
INSERT INTO crawler_jobs(
    name, provider, source, community_id, interval_seconds, max_items, mode, filters
)
SELECT
    'Protestant and Biblical · X',
    'x',
    'search:(Presbyterian OR Presbyterianism OR Reformed OR Calvinist OR "Westminster Confession" OR "sola scriptura" OR "sola fide" OR biblical OR expository) -is:retweet -is:reply lang:en',
    c.id,
    21600,
    10,
    'review',
    '{"focus":"protestant","priority_terms":["presbyterian","reformed","calvinist","westminster confession","sola scriptura","sola fide","biblical","expository"]}'::jsonb
FROM communities c
WHERE c.slug = 'x_imports'
ON CONFLICT(name) DO NOTHING;

INSERT INTO crawler_jobs(
    name, provider, source, community_id, interval_seconds, max_items, mode, filters
)
SELECT
    'Protestant and Biblical · Reddit',
    'reddit',
    'search:(Presbyterian OR Reformed OR Calvinist OR "Westminster Confession" OR "sola scriptura" OR "sola fide" OR biblical OR expository)',
    c.id,
    21600,
    10,
    'review',
    '{"focus":"protestant","priority_terms":["presbyterian","reformed","calvinist","westminster confession","sola scriptura","sola fide","biblical","expository"]}'::jsonb
FROM communities c
WHERE c.slug = 'x_imports'
ON CONFLICT(name) DO NOTHING;
