import { useEffect, useState } from "react";
import AdminLayout from "../../components/AdminLayout";
import { adminFetch } from "../../lib/api";

export default function AdminGlossary() {
  const [terms, setTerms] = useState([]);
  const [draft, setDraft] = useState(null); // { term, short_definition, body, seo_title, seo_description }
  const [termInput, setTermInput] = useState("");
  const [generating, setGenerating] = useState(false);

  function load() {
    adminFetch("/api/admin/glossary").then(setTerms);
  }

  useEffect(load, []);

  async function generate(e) {
    e.preventDefault();
    setGenerating(true);
    try {
      const result = await adminFetch("/api/admin/glossary/generate", { method: "POST", body: JSON.stringify({ term: termInput }) });
      setDraft(result);
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    const slug = draft.term.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    await adminFetch("/api/admin/glossary", {
      method: "POST",
      body: JSON.stringify({ slug, ...draft }),
    });
    setDraft(null);
    setTermInput("");
    load();
  }

  async function remove(id) {
    await adminFetch(`/api/admin/glossary/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <AdminLayout title="Glossary">
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div className="card">
          <h3 className="serif" style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>Generate a new entry</h3>
          <form onSubmit={generate} style={{ display: "flex", gap: 10 }}>
            <input
              placeholder="Term, e.g. Support Level"
              value={termInput}
              onChange={(e) => setTermInput(e.target.value)}
              required
              style={{ ...inputStyle, flex: 1 }}
            />
            <button type="submit" disabled={generating} style={buttonStyle}>{generating ? "Generating…" : "Generate with AI"}</button>
          </form>

          {draft && (
            <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
              <textarea style={{ ...inputStyle, minHeight: 160 }} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={save} style={buttonStyle}>Save entry</button>
                <button onClick={() => setDraft(null)} style={smallButtonStyle}>Discard</button>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="serif" style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>Published entries</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {terms.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ flex: 1, fontSize: 14 }}>{t.term}</span>
                <button onClick={() => remove(t.id)} style={{ ...smallButtonStyle, color: "var(--red)" }}>Delete</button>
              </div>
            ))}
            {terms.length === 0 && <p style={{ color: "var(--text-mute)" }}>No entries yet.</p>}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

const inputStyle = { padding: "9px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)", fontSize: 13, fontFamily: "inherit" };
const buttonStyle = { padding: "9px 16px", borderRadius: 7, background: "var(--gold-fill)", color: "#1a1508", fontWeight: 600, border: "none", fontSize: 13 };
const smallButtonStyle = { padding: "6px 10px", borderRadius: 6, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 12 };
