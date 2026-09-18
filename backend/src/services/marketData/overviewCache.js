// Background refresh for the Markets Overview strip's columns (indices,
// forex, commodities, stocks - see prices.js for the actual fetch
// functions). GET /api/market/overview (routes/market.js) only ever reads
// getOverviewCache() below and calls maybeRefreshOverviewCache() to
// possibly kick off a background refresh - it never blocks the response
// on a live provider call, so a page load can never eat into either
// provider's daily budget directly. Crypto isn't part of this cache -
// CoinGecko has no such constraint, so routes/market.js keeps reading
// getCryptoTicker() through its existing 60s lazy cache, unchanged.
//
// RATE-LIMIT BUDGET (worked out explicitly, not guessed):
//   indices:     0 calls - SPY/QQQ/DIA read the same market_data_cache row
//                the header ticker's Twelve Data refresh populates (see
//                getIndicesTicker() in prices.js) instead of each fetching
//                their own quote, which used to let this panel and the
//                ticker disagree on the same ETF's price by a few real
//                dollars.
//   forex:       3 Twelve Data /quote credits (EUR/USD, GBP/USD, USD/JPY) -
//                migrated off Alpha Vantage's FX_DAILY once confirmed
//                against Twelve Data's real docs that /quote returns a
//                real percent_change field for forex pairs too.
//   commodities: 0 Twelve Data + 2 Alpha Vantage calls - WTI reads the
//                header ticker's cached 'wti' row (still Alpha Vantage
//                underneath, see alphaVantage.js) instead of its own call;
//                Brent/Natural Gas stay on Alpha Vantage's time-series
//                functions (getCommoditiesTicker() in prices.js) - Twelve
//                Data's true "commodities" catalog is a paid-plan feature,
//                unlike the forex-categorized XAU/USD gold now uses.
//   stocks:      3 Twelve Data /quote credits (AAPL, NVDA, MSFT) -
//                migrated off Alpha Vantage's GLOBAL_QUOTE.
//   = 6 Twelve Data credits + 2 Alpha Vantage calls per refresh. At most
//   once per REFRESH_INTERVAL_MS (24h, see below) = 6 Twelve Data
//   credits/day (on top of refreshMarketData.js's own ~77/day - see that
//   file's budget comment - still nowhere near the 800/day free tier) and
//   2 Alpha Vantage calls/day (on top of that file's 4/day for WTI - 6/25
//   total, comfortably under the free tier).
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

// BUG HISTORY - why this file looks the way it does (fixed 2026-09-15,
// after 4 days of the strip showing only 1 stale indices symbol and
// nothing else):
//
// 1. The refresh's top-level `Promise.all([getIndicesTicker(...), ...])`
//    had no per-category error isolation. Each getXTicker() already
//    isolated failures PER SYMBOL internally, but if an entire category
//    call ever threw (a bug in that category's parsing, a malformed
//    previousItems shape, anything unexpected), Promise.all rejected the
//    whole batch - the `cache = {...}` reassignment below never ran, so
//    even categories that succeeded were thrown away, and the rejection
//    was swallowed by a bare `.catch(console.error)` with no visibility
//    into which category or symbol actually failed. Fixed by using
//    Promise.allSettled at both the category level (this file) and the
//    per-symbol level (prices.js's fetchTickerClass) - see below - with
//    every individual outcome logged and a failed category keeping its
//    previous cached value instead of being blanked.
// 2. Scheduling depended on a setTimeout computed once at boot (to fire
//    the next refresh at whenever it was next due). Every dev-server
//    restart (`node --watch` restarts on every file save) lost that
//    pending timer, so a refresh only ever actually ran on a boot that
//    happened to land more than REFRESH_INTERVAL_MS after the last
//    successful one - rare with frequent restarts, and this backend
//    wasn't even running continuously for 24h+ stretches during that
//    window. Fixed by dropping the timer entirely: there is no
//    setTimeout/setInterval in this file anymore. Staleness is checked
//    on every GET /api/market/overview request instead (see
//    maybeRefreshOverviewCache()) - correctness no longer depends on the
//    process staying up for any particular length of time.
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

// True once a refresh is actually in flight, so a burst of concurrent GET
// requests while the cache is stale triggers exactly one background
// refresh, not one per request.
let refreshPromise = null;

// Read-only snapshot for routes/market.js - never triggers a fetch.
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
    // Non-fatal: the refresh itself already succeeded and is live in
    // memory. Losing the persisted copy only means the next boot re-checks
    // staleness against nothing (treats it as stale) instead of reusing
    // this result - not the end of the world.
    console.error("Markets overview: could not persist cache to settings.", err);
  }
}

// One refresh cycle. All four categories run via Promise.allSettled, not
// Promise.all - one category throwing (however unlikely - each already
// isolates its own per-symbol failures, see fetchTickerClass() in
// prices.js) can never take the other three down with it, and a category
// that DOES fail entirely keeps its previous cached value rather than
// being blanked to empty. Every individual symbol's outcome is logged by
// fetchTickerClass() itself (success with the fetched value, or the exact
// failure reason) - that's the log to check after this runs.
export async function refreshOverviewCache() {
  const categories = Object.keys(CATEGORY_LOADERS);
  // 6 Twelve Data credits (forex 3, stocks 3) + 2 Alpha Vantage calls
  // (Brent, Natural Gas) now - indices (all 3) and WTI within commodities
  // read their shared market_data_cache row instead of making their own
  // call (see getIndicesTicker()/getCommoditiesTicker() in prices.js).
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

// Called from GET /api/market/overview on every request (routes/market.js).
// Never awaited by the caller - always returns immediately. If the cache
// is stale and no refresh is already running, fires one in the
// background; the current (possibly stale, possibly still-partial) cache
// keeps being served to this and every other request in the meantime.
export function maybeRefreshOverviewCache() {
  if (!isStale() || refreshPromise) return;
  refreshPromise = refreshOverviewCache()
    .catch((err) => console.error("Markets overview: background refresh failed.", err))
    .finally(() => {
      refreshPromise = null;
    });
}

// Called once at server boot (jobs/scheduler.js) purely to warm the
// in-memory cache from whatever was last persisted - a single cheap
// Postgres read, zero Alpha Vantage calls. Without this, a restart would
// serve empty columns until the first stale-triggered background refresh
// completes, even if perfectly good data was sitting in the settings
// table the whole time. Does NOT decide whether to refresh - that's
// maybeRefreshOverviewCache()'s job, triggered by the first real request.
export async function loadPersistedOverviewCache() {
  const persisted = await getSetting(SETTINGS_KEY, null);
  if (!persisted) return;
  try {
    cache = JSON.parse(persisted);
  } catch (err) {
    console.error("Markets overview: could not parse persisted cache, starting from empty.", err);
  }
}
