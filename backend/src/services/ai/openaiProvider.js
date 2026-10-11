import { buildArticlePrompt, buildGlossaryPrompt, buildAnalysisPrompt, buildSeoRefreshPrompt, buildRedundancyCheckPrompt, buildAnalysisFreshnessCheckPrompt } from "./prompts.js";
import { ARTICLE_FIELDS, NEWS_ARTICLE_FIELDS, GLOSSARY_FIELDS, SEO_REFRESH_FIELDS, REDUNDANCY_CHECK_FIELDS, ANALYSIS_FRESHNESS_CHECK_FIELDS } from "./schemas.js";

const PRICE_PER_1K_INPUT_TOKENS = 0.00015;
const PRICE_PER_1K_OUTPUT_TOKENS = 0.0006;

const FETCH_TIMEOUT_MS = 30000;

function jsonSchemaResponseFormat(name, fields) {
  return {
    type: "json_schema",
    json_schema: {
      name,
      strict: true,
      schema: { ...fields, additionalProperties: false },
    },
  };
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_BACKOFF_MS = [1000, 3000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchChatCompletion(body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.ok || !RETRYABLE_STATUS.has(res.status) || attempt >= RETRY_BACKOFF_MS.length) {
      return res;
    }

    console.warn(`OpenAI request got a ${res.status} - retrying in ${RETRY_BACKOFF_MS[attempt]}ms (attempt ${attempt + 1}/${RETRY_BACKOFF_MS.length}).`);
    await sleep(RETRY_BACKOFF_MS[attempt]);
  }
}

async function callOpenAi(prompt, fields, schemaName) {
  const res = await fetchChatCompletion({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: jsonSchemaResponseFormat(schemaName, fields),
    temperature: 0.4,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const message = data.choices[0].message;
  if (message.refusal) {
    throw new Error(`OpenAI refused this request: ${message.refusal}`);
  }
  const parsed = JSON.parse(message.content);
  const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0 };
  const costEstimateUsd =
    (usage.prompt_tokens / 1000) * PRICE_PER_1K_INPUT_TOKENS +
    (usage.completion_tokens / 1000) * PRICE_PER_1K_OUTPUT_TOKENS;

  return { parsed, tokensEstimate: usage.total_tokens || 0, costEstimateUsd };
}

export async function openaiGenerateArticle(items, previousCoverage, correctionNote, paragraph2Directive, isThinSource) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callOpenAi(
    buildArticlePrompt(items, previousCoverage, correctionNote, paragraph2Directive, isThinSource),
    NEWS_ARTICLE_FIELDS,
    "article"
  );
  return { ...parsed, tokensEstimate, costEstimateUsd };
}

export async function openaiGenerateAnalysis(snapshot, correctionNote, context) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callOpenAi(
    buildAnalysisPrompt(snapshot, correctionNote, context),
    ARTICLE_FIELDS,
    "analysis"
  );
  return { ...parsed, tokensEstimate, costEstimateUsd };
}

export async function openaiGenerateGlossary(term) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callOpenAi(
    buildGlossaryPrompt(term),
    GLOSSARY_FIELDS,
    "glossary_entry"
  );
  return { term, ...parsed, tokensEstimate, costEstimateUsd };
}

export async function openaiGenerateSeoRefresh({ label, body }) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callOpenAi(
    buildSeoRefreshPrompt({ label, body }),
    SEO_REFRESH_FIELDS,
    "seo_refresh"
  );
  return { ...parsed, tokensEstimate, costEstimateUsd };
}

export async function openaiCheckRedundancy({ paragraph1, paragraph2, paragraph3, sourceText }) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callOpenAi(
    buildRedundancyCheckPrompt({ paragraph1, paragraph2, paragraph3, sourceText }),
    REDUNDANCY_CHECK_FIELDS,
    "redundancy_check"
  );
  return { ...parsed, tokensEstimate, costEstimateUsd };
}

export async function openaiCheckAnalysisFreshness({ body, priorArticleBody }) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callOpenAi(
    buildAnalysisFreshnessCheckPrompt({ body, priorArticleBody }),
    ANALYSIS_FRESHNESS_CHECK_FIELDS,
    "analysis_freshness_check"
  );
  return { ...parsed, tokensEstimate, costEstimateUsd };
}
