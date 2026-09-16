-- AI content quality upgrade (see ai-content-quality-spec.md):
-- sources are now assigned to exactly one category up front instead of the
-- AI guessing from keywords, and Analysis articles are computed from real
-- market data by a separate job instead of coming from the news scanner.

-- Every source belongs to exactly one category, set by a human when it's added.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id);

-- rss_url needs a unique constraint for the seed script's ON CONFLICT to
-- actually work (without it, re-running the seed would insert duplicate
-- sources every time - it was silently a no-op before).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sources_rss_url_key'
  ) THEN
    ALTER TABLE sources ADD CONSTRAINT sources_rss_url_key UNIQUE (rss_url);
  END IF;
END $$;

-- Tracks the last computed technical snapshot per watchlist asset, so the
-- Analysis job only writes a new article when the numbers actually moved
-- (price moved >2%, RSI crossed overbought/oversold, or support/resistance broke).
CREATE TABLE IF NOT EXISTS analysis_snapshots (
  symbol TEXT PRIMARY KEY,
  price NUMERIC NOT NULL,
  rsi_14 NUMERIC,
  support NUMERIC,
  resistance NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-category daily article caps, editable from the admin panel (AI Engine
-- page). Values start at the low end of the spec's recommended ranges.
INSERT INTO settings (key, value) VALUES
  ('daily_cap_crypto', '6'),
  ('daily_cap_stocks', '4'),
  ('daily_cap_indices', '2'),
  ('daily_cap_commodities', '2'),
  ('daily_cap_analysis', '2')
ON CONFLICT (key) DO NOTHING;
