const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

import { query } from "../../db.js";
import { getSetting } from "../shared/articleUtils.js";
import { getIndicesTicker, getForexTicker, getCommoditiesTicker, getStocksOverviewTicker } from "./prices.js";

const SETTINGS_KEY = "markets_overview_cache";
const CATEGORY_LOADERS = {
  indices: getIndicesTicker,
  forex: getForexTicker,
  commodities: getCommoditiesTicker,
  stocks: getStocksOverviewTicker,
};

let cache = {
  indices: [],
  forex: [],
  commodities: [],
  stocks: [],
  last_updated: null,
};

let refreshPromise = null;

export function getOverviewCache() {
  return cache;
}

function isStale() {
  if (!cache.last_updated) return true;
  return Date.now() - new Date(cache.last_updated).getTime() >= REFRESH_INTERVAL_MS;
}

async function persistCache() {
  try {
    await query(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
      [SETTINGS_KEY, JSON.stringify(cache)]
    );
  } catch (err) {
    console.error("Markets overview: could not persist cache to settings.", err);
  }
}

export async function refreshOverviewCache() {
  const categories = Object.keys(CATEGORY_LOADERS);
  console.log(`Markets overview: starting refresh (${categories.length} categories, 6 Twelve Data credits + 2 Alpha Vantage calls total)...`);

  const settled = await Promise.allSettled(
    categories.map((label) => CATEGORY_LOADERS[label](cache[label]))
  );

  const next = { ...cache };
  settled.forEach((result, i) => {
    const label = categories[i];
    if (result.status === "fulfilled") {
      next[label] = result.value;
    } else {
      console.error(
        `Markets overview: the "${label}" category failed entirely (${result.reason?.message || result.reason}) - keeping its previous ${cache[label].length} cached item(s) rather than blanking it.`
      );
      // next[label] already holds cache[label] via the spread above.
    }
  });
  next.last_updated = new Date().toISOString();
  cache = next;

  console.log(
    `Markets overview: refresh complete - indices=${cache.indices.length} forex=${cache.forex.length} commodities=${cache.commodities.length} stocks=${cache.stocks.length}.`
  );
  await persistCache();
  return cache;
}

export function maybeRefreshOverviewCache() {
  if (!isStale() || refreshPromise) return;
  refreshPromise = refreshOverviewCache()
    .catch((err) => console.error("Markets overview: background refresh failed.", err))
    .finally(() => {
      refreshPromise = null;
    });
}

export async function loadPersistedOverviewCache() {
  const persisted = await getSetting(SETTINGS_KEY, null);
  if (!persisted) return;
  try {
    cache = JSON.parse(persisted);
  } catch (err) {
    console.error("Markets overview: could not parse persisted cache, starting from empty.", err);
  }
}
