CREATE TABLE rating_reviews (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
 content_hash TEXT NOT NULL,
 model TEXT NOT NULL,
 model_digest TEXT NOT NULL,
 policy_version TEXT NOT NULL,
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
 proposed_rating TEXT CHECK(proposed_rating IN ('general','r','x')),
 details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details)),
 artifacts TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(artifacts)),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed','dismissed')),
 final_rating TEXT CHECK(final_rating IN ('general','r','x')),
 reviewer_id INTEGER REFERENCES authors(id),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 reviewed_at TEXT,
 UNIQUE(post_id,content_hash,model_digest,policy_version)
);
CREATE INDEX rating_review_queue ON rating_reviews(status,id);
CREATE TABLE rating_training_labels (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 review_id INTEGER NOT NULL REFERENCES rating_reviews(id) ON DELETE CASCADE,
 post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
 content_hash TEXT NOT NULL,
 label TEXT NOT NULL CHECK(label IN ('general','r','x')),
 reviewer_id INTEGER NOT NULL REFERENCES authors(id),
 notes TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX rating_training_latest ON rating_training_labels(post_id,content_hash,id);
