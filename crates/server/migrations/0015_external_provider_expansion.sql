ALTER TABLE external_posts DROP CONSTRAINT IF EXISTS external_posts_provider_check;
ALTER TABLE external_posts ADD CONSTRAINT external_posts_provider_check CHECK (provider IN ('x', 'reddit', 'rss', 'commons'));
