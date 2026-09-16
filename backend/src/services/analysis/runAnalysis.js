// The Analysis job (spec section 4) - completely separate from the news
// scanner. Runs on a fixed watchlist, pulls real computed technicals
// (trend, RSI, support/resistance from getMarketSnapshot()), and only
// writes a new article for an asset when its numbers moved meaningfully
// since the last one. This is what guarantees Analysis articles are
// grounded in real, current numbers instead of assembled from whatever
// news happened to mention "RSI" or "support."
import { query } from "../../db.js";
import { getMarketSnapshot, getCachedTechnicalSnapshot } from "../marketData/prices.js";
import { generateAnalysis } from "../ai/provider.js";
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
// "Gold (GLD)"/"S&P 500 (SPY)" name the ETF proxy explicitly rather than
// the underlying metal/index - GLD's share price in particular is roughly
// a tenth of literal spot gold, so labelling it plain "Gold" would read as
// a wrong (fabricated-looking) number even though it's real. QQQ isn't on
// this watchlist - Twelve Data only supplies a real-time quote for it (no
// history), so there's no source for QQQ's SMA/RSI/support-resistance yet.
const WATCHLIST = [
  { symbol: "BTC", kind: "crypto", coinGeckoId: "bitcoin" },
  { symbol: "ETH", kind: "crypto", coinGeckoId: "ethereum" },
  { symbol: "Gold (GLD)", kind: "cached", cacheKey: "gold" },
  { symbol: "S&P 500 (SPY)", kind: "cached", cacheKey: "spy" },
  { symbol: "Oil (WTI)", kind: "cached", cacheKey: "wti" },
];

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

    let draft;
    try {
      draft = await generateAnalysis(snapshot);
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

    // A mock-provider draft is placeholder content and must never reach
    // "published" - see the matching guard in services/rss/scanAndGenerate.js.
    const status = draft.provider === "mock" ? "review" : autoPublish ? "published" : "review";
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
      sourceCount: 1,
      aiProvider: draft.provider,
      publishedAt: status === "published" ? new Date() : null,
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
