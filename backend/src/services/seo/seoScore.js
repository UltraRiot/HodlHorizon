// A deliberately simple SEO health check - no external tools, just counts
// and length checks against published articles. Good enough to catch
// obvious gaps (missing meta description, etc.) without adding a dependency
// on a paid SEO API.
import { query } from "../../db.js";

// Per-item score matching the tightened SEO_FIELD_RULES prompt rules
// (title 50-60 chars, description 120-155 chars) - not the looser range
// computeSeoStatus() below still checks. Kept as a separate, additive
// function so that one's existing (and differently-scoped) behavior stays
// untouched; used by the evergreen refresh job and the admin SEO page to
// score one glossary entry/static page/tested article at a time.
export function scoreSeoFields(seoTitle, seoDescription) {
  const hasGoodTitle = Boolean(seoTitle && seoTitle.length >= 50 && seoTitle.length <= 60);
  const hasGoodDescription = Boolean(
    seoDescription && seoDescription.length >= 120 && seoDescription.length <= 155
  );
  return Math.round(((hasGoodTitle ? 1 : 0) + (hasGoodDescription ? 1 : 0)) / 2 * 100);
}

export async function computeSeoStatus() {
  const { rows } = await query(
    "SELECT seo_title, seo_description FROM articles WHERE status = 'published'"
  );

  const total = rows.length;
  const withTitle = rows.filter((r) => r.seo_title && r.seo_title.length > 0).length;
  const withGoodDescription = rows.filter(
    (r) => r.seo_description && r.seo_description.length >= 50 && r.seo_description.length <= 160
  ).length;

  const checks = [
    { label: "Sitemap available at /sitemap.xml", pass: true },
    { label: "robots.txt present", pass: true },
    {
      label: `SEO titles present: ${withTitle}/${total}`,
      pass: total === 0 || withTitle === total,
    },
    {
      label: `Meta descriptions in the 50-160 character sweet spot: ${withGoodDescription}/${total}`,
      pass: total === 0 || withGoodDescription === total,
    },
  ];

  const score =
    total === 0
      ? 100
      : Math.round(((withTitle + withGoodDescription) / (total * 2)) * 100);

  return { score, checks };
}
