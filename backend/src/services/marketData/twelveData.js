import { isMarketDataDryRun, DRY_RUN_TWELVE_DATA_QUOTES, DRY_RUN_TWELVE_DATA_TIME_SERIES } from "./dryRunFixtures.js";

const TWELVE_DATA = "https://api.twelvedata.com";

async function fetchQuoteBody(symbol) {
  if (isMarketDataDryRun()) {
    const canned = DRY_RUN_TWELVE_DATA_QUOTES[symbol];
    return canned
      ? { ok: true, status: 200, data: canned }
      : { ok: false, status: 404, data: { status: "error", message: `No canned MARKET_DATA_DRY_RUN quote for symbol ${symbol}.` } };
  }

  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error("TWELVEDATA_API_KEY is not set.");
  const res = await fetch(`${TWELVE_DATA}/quote?symbol=${symbol}&apikey=${key}`);
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

export async function getTwelveDataQuote(symbol) {
  const { ok, status, data } = await fetchQuoteBody(symbol);

  if (!ok || data.status === "error") {
    throw new Error(`Twelve Data quote ${symbol}: ${data.message || `HTTP ${status}`}`);
  }
  if (data.close == null || data.percent_change == null) {
    throw new Error(`Twelve Data quote ${symbol}: unexpected response shape.`);
  }

  return {
    price: Number(data.close),
    change_percent_24h: Number(data.percent_change),
  };
}

async function fetchTimeSeriesBody(symbol) {
  if (isMarketDataDryRun()) {
    const canned = DRY_RUN_TWELVE_DATA_TIME_SERIES[symbol];
    return canned
      ? { ok: true, status: 200, data: canned }
      : { ok: false, status: 404, data: { status: "error", message: `No canned MARKET_DATA_DRY_RUN time_series for symbol ${symbol}.` } };
  }

  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error("TWELVEDATA_API_KEY is not set.");
  const res = await fetch(`${TWELVE_DATA}/time_series?symbol=${symbol}&interval=1day&outputsize=60&apikey=${key}`);
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

export async function getTwelveDataCloses(symbol) {
  const { ok, status, data } = await fetchTimeSeriesBody(symbol);

  if (!ok || data.status === "error") {
    throw new Error(`Twelve Data time_series ${symbol}: ${data.message || `HTTP ${status}`}`);
  }
  if (!Array.isArray(data.values)) {
    throw new Error(`Twelve Data time_series ${symbol}: unexpected response shape.`);
  }

  return data.values.map((v) => Number(v.close)).reverse();
}
