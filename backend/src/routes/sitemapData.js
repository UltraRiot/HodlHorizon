// Feeds the frontend's /sitemap.xml page. Kept as a plain data endpoint so
// the actual XML formatting lives in one place (frontend/pages/sitemap.xml.js).
import { Router } from "express";
import { query } from "../db.js";
import { HIDDEN_CATEGORY_SLUGS } from "../services/shared/articleUtils.js";

const router = Router();

router.get("/", async (req, res) => {
  const { rows: articles } = await query(
    "SELECT slug, published_at, category_id FROM articles WHERE status = 'published' ORDER BY published_at DESC"
  );
  // Excludes hidden categories (Analysis) from the category-page list -
  // frontend/lib/categories.js no longer generates a static /category/analysis
  // page (fallback: false), so listing it here would put a 404 in the
  // sitemap. Individual Analysis article permalinks are untouched (not
  // filtered out of `articles` above) - those still resolve fine and stay
  // discoverable, only the category index page is hidden.
  const { rows: categories } = await query("SELECT id, slug FROM categories WHERE slug != ALL($1::text[])", [HIDDEN_CATEGORY_SLUGS]);
  // seo_last_reviewed_at (set by the evergreen SEO refresh job) is a truer
  // "last modified" than created_at for a term that's been revised since -
  // frontend/pages/sitemap.xml.js falls back to created_at for a term
  // that's never been through that job yet (seo_last_reviewed_at NULL).
  const { rows: glossary } = await query("SELECT slug, created_at, seo_last_reviewed_at FROM glossary_terms");

  res.json({ articles, categories, glossary });
});

export default router;
