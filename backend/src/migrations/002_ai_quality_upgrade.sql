ALTER TABLE sources ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sources_rss_url_key'
  ) THEN
    ALTER TABLE sources ADD CONSTRAINT sources_rss_url_key UNIQUE (rss_url);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS analysis_snapshots (
  symbol TEXT PRIMARY KEY,
  price NUMERIC NOT NULL,
  rsi_14 NUMERIC,
  support NUMERIC,
  resistance NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
  ('daily_cap_crypto', '6'),
  ('daily_cap_stocks', '4'),
  ('daily_cap_indices', '2'),
  ('daily_cap_commodities', '2'),
  ('daily_cap_analysis', '2')
ON CONFLICT (key) DO NOTHING;
