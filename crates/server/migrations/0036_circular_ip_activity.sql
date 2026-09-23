-- Keep detailed request activity bounded while preserving the newest access
-- events for the administrator's security view.
ALTER TABLE ip_activity
    ADD COLUMN slot BIGINT GENERATED ALWAYS AS (id % 5000) STORED;

CREATE UNIQUE INDEX ip_activity_slot_unique ON ip_activity(slot);
