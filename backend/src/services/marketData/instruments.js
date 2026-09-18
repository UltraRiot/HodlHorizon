// Canonical instrument reference for anything the site quotes a price for
// besides a plain stock ticker or a crypto coin (which are unambiguous
// already). Every other part of the app - the homepage ticker, the Market
// Snapshot widget, and anything the AI engine writes - reads from this file
// so they all describe the SAME real-world instrument the same way
// TradingView and other trading platforms do: the spot/futures/index
// reading, never a fund's share price standing in for it.
//
// Why this exists: a commodity or index ETF (GLD for gold, SPY for the
// S&P 500, DIA for the Dow, USO for oil...) does not trade at the same
// price as the thing it tracks. GLD represents roughly 1/10th of a troy
// ounce of gold, and that ratio has drifted to about 1/10.9 over time as
// the fund's expense ratio eats into the metal backing each share. So an
// article that says "Gold (GLD) is at $398" is technically describing a
// real number, but it's off by more than 10x from the number every trader,
// price chart, and financial news outlet means when they say "gold is at
// $4,346" - which reads as a bug (and rightly confuses a reader checking
// a real chart) even though the underlying figure is correct for the ETF.
//
// Keep this list to instruments the site actually surfaces prices for.
// `tvSymbol` matches the symbol you'd search for on TradingView.
//
// `etfProxy` (index instruments only): unlike GLD's drifting ~1/10.9 ratio
// to spot gold (see above - deliberately NOT given one here, real gold
// price mismatches are instead caught by comparing against the source
// text, see findCommodityPriceMismatch in services/rss/scanAndGenerate.js),
// SPY/QQQ/DIA are structured to track a stable, well-known multiple of
// their index with no comparable long-term drift: SPY pays out dividends
// each quarter rather than compounding them into share price, so its
// ~1/10th ratio to the S&P 500 doesn't erode the way GLD's physical gold
// backing does. QQQ (post its March 2000 2-for-1 split) tracks roughly
// 1/41st of the Nasdaq-100, and DIA was structured from inception to track
// 1/100th of the (price-weighted) Dow. Multiplying the ETF's real,
// currently-cached price by this factor gives real index points - not a
// second guess at the number, just unit conversion of the one real number
// this codebase can actually fetch (Alpha Vantage/Twelve Data have no bare
// index quote on the free tier). See services/marketData/prices.js for
// where this gets applied.
export const INSTRUMENTS = {
  gold: { display: "Gold", tvSymbol: "XAUUSD", unit: "USD per troy ounce", assetClass: "commodity" },
  silver: { display: "Silver", tvSymbol: "XAGUSD", unit: "USD per troy ounce", assetClass: "commodity" },
  oil_wti: { display: "Oil (WTI)", tvSymbol: "USOIL", unit: "USD per barrel", assetClass: "commodity" },
  sp500: { display: "S&P 500", tvSymbol: "SPX", unit: "index points", assetClass: "index", etfProxy: { ticker: "SPY", multiplier: 10 } },
  nasdaq: { display: "Nasdaq", tvSymbol: "NDQ", unit: "index points", assetClass: "index", etfProxy: { ticker: "QQQ", multiplier: 41 } },
  dow: { display: "Dow Jones", tvSymbol: "DJI", unit: "index points", assetClass: "index", etfProxy: { ticker: "DIA", multiplier: 100 } },
  bitcoin: { display: "Bitcoin", ticker: "BTC", tvSymbol: "BTCUSD", unit: "USD", assetClass: "crypto" },
  ethereum: { display: "Ethereum", ticker: "ETH", tvSymbol: "ETHUSD", unit: "USD", assetClass: "crypto" },
};

// ticker (e.g. "SPY") -> the INSTRUMENTS entry it's a proxy for. Built once
// from the etfProxy fields above rather than a second hand-written map, so
// there's exactly one place (INSTRUMENTS) that knows which ETF stands in
// for which real instrument.
const INSTRUMENT_BY_ETF_TICKER = Object.fromEntries(
  Object.values(INSTRUMENTS)
    .filter((i) => i.etfProxy)
    .map((i) => [i.etfProxy.ticker, i])
);

// Converts a real, currently-cached ETF share price into the real index
// points it stands in for. Returns null for a ticker with no known proxy
// relationship (that ticker's raw price should be used as-is).
export function convertEtfProxyPrice(ticker, rawPrice) {
  const instrument = INSTRUMENT_BY_ETF_TICKER[ticker];
  if (!instrument) return null;
  return rawPrice * instrument.etfProxy.multiplier;
}

// The real instrument an ETF ticker proxies for (display name/assetClass/
// etc.), or null if it isn't one of the proxies this registry knows about.
export function instrumentForEtfTicker(ticker) {
  return INSTRUMENT_BY_ETF_TICKER[ticker] || null;
}

// A short block the AI prompt can quote verbatim, so the model always has
// the correct instrument name/unit in front of it instead of guessing (or
// picking up an ETF ticker mentioned in a source headline and treating its
// share price as the asset's price).
export function instrumentReferenceText() {
  return Object.values(INSTRUMENTS)
    .map((i) => `- ${i.display} (like TradingView's ${i.tvSymbol}): quoted in ${i.unit}. Never substitute a related ETF or fund's share price for this (e.g. GLD, SPY, DIA, USO) - they trade at a different price than the instrument itself.`)
    .join("\n");
}
