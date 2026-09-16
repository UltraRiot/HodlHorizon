// A page with no component - getServerSideProps writes the XML response
// directly and short-circuits rendering. Visiting /sitemap.xml hits this.
import { apiGet } from "../lib/api";

// ISO 8601 date only (no time) - the <lastmod> format Google/Ahrefs
// actually check for, and all that's meaningful here anyway (nothing on
// this site publishes/revises more than once so an hour-level lastmod
// would be false precision).
function toLastmod(dateLike) {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function urlTag(loc, lastmod) {
  return `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
}

function buildXml(entries) {
  const body = entries.map(({ loc, lastmod }) => urlTag(loc, lastmod)).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

export async function getServerSideProps({ res }) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://hodlhorizon.com";
  const data = await apiGet("/api/sitemap-data").catch(() => ({ articles: [], categories: [], glossary: [] }));

  // Real dates, never fabricated: an article's lastmod is its own
  // published_at (this site never edits a published article's body after
  // the fact - see services/rss/scanAndGenerate.js - so published_at IS
  // its true last-modified time). A category page's lastmod is the newest
  // published_at among its own articles - the page's actual content
  // changed exactly when that article appeared, not "now". No per-item
  // date at all (a category with zero articles yet, or the static
  // legal/about pages below) means no <lastmod> for that URL rather than
  // guessing one - lastmod is optional per the sitemap spec.
  const latestByCategory = new Map();
  for (const article of data.articles) {
    const current = latestByCategory.get(article.category_id);
    if (!current || new Date(article.published_at) > new Date(current)) {
      latestByCategory.set(article.category_id, article.published_at);
    }
  }
  const siteLastmod = data.articles[0]?.published_at; // pre-sorted DESC by the API

  const entries = [
    { loc: siteUrl, lastmod: toLastmod(siteLastmod) },
    { loc: `${siteUrl}/learn`, lastmod: toLastmod(data.glossary[0]?.seo_last_reviewed_at || data.glossary[0]?.created_at) },
    ...data.categories.map((c) => ({
      loc: `${siteUrl}/category/${c.slug}`,
      lastmod: toLastmod(latestByCategory.get(c.id)),
    })),
    ...data.articles.map((a) => ({ loc: `${siteUrl}/article/${a.slug}`, lastmod: toLastmod(a.published_at) })),
    ...data.glossary.map((g) => ({
      loc: `${siteUrl}/learn/${g.slug}`,
      lastmod: toLastmod(g.seo_last_reviewed_at || g.created_at),
    })),
    // Static/legal pages - real, indexable content that was simply never
    // added to the sitemap before now (found during this feature's QA
    // pass). No per-page modified date is tracked for these, so no
    // <lastmod> rather than a fabricated one.
    { loc: `${siteUrl}/about` },
    { loc: `${siteUrl}/contact` },
    { loc: `${siteUrl}/disclosure` },
    { loc: `${siteUrl}/privacy` },
    { loc: `${siteUrl}/terms` },
  ];

  res.setHeader("Content-Type", "application/xml");
  res.write(buildXml(entries));
  res.end();

  return { props: {} };
}

export default function Sitemap() {
  return null;
}
