ALTER TABLE reports ADD COLUMN resolved_at TIMESTAMPTZ;
ALTER TABLE reports ADD COLUMN resolved_by BIGINT REFERENCES authors(id);
