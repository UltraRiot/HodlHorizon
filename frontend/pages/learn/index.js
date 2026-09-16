import Link from "next/link";
import Seo from "../../components/Seo";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import { apiGet } from "../../lib/api";

const FALLBACK_TITLE = "Learn — Finance & Crypto Terms Explained | Hodl Horizon";
const FALLBACK_DESCRIPTION = "Clear, concise explanations of finance and crypto terms every trader should know.";

export async function getServerSideProps() {
  const [terms, seo] = await Promise.all([
    apiGet("/api/glossary").catch(() => []),
    apiGet("/api/pages/learn/seo").catch(() => null),
  ]);
  return {
    props: {
      terms,
      seoTitle: seo?.seo_title || FALLBACK_TITLE,
      seoDescription: seo?.seo_description || FALLBACK_DESCRIPTION,
    },
  };
}

export default function Learn({ terms, seoTitle, seoDescription }) {
  return (
    <>
      <Seo title={seoTitle} description={seoDescription} path="/learn" />
      <Header />
      <main className="container" style={{ maxWidth: 740, padding: "52px 24px 100px" }}>
        <h1 className="serif" style={{ fontSize: 32, fontWeight: 600, margin: "0 0 8px" }}>Learn</h1>
        <p style={{ color: "var(--text-dim)", marginBottom: 32 }}>
          Short, clear explanations of the finance and crypto terms that come up in our news coverage.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, borderTop: "1px solid var(--border)" }}>
          {terms.map((t) => (
            <Link
              key={t.slug}
              href={`/learn/${t.slug}`}
              style={{ display: "block", padding: "20px 2px", borderBottom: "1px solid var(--border)" }}
            >
              <div className="serif" style={{ fontSize: 19, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
                {t.term}
              </div>
              <div style={{ fontSize: 14.5, color: "var(--text-dim)" }}>{t.short_definition}</div>
            </Link>
          ))}
          {terms.length === 0 && <p style={{ color: "var(--text-mute)" }}>No entries yet.</p>}
        </div>
      </main>
      <Footer />
    </>
  );
}
