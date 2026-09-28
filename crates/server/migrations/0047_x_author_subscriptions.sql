CREATE TABLE x_author_subscriptions (
    author_id BIGINT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    handle TEXT NOT NULL CHECK (handle ~ '^[a-z0-9_]{1,15}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (author_id, handle)
);

CREATE INDEX x_author_subscriptions_handle_author_idx
    ON x_author_subscriptions (handle, author_id);
