import { query } from "../../db.js";
import { getMarketSnapshot, getCachedTechnicalSnapshot } from "../marketData/prices.js";
import { formatMarketValue } from "../marketData/formatMarketValue.js";
import { generateAnalysis, generateAnalysisFreshnessCheck } from "../ai/provider.js";
import { decideArticleStatus } from "../rss/scanAndGenerate.js";
import { normalize, jaccardSimilarity } from "../rss/grouping.js";
import { OPENING_TEMPLATES, CLOSING_DIRECTIVES, selectTemplate } from "../ai/analysisTemplates.js";
import {
  getSetting,
  uniqueSlug,
  articlesCreatedToday,
  isDuplicateInCategory,
  insertArticle,
  describeGenerationError,
  isWeekendUTC,
} from "../shared/articleUtils.js";

const NOT_FINANCIAL_ADVICE_DISCLAIMER = "This is not financial advice; readers should draw their own conclusions.";

function ensureNotFinancialAdviceDisclaimer(body) {
  if (body.toLowerCase().includes("financial advice")) return body;
  return `${body}\n\n${NOT_FINANCIAL_ADVICE_DISCLAIMER}`;
}

export const WATCHLIST = [
  { symbol: "BTC", kind: "crypto", coinGeckoId: "bitcoin" },
  { symbol: "ETH", kind: "crypto", coinGeckoId: "ethereum" },
  { symbol: "Gold", kind: "cached", cacheKey: "gold" },
  { symbol: "S&P 500", kind: "cached", cacheKey: "spy" },
  { symbol: "Oil (WTI)", kind: "cached", cacheKey: "wti" },
];

const RELATED_COVERAGE_CONFIG = {
  BTC: { categorySlug: "crypto", keywords: ["bitcoin", "btc"] },
  ETH: { categorySlug: "crypto", keywords: ["ethereum", "eth"] },
  Gold: { categorySlug: "commodities", keywords: ["gold"] },
  "S&P 500": { categorySlug: "indices", keywords: ["s&p 500", "s&p500", "s&p"] },
  "Oil (WTI)": { categorySlug: "commodities", keywords: ["oil", "wti", "crude"] },
};

export function selectRelatedCoverage(candidates, excludeIds) {
  const hasEnoughSources = (list) => new Set(list.flatMap((a) => a.sources)).size >= 2;

  const notRecentlyUsed = candidates.filter((a) => !excludeIds.has(a.id));
  if (notRecentlyUsed.length > 0 && hasEnoughSources(notRecentlyUsed)) {
    return notRecentlyUsed.map(({ id, title, dek, sources }) => ({ id, title, dek, sources }));
  }

  return hasEnoughSources(candidates)
    ? candidates.map(({ id, title, dek, sources }) => ({ id, title, dek, sources }))
    : [];
}

async function findRelatedCoverage(symbol, excludeIds = new Set(), withinHours = 48) {
  const config = RELATED_COVERAGE_CONFIG[symbol];
  if (!config) return [];

  const { rows: catRows } = await query("SELECT id FROM categories WHERE slug = $1", [config.categorySlug]);
  if (catRows.length === 0) return [];

  const { rows: articleRows } = await query(
    `SELECT id, title, dek FROM articles
     WHERE category_id = $1 AND status = 'published'
       AND published_at >= now() - ($2 || ' hours')::interval
     ORDER BY published_at DESC
     LIMIT 10`,
    [catRows[0].id, withinHours]
  );

  const matching = articleRows.filter((a) => {
    const haystack = `${a.title} ${a.dek}`.toLowerCase();
    return config.keywords.some((kw) => haystack.includes(kw));
  });
  if (matching.length === 0) return [];

  const candidates = [];
  for (const a of matching) {
    const { rows: sourceRows } = await query(
      "SELECT DISTINCT source_name FROM article_sources WHERE article_id = $1",
      [a.id]
    );
    candidates.push({ id: a.id, title: a.title, dek: a.dek, sources: sourceRows.map((s) => s.source_name) });
  }

  return selectRelatedCoverage(candidates, excludeIds);
}

async function getRecentlyUsedCoverageIds(symbol, limit = 5) {
  const { rows } = await query(
    `SELECT used_coverage_article_ids FROM articles
     WHERE analysis_symbol = $1 AND status = 'published' AND used_coverage_article_ids IS NOT NULL
     ORDER BY published_at DESC LIMIT $2`,
    [symbol, limit]
  );
  const ids = new Set();
  for (const row of rows) {
    for (const id of row.used_coverage_article_ids || []) ids.add(id);
  }
  return ids;
}

async function getRecentlyUsedOpeningTemplateIds(categoryId, limit = 5) {
  const { rows } = await query(
    `SELECT opening_template_id FROM articles
     WHERE category_id = $1 AND status = 'published' AND opening_template_id IS NOT NULL
     ORDER BY published_at DESC LIMIT $2`,
    [categoryId, limit]
  );
  return rows.map((r) => r.opening_template_id);
}

async function getRecentlyUsedClosingTemplateIds(categoryId, limit = 5) {
  const { rows } = await query(
    `SELECT closing_template_id FROM articles
     WHERE category_id = $1 AND status = 'published' AND closing_template_id IS NOT NULL
     ORDER BY published_at DESC LIMIT $2`,
    [categoryId, limit]
  );
  return rows.map((r) => r.closing_template_id);
}

async function findUpcomingHighImpactEvent(withinDays = 5) {
  const { rows } = await query(
    `SELECT title, event_time FROM calendar_events
     WHERE impact = 'high' AND event_time > now() AND event_time <= now() + ($1 || ' days')::interval
     ORDER BY event_time ASC
     LIMIT 1`,
    [withinDays]
  );
  if (rows.length === 0) return null;
  const days = Math.max(1, Math.round((new Date(rows[0].event_time).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  return `${rows[0].title} in ${days} day${days === 1 ? "" : "s"}`;
}

const ANALYSIS_PRICE_TOLERANCE = 0.05;
const NUMBER_RE = /\$?\s?([0-9][0-9,]*(?:\.[0-9]+)?)/g;

function closestPriceMatch(text, truePrice) {
  const candidates = [...(text || "").matchAll(NUMBER_RE)]
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (candidates.length === 0) return null;

  return candidates.reduce(
    (best, n) => {
      const diff = Math.abs(n - truePrice) / truePrice;
      return diff < best.diff ? { value: n, diff } : best;
    },
    { value: null, diff: Infinity }
  );
}

export function findAnalysisFactMismatch(title, body, snapshot) {
  const truePrice = Number(snapshot.price);
  if (!Number.isFinite(truePrice) || truePrice <= 0) return null;

  const bodyClosest = closestPriceMatch(body, truePrice);
  if (bodyClosest && bodyClosest.diff > ANALYSIS_PRICE_TOLERANCE) {
    return `No figure in the body is close to the real computed price (${formatMarketValue(truePrice, snapshot.assetClass)}) it was given for ${snapshot.symbol} - closest stated number was ${bodyClosest.value.toLocaleString("en-US")} (${Math.round(bodyClosest.diff * 100)}% off) - verify before publishing.`;
  }

  const titleClosest = closestPriceMatch(title, truePrice);
  if (titleClosest && titleClosest.diff > ANALYSIS_PRICE_TOLERANCE) {
    return `The title states ${titleClosest.value.toLocaleString("en-US")}, which is not close to the real computed price (${formatMarketValue(truePrice, snapshot.assetClass)}) for ${snapshot.symbol} (${Math.round(titleClosest.diff * 100)}% off) - verify before publishing.`;
  }

  return null;
}

export function findMissingQualifier(title, body, snapshot) {
  const match = /\(([^)]+)\)\s*$/.exec(snapshot.symbol || "");
  if (!match) return null;

  const qualifier = match[1];
  const haystack = `${title || ""} ${body || ""}`;
  if (haystack.includes(`(${qualifier})`)) return null;

  const bareSymbol = snapshot.symbol.slice(0, match.index).trim();
  return `The symbol "${snapshot.symbol}" was given, but its "(${qualifier})" qualifier doesn't appear anywhere in the generated title or body - it may be describing ${qualifier}'s own ETF price (${formatMarketValue(snapshot.price, snapshot.assetClass)}) as if it were the real ${bareSymbol} price. Verify before publishing.`;
}

const DISTANCE_TOLERANCE_PP = 0.3;
const DISTANCE_CLAIM_RE = /(\d+(?:\.\d+)?)\s?%\s*(?:away\s+from|above|below|of|from)?\s*(?:(?:its|the)\s+)?(support|resistance)(?:\s+level)?\b/gi;

const DOLLAR_DISTANCE_CLAIM_RE = /\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(above|below|shy of|away from)\s*(?:(?:its|the)\s+)?(?:\w+\s+)?(support|resistance)(?:\s+level)?\b/gi;
const DOLLAR_DISTANCE_SIGN = { above: 1, below: -1, "shy of": -1 };

export function findAnalysisDistanceMismatch(body, snapshot) {
  const price = Number(snapshot.price);
  const support = Number(snapshot.support);
  const resistance = Number(snapshot.resistance);
  if (![price, support, resistance].every((n) => Number.isFinite(n) && n > 0)) return null;

  const levelValue = { support, resistance };
  const realPercent = {
    support: (Math.abs(price - support) / price) * 100,
    resistance: (Math.abs(resistance - price) / price) * 100,
  };

  for (const claim of (body || "").matchAll(DISTANCE_CLAIM_RE)) {
    const stated = Number(claim[1]);
    const level = claim[2].toLowerCase();
    if (!Number.isFinite(stated)) continue;

    const real = realPercent[level];
    const diff = Math.abs(stated - real);
    if (diff > DISTANCE_TOLERANCE_PP) {
      return `Body claims price is ${stated}% from ${level}, but the real figure computed from the given price/${level} is ${real.toFixed(1)}% (off by ${diff.toFixed(1)} percentage points) - verify before publishing.`;
    }
  }

  for (const claim of (body || "").matchAll(DOLLAR_DISTANCE_CLAIM_RE)) {
    const statedAmount = Number(claim[1].replace(/,/g, ""));
    const direction = claim[2].toLowerCase();
    const level = claim[3].toLowerCase();
    if (!Number.isFinite(statedAmount)) continue;

    const actualDiff = price - levelValue[level];
    const expectedSign = DOLLAR_DISTANCE_SIGN[direction];
    if (expectedSign !== undefined) {
      const actualSign = actualDiff >= 0 ? 1 : -1;
      if (actualSign !== expectedSign) {
        const actualWord = actualSign === 1 ? "above" : "below";
        return `Body claims price is $${statedAmount.toLocaleString("en-US")} ${direction} ${level}, but price (${formatMarketValue(price, snapshot.assetClass)}) is actually ${actualWord} ${level} (${formatMarketValue(levelValue[level], snapshot.assetClass)}), not ${direction} it - the direction is backwards, verify before publishing.`;
      }
    }

    const statedAsPercent = (statedAmount / price) * 100;
    const real = realPercent[level];
    const diff = Math.abs(statedAsPercent - real);
    if (diff > DISTANCE_TOLERANCE_PP) {
      return `Body claims price is $${statedAmount.toLocaleString("en-US")} ${direction} ${level} (~${statedAsPercent.toFixed(1)}%), but the real distance computed from the given price/${level} is ${real.toFixed(1)}% - verify before publishing.`;
    }
  }

  return null;
}

const SIMILARITY_TO_PRIOR_THRESHOLD = 0.55;

export function findAnalysisSimilarityMismatch(body, priorArticle) {
  if (!priorArticle) return null;

  const similarity = jaccardSimilarity(normalize(body), normalize(priorArticle.body));
  if (similarity < SIMILARITY_TO_PRIOR_THRESHOLD) return null;

  return `This draft is ${Math.round(similarity * 100)}% similar (word-overlap) to the last published analysis for this instrument (article ${priorArticle.id}, "${priorArticle.title}") - reads as the same piece reworded rather than a fresh take. Vary the structure, opening, and phrasing, and drop or explicitly attribute ("as previously reported") any repeated fact that isn't new.`;
}

async function getLastPublishedArticleForSymbol(symbol) {
  const { rows } = await query(
    `SELECT id, title, body FROM articles
     WHERE analysis_symbol = $1 AND status = 'published'
     ORDER BY published_at DESC
     LIMIT 1`,
    [symbol]
  );
  return rows[0] || null;
}

const RECENT_CATEGORY_SAMPLE = 10;
const REPEATED_CLAUSE_THRESHOLD = 3;

const OPENING_CLAUSE_RE = /\b(?:is currently priced at|is priced at|is currently trading at|current price (?:is|stands at))\b.{0,50}\b(?:maintaining|showing|reflecting)\s+a\s+(?:bullish|bearish)\s+trend\b/i;

export function hasFormulaicOpening(body) {
  const firstParagraph = (body || "").split("\n\n")[0] || "";
  return OPENING_CLAUSE_RE.test(firstParagraph);
}

const WRAPUP_STARTER_RE = /^(overall|in summary|in synthesis|taken together|taking into account|together|considering(?:\s+these\s+factors|\s+the\s+current|\s+all)?|to summarize|altogether)\b/i;
const CORE_TERM_RE = /\b(rsi|support|resistance)\b/i;

export function extractClosingSummaryParagraph(body) {
  const paragraphs = (body || "").split("\n\n").filter((p) => p.trim().length > 10);
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    if (!/financial advice/i.test(paragraphs[i])) return paragraphs[i];
  }
  return paragraphs[paragraphs.length - 1] || "";
}

export function hasFormulaicClosing(body) {
  const summary = extractClosingSummaryParagraph(body).trim();
  return WRAPUP_STARTER_RE.test(summary) && CORE_TERM_RE.test(summary);
}

async function recentSameCategoryBodies(categoryId, limit = RECENT_CATEGORY_SAMPLE) {
  const { rows } = await query(
    `SELECT body FROM articles WHERE category_id = $1 AND status = 'published' ORDER BY published_at DESC LIMIT $2`,
    [categoryId, limit]
  );
  return rows.map((r) => r.body);
}

async function findRepeatedOpeningClause(body, categoryId) {
  if (!hasFormulaicOpening(body)) return null;
  const recentBodies = await recentSameCategoryBodies(categoryId);
  const matchCount = recentBodies.filter(hasFormulaicOpening).length;
  if (matchCount < REPEATED_CLAUSE_THRESHOLD) return null;
  return `This draft opens with the same "[instrument] is currently priced at $X, maintaining a bullish/bearish trend..." template as ${matchCount} of the last ${recentBodies.length} published articles in this category - vary the opening; don't lead with the price-and-trend template every time.`;
}

async function findRepeatedClosingClause(body, categoryId) {
  if (!hasFormulaicClosing(body)) return null;
  const recentBodies = await recentSameCategoryBodies(categoryId);
  const matchCount = recentBodies.filter(hasFormulaicClosing).length;
  if (matchCount < REPEATED_CLAUSE_THRESHOLD) return null;
  return `This draft's closing paragraph opens with a wrap-up transition word ("Overall," "In summary," etc.) immediately restating price/RSI/support-resistance - the same structural pattern as ${matchCount} of the last ${recentBodies.length} published articles in this category. Skip the "Overall/In summary" transition, or make the closing point something other than a restatement of numbers already given.`;
}

export async function verifyAnalysisDraft(title, body, snapshot, symbol, categoryId, { includeSemanticFreshnessCheck = false } = {}) {
  const deterministicFailure =
    findAnalysisFactMismatch(title, body, snapshot) ||
    findMissingQualifier(title, body, snapshot) ||
    findAnalysisDistanceMismatch(body, snapshot);
  if (deterministicFailure) return deterministicFailure;

  const prior = await getLastPublishedArticleForSymbol(symbol);
  const similarityFailure = findAnalysisSimilarityMismatch(body, prior);
  if (similarityFailure) return similarityFailure;

  const structuralFailure = (await findRepeatedOpeningClause(body, categoryId)) || (await findRepeatedClosingClause(body, categoryId));
  if (structuralFailure) return structuralFailure;

  if (includeSemanticFreshnessCheck && prior) {
    const { restates_stale_fact, reason } = await generateAnalysisFreshnessCheck({ body, priorArticleBody: prior.body });
    if (restates_stale_fact) {
      return `An independent check found this draft restates a fact from the last published ${symbol} analysis (article ${prior.id}) without flagging it as prior coverage: ${reason}`;
    }
  }

  return null;
}

async function getLastSnapshot(symbol) {
  const { rows } = await query("SELECT * FROM analysis_snapshots WHERE symbol = $1", [symbol]);
  return rows[0] || null;
}

async function saveSnapshot(symbol, snap) {
  await query(
    `INSERT INTO analysis_snapshots (symbol, price, rsi_14, support, resistance, trend, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (symbol) DO UPDATE
       SET price = $2, rsi_14 = $3, support = $4, resistance = $5, trend = $6, updated_at = now()`,
    [symbol, snap.price, snap.rsi_14, snap.support, snap.resistance, snap.trend]
  );
}

export function movedMeaningfully(prev, curr) {
  if (!prev) return true;

  const priceChangePct = Math.abs((curr.price - Number(prev.price)) / Number(prev.price)) * 100;
  if (priceChangePct >= 2) return true;

  const zone = (rsi) => (rsi >= 70 ? "over" : rsi <= 30 ? "under" : "neutral");
  if (zone(prev.rsi_14) !== zone(curr.rsi_14)) return true;

  if (curr.price > Number(prev.resistance) || curr.price < Number(prev.support)) return true;

  if (prev.trend && curr.trend !== prev.trend) return true;

  return false;
}

export async function runAnalysisScan() {
  const { rows: catRows } = await query("SELECT id FROM categories WHERE slug = 'analysis'");
  if (catRows.length === 0) {
    console.error("Analysis job: no 'analysis' category in the database - run migrations/seed first.");
    return { generated: 0, skipped: 0 };
  }
  const categoryId = catRows[0].id;

  const cap = Number(await getSetting("daily_cap_analysis", 2));
  let remaining = cap - (await articlesCreatedToday(categoryId));
  const autoPublish = (await getSetting("auto_publish", "true")) === "true";

  let generated = 0;
  let skipped = 0;
  const weekend = isWeekendUTC();

  for (const asset of WATCHLIST) {
    if (remaining <= 0) break;

    if (asset.kind === "cached" && weekend) {
      skipped += 1;
      continue;
    }

    let snapshot;
    if (asset.kind === "cached") {
      snapshot = await getCachedTechnicalSnapshot(asset.cacheKey);
      if (!snapshot) {
        console.log(`Analysis job: skipping ${asset.symbol} - market_data_cache row for "${asset.cacheKey}" is missing, failed, or stale.`);
        skipped += 1;
        continue;
      }
    } else {
      try {
        snapshot = await getMarketSnapshot(asset.coinGeckoId);
      } catch (err) {
        console.error(`Analysis job: could not fetch snapshot for ${asset.symbol}: ${err.message}`);
        skipped += 1;
        continue;
      }
    }
    snapshot.symbol = asset.symbol;

    const prev = await getLastSnapshot(asset.symbol);
    if (!movedMeaningfully(prev, snapshot)) {
      skipped += 1;
      continue;
    }

    const [openingUsedIds, closingUsedIds, coverageUsedIds, calendarContext] = await Promise.all([
      getRecentlyUsedOpeningTemplateIds(categoryId),
      getRecentlyUsedClosingTemplateIds(categoryId),
      getRecentlyUsedCoverageIds(asset.symbol),
      findUpcomingHighImpactEvent(),
    ]);
    const relatedCoverage = await findRelatedCoverage(asset.symbol, coverageUsedIds);

    const openingTemplate = selectTemplate(OPENING_TEMPLATES, snapshot, openingUsedIds);
    const closingTemplate = selectTemplate(CLOSING_DIRECTIVES, snapshot, closingUsedIds);
    const requiredOpeningSentence = openingTemplate.build(snapshot);
    const closingDirective = closingTemplate.instruction;
    const usedCoverageIds = relatedCoverage.map((c) => c.id);

    let draft;
    try {
      draft = await generateAnalysis(snapshot, { relatedCoverage, calendarContext, requiredOpeningSentence, closingDirective });
    } catch (err) {
      console.error(`Analysis job: skipped ${asset.symbol} - generation failed: ${describeGenerationError(err)}.`);
      skipped += 1;
      continue;
    }

    if (await isDuplicateInCategory(categoryId, draft.body)) {
      console.log(`Analysis job: discarded a near-duplicate draft for ${asset.symbol}.`);
      skipped += 1;
      continue;
    }

    draft.body = ensureNotFinancialAdviceDisclaimer(draft.body);

    let priceMismatchNote = await verifyAnalysisDraft(draft.title, draft.body, snapshot, asset.symbol, categoryId);
    if (priceMismatchNote) {
      console.warn(`Analysis job: fact-check failed for ${asset.symbol} (attempt 1) - ${priceMismatchNote}`);
      console.warn(`Analysis job: retrying ${asset.symbol} once with the failure reason fed back into the prompt.`);
      let retryDraft;
      try {
        retryDraft = await generateAnalysis(
          snapshot,
          { relatedCoverage, calendarContext, requiredOpeningSentence, closingDirective },
          `Your previous draft failed this check: ${priceMismatchNote}. Regenerate the full brief from scratch and specifically fix this.`
        );
      } catch (err) {
        console.error(`Analysis job: retry generation for ${asset.symbol} failed: ${describeGenerationError(err)} - falling back to the original (flagged) draft.`);
        retryDraft = null;
      }
      if (retryDraft) {
        retryDraft.body = ensureNotFinancialAdviceDisclaimer(retryDraft.body);
        const retryNote = await verifyAnalysisDraft(retryDraft.title, retryDraft.body, snapshot, asset.symbol, categoryId);
        if (retryNote) {
          console.warn(`Analysis job: fact-check failed for ${asset.symbol} again after retry - ${retryNote}. Holding for review.`);
          draft = retryDraft;
          priceMismatchNote = retryNote;
        } else {
          console.log(`Analysis job: retry for ${asset.symbol} passed every check - publishing the corrected draft.`);
          draft = retryDraft;
          priceMismatchNote = null;
        }
      }
    }
    const priceMismatch = Boolean(priceMismatchNote);

    const { status, autoPublishAt } = decideArticleStatus({
      isMockProvider: draft.provider === "mock",
      categoryMismatch: false,
      priceMismatch,
      verificationClean: draft.verificationClean,
      isMultiSourceAutoPublish: autoPublish,
      autoPublishDelayHours: Number(await getSetting("auto_publish_delay_hours", 5)),
    });

    const slug = await uniqueSlug(draft.title);
    const wordCount = draft.body.split(/\s+/).length;
    const readMinutes = Math.max(1, Math.round(wordCount / 200));

    await insertArticle({
      slug,
      title: draft.title,
      dek: draft.dek,
      body: draft.body,
      categoryId,
      status,
      seoTitle: draft.seo_title,
      seoDescription: draft.seo_description,
      readMinutes,
      sourceCount: relatedCoverage.length ? new Set(relatedCoverage.flatMap((a) => a.sources)).size : 1,
      aiProvider: draft.provider,
      publishedAt: status === "published" ? new Date() : null,
      priceMismatch,
      priceMismatchNote,
      analysisSymbol: asset.symbol,
      openingTemplateId: openingTemplate.id,
      closingTemplateId: closingTemplate.id,
      usedCoverageArticleIds: usedCoverageIds,
      autoPublishAt,
    });

    await saveSnapshot(asset.symbol, snapshot);
    remaining -= 1;
    generated += 1;
  }

  return { generated, skipped };
}

export async function checkForRecentHighImpactEvent() {
  const { rows } = await query(
    `SELECT id, title FROM calendar_events
     WHERE impact = 'high'
       AND event_time <= now()
       AND event_time >= now() - interval '60 minutes'
     ORDER BY event_time DESC
     LIMIT 1`
  );
  return rows[0] || null;
}
