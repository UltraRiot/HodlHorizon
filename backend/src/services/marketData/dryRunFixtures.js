export function isMarketDataDryRun() {
  return process.env.MARKET_DATA_DRY_RUN === "true";
}

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

export const DRY_RUN_WTI_HISTORY_RATE_LIMIT_BODY = {
  Note: "Thank you for using Alpha Vantage! This is a canned MARKET_DATA_DRY_RUN response simulating the real rate-limit body shape - no real request was made and no real quota was spent.",
};

function twelveDataCloses(startPrice, dailyDeltas) {
  const closes = [startPrice];
  for (const delta of dailyDeltas) closes.push(Number((closes[closes.length - 1] + delta).toFixed(2)));
  const today = new Date("2026-09-15T00:00:00Z");
  const values = closes.map((close, i) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - (closes.length - 1 - i));
    return { datetime: date.toISOString().slice(0, 10), close: String(close) };
  });
  return { values: values.reverse(), status: "ok" };
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
