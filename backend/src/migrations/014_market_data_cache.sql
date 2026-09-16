-- Scheduled-fetch cache for provider-backed market data that used to be
-- either hardcoded sample numbers (the header ticker's stocks/commodities)
-- or fetched live per Analysis run (SPY/GLD/WTI technicals). One row per
-- asset_key, upserted on every fetch attempt - including failed ones - so
-- staleness is always knowable from fetched_at + fetch_succeeded rather
-- than inferred from a missing row. See services/marketData/refreshMarketData.js
-- (the scheduled job that writes these rows) and prices.js's
-- getEquityTicker/getCommoditySnapshot/getCachedTechnicalSnapshot (the only
-- readers - routes/market.js and the Analysis job never call a provider
-- directly, only read this table).
--
-- asset_key values in use today:
--   "spy", "qqq"          - Twelve Data real-time quote, { price, change_percent_24h }
--   "gold", "wti"         - Alpha Vantage quote-equivalent, { price, change_percent_24h }
--                           ("gold" is GLD ETF's GLOBAL_QUOTE, not literal spot
--                           gold - see the symbol labeling in prices.js)
--   "gold_history",
--   "wti_history",
--   "spy_history"         - Alpha Vantage daily closes for SMA/RSI, { closes: [...] }
-- A quote and its matching history live under separate keys (not merged
-- into one row) because they're fetched on different schedules - merging
-- them would mean one job's failure could stomp on fetched_at/fetch_succeeded
-- for data the OTHER job just successfully wrote.
CREATE TABLE IF NOT EXISTS market_data_cache (
  asset_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fetch_succeeded BOOLEAN NOT NULL,
  last_error TEXT
);
