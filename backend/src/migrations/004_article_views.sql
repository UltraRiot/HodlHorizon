-- Powers the "Most Read Today" homepage widget. A plain cumulative counter
-- column can't answer "most viewed in the last 24 hours" (it only knows
-- all-time totals), so this is a lightweight event table instead - one row
-- per page load, no unique-visitor dedup. The two indexes match how it's
-- queried: per-article lookups and the 24h-window aggregate for the widget.
CREATE TABLE IF NOT EXISTS article_views (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_article_views_article ON article_views(article_id);
CREATE INDEX IF NOT EXISTS idx_article_views_viewed_at ON article_views(viewed_at);
