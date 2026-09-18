// Twelve Data client - the primary market-data provider for this codebase
// (Alpha Vantage, previously the primary provider, is now a narrow
// fallback only for WTI/Brent/Natural Gas - see alphaVantage.js). Used by
// refreshMarketData.js (SPY/QQQ/DIA/gold quotes and gold/SPY history) and
// prices.js (the Markets Overview strip's forex and individual-stock
// columns). Free "Basic" tier: 800 credits/day, 1 call = 1 credit for
// both /quote and /time_series, confirmed against Twelve Data's real docs
// (https://twelvedata.com/docs, fetched 2026-09-18).
//
// getTwelveDataQuote() is genuinely universal across asset classes - /quote
// returns the identical {close, percent_change, ...} shape for an equity
// (SPY), a forex pair (EUR/USD), or a metal spot symbol (XAU/USD), so this
// one function backs all of them; callers just pass the right symbol
// string ("AAPL", "EUR/USD", "XAU/USD").
//
// One attempt per call, no retry loop - a failed attempt just means the
// next scheduled run tries again; retrying in a loop here would burn
// through the daily credit budget on a provider that's already down.
import { isMarketDataDryRun, DRY_RUN_TWELVE_DATA_QUOTES, DRY_RUN_TWELVE_DATA_TIME_SERIES } from "./dryRunFixtures.js";

const TWELVE_DATA = "https://api.twelvedata.com";

// The only place that decides real vs. canned - MARKET_DATA_DRY_RUN=true
// short-circuits before any key check or network call, so dry-run testing
// works even with no TWELVEDATA_API_KEY configured at all. Everything
// downstream (getTwelveDataQuote's validation) runs identically either way.
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

// Twelve Data returns HTTP 200 even for an invalid key or an exhausted
// credit budget - the body carries {"status":"error","code":...,"message":...}
// instead of an HTTP error status, so that has to be checked explicitly
// alongside res.ok rather than trusting the HTTP status alone.
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

// TIME_SERIES equivalent - used for SPY and Gold (XAU/USD) daily history,
// needed by the Analysis job's SMA/RSI/support-resistance calc
// (prices.js's getCachedTechnicalSnapshot()). Confirmed against Twelve
// Data's real docs (https://twelvedata.com/docs#time-series, fetched
// 2026-09-18): /time_series works identically for stock and forex/metal
// symbols on the free Basic plan (1 credit/call, same as /quote) - this
// codebase's own comment previously claimed "Twelve Data only supplies a
// real-time quote for SPY, not history," which the real docs don't
// support; that claim is retired along with the Alpha Vantage SPY-history
// fetch it justified.
async function fetchTimeSeriesBody(symbol) {
  if (isMarketDataDryRun()) {
    const canned = DRY_RUN_TWELVE_DATA_TIME_SERIES[symbol];
    return canned
      ? { ok: true, status: 200, data: canned }
      : { ok: false, status: 404, data: { status: "error", message: `No canned MARKET_DATA_DRY_RUN time_series for symbol ${symbol}.` } };
  }

  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error("TWELVEDATA_API_KEY is not set.");
  // outputsize=60 gives enough room for a full 50-day SMA (see
  // simpleMovingAverage() in prices.js) with margin, same purpose Alpha
  // Vantage's outputsize=compact (~100 points) served before.
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

  // Twelve Data returns newest-first; this codebase's oldest-first
  // convention (matching the Alpha Vantage client it's replacing here)
  // is preserved by reversing once, here, rather than at every call site.
  return data.values.map((v) => Number(v.close)).reverse();
}
