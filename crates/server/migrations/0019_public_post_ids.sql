ALTER TABLE posts
  ADD COLUMN public_id TEXT;

UPDATE posts
SET public_id = md5(random()::text || clock_timestamp()::text || id::text)
WHERE public_id IS NULL;

ALTER TABLE posts
  ALTER COLUMN public_id SET DEFAULT md5(random()::text || clock_timestamp()::text),
  ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX posts_public_id_idx ON posts(public_id);
