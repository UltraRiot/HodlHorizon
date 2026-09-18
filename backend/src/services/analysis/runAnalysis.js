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
import { generateAnalysis } from "../ai/provider.js";
import { decideArticleStatus } from "../rss/scanAndGenerate.js";
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

function ensureNotFinancialAdviceDisclaimer(body) {
  if (body.toLowerCase().includes("not financial advice")) return body;
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
const WATCHLIST = [
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
async function findRelatedCoverage(symbol, withinHours = 48) {
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

  const coverage = [];
  const distinctSources = new Set();
  for (const a of matching) {
    const { rows: sourceRows } = await query(
      "SELECT DISTINCT source_name FROM article_sources WHERE article_id = $1",
      [a.id]
    );
    const sources = sourceRows.map((s) => s.source_name);
    sources.forEach((s) => distinctSources.add(s));
    coverage.push({ title: a.title, dek: a.dek, sources });
  }

  return distinctSources.size >= 2 ? coverage : [];
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

export function findAnalysisDistanceMismatch(body, snapshot) {
  const price = Number(snapshot.price);
  const support = Number(snapshot.support);
  const resistance = Number(snapshot.resistance);
  if (![price, support, resistance].every((n) => Number.isFinite(n) && n > 0)) return null;

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
  return null;
}

async function getLastSnapshot(symbol) {
  const { rows } = await query("SELECT * FROM analysis_snapshots WHERE symbol = $1", [symbol]);
  return rows[0] || null;
}

async function saveSnapshot(symbol, snap) {
  await query(
    `INSERT INTO analysis_snapshots (symbol, price, rsi_14, support, resistance, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (symbol) DO UPDATE
       SET price = $2, rsi_14 = $3, support = $4, resistance = $5, updated_at = now()`,
    [symbol, snap.price, snap.rsi_14, snap.support, snap.resistance]
  );
}

// Spec 4.3: only generate a new article if price moved >2%, RSI crossed
// into/out of overbought/oversold, or a support/resistance level broke.
function movedMeaningfully(prev, curr) {
  if (!prev) return true; // no snapshot yet - always generate the first one

  const priceChangePct = Math.abs((curr.price - Number(prev.price)) / Number(prev.price)) * 100;
  if (priceChangePct >= 2) return true;

  const zone = (rsi) => (rsi >= 70 ? "over" : rsi <= 30 ? "under" : "neutral");
  if (zone(prev.rsi_14) !== zone(curr.rsi_14)) return true;

  if (curr.price > Number(prev.resistance) || curr.price < Number(prev.support)) return true;

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
    const [relatedCoverage, calendarContext] = await Promise.all([
      findRelatedCoverage(asset.symbol),
      findUpcomingHighImpactEvent(),
    ]);

    let draft;
    try {
      draft = await generateAnalysis(snapshot, { relatedCoverage, calendarContext });
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

    // Same fact-check principle as scanAndGenerate.js's price-mismatch
    // guardrail, applied to the exact numbers this piece was handed - see
    // each function's comment above for why this is actually the
    // strongest case for the check (no live/source ambiguity, the real
    // numbers are known exactly). Three independent checks, first failure
    // wins - each catches a different real failure mode found in live
    // output: a wrong price/support/resistance figure (in either the body
    // or the title), a dropped ETF qualifier, and a wrong derived
    // percentage-distance claim. All three route through the same
    // price_mismatch flag/note rather than adding parallel DB columns.
    const priceMismatchNote =
      findAnalysisFactMismatch(draft.title, draft.body, snapshot) ||
      findMissingQualifier(draft.title, draft.body, snapshot) ||
      findAnalysisDistanceMismatch(draft.body, snapshot);
    const priceMismatch = Boolean(priceMismatchNote);
    if (priceMismatch) {
      console.warn(`Analysis job: fact-check mismatch for ${asset.symbol} - ${priceMismatchNote}`);
    }

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
