CREATE TABLE author_post_preferences (
    author_id BIGINT PRIMARY KEY REFERENCES authors(id) ON DELETE CASCADE,
    copy_link_after_post BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
