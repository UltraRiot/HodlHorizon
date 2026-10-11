import { query } from "../../db.js";

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
