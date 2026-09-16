import { Router } from "express";
import { query } from "../db.js";

const router = Router();

router.get("/", async (req, res) => {
  const { rows } = await query(
    "SELECT slug, term, short_definition FROM glossary_terms ORDER BY term"
  );
  res.json(rows);
});

router.get("/:slug", async (req, res) => {
  const { rows } = await query("SELECT * FROM glossary_terms WHERE slug = $1", [req.params.slug]);
  if (rows.length === 0) return res.status(404).json({ error: "Term not found." });
  res.json(rows[0]);
});

export default router;
