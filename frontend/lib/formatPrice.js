// The one shared place a price number gets rounded for display on the
// frontend - every component that shows a price (Ticker, Market Snapshot
// widget, ...) calls this instead of writing its own rounding logic.
// 2 decimals covers anything $1 or over; sub-$1 assets (some tokens trade at
// fractions of a cent) get more decimals so small values don't collapse to
// "0.00". Returns a plain formatted number string (no "$" prefix) - callers
// that show a currency symbol keep prefixing it themselves, same as before.
export function formatPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? "");
  const decimals = Math.abs(num) >= 1 ? 2 : 6;
  return num.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
