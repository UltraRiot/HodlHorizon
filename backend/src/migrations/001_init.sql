-- Hodl Horizon database schema.
-- Written to be readable top-to-bottom: every table has a short comment
-- explaining what it's for. Run with `npm run migrate` (see migrate.js).

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,      -- e.g. "crypto"
  name TEXT NOT NULL              -- e.g. "Crypto"
);

CREATE TABLE IF NOT EXISTS sources (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,             -- e.g. "Reuters"
  rss_url TEXT NOT NULL,          -- the RSS feed the AI engine scans
  homepage_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true
);

-- The news/analysis feed. Every row is one card on the homepage and one
-- article page. "status" controls what the public site shows:
--   draft    -> not shown anywhere, still being written
--   review   -> only visible in the admin panel, waiting for a human check
--   published -> live on the site
CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  dek TEXT NOT NULL,              -- the 1-2 sentence summary shown on cards
  body TEXT NOT NULL,             -- the full article, short paragraphs, no images
  category_id INTEGER NOT NULL REFERENCES categories(id),
  status TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('draft', 'review', 'published')),
  seo_title TEXT,
  seo_description TEXT,
  read_minutes INTEGER NOT NULL DEFAULT 2,
  source_count INTEGER NOT NULL DEFAULT 0,
  bullish_count INTEGER NOT NULL DEFAULT 0,
  bearish_count INTEGER NOT NULL DEFAULT 0,
  neutral_count INTEGER NOT NULL DEFAULT 0,
  ai_provider TEXT,               -- which AI wrote it (mock / openai / anthropic)
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category_id);

-- The sources cited at the bottom of an article (can be more than one).
CREATE TABLE IF NOT EXISTS article_sources (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL
);

-- Simple polls. Optionally attached to an article, or standalone ("Today's Poll").
CREATE TABLE IF NOT EXISTS polls (
  id SERIAL PRIMARY KEY,
  article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS poll_options (
  id SERIAL PRIMARY KEY,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  votes INTEGER NOT NULL DEFAULT 0
);

-- Short evergreen "Learn" / glossary entries (SEO long-tail content).
CREATE TABLE IF NOT EXISTS glossary_terms (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  term TEXT NOT NULL,
  short_definition TEXT NOT NULL,
  body TEXT NOT NULL,
  seo_title TEXT,
  seo_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Economic calendar (Fed meetings, CPI, earnings, etc.). Admin can add rows
-- by hand for now; a paid calendar API can fill this table automatically later.
CREATE TABLE IF NOT EXISTS calendar_events (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  impact TEXT NOT NULL DEFAULT 'medium' CHECK (impact IN ('low', 'medium', 'high')),
  category TEXT NOT NULL DEFAULT 'macro'
);

-- A single admin account is enough for this project (no user registration).
CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

-- Every AI call is logged here so the admin panel can show a running cost
-- estimate for the month (see services/ai/provider.js).
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT,
  tokens_estimate INTEGER NOT NULL DEFAULT 0,
  cost_estimate_usd NUMERIC(10, 4) NOT NULL DEFAULT 0,
  purpose TEXT NOT NULL,          -- e.g. "article", "glossary"
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Small key/value store for settings the admin panel can change without a
-- deploy, e.g. whether the AI engine auto-publishes.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('auto_publish', 'true'),
  ('scan_interval_minutes', '15')
ON CONFLICT (key) DO NOTHING;
