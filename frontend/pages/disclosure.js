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

        <h2 className="serif" style={{ fontSize: 22, fontWeight: 600, margin: "40px 0 16px" }}>Methodology</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: 16, lineHeight: 1.72, color: "var(--text-dim)" }}>
          <p style={{ margin: 0 }}>
            <strong style={{ color: "var(--text)" }}>How articles are written.</strong> Our system continuously
            scans a fixed list of RSS feeds from established finance and crypto news outlets, grouped by category.
            When a new story appears, an AI model writes a short, original summary from the source headlines and
            snippets - it never has access to a live price feed or the internet while writing, only the source
            text it's given and, for Analysis pieces, real computed market data (see below).
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: "var(--text)" }}>When something publishes automatically.</strong> A story
            reported by two or more independent sources publishes automatically once written. A story from a
            single source publishes automatically after a short delay instead, giving our review process a
            window to catch a problem first. Anything that fails an automated check below is held for a human to
            review before it can publish at all.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: "var(--text)" }}>Fact-checking specific figures.</strong> Before publishing, we
            check specific numeric claims a draft makes - a stated price, a percentage move, a technical figure
            like RSI - against either the original source text it was given or real cached market data, where
            we have a reliable live figure to check against. A claim that doesn't check out against either isn't
            silently corrected or dropped - the whole article is held for review instead.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: "var(--text)" }}>Analysis pieces specifically.</strong> Unlike our short news
            summaries, Analysis articles are built from real computed technical data (price trend, RSI, support
            and resistance) pulled from market data, not from a headline. They're only written when an asset's
            numbers have moved meaningfully since the last one, and the same fact-check above applies to every
            figure they state.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: "var(--text)" }}>Corrections.</strong> If an article is pulled back for review
            after already publishing - most often because a figure failed a fact-check - and is later republished,
            it's marked "Corrected [date]" next to the byline. We don't silently republish corrected content
            with no trace of the change.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
