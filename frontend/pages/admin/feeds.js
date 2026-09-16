import { useEffect, useState } from "react";
import AdminLayout from "../../components/AdminLayout";
import { adminFetch } from "../../lib/api";

export default function AdminFeeds() {
  const [sources, setSources] = useState([]);
  const [form, setForm] = useState({ name: "", rss_url: "", homepage_url: "" });
  const [loading, setLoading] = useState(true);

  function load() {
    adminFetch("/api/admin/feeds").then(setSources).finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function addSource(e) {
    e.preventDefault();
    await adminFetch("/api/admin/feeds", { method: "POST", body: JSON.stringify(form) });
    setForm({ name: "", rss_url: "", homepage_url: "" });
    load();
  }

  async function toggleActive(source) {
    await adminFetch(`/api/admin/feeds/${source.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !source.active }),
    });
    load();
  }

  async function remove(id) {
    await adminFetch(`/api/admin/feeds/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <AdminLayout title="Feeds">
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div className="card">
          <h3 className="serif" style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>Add a source</h3>
          <form onSubmit={addSource} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input placeholder="Name (e.g. Reuters)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required style={inputStyle} />
            <input placeholder="RSS feed URL" value={form.rss_url} onChange={(e) => setForm({ ...form, rss_url: e.target.value })} required style={{ ...inputStyle, flex: 1, minWidth: 240 }} />
            <input placeholder="Homepage URL (optional)" value={form.homepage_url} onChange={(e) => setForm({ ...form, homepage_url: e.target.value })} style={inputStyle} />
            <button type="submit" style={buttonStyle}>Add</button>
          </form>
        </div>

        <div className="card">
          <h3 className="serif" style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>Active sources</h3>
          {loading ? (
            <p style={{ color: "var(--text-mute)" }}>Loading…</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {sources.map((s) => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ flex: 1, fontSize: 14 }}>{s.name}</span>
                  <span style={{ flex: 2, fontSize: 12.5, color: "var(--text-mute)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.rss_url}</span>
                  <button onClick={() => toggleActive(s)} style={smallButtonStyle}>{s.active ? "Disable" : "Enable"}</button>
                  <button onClick={() => remove(s.id)} style={{ ...smallButtonStyle, color: "var(--red)" }}>Delete</button>
                </div>
              ))}
              {sources.length === 0 && <p style={{ color: "var(--text-mute)" }}>No sources yet.</p>}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

const inputStyle = { padding: "9px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)", fontSize: 13 };
const buttonStyle = { padding: "9px 16px", borderRadius: 7, background: "var(--gold-fill)", color: "#1a1508", fontWeight: 600, border: "none", fontSize: 13 };
const smallButtonStyle = { padding: "6px 10px", borderRadius: 6, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 12 };
