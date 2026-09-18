CREATE TABLE external_posts (
  post_id BIGINT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('x','commons')),
  source_url TEXT NOT NULL UNIQUE,
  source_author TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL,
  source_views BIGINT CHECK(source_views >= 0),
  source_likes BIGINT CHECK(source_likes >= 0),
  source_reposts BIGINT CHECK(source_reposts >= 0),
  source_replies BIGINT CHECK(source_replies >= 0),
  media JSONB NOT NULL DEFAULT '[]',
  attribution TEXT NOT NULL DEFAULT ''
);
INSERT INTO communities(slug,name,description) VALUES
('x_imports','From X','Public posts shared from X, with source attribution and separate local discussions.'),
('alexandra_daddario','Alexandra Daddario','An independent fan community for publicly sourced photos and discussion. Not affiliated with Alexandra Daddario.')
ON CONFLICT(slug) DO NOTHING;
