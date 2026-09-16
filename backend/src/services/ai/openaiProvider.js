// Talks to OpenAI's Chat Completions API directly over fetch - no SDK
// dependency needed. Requires OPENAI_API_KEY in backend/.env.
import { buildArticlePrompt, buildGlossaryPrompt, buildAnalysisPrompt, buildSeoRefreshPrompt, buildRedundancyCheckPrompt } from "./prompts.js";
import { ARTICLE_FIELDS, NEWS_ARTICLE_FIELDS, GLOSSARY_FIELDS, SEO_REFRESH_FIELDS, REDUNDANCY_CHECK_FIELDS } from "./schemas.js";

// Rough, approximate pricing so the admin panel's cost tracker has something
// to show. Update these two numbers if OpenAI's pricing changes.
const PRICE_PER_1K_INPUT_TOKENS = 0.00015;
const PRICE_PER_1K_OUTPUT_TOKENS = 0.0006;

// Same idea as rss-parser's timeout on fetchSources.js's Parser instance -
// without this, a stalled request just hangs the fetch() promise forever
// (this actually happened during testing and needed a manual server
// restart to clear). scanAndGenerate.js/runAnalysis.js catch the resulting
// abort error per-story so one timeout doesn't take the whole scan down.
const FETCH_TIMEOUT_MS = 30000;

// Structured Outputs (strict: true) makes it structurally impossible for
// the model to omit a required key - the response is grammar-constrained
// to match the schema, not just prompted to. strict mode requires every
// property to be in `required` and additionalProperties: false, which is
// exactly what we want here (every field below is meant to be mandatory).
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

async function callOpenAi(prompt, fields, schemaName) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: jsonSchemaResponseFormat(schemaName, fields),
      temperature: 0.4,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0 };
  const costEstimateUsd =
    (usage.prompt_tokens / 1000) * PRICE_PER_1K_INPUT_TOKENS +
    (usage.completion_tokens / 1000) * PRICE_PER_1K_OUTPUT_TOKENS;

  return { parsed, tokensEstimate: usage.total_tokens || 0, costEstimateUsd };
}

export async function openaiGenerateArticle(items, previousCoverage, correctionNote) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callOpenAi(
    buildArticlePrompt(items, previousCoverage, correctionNote),
    NEWS_ARTICLE_FIELDS,
    "article"
  );
  return { ...parsed, tokensEstimate, costEstimateUsd };
}

export async function openaiGenerateAnalysis(snapshot, correctionNote) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callOpenAi(
    buildAnalysisPrompt(snapshot, correctionNote),
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

export async function openaiCheckRedundancy({ paragraph1, paragraph2, paragraph3 }) {
  const { parsed, tokensEstimate, costEstimateUsd } = await callOpenAi(
    buildRedundancyCheckPrompt({ paragraph1, paragraph2, paragraph3 }),
    REDUNDANCY_CHECK_FIELDS,
    "redundancy_check"
  );
  return { ...parsed, tokensEstimate, costEstimateUsd };
}
