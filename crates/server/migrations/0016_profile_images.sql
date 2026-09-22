ALTER TABLE external_posts
  ADD COLUMN profile_image_url TEXT,
  ADD COLUMN profile_image_cached_at TIMESTAMPTZ;

CREATE INDEX external_posts_profile_image_idx
  ON external_posts (profile_image_cached_at)
  WHERE profile_image_url IS NOT NULL;
