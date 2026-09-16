-- Delayed auto-publish for clean single-source articles: instead of leaving
-- every single-source story in indefinite manual review, a single-source
-- article that passes every automated check (no category_mismatch, no
-- price_mismatch, body-problem/verification checks clean - see
-- services/ai/provider.js's verificationClean and
-- services/rss/scanAndGenerate.js) gets a countdown instead of a forever
-- "review": status = 'scheduled' with auto_publish_at set
-- auto_publish_delay_hours out. The existing 15-minute cron tick
-- (jobs/scheduler.js) flips it to 'published' once that time passes,
-- unless a human edited, held, or deleted it first - routes/admin/
-- articles.js clears auto_publish_at (and reverts to 'review') the moment
-- that happens, so the cron tick's own "status = 'scheduled'" filter is
-- enough to skip it correctly with no extra flag needed. 2+-source
-- articles that pass checks are unaffected - they still publish
-- immediately exactly as before. Public-facing routes (routes/articles.js,
-- routes/sitemapData.js) only ever select status = 'published', so a
-- 'scheduled' row is invisible on the live site by construction, same as
-- 'review'.
ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_status_check;
ALTER TABLE articles ADD CONSTRAINT articles_status_check
  CHECK (status IN ('draft', 'review', 'published', 'scheduled'));

ALTER TABLE articles ADD COLUMN IF NOT EXISTS auto_publish_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_articles_auto_publish_at ON articles(auto_publish_at) WHERE status = 'scheduled';

INSERT INTO settings (key, value) VALUES
  ('auto_publish_delay_hours', '5')
ON CONFLICT (key) DO NOTHING;
