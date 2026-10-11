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

const MIN_PRIOR_RUNS_FOR_BASELINE = 3;
const SPIKE_RATE_MULTIPLIER = 1.5;
const SPIKE_MIN_ABSOLUTE_GAP = 0.05;

const QUEUE_GROWTH_RELATIVE_THRESHOLD = 1.5;
const QUEUE_GROWTH_MIN_ABSOLUTE = 5;

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

  {
    const analysisArticles = articles.filter((a) => a.category_slug === "analysis");
    const checks = { fact_or_qualifier_mismatch: [], distance_or_direction_mismatch: [], similarity_to_prior: [], formulaic_opening: [], formulaic_closing: [] };

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
