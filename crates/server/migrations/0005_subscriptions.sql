CREATE TABLE community_subscriptions (
    community_id BIGINT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    author_id BIGINT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, author_id)
);
