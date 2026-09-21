// Fixed-variety, code-chosen explanatory framings for News paragraph 2 -
// the same "give it fixed variety and let code choose" mechanism already
// proven for Analysis's opening/closing templates (analysisTemplates.js),
// applied here after a real manual read found paragraph 2 leaning on one
// of two shapes almost every time: either the exact "This [noun]
// highlights/indicates/suggests..." regex (now caught separately by
// findFormulaicParagraphTransition, provider.js) or a broader, harder-to-
// regex "restate as significant, then hedge vaguely about downstream
// impact" pattern - "...which could impact global markets," "...potentially
// reducing volatility," "...which could deter investors" (real examples:
// articles #429, #231, #237). A second regex chasing the reworded version
// of the same problem is the wrong fix, the exact lesson analysisTemplates.js
// already documents for Analysis's opening/closing repetition: the model
// reaching for a hedge template by default isn't a phrasing bug a
// blocklist can chase forever, it's an absence of a concrete alternative
// to reach for instead. Forcing a specific, concrete explanatory shape
// removes the option to fall back on a vague hedge.
//
// Deliberately 4 framings, not the 5 originally proposed - "explicit not
// yet clear when the source doesn't resolve it" is NOT included here as a
// 5th rotating choice, because unlike the 4 below it isn't safe to force
// onto an arbitrary article: it's only ever correct on the subset of
// stories that actually contain a genuine, source-unexplained tension
// (see the real #429 case, provider.js's findUnacknowledgedDivergence
// handling). Forcing it onto an unrelated article would just be a
// different kind of fabrication - asserting a gap exists when it doesn't.
// That case is handled as content-aware behavior instead (an independent
// LLM check plus a STYLE_INSTRUCTIONS rule), not a template forced
// regardless of whether it applies.
//
// Every instruction below explicitly forbids inventing the comparison/
// stakeholder/precedent/implication if the source material doesn't
// support one - consistent with this codebase's one non-negotiable rule
// across every prompt: never fabricate to satisfy a structural
// requirement (see STYLE_INSTRUCTIONS' own "never invent a number, quote,
// or name").
//
// ANTI_HEDGE_PREFIX added after real verification (a fresh 30-article
// batch, all 4 categories) found the directives below cut the exact
// regex-detectable "This X highlights..." pattern from 25% to 6.7%, but a
// closer read showed the model was falling back on synonymous vague-hedge
// phrasing that evades that specific verb list - "This underperformance
// MAY SIGNAL investor concerns," "This stance ALIGNS WITH ongoing
// debates," real article #490's "This situation IS CRITICAL for traders" -
// almost always inside each directive's own thin-source fallback clause
// ("if the source gives you nothing... state the significance plainly"),
// which had no constraint against reaching for a generic hedge verb once
// a directive's specific requirement couldn't be met. Naming the
// discovered phrases explicitly, the same corpus-mining-then-ban approach
// CLOSING_ANTI_PATTERN_PREFIX (analysisTemplates.js) already proved for
// Analysis's closing-paragraph repetition, rather than trying to regex a
// pattern that keeps mutating.
const ANTI_HEDGE_PREFIX = `Do not connect this fact to its significance with a generic hedge construction - banned phrasings include "may signal," "could signal," "this aligns with," "is significant for," "is critical for," "could impact," "could influence," "could affect," and "raises concerns about." This applies even when you cannot find a concrete comparison/stakeholder/precedent/implication in the source material below and have to fall back to stating the fact's plain significance - state it as a direct, concrete sentence instead of reaching for one of these constructions.`;

export const PARAGRAPH2_DIRECTIVES = [
  {
    id: 0,
    label: "contextual-comparison",
    instruction: `${ANTI_HEDGE_PREFIX} Paragraph 2 must compare this fact to a specific reference point named in the source material - a prior period, a related asset/index, or a comparable figure - to give the reader scale (for example, how this compares with a recent prior reading, or with how a related asset moved). Only use a comparison point that is actually present in the source material below; if the source gives you nothing to compare against, state the significance of the fact plainly instead of inventing a comparison.`,
  },
  {
    id: 1,
    label: "stakeholder-impact",
    instruction: `${ANTI_HEDGE_PREFIX} Paragraph 2 must name the SPECIFIC stakeholder or market segment most directly affected by this fact (for example: option holders, a named industry, retail traders versus institutional desks, bondholders, a specific company's customers) and state concretely how they are affected, grounded in the source material below. Do not use a vague catch-all like "investors" or "the market" - be specific about who. Only name a stakeholder the source material actually supports; if the source gives no basis to identify one specifically, state the fact's significance plainly instead of inventing a stakeholder.`,
  },
  {
    id: 2,
    label: "historical-precedent",
    instruction: `${ANTI_HEDGE_PREFIX} Paragraph 2 must reference a comparable past instance or established pattern that puts today's fact in context - whether this kind of move is typical or unusual - using only precedent that is actually stated in the source material below. If the source gives no historical point of comparison, state the fact's significance plainly instead of inventing a historical claim.`,
  },
  {
    id: 3,
    label: "near-term-implication",
    instruction: `${ANTI_HEDGE_PREFIX} Paragraph 2 must state one concrete, specific thing to watch next as a direct implication of paragraph 1's fact - a date, an event, a level, or a decision that depends on it. Use a specific next step or date only if the source material below actually names one; if it doesn't, state the most concrete near-term consequence the source itself supports.`,
  },
];
