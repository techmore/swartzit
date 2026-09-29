CREATE TABLE author_like_privacy (
    author_id BIGINT PRIMARY KEY REFERENCES authors(id) ON DELETE CASCADE,
    visibility TEXT NOT NULL DEFAULT 'followers'
        CHECK (visibility IN ('followers', 'selected', 'hidden')),
    non_rated_only BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE author_like_share_recipients (
    author_id BIGINT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    recipient_id BIGINT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (author_id, recipient_id),
    CONSTRAINT author_like_share_recipients_not_self CHECK (author_id <> recipient_id)
);

CREATE INDEX buddy_follows_followed_idx
    ON buddy_follows (followed_id, follower_id);
