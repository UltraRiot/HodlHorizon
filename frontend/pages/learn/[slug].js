import Seo from "../../components/Seo";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import { apiGet } from "../../lib/api";

export async function getServerSideProps({ params }) {
  try {
    const term = await apiGet(`/api/glossary/${params.slug}`);
    return { props: { term } };
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
