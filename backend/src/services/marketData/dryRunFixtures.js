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

// One canned "success" quote per equity symbol, plausible prices - enough
// to render the header ticker end to end in dry-run mode.
export const DRY_RUN_TWELVE_DATA_QUOTES = {
  SPY: { close: "758.42", percent_change: "0.34" },
  QQQ: { close: "612.15", percent_change: "-0.21" },
  DIA: { close: "518.35", percent_change: "0.60" },
};

export const DRY_RUN_GOLD_QUOTE_BODY = {
  "Global Quote": { "05. price": "394.15", "10. change percent": "0.33%" },
};

// Ascending, oldest first - a real WTI GLOBAL commodity series shape, used
// as-is for the "quote" job (derives price/change from the last two
// points, same as the real parsing code does).
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
// other canned response above/below is a "success."
export const DRY_RUN_WTI_HISTORY_RATE_LIMIT_BODY = {
  Note: "Thank you for using Alpha Vantage! This is a canned MARKET_DATA_DRY_RUN response simulating the real rate-limit body shape - no real request was made and no real quota was spent.",
};

// 20 ascending daily closes each - enough for simpleMovingAverage/
// relativeStrengthIndex (prices.js) to compute real, non-null trend/RSI/
// support/resistance numbers in dry-run mode, not just a bare price.
function dailyCloses(startPrice, dailyDeltas) {
  const closes = [startPrice];
  for (const delta of dailyDeltas) closes.push(Number((closes[closes.length - 1] + delta).toFixed(2)));
  const today = new Date("2026-09-15T00:00:00Z");
  const series = {};
  closes.forEach((close, i) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - (closes.length - 1 - i));
    series[date.toISOString().slice(0, 10)] = { "4. close": String(close) };
  });
  return { "Time Series (Daily)": series };
}

export const DRY_RUN_GOLD_DAILY_BODY = dailyCloses(410.22, [
  -3.45, 2.1, -6.32, 1.63, -6.99, -1.42, 2.41, -0.81, -5.67, 2.35, -1.19, -4.4, -1.83, -3.29, 6.48, 0.03,
  4.8, 4.07, -1.58, 1.31,
]);

export const DRY_RUN_SPY_DAILY_BODY = dailyCloses(757.39, [
  4.44, -2.99, -3.56, -1.34, -4.81, -0.34, 1.06, -2.25, 4.01, -1.98, -3.19, -4.61, 6.29, -3.94, -1.73,
  -4.57, 5.7, -3.34, -3.53, 1.03,
]);
