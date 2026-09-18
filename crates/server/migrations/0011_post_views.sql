ALTER TABLE posts ADD COLUMN view_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN engaged_view_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN deep_view_count BIGINT NOT NULL DEFAULT 0;
CREATE TABLE post_view_visits (
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    visit_hash BYTEA NOT NULL,
    seconds SMALLINT NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(post_id, visit_hash)
);
CREATE INDEX post_view_visits_expiry ON post_view_visits(started_at);
