// Runs the AI engine and market-data fetches on a timer using node-cron, so
// the site keeps itself updated without anyone needing to trigger it by
// hand. Independent jobs: the news scanner (frequent), the Analysis job
// (infrequent - its own "only if it moved" gate means running it often
// would mostly no-op), the evergreen SEO refresh, and the market-data cache
// refresh (its own three cadences - see the bottom of this function).
import cron from "node-cron";
import { runScanAndGenerate, publishDueScheduledArticles } from "../services/rss/scanAndGenerate.js";
import { runAnalysisScan, checkForRecentHighImpactEvent } from "../services/analysis/runAnalysis.js";
import { runEvergreenSeoRefresh } from "../services/seo/evergreenRefresh.js";
import { runContentQualityAudit } from "../services/audit/contentQualityAudit.js";
import { loadPersistedOverviewCache } from "../services/marketData/overviewCache.js";
import { refreshEquityQuotes, refreshCommodityQuotes, refreshCommodityHistory } from "../services/marketData/refreshMarketData.js";
import { pruneArticleViews } from "../services/maintenance/pruneArticleViews.js";
import { pruneStaleReviewArticles } from "../services/maintenance/pruneStaleReviewArticles.js";

// News-is-the-only-active-category priority shift: pauses Analysis
// generation (both the scheduled cron below and the calendar-triggered
// extra run inside the frequent news tick) so no API spend goes toward
// content nobody will see while Analysis is hidden from nav/homepage (see
// frontend/lib/categories.js, services/shared/articleUtils.js's
// HIDDEN_CATEGORY_SLUGS). Deliberately a single flag, not a deleted or
// commented-out block, so re-enabling Analysis later is one line here -
// nothing about runAnalysisScan()/checkForRecentHighImpactEvent()
// themselves changed, they're just not being called right now.
const ANALYSIS_GENERATION_ENABLED = false;

export function startScheduler() {
  // Markets Overview strip (Alpha Vantage-backed columns): no timer here
  // on purpose - see overviewCache.js's bug-history comment. This just
  // warms the in-memory cache from the last persisted result (a cheap DB
  // read, zero Alpha Vantage calls) so a restart doesn't show empty
  // columns until the next request-triggered refresh. Staleness is
  // checked, and a background refresh kicked off if needed, on every
  // GET /api/market/overview request instead (routes/market.js).
  loadPersistedOverviewCache().catch((err) => console.error("Markets overview: could not load persisted cache at boot.", err));

  const minutes = Number(process.env.SCAN_INTERVAL_MINUTES || 15);
  const cronExpression = `*/${minutes} * * * *`;

  console.log(`News engine scheduled to scan sources every ${minutes} minute(s).`);
  cron.schedule(cronExpression, async () => {
    console.log("News engine: starting scheduled scan...");
    try {
      const result = await runScanAndGenerate();
      console.log("News engine: scan complete.", result);
    } catch (err) {
      console.error("News engine: scan failed.", err);
    }

    // Delayed auto-publish's other half - flips any "scheduled" article
    // whose timer has passed to "published". Checked on this same frequent
    // tick (not a separate cron schedule) so a clean single-source
    // article's delay is accurate to within this interval, not the next
    // time some other job happens to run. Independent try/catch, same
    // principle as the Analysis check below: this failing should never
    // take the scan itself down or vice versa.
    try {
      const publishedNow = await publishDueScheduledArticles();
      if (publishedNow.length > 0) {
        console.log(`News engine: auto-published ${publishedNow.length} scheduled article(s) - ${publishedNow.map((a) => `"${a.title}"`).join(", ")}.`);
      }
    } catch (err) {
      console.error("News engine: delayed auto-publish check failed.", err);
    }

    // Calendar-triggered Analysis: checked on this same frequent tick
    // rather than a new cron schedule, so a high-impact event (a Fed
    // decision, CPI, etc.) that just passed gets picked up well before
    // the Analysis job's own next scheduled run below. Gated off while
    // Analysis is hidden - see ANALYSIS_GENERATION_ENABLED above.
    if (ANALYSIS_GENERATION_ENABLED) {
      try {
        const event = await checkForRecentHighImpactEvent();
        if (event) {
          console.log(`Analysis engine: high-impact event "${event.title}" just passed - running an extra check.`);
          const result = await runAnalysisScan();
          console.log("Analysis engine: event-triggered run complete.", result);
        }
      } catch (err) {
        console.error("Analysis engine: event-triggered check failed.", err);
      }
    }
  });

  const analysisHours = Number(process.env.ANALYSIS_INTERVAL_HOURS || 12);
  const analysisCron = `0 */${analysisHours} * * *`;

  if (ANALYSIS_GENERATION_ENABLED) {
    console.log(`Analysis engine scheduled to run every ${analysisHours} hour(s).`);
    cron.schedule(analysisCron, async () => {
      console.log("Analysis engine: starting scheduled run...");
      try {
        const result = await runAnalysisScan();
        console.log("Analysis engine: run complete.", result);
      } catch (err) {
        console.error("Analysis engine: run failed.", err);
      }
    });
  } else {
    console.log("Analysis engine: paused (ANALYSIS_GENERATION_ENABLED = false) - hidden from nav/homepage, no scheduled runs.");
  }

  // The "every 30 days" cadence is enforced per-item inside the job itself
  // (score below threshold OR seo_last_reviewed_at 30+ days old), not by
  // this cron schedule - a daily check is what makes that robust: it
  // catches up correctly even if the server was down for a few days,
  // rather than drifting against a fixed "every 30 days from server start."
  const seoRefreshHours = Number(process.env.SEO_REFRESH_INTERVAL_HOURS || 24);
  const seoRefreshCron = `0 */${seoRefreshHours} * * *`;

  console.log(`Evergreen SEO refresh scheduled to check every ${seoRefreshHours} hour(s).`);
  cron.schedule(seoRefreshCron, async () => {
    console.log("Evergreen SEO refresh: starting scheduled run...");
    try {
      const result = await runEvergreenSeoRefresh();
      console.log("Evergreen SEO refresh: run complete.", result);
    } catch (err) {
      console.error("Evergreen SEO refresh: run failed.", err);
    }
  });

  // market_data_cache (header ticker's SPY/QQQ/Gold/WTI, and the Analysis
  // job's gold/WTI/SPY technicals) - own cadence, separate from every job
  // above, each far under its provider's daily budget (see
  // refreshMarketData.js's header comment for the exact math). Run once at
  // boot too (not just on the cron ticks) so the cache isn't empty for up
  // to a full cycle after a fresh deploy or restart.
  console.log("Market data: equity quotes (SPY, QQQ) scheduled hourly; commodity quotes (Gold, WTI) every 8h; history (Gold, WTI, SPY) daily.");
  refreshEquityQuotes().catch((err) => console.error("Market data: initial equity quote refresh failed.", err));
  refreshCommodityQuotes().catch((err) => console.error("Market data: initial commodity quote refresh failed.", err));
  refreshCommodityHistory().catch((err) => console.error("Market data: initial history refresh failed.", err));

  cron.schedule("0 * * * *", async () => {
    try {
      await refreshEquityQuotes();
    } catch (err) {
      console.error("Market data: equity quote refresh failed.", err);
    }
  });

  cron.schedule("0 */8 * * *", async () => {
    try {
      await refreshCommodityQuotes();
    } catch (err) {
      console.error("Market data: commodity quote refresh failed.", err);
    }
  });

  cron.schedule("0 6 * * *", async () => {
    try {
      await refreshCommodityHistory();
    } catch (err) {
      console.error("Market data: history refresh failed.", err);
    }
  });

  // Content quality audit (services/audit/contentQualityAudit.js) - not a
  // pre-publish gate, a retrospective one: re-runs every existing check
  // against the last 7 days of published output and logs pass/fail counts
  // into content_audit_runs so a rising failure rate is visible as a
  // trend, not just discoverable by someone manually re-reading a batch
  // the way every finding so far in this project was first found. Weekly
  // (not daily) - a 7-day rolling window compared day over day would
  // mostly just re-count the same articles, adding noise without adding
  // signal; a week gives each run a genuinely new batch to look at.
  console.log("Content quality audit scheduled to run weekly.");
  cron.schedule("0 5 * * 1", async () => {
    console.log("Content quality audit: starting scheduled run...");
    try {
      const result = await runContentQualityAudit();
      console.log(`Content quality audit: checked ${result.batchSize} articles from the last ${result.windowDays} days across ${result.results.length} check(s).`);
    } catch (err) {
      console.error("Content quality audit: run failed.", err);
    }
  });

  // article_views cleanup (pre-launch data-retention audit) - daily is
  // plenty for a table pruned back to a 48h window; a different hour than
  // the other daily jobs above (6am) purely to avoid every daily cron
  // firing in the same second for no reason.
  cron.schedule("0 4 * * *", async () => {
    try {
      const { deleted } = await pruneArticleViews();
      console.log(`Article views cleanup: deleted ${deleted} row(s) older than 48h.`);
    } catch (err) {
      console.error("Article views cleanup: failed.", err);
    }
  });

  // News review-queue auto-expiry (services/maintenance/pruneStaleReviewArticles.js) -
  // daily, same cadence as article_views cleanup above, so a stuck review
  // backlog can never again silently accumulate for the better part of a
  // week the way the real 119-article News backlog did before anything
  // checked for this. A different hour (3am) than every other daily job
  // purely to avoid clustering.
  cron.schedule("0 3 * * *", async () => {
    try {
      const result = await pruneStaleReviewArticles();
      console.log(`Review-queue expiry: reviewed ${result.reviewed} News article(s) in review, expired ${result.expired}.`, result.byCategory);
    } catch (err) {
      console.error("Review-queue expiry: failed.", err);
    }
  });
}
