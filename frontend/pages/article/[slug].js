import Link from "next/link";
import Seo from "../../components/Seo";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import ReactionButtons from "../../components/ReactionButtons";
import { apiGet } from "../../lib/api";

export async function getServerSideProps({ params }) {
  let article;
  try {
    article = await apiGet(`/api/articles/${params.slug}`);
  } catch (err) {
    return { notFound: true };
  }

  // Same category only - see GET /api/articles/:slug/related, which used
  // to backfill with other-category articles when the category was
  // sparse (the cause of a real bug: a Commodities article's "Related
  // Articles" showing a Crypto one). That backfill is gone now, but this
  // filter stays as a regression guard: if a future change to that
  // endpoint (or a different one swapped in later) ever reintroduces a
  // category mismatch, it's dropped here and logged instead of silently
  // rendering under a "Related Articles" heading that promises otherwise.
  let related = [];
  try {
    const rawRelated = await apiGet(`/api/articles/${params.slug}/related?limit=4`);
    related = rawRelated.filter((r) => {
      if (r.category_slug === article.category_slug) return true;
      console.warn(
        `Related articles: dropped "${r.slug}" (category "${r.category_slug}") from "${article.slug}"'s related list (expected category "${article.category_slug}").`
      );
      return false;
    });
  } catch (err) {
    related = [];
  }

  return { props: { article, related } };
}

export default function ArticlePage({ article, related }) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://hodlhorizon.com";
  const url = `${siteUrl}/article/${article.slug}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    description: article.seo_description || article.dek,
    // Google lists "image" as REQUIRED for NewsArticle rich-result
    // eligibility (not just recommended) - found missing during this
    // pre-launch audit. Articles themselves never carry an image (see
    // STYLE_INSTRUCTIONS in backend/src/services/ai/prompts.js - "this
    // site never uses images in articles," a deliberate editorial choice),
    // so this falls back to the same site-wide og-default.jpg every OG/
    // Twitter tag already falls back to (components/Seo.js) rather than
    // leaving the field out - an array, per Google's spec, even with one entry.
    image: [`${siteUrl}/og-default.jpg`],
    datePublished: article.published_at,
    // dateModified: recommended by Google, not just cosmetic - it's part
    // of what schedules a re-crawl. Real value now (migrations/
    // 015_article_updated_at.sql) - articles.updated_at is set equal to
    // created_at on insert (both default to now() in the same statement)
    // and bumped by PATCH /api/admin/articles/:id whenever an admin edits
    // a PUBLISHED article's content (see that route). Backfilled to
    // created_at for every pre-existing row, so this is never null even
    // for articles that predate the column.
    dateModified: article.updated_at,
    author: { "@type": "Organization", name: "Hodl Horizon" },
    publisher: {
      "@type": "Organization",
      name: "Hodl Horizon",
      // Google wants a real square-ish logo here (min 112x112, they
      // recommend closer to 600x60 min width) - confirmed present in
      // /public and resolving with a 200 (see this feature's QA pass).
      logo: { "@type": "ImageObject", url: `${siteUrl}/logo-schema.png` },
    },
    mainEntityOfPage: url,
  };

  return (
    <>
      <Seo
        title={`${article.seo_title || article.title} — Hodl Horizon`}
        description={article.seo_description || article.dek}
        path={`/article/${article.slug}`}
        type="article"
        jsonLd={jsonLd}
      />

      <Header />

      <main className="container article-main" style={{ maxWidth: 740, padding: "52px 24px 100px" }}>
        <div style={{ fontSize: 13, color: "var(--text-mute)", marginBottom: 18 }}>
          <Link href="/" style={{ color: "var(--text-mute)" }}>Home</Link> /{" "}
          <Link href={`/category/${article.category_slug}`} style={{ color: "var(--text-mute)" }}>
            {article.category_name}
          </Link>
        </div>

        <span className={`chip chip-${article.category_slug}`}>{article.category_name}</span>

        <h1 className="serif article-headline" style={{ fontSize: 38, fontWeight: 600, lineHeight: 1.22, margin: "18px 0 16px" }}>
          {article.title}
        </h1>

        <div style={{ display: "flex", alignItems: "center", gap: 14, color: "var(--text-mute)", fontSize: 13.5, paddingBottom: 24, marginBottom: 28, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <span>{new Date(article.published_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
          <span>·</span>
          <span>{article.read_minutes} min read</span>
          <span>·</span>
          <span>Written by Hodl Horizon</span>
          {article.corrected_at && (
            <span
              title={`A figure in this article was flagged by our automated fact-check and corrected on ${new Date(article.corrected_at).toLocaleDateString("en-US", { dateStyle: "medium" })}. See /disclosure for how this works.`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 9px",
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 600,
                color: "var(--impact-medium)",
                border: "1px solid var(--impact-medium)",
              }}
            >
              Corrected {new Date(article.corrected_at).toLocaleDateString("en-US", { dateStyle: "medium" })}
            </span>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, fontSize: 17, lineHeight: 1.72, color: "var(--text-dim)" }}>
          {article.body.split("\n\n").map((paragraph, i) => (
            <p key={i} style={{ margin: 0 }}>{paragraph}</p>
          ))}
        </div>

        <div style={{ marginTop: 36 }}>
          <ReactionButtons
            articleId={article.id}
            initialCounts={{
              bullish_count: article.bullish_count,
              bearish_count: article.bearish_count,
              neutral_count: article.neutral_count,
            }}
          />
        </div>

        {article.sources?.length > 0 && (
          <div style={{ marginTop: 44, paddingTop: 24, borderTop: "1px solid var(--border)" }}>
            <h3 className="serif" style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1.3, color: "var(--text-mute)", fontWeight: 600, margin: "0 0 14px" }}>
              Sources
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
              {article.sources.map((s) => (
                <a key={s.source_url} href={s.source_url} target="_blank" rel="noopener noreferrer nofollow">
                  {s.source_name}
                </a>
              ))}
            </div>
          </div>
        )}

        {related.length > 0 && (
          <div style={{ marginTop: 44, paddingTop: 24, borderTop: "1px solid var(--border)" }}>
            <h3 className="serif" style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1.3, color: "var(--text-mute)", fontWeight: 600, margin: "0 0 16px" }}>
              Related Articles
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 18 }}>
              {related.map((r) => (
                <Link key={r.slug} href={`/article/${r.slug}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span className={`chip chip-${r.category_slug}`}>{r.category_name}</span>
                  <span style={{ fontSize: 14, lineHeight: 1.4, fontWeight: 500, color: "var(--text)" }}>{r.title}</span>
                  <span style={{ fontSize: 12, color: "var(--text-mute)" }}>{r.time_ago}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>

      <Footer />
    </>
  );
}
