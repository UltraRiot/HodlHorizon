import { test } from "node:test";
import assert from "node:assert/strict";
import { findBannedWordViolation, findSourcePhrasingTooClose, findFormulaicParagraphTransition, findUnexplainedDekAcronym, findComparisonDirectionMismatch, findStaleForwardLookingDate, findGenericSignificanceFiller, findStaleRoleAssertion, findVagueCrossAssetClaim, stripGenericSignificanceFillerClauses } from "./provider.js";

test("findBannedWordViolation catches 'Market participants' (real article 332)", () => {
  const body = "Market participants will be closely monitoring the Fed's stance, as any changes in interest rates could influence investor sentiment and trading behavior.";
  const note = findBannedWordViolation(body);
  assert.notEqual(note, null);
  assert.match(note, /market participants/i);
});

test("findBannedWordViolation catches 'underscores' (real article 338)", () => {
  const body = "This divergence in focus underscores Bitcoin's unique position in the market, as it attracts institutional interest even amid broader market challenges.";
  const note = findBannedWordViolation(body);
  assert.notEqual(note, null);
  assert.match(note, /underscores/i);
});

test("findBannedWordViolation is case-insensitive", () => {
  assert.notEqual(findBannedWordViolation("This was a SIGNIFICANT DEVELOPMENT for the market."), null);
});

test("findBannedWordViolation returns null for clean text with none of the banned phrases", () => {
  assert.equal(findBannedWordViolation("Bitcoin rose 4% to $81,000 after a stronger-than-expected jobs report."), null);
});

test("findSourcePhrasingTooClose catches a real close paraphrase (article 211, CoinDesk)", () => {
  const sourceText = 'CoinDesk: "Bitcoin Down 1.5% in September" - Bitcoin is down just 1.5% in its historically weakest month and remains on track for its first quarterly gain in a year, despite rising rates, surging oil and a stronger dollar.';
  const body = "Bitcoin is down 1.5% in September, historically its weakest month, but remains on track for its first quarterly gain in a year amid rising interest rates and a stronger dollar.\n\nSecond paragraph.\n\nThird paragraph.";
  const note = findSourcePhrasingTooClose(body, sourceText);
  assert.notEqual(note, null, "expected the close paraphrase to be flagged");
  assert.match(note, /1\.5%/);
});

test("findSourcePhrasingTooClose catches a second real close paraphrase (article 231, oil rig count)", () => {
  const sourceText = "The total number of active drilling rigs for oil and gas in the United States rose this week, according to new data that Baker Hughes published on Friday, with the total rig count in the US rising to 595, up 53 from this same time last year.";
  const body = "The total number of active oil and gas drilling rigs in the United States increased to 595 this week, up 53 from the same time last year, according to Baker Hughes data released Friday.\n\nSecond paragraph.\n\nThird paragraph.";
  const note = findSourcePhrasingTooClose(body, sourceText);
  assert.notEqual(note, null, "expected the close paraphrase to be flagged");
});

test("findSourcePhrasingTooClose does not flag genuinely independent phrasing of the same fact (real article 233)", () => {
  const sourceText = "The regulator is moving ahead with crypto market rules as the SEC also opens a new path for tokenized stock trading.";
  const body = "The Commodity Futures Trading Commission (CFTC) has sent proposed crypto market regulations to the White House for review, as Congress continues to stall on the Clarity Act aimed at providing a regulatory framework for digital assets.\n\nSecond paragraph.\n\nThird paragraph.";
  assert.equal(findSourcePhrasingTooClose(body, sourceText), null);
});

test("findSourcePhrasingTooClose returns null when there is no source text to check against (the Analysis path)", () => {
  assert.equal(findSourcePhrasingTooClose("Any body text at all.", undefined), null);
  assert.equal(findSourcePhrasingTooClose("Any body text at all.", ""), null);
});

test("findSourcePhrasingTooClose returns null for a body with no sentences long enough to compare", () => {
  assert.equal(findSourcePhrasingTooClose("Hi.", "Bitcoin rose sharply today amid renewed institutional buying interest across major exchanges."), null);
});

test("findFormulaicParagraphTransition catches a real case (article 435, 'This scenario highlights')", () => {
  const body = "Paragraph one.\n\nThis scenario highlights the emotional and financial strain that family members can experience when dealing with money issues.\n\nParagraph three.";
  const note = findFormulaicParagraphTransition(body);
  assert.notEqual(note, null);
  assert.match(note, /scenario highlights/i);
});

test("findFormulaicParagraphTransition catches a real case (article 236, 'This move highlights')", () => {
  const body = "Paragraph one.\n\nThis move highlights the ECB's influence over cryptocurrency regulation in the EU, potentially impacting exchanges operating there.\n\nParagraph three.";
  assert.notEqual(findFormulaicParagraphTransition(body), null);
});

test("findFormulaicParagraphTransition catches a real case (article 203, 'This projection signals')", () => {
  const body = "Paragraph one.\n\nThis projection signals strong confidence in Tesla's growth potential, which may attract investors looking for long-term upside.\n\nParagraph three.";
  assert.notEqual(findFormulaicParagraphTransition(body), null);
});

test("findFormulaicParagraphTransition catches a real case (article 193, 'This decline signals')", () => {
  const body = "Paragraph one.\n\nThis decline signals caution among investors, particularly in the tech sector, which has seen significant volatility.\n\nParagraph three.";
  assert.notEqual(findFormulaicParagraphTransition(body), null);
});

test("findFormulaicParagraphTransition does not flag a genuinely different paragraph 2 (real article 232)", () => {
  const body = "Paragraph one.\n\nThe agreement gives TotalEnergies access to newly licensed offshore blocks while BlackRock provides the bulk of the project financing, according to terms disclosed Tuesday.\n\nParagraph three.";
  assert.equal(findFormulaicParagraphTransition(body), null);
});

test("findFormulaicParagraphTransition catches the real Outcrop Silver case in paragraph 1's second sentence (article 626)", () => {
  const body = "Outcrop Silver & Gold Corp has reported that the inferred silver resource at its Santa Ana project in Colombia has doubled to 35 million ounces. This increase highlights the potential of the project, which is located in the historic Mariquita silver district where mining has occurred since the 16th century.\n\nThe doubling of the inferred resource is a positive indicator for investors, suggesting enhanced prospects for future development and production in a region with a rich mining history.\n\nOutcrop plans to continue exploration efforts at Santa Ana, aiming to further expand the resource base and advance the project toward potential production stages.";
  const note = findFormulaicParagraphTransition(body);
  assert.notEqual(note, null, "expected the paragraph-1 occurrence to be caught now that the whole body is scanned");
  assert.match(note, /This increase highlights/);
});

test("findFormulaicParagraphTransition now also catches the pattern in paragraph 3 (previously exempt)", () => {
  const body = "A clean paragraph one.\n\nA clean paragraph two.\n\nThis also highlights something in paragraph three, which used to be exempt.";
  assert.notEqual(findFormulaicParagraphTransition(body), null);
});

test("findFormulaicParagraphTransition returns null for a short single-paragraph body with no formulaic sentence", () => {
  assert.equal(findFormulaicParagraphTransition("Just one paragraph, nothing else."), null);
});

test("findUnexplainedDekAcronym flags the real unexpanded 'GIP' dek (article 232)", () => {
  const dek = "The partnership focuses on TotalEnergies' infrastructure assets in Africa, with a tariff structure for GIP.";
  const note = findUnexplainedDekAcronym(dek);
  assert.notEqual(note, null);
  assert.match(note, /"GIP"/);
});

test("findUnexplainedDekAcronym does not flag an acronym the dek itself expands", () => {
  const dek = "The partnership focuses on TotalEnergies' infrastructure assets in Africa, with a tariff structure for Global Infrastructure Partners (GIP).";
  assert.equal(findUnexplainedDekAcronym(dek), null);
});

test("findUnexplainedDekAcronym does not flag common finance acronyms a reader is assumed to know", () => {
  const dek = "The CEO said the ETF's IPO could value the company well above Wall Street estimates, according to the SEC filing.";
  assert.equal(findUnexplainedDekAcronym(dek), null);
});

test("findUnexplainedDekAcronym returns null for a dek with no acronyms at all", () => {
  assert.equal(findUnexplainedDekAcronym("Bitcoin rose sharply today amid renewed institutional buying interest."), null);
});

test("findUnexplainedDekAcronym does not flag 'ATM' (real false positive found in live generation, common English usage not story-specific jargon)", () => {
  const dek = "The settlement resolves a long-running dispute over ATM fees charged to cardholders.";
  assert.equal(findUnexplainedDekAcronym(dek), null);
});

test("findUnexplainedDekAcronym does not flag 'UAE' (real false positive found in live generation, a well-known country abbreviation)", () => {
  const dek = "The carbon storage site is part of a broader push by the UAE to diversify its energy investments.";
  assert.equal(findUnexplainedDekAcronym(dek), null);
});

test("findUnexplainedDekAcronym does not flag 'CIO' (real false positive found in live generation, common business title)", () => {
  const dek = "Bitwise Chief Investment Officer Matt Hougan, the firm's CIO, noted diminishing odds of the bill passing.";
  assert.equal(findUnexplainedDekAcronym(dek), null);
});

test("findUnexplainedDekAcronym returns null for an empty or missing dek", () => {
  assert.equal(findUnexplainedDekAcronym(""), null);
  assert.equal(findUnexplainedDekAcronym(undefined), null);
});

const REAL_ZCASH_BODY =
  "Zcash is set to reduce its block time from 75 seconds to 25 seconds with a new upgrade. This change will improve transaction efficiency and alter how the network funds its security after 2031.\n\nThis upgrade is crucial for Zcash as it seeks to maintain competitiveness against other cryptocurrencies that already offer faster transaction times, such as Bitcoin, which has a block time of 10 minutes.\n\nThe Zcash development team has not disclosed a specific date for the upgrade's implementation, but it is expected to be discussed in upcoming community meetings.";

test("findComparisonDirectionMismatch catches the real Zcash/Bitcoin backwards speed claim (article 660)", () => {
  const note = findComparisonDirectionMismatch(REAL_ZCASH_BODY);
  assert.notEqual(note, null, "expected the backwards 'faster' claim to be caught");
  assert.match(note, /10 minutes/);
  assert.match(note, /longer/i);
});

test("findComparisonDirectionMismatch does not flag a correct same-sentence speed comparison", () => {
  const body = "Solana processes transactions with a slot time of 250 milliseconds, much faster than Bitcoin's 10-minute block time.\n\nSecond paragraph.\n\nThird paragraph.";
  assert.equal(findComparisonDirectionMismatch(body), null);
});

test("findComparisonDirectionMismatch does not flag a correct cross-sentence speed comparison", () => {
  const body = "Solana is set to reduce its slot time to 250 milliseconds with a new upgrade.\n\nThis keeps it well ahead of competitors, as it remains far faster than Bitcoin, which has a block time of 10 minutes.\n\nThird paragraph.";
  assert.equal(findComparisonDirectionMismatch(body), null);
});

test("findComparisonDirectionMismatch catches a backwards 'slower' claim symmetrically", () => {
  const body = "Zcash is set to reduce its block time from 75 seconds to 25 seconds with a new upgrade.\n\nThis new time remains slower than Bitcoin's, which has a block time of 10 minutes.\n\nThird paragraph.";
  const note = findComparisonDirectionMismatch(body);
  assert.notEqual(note, null, "25 seconds is shorter (faster) than 10 minutes, so calling it 'slower' is backwards");
});

test("findComparisonDirectionMismatch returns null when there is only one duration mentioned", () => {
  assert.equal(findComparisonDirectionMismatch("Zcash's new block time of 25 seconds is much faster now.\n\nSecond paragraph.\n\nThird paragraph."), null);
});

test("findComparisonDirectionMismatch returns null for a body with no comparison words at all", () => {
  assert.equal(findComparisonDirectionMismatch(REAL_ZCASH_BODY.replace(/faster/i, "different")), null);
});

const REAL_BASTION_BODY =
  "Bastion Platforms National Trust Company has received conditional approval from the Office of the Comptroller of the Currency (OCC) to operate as a national trust bank.\n\nThe approval allows Bastion to offer services including custody for stablecoins, digital wallets, payment infrastructure, and white-label issuance, positioning the company to play a pivotal role in the evolving crypto banking sector.\n\nBastion aims to launch its services in early 2024, pending final regulatory requirements, as it seeks to capitalize on the growing demand for secure digital asset management solutions.";

test("findStaleForwardLookingDate catches the real Bastion Platforms stale-date claim (article 759)", () => {
  const note = findStaleForwardLookingDate(REAL_BASTION_BODY, new Date("2026-09-19T00:00:00Z"));
  assert.notEqual(note, null, "expected the pending '2024' launch claim to be caught as stale relative to 2026");
  assert.match(note, /2024/);
  assert.match(note, /already passed/);
});

test("findStaleForwardLookingDate does not flag a forward-looking claim about the current year", () => {
  const body = "The company aims to launch its services in early 2026, pending final regulatory requirements.\n\nSecond paragraph.\n\nThird paragraph.";
  assert.equal(findStaleForwardLookingDate(body, new Date("2026-09-19T00:00:00Z")), null);
});

test("findStaleForwardLookingDate does not flag a forward-looking claim about a genuine future year", () => {
  const body = "The company is expected to complete the rollout by 2028, according to its latest filing.\n\nSecond paragraph.\n\nThird paragraph.";
  assert.equal(findStaleForwardLookingDate(body, new Date("2026-09-19T00:00:00Z")), null);
});

test("findStaleForwardLookingDate does not flag a past year mentioned WITHOUT a forward-looking verb (that's findStaleSubjectMention's job)", () => {
  const body = "The company launched its first product in 2024 to strong demand.\n\nSecond paragraph.\n\nThird paragraph.";
  assert.equal(findStaleForwardLookingDate(body, new Date("2026-09-19T00:00:00Z")), null);
});

test("findStaleForwardLookingDate returns null for a body with no year references at all", () => {
  assert.equal(findStaleForwardLookingDate("The company plans to launch its services soon, pending regulatory approval.\n\nSecond paragraph.\n\nThird paragraph.", new Date("2026-09-19T00:00:00Z")), null);
});

test("findGenericSignificanceFiller catches the real 'raises concerns about' filler (article 761)", () => {
  const body = "Paragraph one.\n\nThis incident raises concerns about the security of customer data in the crypto space, particularly for platforms like Revolut that handle large volumes of digital assets.\n\nParagraph three.";
  const note = findGenericSignificanceFiller(body);
  assert.notEqual(note, null);
  assert.match(note, /raises concerns about/);
});

test("findGenericSignificanceFiller catches the real 'is crucial for' filler (article 775)", () => {
  const body = "Paragraph one.\n\nThis update is crucial for enhancing user experience and transaction efficiency, potentially attracting more users to the Bitcoin network.\n\nParagraph three.";
  const note = findGenericSignificanceFiller(body);
  assert.notEqual(note, null);
  assert.match(note, /relevant\/significant\/important\/critical\/crucial for/);
});

test("findGenericSignificanceFiller catches 'is a positive indicator' (real article 626)", () => {
  const body = "Paragraph one.\n\nThe doubling of the inferred resource is a positive indicator for investors, suggesting enhanced prospects for future development and production in a region with a rich mining history.\n\nParagraph three.";
  assert.notEqual(findGenericSignificanceFiller(body), null);
});

test("findGenericSignificanceFiller does not flag a sentence that names a concrete, specific consequence", () => {
  const body = "Paragraph one.\n\nA continued rise in yields may push mortgage rates above 7% by year end, according to the report.\n\nParagraph three.";
  assert.equal(findGenericSignificanceFiller(body), null);
});

test("findGenericSignificanceFiller returns null for a clean body with no filler constructions", () => {
  assert.equal(findGenericSignificanceFiller("Bitcoin rose 4% to $81,000 after a stronger-than-expected jobs report.\n\nThe move followed a broader rally in risk assets.\n\nTrading volume on major exchanges rose 12% over the same period."), null);
});

test("findStaleForwardLookingDate catches the real Ethereum Glamsterdam stale-date claim (article 184, review status)", () => {
  const body = "Ethereum's Glamsterdam event will take place from September 19 to 21, 2023, amid concerns about unverified builders potentially stalling network operations. The network's client teams will face reduced review time before the Sepolia testnet launch, which could affect transaction processing.\n\nThis announcement is critical for traders as it highlights potential risks to Ethereum's network stability, which could impact transaction fees and processing times during the event.\n\nEthereum developers have cautioned that fake builders using free test ether may outbid legitimate participants, complicating the transaction process. They are implementing measures to address these challenges ahead of the event.";
  const note = findStaleForwardLookingDate(body, new Date("2026-09-18T00:00:00Z"));
  assert.notEqual(note, null, "expected the pending 'September 19 to 21, 2023' event to be caught as stale relative to 2026");
  assert.match(note, /2023/);
});

const REAL_TARIFF_ARTICLE_BODY =
  "Bitcoin is facing a critical test on October 18 as former President Trump prepares to implement new tariffs on Russia. The decision will influence energy markets and could have ripple effects on cryptocurrency valuations.\n\nTraders focused on Bitcoin and other cryptocurrencies may experience heightened volatility as they react to the tariff news and its implications for energy prices and market sentiment.\n\nThe specific rates and targets of the new tariffs have yet to be disclosed, and market analysts are closely monitoring how these developments will affect Bitcoin's performance in the coming weeks.";

test("findStaleRoleAssertion catches the real 'former President Trump prepares to' claim (article 875)", () => {
  const note = findStaleRoleAssertion(REAL_TARIFF_ARTICLE_BODY);
  assert.notEqual(note, null, "expected the incorrect 'former President' title to be caught");
  assert.match(note, /Trump/);
  assert.match(note, /former President/);
});

test("findStaleRoleAssertion does not flag a genuine former-officeholder reference with no active-role verb", () => {
  const body = "Former President Biden spoke at the event, reflecting on his time in office.\n\nSecond paragraph.\n\nThird paragraph.";
  assert.equal(findStaleRoleAssertion(body), null);
});

test("findStaleRoleAssertion does not flag a body with no 'former <title>' construction at all", () => {
  assert.equal(findStaleRoleAssertion("President Trump signed a new executive order today.\n\nSecond paragraph.\n\nThird paragraph."), null);
});

test("findStaleRoleAssertion catches a stale Fed Chair title paired with an active-role verb", () => {
  const body = "Former Fed Chair Warsh is set to announce a new rate decision affecting bond markets.\n\nSecond paragraph.\n\nThird paragraph.";
  const note = findStaleRoleAssertion(body);
  assert.notEqual(note, null);
  assert.match(note, /Warsh/);
});

test("findVagueCrossAssetClaim catches the real vague 'ripple effects on cryptocurrency valuations' claim (article 875)", () => {
  const note = findVagueCrossAssetClaim(REAL_TARIFF_ARTICLE_BODY);
  assert.notEqual(note, null, "expected the mechanism-free ripple-effect claim to be caught");
  assert.match(note, /ripple effect/i);
});

test("findVagueCrossAssetClaim does not flag a ripple-effect claim that names a concrete mechanism", () => {
  const body = "Rising Treasury yields could have ripple effects on Bitcoin as investors rotate toward higher-yield fixed income.\n\nSecond paragraph.\n\nThird paragraph.";
  assert.equal(findVagueCrossAssetClaim(body), null);
});

test("findVagueCrossAssetClaim does not flag a vague phrase with no named other asset", () => {
  const body = "The policy change could have ripple effects across the broader economy in the months ahead.\n\nSecond paragraph.\n\nThird paragraph.";
  assert.equal(findVagueCrossAssetClaim(body), null);
});

test("findVagueCrossAssetClaim returns null for a clean body with no vague cross-asset language", () => {
  assert.equal(findVagueCrossAssetClaim("Bitcoin rose 4% to $81,000 after a stronger-than-expected jobs report.\n\nThe move followed a broader rally in risk assets.\n\nTrading volume on major exchanges rose 12% over the same period."), null);
});

test("stripGenericSignificanceFillerClauses strips only the filler clause, keeping a real fact in the same sentence", () => {
  const body = "Paragraph one.\n\nThis update is crucial for enhancing user experience, adding two new API endpoints.\n\nParagraph three.";
  const stripped = stripGenericSignificanceFillerClauses(body);
  assert.notEqual(stripped, body);
  assert.match(stripped, /API endpoints/);
  assert.doesNotMatch(stripped, /crucial for/i);
  assert.equal(findGenericSignificanceFiller(stripped), null, "the stripped body should no longer trip the filler check");
});

test("stripGenericSignificanceFillerClauses drops the whole sentence when nothing concrete is left", () => {
  const body = "Paragraph one.\n\nThis incident raises concerns about the security of customer data.\n\nParagraph three.";
  const stripped = stripGenericSignificanceFillerClauses(body);
  assert.doesNotMatch(stripped, /raises concerns/i);
  assert.equal(findGenericSignificanceFiller(stripped), null);
});

test("stripGenericSignificanceFillerClauses removes a paragraph entirely rather than leaving an empty gap when its only sentence is dropped", () => {
  const body = "Paragraph one has real content here.\n\nThis incident raises concerns about the security of customer data.\n\nParagraph three has real content too.";
  const stripped = stripGenericSignificanceFillerClauses(body);
  const paragraphs = stripped.split("\n\n");
  assert.equal(paragraphs.length, 2, "the emptied middle paragraph should be removed, not left blank");
  assert.ok(paragraphs.every((p) => p.trim().length > 0));
});

test("stripGenericSignificanceFillerClauses returns the exact same string (by reference-equal value) when nothing is flagged", () => {
  const body = "Bitcoin rose 4% to $81,000 after a stronger-than-expected jobs report.\n\nThe move followed a broader rally in risk assets.";
  assert.equal(stripGenericSignificanceFillerClauses(body), body);
});
