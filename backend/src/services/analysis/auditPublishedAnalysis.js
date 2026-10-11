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

const PRICE_RE = /(?:is currently priced at|is priced at|is currently trading at|is trading at|current price is|current price stands at)\s*\$?([0-9][0-9,]*(?:\.[0-9]+)?)/i;
const SUPPORT_RE = /support[^.]*?\$?\s?([0-9][0-9,]*(?:\.[0-9]+)?)/i;
const RESISTANCE_RE = /resistance[^.]*?\$?\s?([0-9][0-9,]*(?:\.[0-9]+)?)/i;

function extractNumber(re, text) {
  const match = (text || "").match(re);
  if (!match) return null;
  const n = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await auditPublishedAnalysisArticles();
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nChecked ${result.totalChecked} published Analysis articles, ${result.extractionFailures.length} couldn't be parsed, ${result.totalFindings} check failure(s) found.`);
  process.exit(0);
}
