ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS region TEXT;

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS forecast TEXT;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS previous TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_dedupe ON calendar_events (title, region, event_time);
