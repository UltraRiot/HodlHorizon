-- Wires the Economic Calendar to a real feed (services/calendar/
-- syncForexFactory.js), covering US/CA/EU/UK/Asia/Oceania rather than
-- manual-only rows.
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS region TEXT;
  -- 'US','CA','EU','UK','Asia','Oceania','Other' - computed by the sync
  -- job from the feed's country code, never set by the admin UI today
  -- (manual rows keep region = NULL).

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
  -- 'manual' (admin/calendar.js) or 'forexfactory' (the sync job) - the
  -- sync only ever inserts/updates source='forexfactory' rows, so a
  -- hand-entered row is never touched or deleted by it.

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS forecast TEXT;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS previous TEXT;

-- Lets re-syncing the same week upsert instead of duplicating rows. A
-- manual row's region is always NULL and Postgres never treats two NULLs
-- as conflicting, so this can never accidentally collide with a
-- hand-entered row even if the title/time happened to match.
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_dedupe ON calendar_events (title, region, event_time);
