// Fixed-variety, code-chosen opening sentences and closing-paragraph
// framings for Analysis pieces - replaces the "vary which indicator you
// lead with" PROMPT instruction (prompts.js's old structureVarietyBlock),
// which two separate rounds of real generation proved doesn't hold: the
// SAME opening-clause check kept failing on successive real drafts even
// after the specific failure was fed back as an explicit correction note
// (see runAnalysis.js's real console log, 2026-09-19 - 20+ consecutive
// real BTC/ETH drafts failed hasFormulaicOpening both on the first
// attempt and after a targeted retry). Asking the model to make a good
// choice, even forcefully, isn't reliable here - so code makes the choice
// instead and hands it over as a requirement, not a suggestion.
import { formatMarketValue } from "../marketData/formatMarketValue.js";
export { selectTemplate } from "./templateSelection.js";

function fmt(value, assetClass) {
  return formatMarketValue(value, assetClass);
}

// Every template's applicable() must be true for it to even be offered as
// a choice - a few templates only make sense in specific number
// configurations (a genuine breakout, or price genuinely sitting between
// both levels), and offering one that doesn't fit the real numbers would
// just create a new factual problem for findAnalysisDistanceMismatch to
// catch, not a stylistic one.
export const OPENING_TEMPLATES = [
  {
    id: 0,
    label: "price-and-trend",
    applicable: () => true,
    build: (s) => `${s.symbol} is priced at ${fmt(s.price, s.assetClass)}, trading with a ${s.trend.toLowerCase()} bias ${s.trend === "Bullish" ? "above" : "below"} its 50-day moving average.`,
  },
  {
    id: 1,
    label: "rsi-first",
    applicable: () => true,
    build: (s) => `${s.symbol}'s 14-day RSI reads ${s.rsi_14}, putting it in the ${s.rsi_note.toLowerCase()} while price holds at ${fmt(s.price, s.assetClass)}.`,
  },
  {
    id: 2,
    label: "nearest-level-first",
    applicable: () => true,
    build: (s) => {
      const distToSupport = Math.abs(s.price - Number(s.support));
      const distToResistance = Math.abs(Number(s.resistance) - s.price);
      const nearestIsSupport = distToSupport <= distToResistance;
      const level = nearestIsSupport ? s.support : s.resistance;
      const levelName = nearestIsSupport ? "support" : "resistance";
      const direction = s.price >= level ? "above" : "below";
      return `${s.symbol} is trading ${direction} its nearest ${levelName} level of ${fmt(level, s.assetClass)}, with price currently at ${fmt(s.price, s.assetClass)}.`;
    },
  },
  {
    id: 3,
    label: "breakout-framing",
    // Only accurate to offer when price has genuinely broken outside the
    // support/resistance band - claiming a breakout that didn't happen
    // would be exactly the kind of factual problem findAnalysisDistanceMismatch
    // already exists to catch, not a stylistic choice to make freely.
    applicable: (s) => s.price > Number(s.resistance) || s.price < Number(s.support),
    build: (s) => {
      const brokeResistance = s.price > Number(s.resistance);
      const level = brokeResistance ? s.resistance : s.support;
      const levelName = brokeResistance ? "resistance" : "support";
      const direction = brokeResistance ? "above" : "below";
      return `${s.symbol} has pushed ${direction} its ${levelName} level of ${fmt(level, s.assetClass)}, now changing hands at ${fmt(s.price, s.assetClass)}.`;
    },
  },
  {
    id: 4,
    label: "trend-first-no-currently-priced",
    applicable: () => true,
    build: (s) => `${s.symbol}'s ${s.trend.toLowerCase()} trend holds firm as it changes hands at ${fmt(s.price, s.assetClass)}, ${s.trend === "Bullish" ? "above" : "below"} its 50-day moving average.`,
  },
  {
    id: 5,
    label: "dual-distance-comparative",
    // Only reads naturally when price genuinely sits between both levels -
    // the same reasoning as the breakout template above, mirrored.
    applicable: (s) => s.price <= Number(s.resistance) && s.price >= Number(s.support),
    build: (s) => {
      const supportPct = ((s.price - Number(s.support)) / s.price) * 100;
      const resistancePct = ((Number(s.resistance) - s.price) / s.price) * 100;
      return `At ${fmt(s.price, s.assetClass)}, ${s.symbol} sits ${supportPct.toFixed(1)}% above support at ${fmt(s.support, s.assetClass)} and ${resistancePct.toFixed(1)}% below resistance at ${fmt(s.resistance, s.assetClass)}.`;
    },
  },
  {
    id: 6,
    label: "momentum-framing",
    applicable: () => true,
    build: (s) => {
      const momentumWord = s.rsi_14 >= 55 ? "warmed" : s.rsi_14 <= 45 ? "cooled" : "held steady";
      return `Momentum in ${s.symbol} has ${momentumWord} to an RSI of ${s.rsi_14}, keeping price action at ${fmt(s.price, s.assetClass)} within ${s.trend.toLowerCase()} territory.`;
    },
  },
  {
    id: 7,
    label: "moving-average-framing",
    applicable: () => true,
    build: (s) => `${s.symbol} continues to hold ${s.trend === "Bullish" ? "above" : "below"} its 50-day moving average at ${fmt(s.price, s.assetClass)}, a level consistent with the asset's ${s.trend.toLowerCase()} posture.`,
  },
];

// Shared prefix every closing directive carries - explicitly names the
// exact structural pattern real corpus mining found (see runAnalysis.js's
// findRepeatedClosingClause comment) so the model can't satisfy the
// specific directive below while still reaching for the banned shape out
// of habit.
const CLOSING_ANTI_PATTERN_PREFIX = `Do not begin your final substantive paragraph (the one before the not-financial-advice disclaimer) with a summary transition word - "Overall," "In summary," "In synthesis," "Taken together," "Taking into account," "Together," "Considering," "To summarize," or "Altogether" are all banned there. Do not make your closing point a bare restatement of the price, RSI, support, or resistance numbers already given earlier in the piece - say something none of the earlier paragraphs already said.`;

export const CLOSING_DIRECTIVES = [
  {
    id: 0,
    label: "condition-for-reversal",
    instruction: `${CLOSING_ANTI_PATTERN_PREFIX} Instead, end by stating specifically what would need to happen for the current trend to reverse - a concrete price level or RSI threshold, not a vague "could go either way" line.`,
  },
  {
    id: 1,
    label: "single-level-to-watch",
    instruction: `${CLOSING_ANTI_PATTERN_PREFIX} Instead, end by naming the single most important level to watch next - support or resistance, whichever is closer to the current price - and state plainly what a break of it would mean. Do not restate both levels again.`,
  },
  {
    id: 2,
    label: "long-vs-short-angles",
    instruction: `${CLOSING_ANTI_PATTERN_PREFIX} Instead, end by contrasting what a trader already positioned long should watch for versus what a trader considering a short position should watch for - two distinct one-sentence angles, not one generic outlook line.`,
  },
  {
    id: 3,
    label: "catalyst-as-question",
    instruction: `${CLOSING_ANTI_PATTERN_PREFIX} Instead, end by framing the single most relevant near-term catalyst (an upcoming event if genuinely relevant, or the RSI's distance from its nearest zone boundary) as a specific question the reader should watch get answered.`,
  },
  {
    id: 4,
    label: "what-would-have-to-be-wrong",
    instruction: `${CLOSING_ANTI_PATTERN_PREFIX} Instead, end by stating explicitly what would have to be wrong about the current setup for the prevailing trend's case to fail - name a specific risk, not a generic "traders should watch closely" line.`,
  },
  {
    id: 5,
    label: "direct-verdict",
    instruction: `${CLOSING_ANTI_PATTERN_PREFIX} Instead, end with a direct one-sentence verdict on which side, buyers or sellers, currently has the stronger case, and the single clearest piece of evidence for it - not a balanced hedge.`,
  },
];

