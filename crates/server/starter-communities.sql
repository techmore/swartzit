-- Familiar topics with original descriptions; no imported posts or affiliation.
INSERT INTO communities (slug,name,description) VALUES
('ask','Ask the Community','Good questions, thoughtful answers, and perspectives beyond your own.'),
('technology','Technology','Discuss the tools and systems changing how we live and work.'),
('science','Science','Discover research, ask questions, and examine the evidence.'),
('programming','Programming','Share projects, work through problems, and learn to build software.'),
('linux','Linux','Explore distributions, troubleshoot systems, and share what works.'),
('selfhosted','Self-hosted','Run your own services and share the lessons learned.'),
('opensource','Open Source','Collaborate on software and knowledge that everyone can use.'),
('privacy','Privacy','Practical ways to protect personal information and communicate privately.'),
('worldnews','World News','Discuss events around the world with sources and context.'),
('books','Books','Reading recommendations, book discussions, and discoveries from your shelves.'),
('movies','Movies','Talk about films, filmmaking, and what to watch next.'),
('music','Music','Discover artists, share listening notes, and discuss making music.'),
('gaming','Gaming','Games, shared adventures, independent projects, and player communities.'),
('photography','Photography','Explore composition, techniques, and the stories behind photographs.'),
('cooking','Cooking','Recipes, kitchen experiments, and everyday cooking questions.'),
('gardening','Gardening','Grow plants, share seasonal advice, and learn from each other.'),
('diy','Do It Yourself','Make, repair, and improve things with practical community advice.'),
('fitness','Fitness','Discuss movement, training habits, and personal progress.'),
('space','Space','Explore astronomy, spaceflight, and discoveries beyond Earth.'),
('todayilearned','Today I Learned','Share something interesting you learned, with a source to explore.')
ON CONFLICT (slug) DO NOTHING;
