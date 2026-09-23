CREATE TABLE instance_modules (
    module_key TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by BIGINT REFERENCES authors(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO instance_modules(module_key, enabled)
VALUES ('orchard', TRUE)
ON CONFLICT (module_key) DO NOTHING;
