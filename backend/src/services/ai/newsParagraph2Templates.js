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
