import Seo from "../components/Seo";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { apiGet } from "../lib/api";

const FALLBACK_TITLE = "Terms of Use | Hodl Horizon";
const FALLBACK_DESCRIPTION =
  "Hodl Horizon's terms of use: our AI-written news and analysis is informational only, not financial advice, and market data may be delayed or inaccurate.";

export async function getServerSideProps() {
  const seo = await apiGet("/api/pages/terms/seo").catch(() => null);
  return {
    props: {
      seoTitle: seo?.seo_title || FALLBACK_TITLE,
      seoDescription: seo?.seo_description || FALLBACK_DESCRIPTION,
    },
  };
}

// The visible "draft template, not yet reviewed" notice was removed from
// this page ahead of launch (pre-launch security/legal review) so it no
// longer tells every visitor the Terms aren't ready - but the underlying
// content below is still the original placeholder copy and has NOT had a
// real legal review. Don't treat its removal as the content itself being
// signed off; get an actual lawyer or policy generator to review the text
// below before relying on it.
export default function Terms({ seoTitle, seoDescription }) {
  return (
    <>
      <Seo title={seoTitle} description={seoDescription} path="/terms" />
      <Header />
      <main className="container" style={{ maxWidth: 740, padding: "52px 24px 100px" }}>
        <h1 className="serif" style={{ fontSize: 32, fontWeight: 600, margin: "0 0 20px" }}>Terms of Use</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: 16, lineHeight: 1.72, color: "var(--text-dim)" }}>
          <p style={{ margin: 0 }}>
            Content on Hodl Horizon, including AI-generated news summaries and market analysis, is provided for
            informational purposes only and does not constitute financial, investment, tax, or legal advice.
          </p>
          <p style={{ margin: 0 }}>
            Market data and technical analysis may be delayed, incomplete, or inaccurate. Always verify important
            information independently before acting on it.
          </p>
          <p style={{ margin: 0 }}>
            We are not responsible for decisions made based on content published on this site.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
