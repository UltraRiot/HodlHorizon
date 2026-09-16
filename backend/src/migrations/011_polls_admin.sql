-- Admin management for polls (routes/admin/polls.js): archive/restore
-- instead of only ever hard-deleting, plus a site-wide on/off switch for
-- the homepage poll widget. status defaults 'active' so every existing
-- poll (including the one seed.js creates) keeps showing exactly as
-- before this migration runs.
ALTER TABLE polls ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived'));

-- Reuses the existing settings table, same pattern as auto_publish /
-- scan_interval_minutes (see migrations/001_init.sql) - read by
-- routes/polls.js's GET /latest, toggled via
-- routes/admin/polls.js's GET/PATCH /api/admin/settings/poll-widget.
INSERT INTO settings (key, value) VALUES ('poll_widget_enabled', 'true')
ON CONFLICT (key) DO NOTHING;
