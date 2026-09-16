import Seo from "../components/Seo";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { apiGet } from "../lib/api";

const FALLBACK_TITLE = "Privacy Policy | Hodl Horizon";
const FALLBACK_DESCRIPTION =
  "Hodl Horizon's privacy policy: what data we collect (none required to read the site), how our cookieless analytics works, and your rights as a visitor here.";

export async function getServerSideProps() {
  const seo = await apiGet("/api/pages/privacy/seo").catch(() => null);
  return {
    props: {
      seoTitle: seo?.seo_title || FALLBACK_TITLE,
      seoDescription: seo?.seo_description || FALLBACK_DESCRIPTION,
    },
  };
}

// The visible "draft template, not yet reviewed" notice was removed from
// this page ahead of launch (pre-launch security/legal review) so it no
// longer tells every visitor the Privacy Policy isn't ready - but the
// underlying content below is still the original placeholder copy and has
// NOT had a real legal review. Don't treat its removal as the content
// itself being signed off; get an actual lawyer or policy generator to
// review the text below before relying on it.
export default function Privacy({ seoTitle, seoDescription }) {
  return (
    <>
      <Seo title={seoTitle} description={seoDescription} path="/privacy" />
      <Header />
      <main className="container" style={{ maxWidth: 740, padding: "52px 24px 100px" }}>
        <h1 className="serif" style={{ fontSize: 32, fontWeight: 600, margin: "0 0 20px" }}>Privacy Policy</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: 16, lineHeight: 1.72, color: "var(--text-dim)" }}>
          <p style={{ margin: 0 }}>
            Hodl Horizon does not require an account and does not collect personal data to let you read the site.
            We do not use tracking cookies for advertising or profiling.
          </p>
          <p style={{ margin: 0 }}>
            If analytics are enabled, we use a cookieless, privacy-friendly analytics tool that reports aggregate
            traffic numbers only and cannot identify individual visitors.
          </p>
          <p style={{ margin: 0 }}>
            If a display advertising network is added in the future, that network may set its own cookies. Should
            that happen, this policy — and a cookie consent notice — will be updated accordingly.
          </p>
          <p style={{ margin: 0 }}>
            For questions about this policy, contact us at the address on our Contact page.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
