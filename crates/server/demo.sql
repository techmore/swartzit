INSERT INTO authors (handle) VALUES ('river'), ('moss'), ('ada')
ON CONFLICT (handle) DO NOTHING;
INSERT INTO communities (slug, name, description) VALUES
('commons', 'The Commons', 'A place to think out loud about an internet that belongs to its communities.'),
('selfhosted', 'Self-hosted', 'Small servers, independent communities, and the things we learn by running them.'),
('opensource', 'Open Source', 'Tools, ideas, and knowledge we can build on together.')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO posts (community_id, author_id, title, body, created_at) VALUES
((SELECT id FROM communities WHERE slug='commons'), (SELECT id FROM authors WHERE handle='river'), 'What would an internet built for its communities look like?', 'Read freely. Participate under a pseudonym. Take your community with you.\n\nThose are the principles behind Swartzit. This is a sample discussion in the first working prototype. What would make a community feel like a place you actually have a stake in?', now() - interval '1 hour'),
((SELECT id FROM communities WHERE slug='selfhosted'), (SELECT id FROM authors WHERE handle='moss'), 'A community should be able to start on a spare computer', 'You should not need a cloud subscription or a purchased domain to give a community a home.\n\nWe are exploring Linux hosting with Incus and optional onion services. Reliable backups and a clear upgrade path matter just as much as the first install.', now() - interval '2 hours'),
((SELECT id FROM communities WHERE slug='opensource'), (SELECT id FROM authors WHERE handle='ada'), 'Public knowledge deserves a front door that stays open', 'Open a link. Read the discussion. Follow an idea.\n\nNo login wall should stand between a reader and a public conversation. This sample post is stored in PostgreSQL and rendered on the server.', now() - interval '3 hours'),
((SELECT id FROM communities WHERE slug='commons'), (SELECT id FROM authors WHERE handle='moss'), 'What should “take your community with you” include?', 'An export is only the beginning. Discussions, community rules, and the ability for people to find each other again all matter.\n\nMigration is a design goal, not a feature this prototype already delivers.', now() - interval '4 hours');
INSERT INTO comments (post_id, author_id, body)
SELECT p.id, a.id, 'Being able to read the whole conversation without making an account is a good place to start.' FROM posts p, authors a WHERE p.title='What would an internet built for its communities look like?' AND a.handle='ada';
INSERT INTO comments (post_id, author_id, parent_id, body)
SELECT cm.post_id, a.id, cm.id, 'And making sure that still works on a slow connection. Text should arrive before anything else.' FROM comments cm, authors a WHERE a.handle='moss';
