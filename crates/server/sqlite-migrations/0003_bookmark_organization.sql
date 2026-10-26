ALTER TABLE bookmarks ADD COLUMN sort_at TEXT;
CREATE TABLE bookmark_tags (
 author_id INTEGER NOT NULL,
 post_id INTEGER NOT NULL,
 tag TEXT NOT NULL COLLATE NOCASE CHECK(length(tag) BETWEEN 1 AND 40),
 PRIMARY KEY(author_id,post_id,tag),
 FOREIGN KEY(author_id,post_id) REFERENCES bookmarks(author_id,post_id) ON DELETE CASCADE
);
CREATE INDEX bookmark_tag_filter ON bookmark_tags(author_id,tag,post_id);
