// Twelve Data client - real-time quotes for SPY and QQQ (S&P 500 / Nasdaq
// 100 ETF proxies), used only by the scheduled job in refreshMarketData.js.
// Free tier: 800 credits/day, 1 quote call = 1 credit.
//
// One attempt per call, no retry loop - a failed attempt just means the
// next scheduled run tries again; retrying in a loop here would burn
// through the daily credit budget on a provider that's already down.
import { isMarketDataDryRun, DRY_RUN_TWELVE_DATA_QUOTES } from "./dryRunFixtures.js";

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
