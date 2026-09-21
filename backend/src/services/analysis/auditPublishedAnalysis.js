// Recurring self-audit for the Analysis category: re-runs the SAME
// deterministic checks the live pipeline uses (see verifyAnalysisDraft in
// runAnalysis.js) against text that's already published, not just new
// drafts. Exists because every one of those checks was added reactively,
// after a real bad article was already found by inspection - this closes
// that gap by inspecting the backlog proactively instead of waiting for
// the next screenshot.
//
// Important, honest limitation, stated up front rather than buried: this
// project has never persisted the exact price/support/resistance/RSI
// snapshot that was true at the moment a given article was generated -
// analysis_snapshots (runAnalysis.js) is a single current-state row PER
// SYMBOL, overwritten (ON CONFLICT DO UPDATE) on every new article, not a
// history log. There is no independent ground truth left to check an OLD
// article's numbers against after the fact - "was $77,943.60 really BTC's
// price on 2026-09-17" cannot be re-derived once that day has passed and
// the current snapshot has moved on.
//
// What this CAN do, and does: reconstruct the price/support/resistance
// the article ITSELF states (best-effort regex over its own stored body -
// see reconstructSnapshotFromArticleText below, verified against every
// real published Analysis article's actual phrasing before being written)
// and check the article's INTERNAL consistency - exactly the class of bug
// every one of these checks was originally built to catch (the title
// stating a different price than the body agrees on internally, a stated
// distance/direction that doesn't match the article's own stated support/
// resistance, a dropped ETF qualifier, excessive reuse of the immediately
// prior article for the same instrument). It cannot catch a number that
// is wrong but internally self-consistent throughout the whole piece -
// that class of error needs the historical snapshot this schema doesn't
// keep, not a smarter regex.
import { pathToFileURL } from "node:url";
import { query } from "../../db.js";
import {
  WATCHLIST,
  findAnalysisFactMismatch,
  findMissingQualifier,
  findAnalysisDistanceMismatch,
  findAnalysisSimilarityMismatch,
} from "./runAnalysis.js";
import { generateAnalysisFreshnessCheck } from "../ai/provider.js";

const ASSET_CLASS_BY_SYMBOL = {
  BTC: "crypto",
  ETH: "crypto",
  Gold: "commodity",
  "S&P 500": "index",
  "Oil (WTI)": "commodity",
};

// Every pattern below was checked against the real phrasing of all 33
// published Analysis articles in this project's backlog before being
// written (not guessed) - PRICE_RE matched 33/33 once "current price
// stands at" was added (the one real variant it initially missed);
// SUPPORT_RE/RESISTANCE_RE matched 32/33, the one miss being a genuine
// case where the article itself says "support and resistance levels
// remain undefined" (article 163) - correctly nothing to extract there,
// not a regex gap.
const PRICE_RE = /(?:is currently priced at|is priced at|is currently trading at|is trading at|current price is|current price stands at)\s*\$?([0-9][0-9,]*(?:\.[0-9]+)?)/i;
const SUPPORT_RE = /support[^.]*?\$?\s?([0-9][0-9,]*(?:\.[0-9]+)?)/i;
const RESISTANCE_RE = /resistance[^.]*?\$?\s?([0-9][0-9,]*(?:\.[0-9]+)?)/i;

function extractNumber(re, text) {
  const match = (text || "").match(re);
  if (!match) return null;
  const n = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Exported for direct testing (see auditPublishedAnalysis.test.js) against
// real article text, the same reason every other check in this project is
// a pure, exported function of its inputs. Returns null (not a
// half-filled snapshot) when even the price can't be extracted - callers
// treat that as "can't audit this one," not "clean."
export function reconstructSnapshotFromArticleText(symbol, body) {
  const price = extractNumber(PRICE_RE, body);
  if (price === null) return null;
  return {
    symbol,
    price,
    support: extractNumber(SUPPORT_RE, body),
    resistance: extractNumber(RESISTANCE_RE, body),
    assetClass: ASSET_CLASS_BY_SYMBOL[symbol] || "crypto",
  };
}

// perSymbolLimit: how many of each instrument's most recent published
// articles to walk. Chronological (oldest first) within each symbol so
// the similarity check compares each article against the one that
// actually preceded it, the same adjacency the live pipeline sees.
//
// includeSemanticFreshnessCheck: false by default, same as
// verifyAnalysisDraft's own default in runAnalysis.js, and for the same
// reason - real testing against this exact backlog (twice, after a prompt
// fix in between) found it flags a large share of genuinely clean
// articles (22 of 28 on the second round) for correctly re-mentioning
// still-current real context - a still-upcoming Fed decision, still-
// in-window related coverage - that this check has no way to distinguish
// from actually-stale recycled narrative, since it only ever sees the two
// draft bodies, never what was actually fed into either generation. See
// the full writeup in runAnalysis.js's verifyAnalysisDraft. It also costs
// real money per comparison, which compounds across an entire backlog for
// a check this noisy. Pass true only to spot-check with a human reading
// the results critically, not to trust the count at face value; the
// returned result notes how much it cost when it runs.
export async function auditPublishedAnalysisArticles({ perSymbolLimit = 50, includeSemanticFreshnessCheck = false } = {}) {
  const findings = [];
  const extractionFailures = [];
  let totalChecked = 0;
  let semanticCheckCostUsd = 0;

  for (const asset of WATCHLIST) {
    const symbol = asset.symbol;
    const { rows } = await query(
      `SELECT id, title, body, published_at FROM articles
       WHERE analysis_symbol = $1 AND status = 'published'
       ORDER BY published_at ASC
       LIMIT $2`,
      [symbol, perSymbolLimit]
    );

    let prior = null;
    for (const article of rows) {
      totalChecked += 1;
      const snapshot = reconstructSnapshotFromArticleText(symbol, article.body);

      if (!snapshot) {
        extractionFailures.push({ id: article.id, title: article.title, symbol });
        prior = article;
        continue;
      }

      const checks = [
        ["findAnalysisFactMismatch", findAnalysisFactMismatch(article.title, article.body, snapshot)],
        ["findMissingQualifier", findMissingQualifier(article.title, article.body, snapshot)],
        ["findAnalysisDistanceMismatch", findAnalysisDistanceMismatch(article.body, snapshot)],
        ["findAnalysisSimilarityMismatch", findAnalysisSimilarityMismatch(article.body, prior)],
      ];

      if (includeSemanticFreshnessCheck && prior) {
        const result = await generateAnalysisFreshnessCheck({ body: article.body, priorArticleBody: prior.body });
        semanticCheckCostUsd += result.costEstimateUsd || 0;
        checks.push(["generateAnalysisFreshnessCheck", result.restates_stale_fact ? result.reason : null]);
      }

      for (const [check, note] of checks) {
        if (note) {
          findings.push({
            id: article.id,
            title: article.title,
            symbol,
            publishedAt: article.published_at,
            check,
            note,
          });
        }
      }

      prior = article;
    }
  }

  return {
    totalChecked,
    totalFindings: findings.length,
    findings,
    extractionFailures,
    semanticCheckCostUsd: includeSemanticFreshnessCheck ? semanticCheckCostUsd : null,
  };
}

// Runnable on demand (node src/services/analysis/auditPublishedAnalysis.js)
// or wired into scheduler.js as a recurring job later - kept as a plain
// top-level await guarded by import.meta.url so requiring/importing this
// module elsewhere (the test file, a future scheduler hook) never
// triggers a real DB query as a side effect of just importing it.
// pathToFileURL (not a plain `file://${process.argv[1]}` string) because
// on Windows the two sides otherwise never match: import.meta.url uses
// forward slashes and percent-encodes spaces ("sonnet%20app"), while
// process.argv[1] is the raw path with backslashes and literal spaces -
// confirmed live, the naive string comparison silently never fired here.
// process.argv[1] is also just plain undefined under `node -e`/`node
// --input-type=module` (no script file at all) - also confirmed live,
// pathToFileURL(undefined) throws rather than just comparing false, so
// that has to be checked first.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await auditPublishedAnalysisArticles();
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nChecked ${result.totalChecked} published Analysis articles, ${result.extractionFailures.length} couldn't be parsed, ${result.totalFindings} check failure(s) found.`);
  process.exit(0);
}
