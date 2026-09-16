// Public read-only access to page_seo, so the handful of static frontend
// pages (About, Disclosure, Privacy, Terms, the Learn hub index) can render
// whatever seo_title/seo_description the evergreen refresh job most
// recently set, instead of a value baked into the page at build time.
import { Router } from "express";
import { query } from "../db.js";

const router = Router();

// GET /api/pages/:path/seo
router.get("/:path/seo", async (req, res) => {
  const { rows } = await query(
    "SELECT seo_title, seo_description FROM page_seo WHERE path = $1",
    [req.params.path]
  );
  if (rows.length === 0) return res.json({ seo_title: null, seo_description: null });
  res.json(rows[0]);
});

export default router;
