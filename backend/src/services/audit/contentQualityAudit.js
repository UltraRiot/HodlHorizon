// Recurring content-quality audit - re-runs every existing guardrail check
// against the most recently published batch (the last RECENT_DAYS days,
// across every category) and logs pass/fail counts per check into
// content_audit_runs (migrations/020), so failure rates are visible as a
// trend over time instead of only knowable at the moment someone asks.
// Runs weekly (see jobs/scheduler.js) - separate from the interactive,
// on-demand auditPublishedAnalysis.js (which walks the WHOLE Analysis
// backlog per-instrument and is meant for a human to run and read
// directly), though both share the same underlying check functions.
//
// "Most recently published batch" here means everything published in the
// last RECENT_DAYS days, loaded once - the structural clause checks
// (formulaic opening/closing) and the duplicate-in-category self-check
// count matches WITHIN that one already-loaded batch rather than each
// re-querying "the last N published" per article, which would be both
// redundant (same window, refetched dozens of times) and subtly wrong for
// a backlog-style audit (that phrasing means "as of right now," not "as
// of when this particular historical article was published").
import { query } from "../../db.js";
import { findBannedWordViolation, findFormulaicParagraphTransition } from "../ai/provider.js";
import { normalize, jaccardSimilarity, DUPLICATE_SIMILARITY_THRESHOLD } from "../rss/grouping.js";
import { contentLacksCategoryKeywords } from "../shared/articleUtils.js";
import {
  findAnalysisFactMismatch,
  findMissingQualifier,
  findAnalysisDistanceMismatch,
  findAnalysisSimilarityMismatch,
  hasFormulaicOpening,
  hasFormulaicClosing,
} from "../analysis/runAnalysis.js";
import { reconstructSnapshotFromArticleText } from "../analysis/auditPublishedAnalysis.js";

const RECENT_DAYS = 7;

// A current failure rate is only worth flagging against a baseline built
// from at least a few prior runs - one or two runs isn't a baseline, it's
// noise. 1.5x plus a real (not just rounding-error) absolute gap avoids
// flagging a jump from, say, 1/40 to 2/40 as a "spike."
const MIN_PRIOR_RUNS_FOR_BASELINE = 3;
const SPIKE_RATE_MULTIPLIER = 1.5;
const SPIKE_MIN_ABSOLUTE_GAP = 0.05;

// Review-queue backlog size, per category - a gauge, not a pass/fail
// check, so it gets its own comparison logic rather than reusing
// recordCheckResult's rate-vs-historical-average spike detector: a
// backlog is a running accumulation, not a noisy per-batch rate, so
// "did it grow since the last run" is the meaningful question, not "is it
// above its own long-run average" (which would only fire well after a
// backlog had already been accumulating for a while). Real motivation:
// 31 Analysis review-status articles were found sitting untouched with
// zero automated way to notice - see this project's own review-queue
// cleanup that immediately preceded this feature. Both an absolute
// (>= QUEUE_GROWTH_MIN_ABSOLUTE more articles) and a relative (>=50% more
// than last run) jump are required, the same "real gap, not rounding
// noise" reasoning as the rate-based spike check below - except when the
// queue was previously empty, where ANY new backlog at all is worth
// flagging (a 50% relative threshold against zero is meaningless).
const QUEUE_GROWTH_RELATIVE_THRESHOLD = 1.5;
const QUEUE_GROWTH_MIN_ABSOLUTE = 5;

// Exported for direct testing against a real (but disposable, uniquely-
// named) category_scope - the growth comparison genuinely needs the real
// database (it reads back the previous run's row), the same reasoning
// scanAndGenerate.test.js's concurrent-insert test already established
// for this project's one other DB-dependent test.
export async function recordReviewQueueSize(categoryScope, currentSize) {
  await query(
    `INSERT INTO content_audit_runs (check_name, category_scope, checked_count, failed_count, sample_findings)
     VALUES ('review_queue_size', $1, $2, $2, '[]')`,
    [categoryScope, currentSize]
  );

  const { rows: priorRuns } = await query(
    `SELECT failed_count FROM content_audit_runs
     WHERE check_name = 'review_queue_size' AND category_scope IS NOT DISTINCT FROM $1
     ORDER BY run_at DESC
     OFFSET 1 LIMIT 1`,
    [categoryScope]
  );

  let grew = null;
  if (priorRuns.length > 0) {
    const previousSize = priorRuns[0].failed_count;
    const grewEnough = currentSize - previousSize >= QUEUE_GROWTH_MIN_ABSOLUTE;
    const grewRelatively = previousSize === 0 ? currentSize > 0 : currentSize >= previousSize * QUEUE_GROWTH_RELATIVE_THRESHOLD;
    if (grewEnough && grewRelatively) {
      grew = { previousSize, currentSize };
      console.warn(
        `Content quality audit: review queue for "${categoryScope}" grew from ${previousSize} to ${currentSize} since the last run - accumulating faster than usual.`
      );
    }
  }

  return { checkName: "review_queue_size", categoryScope, currentSize, previousRunSize: priorRuns[0]?.failed_count ?? null, grew };
}

async function recordCheckResult(checkName, categoryScope, checkedCount, failedCount, sampleFindings) {
  await query(
    `INSERT INTO content_audit_runs (check_name, category_scope, checked_count, failed_count, sample_findings)
     VALUES ($1, $2, $3, $4, $5)`,
    [checkName, categoryScope, checkedCount, failedCount, JSON.stringify(sampleFindings.slice(0, 5))]
  );

  const { rows: priorRuns } = await query(
    `SELECT checked_count, failed_count FROM content_audit_runs
     WHERE check_name = $1 AND category_scope IS NOT DISTINCT FROM $2
     ORDER BY run_at DESC
     OFFSET 1 LIMIT 20`,
    [checkName, categoryScope]
  );

  let spike = null;
  if (priorRuns.length >= MIN_PRIOR_RUNS_FOR_BASELINE) {
    const totalChecked = priorRuns.reduce((s, r) => s + r.checked_count, 0);
    const totalFailed = priorRuns.reduce((s, r) => s + r.failed_count, 0);
    const baselineRate = totalChecked > 0 ? totalFailed / totalChecked : 0;
    const currentRate = checkedCount > 0 ? failedCount / checkedCount : 0;
    if (currentRate > baselineRate * SPIKE_RATE_MULTIPLIER && currentRate - baselineRate > SPIKE_MIN_ABSOLUTE_GAP) {
      spike = { baselineRate, currentRate, priorRunCount: priorRuns.length };
      console.warn(
        `Content quality audit: "${checkName}"${categoryScope ? ` (${categoryScope})` : ""} failure rate spiked - ${(currentRate * 100).toFixed(0)}% this run vs. a ${(baselineRate * 100).toFixed(0)}% baseline over the last ${priorRuns.length} runs.`
      );
    }
  }

  return { checkName, categoryScope, checkedCount, failedCount, spike };
}

export async function runContentQualityAudit() {
  const { rows: articles } = await query(
    `SELECT a.id, a.title, a.body, a.category_id, a.analysis_symbol, a.published_at, c.slug AS category_slug, c.name AS category_name
     FROM articles a JOIN categories c ON c.id = a.category_id
     WHERE a.status = 'published' AND a.published_at >= now() - ($1 || ' days')::interval
     ORDER BY a.published_at ASC`,
    [RECENT_DAYS]
  );

  const results = [];

  // --- Banned words: every category, every article in the batch. ---
  {
    let failed = 0;
    const samples = [];
    for (const a of articles) {
      const note = findBannedWordViolation(a.body);
      if (note) {
        failed += 1;
        samples.push({ id: a.id, category: a.category_slug, note });
      }
    }
    results.push(await recordCheckResult("banned_words", null, articles.length, failed, samples));
  }

  // --- Formulaic paragraph-2 transition ("This X highlights/indicates/
  // suggests...") - every category, same as banned_words above. Added
  // after a real measurement (60 recent News articles, 15/60 = 25%) found
  // this incidence worth a real check rather than just a prompt note - see
  // findFormulaicParagraphTransition's own comment in provider.js for the
  // real examples that motivated it. ---
  {
    let failed = 0;
    const samples = [];
    for (const a of articles) {
      const note = findFormulaicParagraphTransition(a.body);
      if (note) {
        failed += 1;
        samples.push({ id: a.id, category: a.category_slug, note });
      }
    }
    results.push(await recordCheckResult("formulaic_transition", null, articles.length, failed, samples));
  }

  // --- Category-mismatch keyword check, retroactively, per category. This
  // is the SAME deterministic keyword gate scanAndGenerate.js already runs
  // pre-publish (contentLacksCategoryKeywords, articleUtils.js) - auditing
  // it here too catches drift from a live gap the pre-publish check let
  // through (a keyword still missing from CATEGORY_KEYWORDS, the exact
  // real gap that motivated articles #434/#440's fixes) rather than only
  // ever finding it the next time a human manually pulls rejected drafts.
  // Categories with no keyword list (Analysis) always score 0 failures -
  // see contentLacksCategoryKeywords's own null-list short-circuit. ---
  {
    const byCategory = new Map();
    for (const a of articles) {
      if (!byCategory.has(a.category_name)) byCategory.set(a.category_name, []);
      byCategory.get(a.category_name).push(a);
    }
    for (const [categoryName, list] of byCategory) {
      let failed = 0;
      const samples = [];
      for (const a of list) {
        if (contentLacksCategoryKeywords(categoryName, a.title, a.body)) {
          failed += 1;
          if (samples.length < 5) samples.push({ id: a.id, title: a.title });
        }
      }
      results.push(await recordCheckResult("category_mismatch_keywords", categoryName, list.length, failed, samples));
    }
  }

  // --- Duplicate-in-category (self-check within this batch): every pair
  // of same-category articles compared once, same threshold as the live
  // pre-publish gate (articleUtils.js's isDuplicateInCategory). Counts
  // ARTICLES that matched at least one other, not pairs, so this is
  // directly comparable to "N of M articles were a near-duplicate of
  // something else in the batch." ---
  {
    const byCategory = new Map();
    for (const a of articles) {
      if (!byCategory.has(a.category_slug)) byCategory.set(a.category_slug, []);
      byCategory.get(a.category_slug).push(a);
    }
    for (const [categorySlug, list] of byCategory) {
      let failed = 0;
      const samples = [];
      const flagged = new Set();
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const sim = jaccardSimilarity(normalize(list[i].body), normalize(list[j].body));
          if (sim >= DUPLICATE_SIMILARITY_THRESHOLD) {
            if (!flagged.has(list[i].id)) { flagged.add(list[i].id); failed += 1; }
            if (!flagged.has(list[j].id)) { flagged.add(list[j].id); failed += 1; }
            if (samples.length < 5) samples.push({ ids: [list[i].id, list[j].id], similarity: sim.toFixed(2) });
          }
        }
      }
      results.push(await recordCheckResult("duplicate_in_category", categorySlug, list.length, failed, samples));
    }
  }

  // --- Analysis-only checks: fact/qualifier/distance-direction (against a
  // best-effort snapshot reconstructed from the article's own text, same
  // as auditPublishedAnalysis.js - see its comment on why that's the only
  // ground truth left for already-published content), the prior-article
  // similarity check, and the two structural clause checks (counted
  // within THIS batch, not a separate re-query - see file header). ---
  {
    const analysisArticles = articles.filter((a) => a.category_slug === "analysis");
    const checks = { fact_or_qualifier_mismatch: [], distance_or_direction_mismatch: [], similarity_to_prior: [], formulaic_opening: [], formulaic_closing: [] };

    // Chronological per-symbol prior-article tracking for the similarity
    // check, mirroring the live gate's own "compare against the last
    // published article for this instrument" - built from this batch
    // alone (a batch's very first article for a symbol has no in-batch
    // prior and is skipped for this one check, same as a real first-ever
    // piece would be).
    const lastBySymbol = new Map();

    for (const a of analysisArticles) {
      const snapshot = reconstructSnapshotFromArticleText(a.analysis_symbol, a.body);
      if (snapshot) {
        const factNote = findAnalysisFactMismatch(a.title, a.body, snapshot) || findMissingQualifier(a.title, a.body, snapshot);
        if (factNote) checks.fact_or_qualifier_mismatch.push({ id: a.id, note: factNote });

        const distanceNote = findAnalysisDistanceMismatch(a.body, snapshot);
        if (distanceNote) checks.distance_or_direction_mismatch.push({ id: a.id, note: distanceNote });
      }

      const prior = lastBySymbol.get(a.analysis_symbol);
      if (prior) {
        const simNote = findAnalysisSimilarityMismatch(a.body, prior);
        if (simNote) checks.similarity_to_prior.push({ id: a.id, note: simNote });
      }
      lastBySymbol.set(a.analysis_symbol, a);

      if (hasFormulaicOpening(a.body)) checks.formulaic_opening.push({ id: a.id });
      if (hasFormulaicClosing(a.body)) checks.formulaic_closing.push({ id: a.id });
    }

    for (const [checkName, findings] of Object.entries(checks)) {
      results.push(await recordCheckResult(checkName, "analysis", analysisArticles.length, findings.length, findings));
    }
  }

  // --- Review-queue backlog size, per category. Deliberately NOT scoped
  // to the RECENT_DAYS batch above - a stuck review article can be far
  // older than 7 days (that's the whole problem), so this queries the
  // real, current, total count regardless of when each one was created. ---
  {
    const { rows: queueRows } = await query(
      `SELECT c.slug, COUNT(*)::int AS n FROM articles a
       JOIN categories c ON c.id = a.category_id
       WHERE a.status = 'review'
       GROUP BY c.slug`
    );
    const queueByCategory = new Map(queueRows.map((r) => [r.slug, r.n]));
    const { rows: allCategories } = await query("SELECT slug FROM categories");
    for (const { slug } of allCategories) {
      results.push(await recordReviewQueueSize(slug, queueByCategory.get(slug) || 0));
    }
  }

  return { batchSize: articles.length, windowDays: RECENT_DAYS, results };
}
