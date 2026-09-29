ALTER TABLE bookmark_folders ADD COLUMN parent_id BIGINT;
ALTER TABLE bookmark_folders
    ADD CONSTRAINT bookmark_folder_parent_fk
    FOREIGN KEY (author_id, parent_id) REFERENCES bookmark_folders(author_id, id);

DROP INDEX bookmark_folder_names;
CREATE UNIQUE INDEX bookmark_folder_root_names
    ON bookmark_folders(author_id, lower(name))
    WHERE parent_id IS NULL;
CREATE UNIQUE INDEX bookmark_folder_child_names
    ON bookmark_folders(author_id, parent_id, lower(name))
    WHERE parent_id IS NOT NULL;
CREATE INDEX bookmark_folder_parent
    ON bookmark_folders(author_id, parent_id, lower(name));
