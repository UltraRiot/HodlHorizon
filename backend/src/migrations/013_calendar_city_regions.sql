-- Fixes the dedup key BEFORE region values change from continent buckets
-- (US/CA/EU/UK/Asia/Oceania/Other) to financial-center cities (New York/
-- Toronto/Frankfurt/London/Tokyo/Beijing/Sydney/Wellington/Other, see
-- services/calendar/syncForexFactory.js). A display label was never part
-- of an event's real identity, and doing this first (in its own
-- migration, ahead of any sync run that would write the new city
-- values) means the very next sync upserts existing rows onto their new
-- region label via (title, event_time) instead of - if the old
-- (title, region, event_time) key were still active - failing to match
-- them at all and inserting duplicates alongside the stale-region originals.
DROP INDEX IF EXISTS idx_calendar_events_dedupe;
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_dedupe ON calendar_events (title, event_time);
