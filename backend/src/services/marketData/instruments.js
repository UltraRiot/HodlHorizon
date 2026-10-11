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

const INSTRUMENT_BY_ETF_TICKER = Object.fromEntries(
  Object.values(INSTRUMENTS)
    .filter((i) => i.etfProxy)
    .map((i) => [i.etfProxy.ticker, i])
);

export function convertEtfProxyPrice(ticker, rawPrice) {
  const instrument = INSTRUMENT_BY_ETF_TICKER[ticker];
  if (!instrument) return null;
  return rawPrice * instrument.etfProxy.multiplier;
}

export function instrumentForEtfTicker(ticker) {
  return INSTRUMENT_BY_ETF_TICKER[ticker] || null;
}

export function instrumentReferenceText() {
  return Object.values(INSTRUMENTS)
    .map((i) => `- ${i.display} (like TradingView's ${i.tvSymbol}): quoted in ${i.unit}. Never substitute a related ETF or fund's share price for this (e.g. GLD, SPY, DIA, USO) - they trade at a different price than the instrument itself.`)
    .join("\n");
}
