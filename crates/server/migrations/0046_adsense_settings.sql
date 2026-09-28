CREATE TABLE adsense_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    publisher_id TEXT,
    updated_by BIGINT REFERENCES authors(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO adsense_settings(singleton) VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;

INSERT INTO instance_modules(module_key, enabled)
VALUES ('adsense', FALSE)
ON CONFLICT (module_key) DO NOTHING;
