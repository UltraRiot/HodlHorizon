// Regression tests for News paragraph-2 template rotation - same rotation
// guarantee already proven for Analysis's opening/closing templates
// (analysisTemplates.test.js): not just "produces some variety," but
// provably never repeats a directive within its own exclusion window.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PARAGRAPH2_DIRECTIVES } from "./newsParagraph2Templates.js";
import { selectTemplate } from "./templateSelection.js";

test("PARAGRAPH2_DIRECTIVES has 4 distinct framings, all unconditionally applicable (no applicable() gate)", () => {
  assert.equal(PARAGRAPH2_DIRECTIVES.length, 4);
  const labels = new Set(PARAGRAPH2_DIRECTIVES.map((d) => d.label));
  assert.equal(labels.size, 4, "every directive must have a distinct label");
  for (const d of PARAGRAPH2_DIRECTIVES) {
    assert.equal(d.applicable, undefined, `${d.label} should not gate on applicability - all 4 are always safe to force`);
  }
});

test("every directive explicitly forbids inventing content the source doesn't support", () => {
  for (const d of PARAGRAPH2_DIRECTIVES) {
    assert.match(d.instruction, /source material/i, `${d.label} must ground itself in the source material`);
    assert.match(d.instruction, /invent|only use|actually (stated|present|names)/i, `${d.label} must explicitly forbid fabricating when the source doesn't support the framing`);
  }
});

test("selectTemplate rotates News paragraph-2 directives and never repeats within the exclusion window", () => {
  const usedHistory = [];
  for (let i = 0; i < 40; i++) {
    const recentWindow = usedHistory.slice(-3);
    const chosen = selectTemplate(PARAGRAPH2_DIRECTIVES, null, recentWindow);
    assert.ok(!recentWindow.includes(chosen.id), `pick #${i} chose directive ${chosen.id}, which was used in the last 3 picks (${recentWindow.join(",")})`);
    usedHistory.push(chosen.id);
  }
});

test("selectTemplate falls back to the full pool (never throws) when every directive was recently used", () => {
  const allIds = PARAGRAPH2_DIRECTIVES.map((d) => d.id);
  const chosen = selectTemplate(PARAGRAPH2_DIRECTIVES, null, allIds);
  assert.ok(allIds.includes(chosen.id));
});

// Regression tests for ANTI_HEDGE_PREFIX - added after a real fresh batch
// (30 articles, all 4 News categories) found the model evading
// findFormulaicParagraphTransition's specific verb list with synonymous
// vague-hedge phrasing inside each directive's own thin-source fallback
// clause - real examples: article #490 "This situation IS CRITICAL for
// traders," article #471 "This underperformance MAY SIGNAL investor
// concerns." Every directive must ban these specific discovered phrases,
// not just the original 7-verb regex list.
test("every directive bans the real vague-hedge phrasings found in the post-fix verification batch", () => {
  for (const d of PARAGRAPH2_DIRECTIVES) {
    assert.match(d.instruction, /may signal/i, `${d.label} must ban "may signal" (real article #471)`);
    assert.match(d.instruction, /is critical for/i, `${d.label} must ban "is critical for" (real article #490)`);
    assert.match(d.instruction, /this aligns with/i, `${d.label} must ban "this aligns with"`);
  }
});

test("the anti-hedge ban applies even in the thin-source fallback branch, not just the primary framing", () => {
  for (const d of PARAGRAPH2_DIRECTIVES) {
    assert.match(d.instruction, /even when you cannot find/i, `${d.label} must explicitly extend the ban to its own fallback clause`);
  }
});
