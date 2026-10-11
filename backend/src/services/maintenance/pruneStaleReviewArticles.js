import { query } from "../../db.js";

export const REVIEW_EXPIRY_HOURS = 72;
export const NEWS_CATEGORY_SLUGS = ["crypto", "commodities", "stocks", "indices"];

export function findExpiredReviewArticles(articles, now = new Date(), thresholdHours = REVIEW_EXPIRY_HOURS) {
  const cutoff = now.getTime() - thresholdHours * 60 * 60 * 1000;
  return articles.filter((a) => new Date(a.created_at).getTime() < cutoff);
}

export async function pruneStaleReviewArticles() {
  const { rows: candidates } = await query(
    `SELECT a.id, a.title, a.created_at, c.slug AS category_slug,
            a.category_mismatch_note, a.price_mismatch_note, a.stale_content_note
     FROM articles a JOIN categories c ON c.id = a.category_id
     WHERE a.status = 'review' AND c.slug = ANY($1)`,
    [NEWS_CATEGORY_SLUGS]
  );

  const expired = findExpiredReviewArticles(candidates);
  const byCategory = new Map();
  for (const a of expired) {
    if (!byCategory.has(a.category_slug)) byCategory.set(a.category_slug, []);
    byCategory.get(a.category_slug).push(a);
  }

  if (expired.length > 0) {
    await query("DELETE FROM articles WHERE id = ANY($1)", [expired.map((a) => a.id)]);
    for (const a of expired) {
      const reason = a.category_mismatch_note || a.price_mismatch_note || a.stale_content_note || "no automated flag - likely held on a semantic check that isn't persisted (see verifyBody)";
      console.warn(
        `Review expiry: deleted "${a.title}" (${a.category_slug}, id ${a.id}) - held in review past ${REVIEW_EXPIRY_HOURS}h with no resolution. Original hold reason: ${reason}`
      );
    }
  }

  for (const slug of NEWS_CATEGORY_SLUGS) {
    const categoryExpired = byCategory.get(slug) || [];
    await query(
      `INSERT INTO content_audit_runs (check_name, category_scope, checked_count, failed_count, sample_findings)
       VALUES ('review_queue_expired', $1, $2, $3, $4)`,
      [
        slug,
        candidates.filter((a) => a.category_slug === slug).length,
        categoryExpired.length,
        JSON.stringify(categoryExpired.slice(0, 5).map((a) => ({ id: a.id, title: a.title }))),
      ]
    );
  }

  return { reviewed: candidates.length, expired: expired.length, byCategory: Object.fromEntries([...byCategory].map(([k, v]) => [k, v.length])) };
}
