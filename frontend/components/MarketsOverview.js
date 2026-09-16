import { formatPrice } from "../lib/formatPrice";

// One column per asset class, in display order. tagVar points at the CSS
// custom property (globals.css :root) used for that column's 2px accent
// bar - --tag-forex is new (added alongside this component), the other
// four already existed for the category chips.
const COLUMNS = [
  { key: "indices", label: "Indices", tagVar: "--tag-index" },
  { key: "forex", label: "Forex", tagVar: "--tag-forex" },
  { key: "commodities", label: "Commodities", tagVar: "--tag-comm" },
  { key: "stocks", label: "Stocks", tagVar: "--tag-stocks" },
  { key: "crypto", label: "Crypto", tagVar: "--tag-crypto" },
];

// Full-width strip between <Ticker /> and the homepage's feed/sidebar grid
// (see pages/index.js) - backed by GET /api/market/overview. Renders all 5
// columns with up to 3 instruments each; the 3rd row is hidden by CSS
// (globals.css) at mobile widths rather than fetched separately, so the
// same markup serves both the desktop 5-column row and the mobile
// horizontally-scrolling card strip.
export default function MarketsOverview({ overview }) {
  if (!overview) return null;
  const hasAnyData = COLUMNS.some((col) => (overview[col.key] || []).length > 0);
  if (!hasAnyData) return null;

  return (
    <div className="container" style={{ padding: "20px 48px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <h2
          className="serif"
          style={{ margin: 0, fontSize: 13, textTransform: "uppercase", letterSpacing: 1.3, color: "var(--text-mute)", fontWeight: 600 }}
        >
          Markets Overview
        </h2>
        {/* Indices/forex/commodities/stocks refresh a few times a day
            (Alpha Vantage's free tier is 25 requests/day - see
            backend/src/services/marketData/overviewCache.js), not live -
            this is what's honest about that instead of implying a
            real-time feed. Crypto (CoinGecko) still refreshes every 60s
            regardless. */}
        {overview.last_updated && (
          <span style={{ fontSize: 11, color: "var(--text-mute)" }}>
            Indices/Forex/Commodities/Stocks as of{" "}
            {new Date(overview.last_updated).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      <div className="markets-overview-grid">
        {COLUMNS.map((col) => (
          <MarketColumn key={col.key} label={col.label} tagVar={col.tagVar} items={overview[col.key] || []} />
        ))}
      </div>
    </div>
  );
}

function MarketColumn({ label, tagVar, items }) {
  return (
    <div className="markets-overview-col" style={{ "--col-accent": `var(${tagVar})` }}>
      <p className="markets-overview-col-label">{label}</p>
      {items.slice(0, 3).map((item) => (
        // A stale fallback value (its own Alpha Vantage call failed this
        // refresh, so it's the last time it actually succeeded - see
        // fetchTickerClass() in backend/prices.js) still gets shown rather
        // than disappearing; the tooltip is what's honest about how old it
        // actually is.
        <div
          key={item.symbol}
          className="markets-overview-row"
          title={
            item.fetched_at
              ? `${item.name || item.symbol} - as of ${new Date(item.fetched_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`
              : item.name || item.symbol
          }
        >
          <span className="markets-overview-symbol">{item.symbol}</span>
          <span className="markets-overview-price">{formatPrice(item.price)}</span>
          {item.change_percent_24h == null ? (
            // Forex is rate-only (no change% - a daily-change call per pair
            // isn't in the Alpha Vantage budget, see fetchCurrencyRate() in
            // prices.js) - a muted dash instead of a fabricated delta.
            <span style={{ color: "var(--text-mute)" }}>—</span>
          ) : (
            <span className={item.change_percent_24h >= 0 ? "up" : "down"}>
              {item.change_percent_24h >= 0 ? "▲" : "▼"} {Math.abs(item.change_percent_24h).toFixed(1)}%
            </span>
          )}
        </div>
      ))}
      {items.length === 0 && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-mute)" }}>No data yet.</p>
      )}
    </div>
  );
}
