-- Content runners can preserve provider-neutral generated posts as well as
-- imported X metadata. The runner API still validates external X media and
-- canonicalizes X source URLs before writing them.
ALTER TABLE external_posts DROP CONSTRAINT IF EXISTS external_posts_provider_check;
ALTER TABLE external_posts ADD CONSTRAINT external_posts_provider_check
  CHECK (provider IN ('x', 'reddit', 'rss', 'commons', 'runner'));
