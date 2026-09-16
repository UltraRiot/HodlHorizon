-- Price plausibility flag (Crypto only): if a generated article states a
-- specific BTC/ETH price that differs from the live CoinGecko price
-- (getCryptoTicker(), services/marketData/prices.js) by more than
-- PRICE_MISMATCH_THRESHOLD (see services/rss/scanAndGenerate.js), the
-- stated number is very likely a hallucination - the AI never has live
-- price data, it's synthesizing plausible-sounding language from an RSS
-- snippet. Flagging only, same pattern as category_mismatch (migrations/
-- 006): never auto-corrects the number, just forces a human look before
-- the article can publish.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS price_mismatch BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS price_mismatch_note TEXT;
