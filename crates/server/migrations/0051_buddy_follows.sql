CREATE TABLE buddy_follows (
    follower_id BIGINT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    followed_id BIGINT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followed_id),
    CONSTRAINT buddy_follows_not_self CHECK (follower_id <> followed_id)
);

CREATE INDEX buddy_follows_pinned_idx
    ON buddy_follows (follower_id, followed_id)
    WHERE pinned;

CREATE INDEX post_votes_buddy_feed_idx
    ON post_votes (author_id, created_at DESC, post_id)
    WHERE value = 1;
