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
import { formatMarketValue } from "../marketData/formatMarketValue.js";

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
- Only use facts present in the source material below. Never invent a number, quote, or name. This applies even when a source gives you nothing but a headline - do not add a supporting statistic, date, or attribution you were not given, even one you're confident is real, since you have no way to know it is not years out of date. Report only what the headline itself states.
- If the source material describes data or an event from a clearly past period (a named prior year, "last year," "in Q1 2023," etc.), say so plainly ("according to a report covering the first half of 2023") rather than presenting it as today's news - never let a stale figure read as the current situation just because it's in a fresh-dated article.
- When you do quote a price for a commodity, index, or crypto asset, always name and price it the way TradingView and other trading platforms do - the real spot/futures/index instrument - so both a professional trader and a beginner checking a live chart see the same number. Never quote a related ETF or fund's share price as if it were the asset's own price (for example, do not say "gold is at $398" when that's the SPDR Gold Shares ETF (GLD) price - GLD trades at roughly 1/11th of the actual gold price because of how the fund is structured, so mixing the two produces a number that looks wrong even when it's technically accurate for GLD). This applies even if a source headline itself only mentions the ETF/fund ticker - convert your understanding to the real instrument rather than repeating the fund's price under the instrument's name. Reference instruments:
${instrumentReferenceText()}
- Do not compare a serious financial instrument's price action to meme coins, casinos, or other slang/joke framing (e.g. "gold is fluctuating like meme coins") - describe the actual volatility in plain, professional terms instead. This site's voice is a wire-service journalist, not a social media post.
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

// Overrides STYLE_INSTRUCTIONS' "3 short paragraphs / 130 words" limit for
// Analysis specifically - this is the one category meant to read as real
// depth rather than a headline blurb (see the content-strategy note this
// was added under), so it needs its own length rule instead of inheriting
// the news brief's. Everything else in STYLE_INSTRUCTIONS still applies
// (voice, banned words, no em dash, never invent a number).
//
// A first version of this just said "write 5-7 paragraphs" as one bullet
// point below STYLE_INSTRUCTIONS' own "three paragraphs" hard rule - live
// testing (real OpenAI calls) showed that instruction alone consistently
// lost to the earlier, more specific one: every real draft came back at
// exactly 3 paragraphs / ~130-170 words regardless. A concrete
// paragraph-by-paragraph outline (built dynamically below based on what
// context is actually available) gives the model somewhere specific to
// put the extra length instead of an abstract count to hit, and repeating
// the requirement immediately before the output-format instruction (where
// models weight recent context more heavily) is what actually got real
// output to 5-7 paragraphs in testing.
function buildAnalysisOutline(hasCoverage, hasCalendar) {
  const steps = [
    "1. The current price and trend, stated plainly (this can be short).",
    "2. What the RSI reading suggests about momentum right now - overbought/oversold/neutral, and what that has tended to precede.",
    "3. The support and resistance levels: what breaking either would signal, and how far price currently sits from each.",
  ];
  let n = 4;
  if (hasCoverage) steps.push(`${n++}. Compare what the recent related coverage below is emphasizing - agreement or disagreement between outlets, a detail one covers that another doesn't.`);
  if (hasCalendar) steps.push(`${n++}. The upcoming event below, if and only if it's genuinely relevant to this asset - how it could move these specific levels.`);
  steps.push(`${n++}. A synthesis paragraph: what these numbers together (not any single one in isolation) suggest about likely near-term conditions.`);
  steps.push(`${n}. The not-financial-advice disclaimer.`);
  return steps.join("\n");
}

// Analysis briefs (spec section 4/5.2): narrate computed technical numbers,
// never headlines. Called by the separate Analysis job
// (services/analysis/runAnalysis.js), never by the news scanner.
//
// context (optional): { relatedCoverage, calendarContext } - see
// runAnalysis.js's findRelatedCoverage()/findUpcomingHighImpactEvent() for
// where these come from. Both are additive: with neither, this still
// produces a valid, complete Analysis piece from the snapshot alone (the
// original behavior) - they're only appended when there's genuinely
// something real to add, never invented to pad length.
export function buildAnalysisPrompt(snapshot, correctionNote, context = {}) {
  const correctionBlock = correctionNote
    ? `\nCORRECTION NEEDED: your previous attempt at this brief failed this check: ${correctionNote}. Regenerate the full response from scratch, still following every rule above, and specifically fix this.\n`
    : "";

  const hasCoverage = Boolean(context.relatedCoverage?.length);
  const hasCalendar = Boolean(context.calendarContext);

  // Real published coverage from this site's own news categories (not a
  // second live fetch - see runAnalysis.js) about the same asset, when
  // 2+ independently-sourced articles exist recently. This is the actual
  // differentiator versus a plain rewrite: comparing what different
  // outlets are reporting, not just citing how many there are.
  const coverageBlock = hasCoverage
    ? `\nRecent reporting on ${snapshot.symbol} from this site's own news coverage (drawn from ${context.relatedCoverage.reduce((n, a) => n + a.sources.length, 0)} distinct outlet(s) across ${context.relatedCoverage.length} recent stor${context.relatedCoverage.length === 1 ? "y" : "ies"}) - use this to compare what's being emphasized and note any disagreement or shift in narrative, don't just restate it:\n${context.relatedCoverage
        .map((a) => `- "${a.title}" (sources: ${a.sources.join(", ")}): ${a.dek}`)
        .join("\n")}\n`
    : "";

  // A genuinely imminent high-impact macro event - only included when one
  // exists within the next few days (see runAnalysis.js), so this never
  // shows up as filler on a piece where there's nothing upcoming worth
  // flagging.
  const calendarBlock = hasCalendar
    ? `\nUpcoming: ${context.calendarContext}. Mention this only if it's genuinely relevant to what you're analyzing here - don't force it in.\n`
    : "";

  // Live testing caught the exact regression a prior commit fixed for the
  // news pipeline: a real "Gold (GLD)" Analysis piece came back titled and
  // worded as plain "Gold" throughout, with "$398.45" (GLD's ETF share
  // price) stated as if it were spot gold (~$4,300s) - the qualifier that
  // makes that number honest instead of wrong was simply dropped. Passing
  // snapshot.symbol into the prompt text was not enough on its own; the
  // model needs to be told explicitly that the qualifier is not optional
  // decoration. Only fires for a symbol that actually has one - "BTC" or
  // "S&P 500" have nothing to preserve here. See findMissingQualifier()
  // below for the post-generation check backing this up - this instruction
  // alone is not trusted to hold, the same lesson STYLE_INSTRUCTIONS'
  // ETF-price rule already teaches (the model dropped that once too).
  const qualifierMatch = /\(([^)]+)\)\s*$/.exec(snapshot.symbol || "");
  const qualifierBlock = qualifierMatch
    ? `\nThe symbol name is "${snapshot.symbol}" - use it EXACTLY as written, including the "(${qualifierMatch[1]})" part, in the title and every single time you state its price in the body. Never shorten it to "${snapshot.symbol.slice(0, qualifierMatch.index).trim()}" alone - that qualifier is what tells the reader this price is the fund/ETF's own share price, not the underlying asset's, and dropping it makes an accurate number read as a fabricated one.\n`
    : "";

  const paragraphCount = 3 + (hasCoverage ? 1 : 0) + (hasCalendar ? 1 : 0) + 2;
  const minWords = paragraphCount * 65;
  const maxWords = paragraphCount * 90;

  // Live testing (real OpenAI calls) surfaced a second failure mode after
  // the paragraph-count one above was fixed: the model hit exactly
  // ${paragraphCount} paragraphs but wrote them short (~35 words each,
  // ~200 words total) - well under minWords, and short enough that
  // read_minutes (Math.max(1, round(wordCount/200)), same formula as
  // every other category) still rounded to "1 min read," identical to a
  // news blurb, defeating the actual point of this being a longer format.
  // Stating the word floor as its own blunt, repeated line (not just
  // buried inside the paragraph-count bullet above) is what fixed it in
  // testing - a single combined instruction was easy for the model to
  // satisfy on the paragraph-count half while quietly shortchanging the
  // word-count half.
  // Real published regression that motivated this bullet: a live Gold piece
  // read "The 14-day Relative Strength Index (RSI) stands at 43, placing
  // gold in the neutral zone... This reading implies that the asset is
  // neither overbought nor oversold, which historically precedes a period
  // of consolidation or potential price movement in either direction." -
  // every clause there is true of ANY asset with an RSI of 43, stated
  // nowhere specific to gold. The existing "don't pad with generic filler"
  // bullet only names vague filler phrases ("markets remain volatile"), so
  // a textbook definition sailed through untouched - it's specific-sounding
  // prose, just not specific to the asset. This is a different failure mode
  // and needs its own explicit rule, not a rewording of the filler one.
  const noTextbookRule = `- The reader already knows what RSI, support, resistance, and a moving average ARE - never explain the general concept. Every paragraph must say what THIS specific reading implies for ${snapshot.symbol} right now, not what that kind of reading means in general. Test: if a paragraph could be copy-pasted into an analysis of a completely different asset with only the numbers swapped, it has failed this rule and must be rewritten around what's actually specific to ${snapshot.symbol}'s current situation.`;

  // The abstract rule above, alone, was tested against real OpenAI output
  // and did not hold - two fresh live drafts (Bitcoin, Ethereum) both still
  // produced textbook RSI paragraphs after it was added ("This neutral
  // reading suggests that there is no immediate overbought or oversold
  // condition, which often precedes price corrections or rallies" - true
  // of any asset at RSI 54, nothing Bitcoin-specific in it). This file's
  // own opening comment already documents the fix for exactly this
  // pattern: "loose adjectives... don't reliably change model output -
  // hard rules and the few-shot examples... do." A concrete BAD/GOOD
  // contrast, not another rephrased rule, is what's actually shown to work
  // here - GOOD is built from this call's real snapshot numbers so the
  // model has an on-topic template for THIS asset, not a generic sample.
  const noTextbookExample = `Concrete example of this exact failure, from real published output (never repeat this pattern):
BAD (textbook definition - this sentence is true of any asset with this RSI, nothing here is specific to the asset): "The 14-day RSI stands at 43, placing the asset in the neutral zone. This reading implies that the asset is neither overbought nor oversold, which historically precedes a period of consolidation or potential price movement in either direction."
GOOD (states what this reading means for this asset, right now, at its real numbers): "${snapshot.symbol}'s RSI of ${snapshot.rsi_14} shows momentum has cooled from the push that carried it toward ${formatMarketValue(snapshot.resistance, snapshot.assetClass)}, without falling far enough to flag the kind of oversold reading that's preceded its sharper pullbacks - there's no exhaustion signal in either direction at ${formatMarketValue(snapshot.price, snapshot.assetClass)} right now."
Hold every paragraph in this piece to the GOOD standard above, not just the RSI one - state the specific implication for ${snapshot.symbol} at ${formatMarketValue(snapshot.price, snapshot.assetClass)}, never the general rule a textbook would give for any asset in this position.`;

  const lengthOverride = `LENGTH OVERRIDE FOR THIS PIECE (ignore the "Maximum 130 words / three paragraphs" rule above entirely - it's for news briefs, not Analysis, and does not apply here):
- Write exactly ${paragraphCount} paragraphs.
- The body must be at least ${minWords} words, ideally ${minWords}-${maxWords}. A short news-brief-length answer (under 200 words) fails this instruction even if the paragraph count is right - each paragraph below needs real, specific development (multiple sentences), not one short sentence each.
- Follow this structure, one paragraph per step (a step can be short if it genuinely has little to add, but should still be a real sentence or two, not skipped or merged with another step):
${buildAnalysisOutline(hasCoverage, hasCalendar)}
- Do not pad length with generic filler ("markets remain volatile," "investors should stay alert") to hit the word count - every added sentence should say something specific and real about these numbers or the context given, not restate the same point in more words.
${noTextbookRule}

${noTextbookExample}`;

  return `${STYLE_INSTRUCTIONS}

${lengthOverride}

Write an analysis brief for ${snapshot.symbol}. Use ONLY these computed figures for any number you state about price, trend, RSI, support, or resistance - do not invent or adjust any of them, and do not state a different number for any of these than the one given here:
- Current price: ${formatMarketValue(snapshot.price, snapshot.assetClass)}
- Trend: ${snapshot.trend} (price ${snapshot.trend === "Bullish" ? "above" : "below"} its 50-day moving average)
- RSI (14-day): ${snapshot.rsi_14} (${snapshot.rsi_note})
- Support: ${formatMarketValue(snapshot.support, snapshot.assetClass)}
- Resistance: ${formatMarketValue(snapshot.resistance, snapshot.assetClass)}
${qualifierBlock}${coverageBlock}${calendarBlock}
Explain in plain language what these numbers suggest about current momentum. If related coverage or an upcoming event is given above, weave it in as genuine context, not a bolted-on extra paragraph. End with a plain-language note that this is not financial advice - readers should draw their own conclusions.
${correctionBlock}
${SEO_FIELD_RULES}

Reminder before you write "body": exactly ${paragraphCount} paragraphs following the structure above, at least ${minWords} words total - not 3 short paragraphs, and not ${paragraphCount} very short ones either. Both would be wrong here. Also: every paragraph must say what these numbers mean for ${snapshot.symbol} specifically right now, not explain what RSI/support/resistance/a moving average generally mean - the reader already knows the general concept, so a paragraph that would still read correctly with the numbers swapped for a different asset has failed and must be rewritten.${qualifierMatch ? ` Also: the symbol is "${snapshot.symbol}" everywhere, not just "${snapshot.symbol.slice(0, qualifierMatch.index).trim()}" - keep the "(${qualifierMatch[1]})" every time.` : ""}

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
