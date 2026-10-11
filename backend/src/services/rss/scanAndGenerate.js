import { query } from "../../db.js";
import pool from "../../db.js";
import { fetchSourceItemsForCategory, fetchDualStocksIndicesItems } from "./fetchSources.js";
import { groupSimilarItems } from "./grouping.js";
import { generateArticle } from "../ai/provider.js";
import { PARAGRAPH2_DIRECTIVES } from "../ai/newsParagraph2Templates.js";
import { selectTemplate } from "../ai/templateSelection.js";
import { getCryptoTicker, getCommoditySnapshot, getEquityTicker } from "../marketData/prices.js";
import { formatMarketValue } from "../marketData/formatMarketValue.js";
import { sendScheduledArticleAlert } from "../notifications/mailer.js";
import {
  getSetting,
  uniqueSlug,
  articlesCreatedToday,
  isDuplicateInCategory,
  findPreviousCoverage,
  insertArticle,
  describeGenerationError,
  isWeekendUTC,
  contentLacksCategoryKeywords,
} from "../shared/articleUtils.js";

const DEFAULT_DAILY_CAPS = { crypto: 6, stocks: 4, indices: 2, commodities: 2 };

const DEFAULT_AUTO_PUBLISH_DELAY_HOURS = 5;

const WEEKEND_THROTTLED_CATEGORIES = new Set(["stocks", "indices", "commodities"]);
const DEFAULT_WEEKEND_CAPS = { stocks: 1, indices: 1, commodities: 1 };

const INDEX_WORDS = ["s&p", "nasdaq", "dow jones", "index", "indices", "ftse", "stoxx"];

function looksLikeIndexStory(item) {
  const text = `${item.title} ${item.contentSnippet || ""}`.toLowerCase();
  return INDEX_WORDS.some((w) => text.includes(w));
}

const DEFAULT_PEAK_WINDOWS = {
  euro_open: ["06:30", "07:30"],
  us_open: ["13:00", "14:00"],
  us_close: ["19:30", "21:30"],
};

function minutesSinceMidnightUTC(date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function parseHHMM(str) {
  const [h, m] = str.split(":").map(Number);
  return h * 60 + m;
}

async function isInsidePeakWindow(now = new Date()) {
  const nowMinutes = minutesSinceMidnightUTC(now);
  for (const [name, [defaultStart, defaultEnd]] of Object.entries(DEFAULT_PEAK_WINDOWS)) {
    const start = parseHHMM(await getSetting(`peak_window_${name}_start`, defaultStart));
    const end = parseHHMM(await getSetting(`peak_window_${name}_end`, defaultEnd));
    if (nowMinutes >= start && nowMinutes <= end) return true;
  }
  return false;
}

function latestPubDate(group) {
  return Math.max(...group.map((i) => i.pubDate.getTime()));
}

export const FRESHNESS_WINDOW_HOURS = 72;

export function filterFreshItems(items, now = new Date()) {
  const cutoff = now.getTime() - FRESHNESS_WINDOW_HOURS * 60 * 60 * 1000;
  const fresh = items.filter((i) => i.pubDate.getTime() >= cutoff);
  return { fresh, staleCount: items.length - fresh.length };
}

const PRICE_MISMATCH_THRESHOLD = 0.15; // >15% off current market price

// Dollar figures like "$32,000" or "$1,850.50".
const DOLLAR_AMOUNT_RE = /\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)/g;
const CRYPTO_MENTION_PATTERNS = {
  BTC: /\b(bitcoin|btc)\b/i,
  ETH: /\b(ethereum|eth)\b/i,
};

export function extractCryptoPriceMentions(text) {
  const sentences = (text || "").split(/(?<=[.!?])\s+/);
  const mentions = [];
  for (const sentence of sentences) {
    for (const [symbol, re] of Object.entries(CRYPTO_MENTION_PATTERNS)) {
      if (!re.test(sentence)) continue;
      for (const match of sentence.matchAll(DOLLAR_AMOUNT_RE)) {
        const value = Number(match[1].replace(/,/g, ""));
        if (Number.isFinite(value)) mentions.push({ symbol, value });
      }
    }
  }
  return mentions;
}

export function findPriceMismatch(mentions, tickerBySymbol) {
  for (const { symbol, value } of mentions) {
    const live = tickerBySymbol[symbol];
    if (!live) continue;
    const diff = Math.abs(value - live) / live;
    if (diff > PRICE_MISMATCH_THRESHOLD) {
      return `Stated price ${formatMarketValue(value, "crypto")} differs significantly from current market price ${formatMarketValue(live, "crypto")} for ${symbol} (${Math.round(diff * 100)}% off) - verify before publishing.`;
    }
  }
  return null;
}

const COMMODITY_MENTION_PATTERNS = {
  GOLD: /\b(gold|xau)\b/i,
  OIL: /\b(oil|wti|crude)\b/i,
};

export function extractCommodityPriceMentions(text) {
  const sentences = (text || "").split(/(?<=[.!?])\s+/);
  const mentions = [];
  for (const sentence of sentences) {
    for (const [symbol, re] of Object.entries(COMMODITY_MENTION_PATTERNS)) {
      if (!re.test(sentence)) continue;
      for (const match of sentence.matchAll(DOLLAR_AMOUNT_RE)) {
        const value = Number(match[1].replace(/,/g, ""));
        if (Number.isFinite(value)) mentions.push({ symbol, value });
      }
    }
  }
  return mentions;
}

function priceAppearsInText(value, text) {
  if (!text) return false;
  const candidates = new Set([
    value.toLocaleString("en-US"),
    String(value),
    Math.round(value).toLocaleString("en-US"),
    String(Math.round(value)),
  ]);
  return [...candidates].some((c) => text.includes(c));
}

export function findCommodityPriceMismatch(mentions, tickerBySymbol, sourceText) {
  for (const { symbol, value } of mentions) {
    const live = tickerBySymbol[symbol];
    if (live) {
      const diff = Math.abs(value - live) / live;
      if (diff <= PRICE_MISMATCH_THRESHOLD) continue;
    }
    if (priceAppearsInText(value, sourceText)) continue;
    const liveNote = live ? ` (current cached ${symbol} price: ${formatMarketValue(live, "commodity")})` : "";
    return `Stated price ${formatMarketValue(value, "commodity")} for ${symbol} does not match the current cached price${liveNote} and was not found in the source material - likely fabricated, verify before publishing.`;
  }
  return null;
}

const INDEX_MENTION_PATTERNS = {
  SP500: /\b(s&p\s?500|s&p)\b/i,
  NASDAQ: /\bnasdaq(-|\s)?100\b|\bnasdaq\b/i,
};

const INDEX_AMOUNT_RE = /\$?\s?([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?)/g;

export function extractIndexPriceMentions(text) {
  const sentences = (text || "").split(/(?<=[.!?])\s+/);
  const mentions = [];
  for (const sentence of sentences) {
    for (const [symbol, re] of Object.entries(INDEX_MENTION_PATTERNS)) {
      if (!re.test(sentence)) continue;
      for (const match of sentence.matchAll(INDEX_AMOUNT_RE)) {
        const value = Number(match[1].replace(/,/g, ""));
        if (Number.isFinite(value)) mentions.push({ symbol, value });
      }
    }
  }
  return mentions;
}

export function findIndexPriceMismatch(mentions, tickerBySymbol, sourceText) {
  for (const { symbol, value } of mentions) {
    const live = tickerBySymbol[symbol];
    if (live) {
      const diff = Math.abs(value - live) / live;
      if (diff <= PRICE_MISMATCH_THRESHOLD) continue;
    }
    if (priceAppearsInText(value, sourceText)) continue;
    const liveNote = live ? ` (current cached ${symbol} level: ${formatMarketValue(live, "index")})` : "";
    return `Stated level ${formatMarketValue(value, "index")} for ${symbol} does not match the current cached level${liveNote} and was not found in the source material - likely fabricated, verify before publishing.`;
  }
  return null;
}

const PRICE_MOVEMENT_VERBS_RE = /\b(rose|rise|rising|risen|fell|fall|falling|fallen|gained|gain|gaining|dropped|drop|dropping|surged|surge|surging|plunged|plunge|plunging|climbed|climb|climbing|slipped|slip|slipping|jumped|jump|jumping|declined|decline|declining|advanced|advance|advancing|slid|slide|sliding|tumbled|tumble|tumbling)\b/i;
const PERCENT_RE = /(\d+(?:\.\d+)?)\s?%/g;

export function extractPercentMentions(text) {
  const sentences = (text || "").split(/(?<=[.!?])\s+/);
  const mentions = [];
  for (const sentence of sentences) {
    if (!PRICE_MOVEMENT_VERBS_RE.test(sentence)) continue;
    for (const match of sentence.matchAll(PERCENT_RE)) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) mentions.push(value);
    }
  }
  return mentions;
}

function percentAppearsInText(value, text) {
  if (!text) return false;
  const candidates = [value.toFixed(1), String(value), String(Math.round(value))];
  return candidates.some((c) => new RegExp(`${c}\\s?(%|percent)`, "i").test(text));
}

export function findPercentMismatch(mentions, sourceText) {
  for (const value of mentions) {
    if (percentAppearsInText(value, sourceText)) continue;
    return `Stated move of ${value}% was not found in the source material - likely fabricated, verify before publishing.`;
  }
  return null;
}

const MIN_SUBSTANTIVE_SNIPPET_LENGTH = 30;

export function groupHasNoSubstantiveContent(group) {
  return group.every((i) => (i.contentSnippet || "").trim().length < MIN_SUBSTANTIVE_SNIPPET_LENGTH);
}

const CURRENT_YEAR = new Date().getUTCFullYear();
const RELATIVE_PAST_RE = /\b(last year|a year ago)\b/i;

function pastYearMentionCount(text) {
  const years = (text.match(/\b20\d{2}\b/g) || []).map(Number).filter((y) => y < CURRENT_YEAR);
  const relative = RELATIVE_PAST_RE.test(text) ? 1 : 0;
  return years.length + relative;
}

export function findStaleSubjectMention(group) {
  for (const item of group) {
    if (pastYearMentionCount(item.title) > 0) {
      return `Headline "${item.title}" explicitly names a past period - confirm this is being reported as historical context, not as current news.`;
    }
  }
  const bodyText = group.map((i) => i.contentSnippet || "").join(" ");
  if (pastYearMentionCount(bodyText) >= 2) {
    return `Source material repeatedly references a past period (not the headline) - confirm the article states that plainly rather than presenting it as current.`;
  }
  return null;
}

export function findStaleOrThinSource(group) {
  if (groupHasNoSubstantiveContent(group)) {
    return `No source for this story (${group.map((i) => i.sourceName).join(", ")}) supplied any real content beyond a headline - any specific figure, date, or attribution in the draft was not verifiably from this report and may be the model filling the gap from general knowledge, possibly outdated.`;
  }
  return findStaleSubjectMention(group);
}

export function decideArticleStatus({
  isMockProvider,
  categoryMismatch,
  priceMismatch,
  staleContent,
  verificationClean,
  isMultiSourceAutoPublish,
  autoPublishDelayHours,
  now = new Date(),
}) {
  const hasAnyFlag = categoryMismatch || priceMismatch || staleContent || !verificationClean;
  if (isMockProvider || hasAnyFlag) {
    return { status: "review", autoPublishAt: null };
  }
  if (isMultiSourceAutoPublish) {
    return { status: "published", autoPublishAt: null };
  }
  return {
    status: "scheduled",
    autoPublishAt: new Date(now.getTime() + autoPublishDelayHours * 60 * 60 * 1000),
  };
}

async function alreadyStored(links) {
  if (links.length === 0) return new Set();
  const { rows } = await query(
    "SELECT source_url FROM article_sources WHERE source_url = ANY($1::text[])",
    [links]
  );
  return new Set(rows.map((r) => r.source_url));
}

async function getRecentlyUsedParagraph2TemplateIds(categoryId, limit = 5) {
  const { rows } = await query(
    `SELECT paragraph2_template_id FROM articles
     WHERE category_id = $1 AND status = 'published' AND paragraph2_template_id IS NOT NULL
     ORDER BY published_at DESC LIMIT $2`,
    [categoryId, limit]
  );
  return rows.map((r) => r.paragraph2_template_id);
}

export async function insertArticleWithSourcesOrDiscard(articleFields, group) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const boundQuery = (text, params) => client.query(text, params);
    const articleId = await insertArticle({ ...articleFields, queryFn: boundQuery });

    for (const item of group) {
      const result = await client.query(
        "INSERT INTO article_sources (article_id, source_name, source_url) VALUES ($1, $2, $3) ON CONFLICT (source_url) DO NOTHING",
        [articleId, item.sourceName, item.link]
      );
      if (result.rowCount === 0) {
        await client.query("ROLLBACK");
        return null;
      }
    }

    await client.query("COMMIT");
    return articleId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function runScanAndGenerate() {
  const { rows: categories } = await query("SELECT id, slug, name FROM categories WHERE slug != 'analysis'");
  const autoPublish = (await getSetting("auto_publish", "true")) === "true";
  const minSources = Number(process.env.AUTO_PUBLISH_MIN_SOURCES || 2);

  const totals = {
    itemsScanned: 0,
    newStories: 0,
    published: 0,
    sentToReview: 0,
    skippedDuplicate: 0,
    skippedCap: 0,
    skippedError: 0,
    categoryMismatch: 0,
    priceMismatch: 0,
    staleContent: 0,
    filteredStale: 0,
    scheduled: 0,
  };

  const autoPublishDelayHours = Number(await getSetting("auto_publish_delay_hours", DEFAULT_AUTO_PUBLISH_DELAY_HOURS));

  const dualItems = await fetchDualStocksIndicesItems();
  const dualLinks = new Set(dualItems.map((i) => i.link));

  let cryptoTickerBySymbol = {};
  if (categories.some((c) => c.slug === "crypto")) {
    try {
      const ticker = await getCryptoTicker();
      cryptoTickerBySymbol = Object.fromEntries(ticker.map((t) => [t.symbol, t.price]));
    } catch (err) {
      console.error(`AI engine: could not fetch live crypto prices for the price-plausibility check - ${err.message}. Skipping that check for this scan.`);
    }
  }

  let commodityTickerBySymbol = {};
  if (categories.some((c) => c.slug === "commodities")) {
    try {
      const [gold, wti] = await Promise.all([getCommoditySnapshot("gold"), getCommoditySnapshot("wti")]);
      if (gold) commodityTickerBySymbol.GOLD = gold.price;
      if (wti) commodityTickerBySymbol.OIL = wti.price;
    } catch (err) {
      console.error(`AI engine: could not fetch the cached Gold/WTI price for the price-plausibility check - ${err.message}. Gold/Oil mentions will only be checked against source material this scan.`);
    }
  }

  let indexTickerBySymbol = {};
  if (categories.some((c) => c.slug === "indices")) {
    try {
      const equity = await getEquityTicker();
      for (const item of equity) {
        if (item.symbol === "S&P 500") indexTickerBySymbol.SP500 = item.price;
        else if (item.symbol === "Nasdaq") indexTickerBySymbol.NASDAQ = item.price;
      }
    } catch (err) {
      console.error(`AI engine: could not fetch live index levels for the price-plausibility check - ${err.message}. Skipping that check for this scan.`);
    }
  }

  const weekend = isWeekendUTC();
  const inPeakWindow = await isInsidePeakWindow();

  for (const category of categories) {
    const cap = weekend && WEEKEND_THROTTLED_CATEGORIES.has(category.slug)
      ? Number(await getSetting(`weekend_cap_${category.slug}`, DEFAULT_WEEKEND_CAPS[category.slug] ?? 1))
      : Number(await getSetting(`daily_cap_${category.slug}`, DEFAULT_DAILY_CAPS[category.slug] ?? 4));

    const usedToday = await articlesCreatedToday(category.id);
    let remaining = cap - usedToday;
    if (remaining <= 0) {
      continue;
    }

    let usedParagraph2Ids = await getRecentlyUsedParagraph2TemplateIds(category.id);

    let items = await fetchSourceItemsForCategory(category.id);

    if (category.slug === "stocks") {
      items = items.filter((i) => !(dualLinks.has(i.link) && looksLikeIndexStory(i)));
    } else if (category.slug === "indices") {
      items = items.concat(dualItems.filter(looksLikeIndexStory));
    }

    totals.itemsScanned += items.length;

    const { fresh: recentItems, staleCount } = filterFreshItems(items);
    if (staleCount > 0) {
      console.log(
        `AI engine: ${category.slug} - filtered ${staleCount} stale item(s) older than ${FRESHNESS_WINDOW_HOURS}h before grouping.`
      );
    }
    totals.filteredStale += staleCount;

    const stored = await alreadyStored(recentItems.map((i) => i.link));
    const newItems = recentItems.filter((i) => !stored.has(i.link));
    const groups = groupSimilarItems(newItems);
    totals.newStories += groups.length;

    if (inPeakWindow) {
      groups.sort((a, b) => latestPubDate(b) - latestPubDate(a));
    }

    for (const group of groups) {
      if (remaining <= 0) {
        totals.skippedCap += 1;
        continue;
      }

      const previousCoverage = await findPreviousCoverage(category.id, group.map((i) => i.title));

      const paragraph2Template = selectTemplate(PARAGRAPH2_DIRECTIVES, null, usedParagraph2Ids);
      usedParagraph2Ids = [...usedParagraph2Ids, paragraph2Template.id];

      const isThinSource = groupHasNoSubstantiveContent(group);

      let draft;
      try {
        draft = await generateArticle(group, previousCoverage, category.name, paragraph2Template.instruction, isThinSource);
      } catch (err) {
        console.error(
          `AI engine: skipped a story in ${category.slug} ("${group[0].title}") - generation failed: ${describeGenerationError(err)}.`
        );
        totals.skippedError += 1;
        continue;
      }

      if (await isDuplicateInCategory(category.id, draft.body)) {
        console.log(`AI engine: discarded a near-duplicate draft in ${category.slug}: "${draft.title}"`);
        totals.skippedDuplicate += 1;
        continue;
      }

      const modelDisagrees = Boolean(draft.detected_category) && draft.detected_category !== category.name;
      const keywordsMissing = contentLacksCategoryKeywords(category.name, draft.title, `${draft.dek} ${draft.body}`);
      const categoryMismatch = modelDisagrees || keywordsMissing;
      const categoryMismatchNote = modelDisagrees
        ? `Filed as ${category.name}, but content suggests ${draft.detected_category}.`
        : keywordsMissing
          ? `Filed as ${category.name}, but no ${category.name.toLowerCase()}-related keywords found in the story content.`
          : null;
      if (categoryMismatch) {
        console.warn(`AI engine: category mismatch - "${draft.title}" ${categoryMismatchNote}`);
        totals.categoryMismatch += 1;
      }

      let priceMismatch = false;
      let priceMismatchNote = null;
      if (category.slug === "crypto") {
        const mentions = extractCryptoPriceMentions(`${draft.title} ${draft.dek} ${draft.body}`);
        const note = findPriceMismatch(mentions, cryptoTickerBySymbol);
        if (note) {
          priceMismatch = true;
          priceMismatchNote = note;
          console.warn(`AI engine: price mismatch - "${draft.title}" ${priceMismatchNote}`);
          totals.priceMismatch += 1;
        }
      } else if (category.slug === "commodities") {
        const mentions = extractCommodityPriceMentions(`${draft.title} ${draft.dek} ${draft.body}`);
        const sourceText = group.map((i) => `${i.title} ${i.contentSnippet || ""}`).join(" ");
        const note = findCommodityPriceMismatch(mentions, commodityTickerBySymbol, sourceText);
        if (note) {
          priceMismatch = true;
          priceMismatchNote = note;
          console.warn(`AI engine: price mismatch - "${draft.title}" ${priceMismatchNote}`);
          totals.priceMismatch += 1;
        }
      } else if (category.slug === "indices") {
        const mentions = extractIndexPriceMentions(`${draft.title} ${draft.dek} ${draft.body}`);
        const sourceText = group.map((i) => `${i.title} ${i.contentSnippet || ""}`).join(" ");
        const note = findIndexPriceMismatch(mentions, indexTickerBySymbol, sourceText);
        if (note) {
          priceMismatch = true;
          priceMismatchNote = note;
          console.warn(`AI engine: price mismatch - "${draft.title}" ${priceMismatchNote}`);
          totals.priceMismatch += 1;
        }
      }

      if (!priceMismatch) {
        const percentMentions = extractPercentMentions(`${draft.title} ${draft.dek} ${draft.body}`);
        const sourceText = group.map((i) => `${i.title} ${i.contentSnippet || ""}`).join(" ");
        const note = findPercentMismatch(percentMentions, sourceText);
        if (note) {
          priceMismatch = true;
          priceMismatchNote = note;
          console.warn(`AI engine: price mismatch - "${draft.title}" ${priceMismatchNote}`);
          totals.priceMismatch += 1;
        }
      }

      const staleContentNote = findStaleOrThinSource(group);
      const staleContent = Boolean(staleContentNote);
      if (staleContent) {
        console.warn(`AI engine: stale/thin source - "${draft.title}" ${staleContentNote}`);
        totals.staleContent += 1;
      }

      const isMultiSourceAutoPublish = group.length >= minSources && autoPublish;
      const { status, autoPublishAt } = decideArticleStatus({
        isMockProvider: draft.provider === "mock",
        categoryMismatch,
        priceMismatch,
        staleContent,
        verificationClean: draft.verificationClean,
        isMultiSourceAutoPublish,
        autoPublishDelayHours,
      });
      if (status === "scheduled") {
        console.log(
          `AI engine: ${category.slug} - "${draft.title}" is a clean single-source article, scheduled to auto-publish in ${autoPublishDelayHours}h.`
        );
      }

      const slug = await uniqueSlug(draft.title);
      const wordCount = draft.body.split(/\s+/).length;
      const readMinutes = Math.max(1, Math.round(wordCount / 200));

      const articleId = await insertArticleWithSourcesOrDiscard(
        {
          slug,
          title: draft.title,
          dek: draft.dek,
          body: draft.body,
          categoryId: category.id,
          status,
          seoTitle: draft.seo_title,
          seoDescription: draft.seo_description,
          readMinutes,
          sourceCount: group.length,
          aiProvider: draft.provider,
          publishedAt: status === "published" ? new Date() : null,
          categoryMismatch,
          categoryMismatchNote,
          priceMismatch,
          priceMismatchNote,
          staleContent,
          staleContentNote,
          autoPublishAt,
          paragraph2TemplateId: paragraph2Template.id,
        },
        group
      );

      if (articleId === null) {
        console.log(`AI engine: ${category.slug} - "${draft.title}" lost a race with another scan already covering this source - discarded.`);
        totals.skippedDuplicate += 1;
        continue;
      }

      if (status === "scheduled") {
        await sendScheduledArticleAlert({
          articleId,
          title: draft.title,
          categoryName: category.name,
          sourceName: group[0].sourceName,
          sourceUrl: group[0].link,
          autoPublishAt,
        });
      }

      remaining -= 1;
      if (status === "published") totals.published += 1;
      else if (status === "scheduled") totals.scheduled += 1;
      else totals.sentToReview += 1;
    }
  }

  return totals;
}

export async function publishDueScheduledArticles() {
  const { rows } = await query(
    `UPDATE articles
     SET status = 'published', published_at = now()
     WHERE status = 'scheduled' AND auto_publish_at <= now()
     RETURNING id, title`
  );
  return rows;
}
