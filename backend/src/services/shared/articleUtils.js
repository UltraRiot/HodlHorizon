import { query } from "../../db.js";
import { slugify } from "../rss/slugify.js";
import { normalize, jaccardSimilarity, DUPLICATE_SIMILARITY_THRESHOLD } from "../rss/grouping.js";

export const HIDDEN_CATEGORY_SLUGS = ["analysis"];

export function describeGenerationError(err) {
  if (err.name === "TimeoutError" || err.name === "AbortError") return "timed out";
  return err.message;
}

export function isWeekendUTC(date = new Date()) {
  const day = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

const CATEGORY_KEYWORDS = {
  Crypto: [
    "bitcoin", "btc", "ethereum", "eth", "crypto", "cryptocurrency", "blockchain", "token", "altcoin",
    "stablecoin", "defi", "nft", "web3", "wallet", "binance", "coinbase", "kraken", "solana", " sol ",
    "xrp", "ripple", "dogecoin", "satoshi", "decentralized", "coinex", "coindesk", "cointelegraph",
  ],
  Commodities: [
    "oil", "crude", "wti", "brent", "gold", "silver", "natural gas", "opec", "barrel", "ounce", "lng",
    "commodity", "commodities", "copper", "wheat", "corn", "tanker", "pipeline",
    "mining", "mine", "miner", "minerals",
  ],
  Stocks: [
    "stock", "share", "shares", "nasdaq", "nyse", "ipo", "earnings", "dividend", "ticker", "s&p",
    "dow", "equity", "equities", "index", "indices", "corp", "inc.", "ceo", "quarterly", "revenue",
    "ftse", "nikkei", "dax", "russell", "benchmark", "etf", "listed",
    "merger", "acquisition", "investors", "lawsuit", "settlement",
  ],
};
CATEGORY_KEYWORDS.Indices = CATEGORY_KEYWORDS.Stocks;

const STRONG_CATEGORY_KEYWORDS = {
  Commodities: ["commodity", "commodities"],
  Stocks: ["stock", "stocks", "equity", "equities"],
};
STRONG_CATEGORY_KEYWORDS.Indices = STRONG_CATEGORY_KEYWORDS.Stocks;

export function contentLacksCategoryKeywords(categoryName, title, body) {
  const keywords = CATEGORY_KEYWORDS[categoryName];
  if (!keywords) return false;

  const titleHay = title.toLowerCase();
  if (keywords.some((kw) => titleHay.includes(kw))) return false;

  const bodyHay = body.toLowerCase();
  const strongKeywords = STRONG_CATEGORY_KEYWORDS[categoryName];
  if (strongKeywords?.some((kw) => bodyHay.includes(kw))) return false;

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
  while (true) {
    const candidate = suffix === 0 ? slug : `${slug}-${suffix}`;
    const { rows } = await query("SELECT 1 FROM articles WHERE slug = $1", [candidate]);
    if (rows.length === 0) return candidate;
    suffix += 1;
  }
}

export async function articlesCreatedToday(categoryId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count FROM articles
     WHERE category_id = $1 AND created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
    [categoryId]
  );
  return rows[0].count;
}

export async function isDuplicateInCategory(categoryId, bodyText, limit = 40) {
  const { rows } = await query(
    `SELECT body FROM articles WHERE category_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [categoryId, limit]
  );
  const words = normalize(bodyText);
  return rows.some((r) => jaccardSimilarity(words, normalize(r.body)) >= DUPLICATE_SIMILARITY_THRESHOLD);
}

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
  categoryMismatch = false,
  categoryMismatchNote = null,
  priceMismatch = false,
  priceMismatchNote = null,
  staleContent = false,
  staleContentNote = null,
  analysisSymbol = null,
  openingTemplateId = null,
  closingTemplateId = null,
  usedCoverageArticleIds = null,
  paragraph2TemplateId = null,
  autoPublishAt = null,
  queryFn = query,
}) {
  const { rows } = await queryFn(
    `INSERT INTO articles
       (slug, title, dek, body, category_id, status, seo_title, seo_description,
        read_minutes, source_count, ai_provider, published_at, category_mismatch, category_mismatch_note,
        price_mismatch, price_mismatch_note, stale_content, stale_content_note, analysis_symbol,
        opening_template_id, closing_template_id, used_coverage_article_ids, auto_publish_at, paragraph2_template_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
     RETURNING id`,
    [slug, title, dek, body, categoryId, status, seoTitle, seoDescription, readMinutes, sourceCount, aiProvider, publishedAt, categoryMismatch, categoryMismatchNote, priceMismatch, priceMismatchNote, staleContent, staleContentNote, analysisSymbol, openingTemplateId, closingTemplateId, usedCoverageArticleIds, autoPublishAt, paragraph2TemplateId]
  );
  return rows[0].id;
}
