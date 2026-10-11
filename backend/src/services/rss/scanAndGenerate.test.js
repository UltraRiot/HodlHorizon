import { test } from "node:test";
import assert from "node:assert/strict";
import { findStaleOrThinSource, insertArticleWithSourcesOrDiscard } from "./scanAndGenerate.js";
import { query } from "../../db.js";

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

test("insertArticleWithSourcesOrDiscard: two concurrent inserts of the same source_url produce exactly one article", async () => {
  const { rows: catRows } = await query("SELECT id FROM categories LIMIT 1");
  const categoryId = catRows[0].id;
  const sourceUrl = `https://example.com/test-race-condition-${Date.now()}-${Math.random()}`;

  const articleFields = (title) => ({
    slug: `test-race-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title,
    dek: "Test dek.",
    body: "Test body.\n\nSecond paragraph.\n\nThird paragraph.",
    categoryId,
    status: "review",
    seoTitle: "Test SEO title",
    seoDescription: "Test SEO description that is long enough to pass validation checks comfortably.",
    readMinutes: 1,
    sourceCount: 1,
    aiProvider: "mock",
    publishedAt: null,
  });
  const group = [{ sourceName: "Test Source", link: sourceUrl }];

  let idA, idB;
  try {
    [idA, idB] = await Promise.all([
      insertArticleWithSourcesOrDiscard(articleFields("Race test A"), group),
      insertArticleWithSourcesOrDiscard(articleFields("Race test B"), group),
    ]);

    const winners = [idA, idB].filter((id) => id !== null);
    const losers = [idA, idB].filter((id) => id === null);
    assert.equal(winners.length, 1, `expected exactly one insert to win the race, got ${winners.length} (both ids: ${idA}, ${idB})`);
    assert.equal(losers.length, 1, "expected exactly one insert to lose the race and return null");

    const stored = await query("SELECT COUNT(*)::int AS n FROM article_sources WHERE source_url = $1", [sourceUrl]);
    assert.equal(stored.rows[0].n, 1, "expected exactly one article_sources row for this source_url, not two");
  } finally {
    for (const id of [idA, idB]) {
      if (id !== null && id !== undefined) await query("DELETE FROM articles WHERE id = $1", [id]);
    }
  }
});
