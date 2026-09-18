// MARKET_DATA_DRY_RUN=true support for twelveData.js and alphaVantage.js -
// lets local development exercise the whole market-data pipeline
// (refreshMarketData.js -> market_data_cache -> prices.js ->
// routes/market.js -> the frontend ticker/snapshot) without ever making a
// real HTTP call to either provider, so testing locally can never spend
// the production site's real daily quota. See backend/.env.example, where
// this defaults to true for a fresh local checkout.
export function isMarketDataDryRun() {
  return process.env.MARKET_DATA_DRY_RUN === "true";
}

// One canned "success" quote per Twelve Data symbol, plausible prices -
// enough to render the header ticker, Markets Overview strip, and
// Analysis job end to end in dry-run mode. All of these go through the
// exact same getTwelveDataQuote() (twelveData.js) regardless of asset
// class - confirmed against Twelve Data's real docs
// (https://twelvedata.com/docs#quote, fetched 2026-09-18) that /quote
// returns the identical {close, percent_change, ...} shape for equities,
// forex pairs, and metals (XAU/USD) alike, so one fixture shape covers
// all of them.
//
// XAU/USD (gold) replaced GLD's ETF quote here as part of migrating Gold
// off the GLD-ETF-proxy approach entirely - Twelve Data's XAU/USD is real
// spot gold, catalogued as a forex pair (not gated behind their paid
// commodities tier the way WTI/Brent/Natural Gas are), so there's no
// ETF-vs-spot mismatch left to guard against for gold specifically. ~4,370
// matches the real spot gold level referenced throughout this project's
// price-mismatch guardrail work (see runAnalysis.js/prompts.js).
export const DRY_RUN_TWELVE_DATA_QUOTES = {
  SPY: { close: "758.42", percent_change: "0.34" },
  QQQ: { close: "612.15", percent_change: "-0.21" },
  DIA: { close: "518.35", percent_change: "0.60" },
  "XAU/USD": { close: "4370.50", percent_change: "0.35" },
  "EUR/USD": { close: "1.15020", percent_change: "0.09" },
  "GBP/USD": { close: "1.34410", percent_change: "-0.19" },
  "USD/JPY": { close: "155.96000", percent_change: "-0.20" },
  AAPL: { close: "337.00", percent_change: "1.4" },
  NVDA: { close: "219.34", percent_change: "2.5" },
  MSFT: { close: "497.75", percent_change: "1.5" },
};

// Ascending, oldest first - a real WTI GLOBAL commodity series shape, used
// as-is for the "quote" job (derives price/change from the last two
// points, same as the real parsing code does). WTI stays on Alpha Vantage
// (see alphaVantage.js's comment) - Twelve Data's true "commodities"
// catalog (WTI/Brent/Natural Gas, as opposed to XAU/USD's forex
// categorization above) is a paid Grow-plan feature per their pricing
// page, unlike gold.
export const DRY_RUN_WTI_SERIES_BODY = {
  data: [
    { date: "2026-09-10", value: "94.10" },
    { date: "2026-09-11", value: "95.02" },
    { date: "2026-09-12", value: "95.88" },
    { date: "2026-09-13", value: "96.40" },
    { date: "2026-09-14", value: "94.20" },
    { date: "2026-09-15", value: "97.26" },
  ],
};

// Deliberately the one canned response that exercises the "treated as a
// failure, not data" path (checkAlphaVantageError() in alphaVantage.js) -
// Alpha Vantage's real rate-limit body shape, HTTP 200. Wired to WTI's
// daily history fetch specifically (getWtiCloses() - an arbitrary pick,
// any single fetch would do) so dry-run testing always covers this branch
// without needing to actually exhaust a real key's daily budget. Every
// other canned response in this file is a "success."
export const DRY_RUN_WTI_HISTORY_RATE_LIMIT_BODY = {
  Note: "Thank you for using Alpha Vantage! This is a canned MARKET_DATA_DRY_RUN response simulating the real rate-limit body shape - no real request was made and no real quota was spent.",
};

// Twelve Data's real /time_series shape (confirmed against
// https://twelvedata.com/docs#time-series): { values: [...], status }, an
// array of { datetime, close, ... } NEWEST first - the opposite order from
// Alpha Vantage's date-keyed object, which is why getTwelveDataCloses()
// (twelveData.js) reverses it before returning, matching this codebase's
// existing oldest-first convention everywhere else.
//
// 21 closes each - enough for simpleMovingAverage/relativeStrengthIndex
// (prices.js) to compute real, non-null trend/RSI/support/resistance
// numbers in dry-run mode, not just a bare price. Reuses the exact same
// relative day-to-day move sequence for both symbols (proportionally
// scaled to each one's actual price level) purely for convenience - real
// data obviously wouldn't correlate the two like this.
function twelveDataCloses(startPrice, dailyDeltas) {
  const closes = [startPrice];
  for (const delta of dailyDeltas) closes.push(Number((closes[closes.length - 1] + delta).toFixed(2)));
  const today = new Date("2026-09-15T00:00:00Z");
  const values = closes.map((close, i) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - (closes.length - 1 - i));
    return { datetime: date.toISOString().slice(0, 10), close: String(close) };
  });
  return { values: values.reverse(), status: "ok" }; // newest first, matching the real API
}

const RELATIVE_DAILY_DELTAS = [
  -3.45, 2.1, -6.32, 1.63, -6.99, -1.42, 2.41, -0.81, -5.67, 2.35, -1.19, -4.4, -1.83, -3.29, 6.48, 0.03,
  4.8, 4.07, -1.58, 1.31,
];

export const DRY_RUN_TWELVE_DATA_TIME_SERIES = {
  SPY: twelveDataCloses(
    757.39,
    RELATIVE_DAILY_DELTAS.map((d) => Number((d * (757.39 / 410.22)).toFixed(2)))
  ),
  "XAU/USD": twelveDataCloses(
    4370.5,
    RELATIVE_DAILY_DELTAS.map((d) => Number((d * (4370.5 / 410.22)).toFixed(2)))
  ),
};
