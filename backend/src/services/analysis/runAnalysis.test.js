// Permanent regression tests for the Analysis fact-check guardrails
// (findAnalysisDistanceMismatch/findAnalysisFactMismatch/findMissingQualifier).
// This codebase has no test framework wired up yet, so this uses Node's
// built-in test runner (node:test, stable since Node 18) rather than
// adding a new dependency for one file - run with `node --test` from
// backend/ (or `npm test`, see package.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findAnalysisDistanceMismatch } from "./runAnalysis.js";

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
