import cron from "node-cron";
import { runScanAndGenerate, publishDueScheduledArticles } from "../services/rss/scanAndGenerate.js";
import { runAnalysisScan, checkForRecentHighImpactEvent } from "../services/analysis/runAnalysis.js";
import { runEvergreenSeoRefresh } from "../services/seo/evergreenRefresh.js";
import { runContentQualityAudit } from "../services/audit/contentQualityAudit.js";
import { loadPersistedOverviewCache } from "../services/marketData/overviewCache.js";
import { refreshEquityQuotes, refreshCommodityQuotes, refreshCommodityHistory } from "../services/marketData/refreshMarketData.js";
import { pruneArticleViews } from "../services/maintenance/pruneArticleViews.js";
import { pruneStaleReviewArticles } from "../services/maintenance/pruneStaleReviewArticles.js";

const ANALYSIS_GENERATION_ENABLED = false;

export function startScheduler() {
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

    try {
      const publishedNow = await publishDueScheduledArticles();
      if (publishedNow.length > 0) {
        console.log(`News engine: auto-published ${publishedNow.length} scheduled article(s) - ${publishedNow.map((a) => `"${a.title}"`).join(", ")}.`);
      }
    } catch (err) {
      console.error("News engine: delayed auto-publish check failed.", err);
    }

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

  cron.schedule("0 4 * * *", async () => {
    try {
      const { deleted } = await pruneArticleViews();
      console.log(`Article views cleanup: deleted ${deleted} row(s) older than 48h.`);
    } catch (err) {
      console.error("Article views cleanup: failed.", err);
    }
  });

  cron.schedule("0 3 * * *", async () => {
    try {
      const result = await pruneStaleReviewArticles();
      console.log(`Review-queue expiry: reviewed ${result.reviewed} News article(s) in review, expired ${result.expired}.`, result.byCategory);
    } catch (err) {
      console.error("Review-queue expiry: failed.", err);
    }
  });
}
