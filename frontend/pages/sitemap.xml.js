import { apiGet } from "../lib/api";

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
    { loc: `${siteUrl}/about` },
    { loc: `${siteUrl}/contact` },
    { loc: `${siteUrl}/disclosure` },
    { loc: `${siteUrl}/privacy` },
    { loc: `${siteUrl}/terms` },
  ];

  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
  res.write(buildXml(entries));
  res.end();

  return { props: {} };
}

export default function Sitemap() {
  return null;
}
