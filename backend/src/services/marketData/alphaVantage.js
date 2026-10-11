import {
  isMarketDataDryRun,
  DRY_RUN_WTI_SERIES_BODY,
  DRY_RUN_WTI_HISTORY_RATE_LIMIT_BODY,
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

async function fetchAlphaVantageBody(buildUrl, cannedBody) {
  if (isMarketDataDryRun()) return cannedBody;
  const key = requireApiKey();
  return throttledGetJson(buildUrl(key));
}

function checkAlphaVantageError(data, context) {
  const message = data["Note"] || data["Information"] || data["Error Message"];
  if (message) throw new Error(`Alpha Vantage ${context}: ${message}`);
}

function parseWtiSeries(data) {
  checkAlphaVantageError(data, "WTI");
  if (!Array.isArray(data.data)) {
    throw new Error("Alpha Vantage WTI: unexpected response shape.");
  }
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
  const data = await fetchAlphaVantageBody(
    (key) => `${ALPHA_VANTAGE}?function=WTI&interval=daily&apikey=${key}`,
    DRY_RUN_WTI_HISTORY_RATE_LIMIT_BODY
  );
  const sorted = parseWtiSeries(data);
  return sorted.map((entry) => entry.value);
}
