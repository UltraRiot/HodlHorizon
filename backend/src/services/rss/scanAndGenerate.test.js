// Permanent regression test for the stale/thin-source guardrail
// (findStaleOrThinSource) - see its comment in scanAndGenerate.js for the
// real incident (article 207, "Central Banks Increase Gold Reserves Amid
// Geopolitical Tensions") that motivated it: a source with literally no
// content beyond a headline let the model fill in a real-but-years-stale
// statistic as if it were current news.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findStaleOrThinSource } from "./scanAndGenerate.js";

test("findStaleOrThinSource flags a group where every source has no real content (the real article-207 case)", () => {
  const group = [{ sourceName: "Investing.com - Commodities", title: "Central Banks Are Moving Gold as Geopolitical Risks Reshape Reserve Strategy", contentSnippet: "" }];
  const note = findStaleOrThinSource(group);
  assert.notEqual(note, null, "expected a bare-headline-only source to be flagged");
  assert.match(note, /real content beyond a headline/);
});

test("findStaleOrThinSource is clean when at least one source in the group has real content", () => {
  const group = [
    { sourceName: "Investing.com - Commodities", title: "Central Banks Are Moving Gold", contentSnippet: "" },
    { sourceName: "Mining.com", title: "Central banks add to gold reserves", contentSnippet: "Central banks added a net 39 tonnes of gold to reserves this month, the World Gold Council said Thursday, extending a buying streak into its third year." },
  ];
  assert.equal(findStaleOrThinSource(group), null);
});

test("findStaleOrThinSource flags an explicit past-year mention in the headline", () => {
  const group = [{ sourceName: "Investing.com - Commodities", title: "Looking Back: How Gold Performed in 2023", contentSnippet: "A detailed look back at gold's price action across 2023, month by month, and what drove each move." }];
  const note = findStaleOrThinSource(group);
  assert.notEqual(note, null, "expected a headline naming a past year to be flagged");
  assert.match(note, /past period/);
});

test("findStaleOrThinSource does not flag a current story that merely references a past event once as context", () => {
  const group = [{
    sourceName: "Mining.com",
    title: "Gold hits fresh record as central bank buying accelerates",
    contentSnippet: "Gold climbed to a fresh all-time high Thursday, extending a rally that began after a wave of central bank buying in 2023 first drew attention to the trend.",
  }];
  assert.equal(findStaleOrThinSource(group), null, "a single incidental past-year mention in the body, with a current headline, should not be enough on its own to flag");
});
