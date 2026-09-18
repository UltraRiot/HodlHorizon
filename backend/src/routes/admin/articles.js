// Admin article management: list everything (any status), edit, publish,
// unpublish, delete. This is what powers the "Latest AI-generated articles"
// table in the admin dashboard.
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
  // Joined the same way the list endpoint (GET /) already is, so callers
  // like the admin preview panel get category_name/category_slug without
  // a second round trip.
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

// PATCH /api/admin/articles/:id
// Body can include any of: title, dek, body, status, seo_title, seo_description, category_id
// A "hold" action from the admin UI is just this same endpoint with
// { status: "review" } - see the scheduled-article handling below for what
// that does when the article is currently "scheduled".
router.patch("/:id", async (req, res) => {
  const allowed = ["title", "dek", "body", "status", "seo_title", "seo_description", "category_id"];
  const updates = [];
  const params = [];

  const { rows: existingRows } = await query(
    "SELECT status, published_at, price_mismatch, category_mismatch FROM articles WHERE id = $1",
    [req.params.id]
  );
  if (existingRows.length === 0) return res.status(404).json({ error: "Article not found." });
  const { status: currentStatus, published_at: existingPublishedAt, price_mismatch: existingPriceMismatch, category_mismatch: existingCategoryMismatch } = existingRows[0];

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

  // Trust/transparency signal (corrected_at, migrations/016): a real
  // republish, not a first-time publish - this article already went live
  // once (published_at already set) and is currently sitting somewhere
  // other than "published" (review/scheduled/draft) flagged by the
  // price/category-mismatch guardrails, and a human is now sending it
  // back out. Deliberately does NOT fire on a plain first-time publish
  // (published_at was null) or on a never-flagged article moving out of
  // review for an unrelated reason (an editor's own hold, say) - only the
  // specific "this was live, got pulled for a real caught issue, and is
  // going live again" transition counts as a correction worth disclosing.
  // Set once and never touched again after that (see the migration).
  if (
    req.body.status === "published" &&
    currentStatus !== "published" &&
    existingPublishedAt &&
    (existingPriceMismatch || existingCategoryMismatch)
  ) {
    updates.push("corrected_at = COALESCE(corrected_at, now())");
  }

  // dateModified in the NewsArticle JSON-LD (pages/article/[slug].js) reads
  // this column - only bumped for a PUBLISHED article's content changing,
  // since that's the only case a real visitor/Google could have already
  // seen the old version. Editing something still in "review"/"draft"
  // isn't a "modification" of anything that was ever live.
  if (currentStatus === "published" && contentFieldsTouched) {
    updates.push("updated_at = now()");
  }

  // Delayed auto-publish (services/rss/scanAndGenerate.js): a "scheduled"
  // article's timer only stays live untouched. A human editing its content,
  // or explicitly moving it off "scheduled" (the "hold" action sends
  // status: "review"), cancels it - the cron tick's own
  // "WHERE status = 'scheduled'" check is what actually skips a held/edited
  // article, so clearing auto_publish_at here is mostly for a clean read on
  // the article itself, not a second source of truth for the tick.
  if (currentStatus === "scheduled") {
    if (statusExplicitlySet && req.body.status !== "scheduled") {
      updates.push("auto_publish_at = NULL");
    } else if (!statusExplicitlySet && contentFieldsTouched) {
      // Implicit cancellation: content changed without an explicit status
      // change - treat that the same as an explicit hold rather than
      // silently leaving the timer running against edited content.
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
