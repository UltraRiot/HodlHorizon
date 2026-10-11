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

const cache = new Map();
const CACHE_MS = 60 * 1000;

async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < CACHE_MS) return hit.value;
  const value = await loader();
  cache.set(key, { value, time: Date.now() });
  return value;
}

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
