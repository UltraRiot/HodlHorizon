-- Weekend market-closed gate (services/rss/scanAndGenerate.js,
-- services/analysis/runAnalysis.js): Stocks/Indices/Commodities markets
-- are closed Saturday/Sunday, so there's no genuine new price movement to
-- report - these caps drop the effective daily cap to near-zero on
-- weekends for those three categories only. Crypto is unaffected (trades
-- 24/7) and has no weekend_cap_crypto row on purpose.
INSERT INTO settings (key, value) VALUES
  ('weekend_cap_stocks', '1'),
  ('weekend_cap_indices', '1'),
  ('weekend_cap_commodities', '1')
ON CONFLICT (key) DO NOTHING;
