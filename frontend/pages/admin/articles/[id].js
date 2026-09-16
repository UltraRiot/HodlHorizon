import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import AdminLayout from "../../../components/AdminLayout";
import { adminFetch } from "../../../lib/api";

export default function EditArticle() {
  const router = useRouter();
  const { id } = router.query;
  const [article, setArticle] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!id) return;
    adminFetch(`/api/admin/articles/${id}`).then(setArticle);
  }, [id]);

  async function save(e) {
    e.preventDefault();
    setSaved(false);
    await adminFetch(`/api/admin/articles/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: article.title,
        dek: article.dek,
        body: article.body,
        seo_title: article.seo_title,
        seo_description: article.seo_description,
      }),
    });
    setSaved(true);
  }

  if (!article) {
    return (
      <AdminLayout title="Edit Article">
        <p style={{ color: "var(--text-mute)" }}>Loading…</p>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Edit Article">
      <form onSubmit={save} className="card" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
        <Field label="Title">
          <input style={inputStyle} value={article.title} onChange={(e) => setArticle({ ...article, title: e.target.value })} />
        </Field>
        <Field label="Dek (feed summary)">
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={article.dek} onChange={(e) => setArticle({ ...article, dek: e.target.value })} />
        </Field>
        <Field label="Body">
          <textarea style={{ ...inputStyle, minHeight: 260, fontFamily: "monospace" }} value={article.body} onChange={(e) => setArticle({ ...article, body: e.target.value })} />
        </Field>
        <Field label="SEO title">
          <input style={inputStyle} value={article.seo_title || ""} onChange={(e) => setArticle({ ...article, seo_title: e.target.value })} />
        </Field>
        <Field label="SEO description">
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={article.seo_description || ""} onChange={(e) => setArticle({ ...article, seo_description: e.target.value })} />
        </Field>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button type="submit" style={buttonStyle}>Save changes</button>
          {saved && <span style={{ color: "var(--green)", fontSize: 13 }}>Saved.</span>}
        </div>
      </form>
    </AdminLayout>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "var(--text-mute)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 }}>
      {label}
      {children}
    </label>
  );
}

const inputStyle = { padding: "10px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)", fontSize: 14, fontWeight: 400, textTransform: "none", letterSpacing: "normal" };
const buttonStyle = { padding: "10px 18px", borderRadius: 7, background: "var(--gold-fill)", color: "#1a1508", fontWeight: 600, border: "none", fontSize: 14 };
