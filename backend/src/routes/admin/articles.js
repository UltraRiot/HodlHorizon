import { Router } from "express";
import { query } from "../../db.js";

const router = Router();

router.get("/", async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = "1=1";
  if (status) {
    params.push(status);
    where = `a.status = $${params.length}`;
  }

  const { rows } = await query(
    `SELECT a.id, a.slug, a.title, a.status, a.created_at, a.published_at, a.source_count,
            a.category_mismatch, a.category_mismatch_note,
            a.price_mismatch, a.price_mismatch_note,
            a.stale_content, a.stale_content_note,
            a.auto_publish_at,
            c.name AS category_name
     FROM articles a
     JOIN categories c ON c.id = a.category_id
     WHERE ${where}
     ORDER BY a.created_at DESC
     LIMIT 100`,
    params
  );
  res.json(rows);
});

router.get("/:id", async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, c.slug AS category_slug, c.name AS category_name
     FROM articles a
     JOIN categories c ON c.id = a.category_id
     WHERE a.id = $1`,
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Article not found." });

  const { rows: sources } = await query(
    "SELECT source_name, source_url FROM article_sources WHERE article_id = $1",
    [req.params.id]
  );
  res.json({ ...rows[0], sources });
});

router.patch("/:id", async (req, res) => {
  const allowed = ["title", "dek", "body", "status", "seo_title", "seo_description", "category_id"];
  const updates = [];
  const params = [];

  const { rows: existingRows } = await query(
    "SELECT status, published_at, price_mismatch, category_mismatch, stale_content FROM articles WHERE id = $1",
    [req.params.id]
  );
  if (existingRows.length === 0) return res.status(404).json({ error: "Article not found." });
  const {
    status: currentStatus,
    published_at: existingPublishedAt,
    price_mismatch: existingPriceMismatch,
    category_mismatch: existingCategoryMismatch,
    stale_content: existingStaleContent,
  } = existingRows[0];

  const contentFieldsTouched = ["title", "dek", "body", "seo_title", "seo_description", "category_id"].some(
    (key) => req.body[key] !== undefined
  );
  const statusExplicitlySet = req.body.status !== undefined;

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      params.push(req.body[key]);
      updates.push(`${key} = $${params.length}`);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: "No valid fields to update." });
  }

  // Publishing for the first time stamps published_at.
  if (req.body.status === "published") {
    updates.push("published_at = COALESCE(published_at, now())");
  }

  if (
    req.body.status === "published" &&
    currentStatus !== "published" &&
    existingPublishedAt &&
    (existingPriceMismatch || existingCategoryMismatch || existingStaleContent)
  ) {
    updates.push("corrected_at = COALESCE(corrected_at, now())");
  }

  if (currentStatus === "published" && contentFieldsTouched) {
    updates.push("updated_at = now()");
  }

  if (currentStatus === "scheduled") {
    if (statusExplicitlySet && req.body.status !== "scheduled") {
      updates.push("auto_publish_at = NULL");
    } else if (!statusExplicitlySet && contentFieldsTouched) {
      params.push("review");
      updates.push(`status = $${params.length}`);
      updates.push("auto_publish_at = NULL");
    }
  }

  params.push(req.params.id);
  const { rows } = await query(
    `UPDATE articles SET ${updates.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );

  if (rows.length === 0) return res.status(404).json({ error: "Article not found." });
  res.json(rows[0]);
});

router.delete("/:id", async (req, res) => {
  await query("DELETE FROM articles WHERE id = $1", [req.params.id]);
  res.status(204).end();
});

export default router;
