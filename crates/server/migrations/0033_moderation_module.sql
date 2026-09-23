-- Moderation is an instance module. Keep it enabled by default for existing
-- deployments; operators can disable publication gating without deleting the
-- moderation tables or their audit history.
INSERT INTO instance_modules(module_key, enabled)
VALUES ('moderation', TRUE)
ON CONFLICT (module_key) DO NOTHING;
