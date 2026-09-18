// The heart of the news engine. Runs once per category (each category only
// scans its own pre-assigned sources - see migrations/002 and seed.js), and
// for each:
//   1. Fetches that category's active RSS sources
//   2. Drops anything already turned into an article
//   3. Groups the rest into "stories" (headlines that look like the same event)
//   4. Writes a short brief for each new story with the AI provider, telling
//      it if this site already covered the story recently (write an update)
//   5. Discards near-duplicate drafts instead of saving them
//   6. Auto-publishes if enough independent sources reported the story,
//      otherwise leaves it in "review" for a human to check
//   7. Stops once the category's daily article cap is hit
//
// The Analysis category is skipped here entirely - it has no RSS sources and
// is handled by the separate job in services/analysis/runAnalysis.js.
import { query } from "../../db.js";
import { fetchSourceItemsForCategory, fetchDualStocksIndicesItems } from "./fetchSources.js";
import { groupSimilarItems } from "./grouping.js";
import { generateArticle } from "../ai/provider.js";
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

// Used only if a category has no daily_cap_<slug> row in settings yet.
const DEFAULT_DAILY_CAPS = { crypto: 6, stocks: 4, indices: 2, commodities: 2 };

// Used only if settings has no auto_publish_delay_hours row yet (see
// migrations/010_delayed_auto_publish.sql, which seeds it to the same
// value - this is just the in-code fallback if that row is ever deleted).
const DEFAULT_AUTO_PUBLISH_DELAY_HOURS = 5;

// Weekend market-closed gate: Stocks/Indices/Commodities markets are shut
// Saturday/Sunday, so there's nothing genuinely new to report - drop to a
// near-zero cap those two days instead of the normal weekday one. Crypto
// is deliberately excluded (trades 24/7, no weekend throttle at all).
const WEEKEND_THROTTLED_CATEGORIES = new Set(["stocks", "indices", "commodities"]);
const DEFAULT_WEEKEND_CAPS = { stocks: 1, indices: 1, commodities: 1 };

// Yahoo Finance / Investing.com Stock Market News are general finance wires
// tagged Stocks (their owning category) but shared with Indices too - a
// single story from either could be about one stock or an index. This is a
// narrow, deliberately small keyword check that only ever breaks the tie
// between those two categories for dual-tagged sources - it's not a
// reintroduction of the old global guessCategory() keyword guesser.
const INDEX_WORDS = ["s&p", "nasdaq", "dow jones", "index", "indices", "ftse", "stoxx"];

function looksLikeIndexStory(item) {
  const text = `${item.title} ${item.contentSnippet || ""}`.toLowerCase();
  return INDEX_WORDS.some((w) => text.includes(w));
}

// Peak windows around real market open/close moments - a priority signal,
// not a hard gate. Inside one of these UTC time-of-day windows, groups get
// sorted freshest-first before the daily cap is applied, so a story that
// broke right at the open/close doesn't lose out to an older one that
// happens to be processed first; outside these windows, groups keep their
// natural (unsorted) order exactly as before this feature existed.
// Windows are "HH:MM" 24h UTC settings-table values - see migrations/008.
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

// Freshness gate: an item older than this is never allowed into story
// grouping, so a stale RSS entry (a feed re-publishing an old item, a
// crawl backlog, a first-ever scan pulling a source's whole history) can
// never become a new article. Exported so it's directly testable against a
// crafted item, the same reason currentPacingCeiling() is exported below.
export const FRESHNESS_WINDOW_HOURS = 72;

export function filterFreshItems(items, now = new Date()) {
  const cutoff = now.getTime() - FRESHNESS_WINDOW_HOURS * 60 * 60 * 1000;
  const fresh = items.filter((i) => i.pubDate.getTime() >= cutoff);
  return { fresh, staleCount: items.length - fresh.length };
}

// Pacing ceiling: spreads a category's daily cap across the day instead of
// letting it fill up entirely in the first peak window and go quiet for
// hours. An algorithm parameter, not day-to-day tuning - hardcoded, not a
// settings-table value like the caps it paces. Applies to every category,
// Crypto included: the goal is the whole page feeling active around the
// clock, not just gating market-hours categories.
//
// Each checkpoint's percentage takes effect starting at its hour and holds
// until the next one - so "10:00 -> 35%" also governs 00:00-09:59 (there's
// no earlier checkpoint to relax it), 17:00 raises it to 50% and holds
// through 20:59, and 21:00's 90% holds through 23:59, deliberately leaving
// 10% unused for the overnight stretch. articlesCreatedToday() resets at
// UTC midnight, so the cycle restarts fresh each day.
const PACING_CHECKPOINTS = [
  { hour: 10, maxFraction: 0.35 },
  { hour: 17, maxFraction: 0.5 },
  { hour: 21, maxFraction: 0.9 },
];

export function currentPacingCeiling(cap, now = new Date()) {
  const hour = now.getUTCHours();
  const lastCheckpoint = PACING_CHECKPOINTS[PACING_CHECKPOINTS.length - 1];

  let fraction = PACING_CHECKPOINTS[0].maxFraction;
  for (const checkpoint of PACING_CHECKPOINTS) {
    if (hour >= checkpoint.hour) fraction = checkpoint.maxFraction;
  }

  // Round rather than floor: floor was too aggressive for small caps (a
  // weekday cap of 2 floored to 0 for the entire 35%/50% windows -
  // 17 hours silent before the first article was even allowed). Round
  // still holds back the 90% checkpoint's reserve correctly for normal
  // caps (6 -> round(5.4) = 5, same as floor - the two agree whenever the
  // fractional part is below .5), it just no longer collapses a cap of 2
  // to 0 before 21:00 (round(2*0.35) = round(0.7) = 1).
  const rawCeiling = Math.round(cap * fraction);

  // Rounding alone still leaves a cap of 1 at 0 until the 50% checkpoint
  // (round(1*0.35) = 0, round(1*0.5) = 1), so this safeguard - guarantee
  // at least 1 slot for any nonzero cap once the final checkpoint's hour
  // arrives - stays in place as a backstop, even though it's now mostly
  // redundant (rounding alone already gets a cap of 1 to its ceiling of 1
  // by 17:00, before the safeguard's 21:00 trigger would ever need to fire).
  if (hour >= lastCheckpoint.hour && cap > 0) {
    return Math.max(1, rawCeiling);
  }
  return rawCeiling;
}

// Price plausibility check (Crypto only): the AI has no live price feed -
// it only sees an RSS headline/snippet - so a specific dollar figure it
// states for BTC/ETH is either lifted correctly from the source text or
// quietly hallucinated as "plausible-sounding" language. Comparing against
// the real live price (the same getCryptoTicker() call the homepage ticker
// uses) catches the hallucinated case. Same flag-only pattern as
// category_mismatch: never auto-corrects the number, just routes to review.
const PRICE_MISMATCH_THRESHOLD = 0.15; // >15% off current market price

// Dollar figures like "$32,000" or "$1,850.50".
const DOLLAR_AMOUNT_RE = /\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)/g;
const CRYPTO_MENTION_PATTERNS = {
  BTC: /\b(bitcoin|btc)\b/i,
  ETH: /\b(ethereum|eth)\b/i,
};

// Sentence-level proximity heuristic: these articles are at most 3 short
// paragraphs (~130 words), so a coin name and the price attributed to it
// have always shared a sentence in practice - good enough without a real
// NLP dependency, the same trade-off grouping.js makes for story matching.
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

// tickerBySymbol: { BTC: 77123.45, ETH: 3456.78 } - from getCryptoTicker().
// Returns a human-readable note for the first mismatch found, or null.
export function findPriceMismatch(mentions, tickerBySymbol) {
  for (const { symbol, value } of mentions) {
    const live = tickerBySymbol[symbol];
    if (!live) continue;
    const diff = Math.abs(value - live) / live;
    if (diff > PRICE_MISMATCH_THRESHOLD) {
      // formatMarketValue instead of a hand-rolled toLocaleString call, so
      // this note is formatted the exact same way as every other price on
      // the site - see backend/src/services/marketData/formatMarketValue.js.
      return `Stated price ${formatMarketValue(value, "crypto")} differs significantly from current market price ${formatMarketValue(live, "crypto")} for ${symbol} (${Math.round(diff * 100)}% off) - verify before publishing.`;
    }
  }
  return null;
}

// Same hallucination risk as crypto (the model has no live price feed, so
// a specific figure is either lifted from the source text or invented),
// extended to Gold/Oil - caught live on "Gold Prices Fluctuate Like Meme
// Coins After Fed Decision" stating gold "around $1,850" while spot gold
// was actually near $4,370 that day. Both Gold and Oil now have a genuine
// live number to diff directly, the same as crypto: Oil's cached price
// (Alpha Vantage WTI, via getCommoditySnapshot()) has always been a real
// $/barrel figure, and Gold's cache row now holds Twelve Data's real spot
// gold quote (XAU/USD) instead of the GLD ETF's share price it used to -
// GLD traded at roughly a tenth of spot gold and drifted further over
// time (see instruments.js), which is exactly why diffing against it used
// to be unsafe and Gold fell back to a source-text-only check. The
// source-text fallback below still applies to both when a live price
// isn't available for some reason (a stale/failed cache row) - it costs
// nothing extra and catches a fabricated number that happens to slip
// inside the tolerance band.
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

// A handful of common ways a source snippet might render the same number
// ($1,850 / $1850 / $1850.00 / a bare 1850) rather than requiring an exact
// string match against the dollar-formatted figure the model produced.
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

// Same idea, extended to Indices - the S&P 500/Nasdaq figures a Stocks/
// Indices-category article states. This one has always had a trustworthy
// live number to diff against: getEquityTicker() returns real converted
// index points (see instruments.js's etfProxy conversion), not SPY/QQQ's
// own share price, so a direct comparison is meaningful the same way it
// now is for Gold too (see findCommodityPriceMismatch() above). The
// source-text fallback still applies too, for the same reason it does for
// crypto/commodities: it costs nothing extra and catches a fabricated
// number that happens to slip inside the tolerance band.
const INDEX_MENTION_PATTERNS = {
  SP500: /\b(s&p\s?500|s&p)\b/i,
  NASDAQ: /\bnasdaq(-|\s)?100\b|\bnasdaq\b/i,
};

// Indices are quoted in bare points, not dollars, so unlike
// DOLLAR_AMOUNT_RE this doesn't require a "$" - but to avoid matching an
// unrelated small number in the same sentence (a year, an RSI reading, a
// percentage), it requires comma-grouped thousands (real index levels are
// always 4+ digits and this site's own style always comma-formats a
// number that size - see STYLE_INSTRUCTIONS in ai/prompts.js) which a
// plain year or day-count is never written with.
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

// Generalizes the price-mismatch principle to a different class of
// "specific, checkable number": a stated price-movement percentage. No
// asset symbol required (unlike the price checks above) - a category-
// agnostic movement verb nearby is the signal instead, since a percentage
// alone is far too generic a pattern to safely extract without one (an
// ownership stake, an RSI reading, a probability, and a genuine price move
// all look identical as a bare "N%"). There's also no live "today's %
// change for this exact claim" to diff against in general the way a price
// has a live ticker - a stated percentage could describe a day's move, a
// week's, a company's revenue growth, anything - so like gold, this is
// checked against source text only.
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

// Deliberately NOT priceAppearsInText() - that one's rounded-to-integer
// fallback candidate (e.g. "4" for a stated 4.2%) is fine for a dollar
// price (a bare "$4" match is already a distinctive, rare string in
// running prose) but far too loose for a percentage, where a bare digit
// like "4" is nearly guaranteed to coincidentally appear somewhere in any
// non-trivial source text (a date, a source count, an unrelated figure) -
// that would make this check pass almost anything. Requiring the number
// to actually sit next to a "%" or "percent" in the source is a real
// verification instead.
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

// Pure status decision, extracted from the loop below so it's directly
// testable (the same reason filterFreshItems()/findPriceMismatch() above
// are exported rather than left inline).
//
// A mock-provider draft is placeholder content and must never reach
// "published," no matter what auto-publish/source-count logic says. Same
// for a category mismatch, a price mismatch, or a failed verification
// check (verificationClean === false) - all need a human to check before
// this goes anywhere near "published." Every one of these checks is
// independent of the normal publish logic on purpose, so a publish path
// added later can't accidentally bypass them.
//
// Delayed auto-publish: a single-source article that trips zero flags no
// longer sits in indefinite manual review - it gets a countdown instead
// ("scheduled" + auto_publish_at), flipped to "published" by
// publishDueScheduledArticles() below once the time passes, unless a human
// edits/holds/deletes it first (routes/admin/articles.js clears
// auto_publish_at the moment that happens). A flagged article, at any
// source count, still goes straight to plain "review" with no timer.
export function decideArticleStatus({
  isMockProvider,
  categoryMismatch,
  priceMismatch,
  verificationClean,
  isMultiSourceAutoPublish,
  autoPublishDelayHours,
  now = new Date(),
}) {
  const hasAnyFlag = categoryMismatch || priceMismatch || !verificationClean;
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
    filteredStale: 0,
    scheduled: 0,
  };

  // Delayed auto-publish window for clean single-source articles (see the
  // status-decision block in the loop below). A settings-table value
  // (fetched once per scan, same as auto_publish) so it's adjustable from
  // the admin panel without a deploy.
  const autoPublishDelayHours = Number(await getSetting("auto_publish_delay_hours", DEFAULT_AUTO_PUBLISH_DELAY_HOURS));

  // Fetched once up front and reused by both Stocks and Indices below, so
  // the same dual-tagged feeds aren't parsed twice per scan.
  const dualItems = await fetchDualStocksIndicesItems();
  const dualLinks = new Set(dualItems.map((i) => i.link));

  // Live BTC/ETH prices for the price-plausibility check below - fetched
  // once per scan (prices don't move enough within one scan to matter) and
  // reused for every Crypto article. A failed fetch disables the check for
  // this scan rather than failing the whole run - the same "one bad thing
  // shouldn't take down the scan" principle as the per-story try/catch
  // around generateArticle().
  let cryptoTickerBySymbol = {};
  if (categories.some((c) => c.slug === "crypto")) {
    try {
      const ticker = await getCryptoTicker();
      cryptoTickerBySymbol = Object.fromEntries(ticker.map((t) => [t.symbol, t.price]));
    } catch (err) {
      console.error(`AI engine: could not fetch live crypto prices for the price-plausibility check - ${err.message}. Skipping that check for this scan.`);
    }
  }

  // Same idea for Commodities. GOLD used to be deliberately left out here
  // (see findCommodityPriceMismatch()'s comment - being rewritten
  // alongside this) because its only cached price was the GLD ETF's share
  // price, not a valid number to diff a stated spot-gold figure against.
  // That's no longer true: Gold's cache row now holds Twelve Data's real
  // spot gold quote (XAU/USD, see refreshMarketData.js/alphaVantage.js),
  // so it gets a live-price check the same way OIL already does.
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

  // Real converted index points (not SPY/QQQ's own ETF price) for the
  // Indices price-plausibility check below - see getEquityTicker() and
  // instruments.js's etfProxy conversion.
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

    // Pacing ceiling on top of the (possibly weekend-reduced) cap above -
    // adds a limit, doesn't replace either existing mechanism.
    const pacingCeiling = currentPacingCeiling(cap);
    const effectiveCap = Math.min(cap, pacingCeiling);

    const usedToday = await articlesCreatedToday(category.id);
    let remaining = effectiveCap - usedToday;
    if (remaining <= 0) {
      if (pacingCeiling < cap) {
        console.log(
          `AI engine: ${category.slug} paced - checkpoint ceiling ${pacingCeiling}/${cap} reached for this hour (${usedToday} used today).`
        );
      }
      continue;
    }

    let items = await fetchSourceItemsForCategory(category.id);

    if (category.slug === "stocks") {
      // The dual sources' items are already included above (they're tagged
      // category_id = stocks). Drop anything that reads as an index story
      // so it isn't covered in both categories.
      items = items.filter((i) => !(dualLinks.has(i.link) && looksLikeIndexStory(i)));
    } else if (category.slug === "indices") {
      // Add the dual sources' index-flavored items on top of Indices' own
      // dedicated sources.
      items = items.concat(dualItems.filter(looksLikeIndexStory));
    }

    totals.itemsScanned += items.length;

    // Freshness gate: drop anything older than FRESHNESS_WINDOW_HOURS
    // before it ever reaches grouping, so a stale item (a feed
    // re-publishing an old post, a first-ever scan pulling a source's
    // whole history) can never become a "new" article. Logged per category
    // so it's visible whether this was actually filtering anything.
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

      let draft;
      try {
        draft = await generateArticle(group, previousCoverage, category.name);
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

      // Flagging only, per the spec: the source's assigned category stays
      // the default/primary signal and category_id is never auto-changed
      // here. This just catches the exception case (e.g. a Treasury/bond
      // story that only landed in Crypto because it came from a
      // Crypto-assigned source) and routes it to a human instead of
      // guessing a second time.
      //
      // Two independent signals, either one is enough to flag: (1) the
      // model's own detected_category disagreeing with the source's
      // assigned one, and (2) a deterministic keyword check finding zero
      // category-relevant terms anywhere in the story - added because (1)
      // alone missed real cases where the model's classification agreed
      // with a wrong source-based default instead of judging the content
      // independently (see contentLacksCategoryKeywords's comment).
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

      // Price plausibility (Crypto only): a stated BTC/ETH price that's
      // wildly off the live market price is a strong hallucination signal.
      // Flagging only, same as category_mismatch - never auto-corrects the
      // number, just routes to review.
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

      // Generalizes the same guardrail principle to a stated price-MOVEMENT
      // percentage ("rose 4.2%," "fell 12%") - checked the same way Gold's
      // price is (source-text only; there's no live "today's % change for
      // this exact claim" to diff against in general, since a percentage
      // could describe anything). Runs for every category, on top of
      // whatever asset-specific check just ran above, since a fabricated
      // percentage is the same hallucination risk in Stocks/Indices copy
      // as it is in Crypto/Commodities.
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

      const isMultiSourceAutoPublish = group.length >= minSources && autoPublish;
      const { status, autoPublishAt } = decideArticleStatus({
        isMockProvider: draft.provider === "mock",
        categoryMismatch,
        priceMismatch,
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

      const articleId = await insertArticle({
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
        autoPublishAt,
      });

      for (const item of group) {
        await query(
          "INSERT INTO article_sources (article_id, source_name, source_url) VALUES ($1, $2, $3)",
          [articleId, item.sourceName, item.link]
        );
      }

      // The delayed-auto-publish window (see decideArticleStatus() above)
      // is only a real chance to intervene if someone actually knows it's
      // open - this is that notice. sendScheduledArticleAlert() already
      // contains its own failures (bad/missing SMTP config, unreachable
      // host, whatever) and never throws - see services/notifications/
      // mailer.js - so this deliberately isn't wrapped in its own
      // try/catch here; nothing about a scheduled article's DB state
      // depends on whether this email actually goes out.
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

// Delayed auto-publish's other half: called on the same 15-minute cron
// tick as runScanAndGenerate() (jobs/scheduler.js). Flips any "scheduled"
// article whose auto_publish_at has passed to "published" - the WHERE
// clause's "status = 'scheduled'" is the whole "hasn't been held/edited/
// deleted since" guard, because routes/admin/articles.js clears
// auto_publish_at and reverts status the moment a human touches a
// scheduled article, and a deleted article simply no longer matches any
// WHERE clause at all. One UPDATE ... RETURNING, no per-row loop needed.
export async function publishDueScheduledArticles() {
  const { rows } = await query(
    `UPDATE articles
     SET status = 'published', published_at = now()
     WHERE status = 'scheduled' AND auto_publish_at <= now()
     RETURNING id, title`
  );
  return rows;
}
