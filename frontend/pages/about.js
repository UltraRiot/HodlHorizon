import Seo from "../components/Seo";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { apiGet } from "../lib/api";

const FALLBACK_TITLE = "About Hodl Horizon";
const FALLBACK_DESCRIPTION = "How Hodl Horizon works, and how our AI writes the news.";

// SEO title/description come from page_seo via the evergreen refresh job
// (see services/seo/evergreenRefresh.js) rather than being hardcoded here,
// so a periodic AI refresh actually reaches the live page. The prose below
// is untouched by that job either way - it only ever changes these two
// meta fields, never the page content.
export async function getServerSideProps() {
  const seo = await apiGet("/api/pages/about/seo").catch(() => null);
  return {
    props: {
      seoTitle: seo?.seo_title || FALLBACK_TITLE,
      seoDescription: seo?.seo_description || FALLBACK_DESCRIPTION,
    },
  };
}

export default function About({ seoTitle, seoDescription }) {
  return (
    <>
      <Seo title={seoTitle} description={seoDescription} path="/about" />
      <Header />
      <main className="container" style={{ maxWidth: 740, padding: "52px 24px 100px" }}>
        <h1 className="serif" style={{ fontSize: 32, fontWeight: 600, margin: "0 0 20px" }}>About Hodl Horizon</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, fontSize: 17, lineHeight: 1.72, color: "var(--text-dim)" }}>
          <p style={{ margin: 0 }}>
            Hodl Horizon is a finance and crypto news site built for readers who want the story, not the padding.
            Every article is a short, factual summary — no filler, no images, just what happened and why it matters.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: "var(--text)" }}>How our AI works.</strong> Our system continuously scans a set
            of established finance and crypto news sources. When two or more independent sources report the same
            story, our AI writes a short, original summary in a professional but human tone. Stories reported by
            only one source publish automatically after a short review window, giving our editors a chance to
            step in first if something looks off.
          </p>
          <p style={{ margin: 0 }}>
            Every article links back to the original sources it was drawn from, at the bottom of the page, so you
            can always go deeper.
          </p>
          <p style={{ margin: 0 }}>
            Nothing on Hodl Horizon is financial advice. Our Analysis section describes market conditions and
            technical indicators factually — it never tells you what to buy or sell.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
