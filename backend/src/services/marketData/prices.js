import { query } from "../../db.js";
import { convertEtfProxyPrice, instrumentForEtfTicker } from "./instruments.js";
import { getTwelveDataQuote } from "./twelveData.js";

const COINGECKO = "https://api.coingecko.com/api/v3";
const ALPHA_VANTAGE = "https://www.alphavantage.co/query";

export async function getJson(url) {
  const headers = {};
  if (url.startsWith(COINGECKO) && process.env.COINGECKO_API_KEY) {
    headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Request to ${url} failed: ${res.status}`);
  return res.json();
}

export function formatPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  const decimals = Math.abs(num) >= 1 ? 2 : 6;
  return Number(num.toFixed(decimals));
}

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

async function getFreshCacheRow(assetKey, maxAgeMs) {
  const { rows } = await query("SELECT * FROM market_data_cache WHERE asset_key = $1", [assetKey]);
  const row = rows[0];
  if (!row || !row.fetch_succeeded) return null;
  if (Date.now() - new Date(row.fetched_at).getTime() > maxAgeMs) return null;
  return row;
}

const EQUITY_FRESHNESS_MS = 3 * 60 * 60 * 1000;
const COMMODITY_FRESHNESS_MS = 12 * 60 * 60 * 1000;
const HISTORY_FRESHNESS_MS = 30 * 60 * 60 * 1000;

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

const HISTORY_CACHE_KEYS = { gold: "gold_history", wti: "wti_history", spy: "spy_history" };
const HISTORY_LABELS = { gold: "Gold", wti: "Oil (WTI)", spy: "S&P 500" };
const HISTORY_ASSET_CLASSES = { gold: "commodity", wti: "commodity", spy: "index" };

export async function getCachedTechnicalSnapshot(key) {
  const cacheKey = HISTORY_CACHE_KEYS[key];
  if (!cacheKey) throw new Error(`Unknown cached snapshot key: ${key}`);
  const row = await getFreshCacheRow(cacheKey, HISTORY_FRESHNESS_MS);
  if (!row) return null;
  const closes = key === "spy" ? row.payload.closes.map((c) => convertEtfProxyPrice("SPY", c)) : row.payload.closes;
  return computeSnapshotFromCloses(HISTORY_LABELS[key], closes, HISTORY_ASSET_CLASSES[key]);
}

function checkAlphaVantageError(data, context) {
  const message = data["Note"] || data["Information"] || data["Error Message"];
  if (message) throw new Error(`Alpha Vantage ${context}: ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const ALPHA_VANTAGE_CALL_SPACING_MS = 1100;
let nextAlphaVantageSlot = 0;
async function throttledAlphaVantageCall(makeRequest) {
  const now = Date.now();
  const slot = Math.max(now, nextAlphaVantageSlot);
  nextAlphaVantageSlot = slot + ALPHA_VANTAGE_CALL_SPACING_MS;
  if (slot > now) await sleep(slot - now);
  return makeRequest();
}

async function fetchCommoditySeries(functionName) {
  const key = requireStocksApiKey();
  const data = await throttledAlphaVantageCall(() => getJson(`${ALPHA_VANTAGE}?function=${functionName}&interval=daily&apikey=${key}`));
  checkAlphaVantageError(data, functionName);
  if (!Array.isArray(data.data)) {
    throw new Error(`Alpha Vantage ${functionName}: unexpected response shape.`);
  }
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
      return { price: formatPrice(convertEtfProxyPrice(item.etfTicker, row.payload.price)), change_percent_24h: row.payload.change_percent_24h };
    },
    "indices",
    "index"
  );
}

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

export function simpleMovingAverage(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

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

export function computeSnapshotFromCloses(symbol, closes, assetClass) {
  const ma50 = simpleMovingAverage(closes, Math.min(50, closes.length));
  const rsi14 = relativeStrengthIndex(closes, 14);
  const currentPrice = closes[closes.length - 1];
  const priorWindow = closes.length > 1 ? closes.slice(-15, -1) : closes;
  const support = Math.min(...priorWindow);
  const resistance = Math.max(...priorWindow);

  return {
    symbol,
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
