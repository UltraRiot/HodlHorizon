// Alpha Vantage client for the scheduled market-data-cache job
// (refreshMarketData.js) - Gold (via the GLD ETF proxy - Alpha Vantage has
// no native spot-gold or silver commodity endpoint; live-tested against
// this exact account, see prices.js's fetchCommoditySeries() comment for
// the "GOLD"/"SILVER" function-doesn't-exist error) and WTI crude (a real
// Alpha Vantage commodity endpoint).
//
// This is intentionally a separate, independent client from the
// GLOBAL_QUOTE/CURRENCY_EXCHANGE_RATE/commodity-series helpers already in
// prices.js that back the Markets Overview strip (overviewCache.js) - that
// existing code shares a single cross-call throttle tuned to its own
// request burst pattern (4 categories x 3 symbols), and this job has a
// completely different, cron-driven call pattern. Reusing that throttle
// would just make the two schedules interfere with each other for no
// benefit; a few dozen lines of overlap is worth the independence.
//
// Reuses STOCKS_DATA_API_KEY, the same Alpha Vantage account/key that
// already powers the Overview strip and used to power the Analysis job's
// live per-run fetches - there's one Alpha Vantage account here, not two.
//
// One attempt per call, no retry loop - see twelveData.js's comment for why.
//
// MARKET_DATA_DRY_RUN=true swaps every real fetch below for a canned
// response (see fetchAlphaVantageBody()/dryRunFixtures.js) so local
// development never spends this key's real daily quota.
import {
  isMarketDataDryRun,
  DRY_RUN_GOLD_QUOTE_BODY,
  DRY_RUN_WTI_SERIES_BODY,
  DRY_RUN_WTI_HISTORY_RATE_LIMIT_BODY,
  DRY_RUN_GOLD_DAILY_BODY,
  DRY_RUN_SPY_DAILY_BODY,
} from "./dryRunFixtures.js";

const ALPHA_VANTAGE = "https://www.alphavantage.co/query";

function requireApiKey() {
  const key = process.env.STOCKS_DATA_API_KEY;
  if (!key) throw new Error("STOCKS_DATA_API_KEY is not set.");
  return key;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request to ${url} failed: ${res.status}`);
  return res.json();
}

// Alpha Vantage's free tier is 1 request/second. refreshCommodityQuotes()
// and refreshCommodityHistory() (refreshMarketData.js) are two independent
// functions that can run concurrently (e.g. both fired at server boot, or
// their cron schedules ever landing on the same tick) - a throttle scoped
// to a single function call wouldn't serialize calls made from the OTHER
// one running at the same time. This module-level queue serializes every
// call made through this file, regardless of which exported function
// triggered it - same proven approach (and the same live-tested 1500ms
// margin - see runAnalysis.js's old ALPHA_VANTAGE_MIN_GAP_MS) as the
// Overview strip's throttledAlphaVantageCall() in prices.js, kept
// independent from that one since the two have unrelated call patterns.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const CALL_SPACING_MS = 1500;
let nextSlot = 0;
async function throttledGetJson(url) {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + CALL_SPACING_MS;
  if (slot > now) await sleep(slot - now);
  return getJson(url);
}

// The only place that decides real vs. canned - MARKET_DATA_DRY_RUN=true
// short-circuits before any key check, throttle wait, or network call, so
// dry-run testing works even with no STOCKS_DATA_API_KEY configured at
// all, and runs instantly (no 1500ms-per-call throttle). Everything
// downstream (checkAlphaVantageError, shape parsing) runs identically
// either way, so dry-run mode exercises the exact same validation code
// the real path does.
async function fetchAlphaVantageBody(buildUrl, cannedBody) {
  if (isMarketDataDryRun()) return cannedBody;
  const key = requireApiKey();
  return throttledGetJson(buildUrl(key));
}

// Alpha Vantage returns HTTP 200 even when rate-limited or given a bad
// request - it signals failure via a "Note" (rate/burst limit),
// "Information" (bad call), or "Error Message" field in the JSON body
// instead of an HTTP error status, so every call site here checks this
// explicitly rather than trusting res.ok alone.
function checkAlphaVantageError(data, context) {
  const message = data["Note"] || data["Information"] || data["Error Message"];
  if (message) throw new Error(`Alpha Vantage ${context}: ${message}`);
}

// GLOBAL_QUOTE for the GLD ETF - a real, live-ish equity/ETF quote (unlike
// the WTI commodity endpoint below, which is a daily time series).
export async function getGoldQuote() {
  const data = await fetchAlphaVantageBody(
    (key) => `${ALPHA_VANTAGE}?function=GLOBAL_QUOTE&symbol=GLD&apikey=${key}`,
    DRY_RUN_GOLD_QUOTE_BODY
  );
  checkAlphaVantageError(data, "GLOBAL_QUOTE GLD");
  const quote = data["Global Quote"];
  if (!quote || !quote["05. price"]) {
    throw new Error("Alpha Vantage GLOBAL_QUOTE GLD: unexpected response shape.");
  }
  return {
    price: Number(quote["05. price"]),
    change_percent_24h: Number(String(quote["10. change percent"]).replace("%", "")),
  };
}

// WTI has no separate real-time quote endpoint - it's a daily time series,
// so a "quote" here just re-reads the same series and derives price/change
// from the latest two points, same as history does. Re-polling this every
// 8 hours (see refreshMarketData.js) just catches a same-day update or a
// new day's bar sooner than the once-a-day history refresh would.
function parseWtiSeries(data) {
  checkAlphaVantageError(data, "WTI");
  if (!Array.isArray(data.data)) {
    throw new Error("Alpha Vantage WTI: unexpected response shape.");
  }
  // Alpha Vantage marks a non-trading day's value as "." rather than
  // omitting the entry - filter those out before sorting.
  return data.data
    .filter((entry) => entry.value && entry.value !== ".")
    .map((entry) => ({ date: entry.date, value: Number(entry.value) }))
    .sort((a, b) => new Date(a.date) - new Date(b.date)); // oldest first
}

export async function getWtiQuote() {
  const data = await fetchAlphaVantageBody(
    (key) => `${ALPHA_VANTAGE}?function=WTI&interval=daily&apikey=${key}`,
    DRY_RUN_WTI_SERIES_BODY
  );
  const sorted = parseWtiSeries(data);
  if (sorted.length < 2) {
    throw new Error("Alpha Vantage WTI: not enough data points for a % change.");
  }
  const latest = sorted[sorted.length - 1].value;
  const previous = sorted[sorted.length - 2].value;
  return {
    price: latest,
    change_percent_24h: ((latest - previous) / previous) * 100,
  };
}

export async function getWtiCloses() {
  // Deliberately the one canned dry-run response that exercises the
  // "treated as a failure, not data" path (checkAlphaVantageError, via
  // parseWtiSeries) instead of a canned success - see
  // dryRunFixtures.js's comment on DRY_RUN_WTI_HISTORY_RATE_LIMIT_BODY.
  // Only affects MARKET_DATA_DRY_RUN=true; the real WTI history fetch is
  // unchanged.
  const data = await fetchAlphaVantageBody(
    (key) => `${ALPHA_VANTAGE}?function=WTI&interval=daily&apikey=${key}`,
    DRY_RUN_WTI_HISTORY_RATE_LIMIT_BODY
  );
  const sorted = parseWtiSeries(data);
  return sorted.map((entry) => entry.value);
}

// TIME_SERIES_DAILY - used for GLD (gold's history, same ETF as the quote
// above) and SPY (S&P 500 ETF, for the Analysis job's technical snapshot -
// Twelve Data only supplies a real-time quote for SPY, not history, so SPY's
// SMA/RSI/support/resistance still come from Alpha Vantage's daily bars,
// same proven source as before this refactor).
async function getDailyCloses(symbol, cannedBody) {
  const data = await fetchAlphaVantageBody(
    (key) => `${ALPHA_VANTAGE}?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${key}`,
    cannedBody
  );
  checkAlphaVantageError(data, `TIME_SERIES_DAILY ${symbol}`);
  const series = data["Time Series (Daily)"];
  if (!series) {
    throw new Error(`Alpha Vantage TIME_SERIES_DAILY ${symbol}: unexpected response shape.`);
  }
  return Object.entries(series)
    .sort(([dateA], [dateB]) => new Date(dateA) - new Date(dateB)) // oldest first
    .map(([, entry]) => Number(entry["4. close"]));
}

export async function getGoldCloses() {
  return getDailyCloses("GLD", DRY_RUN_GOLD_DAILY_BODY);
}

export async function getSpyCloses() {
  return getDailyCloses("SPY", DRY_RUN_SPY_DAILY_BODY);
}
