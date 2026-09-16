import { Router } from "express";
import { query } from "../../db.js";
import { generateGlossaryEntry } from "../../services/ai/provider.js";

const router = Router();

router.get("/", async (req, res) => {
  const { rows } = await query("SELECT * FROM glossary_terms ORDER BY term");
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { slug, term, short_definition, body, seo_title, seo_description } = req.body;
  const { rows } = await query(
    `INSERT INTO glossary_terms (slug, term, short_definition, body, seo_title, seo_description)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [slug, term, short_definition, body, seo_title || null, seo_description || null]
  );
  res.status(201).json(rows[0]);
});

// POST /api/admin/glossary/generate   { term }
// Uses the same AI provider as the news pipeline to draft a first version -
// an admin still reviews and saves it via the regular POST above.
router.post("/generate", async (req, res) => {
  const { term } = req.body;
  if (!term) return res.status(400).json({ error: "term is required." });

  try {
    const draft = await generateGlossaryEntry(term);
    res.json(draft);
  } catch (err) {
    res.status(500).json({ error: "Could not generate entry.", detail: err.message });
  }
});

router.patch("/:id", async (req, res) => {
  const allowed = ["term", "short_definition", "body", "seo_title", "seo_description"];
  const updates = [];
  const params = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      params.push(req.body[key]);
      updates.push(`${key} = $${params.length}`);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: "No valid fields to update." });

  params.push(req.params.id);
  const { rows } = await query(
    `UPDATE glossary_terms SET ${updates.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (rows.length === 0) return res.status(404).json({ error: "Term not found." });
  res.json(rows[0]);
});

router.delete("/:id", async (req, res) => {
  await query("DELETE FROM glossary_terms WHERE id = $1", [req.params.id]);
  res.status(204).end();
});

export default router;
