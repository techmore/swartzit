-- Seed broad, adult-oriented discovery runners. These are public X searches and
-- remain in review mode so moderators can reject age-ambiguous or unsuitable
-- posts before they reach a community.
DO $$
DECLARE
    runner RECORD;
    community_id BIGINT;
BEGIN
    FOR runner IN
        SELECT * FROM (VALUES
            (
                'baddies_athletic',
                'Baddies · Athletic',
                'Publicly sourced athletic, fitness, and sportswear content for adult audiences. Not affiliated with the people shown.',
                'search:("women''s fitness" OR "female athlete" OR sportswear OR "athletic woman") has:media -is:retweet -is:reply'
            ),
            (
                'baddies_fashion',
                'Baddies · Fashion',
                'Publicly sourced fashion, street-style, and editorial content for adult audiences. Not affiliated with the people shown.',
                'search:("women''s fashion" OR streetstyle OR "fashion editorial" OR model) has:media -is:retweet -is:reply'
            ),
            (
                'baddies_glamour',
                'Baddies · Glamour',
                'Publicly sourced glamour and beauty-editorial content for adult audiences. Not affiliated with the people shown.',
                'search:(glamour OR "beauty editorial" OR "glamour photography") has:media -is:retweet -is:reply'
            ),
            (
                'baddies_red_carpet',
                'Baddies · Red Carpet',
                'Publicly sourced premiere, awards, and red-carpet content for adult audiences. Not affiliated with the people shown.',
                'search:("red carpet" OR premiere OR awards) has:media -is:retweet -is:reply'
            )
        ) AS entries(slug, name, description, source)
    LOOP
        INSERT INTO communities(slug, name, description)
        VALUES (runner.slug, runner.name, runner.description)
        ON CONFLICT(slug) DO UPDATE
        SET name = EXCLUDED.name, description = EXCLUDED.description
        RETURNING id INTO community_id;

        IF community_id IS NULL THEN
            SELECT id INTO community_id FROM communities WHERE slug = runner.slug;
        END IF;

        INSERT INTO crawler_jobs(
            name, provider, source, community_id, interval_seconds, max_items, mode, filters
        )
        VALUES (
            runner.name || ' · X', 'x', runner.source, community_id,
            86400, 20, 'review', '{}'::jsonb
        )
        ON CONFLICT(name) DO NOTHING;
    END LOOP;
END $$;
