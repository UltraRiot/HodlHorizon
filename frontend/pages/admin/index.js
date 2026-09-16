import { useEffect, useState } from "react";
import Link from "next/link";
import AdminLayout from "../../components/AdminLayout";
import { adminFetch } from "../../lib/api";

const STATUS_STYLE = {
  published: { background: "rgba(63,197,132,0.14)", color: "var(--green)" },
  draft: { background: "rgba(122,138,168,0.16)", color: "var(--text-dim)" },
  review: { background: "rgba(224,178,95,0.16)", color: "var(--tag-comm)" },
};

export default function AdminDashboard() {
  const [articles, setArticles] = useState([]);
  const [seo, setSeo] = useState(null);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      adminFetch("/api/admin/articles"),
      adminFetch("/api/admin/seo/status"),
      adminFetch("/api/admin/usage"),
    ])
      .then(([articlesData, seoData, usageData]) => {
        setArticles(articlesData);
        setSeo(seoData);
        setUsage(usageData);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const today = new Date().toDateString();
  const articlesToday = articles.filter((a) => new Date(a.created_at).toDateString() === today).length;
  const inReview = articles.filter((a) => a.status === "review").length;

  return (
    <AdminLayout title="Dashboard">
      {loading ? (
        <p style={{ color: "var(--text-mute)" }}>Loading…</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 18 }}>
            <StatCard label="Articles Today" value={articlesToday} />
            <StatCard label="Queued for Review" value={inReview} />
            <StatCard label="Avg. SEO Score" value={seo ? seo.score : "—"} />
            <StatCard label="AI Cost This Month" value={usage ? `$${usage.total_cost_usd}` : "—"} />
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <h3 className="serif" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Latest Articles</h3>
              <Link href="/admin/articles" style={{ fontSize: 13 }}>View all</Link>
            </div>
            {/* Scroll horizontally within this box rather than letting the
                table push the whole page wider than the screen. */}
            <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <Th>Title</Th>
                  <Th>Category</Th>
                  <Th>Status</Th>
                  <Th>Sources</Th>
                </tr>
              </thead>
              <tbody>
                {articles.slice(0, 8).map((a) => (
                  <tr key={a.id}>
                    <Td>{a.title}</Td>
                    <Td>{a.category_name}</Td>
                    <Td>
                      <span style={{ ...STATUS_STYLE[a.status], padding: "4px 10px", borderRadius: 5, fontSize: 12, fontWeight: 600 }}>
                        {a.status}
                      </span>
                    </Td>
                    <Td>{a.source_count}</Td>
                  </tr>
                ))}
                {articles.length === 0 && (
                  <tr><Td colSpan={4}>No articles yet — trigger a scan from the AI Engine page.</Td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="card">
      <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-mute)", fontWeight: 600 }}>{label}</div>
      <div className="serif" style={{ fontSize: 30, fontWeight: 600, marginTop: 8 }}>{value}</div>
    </div>
  );
}

function Th({ children }) {
  return <th style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-mute)", fontWeight: 600, textAlign: "left", paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>{children}</th>;
}
function Td({ children, colSpan }) {
  return <td colSpan={colSpan} style={{ fontSize: 13.5, padding: "14px 0", borderBottom: "1px solid var(--border)", color: "var(--text-dim)" }}>{children}</td>;
}
