import { useEffect, useState } from "react";
import Link from "next/link";
import AdminLayout from "../../components/AdminLayout";
import { adminFetch } from "../../lib/api";

const STATUS_STYLE = {
  published: { background: "rgba(63,197,132,0.14)", color: "var(--green)" },
  draft: { background: "rgba(122,138,168,0.16)", color: "var(--text-dim)" },
  review: { background: "rgba(224,178,95,0.16)", color: "var(--tag-comm)" },
  scheduled: { background: "rgba(90,157,224,0.14)", color: "var(--tag-stocks)" },
};

// "Scheduled" is the delayed-auto-publish status (services/rss/
// scanAndGenerate.js): a clean single-source article with a countdown
// instead of indefinite manual review. Renders a human "in Xh"/"in Xm"
// readout rather than the raw timestamp; anything already past due (the
// cron tick just hasn't run yet) reads as "shortly" instead of a
// confusing negative duration.
function formatAutoPublishCountdown(autoPublishAt) {
  if (!autoPublishAt) return null;
  const diffMs = new Date(autoPublishAt).getTime() - Date.now();
  if (diffMs <= 0) return "Publishing shortly unless held";
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `Publishing in ${minutes}m unless held`;
  const hours = Math.round(minutes / 60);
  return `Publishing in ${hours}h unless held`;
}

export default function AdminArticles() {
  const [articles, setArticles] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedArticleId, setSelectedArticleId] = useState(null);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [panelLoading, setPanelLoading] = useState(false);

  function load() {
    setLoading(true);
    adminFetch(`/api/admin/articles${filter ? `?status=${filter}` : ""}`)
      .then(setArticles)
      .finally(() => setLoading(false));
  }

  useEffect(load, [filter]);

  // Escape closes the panel too, not just the X button / click-outside.
  useEffect(() => {
    if (!panelOpen) return;
    function onKeyDown(e) {
      if (e.key === "Escape") closePanel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panelOpen]);

  async function setStatus(id, status) {
    await adminFetch(`/api/admin/articles/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    load();
  }

  async function remove(id) {
    await adminFetch(`/api/admin/articles/${id}`, { method: "DELETE" });
    load();
  }

  // Cancels a scheduled article's timer and moves it back to plain review
  // (same PATCH as any other status change - see routes/admin/articles.js
  // for what it does server-side to a "scheduled" row specifically).
  // Re-fetches the open panel's own copy too, not just the list, so its
  // status/countdown update immediately without closing the panel.
  async function holdArticle(id) {
    await setStatus(id, "review");
    if (selectedArticleId === id) viewArticle(id);
  }

  function viewArticle(id) {
    setSelectedArticleId(id);
    setSelectedArticle(null);
    setPanelLoading(true);
    setPanelOpen(true);
    adminFetch(`/api/admin/articles/${id}`)
      .then(setSelectedArticle)
      .finally(() => setPanelLoading(false));
  }

  function closePanel() {
    setPanelOpen(false);
    setSelectedArticleId(null);
  }

  return (
    <AdminLayout title="Articles">
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {["", "published", "scheduled", "review", "draft"].map((s) => (
          <button
            key={s || "all"}
            onClick={() => setFilter(s)}
            style={{
              padding: "7px 14px",
              borderRadius: 20,
              fontSize: 13,
              border: "1px solid var(--border)",
              background: filter === s ? "var(--gold-fill)" : "transparent",
              color: filter === s ? "#1a1508" : "var(--text-dim)",
            }}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <p style={{ color: "var(--text-mute)" }}>Loading…</p>
        ) : (
          // The table is wider than a phone screen (5 columns plus up to 4
          // action buttons) - scroll it horizontally within its own box
          // instead of letting it blow out the page's width. That matters
          // beyond just this table: an overflowing page widens the whole
          // layout viewport, which would also throw off the preview
          // panel's fixed-position math below.
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <Th>Title</Th>
                <Th>Category</Th>
                <Th>Flags</Th>
                <Th>Status</Th>
                <Th>Sources</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {articles.map((a) => (
                <tr key={a.id} style={a.id === selectedArticleId && panelOpen ? { background: "var(--bg-elevated)" } : undefined}>
                  <Td><Link href={`/admin/articles/${a.id}`}>{a.title}</Link></Td>
                  <Td>{a.category_name}</Td>
                  <Td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {a.category_mismatch && (
                        <span
                          title={a.category_mismatch_note}
                          style={{ fontSize: 11, color: "var(--red)", fontWeight: 700, whiteSpace: "nowrap" }}
                        >
                          ⚠ Category?
                        </span>
                      )}
                      {a.price_mismatch && (
                        <span
                          title={a.price_mismatch_note}
                          style={{ fontSize: 11, color: "var(--red)", fontWeight: 700, whiteSpace: "nowrap" }}
                        >
                          ⚠ Price?
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <span style={{ ...STATUS_STYLE[a.status], padding: "4px 10px", borderRadius: 5, fontSize: 12, fontWeight: 600 }}>
                      {a.status}
                    </span>
                    {a.status === "scheduled" && (
                      <div
                        title={new Date(a.auto_publish_at).toLocaleString()}
                        style={{ marginTop: 4, fontSize: 11, color: "var(--tag-stocks)", whiteSpace: "nowrap" }}
                      >
                        {formatAutoPublishCountdown(a.auto_publish_at)}
                      </div>
                    )}
                  </Td>
                  <Td>{a.source_count}</Td>
                  <Td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => viewArticle(a.id)} style={smallButtonStyle}>View</button>
                      {a.status !== "published" && (
                        <button onClick={() => setStatus(a.id, "published")} style={smallButtonStyle}>Publish</button>
                      )}
                      {a.status === "scheduled" && (
                        <button onClick={() => setStatus(a.id, "review")} style={smallButtonStyle}>Hold</button>
                      )}
                      {a.status === "published" && (
                        <button onClick={() => setStatus(a.id, "review")} style={smallButtonStyle}>Unpublish</button>
                      )}
                      <button onClick={() => remove(a.id)} style={{ ...smallButtonStyle, color: "var(--red)" }}>Delete</button>
                    </div>
                  </Td>
                </tr>
              ))}
              {articles.length === 0 && (
                <tr><Td colSpan={6}>No articles match this filter.</Td></tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <ArticlePreviewPanel
        open={panelOpen}
        loading={panelLoading}
        article={selectedArticle}
        onClose={closePanel}
        onHold={holdArticle}
      />
    </AdminLayout>
  );
}

function ArticlePreviewPanel({ open, loading, article, onClose, onHold }) {
  return (
    <>
      {/* Click-outside-to-close overlay. Always mounted so the panel's
          slide transition can animate both ways; inert (no pointer events,
          invisible) while closed. */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(4,8,16,0.55)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.2s ease",
          zIndex: 40,
        }}
      />

      <div
        role="dialog"
        aria-label="Article preview"
        className="article-preview-panel"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(520px, 100vw)",
          background: "var(--bg-elevated)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-12px 0 32px rgba(0,0,0,0.35)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.22s ease",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-mute)", fontWeight: 600 }}>
            Article Preview
          </span>
          <button
            onClick={onClose}
            aria-label="Close preview"
            style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-dim)", width: 28, height: 28, fontSize: 15, lineHeight: 1, cursor: "pointer" }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "22px", overflowY: "auto", flex: 1 }}>
          {loading && <p style={{ color: "var(--text-mute)" }}>Loading…</p>}

          {!loading && article && (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                {article.category_slug && (
                  <span className={`chip chip-${article.category_slug}`}>{article.category_name || article.category_slug}</span>
                )}
                <span
                  style={{
                    ...STATUS_STYLE[article.status],
                    padding: "4px 10px",
                    borderRadius: 5,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {article.status}
                </span>
              </div>

              {article.status === "scheduled" && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: "10px 14px",
                    borderRadius: 8,
                    background: "rgba(90,157,224,0.12)",
                    border: "1px solid rgba(90,157,224,0.35)",
                    color: "var(--tag-stocks)",
                    fontSize: 13,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <span title={new Date(article.auto_publish_at).toLocaleString()}>
                    {formatAutoPublishCountdown(article.auto_publish_at)}
                  </span>
                  <button
                    onClick={() => onHold(article.id)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                      color: "var(--text-dim)",
                      fontSize: 12,
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    Hold
                  </button>
                </div>
              )}

              {[
                article.category_mismatch && article.category_mismatch_note,
                article.price_mismatch && article.price_mismatch_note,
              ]
                .filter(Boolean)
                .map((note) => (
                  <div
                    key={note}
                    style={{
                      marginBottom: 16,
                      padding: "10px 14px",
                      borderRadius: 8,
                      background: "rgba(226,100,106,0.12)",
                      border: "1px solid rgba(226,100,106,0.35)",
                      color: "var(--red)",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    ⚠ {note}
                  </div>
                ))}

              <h2 className="serif" style={{ margin: "0 0 10px", fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>
                {article.title}
              </h2>

              {article.dek && (
                <p style={{ margin: "0 0 20px", fontSize: 14.5, color: "var(--text-dim)", lineHeight: 1.55 }}>
                  {article.dek}
                </p>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 15, lineHeight: 1.65, color: "var(--text-dim)" }}>
                {(article.body || "").split("\n\n").map((paragraph, i) => (
                  <p key={i} style={{ margin: 0 }}>{paragraph}</p>
                ))}
              </div>

              {article.sources?.length > 0 && (
                <div style={{ marginTop: 30, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
                  <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-mute)", fontWeight: 600, margin: "0 0 12px" }}>
                    Sources
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13.5 }}>
                    {article.sources.map((s) => (
                      <a key={s.source_url} href={s.source_url} target="_blank" rel="noopener noreferrer nofollow">
                        {s.source_name}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Th({ children }) {
  return <th style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-mute)", fontWeight: 600, textAlign: "left", paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>{children}</th>;
}
function Td({ children, colSpan }) {
  return <td colSpan={colSpan} style={{ fontSize: 13.5, padding: "14px 8px 14px 0", borderBottom: "1px solid var(--border)", color: "var(--text-dim)" }}>{children}</td>;
}
const smallButtonStyle = { padding: "6px 10px", borderRadius: 6, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 12 };
