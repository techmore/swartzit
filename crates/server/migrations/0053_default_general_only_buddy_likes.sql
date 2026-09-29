ALTER TABLE author_like_privacy
    ALTER COLUMN non_rated_only SET DEFAULT TRUE;

ALTER TABLE author_like_privacy
    ADD COLUMN non_rated_only_configured BOOLEAN NOT NULL DEFAULT FALSE;
