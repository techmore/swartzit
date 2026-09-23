-- Read-path indexes. The moderation predicate is present on every public feed
-- query, so partial indexes keep pending/rejected rows out of the hot path.
CREATE INDEX posts_approved_feed_idx
  ON posts (created_at DESC, id DESC)
  WHERE moderation_status = 'approved';

CREATE INDEX posts_approved_community_feed_idx
  ON posts (community_id, created_at DESC, id DESC)
  WHERE moderation_status = 'approved';

CREATE INDEX comments_approved_author_feed_idx
  ON comments (author_id, created_at DESC, id DESC)
  WHERE moderation_status = 'approved';

-- The existing primary key is community-first. Following feeds filter by the
-- signed-in author first, so they need the inverse access path as well.
CREATE INDEX community_subscriptions_author_idx
  ON community_subscriptions (author_id, community_id);

-- A compact read projection for per-post aggregates. The source columns on
-- posts remain canonical for compatibility and backup/export; this table keeps
-- public feed/profile reads from repeatedly counting comments and votes.
CREATE TABLE post_stats (
    post_id BIGINT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
    comment_count BIGINT NOT NULL DEFAULT 0,
    score BIGINT NOT NULL DEFAULT 0,
    view_count BIGINT NOT NULL DEFAULT 0,
    engaged_view_count BIGINT NOT NULL DEFAULT 0,
    deep_view_count BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO post_stats(
    post_id, comment_count, score, view_count, engaged_view_count,
    deep_view_count
)
SELECT
    p.id,
    (SELECT count(*) FROM comments cm
     WHERE cm.post_id = p.id AND cm.moderation_status = 'approved'),
    (SELECT COALESCE(sum(value), 0)::bigint FROM post_votes v
     WHERE v.post_id = p.id),
    p.view_count,
    p.engaged_view_count,
    p.deep_view_count
FROM posts p
ON CONFLICT (post_id) DO UPDATE SET
    comment_count = EXCLUDED.comment_count,
    score = EXCLUDED.score,
    view_count = EXCLUDED.view_count,
    engaged_view_count = EXCLUDED.engaged_view_count,
    deep_view_count = EXCLUDED.deep_view_count,
    updated_at = now();

CREATE OR REPLACE FUNCTION swartzit_refresh_post_stats()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    target_post_id BIGINT;
BEGIN
    IF TG_TABLE_NAME = 'posts' THEN
        target_post_id := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN
        target_post_id := OLD.post_id;
    ELSE
        target_post_id := NEW.post_id;
    END IF;

    INSERT INTO post_stats(
        post_id, comment_count, score, view_count, engaged_view_count,
        deep_view_count
    )
    SELECT
        p.id,
        (SELECT count(*) FROM comments cm
         WHERE cm.post_id = p.id AND cm.moderation_status = 'approved'),
        (SELECT COALESCE(sum(value), 0)::bigint FROM post_votes v
         WHERE v.post_id = p.id),
        p.view_count,
        p.engaged_view_count,
        p.deep_view_count
    FROM posts p
    WHERE p.id = target_post_id
    ON CONFLICT (post_id) DO UPDATE SET
        comment_count = EXCLUDED.comment_count,
        score = EXCLUDED.score,
        view_count = EXCLUDED.view_count,
        engaged_view_count = EXCLUDED.engaged_view_count,
        deep_view_count = EXCLUDED.deep_view_count,
        updated_at = now();

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER posts_stats_insert
AFTER INSERT ON posts
FOR EACH ROW EXECUTE FUNCTION swartzit_refresh_post_stats();

CREATE TRIGGER comments_stats_refresh
AFTER INSERT OR UPDATE OF moderation_status OR DELETE ON comments
FOR EACH ROW EXECUTE FUNCTION swartzit_refresh_post_stats();

CREATE TRIGGER votes_stats_refresh
AFTER INSERT OR UPDATE OR DELETE ON post_votes
FOR EACH ROW EXECUTE FUNCTION swartzit_refresh_post_stats();
