CREATE TABLE communities (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9_]{1,40}$'),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);
-- Public author identities only. Authentication will be added separately.
CREATE TABLE authors (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    handle TEXT NOT NULL UNIQUE
);
CREATE TABLE posts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    community_id BIGINT NOT NULL REFERENCES communities(id),
    author_id BIGINT NOT NULL REFERENCES authors(id),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
    body TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    search_document TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('english', title), 'A') ||
        setweight(to_tsvector('english', body), 'B')
    ) STORED
);
CREATE INDEX posts_search_idx ON posts USING GIN(search_document);
CREATE INDEX posts_new_idx ON posts(created_at DESC, id DESC);
CREATE INDEX posts_community_idx ON posts(community_id, created_at DESC, id DESC);
CREATE TABLE comments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id),
    author_id BIGINT NOT NULL REFERENCES authors(id),
    parent_id BIGINT,
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (post_id, id),
    FOREIGN KEY (post_id, parent_id) REFERENCES comments(post_id, id),
    CHECK (parent_id IS NULL OR parent_id < id)
);
CREATE INDEX comments_post_idx ON comments(post_id, created_at, id);
