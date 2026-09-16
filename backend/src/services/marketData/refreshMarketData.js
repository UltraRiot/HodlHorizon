// Scheduled fetches into market_data_cache (see migrations/014_market_data_cache.sql).
// Wired into jobs/scheduler.js on three cadences, each far under its
// provider's daily budget:
//   - Twelve Data quotes (SPY, QQQ): hourly.        48/800 credits per day
//     (2 symbols x 24 refreshes - each symbol costs its own credit even
//     though both fetches happen back to back).
//   - Alpha Vantage commodity quotes (Gold, WTI):    every 8h.  6/25 requests per day.
//   - Alpha Vantage commodity/SPY history:           daily.     3/25 requests per day.
// Alpha Vantage total: 9 requests/day, comfortably under the 25/day free
// tier even combined with the Markets Overview strip's own usage
// (overviewCache.js) - see that file's budget comment for its share.
//
// routes/market.js and the Analysis job never call a provider directly -
// this is the only place that does, and it only ever runs on a schedule,
// never per-request.
//
// MARKET_DATA_DRY_RUN=true (see backend/.env.example) makes twelveData.js
// and alphaVantage.js return canned responses instead of calling either
// provider for real - this file doesn't need to know or care, since the
// dry-run switch lives inside those clients themselves. The startup log
// announcing dry-run mode is in server.js, not here.
import { query } from "../../db.js";
import { getTwelveDataQuote } from "./twelveData.js";
import { getGoldQuote, getWtiQuote, getGoldCloses, getWtiCloses, getSpyCloses } from "./alphaVantage.js";
import { isMarketDataDryRun } from "./dryRunFixtures.js";

async function upsertCacheRow(assetKey, result) {
  const payload = result.succeeded ? result.payload : {};
  await query(
    `INSERT INTO market_data_cache (asset_key, payload, fetched_at, fetch_succeeded, last_error)
     VALUES ($1, $2, now(), $3, $4)
     ON CONFLICT (asset_key) DO UPDATE
       SET payload = CASE WHEN $3 THEN $2 ELSE market_data_cache.payload END,
           fetched_at = now(),
           fetch_succeeded = $3,
           last_error = $4`,
    [assetKey, JSON.stringify(payload), result.succeeded, result.succeeded ? null : result.error]
  );
}

// Runs one fetch, logs the outcome, and writes the cache row - success or
// failure. No retry here: one attempt, move on, the next scheduled run
// tries again. Alpha Vantage's 1 request/second limit is handled inside
// alphaVantage.js itself (a shared throttle across all its exported
// functions, so refreshCommodityQuotes() and refreshCommodityHistory()
// below can't burst each other even if they ever run concurrently) - this
// file doesn't need its own spacing between calls.
async function fetchAndCache(assetKey, label, fetchFn) {
  try {
    const payload = await fetchFn();
    await upsertCacheRow(assetKey, { succeeded: true, payload });
    console.log(`Market data: ${label} OK - ${JSON.stringify(payload)}`);
  } catch (err) {
    await upsertCacheRow(assetKey, { succeeded: false, error: err.message });
    console.error(`Market data: ${label} FAILED - ${err.message}`);
  }
}

export async function refreshEquityQuotes() {
  // Dry-run mode is a deliberate exception to the "no key -> skip
  // entirely" rule below - the whole point is exercising this pipeline
  // without needing a real key at all. See twelveData.js's fetchQuoteBody().
  if (!isMarketDataDryRun() && !process.env.TWELVEDATA_API_KEY) {
    console.log("Market data: TWELVEDATA_API_KEY is not set, skipping equity quote refresh (SPY, QQQ).");
    return;
  }
  console.log("Market data: refreshing equity quotes (SPY, QQQ) from Twelve Data...");
  await fetchAndCache("spy", "SPY quote (Twelve Data)", () => getTwelveDataQuote("SPY"));
  await fetchAndCache("qqq", "QQQ quote (Twelve Data)", () => getTwelveDataQuote("QQQ"));
}

export async function refreshCommodityQuotes() {
  if (!isMarketDataDryRun() && !process.env.STOCKS_DATA_API_KEY) {
    console.log("Market data: STOCKS_DATA_API_KEY is not set, skipping commodity quote refresh (Gold, WTI).");
    return;
  }
  console.log("Market data: refreshing commodity quotes (Gold, WTI) from Alpha Vantage...");
  await fetchAndCache("gold", "Gold quote (Alpha Vantage, GLD)", getGoldQuote);
  await fetchAndCache("wti", "WTI quote (Alpha Vantage)", getWtiQuote);
}

export async function refreshCommodityHistory() {
  if (!isMarketDataDryRun() && !process.env.STOCKS_DATA_API_KEY) {
    console.log("Market data: STOCKS_DATA_API_KEY is not set, skipping history refresh (Gold, WTI, SPY).");
    return;
  }
  console.log("Market data: refreshing daily history (Gold, WTI, SPY) from Alpha Vantage...");
  await fetchAndCache("gold_history", "Gold history (Alpha Vantage, GLD)", async () => ({ closes: await getGoldCloses() }));
  await fetchAndCache("wti_history", "WTI history (Alpha Vantage)", async () => ({ closes: await getWtiCloses() }));
  await fetchAndCache("spy_history", "SPY history (Alpha Vantage)", async () => ({ closes: await getSpyCloses() }));
}
