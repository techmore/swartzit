-- Bible mode shows the communities an administrator ticks for it. The four
-- Bible communities start ticked; others (a sermon series, a teacher's
-- archive) can be added without a code change.
ALTER TABLE communities ADD COLUMN bible_visible INTEGER NOT NULL DEFAULT 0 CHECK (bible_visible IN (0, 1));
UPDATE communities SET bible_visible = 1 WHERE slug IN ('scripture', 'daily_reading', 'sermons', 'deeper_dives');
