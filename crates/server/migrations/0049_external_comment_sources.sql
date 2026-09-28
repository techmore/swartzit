ALTER TABLE comments
  ADD COLUMN source JSONB;

ALTER TABLE comments
  DROP CONSTRAINT comments_body_check,
  ADD CONSTRAINT comments_body_check
    CHECK ((source IS NOT NULL AND length(body) BETWEEN 0 AND 10000)
        OR (source IS NULL AND length(body) BETWEEN 1 AND 10000)),
  ADD CONSTRAINT comments_source_object_check
    CHECK (source IS NULL OR jsonb_typeof(source) = 'object');
