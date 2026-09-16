import { Router } from "express";
import {
  getCryptoTicker,
  getCryptoMovers,
  getEquityTicker,
  getCommoditySnapshot,
  getCachedTechnicalSnapshot,
  getMarketSnapshot,
} from "../services/marketData/prices.js";
import { getOverviewCache, maybeRefreshOverviewCache } from "../services/marketData/overviewCache.js";

const router = Router();

// A small in-memory cache so we don't hammer CoinGecko's free tier on every
// page load. Good enough for a project this size - swap for Redis later
// if you outgrow it.
const cache = new Map();
const CACHE_MS = 60 * 1000;

async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < CACHE_MS) return hit.value;
  const value = await loader();
  cache.set(key, { value, time: Date.now() });
  return value;
}

// Crypto is always live (CoinGecko). Equity (SPY/QQQ) and commodity
// (Gold/WTI) figures come from market_data_cache - see prices.js's
// getEquityTicker/getCommoditySnapshot - and are only included when their
// cache row is fresh; a class with no fresh data is simply left out, never
// padded with a fabricated placeholder.
router.get("/ticker", async (req, res) => {
  try {
    const [crypto, equity, gold, wti] = await Promise.all([
      cached("crypto-ticker", getCryptoTicker),
      cached("equity-ticker", getEquityTicker),
      cached("gold-ticker", () => getCommoditySnapshot("gold")),
      cached("wti-ticker", () => getCommoditySnapshot("wti")),
    ]);
    const stocks = [...equity, gold, wti].filter(Boolean);
    res.json({ crypto, stocks });
  } catch (err) {
    res.status(502).json({ error: "Could not load market ticker.", detail: err.message });
  }
});

router.get("/movers", async (req, res) => {
  try {
    res.json(await cached("crypto-movers", getCryptoMovers));
  } catch (err) {
    res.status(502).json({ error: "Could not load market movers.", detail: err.message });
  }
});

// ?key=gold|wti|spy reads a technical snapshot from market_data_cache's
// daily history (see prices.js's getCachedTechnicalSnapshot) - same shape
// as the crypto snapshot below, computed from real Alpha Vantage history
// fetched on a schedule rather than live. 404s (not a fabricated fallback)
// if that asset's cached history is missing or stale.
router.get("/snapshot", async (req, res) => {
  const key = req.query.key;
  if (key) {
    try {
      const snapshot = await cached(`snapshot-${key}`, () => getCachedTechnicalSnapshot(key));
      if (!snapshot) return res.status(404).json({ error: `No fresh cached data for "${key}".` });
      return res.json(snapshot);
    } catch (err) {
      return res.status(502).json({ error: "Could not compute market snapshot.", detail: err.message });
    }
  }

  const coinId = req.query.coin || "bitcoin";
  try {
    res.json(await cached(`snapshot-${coinId}`, () => getMarketSnapshot(coinId)));
  } catch (err) {
    res.status(502).json({ error: "Could not compute market snapshot.", detail: err.message });
  }
});

// Backs the homepage's full-width "Markets Overview" strip (frontend/
// components/MarketsOverview.js) - one 3-instrument column per asset
// class. Crypto is real (CoinGecko, via getCryptoTicker(), same 60s lazy
// cache as /ticker above - CoinGecko has no meaningful rate limit for
// this). Indices/forex/commodities/stocks are real Alpha Vantage data too,
// but this route NEVER fetches them live or blocks on Alpha Vantage - the
// free tier is 25 requests/day. It always serves whatever's currently in
// overviewCache.js's in-memory cache immediately, and separately (fire and
// forget, not awaited) asks that cache to refresh itself in the background
// if it's gone stale - see maybeRefreshOverviewCache(). This is the sole
// trigger for a refresh now (see overviewCache.js's bug-history comment
// for why a boot-time timer was dropped): correctness depends on this
// route getting hit periodically, not on the server staying up any
// particular length of time.
router.get("/overview", async (req, res) => {
  try {
    const crypto = await cached("crypto-ticker", getCryptoTicker);
    maybeRefreshOverviewCache();
    const { indices, forex, commodities, stocks, last_updated } = getOverviewCache();
    res.json({ indices, forex, commodities, stocks, crypto, last_updated });
  } catch (err) {
    res.status(502).json({ error: "Could not load markets overview.", detail: err.message });
  }
});

export default router;
