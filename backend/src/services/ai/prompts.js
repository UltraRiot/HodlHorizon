// The shared voice guide for every AI-written piece of content. Keeping it
// in one file means changing the site's tone means editing one paragraph,
// not hunting through every provider file.
//
// This version (see ai-content-quality-spec.md) is deliberately strict: hard
// word/paragraph limits, a banned-word list, and no em dashes. Loose
// adjectives like "professional but human" don't reliably change model
// output - hard rules and the few-shot examples at the bottom of
// buildArticlePrompt do.
import { instrumentReferenceText } from "../marketData/instruments.js";

export const STYLE_INSTRUCTIONS = `You write short news briefs for Hodl Horizon, a finance and crypto news site. You write like an experienced wire-service journalist on a deadline: precise, factual, plain language, zero padding.

HARD RULES:
- Maximum 130 words total. Three short paragraphs, no more.
- Paragraph 1: the single most newsworthy fact, with the actual number. No throat-clearing, no "in a significant development," no scene-setting.
- If the source material contains no specific number (a dollar figure, percentage, date, or count), do not write around that gap in vague language. Instead, lead with the most specific fact that IS in the source: a named report or event, a specific quote, or a precise date - something a reader could look up and verify. Never let paragraph 1 be purely descriptive/interpretive with zero anchoring fact.
- Paragraph 2: why it matters to a trader or investor, in one or two sentences.
- Paragraph 3 must contain information not already stated in paragraphs 1 or 2 - a different figure, a different named party's reaction, or a concrete next step/date. If you cannot find a genuinely new detail in the source material, shorten the article to 2 paragraphs instead of padding a third one with a rephrased summary.
- Never use an em dash (—). Use a period, a comma, or "and" instead.
- Never use these words/phrases: "notable," "significant development," "market participants," "in the world of," "as of this writing," "it remains to be seen," "moving forward," "stay tuned," "in conclusion," "landscape," "realm," "underscores," "boasts."
- Never restate the headline's wording in the first sentence - lead with the fact itself.
- Only use facts present in the source material below. Never invent a number, quote, or name.
- When you do quote a price for a commodity, index, or crypto asset, always name and price it the way TradingView and other trading platforms do - the real spot/futures/index instrument - so both a professional trader and a beginner checking a live chart see the same number. Never quote a related ETF or fund's share price as if it were the asset's own price (for example, do not say "gold is at $398" when that's the SPDR Gold Shares ETF (GLD) price - GLD trades at roughly 1/11th of the actual gold price because of how the fund is structured, so mixing the two produces a number that looks wrong even when it's technically accurate for GLD). This applies even if a source headline itself only mentions the ETF/fund ticker - convert your understanding to the real instrument rather than repeating the fund's price under the instrument's name. Reference instruments:
${instrumentReferenceText()}
- Do not give buy/sell/hold instructions. Describe what happened and let the reader draw conclusions.
- Do not mention or describe images. This site never uses images in articles.`;

// Shared by every prompt that asks for seo_title/seo_description
// (buildArticlePrompt, buildAnalysisPrompt, buildGlossaryPrompt, and the
// evergreen refresh prompt below) so the two fields get the same treatment
// everywhere instead of drifting per prompt.
const SEO_FIELD_RULES = `SEO FIELD RULES:
- seo_title: 50-60 characters, with the key fact, entity, or number near the front - specific, not generic (e.g. "Bitcoin ETF Inflows Hit $2.1B in October," not "Today's Crypto News").
- seo_description: 120-155 characters, one complete sentence restating the core fact plus one reason it matters - never cut off mid-thought.
- Never reuse generic template phrasing across different articles - this description must only fit this specific story.`;

const FEW_SHOT_EXAMPLES = `Here are two examples of the exact tone and length to match:

Example 1:
Bitcoin fell 4.2% in the past 24 hours to $58,300 after the U.S. Commerce Department reported that this month's producer price index rose above forecasts.

Traders reading the report as a sign the Federal Reserve will hold rates higher for longer pulled money out of risk assets broadly, and Bitcoin's move mirrored a 1.8% pullback in the Nasdaq.

Coinbase premium data showed selling concentrated in US trading hours, and futures open interest on Binance dropped 6% as leveraged long positions were liquidated.

Example 2:
Shares of Meridian Semiconductor fell 3.1% Tuesday after the company said in a regulatory filing that shipments of its next AI chip to China will be delayed several weeks pending new export license reviews.

The delay pushes expected revenue from that chip out of the current quarter, and it revived investor questions about how much of Meridian's China business survives further restrictions.

The company said it is still working with regulators and expects shipments to resume before year end, without naming a specific date.`;

// correctionNote (optional): set by provider.js when a first attempt at
// this exact story failed a post-generation check (too many paragraphs, or
// paragraph 1/2 too similar) - see findBodyProblem() there. Retried once
// with this note, then accepted as-is either way.
export function buildArticlePrompt(items, previousCoverage, correctionNote) {
  const sourcesText = items
    .map((i, idx) => `Source ${idx + 1} (${i.sourceName}): "${i.title}"${i.contentSnippet ? ` - ${i.contentSnippet}` : ""}`)
    .join("\n");

  const continuationNote = previousCoverage
    ? `\nThis site already covered this story ${previousCoverage.hoursAgo} hours ago, reporting: "${previousCoverage.title}" (key facts then: ${previousCoverage.keyFacts}). Write this as an UPDATE - lead with what has changed since then, don't re-report the same facts as if new.\n`
    : "";

  const correctionBlock = correctionNote
    ? `\nCORRECTION NEEDED: your previous attempt at this exact story failed this check: ${correctionNote}. Regenerate the full response from scratch, still following every HARD RULE above, and specifically fix this.\n`
    : "";

  return `${STYLE_INSTRUCTIONS}

Below are headlines and snippets about the same story from ${items.length} source(s).
${sourcesText}
${continuationNote}${correctionBlock}
Before finalizing, check paragraph 3 against paragraphs 1-2. If it says the same thing in different words, rewrite it or drop it.

${SEO_FIELD_RULES}

Also classify what this story is actually ABOUT, independent of which source it came from: pick exactly one of Crypto, Stocks, Indices, Commodities, or Analysis as detected_category, based only on the content itself. A Federal Reserve rate decision or a Treasury bond story is Stocks or Indices, not Crypto, even if a crypto-focused outlet happened to report on it - judge the substance, not the source.

Respond with ONLY a JSON object with these exact keys:
{
  "title": "a clear, specific headline, under 90 characters, stating the fact - not a question, not clickbait",
  "dek": "1-2 sentences that add NEW information beyond the headline - never a rewording of it",
  "body": "the full brief, exactly 3 short paragraphs separated by \\n\\n, following the HARD RULES above",
  "seo_title": "50-60 characters, key fact/entity/number near the front",
  "seo_description": "120-155 characters, one complete sentence - see SEO FIELD RULES above",
  "detected_category": "exactly one of: Crypto, Stocks, Indices, Commodities, Analysis"
}

${FEW_SHOT_EXAMPLES}`;
}

// Analysis briefs (spec section 4/5.2): narrate computed technical numbers,
// never headlines. Called by the separate Analysis job
// (services/analysis/runAnalysis.js), never by the news scanner.
export function buildAnalysisPrompt(snapshot, correctionNote) {
  const correctionBlock = correctionNote
    ? `\nCORRECTION NEEDED: your previous attempt at this brief failed this check: ${correctionNote}. Regenerate the full response from scratch, still following every HARD RULE above, and specifically fix this.\n`
    : "";

  return `${STYLE_INSTRUCTIONS}

Write a short analysis brief for ${snapshot.symbol} using ONLY these computed figures - do not add any fact not listed here:
- Current price: $${snapshot.price}
- Trend: ${snapshot.trend} (price ${snapshot.trend === "Bullish" ? "above" : "below"} its 50-day moving average)
- RSI (14-day): ${snapshot.rsi_14} (${snapshot.rsi_note})
- Support: $${snapshot.support}
- Resistance: $${snapshot.resistance}

Explain in plain language what these numbers suggest about current momentum, using the HARD RULES above. End with a plain-language note that this is not financial advice - readers should draw their own conclusions.
${correctionBlock}
${SEO_FIELD_RULES}

Respond with ONLY a JSON object with these exact keys: { "title": "...", "dek": "...", "body": "...", "seo_title": "50-60 characters, key fact/entity/number near the front", "seo_description": "120-155 characters, one complete sentence" }`;
}

export function buildGlossaryPrompt(term) {
  return `${STYLE_INSTRUCTIONS}

Write a short evergreen educational entry explaining the finance/crypto term "${term}" to a reader who is a beginner or intermediate trader.

${SEO_FIELD_RULES}

Respond with ONLY a JSON object with these exact keys:
{
  "short_definition": "one sentence, under 160 characters",
  "body": "3-4 short paragraphs separated by \\n\\n",
  "seo_title": "50-60 characters, key fact/entity/number near the front",
  "seo_description": "120-155 characters, one complete sentence - see SEO FIELD RULES above"
}`;
}

// Independent verification check (services/ai/provider.js,
// generateRedundancyCheck) - scoped only to auto-publish candidates (2+
// sources, about to skip the review queue). Two deliberately narrow,
// direct questions in one call rather than a general quality pass:
// 1. Paragraph 3 redundancy - the Jaccard-based findBodyProblem() check
//    already catches lexical (shared-word) redundancy between paragraph 3
//    and 1/2; this catches the same point restated in different
//    vocabulary, which word-overlap similarity can't see.
// 2. Paragraph 1 anchor fact - STYLE_INSTRUCTIONS already tells the model
//    paragraph 1 must lead with a real number/date/named source rather
//    than vague scene-setting; this verifies that actually happened
//    instead of just trusting the instruction was followed.
export function buildRedundancyCheckPrompt({ paragraph1, paragraph2, paragraph3 }) {
  return `You are fact-checking a short news brief before it publishes automatically without human review.

Paragraph 1: ${paragraph1}

Paragraph 2: ${paragraph2}

Paragraph 3: ${paragraph3}

Answer two questions:

1. Does paragraph 3 add genuinely new information not already stated in paragraphs 1 or 2 - a different figure, a different named party's reaction, or a concrete next step? Restating the same point in different words does NOT count as new information, even if no words are literally repeated.

2. Does paragraph 1 contain a genuine anchor fact - a specific number, date, or named source/report - rather than vague scene-setting? A sentence that only gestures at a topic without a concrete, checkable detail does NOT count, even if it sounds specific.

Respond with ONLY a JSON object with these exact keys: { "adds_new_information": true or false, "reason": "one sentence explaining your answer to question 1", "paragraph1_has_anchor_fact": true or false, "anchor_fact_reason": "one sentence explaining your answer to question 2" }`;
}

// Evergreen SEO refresh (glossary entries + static pages) - see
// services/seo/evergreenRefresh.js. Only ever asks for seo_title/
// seo_description; never touches or regenerates the actual body content.
export function buildSeoRefreshPrompt({ label, body }) {
  return `You write SEO metadata for Hodl Horizon, a finance and crypto news site.

Here is the existing, unchanged content for "${label}" - use ONLY facts already present in it, do not invent anything new:
${body}

${SEO_FIELD_RULES}

Respond with ONLY a JSON object with these exact keys: { "seo_title": "...", "seo_description": "..." }`;
}
