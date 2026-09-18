// The one place a market price becomes human-readable TEXT on the backend
// - AI prompt text (buildAnalysisPrompt) and admin-facing review notes
// (scanAndGenerate.js's price-mismatch notes), never a JSON API response
// (those stay plain numbers - see getEquityTicker() etc. in prices.js -
// so a programmatic consumer never has to parse a formatted string back
// into a number). Takes the exact same `assetClass` string already on
// every INSTRUMENTS entry (instruments.js) rather than a second
// classification system.
//
// This repo has no shared module system between frontend/ and backend/
// (two independent npm projects, no workspace) - frontend/lib/
// formatMarketValue.js is the browser-side twin of this exact function.
// If you change a rule here, change it there too.
export function formatMarketValue(value, assetClass) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? "");

  switch (assetClass) {
    case "index": {
      // 0 decimals for a whole number, 1 if there's a meaningful
      // fractional part - "7,674" not "7,674.0", but "7,674.3" stays.
      const rounded = Math.round(num * 10) / 10;
      const decimals = Number.isInteger(rounded) ? 0 : 1;
      return rounded.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    case "forex":
      // Fixed at 5 decimals (standard pip precision for a major pair) -
      // no dollar sign, since neither currency in the pair is implied.
      return num.toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: 5 });
    case "commodity":
    case "crypto":
    case "stock":
    default:
      return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
