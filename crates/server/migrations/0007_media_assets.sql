CREATE TABLE media_assets (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE,
    media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'audio', 'file')),
    byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
    magnet_uri TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE post_media (
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    media_id BIGINT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
    position SMALLINT NOT NULL DEFAULT 0 CHECK (position >= 0),
    PRIMARY KEY (post_id, media_id)
);
