ALTER TABLE external_posts
  ADD COLUMN source_comments JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE external_posts
  ADD CONSTRAINT external_posts_source_comments_array_check
  CHECK (jsonb_typeof(source_comments) = 'array');
