// The default AI "provider". Needs no API key, costs nothing, and produces
// clearly-labelled placeholder content - enough to see the whole pipeline
// (RSS -> grouping -> article -> database -> homepage) actually working
// before you spend any OpenAI/Anthropic credit. Swap AI_PROVIDER in .env
// to "openai" or "anthropic" when you're ready for real writing.

import { formatMarketValue } from "../marketData/formatMarketValue.js";

function shortDek(items) {
  return `${items.length} source${items.length > 1 ? "s" : ""} are reporting on this story. Add a real AI provider in .env to generate an actual summary here.`;
}

// assignedCategoryName: the source's own assigned category (e.g. "Crypto"),
// passed through only so mock output never trips the category-mismatch
// check - mock has no real content understanding to independently detect
// a category with, unlike the real providers, so it just echoes back
// whatever it was told rather than guessing wrong.
export function mockGenerateArticle(items, previousCoverage, correctionNote, assignedCategoryName) {
  const headline = items[0].title;
  const updateNote = previousCoverage
    ? `This would be written as an update to "${previousCoverage.title}" (published ${previousCoverage.hoursAgo}h ago), not a fresh story.`
    : `Set AI_PROVIDER=openai or AI_PROVIDER=anthropic in backend/.env (with an API key) to have this rewritten as a real, human-but-professional summary.`;
  const body = [
    `[Mock draft] This is a placeholder article generated without calling a paid AI provider.`,
    `The story was picked up from: ${items.map((i) => i.sourceName).join(", ")}.`,
    `Original headline: "${headline}". ${updateNote}`,
  ].join("\n\n");

  return {
    title: headline,
    dek: shortDek(items),
    body,
    seo_title: headline.slice(0, 60),
    seo_description: shortDek(items).slice(0, 160),
    detected_category: assignedCategoryName,
    tokensEstimate: 0,
    costEstimateUsd: 0,
  };
}

export function mockGenerateAnalysis(snapshot) {
  const price = formatMarketValue(snapshot.price, snapshot.assetClass);
  const support = formatMarketValue(snapshot.support, snapshot.assetClass);
  const resistance = formatMarketValue(snapshot.resistance, snapshot.assetClass);
  const body = [
    `[Mock draft] ${snapshot.symbol} is trading at ${price}, in a ${snapshot.trend} trend.`,
    `RSI (14-day) reads ${snapshot.rsi_14}, which is in the ${snapshot.rsi_note.toLowerCase()}.`,
    `Support sits near ${support} and resistance near ${resistance}. Set AI_PROVIDER=openai or AI_PROVIDER=anthropic in backend/.env to have this narrated as a real analysis brief.`,
  ].join("\n\n");

  return {
    title: `${snapshot.symbol}: ${snapshot.trend} trend, RSI at ${snapshot.rsi_14}`,
    dek: `A quick technical read on ${snapshot.symbol}: ${snapshot.trend.toLowerCase()} trend, RSI ${snapshot.rsi_14}.`,
    body,
    seo_title: `${snapshot.symbol} technical analysis`.slice(0, 60),
    seo_description: `${snapshot.symbol} is ${snapshot.trend.toLowerCase()}, RSI ${snapshot.rsi_14}, support ${support}, resistance ${resistance}.`.slice(0, 160),
    tokensEstimate: 0,
    costEstimateUsd: 0,
  };
}

// Always passes - mock has no real content understanding to judge
// redundancy with, and this check only runs for real providers anyway
// (see provider.js's generateArticle: skipped entirely when
// draft.provider === "mock").
export function mockCheckRedundancy() {
  return {
    adds_new_information: true,
    reason: "Mock check always passes.",
    paragraph1_has_anchor_fact: true,
    anchor_fact_reason: "Mock check always passes.",
    tokensEstimate: 0,
    costEstimateUsd: 0,
  };
}

export function mockGenerateSeoRefresh({ label }) {
  return {
    seo_title: `[Mock] ${label}`.slice(0, 60),
    seo_description: `Placeholder SEO description for ${label}. Set AI_PROVIDER=openai or AI_PROVIDER=anthropic in backend/.env to have this refreshed for real.`.slice(0, 155),
    tokensEstimate: 0,
    costEstimateUsd: 0,
  };
}

export function mockGenerateGlossary(term) {
  const body = `[Mock draft] A real definition of "${term}" will appear here once a real AI provider is configured in backend/.env.`;
  return {
    term,
    short_definition: `A placeholder definition of ${term}.`,
    body,
    seo_title: `What is ${term}?`,
    seo_description: `A placeholder SEO description for ${term}.`,
    tokensEstimate: 0,
    costEstimateUsd: 0,
  };
}
