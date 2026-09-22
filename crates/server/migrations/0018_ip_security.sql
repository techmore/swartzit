CREATE TABLE ip_blocks (
  id BIGSERIAL PRIMARY KEY,
  ip_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES authors(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ip_activity (
  id BIGSERIAL PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  route TEXT NOT NULL,
  method TEXT NOT NULL,
  status INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ip_activity_recent_idx ON ip_activity(created_at DESC);
