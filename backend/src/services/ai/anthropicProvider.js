// Talks to Anthropic's Messages API directly over fetch. Requires
// ANTHROPIC_API_KEY in backend/.env.
import { buildArticlePrompt, buildGlossaryPrompt, buildAnalysisPrompt, buildSeoRefreshPrompt, buildRedundancyCheckPrompt } from "./prompts.js";
import { ARTICLE_FIELDS, NEWS_ARTICLE_FIELDS, GLOSSARY_FIELDS, SEO_REFRESH_FIELDS, REDUNDANCY_CHECK_FIELDS } from "./schemas.js";

// Rough, approximate pricing (Claude Haiku-class model) for the cost tracker.
const PRICE_PER_1K_INPUT_TOKENS = 0.0008;
const PRICE_PER_1K_OUTPUT_TOKENS = 0.004;

// Same idea as rss-parser's timeout on fetchSources.js's Parser instance -
// without this, a stalled request just hangs the fetch() promise forever.
// scanAndGenerate.js/runAnalysis.js catch the resulting abort error
// per-story so one timeout doesn't take the whole scan down.
const FETCH_TIMEOUT_MS = 30000;

// Forced tool-use is Anthropic's equivalent of OpenAI's Structured Outputs
// here: tool_choice pins the model to this one tool, and its input_schema
// (the same field shapes from schemas.js) makes the required keys part of
// the tool's contract rather than something the prompt just asks nicely
// for - no more free-text JSON that can quietly drop a field under load.
function toTool(name, fields) {
  return {
    name,
    description: `Submit the generated ${name.replace(/_/g, " ")}.`,
    input_schema: fields,
  };
}

async function callAnthropic(prompt, fields, toolName) {
  const tool = toTool(toolName, fields);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-20241022",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
      tools: [tool],
      tool_choice: { type: "tool", name: toolName },
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const toolUse = data.content?.find((block) => block.type === "tool_use");
  if (!toolUse) {
    throw new Error(`Anthropic did not return the expected "${toolName}" tool_use block.`);
  }

  const parsed = toolUse.input;
  const usage = data.usage || { input_tokens: 0, output_tokens: 0 };
  const tokensEstimate = usage.input_tokens + usage.output_tokens;
  const costEstimateUsd =
    (usage.input_tokens / 1000) * PRICE_PER_1K_INPUT_TOKENS +
    (usage.output_tokens / 1000) * PRICE_PER_1K_OUTPUT_TOKENS;

  return { parsed, tokensEstimate, costEstimateUsd };
}

export async function anthropicGenerateArticle(items, previousCoverage, correctionNote) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callAnthropic(
    buildArticlePrompt(items, previousCoverage, correctionNote),
    NEWS_ARTICLE_FIELDS,
    "submit_article"
  );
  return { ...parsed, tokensEstimate, costEstimateUsd };
}

export async function anthropicGenerateAnalysis(snapshot, correctionNote) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callAnthropic(
    buildAnalysisPrompt(snapshot, correctionNote),
    ARTICLE_FIELDS,
    "submit_analysis"
  );
  return { ...parsed, tokensEstimate, costEstimateUsd };
}

export async function anthropicGenerateGlossary(term) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callAnthropic(
    buildGlossaryPrompt(term),
    GLOSSARY_FIELDS,
    "submit_glossary_entry"
  );
  return { term, ...parsed, tokensEstimate, costEstimateUsd };
}

export async function anthropicGenerateSeoRefresh({ label, body }) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callAnthropic(
    buildSeoRefreshPrompt({ label, body }),
    SEO_REFRESH_FIELDS,
    "submit_seo_metadata"
  );
  return { ...parsed, tokensEstimate, costEstimateUsd };
}

export async function anthropicCheckRedundancy({ paragraph1, paragraph2, paragraph3 }) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callAnthropic(
    buildRedundancyCheckPrompt({ paragraph1, paragraph2, paragraph3 }),
    REDUNDANCY_CHECK_FIELDS,
    "submit_redundancy_check"
  );
  return { ...parsed, tokensEstimate, costEstimateUsd };
}
