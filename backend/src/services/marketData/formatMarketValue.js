export function formatMarketValue(value, assetClass) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? "");

  switch (assetClass) {
    case "index": {
      const rounded = Math.round(num * 10) / 10;
      const decimals = Number.isInteger(rounded) ? 0 : 1;
      return rounded.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    case "forex":
      return num.toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: 5 });
    case "commodity":
    case "crypto":
    case "stock":
    default:
      return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
