// Regression tests for the News review-queue auto-expiry - built after
// confirming (by reading scanAndGenerate.js and jobs/scheduler.js) that no
// such expiry existed anywhere: a held-for-review article accumulated
// indefinitely, which is exactly how the real 119-article News backlog
// went unnoticed for nearly a week (Sept 11-17) before a human happened to
// audit it. Threshold reuses FRESHNESS_WINDOW_HOURS (72h), not a new
// number - see this file's own header comment for why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { query } from "../../db.js";
import { findExpiredReviewArticles, pruneStaleReviewArticles, REVIEW_EXPIRY_HOURS, NEWS_CATEGORY_SLUGS } from "./pruneStaleReviewArticles.js";
import { insertArticle } from "../shared/articleUtils.js";

test("findExpiredReviewArticles flags an article older than the threshold", () => {
  const now = new Date("2026-09-19T12:00:00Z");
  const articles = [{ id: 1, created_at: new Date("2026-09-15T00:00:00Z") }]; // ~108h old
  const expired = findExpiredReviewArticles(articles, now);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].id, 1);
});

test("findExpiredReviewArticles does not flag an article still within the threshold", () => {
  const now = new Date("2026-09-19T12:00:00Z");
  const articles = [{ id: 1, created_at: new Date("2026-09-18T00:00:00Z") }]; // 36h old
  assert.equal(findExpiredReviewArticles(articles, now).length, 0);
});

test("findExpiredReviewArticles is exactly threshold-accurate at the 72h boundary", () => {
  const now = new Date("2026-09-19T12:00:00Z");
  const justUnder = [{ id: 1, created_at: new Date(now.getTime() - (REVIEW_EXPIRY_HOURS - 1) * 3600 * 1000) }];
  const justOver = [{ id: 2, created_at: new Date(now.getTime() - (REVIEW_EXPIRY_HOURS + 1) * 3600 * 1000) }];
  assert.equal(findExpiredReviewArticles(justUnder, now).length, 0);
  assert.equal(findExpiredReviewArticles(justOver, now).length, 1);
});

test("NEWS_CATEGORY_SLUGS excludes analysis - the auto-expiry is scoped to News only", () => {
  assert.equal(NEWS_CATEGORY_SLUGS.includes("analysis"), false);
  assert.deepEqual([...NEWS_CATEGORY_SLUGS].sort(), ["commodities", "crypto", "indices", "stocks"]);
});

// Real DB-backed test, same pattern as scanAndGenerate.test.js's
// concurrent-insert test and contentQualityAudit.test.js's queue-growth
// tests: this needs the real database, since pruneStaleReviewArticles()
// reads back created_at and issues a real DELETE.
test("pruneStaleReviewArticles deletes a real News review article past the threshold and leaves a fresh one alone", async () => {
  const { rows: catRows } = await query("SELECT id FROM categories WHERE slug = 'crypto'");
  const categoryId = catRows[0].id;

  const makeArticle = async (title) =>
    insertArticle({
      slug: `test-expiry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title,
      dek: "Test dek.",
      body: "Test body.\n\nSecond paragraph.\n\nThird paragraph.",
      categoryId,
      status: "review",
      seoTitle: "Test SEO title",
      seoDescription: "Test SEO description that is long enough to pass validation checks comfortably.",
      readMinutes: 1,
      sourceCount: 1,
      aiProvider: "mock",
      publishedAt: null,
    });

  const staleId = await makeArticle("Test stale review article");
  const freshId = await makeArticle("Test fresh review article");

  try {
    await query("UPDATE articles SET created_at = now() - interval '100 hours' WHERE id = $1", [staleId]);
    // freshId keeps its real (just-now) created_at.

    const result = await pruneStaleReviewArticles();
    assert.ok(result.expired >= 1, "expected at least the stale test article to be counted as expired");

    const { rows: staleCheck } = await query("SELECT id FROM articles WHERE id = $1", [staleId]);
    assert.equal(staleCheck.length, 0, "the stale review article should have been deleted");

    const { rows: freshCheck } = await query("SELECT id FROM articles WHERE id = $1", [freshId]);
    assert.equal(freshCheck.length, 1, "the fresh review article should NOT have been deleted");
  } finally {
    await query("DELETE FROM articles WHERE id = $1", [freshId]);
    // content_audit_runs rows this call wrote are left in place deliberately -
    // they're real, accurate audit history (an actual prune run happened),
    // the same reasoning contentQualityAudit.js's own live-verification run
    // earlier in this project was never cleaned up either.
  }
});
