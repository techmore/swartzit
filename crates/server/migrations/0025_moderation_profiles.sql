ALTER TABLE authors
  ADD COLUMN display_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN bio TEXT NOT NULL DEFAULT '',
  ADD COLUMN avatar_url TEXT,
  ADD COLUMN profile_updated_at TIMESTAMPTZ,
  ADD COLUMN suspended_until TIMESTAMPTZ,
  ADD COLUMN suspension_reason TEXT NOT NULL DEFAULT '';

CREATE TABLE moderation_items (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('post', 'comment', 'profile')),
    target_id BIGINT NOT NULL,
    author_id BIGINT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'dismissed', 'escalated')),
    severity TEXT NOT NULL DEFAULT 'none' CHECK (severity IN ('none', 'low', 'medium', 'high')),
    flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    rule_version TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    urgent BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by BIGINT REFERENCES authors(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX moderation_queue_idx ON moderation_items(status, urgent DESC, created_at ASC);
CREATE INDEX moderation_author_idx ON moderation_items(author_id, created_at DESC);
CREATE UNIQUE INDEX moderation_profile_pending_idx
  ON moderation_items(kind, target_id)
  WHERE kind = 'profile' AND status IN ('pending', 'escalated');

CREATE TABLE moderation_actions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    moderation_item_id BIGINT NOT NULL REFERENCES moderation_items(id) ON DELETE CASCADE,
    actor_id BIGINT NOT NULL REFERENCES authors(id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'dismiss', 'suspend', 'escalate')),
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX moderation_actions_item_idx ON moderation_actions(moderation_item_id, created_at DESC);

ALTER TABLE posts
  ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'escalated')),
  ADD COLUMN moderation_item_id BIGINT REFERENCES moderation_items(id) ON DELETE SET NULL,
  ADD COLUMN moderation_reviewed_by BIGINT REFERENCES authors(id) ON DELETE SET NULL,
  ADD COLUMN moderation_reviewed_at TIMESTAMPTZ;

ALTER TABLE comments
  ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'escalated')),
  ADD COLUMN moderation_item_id BIGINT REFERENCES moderation_items(id) ON DELETE SET NULL,
  ADD COLUMN moderation_reviewed_by BIGINT REFERENCES authors(id) ON DELETE SET NULL,
  ADD COLUMN moderation_reviewed_at TIMESTAMPTZ;

CREATE INDEX posts_moderation_idx ON posts(moderation_status, created_at DESC, id DESC);
CREATE INDEX comments_moderation_idx ON comments(moderation_status, created_at DESC, id DESC);
