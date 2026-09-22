ALTER TABLE external_posts
  ADD COLUMN profile_url TEXT,
  ADD COLUMN profile_display_name TEXT,
  ADD COLUMN profile_bio TEXT,
  ADD COLUMN profile_followers BIGINT,
  ADD COLUMN profile_following BIGINT,
  ADD COLUMN profile_verified BOOLEAN;
