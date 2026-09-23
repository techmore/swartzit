CREATE TABLE draw_things_feedback (
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id BIGINT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    overall SMALLINT NOT NULL CHECK (overall BETWEEN 1 AND 5),
    prompt_match SMALLINT CHECK (prompt_match IS NULL OR prompt_match BETWEEN 1 AND 5),
    natural_color SMALLINT CHECK (natural_color IS NULL OR natural_color BETWEEN 1 AND 5),
    realism SMALLINT CHECK (realism IS NULL OR realism BETWEEN 1 AND 5),
    likeness SMALLINT CHECK (likeness IS NULL OR likeness BETWEEN 1 AND 5),
    composition SMALLINT CHECK (composition IS NULL OR composition BETWEEN 1 AND 5),
    detail SMALLINT CHECK (detail IS NULL OR detail BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, author_id)
);

CREATE INDEX draw_things_feedback_post_idx
    ON draw_things_feedback(post_id, updated_at DESC);
