// Regression tests for contentLacksCategoryKeywords's CATEGORY_KEYWORDS
// vocabulary - built after a real batch test surfaced two genuine gaps:
// article #434 (Paramount/Warner Bros settlement) was real, on-topic
// Stocks content that had zero hits against the original Stocks list
// (which only covered trading/market-structure words, not corporate-
// affairs vocabulary like "merger"/"settlement"), and article #440
// (Nigeria mining deaths) was real, on-topic Commodities content with
// zero hits against the original Commodities list (which named specific
// commodities like gold/oil but had no generic mining vocabulary). Both
// bodies below are copied verbatim from the real articles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contentLacksCategoryKeywords } from "./articleUtils.js";

test("contentLacksCategoryKeywords no longer flags the real Paramount/Warner Bros settlement story as lacking Stocks keywords (article 434)", () => {
  const title = "Paramount May Settle Warner Bros. Dispute This Weekend";
  const body = "Paramount could reach a settlement with states regarding its Warner Bros. dispute as soon as this weekend, according to sources familiar with the situation.\n\nThis development is significant for investors as it may resolve ongoing legal uncertainties that have affected Paramount's operations and financial outlook.\n\nThe potential settlement comes amid broader scrutiny of media mergers and acquisitions, with industry analysts watching closely for any implications on similar deals in the future.";
  assert.equal(contentLacksCategoryKeywords("Stocks", title, body), false);
});

test("contentLacksCategoryKeywords no longer flags the real Nigeria mining deaths story as lacking Commodities keywords (article 440)", () => {
  const title = "Nigeria Suspends Mining Operations After 37 Deaths";
  const body = "Niger state has suspended all mining operations until further notice after 37 people died in a mining-related incident. The government also imposed a round-the-clock curfew in the city of Minna to maintain order during the crackdown.\n\nThis suspension affects mining companies and local economies dependent on the sector, raising concerns about job losses and economic stability in the region.\n\nAuthorities have not provided a timeline for when mining activities might resume, indicating that the situation remains fluid.";
  assert.equal(contentLacksCategoryKeywords("Commodities", title, body), false);
});

test("contentLacksCategoryKeywords still flags genuinely off-topic content for Stocks", () => {
  const title = "Local Bakery Wins Regional Pastry Award";
  const body = "A small bakery took home top honors at a regional pastry competition this week.\n\nJudges praised the bakery's croissants and seasonal fruit tarts.\n\nThe owner said the award will help bring in new customers ahead of the holidays.";
  assert.equal(contentLacksCategoryKeywords("Stocks", title, body), true);
});

test("contentLacksCategoryKeywords still flags genuinely off-topic content for Commodities", () => {
  const title = "City Council Approves New Downtown Parking Garage";
  const body = "The city council voted unanimously to approve a new parking garage downtown.\n\nConstruction is expected to begin next spring and take about a year.\n\nOfficials say the garage will ease congestion near the arena.";
  assert.equal(contentLacksCategoryKeywords("Commodities", title, body), true);
});

test("contentLacksCategoryKeywords still requires 2+ body hits when the title has none (the single-incidental-namedrop guard this list is built around)", () => {
  const title = "Connecticut Sports Betting Lawsuit Names Several Platforms";
  const body = "A lawsuit filed in Connecticut names several sports betting platforms as defendants.\n\nCoinbase was mentioned once in court filings as an unrelated payment processor used by one platform.\n\nThe case is expected to proceed to discovery next month.";
  assert.equal(contentLacksCategoryKeywords("Crypto", title, body), true);
});

// Regression test for the strong-keyword weighting fix - real article #442
// (Hormuz shipping costs) had exactly one body hit ("commodities") and
// zero title hits, and was rejected purely by the blanket 2+ rule despite
// being genuinely on-topic. Body copied verbatim from the real article.
test("contentLacksCategoryKeywords no longer flags the real Hormuz shipping-costs story for a single explicit 'commodities' mention (article 442)", () => {
  const title = "Shipping Costs Surge to $5 Million Per Passage Amid Hormuz Crisis";
  const body = "Shipping costs have soared to record highs, with some vessel operators willing to pay $4-5 million for a single passage through the Panama Canal due to disruptions in the Strait of Hormuz.\n\nThis surge in costs is significant for traders and investors, as it impacts the overall cost of transporting energy commodities, potentially affecting prices in global markets.\n\nIn the past six months, energy cargo traffic has increased through the Panama and Suez Canals, highlighting the ongoing strain on shipping routes.";
  assert.equal(contentLacksCategoryKeywords("Commodities", title, body), false);
});

test("contentLacksCategoryKeywords does not let the strong-keyword exception reopen the single-incidental-namedrop gap for non-strong keywords", () => {
  // "gold" mentioned exactly once, incidentally, with no other Commodities
  // keyword and no title hit - the strong-keyword exception only applies
  // to the category's own name ("commodity"/"commodities"), so this must
  // still be flagged, same as before the weighting change.
  const title = "Museum Unveils New Ancient Artifact Exhibit";
  const body = "A local museum opened a new exhibit featuring ancient artifacts this week.\n\nOne display case includes a small gold ornament recovered from a nearby archaeological site.\n\nThe exhibit runs through the end of the year and is free to the public.";
  assert.equal(contentLacksCategoryKeywords("Commodities", title, body), true);
});

test("contentLacksCategoryKeywords strong-keyword exception also applies to Stocks/Indices ('equities')", () => {
  const title = "Global Fund Managers Rotate Portfolios Ahead of Year End";
  const body = "Several large fund managers are adjusting their holdings ahead of the year's final trading sessions, according to a new industry survey.\n\nThe survey found a modest rotation toward equities broadly, though managers cited no single catalyst for the shift.\n\nResults are expected to be finalized and published in a follow-up report next month.";
  assert.equal(contentLacksCategoryKeywords("Stocks", title, body), false);
});
