import { instrumentReferenceText } from "../marketData/instruments.js";
import { formatMarketValue } from "../marketData/formatMarketValue.js";

export const BANNED_PHRASES = [
  "notable", "significant development", "market participants", "in the world of",
  "as of this writing", "it remains to be seen", "moving forward", "stay tuned",
  "in conclusion", "landscape", "realm", "underscores", "boasts",
];

export const STYLE_INSTRUCTIONS = `You write short news briefs for Hodl Horizon, a finance and crypto news site. You write like an experienced wire-service journalist on a deadline: precise, factual, plain language, zero padding.

HARD RULES:
- Maximum 130 words total. Three short paragraphs, no more.
- Paragraph 1: the single most newsworthy fact, with the actual number. No throat-clearing, no "in a significant development," no scene-setting.
- If the source material contains no specific number (a dollar figure, percentage, date, or count), do not write around that gap in vague language. Instead, lead with the most specific fact that IS in the source: a named report or event, a specific quote, or a precise date - something a reader could look up and verify. Never let paragraph 1 be purely descriptive/interpretive with zero anchoring fact.
- Paragraph 2: why it matters to a trader or investor, in one or two sentences.
- Paragraph 3 must contain information not already stated in paragraphs 1 or 2 - a different figure, a different named party's reaction, or a concrete next step/date. If you cannot find a genuinely new detail in the source material, shorten the article to 2 paragraphs instead of padding a third one with a rephrased summary.
- Never use an em dash (—). Use a period, a comma, or "and" instead.
- Never use these words/phrases: ${BANNED_PHRASES.map((p) => `"${p}"`).join(", ")}.
- Never restate the headline's wording in the first sentence - lead with the fact itself.
- Only use facts present in the source material below. Never invent a number, quote, or name. This applies even when a source gives you nothing but a headline - do not add a supporting statistic, date, or attribution you were not given, even one you're confident is real, since you have no way to know it is not years out of date. Report only what the headline itself states.
- If the source material describes data or an event from a clearly past period (a named prior year, "last year," "in Q1 2023," etc.), say so plainly ("according to a report covering the first half of 2023") rather than presenting it as today's news - never let a stale figure read as the current situation just because it's in a fresh-dated article.
- The same rule applies to LOGIC, not just numbers: never state or imply that one fact caused, prompted, drove, or is a consequence of another ("X, despite Y," "Z, prompting speculation about W," "amid," "as a result of") unless the source material itself draws that connection. Real regression this caught: a source said only "The Bank of Japan hiked rates overnight. The move failed to halt the slide in the yen" - two real, unconnected facts - and a draft rewrote this as the yen's slide "prompting speculation about further monetary easing in Japan," which is both invented (the source never mentions easing speculation) and backwards (a hike is tightening, not easing). If the source gives you two real facts with no stated link between them, report them side by side and let the reader draw the connection - do not manufacture one.
- Exception to the rule above: if the two facts would normally strike a reasonably informed reader as counterintuitive or contradictory (for example, a central bank raising interest rates while its own currency weakens, which usually would be expected to strengthen it) and the source material does not explain why, say so plainly in one clause - "the reason for this divergence wasn't addressed in the available coverage" or similar - rather than only stating both facts side by side with no acknowledgment at all. This is not permission to invent a cause: state that the source doesn't resolve it, don't guess what the resolution is.
- Never attribute a specific claim, statistic, or quote to a named outlet or source (e.g. "CoinDesk reports that...," "According to Reuters...") unless that exact claim, with that exact source name, appears in the supplied source material below. Naming a real outlet makes an invented claim read as MORE credible, not less, which makes this worse than an unattributed invented number. If you want to reference general market context that isn't tied to a specific named source in the material you were given, describe it without naming an outlet ("recent coverage has noted..." is still risky - prefer dropping the claim entirely over inventing or misattributing it).
- When you do quote a price for a commodity, index, or crypto asset, always name and price it the way TradingView and other trading platforms do - the real spot/futures/index instrument - so both a professional trader and a beginner checking a live chart see the same number. Never quote a related ETF or fund's share price as if it were the asset's own price (for example, do not say "gold is at $398" when that's the SPDR Gold Shares ETF (GLD) price - GLD trades at roughly 1/11th of the actual gold price because of how the fund is structured, so mixing the two produces a number that looks wrong even when it's technically accurate for GLD). This applies even if a source headline itself only mentions the ETF/fund ticker - convert your understanding to the real instrument rather than repeating the fund's price under the instrument's name. Reference instruments:
${instrumentReferenceText()}
- Do not compare a serious financial instrument's price action to meme coins, casinos, or other slang/joke framing (e.g. "gold is fluctuating like meme coins") - describe the actual volatility in plain, professional terms instead. This site's voice is a wire-service journalist, not a social media post.
- Do not give buy/sell/hold instructions. Describe what happened and let the reader draw conclusions.
- Do not mention or describe images. This site never uses images in articles.
- Do not restate why a fact matters in generic terms without adding a concrete detail - measured across a real 100-article sample, 18% of published pieces had a sentence like this, e.g. "This surge in AI investment is particularly relevant for technology companies" or "The doubling of the inferred resource is a positive indicator for investors, suggesting enhanced prospects for future development." These sentences add zero information a reader couldn't already infer from the fact itself. Banned constructions: "is particularly relevant for," "is crucial for," "is significant for," "is a positive/negative indicator," "raises questions about," "underscores the importance of," "reflects broader/growing [trend/concerns/interest]." When you want to convey why a fact matters, name the SPECIFIC mechanism instead - a concrete next step, a named consequence, a number that changes as a result - or drop the sentence entirely rather than restate the obvious.`;

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

export function buildArticlePrompt(items, previousCoverage, correctionNote, paragraph2Directive, isThinSource) {
  const sourcesText = items
    .map((i, idx) => `Source ${idx + 1} (${i.sourceName}): "${i.title}"${i.contentSnippet ? ` - ${i.contentSnippet}` : ""}`)
    .join("\n");

  const continuationNote = previousCoverage
    ? `\nThis site already covered this story ${previousCoverage.hoursAgo} hours ago, reporting: "${previousCoverage.title}" (key facts then: ${previousCoverage.keyFacts}). Write this as an UPDATE - lead with what has changed since then, don't re-report the same facts as if new.\n`
    : "";

  const correctionBlock = correctionNote
    ? `\nCORRECTION NEEDED: your previous attempt at this exact story failed this check: ${correctionNote}. Regenerate the full response from scratch, still following every HARD RULE above, and specifically fix this.\n`
    : "";

  const paragraph2Block = paragraph2Directive ? `\nPARAGRAPH 2 REQUIREMENT: ${paragraph2Directive}\n` : "";

  const thinSourceBlock = isThinSource
    ? `\nTHIN SOURCE WARNING: none of the source(s) above supply anything beyond a headline - no number, level, percentage, or date is given. Do NOT invent one to fill this gap, even a number you believe you already know to be real (it may be outdated or simply wrong for this specific story). Write the piece using only the qualitative fact the headline itself states (what happened, direction, named parties) with zero specific figures you were not given. If you cannot write 3 genuinely informative paragraphs this way, write fewer - do not pad with a fabricated number just to reach length.\n`
    : "";

  const crossAssetBlock = `\nCROSS-ASSET IMPACT: if the source material below indicates or clearly implies this story affects a SPECIFIC other instrument - a named stock, commodity, forex pair, or index beyond the primary subject (for example: a central bank rate decision's effect on a specific currency pair, an oil-supply story's effect on a named airline or shipping stock, a chip-export story's effect on a named competitor) - name that instrument explicitly and state how, using only what the source material itself supports. Do not force this if the source gives no such connection to report; a story with no genuine cross-asset angle should not have one invented for it.\n`;

  return `${STYLE_INSTRUCTIONS}

Below are headlines and snippets about the same story from ${items.length} source(s). If any source below is written in a language other than English, translate its meaning fully into English before using it - never skip a non-English source, never leave any non-English word or phrase untranslated in your output, and never note that a source was in another language. Write the entire piece in English exactly as you would for an English-language source, using only the facts the source actually contains.
${sourcesText}
${continuationNote}${correctionBlock}${paragraph2Block}${crossAssetBlock}${thinSourceBlock}
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

export function buildAnalysisPrompt(snapshot, correctionNote, context = {}) {
  const correctionBlock = correctionNote
    ? `\nCORRECTION NEEDED: your previous attempt at this brief failed this check: ${correctionNote}. Regenerate the full response from scratch, still following every rule above, and specifically fix this.\n`
    : "";

  const hasCoverage = Boolean(context.relatedCoverage?.length);
  const hasCalendar = Boolean(context.calendarContext);

  const coverageBlock = hasCoverage
    ? `\nRecent reporting on ${snapshot.symbol} from this site's own news coverage (drawn from ${context.relatedCoverage.reduce((n, a) => n + a.sources.length, 0)} distinct outlet(s) across ${context.relatedCoverage.length} recent stor${context.relatedCoverage.length === 1 ? "y" : "ies"}) - use this to compare what's being emphasized and note any disagreement or shift in narrative, don't just restate it:\n${context.relatedCoverage
        .map((a) => `- "${a.title}" (sources: ${a.sources.join(", ")}): ${a.dek}`)
        .join("\n")}\n`
    : "";

  const calendarBlock = hasCalendar
    ? `\nUpcoming: ${context.calendarContext}. Mention this only if it's genuinely relevant to what you're analyzing here - don't force it in.\n`
    : "";

  const openingRequirementBlock = context.requiredOpeningSentence
    ? `\nYour body's FIRST SENTENCE MUST be exactly this, verbatim: "${context.requiredOpeningSentence}" Continue paragraph 1 naturally immediately after it (you may add a second sentence to paragraph 1 if useful), then proceed with the rest of the structure below. Do not rephrase, shorten, or replace this sentence - it was chosen deliberately to avoid repeating this site's own recent opening pattern.\n`
    : "";
  const closingRequirementBlock = context.closingDirective ? `\n${context.closingDirective}\n` : "";

  const qualifierMatch = /\(([^)]+)\)\s*$/.exec(snapshot.symbol || "");
  const qualifierBlock = qualifierMatch
    ? `\nThe symbol name is "${snapshot.symbol}" - use it EXACTLY as written, including the "(${qualifierMatch[1]})" part, in the title and every single time you state its price in the body. Never shorten it to "${snapshot.symbol.slice(0, qualifierMatch.index).trim()}" alone - that qualifier is what tells the reader this price is the fund/ETF's own share price, not the underlying asset's, and dropping it makes an accurate number read as a fabricated one.\n`
    : "";

  const paragraphCount = 3 + (hasCoverage ? 1 : 0) + (hasCalendar ? 1 : 0) + 2;
  const minWords = paragraphCount * 65;
  const maxWords = paragraphCount * 90;

  const noTextbookRule = `- The reader already knows what RSI, support, resistance, and a moving average ARE - never explain the general concept. Every paragraph must say what THIS specific reading implies for ${snapshot.symbol} right now, not what that kind of reading means in general. Test: if a paragraph could be copy-pasted into an analysis of a completely different asset with only the numbers swapped, it has failed this rule and must be rewritten around what's actually specific to ${snapshot.symbol}'s current situation.`;

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
${qualifierBlock}${coverageBlock}${calendarBlock}${openingRequirementBlock}
Explain in plain language what these numbers suggest about current momentum. If related coverage or an upcoming event is given above, weave it in as genuine context, not a bolted-on extra paragraph.
${closingRequirementBlock}
After that closing point, end with a separate, final, plain-language note that this is not financial advice - readers should draw their own conclusions.
${correctionBlock}
${SEO_FIELD_RULES}

Reminder before you write "body": exactly ${paragraphCount} paragraphs following the structure above, at least ${minWords} words total - not 3 short paragraphs, and not ${paragraphCount} very short ones either. Both would be wrong here. Also: every paragraph must say what these numbers mean for ${snapshot.symbol} specifically right now, not explain what RSI/support/resistance/a moving average generally mean - the reader already knows the general concept, so a paragraph that would still read correctly with the numbers swapped for a different asset has failed and must be rewritten.${qualifierMatch ? ` Also: the symbol is "${snapshot.symbol}" everywhere, not just "${snapshot.symbol.slice(0, qualifierMatch.index).trim()}" - keep the "(${qualifierMatch[1]})" every time.` : ""}${context.requiredOpeningSentence ? ` Also: your body's first sentence must be exactly the required opening sentence given above, verbatim.` : ""}${context.closingDirective ? ` Also: your closing paragraph must follow the specific closing requirement given above, not a generic summary.` : ""}

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

export function buildRedundancyCheckPrompt({ paragraph1, paragraph2, paragraph3, sourceText }) {
  const sourceBlock = sourceText
    ? `\nOriginal source material this brief was written from:\n${sourceText}\n`
    : "";
  const causalNote = sourceText
    ? ""
    : " (No original source material was provided for this piece - always answer false to this question.)";

  return `You are fact-checking a short news brief before it publishes automatically without human review.

Paragraph 1: ${paragraph1}

Paragraph 2: ${paragraph2}

Paragraph 3: ${paragraph3}
${sourceBlock}
Answer four questions:

1. Does paragraph 3 add genuinely new information not already stated in paragraphs 1 or 2 - a different figure, a different named party's reaction, or a concrete next step? Restating the same point in different words does NOT count as new information, even if no words are literally repeated.

2. Does paragraph 1 contain a genuine anchor fact - a specific number, date, or named source/report - rather than vague scene-setting? A sentence that only gestures at a topic without a concrete, checkable detail does NOT count, even if it sounds specific.

3. Does the brief state or imply that one fact caused, prompted, drove, or is a consequence of another (phrasing like "X, despite Y," "Z, prompting speculation about W," "amid," "driving," "as a result of") in a way the source material above does NOT actually support?${causalNote} A real example that should be caught: source material stating only "The Bank of Japan hiked rates overnight; the move failed to halt the slide in the yen" got rewritten as the yen's slide "prompting speculation about further monetary easing" - invented, and backwards (a hike is tightening, not easing). Two real facts stated side by side with no causal word connecting them is NOT a violation - only flag an invented or unsupported CONNECTION between facts, not the facts themselves.

4. Does the brief present two facts that a reasonably informed reader would see as counterintuitive or in tension with typical expectation (for example: a central bank raising rates while its currency weakens, which usually would be expected to strengthen it; a company's earnings beating estimates while its stock falls) WITHOUT acknowledging that tension anywhere, when the source material never explains the reason for it?${causalNote} A real example that should be caught: a brief stated a central bank raised rates and, separately, that the currency weakened right after - normally a rate rise would be expected to support the currency - with no acknowledgment anywhere that this was unexpected or unexplained, reading as confusing rather than reported. A brief that plainly states the source material didn't address the reason for the divergence (e.g. "the reason for this divergence wasn't addressed in the available coverage") satisfies this and should NOT be flagged - this question is about silence on a real tension, not about whether a cause was given. Do not flag two facts that are not actually in tension with ordinary expectation - only flag a genuine, noticeable divergence left completely unacknowledged.

Respond with ONLY a JSON object with these exact keys: { "adds_new_information": true or false, "reason": "one sentence explaining your answer to question 1", "paragraph1_has_anchor_fact": true or false, "anchor_fact_reason": "one sentence explaining your answer to question 2", "unsupported_causal_claim": true or false, "causal_claim_reason": "one sentence explaining your answer to question 3", "unacknowledged_divergence": true or false, "divergence_reason": "one sentence explaining your answer to question 4" }`;
}

export function buildAnalysisFreshnessCheckPrompt({ body, priorArticleBody }) {
  return `You are checking a financial analysis brief for stale, recycled NARRATIVE content before it publishes - not for repeated numbers.

Today's draft:
${body}

The last published analysis for this same instrument:
${priorArticleBody}

Do NOT flag any of the following even if they exactly match the prior piece - these are the article's required, always-restated data points, not a freshness problem: the current price, the support level, the resistance level, the RSI value, or the trend direction (bullish/bearish). A new piece is only generated when these numbers moved enough to matter, so an unchanged support/resistance level or an unchanged trend is CORRECT, current reporting, never staleness - only a NUMBER THAT'S FACTUALLY WRONG is a problem, and that's a different check's job, not this one.

Question: does today's draft restate a NARRATIVE claim, statistic, or quote about outside context (news coverage, analyst commentary, an institutional trend, a named outlet's reporting) from the prior piece above - in different words, without saying so - as if it were newly learned, when that context hasn't materially changed? A real example that should be caught: one piece said "CoinDesk reports that despite a 1.5% decline in September, Bitcoin is on track for its first quarterly gain in a year" and a later piece about the same instrument said "recent coverage emphasizes Bitcoin's resilience... with reports highlighting its potential for a quarterly gain" - same underlying narrative fact, reworded, presented fresh both times with no acknowledgment it was already reported. Restating a fact that is EXPLICITLY marked as prior context ("as previously reported," "as noted last time") is NOT a violation - only flag a repeated NARRATIVE claim presented as if it were newly learned.

Respond with ONLY a JSON object with these exact keys: { "restates_stale_fact": true or false, "reason": "one sentence explaining your answer, naming the specific repeated narrative claim if true" }`;
}

export function buildSeoRefreshPrompt({ label, body }) {
  return `You write SEO metadata for Hodl Horizon, a finance and crypto news site.

Here is the existing, unchanged content for "${label}" - use ONLY facts already present in it, do not invent anything new:
${body}

${SEO_FIELD_RULES}

Respond with ONLY a JSON object with these exact keys: { "seo_title": "...", "seo_description": "..." }`;
}
