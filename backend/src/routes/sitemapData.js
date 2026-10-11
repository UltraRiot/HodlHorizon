import { Router } from "express";
import { query } from "../db.js";
import { HIDDEN_CATEGORY_SLUGS } from "../services/shared/articleUtils.js";

const router = Router();

router.get("/", async (req, res) => {
  const { rows: articles } = await query(
    "SELECT slug, published_at, category_id FROM articles WHERE status = 'published' ORDER BY published_at DESC"
  );
  const { rows: categories } = await query("SELECT id, slug FROM categories WHERE slug != ALL($1::text[])", [HIDDEN_CATEGORY_SLUGS]);
  const { rows: glossary } = await query("SELECT slug, created_at, seo_last_reviewed_at FROM glossary_terms");

  res.json({ articles, categories, glossary });
});

export default router;
