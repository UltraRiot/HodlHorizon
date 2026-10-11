import { buildArticlePrompt, buildGlossaryPrompt, buildAnalysisPrompt, buildSeoRefreshPrompt, buildRedundancyCheckPrompt, buildAnalysisFreshnessCheckPrompt } from "./prompts.js";
import { ARTICLE_FIELDS, NEWS_ARTICLE_FIELDS, GLOSSARY_FIELDS, SEO_REFRESH_FIELDS, REDUNDANCY_CHECK_FIELDS, ANALYSIS_FRESHNESS_CHECK_FIELDS } from "./schemas.js";

const PRICE_PER_1K_INPUT_TOKENS = 0.0008;
const PRICE_PER_1K_OUTPUT_TOKENS = 0.004;

const FETCH_TIMEOUT_MS = 30000;

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

export async function anthropicGenerateArticle(items, previousCoverage, correctionNote, paragraph2Directive, isThinSource) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callAnthropic(
    buildArticlePrompt(items, previousCoverage, correctionNote, paragraph2Directive, isThinSource),
    NEWS_ARTICLE_FIELDS,
    "submit_article"
  );
  return { ...parsed, tokensEstimate, costEstimateUsd };
}

export async function anthropicGenerateAnalysis(snapshot, correctionNote, context) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callAnthropic(
    buildAnalysisPrompt(snapshot, correctionNote, context),
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

export async function anthropicCheckRedundancy({ paragraph1, paragraph2, paragraph3, sourceText }) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callAnthropic(
    buildRedundancyCheckPrompt({ paragraph1, paragraph2, paragraph3, sourceText }),
    REDUNDANCY_CHECK_FIELDS,
    "submit_redundancy_check"
  );
  return { ...parsed, tokensEstimate, costEstimateUsd };
}

export async function anthropicCheckAnalysisFreshness({ body, priorArticleBody }) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callAnthropic(
    buildAnalysisFreshnessCheckPrompt({ body, priorArticleBody }),
    ANALYSIS_FRESHNESS_CHECK_FIELDS,
    "submit_analysis_freshness_check"
  );
  return { ...parsed, tokensEstimate, costEstimateUsd };
}
