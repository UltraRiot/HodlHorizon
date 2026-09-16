// Feeds the frontend's /sitemap.xml page. Kept as a plain data endpoint so
// the actual XML formatting lives in one place (frontend/pages/sitemap.xml.js).
import { Router } from "express";
import { query } from "../db.js";

const router = Router();

router.get("/", async (req, res) => {
  const { rows: articles } = await query(
    "SELECT slug, published_at, category_id FROM articles WHERE status = 'published' ORDER BY published_at DESC"
  );
  const { rows: categories } = await query("SELECT id, slug FROM categories");
  // seo_last_reviewed_at (set by the evergreen SEO refresh job) is a truer
  // "last modified" than created_at for a term that's been revised since -
  // frontend/pages/sitemap.xml.js falls back to created_at for a term
  // that's never been through that job yet (seo_last_reviewed_at NULL).
  const { rows: glossary } = await query("SELECT slug, created_at, seo_last_reviewed_at FROM glossary_terms");

  res.json({ articles, categories, glossary });
});

export default router;
