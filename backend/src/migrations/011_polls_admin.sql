ALTER TABLE polls ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived'));

INSERT INTO settings (key, value) VALUES ('poll_widget_enabled', 'true')
ON CONFLICT (key) DO NOTHING;
