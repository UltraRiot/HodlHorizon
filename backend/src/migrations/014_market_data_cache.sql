CREATE TABLE IF NOT EXISTS market_data_cache (
  asset_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fetch_succeeded BOOLEAN NOT NULL,
  last_error TEXT
);
