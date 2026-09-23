ALTER TABLE posts
  ADD COLUMN content_rating TEXT NOT NULL DEFAULT 'general'
    CHECK (content_rating IN ('general', 'r', 'x')),
  ADD COLUMN content_rating_source TEXT NOT NULL DEFAULT 'legacy'
    CHECK (content_rating_source IN ('legacy', 'uploader', 'automatic', 'moderator')),
  ADD COLUMN content_rating_confidence NUMERIC(4,3)
    CHECK (content_rating_confidence IS NULL OR content_rating_confidence BETWEEN 0 AND 1),
  ADD COLUMN content_rating_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX posts_content_rating_idx
  ON posts(content_rating, moderation_status, created_at DESC, id DESC);
