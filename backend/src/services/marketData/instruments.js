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
export const INSTRUMENTS = {
  gold: { display: "Gold", tvSymbol: "XAUUSD", unit: "USD per troy ounce", assetClass: "commodity" },
  silver: { display: "Silver", tvSymbol: "XAGUSD", unit: "USD per troy ounce", assetClass: "commodity" },
  oil_wti: { display: "Oil (WTI)", tvSymbol: "USOIL", unit: "USD per barrel", assetClass: "commodity" },
  sp500: { display: "S&P 500", tvSymbol: "SPX", unit: "index points", assetClass: "index" },
  nasdaq: { display: "Nasdaq", tvSymbol: "NDQ", unit: "index points", assetClass: "index" },
  dow: { display: "Dow Jones", tvSymbol: "DJI", unit: "index points", assetClass: "index" },
  bitcoin: { display: "Bitcoin", ticker: "BTC", tvSymbol: "BTCUSD", unit: "USD", assetClass: "crypto" },
  ethereum: { display: "Ethereum", ticker: "ETH", tvSymbol: "ETHUSD", unit: "USD", assetClass: "crypto" },
};

// A short block the AI prompt can quote verbatim, so the model always has
// the correct instrument name/unit in front of it instead of guessing (or
// picking up an ETF ticker mentioned in a source headline and treating its
// share price as the asset's price).
export function instrumentReferenceText() {
  return Object.values(INSTRUMENTS)
    .map((i) => `- ${i.display} (like TradingView's ${i.tvSymbol}): quoted in ${i.unit}. Never substitute a related ETF or fund's share price for this (e.g. GLD, SPY, DIA, USO) - they trade at a different price than the instrument itself.`)
    .join("\n");
}
