ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_status_check;
ALTER TABLE articles ADD CONSTRAINT articles_status_check
  CHECK (status IN ('draft', 'review', 'published', 'scheduled'));

ALTER TABLE articles ADD COLUMN IF NOT EXISTS auto_publish_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_articles_auto_publish_at ON articles(auto_publish_at) WHERE status = 'scheduled';

INSERT INTO settings (key, value) VALUES
  ('auto_publish_delay_hours', '5')
ON CONFLICT (key) DO NOTHING;
