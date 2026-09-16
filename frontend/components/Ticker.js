import { formatPrice } from "../lib/formatPrice";

export default function Ticker({ crypto = [], stocks = [] }) {
  const items = [
    ...crypto.map((c) => ({ symbol: c.symbol, price: c.price, change: c.change_percent_24h })),
    ...stocks.map((s) => ({ symbol: s.symbol, price: s.price, change: s.change_percent_24h })),
  ];

  if (items.length === 0) return null;

  return (
    <div
      className="ticker-bar"
      style={{
        display: "flex",
        gap: 44,
        padding: "11px 48px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        overflowX: "auto",
      }}
    >
      {items.map((item) => (
        <div key={item.symbol} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13, whiteSpace: "nowrap" }}>
          <span style={{ fontWeight: 700 }}>{item.symbol}</span>
          <span style={{ color: "var(--text-dim)" }}>{formatPrice(item.price)}</span>
          <span className={item.change >= 0 ? "up" : "down"}>
            {item.change >= 0 ? "▲" : "▼"} {Math.abs(item.change || 0).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}
