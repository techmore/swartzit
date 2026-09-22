CREATE TABLE bookmark_folders (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    author_id BIGINT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    UNIQUE(author_id, id)
);
CREATE UNIQUE INDEX bookmark_folder_names ON bookmark_folders(author_id, lower(name));
CREATE TABLE bookmarks (
    author_id BIGINT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    folder_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(author_id, post_id),
    FOREIGN KEY(author_id, folder_id) REFERENCES bookmark_folders(author_id, id)
);
CREATE INDEX bookmarks_saved ON bookmarks(author_id, created_at DESC, post_id DESC);
