import Seo from "../../components/Seo";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import { apiGet } from "../../lib/api";

// ISR, not SSR: no per-visitor data (no cookies, no user-specific
// branching), and glossary entries change far less often than articles -
// still needs fallback: 'blocking' rather than a fixed paths list with
// fallback: false, since a newly-added term (admin panel/glossary
// generation) would otherwise 404 until the next full rebuild.
export async function getStaticPaths() {
  let terms = [];
  try {
    terms = await apiGet("/api/glossary");
  } catch (err) {
    terms = [];
  }
  return {
    paths: terms.map((t) => ({ params: { slug: t.slug } })),
    fallback: "blocking",
  };
}

export async function getStaticProps({ params }) {
  try {
    const term = await apiGet(`/api/glossary/${params.slug}`);
    // 300s: glossary entries change rarely (an occasional evergreen SEO
    // refresh, see services/seo/evergreenRefresh.js) - no need for the
    // 60s freshness pages/index.js and the article page use for
    // frequently-changing vote counts.
    return { props: { term }, revalidate: 300 };
  } catch (err) {
    return { notFound: true };
  }
}

export default function GlossaryTermPage({ term }) {
  return (
    <>
      <Seo
        title={`${term.seo_title || term.term} | Hodl Horizon`}
        description={term.seo_description || term.short_definition}
        path={`/learn/${term.slug}`}
      />
      <Header />
      <main className="container" style={{ maxWidth: 740, padding: "52px 24px 100px" }}>
        <h1 className="serif" style={{ fontSize: 32, fontWeight: 600, margin: "0 0 20px" }}>{term.term}</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, fontSize: 17, lineHeight: 1.72, color: "var(--text-dim)" }}>
          {term.body.split("\n\n").map((p, i) => (
            <p key={i} style={{ margin: 0 }}>{p}</p>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
