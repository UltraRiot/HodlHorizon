// Market data. Crypto uses CoinGecko's free public API (no key needed) and
// is fully real. The header ticker's equity (SPY/QQQ, via Twelve Data) and
// commodity (Gold/WTI, via Alpha Vantage) figures are fetched on a
// schedule into market_data_cache (services/marketData/refreshMarketData.js)
// rather than live here - see getEquityTicker/getCommoditySnapshot/
// getCachedTechnicalSnapshot below, the only functions in this file that
// read that table. Nothing in this file ever fabricates a number: a class
// with no fresh cached data is simply omitted, never padded with a sample.
import { query } from "../../db.js";
import { convertEtfProxyPrice, instrumentForEtfTicker } from "./instruments.js";
import { getTwelveDataQuote } from "./twelveData.js";

const COINGECKO = "https://api.coingecko.com/api/v3";
const ALPHA_VANTAGE = "https://www.alphavantage.co/query";

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request to ${url} failed: ${res.status}`);
  return res.json();
}

// The one shared place a raw price number gets rounded for display/storage -
// every function below that produces a price (ticker, movers, snapshots)
// routes it through here instead of rounding ad hoc. 2 decimals covers
// anything $1 or over; sub-$1 assets (some tokens trade at fractions of a
// cent) get more decimals so small values don't collapse to "0.00". Returns
// a number, not a string, so it composes with things like .toLocaleString().
export function formatPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  const decimals = Math.abs(num) >= 1 ? 2 : 6;
  return Number(num.toFixed(decimals));
}

// A handful of coins for the homepage ticker and the Markets Overview
// strip's Crypto column (routes/market.js's /overview endpoint needs at
// least 3 to fill that column).
export async function getCryptoTicker() {
  const ids = "bitcoin,ethereum,solana";
  const data = await getJson(
    `${COINGECKO}/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h`
  );
  return data.map((c) => ({
    symbol: c.symbol.toUpperCase(),
    name: c.name,
    price: formatPrice(c.current_price),
    change_percent_24h: c.price_change_percentage_24h,
    assetClass: "crypto",
  }));
}

// Top 5 gainers and top 5 losers among the 100 largest coins by market cap.
export async function getCryptoMovers() {
  const data = await getJson(
    `${COINGECKO}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h`
  );
  const sorted = [...data].sort(
    (a, b) => (b.price_change_percentage_24h ?? 0) - (a.price_change_percentage_24h ?? 0)
  );
  const toRow = (c) => ({
    symbol: c.symbol.toUpperCase(),
    name: c.name,
    price: formatPrice(c.current_price),
    assetClass: "crypto",
    change_percent_24h: c.price_change_percentage_24h,
  });

  return {
    gainers: sorted.slice(0, 5).map(toRow),
    losers: sorted.slice(-5).reverse().map(toRow),
  };
}

// --- Header ticker bar's equity/commodity figures (routes/market.js's
// GET /api/market/ticker) - read-only, backed by market_data_cache. See
// refreshMarketData.js for what writes these rows and on what schedule.
//
// A row is only ever used if fetch_succeeded is true AND it was fetched
// within maxAgeMs - a failed attempt always evicts the asset from display
// (even if fetched_at looks recent, since a failed attempt still bumps
// fetched_at - see migrations/014_market_data_cache.sql) until the next
// successful fetch. Never falls back to a stale-but-once-good value here;
// that's a deliberate difference from the Overview strip's per-symbol
// last-known-value fallback further down this file - this ticker would
// rather show nothing than an old commodity/equity price next to a live
// crypto one with no way to tell them apart.
async function getFreshCacheRow(assetKey, maxAgeMs) {
  const { rows } = await query("SELECT * FROM market_data_cache WHERE asset_key = $1", [assetKey]);
  const row = rows[0];
  if (!row || !row.fetch_succeeded) return null;
  if (Date.now() - new Date(row.fetched_at).getTime() > maxAgeMs) return null;
  return row;
}

// 3h margin over the hourly Twelve Data refresh - real headroom, not a
// threshold that would flip stale right after a slightly-late cron tick.
const EQUITY_FRESHNESS_MS = 3 * 60 * 60 * 1000;
// 12h margin over the 8-hourly Alpha Vantage commodity-quote refresh.
const COMMODITY_FRESHNESS_MS = 12 * 60 * 60 * 1000;
// 30h margin over the once-daily Alpha Vantage history refresh.
const HISTORY_FRESHNESS_MS = 30 * 60 * 60 * 1000;

// key -> the ETF ticker actually fetched (Twelve Data has no bare index
// quote on the free tier - see refreshMarketData.js). The displayed
// symbol/price are now the REAL index (via instruments.js's
// convertEtfProxyPrice()), not the ETF's own share price - this used to
// read "S&P 500 (SPY)" showing SPY's raw price, which is why an Analysis
// article about "the S&P 500" and this ticker used to describe two
// different numbers for what a reader would reasonably assume was the
// same thing. instrumentForEtfTicker() supplies both the real display
// name and the assetClass ("index") the shared formatter needs.
const EQUITY_ETF_TICKERS = { spy: "SPY", qqq: "QQQ" };

export async function getEquityTicker() {
  const items = [];
  for (const key of Object.keys(EQUITY_ETF_TICKERS)) {
    const row = await getFreshCacheRow(key, EQUITY_FRESHNESS_MS);
    if (!row) continue;
    const ticker = EQUITY_ETF_TICKERS[key];
    const instrument = instrumentForEtfTicker(ticker);
    const realPrice = convertEtfProxyPrice(ticker, row.payload.price);
    items.push({
      symbol: instrument.display,
      price: formatPrice(realPrice),
      change_percent_24h: row.payload.change_percent_24h,
      assetClass: instrument.assetClass,
    });
  }
  return items;
}

// "Gold" (not "Gold (GLD)" anymore) - this cache row now holds Twelve
// Data's real spot gold quote (XAU/USD), not the GLD ETF's share price
// (see refreshMarketData.js/alphaVantage.js), so there's no ETF-vs-spot
// mismatch left to disclose in the label. WTI still has no such mismatch
// either way - Alpha Vantage's WTI series is a genuine $/barrel figure,
// which is exactly why it's safe for getCommoditiesTicker() below to read
// this same 'wti' row too.
const COMMODITY_LABELS = { gold: "Gold", wti: "Oil (WTI)" };

export async function getCommoditySnapshot(key) {
  const row = await getFreshCacheRow(key, COMMODITY_FRESHNESS_MS);
  if (!row) return null;
  return {
    symbol: COMMODITY_LABELS[key] || key.toUpperCase(),
    price: formatPrice(row.payload.price),
    change_percent_24h: row.payload.change_percent_24h,
    assetClass: "commodity",
  };
}

// Full technical snapshot (trend/RSI/support/resistance), same shape as
// getMarketSnapshot() below, but sourced from market_data_cache's daily
// history rows instead of a live provider call - used by the /snapshot
// route and the Analysis job (runAnalysis.js) for gold/WTI/SPY. Returns
// null (never a guessed/partial snapshot) if the history row is missing,
// failed, or older than HISTORY_FRESHNESS_MS.
const HISTORY_CACHE_KEYS = { gold: "gold_history", wti: "wti_history", spy: "spy_history" };
const HISTORY_LABELS = { gold: "Gold", wti: "Oil (WTI)", spy: "S&P 500" };
const HISTORY_ASSET_CLASSES = { gold: "commodity", wti: "commodity", spy: "index" };

export async function getCachedTechnicalSnapshot(key) {
  const cacheKey = HISTORY_CACHE_KEYS[key];
  if (!cacheKey) throw new Error(`Unknown cached snapshot key: ${key}`);
  const row = await getFreshCacheRow(cacheKey, HISTORY_FRESHNESS_MS);
  if (!row) return null;
  // spy_history is raw SPY ETF closes (see refreshMarketData.js) - scaled
  // to real S&P 500 index points here, same conversion and same reasoning
  // as getEquityTicker() above, so the Analysis brief this feeds
  // (buildAnalysisPrompt) describes the same number the ticker does.
  // Multiplying every close by a constant before computing MA/support/
  // resistance/RSI is equivalent to computing on the raw closes and then
  // scaling the (linear) results - RSI is untouched either way, since it
  // depends only on the ratio between up/down moves, not their scale.
  const closes = key === "spy" ? row.payload.closes.map((c) => convertEtfProxyPrice("SPY", c)) : row.payload.closes;
  return computeSnapshotFromCloses(HISTORY_LABELS[key], closes, HISTORY_ASSET_CLASSES[key]);
}

// --- Markets Overview strip (routes/market.js's GET /api/market/overview) ---
// Real market data, refreshed on a background timer (see
// services/marketData/overviewCache.js) rather than fetched per request,
// backing the homepage's Markets Overview strip specifically - independent
// of the cron-scheduled refreshMarketData.js above (which populates the
// header ticker's SPY/QQQ/Gold/WTI figures via getEquityTicker()/
// getCommoditySnapshot()). Indices and WTI within Commodities read the
// SAME cached rows refreshMarketData.js populates rather than fetching
// live at all - see their comments below. What's left fetching live here:
// forex (Twelve Data) and stocks (Twelve Data) on their own
// request-triggered staleness check, plus Brent/Natural Gas within
// Commodities (Alpha Vantage - see fetchCommoditySeries()'s comment for
// why those two specifically stayed there).
//
// Every getXTicker() below takes `previousItems` (that class's last
// cached result, passed in by overviewCache.js) and falls back to a
// symbol's last known good value if its individual fetch fails, is
// rate-limited, or comes back malformed - see checkAlphaVantageError()/
// getTwelveDataQuote() and fetchTickerClass() - so one bad symbol degrades
// gracefully instead of blanking or crashing the whole column.

// Alpha Vantage returns HTTP 200 even on rate-limit/bad-symbol/bad-function
// errors - it signals failure via a "Note" (rate/burst limit),
// "Information" (bad call - including a function name that doesn't exist:
// live-tested "GOLD" for this feature and got back exactly this shape),
// or "Error Message" field in the JSON body rather than an HTTP error
// status. Same principle as alphaVantageSeriesToCloses() further down;
// factored out here so every call site in this section checks it the
// same way.
function checkAlphaVantageError(data, context) {
  const message = data["Note"] || data["Information"] || data["Error Message"];
  if (message) throw new Error(`Alpha Vantage ${context}: ${message}`);
}

// A third factor behind the Markets Overview strip's 4-day outage,
// beyond the two named root causes (fixed in overviewCache.js): even with
// per-category/per-symbol failures now correctly isolated via
// Promise.allSettled, all ~12 calls were still DISPATCHED at once - 4
// categories notionally "in parallel," each firing its 3 symbols at once
// too. Alpha Vantage's free tier explicitly asks for "1 request per
// second" (seen live, in this project, as the exact "Note" message on a
// burst); bursting 12 at once meant most of them got that same
// rate-limit response regardless of Promise.all vs allSettled - allSettled
// fixes how failures are AGGREGATED, not how fast requests go out. This
// throttle serializes the actual network dispatch to one call roughly
// every 300ms (a full refresh takes ~3.6s, negligible for a background
// job), while every caller still awaits/fails independently - so
// Promise.allSettled's per-symbol isolation and this spacing are
// complementary, not redundant.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
// 300ms (~3.3 req/sec) was tried first and measured live against the real
// API for this fix - only 4 of 12 calls got through, the rest came back
// with the exact "1 request per second" burst message quoted above. AV's
// enforcement isn't a simple "wait 1000ms since the last call" either
// (some calls under a 1000ms gap still succeeded), so this uses a wider
// margin than the stated minimum rather than trying to shave it closer.
const ALPHA_VANTAGE_CALL_SPACING_MS = 1100;
let nextAlphaVantageSlot = 0;
async function throttledAlphaVantageCall(makeRequest) {
  const now = Date.now();
  const slot = Math.max(now, nextAlphaVantageSlot);
  nextAlphaVantageSlot = slot + ALPHA_VANTAGE_CALL_SPACING_MS;
  if (slot > now) await sleep(slot - now);
  return makeRequest();
}

// WTI / BRENT / NATURAL_GAS - Alpha Vantage's confirmed commodity
// time-series function names. GOLD and SILVER were live-tested for this
// feature specifically and do NOT exist as Alpha Vantage functions -
// GOLD came back { "Error Message": "This API function (GOLD) does not
// exist." } - so per the fallback plan, gold/silver are left out
// entirely rather than guessed at, and WTI + Brent + Natural Gas fill all
// 3 commodity slots instead. No % change field on these either, so it's
// computed from the latest two data points instead of a second call.
async function fetchCommoditySeries(functionName) {
  const key = requireStocksApiKey();
  const data = await throttledAlphaVantageCall(() => getJson(`${ALPHA_VANTAGE}?function=${functionName}&interval=daily&apikey=${key}`));
  checkAlphaVantageError(data, functionName);
  if (!Array.isArray(data.data)) {
    throw new Error(`Alpha Vantage ${functionName}: unexpected response shape.`);
  }
  // Alpha Vantage marks a non-trading day's value as "." rather than
  // omitting the entry - filter those out before picking the latest two.
  const sorted = data.data
    .filter((entry) => entry.value && entry.value !== ".")
    .map((entry) => ({ date: entry.date, value: Number(entry.value) }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (sorted.length < 2) {
    throw new Error(`Alpha Vantage ${functionName}: not enough data points for a % change.`);
  }
  const latest = sorted[sorted.length - 1].value;
  const previous = sorted[sorted.length - 2].value;
  return {
    price: formatPrice(latest),
    change_percent_24h: ((latest - previous) / previous) * 100,
  };
}

// Runs one asset class's { symbol, name, ... } list through `fetchOne` via
// Promise.allSettled - not Promise.all - so every symbol is attempted
// independently and one failing (rate limit, bad symbol, parse error)
// never skips or cancels any other symbol's call, same category or not.
// A failed symbol falls back to its entry in `previousItems` (matched by
// symbol), and is dropped entirely only if there's no previous value
// either (e.g. the very first refresh ever, or a symbol that has never
// once succeeded). No API key at all -> empty array, same as "no data
// yet" rather than a placeholder.
//
// Every outcome is logged individually - this is the log to check after a
// refresh runs, to confirm each fetch succeeded or see exactly why it didn't.
// assetClass here is the shared-formatter class ("index"/"forex"/
// "commodity"/"stock"), separate from classLabel (just a log tag, kept in
// its existing plural form - "indices"/"forex"/"commodities"/"stocks" -
// so existing log lines don't change).
//
// Deliberately no blanket "no key -> return []" guard here anymore - the
// four categories now depend on different keys (indices and WTI-within-
// commodities need no live key at all, forex/stocks need
// TWELVEDATA_API_KEY, Brent/Natural Gas need STOCKS_DATA_API_KEY). A
// single shared guard checking one specific env var used to silently
// blank ALL FOUR categories whenever that one var was unset, even for
// categories that never needed it. Each fetchOne already throws a clear
// "X_API_KEY is not set" error when its own key is missing, which
// Promise.allSettled below catches per-symbol exactly like any other
// failure - so a site configured with only one of the two keys still gets
// real data for whichever categories that key actually covers.
async function fetchTickerClass(items, previousItems, fetchOne, classLabel, assetClass) {
  const settled = await Promise.allSettled(items.map((item) => fetchOne(item)));

  const results = settled.map((result, i) => {
    const item = items[i];
    if (result.status === "fulfilled") {
      console.log(
        `Markets overview (${classLabel}): ${item.symbol} OK - price=${result.value.price} change_percent_24h=${result.value.change_percent_24h}`
      );
      return { symbol: item.symbol, name: item.name, ...result.value, assetClass, fetched_at: new Date().toISOString() };
    }

    const reason = result.reason?.message || String(result.reason);
    const fallback = previousItems.find((p) => p.symbol === item.symbol);
    if (fallback) {
      console.warn(
        `Markets overview (${classLabel}): ${item.symbol} FAILED - ${reason} - keeping last known value (price=${fallback.price}, fetched ${fallback.fetched_at || "previously"}).`
      );
      return fallback;
    }
    console.warn(`Markets overview (${classLabel}): ${item.symbol} FAILED - ${reason} - no previous value to fall back to, omitting.`);
    return null;
  });

  return results.filter(Boolean);
}

// Alpha Vantage has no native index quote, so this still fetches SPY/QQQ/
// DIA under the hood - but symbol/name/price below are the REAL
// instrument's, converted via instruments.js's convertEtfProxyPrice(), not
// the ETF's own. Showing "SPY" next to a number that's now real index
// points (not SPY's own share price) would just be a new, different
// mismatch - this used to label these honestly as "(SPY)"/"(QQQ)"/"(DIA)"
// precisely because the price WAS the ETF's; now that it isn't, the label
// changed to match. `symbol` uses the TradingView-style short form
// (tvSymbol) rather than the longer display name, to fit the same compact
// badge the raw ETF tickers used to sit in.
//
// cacheKey points at the SAME market_data_cache row getEquityTicker()
// (the header ticker) reads - this used to run its own independent Alpha
// Vantage GLOBAL_QUOTE call per symbol instead, which could (and in
// practice did) disagree with the ticker's Twelve Data figure for the
// exact same real ETF by a few dollars - magnified into a much more
// visible gap once both are converted to index points. One real quote
// per index now, read twice, not fetched twice.
const INDICES_SYMBOLS = [
  { symbol: "SPX", name: "S&P 500", etfTicker: "SPY", cacheKey: "spy" },
  { symbol: "NDQ", name: "Nasdaq", etfTicker: "QQQ", cacheKey: "qqq" },
  { symbol: "DJI", name: "Dow Jones", etfTicker: "DIA", cacheKey: "dia" },
];
export async function getIndicesTicker(previousItems = []) {
  return fetchTickerClass(
    INDICES_SYMBOLS,
    previousItems,
    async (item) => {
      const row = await getFreshCacheRow(item.cacheKey, EQUITY_FRESHNESS_MS);
      if (!row) throw new Error(`No fresh cached ${item.etfTicker} quote (market_data_cache).`);
      // formatPrice() here, same as getEquityTicker() above - without it
      // this and the ticker can round a repeating-decimal conversion
      // result (e.g. 612.15 * 41) a hair differently at display time and
      // show a different last digit for what's actually the same number.
      return { price: formatPrice(convertEtfProxyPrice(item.etfTicker, row.payload.price)), change_percent_24h: row.payload.change_percent_24h };
    },
    "indices",
    "index"
  );
}

// Migrated from Alpha Vantage's FX_DAILY to Twelve Data's /quote -
// confirmed against Twelve Data's real docs (https://twelvedata.com/docs#quote,
// fetched 2026-09-18) that /quote returns a real percent_change field for
// forex pairs, the same as it does for equities (unlike Alpha Vantage's
// CURRENCY_EXCHANGE_RATE, which had none - the original reason this used
// to read FX_DAILY's daily series instead of a plain quote). `item.symbol`
// is already Twelve Data's own "EUR/USD" format, so this reuses
// getTwelveDataQuote() directly rather than a dedicated forex function.
const FOREX_PAIRS = [
  { symbol: "EUR/USD", name: "Euro / US Dollar" },
  { symbol: "GBP/USD", name: "British Pound / US Dollar" },
  { symbol: "USD/JPY", name: "US Dollar / Japanese Yen" },
];
export async function getForexTicker(previousItems = []) {
  return fetchTickerClass(
    FOREX_PAIRS,
    previousItems,
    async (item) => {
      const quote = await getTwelveDataQuote(item.symbol);
      return { price: formatPrice(quote.price), change_percent_24h: quote.change_percent_24h };
    },
    "forex",
    "forex"
  );
}

// WTI + Brent + Natural Gas fill all 3 commodity slots - see
// fetchCommoditySeries()'s comment above for why gold/silver aren't here.
// WTI is the one of these three the header ticker also shows
// (getCommoditySnapshot('wti')) - fetchOne below reads that SAME
// market_data_cache 'wti' row instead of making its own separate Alpha
// Vantage call, so the two widgets can never disagree on oil's price the
// way they used to for the indices. Brent/Natural Gas have no ticker
// equivalent, so they're still fetched live here - nothing to unify.
const COMMODITIES_FUNCTIONS = [
  { symbol: "WTI", name: "Crude Oil (WTI)", cacheKey: "wti" },
  { symbol: "BRENT", name: "Crude Oil (Brent)", functionName: "BRENT" },
  { symbol: "NATURAL_GAS", name: "Natural Gas", functionName: "NATURAL_GAS" },
];
export async function getCommoditiesTicker(previousItems = []) {
  return fetchTickerClass(
    COMMODITIES_FUNCTIONS,
    previousItems,
    async (item) => {
      if (item.cacheKey) {
        const row = await getFreshCacheRow(item.cacheKey, COMMODITY_FRESHNESS_MS);
        if (!row) throw new Error(`No fresh cached ${item.symbol} quote (market_data_cache).`);
        return { price: row.payload.price, change_percent_24h: row.payload.change_percent_24h };
      }
      return fetchCommoditySeries(item.functionName);
    },
    "commodities",
    "commodity"
  );
}

// Individual equities - distinct from getIndicesTicker() above (ETF
// proxies for whole indices) and from getEquityTicker()'s SPY/QQQ (also
// index proxies, just fetched from Twelve Data on a different schedule).
// Migrated from Alpha Vantage's GLOBAL_QUOTE to Twelve Data's /quote,
// which already covers real-time US equities on the free Basic plan.
const STOCKS_OVERVIEW_SYMBOLS = [
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "NVDA", name: "Nvidia Corp." },
  { symbol: "MSFT", name: "Microsoft Corp." },
];
export async function getStocksOverviewTicker(previousItems = []) {
  return fetchTickerClass(
    STOCKS_OVERVIEW_SYMBOLS,
    previousItems,
    async (item) => {
      const quote = await getTwelveDataQuote(item.symbol);
      return { price: formatPrice(quote.price), change_percent_24h: quote.change_percent_24h };
    },
    "stocks",
    "stock"
  );
}

// --- Simple technical analysis, computed from real price history ---
// Crypto's history comes from CoinGecko (free, no key), fetched live here.
// Gold/WTI/SPY history comes from market_data_cache instead (see
// getCachedTechnicalSnapshot() above) - fetched on a schedule by
// refreshMarketData.js, never live from this function.

// Exported so services/shared code (and tests) can reuse the same math
// instead of reimplementing it.
export function simpleMovingAverage(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

// Textbook RSI calculation (Wilder's method, simplified). `values` is an
// array of closing prices, oldest first.
export function relativeStrengthIndex(values, period = 14) {
  if (values.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return Math.round(100 - 100 / (1 + rs));
}

// Shared by getMarketSnapshot() (crypto, below) and getCachedTechnicalSnapshot()
// (gold/WTI/SPY, above) so both produce the exact same shape from an
// ascending closes array.
function computeSnapshotFromCloses(symbol, closes, assetClass) {
  const ma50 = simpleMovingAverage(closes, Math.min(50, closes.length));
  const rsi14 = relativeStrengthIndex(closes, 14);
  const currentPrice = closes[closes.length - 1];
  const recentWindow = closes.slice(-14);
  const support = Math.min(...recentWindow);
  const resistance = Math.max(...recentWindow);

  return {
    symbol,
    // Rounded once, here, via the shared helper - every consumer (the
    // Analysis prompt, the mock provider, the frontend widget) reads this
    // already-clean number instead of needing its own rounding logic. Kept
    // as a plain number (not run through formatMarketValue) so this stays
    // a valid JSON API response for a programmatic consumer - display
    // formatting (the $, the comma grouping) happens at the point this
    // gets embedded into human-readable text (buildAnalysisPrompt).
    price: formatPrice(currentPrice),
    trend: ma50 && currentPrice > ma50 ? "Bullish" : "Bearish",
    rsi_14: rsi14,
    rsi_note: rsi14 >= 70 ? "Overbought zone" : rsi14 <= 30 ? "Oversold zone" : "Neutral zone",
    support: formatPrice(support),
    resistance: formatPrice(resistance),
    assetClass,
    disclaimer: "For informational purposes only - not financial advice.",
  };
}

// GET a factual, informational technical snapshot for one coin (default BTC).
// This is intentionally descriptive (trend/levels/RSI), never a buy/sell call.
export async function getMarketSnapshot(coinId = "bitcoin") {
  const history = await getJson(
    `${COINGECKO}/coins/${coinId}/market_chart?vs_currency=usd&days=60&interval=daily`
  );
  const closes = history.prices.map(([, price]) => price);
  return computeSnapshotFromCloses(coinId === "bitcoin" ? "BTC/USD" : coinId, closes, "crypto");
}

function requireStocksApiKey() {
  const key = process.env.STOCKS_DATA_API_KEY;
  if (!key) throw new Error("STOCKS_DATA_API_KEY is not set.");
  return key;
}
