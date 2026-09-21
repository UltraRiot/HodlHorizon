// Regression tests for the code-driven opening/closing template selection
// that replaced the "vary your writing" PROMPT instruction - two separate
// rounds of real generation (2026-09-19) proved that instruction doesn't
// hold: hasFormulaicOpening/hasFormulaicClosing incidence stayed at
// 94%/76% across the published backlog even after the model was told,
// explicitly and repeatedly, to vary itself. These tests confirm the
// REPLACEMENT actually rotates - not just "produces some variety," but
// provably never repeats a template within its own exclusion window,
// which is the specific guarantee the prompt-only version never had.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OPENING_TEMPLATES, CLOSING_DIRECTIVES, selectTemplate } from "./analysisTemplates.js";

const BULLISH_MID_RANGE_SNAPSHOT = {
  symbol: "BTC",
  price: 80000,
  trend: "Bullish",
  rsi_14: 54,
  rsi_note: "Neutral zone",
  support: 75000,
  resistance: 85000,
  assetClass: "crypto",
};

test("selectTemplate never picks an id from the exclusion set when other applicable options exist", () => {
  // Exclude all but one id (3) from the 8 opening templates - every one
  // of these snapshots is mid-range (not a breakout), so template 3
  // (breakout-framing) isn't applicable either, meaning template 5
  // (dual-distance-comparative) must be the only one left after both the
  // exclusion and the applicability filter.
  const excludeAllButOne = OPENING_TEMPLATES.filter((t) => t.id !== 5 && t.applicable(BULLISH_MID_RANGE_SNAPSHOT)).map((t) => t.id);
  const chosen = selectTemplate(OPENING_TEMPLATES, BULLISH_MID_RANGE_SNAPSHOT, excludeAllButOne);
  assert.equal(chosen.id, 5);
});

test("selectTemplate provably rotates: running it 30 times with a shrinking exclusion window never repeats within that window", () => {
  // Simulates the real runAnalysisScan() usage: after each pick, that id
  // joins the "last 5 used" exclusion set for the next pick. Over 30
  // picks, no single template should appear twice within any 5-pick
  // window - the exact guarantee "exclude whichever were used in the
  // last 5 articles" is supposed to provide.
  const usedHistory = [];
  for (let i = 0; i < 30; i++) {
    const recentWindow = usedHistory.slice(-5);
    const chosen = selectTemplate(OPENING_TEMPLATES, BULLISH_MID_RANGE_SNAPSHOT, recentWindow);
    assert.ok(!recentWindow.includes(chosen.id), `pick #${i} chose template ${chosen.id}, which was used in the last 5 picks (${recentWindow.join(",")}) - the exclusion window failed`);
    usedHistory.push(chosen.id);
  }
});

test("selectTemplate falls back to ignoring the exclusion window (never the applicability filter) when every applicable option was recently used", () => {
  const allApplicableIds = OPENING_TEMPLATES.filter((t) => t.applicable(BULLISH_MID_RANGE_SNAPSHOT)).map((t) => t.id);
  const chosen = selectTemplate(OPENING_TEMPLATES, BULLISH_MID_RANGE_SNAPSHOT, allApplicableIds);
  // Falls back to the full applicable pool rather than throwing or
  // returning undefined - still must be a genuinely applicable template.
  assert.ok(allApplicableIds.includes(chosen.id));
});

test("selectTemplate only offers breakout-framing when price has genuinely broken outside the support/resistance band", () => {
  const midRange = { ...BULLISH_MID_RANGE_SNAPSHOT, price: 80000 }; // between 75000 support and 85000 resistance
  const breakout = { ...BULLISH_MID_RANGE_SNAPSHOT, price: 90000 }; // above 85000 resistance

  for (let i = 0; i < 20; i++) {
    assert.notEqual(selectTemplate(OPENING_TEMPLATES, midRange, []).id, 3, "breakout-framing should never be offered when price is still inside the band");
  }
  // Force template 3 to be pickable by excluding every other applicable
  // one for the genuine breakout case.
  const onlyBreakoutLeft = OPENING_TEMPLATES.filter((t) => t.id !== 3 && t.applicable(breakout)).map((t) => t.id);
  assert.equal(selectTemplate(OPENING_TEMPLATES, breakout, onlyBreakoutLeft).id, 3);
});

test("every opening template produces a sentence containing the real price for the given snapshot", () => {
  for (const template of OPENING_TEMPLATES) {
    if (!template.applicable(BULLISH_MID_RANGE_SNAPSHOT)) continue;
    const sentence = template.build(BULLISH_MID_RANGE_SNAPSHOT);
    assert.match(sentence, /80,000/, `template "${template.label}" didn't include the real price: ${sentence}`);
  }
});

test("closing directive selection also rotates and excludes recently-used ids", () => {
  const usedHistory = [];
  for (let i = 0; i < 20; i++) {
    const recentWindow = usedHistory.slice(-5);
    const chosen = selectTemplate(CLOSING_DIRECTIVES, BULLISH_MID_RANGE_SNAPSHOT, recentWindow);
    assert.ok(!recentWindow.includes(chosen.id));
    usedHistory.push(chosen.id);
  }
});

test("every closing directive explicitly bans the real repeated wrap-up words found in corpus mining", () => {
  for (const directive of CLOSING_DIRECTIVES) {
    assert.match(directive.instruction, /Overall/);
    assert.match(directive.instruction, /In summary/);
    assert.match(directive.instruction, /Taken together/);
  }
});
