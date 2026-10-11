import { Router } from "express";
import { query } from "../db.js";
import { perIpPerResourceLimiter } from "../middleware/rateLimit.js";
import { HIDDEN_CATEGORY_SLUGS } from "../services/shared/articleUtils.js";

const router = Router();
const reactionLimiter = perIpPerResourceLimiter({ max: 5 });

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// GET /api/articles?category=crypto&limit=20&offset=0
router.get("/", async (req, res) => {
  const { category, limit = 20, offset = 0 } = req.query;

  const params = [];
  let where = "a.status = 'published'";
  if (category && category !== "all") {
    params.push(category);
    where += ` AND c.slug = $${params.length}`;
  } else {
    params.push(HIDDEN_CATEGORY_SLUGS);
    where += ` AND c.slug != ALL($${params.length}::text[])`;
  }
  params.push(limit, offset);

  const { rows } = await query(
    `SELECT a.id, a.slug, a.title, a.dek, a.read_minutes, a.source_count,
            a.bullish_count, a.bearish_count, a.neutral_count, a.published_at,
            c.slug AS category_slug, c.name AS category_name
     FROM articles a
     JOIN categories c ON c.id = a.category_id
     WHERE ${where}
     ORDER BY a.published_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json(rows.map((r) => ({ ...r, time_ago: timeAgo(r.published_at) })));
});

router.get("/most-read", async (req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.slug, a.title, c.slug AS category_slug, c.name AS category_name,
            COUNT(v.id) AS views
     FROM article_views v
     JOIN articles a ON a.id = v.article_id
     JOIN categories c ON c.id = a.category_id
     WHERE v.viewed_at >= now() - interval '24 hours' AND a.status = 'published'
       AND c.slug != ALL($1::text[])
     GROUP BY a.id, a.slug, a.title, c.slug, c.name
     ORDER BY views DESC
     LIMIT 5`,
    [HIDDEN_CATEGORY_SLUGS]
  );
  res.json(rows);
});

// GET /api/articles/:slug
router.get("/:slug", async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, c.slug AS category_slug, c.name AS category_name
     FROM articles a
     JOIN categories c ON c.id = a.category_id
     WHERE a.slug = $1 AND a.status = 'published'`,
    [req.params.slug]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: "Article not found." });
  }

  const article = rows[0];

  await query("INSERT INTO article_views (article_id) VALUES ($1)", [article.id]);

  const { rows: sources } = await query(
    "SELECT source_name, source_url FROM article_sources WHERE article_id = $1",
    [article.id]
  );

  res.json({ ...article, time_ago: timeAgo(article.published_at), sources });
});

router.get("/:slug/related", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 4, 10);

  const { rows: current } = await query(
    "SELECT id, category_id FROM articles WHERE slug = $1 AND status = 'published'",
    [req.params.slug]
  );
  if (current.length === 0) {
    return res.status(404).json({ error: "Article not found." });
  }
  const { id, category_id } = current[0];

  const { rows } = await query(
    `SELECT a.id, a.slug, a.title, a.published_at,
            c.slug AS category_slug, c.name AS category_name
     FROM articles a
     JOIN categories c ON c.id = a.category_id
     WHERE a.status = 'published' AND a.id != $1 AND a.category_id = $2
     ORDER BY a.published_at DESC
     LIMIT $3`,
    [id, category_id, limit]
  );

  res.json(rows.map((r) => ({ ...r, time_ago: timeAgo(r.published_at) })));
});

router.post("/:id/react", reactionLimiter, async (req, res) => {
  const { type } = req.body;
  const column = { bullish: "bullish_count", bearish: "bearish_count", neutral: "neutral_count" }[type];

  if (!column) {
    return res.status(400).json({ error: "type must be bullish, bearish or neutral." });
  }

  const { rows } = await query(
    `UPDATE articles SET ${column} = ${column} + 1
     WHERE id = $1 AND status = 'published'
     RETURNING bullish_count, bearish_count, neutral_count`,
    [req.params.id]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: "Article not found." });
  }

  res.json(rows[0]);
});

export default router;
