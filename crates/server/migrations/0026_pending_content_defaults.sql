-- Every future post/comment insertion starts hidden until the moderation queue
-- records a human decision. Existing rows keep their current status.
ALTER TABLE posts
  ALTER COLUMN moderation_status SET DEFAULT 'pending';

ALTER TABLE comments
  ALTER COLUMN moderation_status SET DEFAULT 'pending';
