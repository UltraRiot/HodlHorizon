DROP INDEX IF EXISTS idx_calendar_events_dedupe;
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_dedupe ON calendar_events (title, event_time);
