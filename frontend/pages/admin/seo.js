import { useEffect, useState } from "react";
import AdminLayout from "../../components/AdminLayout";
import { adminFetch } from "../../lib/api";

function timeAgo(dateString) {
  if (!dateString) return "Never reviewed";
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function AdminSeo() {
  const [seo, setSeo] = useState(null);
  const [evergreen, setEvergreen] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  function load() {
    adminFetch("/api/admin/seo/status").then(setSeo);
    adminFetch("/api/admin/seo/evergreen").then(setEvergreen);
  }

  useEffect(load, []);

  async function refreshNow() {
    setRefreshing(true);
    try {
      const result = await adminFetch("/api/admin/seo/refresh-evergreen-now", { method: "POST" });
      setLastResult(result);
      load();
    } finally {
      setRefreshing(false);
    }
  }

  if (!seo) return <AdminLayout title="SEO"><p style={{ color: "var(--text-mute)" }}>Loading…</p></AdminLayout>;

  return (
    <AdminLayout title="SEO">
      <div className="card" style={{ maxWidth: 480, marginBottom: 24 }}>
        <div className="serif" style={{ fontSize: 30, fontWeight: 600, color: "var(--gold)", marginBottom: 18 }}>
          {seo.score} / 100
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {seo.checks.map((c) => (
            <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
              <span style={{ color: c.pass ? "var(--green)" : "var(--red)", fontWeight: 700 }}>{c.pass ? "✓" : "✗"}</span>
              <span style={{ color: "var(--text-dim)" }}>{c.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 10 }}>
          <h3 className="serif" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            Evergreen SEO (Glossary + static pages)
          </h3>
          <button
            onClick={refreshNow}
            disabled={refreshing}
            style={{ padding: "8px 14px", borderRadius: 7, background: "var(--gold-fill)", color: "#1a1508", fontWeight: 600, border: "none", fontSize: 13 }}
          >
            {refreshing ? "Checking…" : "Check now"}
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-mute)", margin: "0 0 16px" }}>
          Refreshed automatically every ~30 days, or sooner if an item's score drops below 80. Never touches
          article body content - only seo_title/seo_description.
        </p>

        {lastResult && (
          <p style={{ fontSize: 12.5, color: "var(--text-mute)", marginBottom: 16 }}>
            Last run: reviewed {lastResult.reviewed}, regenerated {lastResult.regenerated}.
          </p>
        )}

        {!evergreen ? (
          <p style={{ color: "var(--text-mute)" }}>Loading…</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Type</Th>
                <Th>Score</Th>
                <Th>Last Reviewed</Th>
              </tr>
            </thead>
            <tbody>
              {evergreen.map((item) => (
                <tr key={`${item.type}-${item.id}`}>
                  <Td>{item.label}</Td>
                  <Td>{item.type === "glossary" ? "Glossary" : "Static page"}</Td>
                  <Td>
                    <span style={{ color: item.score >= 80 ? "var(--green)" : "var(--tag-comm)", fontWeight: 600 }}>
                      {item.score}
                    </span>
                  </Td>
                  <Td>{timeAgo(item.seo_last_reviewed_at)}</Td>
                </tr>
              ))}
              {evergreen.length === 0 && (
                <tr><Td colSpan={4}>Nothing to show yet.</Td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  );
}

function Th({ children }) {
  return <th style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-mute)", fontWeight: 600, textAlign: "left", paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>{children}</th>;
}
function Td({ children, colSpan }) {
  return <td colSpan={colSpan} style={{ fontSize: 13.5, padding: "14px 8px 14px 0", borderBottom: "1px solid var(--border)", color: "var(--text-dim)" }}>{children}</td>;
}
