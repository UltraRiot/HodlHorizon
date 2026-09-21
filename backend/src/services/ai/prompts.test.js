// Regression tests for the #429-style divergence-acknowledgment question
// added to buildRedundancyCheckPrompt - real article #429 ("Yen Weakens
// Past 157 After Bank of Japan Rate Hike") stated the BOJ hiked rates and,
// separately, that the yen weakened right after - the opposite of typical
// expectation (a hike would normally support a currency) - with zero
// acknowledgment anywhere that this was unusual. No existing check caught
// this: the causal-claim question only flags an INVENTED explanation, and
// this brief invented nothing - it just never acknowledged the tension at
// all. These tests pin the new question's text and JSON contract rather
// than simulate a live model response (this project's established
// pattern for LLM-question prompts - the actual behavior is verified
// against real generation, not simulated here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRedundancyCheckPrompt, buildArticlePrompt, STYLE_INSTRUCTIONS } from "./prompts.js";

const REAL_429_PARAGRAPH1 =
  "The yen weakened past 157 against the dollar after the Bank of Japan raised interest rates. This marked a shift in market expectations, as traders anticipated a stronger yen following the hike.";
const REAL_429_SOURCE =
  "CNBC Markets: \"Bank of Japan hikes rates\" - The Bank of Japan raised interest rates. The yen weakened past 157 against the dollar in the hours after the announcement.";

test("buildRedundancyCheckPrompt asks a 4th question about unacknowledged divergence", () => {
  const prompt = buildRedundancyCheckPrompt({
    paragraph1: REAL_429_PARAGRAPH1,
    paragraph2: "Paragraph 2.",
    paragraph3: "Paragraph 3.",
    sourceText: REAL_429_SOURCE,
  });
  assert.match(prompt, /4\. Does the brief present two facts/);
  assert.match(prompt, /counterintuitive/i);
  assert.match(prompt, /"unacknowledged_divergence": true or false/);
  assert.match(prompt, /"divergence_reason": "one sentence/);
});

test("buildRedundancyCheckPrompt's divergence question explicitly does not require an invented cause", () => {
  const prompt = buildRedundancyCheckPrompt({
    paragraph1: REAL_429_PARAGRAPH1,
    paragraph2: "Paragraph 2.",
    paragraph3: "Paragraph 3.",
    sourceText: REAL_429_SOURCE,
  });
  assert.match(prompt, /should NOT be flagged/);
  assert.match(prompt, /wasn't addressed in the available coverage/);
});

test("buildRedundancyCheckPrompt tells the model to always answer false to question 4 (like question 3) when there is no source material", () => {
  const prompt = buildRedundancyCheckPrompt({
    paragraph1: REAL_429_PARAGRAPH1,
    paragraph2: "Paragraph 2.",
    paragraph3: "Paragraph 3.",
    sourceText: undefined,
  });
  const causalNoteCount = (prompt.match(/always answer false to this question/g) || []).length;
  assert.equal(causalNoteCount, 2, "the 'no source material' note must apply to both question 3 and question 4");
});

// Regression tests for the cross-asset impact instruction added to
// buildArticlePrompt - a real gap found in the manual read: stories that
// plainly affected a specific named instrument beyond the primary subject
// were routinely reported without ever naming that instrument.
test("buildArticlePrompt includes the CROSS-ASSET IMPACT instruction, grounded in the source material", () => {
  const prompt = buildArticlePrompt(
    [{ sourceName: "Test Source", title: "Test headline", contentSnippet: "Test snippet." }],
    undefined,
    undefined,
    undefined
  );
  assert.match(prompt, /CROSS-ASSET IMPACT/);
  assert.match(prompt, /using only what the source material itself supports/);
});

test("buildArticlePrompt's cross-asset instruction explicitly forbids forcing a connection onto a story that has none", () => {
  const prompt = buildArticlePrompt([{ sourceName: "Test Source", title: "Test headline" }], undefined, undefined, undefined);
  assert.match(prompt, /Do not force this if the source gives no such connection/);
});

test("buildArticlePrompt instructs the model to translate non-English source material fully into English", () => {
  const prompt = buildArticlePrompt([{ sourceName: "Test Source", title: "Titre de test" }], undefined, undefined, undefined);
  assert.match(prompt, /translate its meaning fully into English/);
  assert.match(prompt, /never leave any non-English word or phrase untranslated/);
});

// Regression tests for the thin-source warning added after a real
// regression: a headline-only Yahoo Finance item ("Nasdaq Futures Drop as
// Treasury Yields Rise") produced a specific invented Nasdaq level
// (14,300) roughly half the real cached level (29,579.5) -
// findIndexPriceMismatch caught it after the fact, but this is the fix
// for the actual cause (a thin source tempting the model to fabricate a
// number), told to the model up front instead of only ever caught after.
test("buildArticlePrompt includes the THIN SOURCE WARNING when isThinSource is true", () => {
  const prompt = buildArticlePrompt([{ sourceName: "Yahoo Finance", title: "Nasdaq Futures Drop as Treasury Yields Rise" }], undefined, undefined, undefined, true);
  assert.match(prompt, /THIN SOURCE WARNING/);
  assert.match(prompt, /Do NOT invent one to fill this gap, even a number you believe you already know to be real/);
});

test("buildArticlePrompt omits the THIN SOURCE WARNING when isThinSource is false or omitted", () => {
  const promptFalse = buildArticlePrompt([{ sourceName: "Test Source", title: "Test headline", contentSnippet: "Real detailed content here." }], undefined, undefined, undefined, false);
  const promptOmitted = buildArticlePrompt([{ sourceName: "Test Source", title: "Test headline" }], undefined, undefined, undefined);
  assert.doesNotMatch(promptFalse, /THIN SOURCE WARNING/);
  assert.doesNotMatch(promptOmitted, /THIN SOURCE WARNING/);
});

test("buildArticlePrompt still includes the paragraph-2 requirement block alongside the cross-asset block when a directive is passed", () => {
  const prompt = buildArticlePrompt(
    [{ sourceName: "Test Source", title: "Test headline" }],
    undefined,
    undefined,
    "Test paragraph 2 directive text."
  );
  assert.match(prompt, /PARAGRAPH 2 REQUIREMENT: Test paragraph 2 directive text\./);
  assert.match(prompt, /CROSS-ASSET IMPACT/);
});

// Regression test for the "who this matters to" filler ban - measured
// real incidence across a 100-article sample (18%, e.g. real articles
// #626 "The doubling of the inferred resource is a positive indicator
// for investors, suggesting enhanced prospects..." and #692 "This
// potential development is particularly relevant for technology
// investors...") before adding this instruction.
test("STYLE_INSTRUCTIONS bans the real generic-significance filler phrasings found in the 18% incidence measurement", () => {
  assert.match(STYLE_INSTRUCTIONS, /is particularly relevant for/i);
  assert.match(STYLE_INSTRUCTIONS, /is a positive\/negative indicator/i);
  assert.match(STYLE_INSTRUCTIONS, /name the SPECIFIC mechanism/i);
});
