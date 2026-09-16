// Small helpers shared between the news pipeline (services/rss/scanAndGenerate.js)
// and the Analysis job (services/analysis/runAnalysis.js) - both need to read
// settings, mint a unique slug, check for near-duplicates, and insert an
// article the same way, so that logic lives here once instead of twice.
import { query } from "../../db.js";
import { slugify } from "../rss/slugify.js";
import { normalize, jaccardSimilarity, DUPLICATE_SIMILARITY_THRESHOLD } from "../rss/grouping.js";

// AbortSignal.timeout() rejects fetch() with a DOMException named
// "TimeoutError" (some runtimes/older behavior surface "AbortError"
// instead) - either way it means the AI provider call in
// openaiProvider.js/anthropicProvider.js hung past FETCH_TIMEOUT_MS rather
// than actually failing. Used by both scanAndGenerate.js and
// runAnalysis.js so a timed-out story gets skipped with a clear log line
// instead of taking the whole scan down.
export function describeGenerationError(err) {
  if (err.name === "TimeoutError" || err.name === "AbortError") return "timed out";
  return err.message;
}

// Saturday/Sunday by UTC calendar day - used to throttle Stocks/Indices/
// Commodities (those markets are closed, so there's no genuine new price
// movement to report) while leaving Crypto completely unaffected, since it
// trades 24/7. Shared by scanAndGenerate.js (weekend daily caps) and
// runAnalysis.js (skips SPY/GLD/WTI entirely on weekends).
export function isWeekendUTC(date = new Date()) {
  const day = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

// Category-mismatch detection (scanAndGenerate.js) used to rely entirely on
// the AI's own self-reported detected_category vs. the RSS source's
// pre-assigned category - which only catches a mismatch when the model's
// own classification disagrees with the source. It does nothing when the
// model ALSO anchors on the source's usual topic instead of judging the
// content independently (pre-launch audit found two real examples: a CoinDesk
// story about a BIS official's AI-investment warning, and one about a
// Connecticut sports-betting lawsuit, both filed - and self-classified - as
// Crypto with zero crypto content). This is a second, independent,
// deterministic signal: does the story even mention anything belonging to
// its assigned category at all. "stocks" and "indices" share one combined
// list rather than being checked against each other - the two are
// deliberately overlapping in this codebase already (see the "dual" source
// concept in fetchSources.js/seed.js), so cross-flagging one as the other
// would be a false positive, not a catch.
const CATEGORY_KEYWORDS = {
  Crypto: [
    "bitcoin", "btc", "ethereum", "eth", "crypto", "cryptocurrency", "blockchain", "token", "altcoin",
    "stablecoin", "defi", "nft", "web3", "wallet", "binance", "coinbase", "kraken", "solana", " sol ",
    "xrp", "ripple", "dogecoin", "satoshi", "decentralized", "coinex", "coindesk", "cointelegraph",
  ],
  Commodities: [
    "oil", "crude", "wti", "brent", "gold", "silver", "natural gas", "opec", "barrel", "ounce", "lng",
    "commodity", "commodities", "copper", "wheat", "corn", "tanker", "pipeline",
  ],
  Stocks: [
    "stock", "share", "shares", "nasdaq", "nyse", "ipo", "earnings", "dividend", "ticker", "s&p",
    "dow", "equity", "equities", "index", "indices", "corp", "inc.", "ceo", "quarterly", "revenue",
    "ftse", "nikkei", "dax", "russell", "benchmark", "etf", "listed",
  ],
};
CATEGORY_KEYWORDS.Indices = CATEGORY_KEYWORDS.Stocks; // one combined list, see comment above

// Returns true if the story shows no real sign of belonging to
// categoryName - a signal it may be miscategorized regardless of what the
// source or the model's own classification says. Categories with no
// keyword list (Analysis - not RSS-sourced, has no mismatch check at all)
// always return false (never flagged this way).
//
// Title and body are weighted differently on purpose, not treated as one
// blob: the headline is what a story is fundamentally ABOUT, so a single
// keyword there is trusted outright. The body can incidentally name
// something without the story being about it - live example that shaped
// this (pre-launch audit): a sports-betting lawsuit article named
// "Coinbase" once, as one of three platforms sued alongside it, which let
// a naive "does this text contain ANY crypto keyword" check wave through
// a story with a completely non-crypto headline. Requiring at least 2
// separate body keyword hits when the title has none filters out that
// kind of single incidental namedrop while still trusting a body that's
// genuinely, repeatedly about the category.
export function contentLacksCategoryKeywords(categoryName, title, body) {
  const keywords = CATEGORY_KEYWORDS[categoryName];
  if (!keywords) return false;

  const titleHay = title.toLowerCase();
  if (keywords.some((kw) => titleHay.includes(kw))) return false;

  const bodyHay = body.toLowerCase();
  const bodyHits = keywords.filter((kw) => bodyHay.includes(kw)).length;
  return bodyHits < 2;
}

export async function getSetting(key, fallback) {
  const { rows } = await query("SELECT value FROM settings WHERE key = $1", [key]);
  return rows.length ? rows[0].value : fallback;
}

export async function uniqueSlug(base) {
  let slug = slugify(base);
  let suffix = 0;
  // Practically this loop runs 0-1 times; it's here so two stories with the
  // same headline on the same day never collide.
  while (true) {
    const candidate = suffix === 0 ? slug : `${slug}-${suffix}`;
    const { rows } = await query("SELECT 1 FROM articles WHERE slug = $1", [candidate]);
    if (rows.length === 0) return candidate;
    suffix += 1;
  }
}

// How many articles (any status) this category has already generated today -
// used to enforce the per-category daily cap.
export async function articlesCreatedToday(categoryId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count FROM articles
     WHERE category_id = $1 AND created_at >= date_trunc('day', now())`,
    [categoryId]
  );
  return rows[0].count;
}

// Spec 5.4: before saving a new draft, compare it against the last ~40
// articles in the same category (word-overlap on the body). Above the
// threshold it's treated as a near-duplicate and discarded rather than
// published or sent to review.
export async function isDuplicateInCategory(categoryId, bodyText, limit = 40) {
  const { rows } = await query(
    `SELECT body FROM articles WHERE category_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [categoryId, limit]
  );
  const words = normalize(bodyText);
  return rows.some((r) => jaccardSimilarity(words, normalize(r.body)) >= DUPLICATE_SIMILARITY_THRESHOLD);
}

// Spec 5.1/continuation: if this same story was already covered recently in
// this category, tell the AI so it writes an update instead of repeating
// itself. Matches on headline word-overlap against the story's own item
// titles (the AI hasn't written a headline yet at this point).
export async function findPreviousCoverage(categoryId, referenceTitles, withinHours = 72) {
  const { rows } = await query(
    `SELECT title, body, published_at FROM articles
     WHERE category_id = $1 AND status = 'published'
       AND published_at >= now() - ($2 || ' hours')::interval
     ORDER BY published_at DESC
     LIMIT 20`,
    [categoryId, withinHours]
  );

  const words = normalize(referenceTitles.join(" "));
  for (const row of rows) {
    if (jaccardSimilarity(words, normalize(row.title)) >= 0.25) {
      const hoursAgo = Math.max(1, Math.round((Date.now() - new Date(row.published_at).getTime()) / 3600000));
      return { title: row.title, hoursAgo, keyFacts: row.body.split("\n\n")[0].slice(0, 200) };
    }
  }
  return undefined;
}

export async function insertArticle({
  slug,
  title,
  dek,
  body,
  categoryId,
  status,
  seoTitle,
  seoDescription,
  readMinutes,
  sourceCount,
  aiProvider,
  publishedAt,
  // Defaulted so runAnalysis.js's existing call (which never passes these -
  // Analysis articles have no source-based category to mismatch against,
  // and no crypto-price check applies to them) doesn't need to change.
  categoryMismatch = false,
  categoryMismatchNote = null,
  priceMismatch = false,
  priceMismatchNote = null,
  // Set only for status="scheduled" (delayed auto-publish - see
  // services/rss/scanAndGenerate.js). null for every other status.
  autoPublishAt = null,
}) {
  const { rows } = await query(
    `INSERT INTO articles
       (slug, title, dek, body, category_id, status, seo_title, seo_description,
        read_minutes, source_count, ai_provider, published_at, category_mismatch, category_mismatch_note,
        price_mismatch, price_mismatch_note, auto_publish_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING id`,
    [slug, title, dek, body, categoryId, status, seoTitle, seoDescription, readMinutes, sourceCount, aiProvider, publishedAt, categoryMismatch, categoryMismatchNote, priceMismatch, priceMismatchNote, autoPublishAt]
  );
  return rows[0].id;
}
