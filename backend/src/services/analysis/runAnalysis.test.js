// Permanent regression tests for the Analysis fact-check guardrails
// (findAnalysisDistanceMismatch/findAnalysisFactMismatch/findMissingQualifier).
// This codebase has no test framework wired up yet, so this uses Node's
// built-in test runner (node:test, stable since Node 18) rather than
// adding a new dependency for one file - run with `node --test` from
// backend/ (or `npm test`, see package.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findAnalysisDistanceMismatch, findAnalysisSimilarityMismatch, movedMeaningfully, hasFormulaicOpening, hasFormulaicClosing, extractClosingSummaryParagraph, selectRelatedCoverage } from "./runAnalysis.js";

test("findAnalysisDistanceMismatch catches 'the resistance level' phrasing (real bug)", () => {
  // Found live in a real published Ethereum piece: DISTANCE_CLAIM_RE used
  // to require "its" (or nothing) directly before support/resistance, so
  // "the resistance level" - a "the" instead of "its", plus a trailing
  // "level" - never matched at all. The check never ran on this sentence;
  // it wasn't a tolerance miss, it was a phrasing gap.
  const snapshot = { symbol: "ETH", price: 2500.41, support: 2470, resistance: 2525.27, assetClass: "crypto" };
  const body = "ETH is currently about 4% away from the resistance level, suggesting a tight trading range.";
  const note = findAnalysisDistanceMismatch(body, snapshot);
  assert.notEqual(note, null, "expected a mismatch to be flagged, got null (the phrasing gap regressed)");
  assert.match(note, /4%/);
  assert.match(note, /1\.0%/); // real distance: (2525.27 - 2500.41) / 2500.41 ~= 0.99%, rounds to 1.0
});

test("findAnalysisDistanceMismatch still catches the original 'its resistance' bug", () => {
  // The bug this check was originally built for - reused one distance
  // figure for both support and resistance instead of computing each.
  const snapshot = { symbol: "BTC", price: 78116.82, support: 75590.24, resistance: 80329.35, assetClass: "crypto" };
  const body = "Bitcoin is approximately 3.2% away from its resistance and 3.2% above its support, indicating a tight trading range.";
  const note = findAnalysisDistanceMismatch(body, snapshot);
  assert.notEqual(note, null, "expected the reused-figure mismatch to still be flagged");
  assert.match(note, /3\.2%/);
  assert.match(note, /2\.8%/); // real resistance distance
});

test("findAnalysisDistanceMismatch passes a corrected, accurate version clean", () => {
  const snapshot = { symbol: "BTC", price: 78116.82, support: 75590.24, resistance: 80329.35, assetClass: "crypto" };
  const body = "Bitcoin is approximately 2.8% away from its resistance and 3.2% above its support, indicating a tight trading range.";
  assert.equal(findAnalysisDistanceMismatch(body, snapshot), null);
});

test("findAnalysisDistanceMismatch still matches bare phrasing with no article at all", () => {
  // The original regex's "its" was already optional - confirms the
  // broadened pattern (adding "the" + optional "level") didn't
  // accidentally make an article/possessive mandatory.
  const snapshot = { symbol: "BTC", price: 78116.82, support: 75590.24, resistance: 80329.35, assetClass: "crypto" };
  const body = "Bitcoin trades 2.8% below resistance and 3.2% above support currently.";
  assert.equal(findAnalysisDistanceMismatch(body, snapshot), null);
});

test("findAnalysisDistanceMismatch catches a wrong figure phrased as 'the support level'", () => {
  const snapshot = { symbol: "BTC", price: 78116.82, support: 75590.24, resistance: 80329.35, assetClass: "crypto" };
  const body = "Bitcoin is trading 10% above the support level right now.";
  const note = findAnalysisDistanceMismatch(body, snapshot);
  assert.notEqual(note, null, "expected the wrong support-distance figure to be flagged");
  assert.match(note, /10%/);
});

test("findAnalysisDistanceMismatch returns null when the body has no distance claim", () => {
  const snapshot = { symbol: "BTC", price: 78116.82, support: 75590.24, resistance: 80329.35, assetClass: "crypto" };
  assert.equal(findAnalysisDistanceMismatch("Bitcoin is trading sideways today.", snapshot), null);
});

// Real bug, found in a real published Bitcoin piece (article 285): price
// had broken above resistance (a genuine breakout, made more common by the
// support/resistance window fix in prices.js - price now legitimately
// sits outside the band more often), and the article correctly computed
// the $833.79 gap but described it as "below" resistance instead of
// "above" - backwards. DISTANCE_CLAIM_RE (percent-only) never even looks
// at this sentence; these two tests cover the dollar-amount path.
test("findAnalysisDistanceMismatch passes a correct 'above resistance' dollar claim on a real breakout", () => {
  const snapshot = { symbol: "BTC", price: 81163.14, support: 75590.24, resistance: 80329.35, assetClass: "crypto" };
  const body = "Bitcoin is just $833.79 above its immediate resistance level, having broken out to a new high.";
  assert.equal(findAnalysisDistanceMismatch(body, snapshot), null);
});

test("findAnalysisDistanceMismatch catches the exact real backwards-direction claim ('below' when price is actually above)", () => {
  const snapshot = { symbol: "BTC", price: 81163.14, support: 75590.24, resistance: 80329.35, assetClass: "crypto" };
  const body = "Bitcoin is just $833.79 below its immediate resistance level, which if broken could signal further upward momentum.";
  const note = findAnalysisDistanceMismatch(body, snapshot);
  assert.notEqual(note, null, "expected the backwards 'below' claim to be flagged - price is actually above resistance");
  assert.match(note, /actually above resistance/);
  assert.match(note, /backwards/);
});

// Real regression: articles 171 and 186, both genuine published Bitcoin
// pieces from this project's real backlog, an old short-format template
// with only price/RSI/support/resistance swapped - confirmed a real
// near-clone (0.66 whole-body Jaccard word-overlap, well above every
// normal pair's ~0.14-0.45 range measured across the rest of the real BTC
// backlog before picking the 0.55 threshold - see findAnalysisSimilarityMismatch's
// comment in runAnalysis.js for the full calibration).
test("findAnalysisSimilarityMismatch flags a real near-clone article (articles 171 vs 186)", () => {
  const prior = {
    id: 171,
    title: "Bitcoin Price at $75,706.52 Amid Bullish Trend",
    body: "Bitcoin is currently priced at $75,706.52, remaining above its 50-day moving average, indicating a bullish trend. The relative strength index (RSI) is at 45, suggesting neutral momentum. Support is noted at $75,590.24, while resistance stands at $81,264.70, highlighting potential price barriers ahead.\n\nThis is not financial advice; readers should draw their own conclusions.",
  };
  const newDraft = "Bitcoin is currently priced at $77,474.02, trading above its 50-day moving average, indicating a bullish trend. The 14-day RSI is at 40, suggesting neutral momentum with no immediate overbought or oversold conditions. Key support is at $75,590.24, while resistance is noted at $80,329.35, highlighting potential price barriers for traders.\n\nThis is not financial advice; readers should draw their own conclusions.";

  const note = findAnalysisSimilarityMismatch(newDraft, prior);
  assert.notEqual(note, null, "expected the near-clone draft to be flagged");
  assert.match(note, /article 171/);
  assert.match(note, /reworded/);
});

test("findAnalysisSimilarityMismatch passes clean when there's genuinely new price action and no leftover phrasing", () => {
  const prior = {
    id: 999,
    title: "Bitcoin Price Holds at $77,943.60 Amid ETF Inflows",
    body: "Bitcoin is currently priced at $77,943.60, maintaining a bullish trend as it trades above its 50-day moving average. This upward momentum reflects growing institutional interest, particularly in Bitcoin spot ETFs, which have seen inflows reaching a five-day high.\n\nThe 14-day RSI is at 43, indicating a neutral momentum for Bitcoin. Historically, readings in this range suggest that the price could either consolidate or prepare for a potential breakout, depending on market sentiment and external factors.\n\nKey support for Bitcoin is at $75,590.24, while resistance is set at $80,329.35. A break below support could signal bearish sentiment, while surpassing resistance might lead to further upward movement. Currently, Bitcoin is approximately 3% above its support level and about 3% below its resistance level.",
  };
  const newDraft = "Bitcoin tumbled to $58,220.10 after a sharp risk-off move overnight, dropping below its 50-day moving average for the first time in three weeks. The sell-off accelerated after a stronger-than-expected inflation print reignited fears of a longer Fed tightening cycle.\n\nThe 14-day RSI has fallen to 24, putting Bitcoin firmly in oversold territory - a sharp reversal from the neutral readings of recent weeks, and a signal that selling pressure may be overextended.\n\nSupport now sits at $56,900, a level Bitcoin has not tested since early summer, while the old $75,590 support has flipped into distant resistance. A close back above $62,000 would be the first sign of stabilization.";

  const note = findAnalysisSimilarityMismatch(newDraft, prior);
  assert.equal(note, null, "a genuinely different market situation with no reused phrasing should not be flagged");
});

test("findAnalysisSimilarityMismatch passes clean when there is no prior article at all (first-ever piece for this instrument)", () => {
  assert.equal(findAnalysisSimilarityMismatch("Anything at all.", null), null);
  assert.equal(findAnalysisSimilarityMismatch("Anything at all.", undefined), null);
});

// Regression tests for the trend-flip condition added to movedMeaningfully()
// during the duplicate-coverage audit: trend is defined purely by price vs.
// the 50-day moving average, and the MA moves slowly enough that price can
// cross it without moving 2%, without breaking support/resistance, and
// without crossing an RSI zone boundary - so a genuine flip needed its own
// explicit check rather than assuming one of the other three would always
// catch it.
test("movedMeaningfully always generates the first-ever article when there's no prior snapshot", () => {
  assert.equal(movedMeaningfully(null, { price: 100, support: 90, resistance: 110, rsi_14: 50, trend: "Bullish" }), true);
});

test("movedMeaningfully returns true on a trend flip even when price/RSI/support/resistance stay within every other threshold", () => {
  const prev = { price: 100, support: 90, resistance: 110, rsi_14: 50, trend: "Bullish" };
  const curr = { price: 100.5, support: 90, resistance: 110, rsi_14: 50, trend: "Bearish" };
  // Sanity-check the premise: this pair genuinely doesn't trip the other
  // three conditions on its own (0.5% price move, same RSI zone, price
  // still inside the support/resistance band) - if it did, this test
  // wouldn't actually prove the trend-flip branch caused the true.
  const priceChangePct = Math.abs((curr.price - prev.price) / prev.price) * 100;
  assert.ok(priceChangePct < 2);
  assert.ok(curr.price < curr.resistance && curr.price > curr.support);
  assert.equal(movedMeaningfully(prev, curr), true);
});

test("movedMeaningfully returns false when nothing changed, including trend", () => {
  const snap = { price: 100, support: 90, resistance: 110, rsi_14: 50, trend: "Bullish" };
  assert.equal(movedMeaningfully(snap, { ...snap }), false);
});

test("movedMeaningfully does not trigger on trend alone when the prior snapshot predates the trend column (null, not a real flip)", () => {
  const prev = { price: 100, support: 90, resistance: 110, rsi_14: 50, trend: null };
  const curr = { price: 100.5, support: 90, resistance: 110, rsi_14: 50, trend: "Bullish" };
  assert.equal(movedMeaningfully(prev, curr), false, "a null-to-real-value transition is a schema catch-up, not a genuine flip, and shouldn't force a regeneration on its own");
});

// Regression tests for the structural opening/closing clause detectors -
// added after corpus-level phrase mining across the 82 published articles
// that existed on 2026-09-19 found the opening template in 50-51/82
// articles and the closing wrap-up template in 38-41/82. Every body
// snippet below is real, taken verbatim from that mining run (articles
// 351, 344, 353, 343), not synthesized.
test("hasFormulaicOpening detects the real 'is currently priced at... maintaining a bullish trend' template (article 351)", () => {
  const body = "Bitcoin is currently priced at $80,965.08, maintaining a bullish trend as it trades above its 50-day moving average. This price reflects a strong market sentiment.";
  assert.equal(hasFormulaicOpening(body), true);
});

test("hasFormulaicOpening detects the same template with a different verb (article 344, 'sits above' instead of 'trades above')", () => {
  const body = "Gold is currently priced at $4,380.28, maintaining a bullish trend as it sits above its 50-day moving average. This positioning suggests that buyers are in control.";
  assert.equal(hasFormulaicOpening(body), true);
});

test("hasFormulaicOpening returns false for a genuinely different opening", () => {
  const body = "Bitcoin tumbled to $58,220.10 after a sharp risk-off move overnight, dropping below its 50-day moving average for the first time in three weeks.";
  assert.equal(hasFormulaicOpening(body), false);
});

test("extractClosingSummaryParagraph skips the disclaimer and returns the real summary paragraph before it", () => {
  const body = "First paragraph.\n\nSecond paragraph.\n\nOverall, the current price, RSI, and support/resistance levels suggest a cautious outlook.\n\nThis is not financial advice; readers should draw their own conclusions.";
  assert.match(extractClosingSummaryParagraph(body), /^Overall,/);
});

test("hasFormulaicClosing detects the real 'Overall, the current price... suggests' wrap-up (article 353)", () => {
  const body = "Paragraph one.\n\nParagraph two.\n\nOverall, the current price of 7,616.3, combined with the neutral RSI and key support and resistance levels, suggests that the S&P 500 is in a state of cautious consolidation.\n\nThis is not financial advice; readers should draw their own conclusions.";
  assert.equal(hasFormulaicClosing(body), true);
});

// Regression tests for selectRelatedCoverage - real regression: articles
// 372-380 (BTC) kept being fed the SAME relatedCoverage article (the
// "despite a 1.5% decline in September, Bitcoin is on track for its first
// quarterly gain in a year" story) on every generation, because
// findRelatedCoverage() only ever checked "is this within 48h," never
// "have I already used this specific coverage for this instrument."
const QUARTERLY_GAIN_STORY = {
  id: 211,
  title: "Bitcoin Down 1.5% in September, On Track for Quarterly Gain",
  dek: "Despite rising rates and a stronger dollar, Bitcoin is poised for its first quarterly gain in a year, showing resilience in a tough market.",
  sources: ["CoinDesk"],
};
const OUTFLOWS_STORY = {
  id: 185,
  title: "Ether and XRP ETFs See Outflows as Bitcoin Surges Above $77,000",
  dek: "Ether funds have recorded outflows for three consecutive sessions, even as Bitcoin rallies.",
  sources: ["CoinDesk"],
};
// A second outlet is required so each candidate individually clears the
// 2-distinct-source bar findRelatedCoverage() already enforces - real
// coverage rarely comes from a single outlet across both a "used" and a
// "fresh" story, but the test needs both candidates to independently
// qualify to isolate what's being tested (the exclusion, not the source
// count bar).
const QUARTERLY_GAIN_STORY_2 = { ...QUARTERLY_GAIN_STORY, sources: ["CoinDesk", "The Block"] };
const OUTFLOWS_STORY_2 = { ...OUTFLOWS_STORY, sources: ["CoinDesk", "The Block"] };

test("selectRelatedCoverage excludes an already-used fact when a fresh alternative exists (real articles 211/185)", () => {
  const candidates = [QUARTERLY_GAIN_STORY_2, OUTFLOWS_STORY_2];
  const alreadyUsed = new Set([211]); // the quarterly-gain story was used in the last article
  const result = selectRelatedCoverage(candidates, alreadyUsed);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 185);
  assert.ok(!result.some((c) => c.id === 211), "the already-used quarterly-gain story should not appear in a fresh prompt's coverage");
});

test("selectRelatedCoverage falls back to the already-used fact when it's the only relevant coverage available", () => {
  const candidates = [QUARTERLY_GAIN_STORY_2];
  const alreadyUsed = new Set([211]);
  const result = selectRelatedCoverage(candidates, alreadyUsed);
  assert.equal(result.length, 1, "with no other relevant coverage, the already-used story should still be included rather than going silent");
  assert.equal(result[0].id, 211);
});

test("selectRelatedCoverage returns everything unfiltered when nothing has been used yet", () => {
  const candidates = [QUARTERLY_GAIN_STORY_2, OUTFLOWS_STORY_2];
  const result = selectRelatedCoverage(candidates, new Set());
  assert.equal(result.length, 2);
});

test("selectRelatedCoverage still enforces the 2-distinct-source bar after exclusion", () => {
  const singleSourceOnly = [{ ...OUTFLOWS_STORY, sources: ["CoinDesk"] }]; // only 1 distinct source
  const result = selectRelatedCoverage(singleSourceOnly, new Set());
  assert.equal(result.length, 0);
});

test("hasFormulaicClosing detects the same structural pattern under a different wrap-up word (article 343, 'Taken together')", () => {
  const body = "Paragraph one.\n\nParagraph two.\n\nTaken together, these figures suggest that gold is in a delicate balance. The neutral RSI indicates a lack of strong buying or selling pressure.\n\nThis analysis is not financial advice.";
  assert.equal(hasFormulaicClosing(body), true);
});

test("hasFormulaicClosing returns false when the closing paragraph doesn't restate price/RSI/support/resistance", () => {
  const body = "Paragraph one.\n\nParagraph two.\n\nOverall, traders should watch for confirmation before adjusting positions.\n\nThis is not financial advice.";
  assert.equal(hasFormulaicClosing(body), false);
});

test("hasFormulaicClosing returns false for a closing paragraph with no wrap-up transition word at all", () => {
  const body = "Paragraph one.\n\nParagraph two.\n\nThe RSI and support/resistance levels remain the key numbers traders are watching heading into the Fed decision.\n\nThis is not financial advice.";
  assert.equal(hasFormulaicClosing(body), false);
});

// Found during the step-4 manual qualitative read of fresh output
// (2026-09-19, real articles 376/377) - two more wrap-up words carrying
// the exact same restate-the-numbers pattern that the original word list
// (calibrated from step-1 corpus mining alone) didn't yet recognize.
test("hasFormulaicClosing detects 'Taking into account' (real article 376)", () => {
  const body = "Paragraph one.\n\nParagraph two.\n\nTaking into account the current price, RSI, and proximity to support and resistance, Bitcoin appears to be in a stable position for potential upward movement.\n\nThis analysis is not financial advice.";
  assert.equal(hasFormulaicClosing(body), true);
});

test("hasFormulaicClosing detects 'Together,' (real article 377)", () => {
  const body = "Paragraph one.\n\nParagraph two.\n\nTogether, these indicators suggest that ETH is in a delicate balance, with the potential for upward movement if it can maintain above resistance.\n\nThis analysis is not financial advice.";
  assert.equal(hasFormulaicClosing(body), true);
});
