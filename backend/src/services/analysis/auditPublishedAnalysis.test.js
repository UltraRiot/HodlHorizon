// Regression tests for the audit's own text-extraction step
// (reconstructSnapshotFromArticleText) - this is what lets the audit
// re-check already-published articles at all, since this project has
// never persisted the exact price/support/resistance snapshot that was
// true when a given article was generated (see auditPublishedAnalysis.js's
// top comment). Every body used here is real, copied verbatim from this
// project's actual published Analysis backlog (not synthesized), the same
// text the regex patterns were originally calibrated against.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reconstructSnapshotFromArticleText } from "./auditPublishedAnalysis.js";

test("reconstructSnapshotFromArticleText extracts price/support/resistance from a real Bitcoin article body", () => {
  const body = "Bitcoin is currently priced at $81,163.14, maintaining a bullish trend as it trades above its 50-day moving average. This position indicates a strong market sentiment, despite a slight 1.5% decline in September. The price is approaching resistance at $80,329.35, which, if broken, could signal further upward momentum. Conversely, if it falls below the support level of $75,590.24, it may indicate a shift in market sentiment.";
  const snapshot = reconstructSnapshotFromArticleText("BTC", body);
  assert.notEqual(snapshot, null);
  assert.equal(snapshot.price, 81163.14);
  assert.equal(snapshot.support, 75590.24);
  assert.equal(snapshot.resistance, 80329.35);
  assert.equal(snapshot.assetClass, "crypto");
});

test("reconstructSnapshotFromArticleText handles the 'current price stands at' phrasing variant (real article 162)", () => {
  const body = "Gold's current price stands at $392.84, above its 50-day moving average, indicating a bullish trend. However, the 14-day RSI is neutral.";
  const snapshot = reconstructSnapshotFromArticleText("Gold", body);
  assert.notEqual(snapshot, null);
  assert.equal(snapshot.price, 392.84);
  assert.equal(snapshot.assetClass, "commodity");
});

test("reconstructSnapshotFromArticleText handles index-style bodies with no dollar sign (real article 217)", () => {
  const body = "The S&P 500 is currently priced at 7,626, maintaining a bullish trend as it remains above its 50-day moving average. Support is at 7,500 and resistance is at 7,700.";
  const snapshot = reconstructSnapshotFromArticleText("S&P 500", body);
  assert.notEqual(snapshot, null);
  assert.equal(snapshot.price, 7626);
  assert.equal(snapshot.support, 7500);
  assert.equal(snapshot.resistance, 7700);
  assert.equal(snapshot.assetClass, "index");
});

test("reconstructSnapshotFromArticleText returns null (not a guessed price) when the body never states a price at all", () => {
  const body = "The market showed mixed signals today with no clear directional bias.";
  assert.equal(reconstructSnapshotFromArticleText("BTC", body), null);
});

test("reconstructSnapshotFromArticleText returns a snapshot with null support/resistance when the article itself says they're undefined (real article 163)", () => {
  const body = "WTI crude oil is priced at $97.26, reflecting a bearish trend as it trades below its 50-day moving average. This suggests weakening momentum, which could impact trading strategies. The 14-day RSI is neutral, indicating indecision in the market, while support and resistance levels remain undefined, adding uncertainty to future price movements.";
  const snapshot = reconstructSnapshotFromArticleText("Oil (WTI)", body);
  assert.notEqual(snapshot, null, "price was stated, so extraction should still succeed overall");
  assert.equal(snapshot.price, 97.26);
  assert.equal(snapshot.support, null);
  assert.equal(snapshot.resistance, null);
});
