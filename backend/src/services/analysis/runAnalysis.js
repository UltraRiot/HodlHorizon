// The Analysis job (spec section 4) - completely separate from the news
// scanner. Runs on a fixed watchlist, pulls real computed technicals
// (trend, RSI, support/resistance from getMarketSnapshot()), and only
// writes a new article for an asset when its numbers moved meaningfully
// since the last one. This is what guarantees Analysis articles are
// grounded in real, current numbers instead of assembled from whatever
// news happened to mention "RSI" or "support."
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

// buildAnalysisPrompt (ai/prompts.js) already instructs the model to end
// every brief with a not-financial-advice disclaimer, but that's
// model-generated text, not a guarantee - a real published Gold analysis
// article shipped without it despite the prompt (pre-launch audit
// finding). This makes the disclaimer server-enforced instead of
// prompt-dependent. The check is case-insensitive and only looks for the
// anchor phrase (not the exact sentence) so a draft that already includes
// its own wording of the disclaimer is left alone rather than getting a
// second, redundant one appended.
const NOT_FINANCIAL_ADVICE_DISCLAIMER = "This is not financial advice; readers should draw their own conclusions.";

// Real regression, found in a real batch (articles 341, 349): the model
// sometimes writes its own disclaimer phrased "This analysis does NOT
// CONSTITUTE financial advice" - which the old check (literal substring
// "not financial advice") doesn't recognize, since "constitute" sits
// between "not" and "financial." Broadened to the bare phrase "financial
// advice," which every real disclaimer variant seen in this project's
// output (this one, "not financial advice," "no financial advice") shares,
// without being so broad it would false-positive on unrelated content -
// a body that mentions "financial advice" at all is, in practice, always
// either this disclaimer or a paragraph ABOUT the concept of financial
// advice, either of which means a second appended disclaimer would be
// redundant.
function ensureNotFinancialAdviceDisclaimer(body) {
  if (body.toLowerCase().includes("financial advice")) return body;
  return `${body}\n\n${NOT_FINANCIAL_ADVICE_DISCLAIMER}`;
}

// kind: "crypto" -> CoinGecko (free, no key), fetched live. kind: "cached"
// -> read from market_data_cache (see prices.js's getCachedTechnicalSnapshot
// and services/marketData/refreshMarketData.js, the scheduled job that
// writes those rows) - never a live provider call from inside this job, and
// never generated if that asset's cache row is missing, failed, or stale.
// "Gold" (no qualifier) is correct here, not an oversight: this cache row
// now holds Twelve Data's real spot gold quote (XAU/USD - a forex-
// categorized symbol, free on their Basic plan), not the GLD ETF's share
// price the way it used to (see prices.js/alphaVantage.js) - there's no
// ETF-vs-spot mismatch left to disclose in the name. "S&P 500" (not
// "(SPY)") is correct for the same underlying reason:
// getCachedTechnicalSnapshot('spy') converts SPY's raw closes to real
// index points before this ever sees them - the number really is the
// S&P 500, not SPY's own share price. Oil is the one asset here still
// genuinely proxied (Alpha Vantage's WTI series is real crude oil, not an
// ETF, so "(WTI)" is disambiguating which benchmark rather than
// disclosing a mismatch - see alphaVantage.js for why WTI didn't migrate
// to Twelve Data alongside Gold). QQQ isn't on this watchlist for an
// unrelated reason - nobody's built the Nasdaq-100 branch of this
// watchlist yet, not a provider limitation: Twelve Data's /time_series
// works for any symbol on the free tier (confirmed against their real
// docs, https://twelvedata.com/docs#time-series, 2026-09-18), the same
// endpoint SPY's history now uses, so QQQ's SMA/RSI/support-resistance
// would be just as available as SPY's the day someone adds it here.
// Exported so auditPublishedAnalysis.js iterates the exact same symbol
// list this job does, rather than a second hardcoded copy that could
// silently drift out of sync the day a new asset is added here.
export const WATCHLIST = [
  { symbol: "BTC", kind: "crypto", coinGeckoId: "bitcoin" },
  { symbol: "ETH", kind: "crypto", coinGeckoId: "ethereum" },
  { symbol: "Gold", kind: "cached", cacheKey: "gold" },
  { symbol: "S&P 500", kind: "cached", cacheKey: "spy" },
  { symbol: "Oil (WTI)", kind: "cached", cacheKey: "wti" },
];

// symbol -> where to look for genuinely independent recent coverage of the
// same real-world asset, reusing the regular news categories' own
// multi-source reporting instead of a second RSS fetch (see
// findRelatedCoverage() below). Keywords are matched case-insensitively
// against a candidate article's title+dek.
const RELATED_COVERAGE_CONFIG = {
  BTC: { categorySlug: "crypto", keywords: ["bitcoin", "btc"] },
  ETH: { categorySlug: "crypto", keywords: ["ethereum", "eth"] },
  Gold: { categorySlug: "commodities", keywords: ["gold"] },
  "S&P 500": { categorySlug: "indices", keywords: ["s&p 500", "s&p500", "s&p"] },
  "Oil (WTI)": { categorySlug: "commodities", keywords: ["oil", "wti", "crude"] },
};

// Real, already-published reporting on this same asset from this site's
// own news categories (crypto/commodities/indices) - not a new RSS fetch,
// just reusing what scanAndGenerate.js already produced and stored
// (articles + article_sources). Only returned when at least 2 genuinely
// distinct outlets are behind that recent coverage (a single source
// republished across two of this site's articles doesn't count as
// "multiple sources" to synthesize) - buildAnalysisPrompt treats an empty
// result as "nothing to add," not a failure.
// excludeIds: coverage article ids already used in this instrument's own
// recent Analysis pieces (see getRecentlyUsedCoverageIds below) - real
// regression this exists for: articles 372-380 (BTC) kept reusing the
// SAME relatedCoverage fact ("despite a 1.5% decline in September,
// Bitcoin is on track for its first quarterly gain in a year") reworded
// fresh in article after article, because this function only ever asked
// "is there coverage in the last 48h," never "have I already used this
// specific coverage for this instrument recently." Excludes already-used
// ids first, but falls back to the full unfiltered set if that leaves
// nothing (or drops below the 2-distinct-source bar) - "exclude
// already-used facts... unless no other relevant coverage exists" means
// falling back, not going silent.
// Pure selection logic, exported for direct testing (the same reason
// every other check in this file separates a pure decision from its DB
// fetch) - candidates already carry their resolved sources, so this is
// just: exclude already-used ids, but fall back to the unfiltered
// candidate list if that leaves nothing usable (empty, or under the
// 2-distinct-source bar) rather than silently dropping all context.
export function selectRelatedCoverage(candidates, excludeIds) {
  const hasEnoughSources = (list) => new Set(list.flatMap((a) => a.sources)).size >= 2;

  const notRecentlyUsed = candidates.filter((a) => !excludeIds.has(a.id));
  if (notRecentlyUsed.length > 0 && hasEnoughSources(notRecentlyUsed)) {
    return notRecentlyUsed.map(({ id, title, dek, sources }) => ({ id, title, dek, sources }));
  }

  // Nothing left after exclusion (or it dropped below the source-count
  // bar) - fall back to the unfiltered set rather than silently dropping
  // all context, per "unless no other relevant coverage exists."
  return hasEnoughSources(candidates)
    ? candidates.map(({ id, title, dek, sources }) => ({ id, title, dek, sources }))
    : [];
}

// excludeIds: coverage article ids already used in this instrument's own
// recent Analysis pieces (see getRecentlyUsedCoverageIds below) - real
// regression this exists for: articles 372-380 (BTC) kept reusing the
// SAME relatedCoverage fact ("despite a 1.5% decline in September,
// Bitcoin is on track for its first quarterly gain in a year") reworded
// fresh in article after article, because this function only ever asked
// "is there coverage in the last 48h," never "have I already used this
// specific coverage for this instrument recently." See
// selectRelatedCoverage above for the actual exclude-with-fallback logic -
// this is just the DB-fetching wrapper around it.
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

// A genuinely imminent high-impact macro event, for the "forward-looking
// context" ask - reuses calendar_events as-is (same table routes/
// calendar.js reads), no new event system. Only surfaces something within
// the next few days so this is never filler on a piece with nothing
// upcoming worth flagging; buildAnalysisPrompt is told to mention it only
// if actually relevant, so an irrelevant-but-real event still doesn't
// force its way into unrelated analysis.
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

// Extends the price-mismatch guardrail's principle (findPriceMismatch/
// findCommodityPriceMismatch/findIndexPriceMismatch in scanAndGenerate.js)
// to Analysis - but this is actually the strongest possible case for it:
// unlike a news brief (checked against a live ticker or source text, both
// approximations), an Analysis piece is handed the EXACT real price it
// must use verbatim (see buildAnalysisPrompt), so there's no ambiguity
// about what "correct" means here. Passes if ANY number in the body is
// within tolerance of the real price - a model that correctly states the
// price once, then discusses RSI/support/resistance with their own
// distinct numbers elsewhere, should not be flagged just because those
// other numbers don't match the price.
const ANALYSIS_PRICE_TOLERANCE = 0.05; // tighter than the 15% used elsewhere - this "truth" is exact, not a live approximation
const NUMBER_RE = /\$?\s?([0-9][0-9,]*(?:\.[0-9]+)?)/g;

function closestPriceMatch(text, truePrice) {
  const candidates = [...(text || "").matchAll(NUMBER_RE)]
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (candidates.length === 0) return null; // nothing numeric to check - not itself a failure

  return candidates.reduce(
    (best, n) => {
      const diff = Math.abs(n - truePrice) / truePrice;
      return diff < best.diff ? { value: n, diff } : best;
    },
    { value: null, diff: Infinity }
  );
}

// Checks BOTH the title and the body independently, not the two concatenated
// together - found live: a real published title read "S&P 500 Price at
// $737.74 Amid Bearish Trend" (a hallucinated, 10x-off, wrong-format number -
// the real value was 7,377.4, and stated with a "$" an index should never
// get) while the BODY correctly used 7,377.4 throughout. Checking one
// combined pool of candidates would have let the body's correct number mask
// the title's wrong one as "the closest match" - the single most visible
// text on the page would have shipped wrong while this check reported clean.
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

// Extends the price-mismatch principle to the qualifier that DISTINGUISHES
// an ETF's own share price from the real underlying asset's - see the
// comment in buildAnalysisPrompt (prompts.js) on why the instruction alone
// isn't trusted: it was dropped once in real output ("Gold (GLD)" became
// plain "Gold" in both the title and body, with GLD's $398.45 ETF price
// stated as if it were spot gold). Only fires for a symbol that actually
// has a parenthetical qualifier - "BTC"/"S&P 500" have nothing to check,
// and neither does "Gold" anymore now that it's real spot gold (Twelve
// Data's XAU/USD) rather than the GLD ETF proxy the incident above
// happened on - this check stays in place for "Oil (WTI)" and any future
// genuinely ETF-proxied watchlist entry, it just has nothing left to catch
// for gold specifically.
export function findMissingQualifier(title, body, snapshot) {
  const match = /\(([^)]+)\)\s*$/.exec(snapshot.symbol || "");
  if (!match) return null;

  const qualifier = match[1];
  const haystack = `${title || ""} ${body || ""}`;
  if (haystack.includes(`(${qualifier})`)) return null;

  const bareSymbol = snapshot.symbol.slice(0, match.index).trim();
  return `The symbol "${snapshot.symbol}" was given, but its "(${qualifier})" qualifier doesn't appear anywhere in the generated title or body - it may be describing ${qualifier}'s own ETF price (${formatMarketValue(snapshot.price, snapshot.assetClass)}) as if it were the real ${bareSymbol} price. Verify before publishing.`;
}

// Extends the same principle to a DERIVED claim, not a raw figure - the
// model is free to compute "X% away from support/resistance" in prose, and
// nothing previously checked that arithmetic. Found live: a real Bitcoin
// piece stated "3.2% away from its resistance and 3.2% above its support"
// for price $78,116.82 / support $75,590.24 / resistance $80,329.35 - the
// support figure was right (2,526.58 / 78,116.82 = 3.2%), but resistance
// is actually 2,212.53 / 78,116.82 = 2.8%, not 3.2% - the model reused one
// number for both instead of computing each separately. Tolerance is in
// percentage POINTS (not a relative diff, since these are already
// percentages) - a few tenths of a point allows for the model's own
// rounding without letting a genuinely wrong figure (like the 0.4-point
// gap above) through.
const DISTANCE_TOLERANCE_PP = 0.3;
// Live regression, found in a real published Ethereum piece: "4% away from
// the resistance level" walked straight past this check for price
// $2,500.41 / resistance $2,525.27 (real distance ~0.99%, the stated 4%
// off by 3 full points) - the only reason being phrasing. The old pattern
// required either nothing or "its" right before support/resistance, so
// "the resistance level" (a "the" instead of "its", plus a trailing
// "level") never matched at all - the check simply never ran on this
// sentence, not a tolerance miss. Broadened to accept "the" alongside
// "its" (both still optional, so a bare "3.2% above support" - the
// original Bitcoin case - keeps matching too) and an optional trailing
// "level" word. Deliberately not broadened further than that (no attempt
// at every possible rephrasing) - these two are the safe, confirmed gaps;
// anything wider risks matching an unrelated number near the word
// "support"/"resistance" by coincidence.
const DISTANCE_CLAIM_RE = /(\d+(?:\.\d+)?)\s?%\s*(?:away\s+from|above|below|of|from)?\s*(?:(?:its|the)\s+)?(support|resistance)(?:\s+level)?\b/gi;

// Real regression, found in a real published Bitcoin piece (fixed alongside
// the support/resistance window bug that made this MORE likely to trigger:
// price now legitimately sits outside the support/resistance band whenever
// there's a genuine breakout, so the model has to describe that direction
// correctly far more often than when the window bug pinned resistance to
// the current price): "Bitcoin is just $833.79 below its immediate
// resistance level" for price $81,163.14 / resistance $80,329.35 - price
// was actually $833.79 ABOVE resistance (a real breakout), not below it.
// The magnitude was exactly right; only the direction word was backwards.
// DISTANCE_CLAIM_RE above only ever matches a PERCENTAGE claim ("X% away
// from...") and never checked direction either (it compares magnitude via
// Math.abs on both sides) - this is a second, parallel pattern for a
// dollar-amount claim, which additionally verifies the stated direction
// word against the real sign of (price - level), not just the magnitude.
// "shy of"/"away from" accepted in the same number-first slot as
// above/below ("$833.79 shy of resistance") for consistency with this
// regex's own structure, even though "shy of" more often precedes the
// number in natural writing ("just shy of resistance by $833.79") - not
// attempting every real word order, the same narrow-broadening approach
// DISTANCE_CLAIM_RE's own comment above already documents. "away from" is
// genuinely directionless (could be above or below) so it only verifies
// magnitude, never direction - there's nothing to check it against.
const DOLLAR_DISTANCE_CLAIM_RE = /\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(above|below|shy of|away from)\s*(?:(?:its|the)\s+)?(?:\w+\s+)?(support|resistance)(?:\s+level)?\b/gi;
const DOLLAR_DISTANCE_SIGN = { above: 1, below: -1, "shy of": -1 }; // "away from" omitted on purpose - ambiguous, see comment above

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

    // price - level > 0 means price sits ABOVE that level, regardless of
    // whether the level is called support or resistance - "above the
    // resistance level" and "above the support level" both just mean
    // price > that number, so the same sign check applies to either.
    const actualDiff = price - levelValue[level];
    const expectedSign = DOLLAR_DISTANCE_SIGN[direction];
    if (expectedSign !== undefined) {
      const actualSign = actualDiff >= 0 ? 1 : -1;
      if (actualSign !== expectedSign) {
        const actualWord = actualSign === 1 ? "above" : "below";
        return `Body claims price is $${statedAmount.toLocaleString("en-US")} ${direction} ${level}, but price (${formatMarketValue(price, snapshot.assetClass)}) is actually ${actualWord} ${level} (${formatMarketValue(levelValue[level], snapshot.assetClass)}), not ${direction} it - the direction is backwards, verify before publishing.`;
      }
    }

    // Same magnitude check as the percentage claims above, just converting
    // the stated dollar amount to a percentage of price first so it can
    // reuse the same tolerance and ground truth.
    const statedAsPercent = (statedAmount / price) * 100;
    const real = realPercent[level];
    const diff = Math.abs(statedAsPercent - real);
    if (diff > DISTANCE_TOLERANCE_PP) {
      return `Body claims price is $${statedAmount.toLocaleString("en-US")} ${direction} ${level} (~${statedAsPercent.toFixed(1)}%), but the real distance computed from the given price/${level} is ${real.toFixed(1)}% - verify before publishing.`;
    }
  }

  return null;
}

// Real regression this exists for: at least 3 separate published Bitcoin
// pieces (articles 281/285/301) reused the same "1.5% decline in
// September... first quarterly gain in a year... Ether/XRP outflows"
// narrative near-verbatim over successive articles - numbers changed,
// the piece read as the same one reworded. Calibrated against this
// project's real published Analysis backlog (checked 2026-09-18, not
// guessed): whole-body Jaccard word-overlap between different real BTC
// articles from different sessions/days normally tops out around 0.45
// (shared structural vocabulary - "RSI," "resistance," "neutral zone" -
// but different numbers and specifics); the one confirmed genuine
// near-clone pair in the backlog (articles 171/186, an older short-format
// template with only the 3 numbers swapped) scored 0.66. 0.55 sits
// between those with real headroom on both sides.
//
// Important, honest limitation (confirmed empirically before picking this
// approach): this catches near-VERBATIM reuse, not paraphrased reuse of
// the same fact in different words - the exact 281/285/301 case that
// motivated this only scores ~0.39-0.40 whole-body (even the single most
// obviously-reused sentence pair between them scores ~0.36-0.43 at the
// sentence level), because Jaccard has no notion of meaning, only word
// overlap - the identical limitation already documented on findBodyProblem
// in provider.js. A threshold low enough to catch that paraphrased case
// would also flag ordinary legitimate day-to-day variation (195 vs 199,
// two genuinely different real articles, scores 0.42). This deterministic
// check is still worth having for the extreme/lazy case it CAN catch
// reliably; the paraphrased case needs a semantic (LLM-based) check
// instead - see PRIOR_COVERAGE_REUSE_QUESTION in prompts.js/provider.js,
// added after this exact gap was confirmed by auditPublishedAnalysis.js.
const SIMILARITY_TO_PRIOR_THRESHOLD = 0.55;

// Pure comparison, no DB access - takes the prior article directly rather
// than fetching it, both so it's directly unit-testable against synthetic
// bodies (the same reason every other check in this file is a pure
// function of its inputs) and so auditPublishedAnalysis.js, which already
// holds a whole chronological list of an instrument's articles in memory,
// can reuse this without a redundant query per comparison. priorArticle:
// { id, title, body } or null/undefined (nothing to compare against yet -
// e.g. the very first article ever published for this instrument).
export function findAnalysisSimilarityMismatch(body, priorArticle) {
  if (!priorArticle) return null;

  const similarity = jaccardSimilarity(normalize(body), normalize(priorArticle.body));
  if (similarity < SIMILARITY_TO_PRIOR_THRESHOLD) return null;

  return `This draft is ${Math.round(similarity * 100)}% similar (word-overlap) to the last published analysis for this instrument (article ${priorArticle.id}, "${priorArticle.title}") - reads as the same piece reworded rather than a fresh take. Vary the structure, opening, and phrasing, and drop or explicitly attribute ("as previously reported") any repeated fact that isn't new.`;
}

// Shared by both checks below that need "the last published article for
// this instrument" - fetched once per verification pass rather than once
// per check, since both the lexical similarity check and the LLM
// freshness check (see verifyAnalysisDraft) need the exact same row.
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

// --- Repeated opening/closing structural clause detection ---
// Real corpus evidence, mined from the 82 published articles that existed
// before this fix (2026-09-19, all categories): 50/82 (61%) open with
// "[instrument] is currently priced at $X" and 34/82 (41%) immediately
// follow it with "maintaining a bullish trend as it [trades/sits/remains]
// above its 50-day moving average" - a near-verbatim template with only
// the instrument/price/verb swapped (real measured Jaccard similarity
// between two genuine instances: 0.600, vs. 0.045 for an unrelated
// control sentence - cleanly, lexically separable). Separately, 38/82
// (46%) close with a wrap-up transition word (Overall/In summary/In
// synthesis/Considering/Taken together) immediately restating price/RSI/
// support-resistance - but that pattern's WORDING varies enough between
// real instances (measured similarity: only 0.364 and 0.250 between two
// confirmed genuine matches) that whole-clause lexical similarity can't
// reliably tell it apart from two unrelated closings - the same
// fundamental limitation already proven for findAnalysisSimilarityMismatch
// and isDuplicateInCategory (grouping.js/articleUtils.js). Both checks
// below use a STRUCTURAL FINGERPRINT instead of raw text similarity: does
// this paragraph match a known template SHAPE, and has that same shape
// also appeared in enough of the recent same-category published articles
// to call it a real pattern, not a one-off coincidence.
const RECENT_CATEGORY_SAMPLE = 10;
const REPEATED_CLAUSE_THRESHOLD = 3; // the shape must ALSO appear in >= this many of the last RECENT_CATEGORY_SAMPLE

const OPENING_CLAUSE_RE = /\b(?:is currently priced at|is priced at|is currently trading at|current price (?:is|stands at))\b.{0,50}\b(?:maintaining|showing|reflecting)\s+a\s+(?:bullish|bearish)\s+trend\b/i;

// Exported for direct testing against a synthetic body - the same reason
// every other structural check in this file is a pure, exported function.
export function hasFormulaicOpening(body) {
  const firstParagraph = (body || "").split("\n\n")[0] || "";
  return OPENING_CLAUSE_RE.test(firstParagraph);
}

// "Taking into account" and "Together," added after the step-4 manual
// qualitative read (2026-09-19) found two more real, fresh drafts
// (articles 376, 377) with the identical restate-the-numbers structural
// pattern under wrap-up words the original list didn't recognize yet -
// found by actually reading generated output, the same way every other
// gap in this list of checks has been found all session.
const WRAPUP_STARTER_RE = /^(overall|in summary|in synthesis|taken together|taking into account|together|considering(?:\s+these\s+factors|\s+the\s+current|\s+all)?|to summarize|altogether)\b/i;
const CORE_TERM_RE = /\b(rsi|support|resistance)\b/i;

// The disclaimer is usually its own short final paragraph - the real
// "closing" paragraph a reader experiences as the article's wrap-up is
// the one immediately before it (or the last paragraph outright, if a
// draft has no separate disclaimer paragraph of its own).
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

// Bundles every Analysis fact-check into one entry point, so both the live
// generation pipeline (runAnalysisScan below) and the after-the-fact audit
// (auditPublishedAnalysis.js) run the exact same checks the exact same
// way - a check added here automatically covers both without either
// caller needing to change. Deterministic checks run first (cheap, free,
// no network) so the common case of an already-broken draft never pays
// for the LLM freshness call; the first failure found wins either way.
//
// includeSemanticFreshnessCheck: defaults to FALSE, in both the live
// pipeline and the audit, and this needed two real rounds of testing to
// find out why. Round 1 (no allowlist for price/support/resistance/RSI/
// trend) flagged 23 of 24 real article pairs - fixed by adding the
// allowlist now in buildAnalysisFreshnessCheckPrompt. Round 2, AFTER that
// fix, still flagged 22 of 28: almost every "violation" was the model
// correctly re-mentioning a genuinely-still-upcoming Fed rate decision
// (findUpcomingHighImpactEvent() legitimately keeps re-serving the same
// real event to every article generated before it actually happens) or
// genuinely-still-in-window relatedCoverage (findRelatedCoverage()'s own
// 48-hour freshness window can legitimately still be serving the same
// real prior Hodl Horizon article on back-to-back generations). This
// check only ever sees the two draft BODIES, never what context was
// actually fed into either generation - it structurally cannot tell
// "correctly restating real, unchanged input" from "recycling a narrative
// with no current grounding," and real testing shows the former is common
// enough to make this unsafe as a blocking gate: it would retry (spending
// real API cost) and potentially hold genuinely clean, accurate articles
// for review, on the same routine Fed-decision mention nearly every time.
// It DOES still reliably catch the real case that motivated it (articles
// 285/301's reworded "quarterly gain" narrative, confirmed in both test
// rounds) - it's just not precise enough yet to trust unattended. Kept
// available, opt-in only, for a human to spot-check with judgment (pass
// { includeSemanticFreshnessCheck: true }) until it can be given real
// visibility into calendarContext/relatedCoverage rather than judging
// blind from outputs alone - a genuine follow-up, not implemented here.
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

// Spec 4.3: only generate a new article if price moved >2%, RSI crossed
// into/out of overbought/oversold, a support/resistance level broke, or
// (added after the duplicate-coverage audit) the trend itself flipped.
// Trend flip is a real, distinct signal a trader cares about that isn't
// already guaranteed by the other three: trend is defined purely by price
// vs. the 50-day moving average, and the MA moves slowly enough that
// price can cross it without moving 2%, without breaking support/
// resistance (which can sit further away than the MA does), and without
// crossing an RSI zone boundary. Deliberately NOT adding a calendar-
// catalyst-proximity condition (a candidate considered during the audit):
// "meaningfully closer" has no natural numeric threshold the way a price
// % does, and real batch testing already showed an upcoming Fed decision
// gets mentioned in nearly every article during its whole run-up window
// regardless of gating - turning that into a fresh-article TRIGGER would
// generate more of exactly the repetitive content this gate exists to
// prevent, not less.
// Exported (like every other pure guardrail in this file) so the
// trend-flip condition is directly testable against a synthetic
// prev/curr pair, not just observable in real generated output.
export function movedMeaningfully(prev, curr) {
  if (!prev) return true; // no snapshot yet - always generate the first one

  const priceChangePct = Math.abs((curr.price - Number(prev.price)) / Number(prev.price)) * 100;
  if (priceChangePct >= 2) return true;

  const zone = (rsi) => (rsi >= 70 ? "over" : rsi <= 30 ? "under" : "neutral");
  if (zone(prev.rsi_14) !== zone(curr.rsi_14)) return true;

  if (curr.price > Number(prev.resistance) || curr.price < Number(prev.support)) return true;

  // prev.trend is null for any snapshot saved before migrations/019 added
  // the column - treated as "unknown," never itself a trigger (a null-to-
  // real-value transition isn't a genuine flip, just a schema catch-up).
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
      // Markets are closed on weekends - Friday's close hasn't changed, so
      // don't even bother checking the cache. Crypto (kind: "crypto") is
      // completely unaffected - it trades 24/7.
      skipped += 1;
      continue;
    }

    let snapshot;
    if (asset.kind === "cached") {
      // No live provider call here - if refreshMarketData.js's scheduled
      // job hasn't successfully fetched this asset recently (missing key,
      // provider down, rate-limited), getCachedTechnicalSnapshot() returns
      // null rather than a stale or partially-filled snapshot, and this
      // article is skipped for the cycle. The AI writer never sees a
      // number that isn't straight from a fresh, successful fetch.
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

    // Real synthesis material, gathered before generation so the model can
    // actually use it rather than bolting it on after - see
    // findRelatedCoverage()/findUpcomingHighImpactEvent() above for what
    // each draws from and why both are safe to omit when there's nothing
    // genuinely there.
    const [openingUsedIds, closingUsedIds, coverageUsedIds, calendarContext] = await Promise.all([
      getRecentlyUsedOpeningTemplateIds(categoryId),
      getRecentlyUsedClosingTemplateIds(categoryId),
      getRecentlyUsedCoverageIds(asset.symbol),
      findUpcomingHighImpactEvent(),
    ]);
    const relatedCoverage = await findRelatedCoverage(asset.symbol, coverageUsedIds);

    // Code picks the opening sentence and closing framing instead of
    // asking the model to vary itself - see analysisTemplates.js's header
    // comment for why the old "vary your writing" prompt instruction was
    // replaced rather than strengthened again: two rounds of real
    // generation showed it doesn't hold even as an explicit correction
    // note. Selected once per asset per scan and reused for the retry
    // below (if one fires) - the model is required to comply, not asked
    // to choose again.
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

    // Applied after the duplicate check (on the model's original text, not
    // padded with an identical trailing sentence on every article) so the
    // similarity threshold's calibration is unaffected, but before
    // wordCount/readMinutes and insertArticle so both reflect what's
    // actually stored and published.
    draft.body = ensureNotFinancialAdviceDisclaimer(draft.body);

    // Pre-publish gate that actually BLOCKS, not just flags: every
    // deterministic fact-check (price/support/resistance figure, dropped
    // ETF qualifier, wrong distance/direction claim, excessive similarity
    // to this instrument's last published piece - see verifyAnalysisDraft
    // above) runs against the first draft. A failure used to go straight
    // to a flagged "review" row with no attempt to fix it - this instead
    // regenerates ONCE with the specific failure reason fed back into the
    // prompt as a correction note (the exact same mechanism buildAnalysisPrompt
    // already uses for its own internal lexical/redundancy retry, just
    // triggered externally this time - see generateAnalysis's
    // externalCorrectionNote parameter in provider.js), then re-verifies
    // the new draft. Only if it fails again - same check or a different
    // one, doesn't matter - does this fall through to "review" with the
    // failure reason attached, exactly the way a failed check already
    // worked, just no longer skipping the one free chance to self-correct.
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
          draft = retryDraft; // still the better-effort attempt, even though it's still flagged
          priceMismatchNote = retryNote;
        } else {
          console.log(`Analysis job: retry for ${asset.symbol} passed every check - publishing the corrected draft.`);
          draft = retryDraft;
          priceMismatchNote = null;
        }
      }
    }
    const priceMismatch = Boolean(priceMismatchNote);

    // Reuses the exact same publish/review decision the news pipeline
    // makes (scanAndGenerate.js's decideArticleStatus) instead of a
    // separate, simpler ternary that never considered whether the draft's
    // own numbers or body quality actually checked out. categoryMismatch
    // is always false here - an Analysis piece is filed by its fixed
    // watchlist entry, not guessed from content, so there's nothing to
    // disagree with. isMultiSourceAutoPublish is passed as `autoPublish`
    // (the job-level setting) rather than left false: that flag's real
    // effect is "skip the review-window delay and publish immediately
    // once clean," which is the correct behavior here for a different
    // reason than its name suggests - an Analysis piece is grounded in a
    // real-time computed snapshot, not an unconfirmed single-source
    // rumor, so it never needed the delayed-publish grace window a lone
    // news source gets. A flagged or unclean draft still always lands in
    // review regardless, exactly as before.
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
      // Reflects genuine distinct outlets behind the related coverage this
      // piece drew on, when there was any - otherwise the single real-time
      // computed snapshot, same as before this change.
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

// Calendar-triggered Analysis (spec item 3): a high-impact event that just
// passed (a Fed rate decision, CPI, etc.) can move markets meaningfully
// before the Analysis job's own next scheduled run. Checked against
// calendar_events already in the DB - no new event system, and
// deliberately doesn't try to map an event to specific assets (that would
// itself be a mini event system); it just signals "something significant
// may have just moved, run the normal check now." runAnalysisScan()
// already gates per-asset on "did the data actually move" and the daily
// cap, so calling it when nothing material happened is a cheap no-op, not
// a duplicate article - and being called on more than one scheduler tick
// within the 60-minute window (see scheduler.js) is fine for the same reason.
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
