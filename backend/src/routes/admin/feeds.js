// Manage the RSS sources the news engine scans. This is the "Feeds" page.
// Every source is assigned to exactly one category up front - the AI no
// longer guesses category from keywords (see ai-content-quality-spec.md).
import { Router } from "express";
import { query } from "../../db.js";

const router = Router();

router.get("/", async (req, res) => {
  const { rows } = await query(
    `SELECT s.*, c.slug AS category_slug, c.name AS category_name
     FROM sources s
     LEFT JOIN categories c ON c.id = s.category_id
     ORDER BY s.name`
  );
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { name, rss_url, homepage_url, category_id } = req.body;
  if (!name || !rss_url || !category_id) {
    return res.status(400).json({ error: "name, rss_url and category_id are required." });
  }
  const { rows } = await query(
    "INSERT INTO sources (name, rss_url, homepage_url, category_id, active) VALUES ($1, $2, $3, $4, true) RETURNING *",
    [name, rss_url, homepage_url || null, category_id]
  );
  res.status(201).json(rows[0]);
});

// PATCH /api/admin/feeds/:id
// Body can include any of: active, category_id, name, rss_url, homepage_url
router.patch("/:id", async (req, res) => {
  const allowed = ["active", "category_id", "name", "rss_url", "homepage_url"];
  const updates = [];
  const params = [];

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      params.push(req.body[key]);
      updates.push(`${key} = $${params.length}`);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: "No valid fields to update." });
  }

  params.push(req.params.id);
  const { rows } = await query(
    `UPDATE sources SET ${updates.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (rows.length === 0) return res.status(404).json({ error: "Source not found." });
  res.json(rows[0]);
});

router.delete("/:id", async (req, res) => {
  await query("DELETE FROM sources WHERE id = $1", [req.params.id]);
  res.status(204).end();
});

export default router;
