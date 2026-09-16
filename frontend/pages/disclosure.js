import Seo from "../components/Seo";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { apiGet } from "../lib/api";

const FALLBACK_TITLE = "Disclosure | Hodl Horizon";
const FALLBACK_DESCRIPTION =
  "How Hodl Horizon works: AI-generated news and analysis, reviewed before publishing, plus our not-financial-advice disclosure explained here.";

export async function getServerSideProps() {
  const seo = await apiGet("/api/pages/disclosure/seo").catch(() => null);
  return {
    props: {
      seoTitle: seo?.seo_title || FALLBACK_TITLE,
      seoDescription: seo?.seo_description || FALLBACK_DESCRIPTION,
    },
  };
}

export default function Disclosure({ seoTitle, seoDescription }) {
  return (
    <>
      <Seo title={seoTitle} description={seoDescription} path="/disclosure" />
      <Header />
      <main className="container" style={{ maxWidth: 740, padding: "52px 24px 100px" }}>
        <h1 className="serif" style={{ fontSize: 32, fontWeight: 600, margin: "0 0 20px" }}>Disclosure</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: 16, lineHeight: 1.72, color: "var(--text-dim)" }}>
          <p style={{ margin: 0 }}>
            <strong style={{ color: "var(--text)" }}>AI-generated content.</strong> News summaries and analysis on
            this site are drafted automatically by AI from publicly available sources, and reviewed against our
            editorial rules before publication (see About). Sources are linked at the bottom of every article.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: "var(--text)" }}>Not financial advice.</strong> Nothing on this site should be
            taken as a recommendation to buy, sell, or hold any asset.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
