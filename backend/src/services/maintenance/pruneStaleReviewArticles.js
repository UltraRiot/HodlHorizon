// Auto-expiry for News articles stuck in "review" status - closes a real
// gap found during the News backlog investigation: nothing anywhere ever
// removed a held-for-review article, so the 119-article backlog it
// surfaced was free to accumulate silently for nearly a week (Sept 11-17)
// before a human happened to go looking. review_queue_size (contentQualityAudit.js)
// now WARNS when the queue grows unexpectedly, but a warning alone doesn't
// stop a queue from re-accumulating the same way if nobody acts on it -
// this is the other half: articles that are unambiguously too old to be
// worth rescuing get removed automatically instead of waiting on a human.
//
// Scoped to the 4 News categories only (crypto, commodities, stocks,
// indices), not Analysis - News is what this was built to fix (see the
// engagement's "News is the primary product" refocus), and unlike News,
// an Analysis piece is not itself derived from a perishable RSS item with
// its own freshness bar to inherit (see the threshold reasoning below).
// Analysis's review backlog is still covered by review_queue_size's
// growth alert; extending auto-expiry there is a separate call if wanted.
//
// Threshold: 72 hours - deliberately reusing FRESHNESS_WINDOW_HOURS
// (scanAndGenerate.js), not a new number invented for this. A News draft
// is only ever generated from a source item that was itself required to
// be under 72h old at scan time (see filterFreshItems) - so a review-held
// draft that's now ITSELF past 72h old is, by construction, at least as
// stale as the raw wire content this site already refuses to write about.
// Reusing the same bar means "too old to rescue" isn't a second, separately
// guessed opinion about staleness, it's the same one already relied on
// everywhere else in this pipeline.
import { query } from "../../db.js";

export const REVIEW_EXPIRY_HOURS = 72;
export const NEWS_CATEGORY_SLUGS = ["crypto", "commodities", "stocks", "indices"];

// Pure decision function, exported for direct testing without a database -
// same "pure function + thin DB wrapper" split used throughout this
// project (findAnalysisSimilarityMismatch/findExcessiveSimilarityToPriorArticle,
// selectRelatedCoverage/findRelatedCoverage, etc.).
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

  // Persisted into the same content_audit_runs table the weekly audit
  // uses (not a console-only record - see this project's own documented
  // gap where a semantic check's failure reason was only ever visible in
  // console output and lost once the process moved on), so what got
  // auto-expired stays visible via GET /api/admin/content-audit going
  // forward, per category, with zero admin-route changes needed (that
  // route already generalizes over check_name/category_scope).
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
