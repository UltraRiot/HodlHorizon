import { query } from "../../db.js";
import { getTwelveDataQuote, getTwelveDataCloses } from "./twelveData.js";
import { getWtiQuote, getWtiCloses } from "./alphaVantage.js";
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
  if (!isMarketDataDryRun() && !process.env.TWELVEDATA_API_KEY) {
    console.log("Market data: TWELVEDATA_API_KEY is not set, skipping equity quote refresh (SPY, QQQ, DIA).");
    return;
  }
  console.log("Market data: refreshing equity quotes (SPY, QQQ, DIA) from Twelve Data...");
  await fetchAndCache("spy", "SPY quote (Twelve Data)", () => getTwelveDataQuote("SPY"));
  await fetchAndCache("qqq", "QQQ quote (Twelve Data)", () => getTwelveDataQuote("QQQ"));
  await fetchAndCache("dia", "DIA quote (Twelve Data)", () => getTwelveDataQuote("DIA"));
}

export async function refreshCommodityQuotes() {
  if (isMarketDataDryRun() || process.env.TWELVEDATA_API_KEY) {
    await fetchAndCache("gold", "Gold quote (Twelve Data, XAU/USD)", () => getTwelveDataQuote("XAU/USD"));
  } else {
    console.log("Market data: TWELVEDATA_API_KEY is not set, skipping Gold quote refresh.");
  }

  if (isMarketDataDryRun() || process.env.STOCKS_DATA_API_KEY) {
    await fetchAndCache("wti", "WTI quote (Alpha Vantage)", getWtiQuote);
  } else {
    console.log("Market data: STOCKS_DATA_API_KEY is not set, skipping WTI quote refresh.");
  }
}

export async function refreshCommodityHistory() {
  if (isMarketDataDryRun() || process.env.TWELVEDATA_API_KEY) {
    await fetchAndCache("gold_history", "Gold history (Twelve Data, XAU/USD)", async () => ({ closes: await getTwelveDataCloses("XAU/USD") }));
    await fetchAndCache("spy_history", "SPY history (Twelve Data)", async () => ({ closes: await getTwelveDataCloses("SPY") }));
  } else {
    console.log("Market data: TWELVEDATA_API_KEY is not set, skipping Gold/SPY history refresh.");
  }

  if (isMarketDataDryRun() || process.env.STOCKS_DATA_API_KEY) {
    await fetchAndCache("wti_history", "WTI history (Alpha Vantage)", async () => ({ closes: await getWtiCloses() }));
  } else {
    console.log("Market data: STOCKS_DATA_API_KEY is not set, skipping WTI history refresh.");
  }
}
