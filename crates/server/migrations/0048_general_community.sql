INSERT INTO communities (slug, name, description)
VALUES ('general', 'General', 'A place for links and discussions that do not fit another community.')
ON CONFLICT (slug) DO NOTHING;
