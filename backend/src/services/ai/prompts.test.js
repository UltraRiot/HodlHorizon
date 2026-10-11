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

test("STYLE_INSTRUCTIONS bans the real generic-significance filler phrasings found in the 18% incidence measurement", () => {
  assert.match(STYLE_INSTRUCTIONS, /is particularly relevant for/i);
  assert.match(STYLE_INSTRUCTIONS, /is a positive\/negative indicator/i);
  assert.match(STYLE_INSTRUCTIONS, /name the SPECIFIC mechanism/i);
});
