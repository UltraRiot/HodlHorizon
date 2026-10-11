import { Router } from "express";
import { query } from "../../db.js";
import { computeSeoStatus, scoreSeoFields } from "../../services/seo/seoScore.js";
import { runEvergreenSeoRefresh } from "../../services/seo/evergreenRefresh.js";

const router = Router();

router.get("/status", async (req, res) => {
  res.json(await computeSeoStatus());
});

router.get("/evergreen", async (req, res) => {
  const { rows: terms } = await query(
    "SELECT id, term AS label, seo_title, seo_description, seo_last_reviewed_at FROM glossary_terms ORDER BY term"
  );
  const { rows: pages } = await query(
    "SELECT path AS id, path AS label, seo_title, seo_description, seo_last_reviewed_at FROM page_seo ORDER BY path"
  );

  const items = [
    ...terms.map((r) => ({ ...r, type: "glossary" })),
    ...pages.map((r) => ({ ...r, type: "page" })),
  ].map((r) => ({ ...r, score: scoreSeoFields(r.seo_title, r.seo_description) }));

  res.json(items);
});

router.post("/refresh-evergreen-now", async (req, res) => {
  try {
    const result = await runEvergreenSeoRefresh();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Evergreen SEO refresh failed.", detail: err.message });
  }
});

export default router;
