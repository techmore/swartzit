-- Native app clients (the Swartzit iPhone app) receive only communities an
-- administrator has marked for apps, and never R- or X-rated posts.
ALTER TABLE communities ADD COLUMN app_visible INTEGER NOT NULL DEFAULT 0 CHECK (app_visible IN (0, 1));
UPDATE communities SET app_visible = 1 WHERE slug IN ('scripture', 'daily_reading', 'sermons', 'deeper_dives');

-- Accounts deleted by their owner keep their row (so posts, comments and
-- moderation history stay consistent) but lose every personal detail.
ALTER TABLE authors ADD COLUMN deleted_at TEXT;
