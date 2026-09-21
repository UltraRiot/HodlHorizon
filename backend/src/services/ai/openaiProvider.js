// Talks to OpenAI's Chat Completions API directly over fetch - no SDK
// dependency needed. Requires OPENAI_API_KEY in backend/.env.
import { buildArticlePrompt, buildGlossaryPrompt, buildAnalysisPrompt, buildSeoRefreshPrompt, buildRedundancyCheckPrompt, buildAnalysisFreshnessCheckPrompt } from "./prompts.js";
import { ARTICLE_FIELDS, NEWS_ARTICLE_FIELDS, GLOSSARY_FIELDS, SEO_REFRESH_FIELDS, REDUNDANCY_CHECK_FIELDS, ANALYSIS_FRESHNESS_CHECK_FIELDS } from "./schemas.js";

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

// Retry-with-backoff, scoped ONLY to "the request completed but OpenAI
// said try again" (429 rate limit, 5xx server error) - never for other 4xx
// (a bad request/schema problem retrying can't fix) and never for a hang
// (AbortSignal.timeout(FETCH_TIMEOUT_MS) above already owns that case,
// untouched by this). Real motivation, not hypothetical: once the pacing/
// timezone bug is fixed (see freshness-review-2026-09-20.md), a category's
// whole day's generation still fires in one narrow burst window - a single
// transient rate-limit hit exactly then used to permanently lose that
// story until the source aged out of the 72h freshness window entirely,
// rather than the next 15-minute scan tick simply recovering it. 1-2
// retries, not more - this is a short-lived blip filter, not a queue.
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
  // A model refusal (safety/content-policy) leaves message.content null and
  // puts the reason in message.refusal instead - checked explicitly rather
  // than left to fall through, because JSON.parse(null) does NOT throw (it
  // coerces to JSON.parse("null"), a valid parse of the JS value null) and
  // spreading null in an object literal is also legal ({...null} === {}) -
  // so an unhandled refusal used to come back as an empty-looking "success"
  // missing every content field, failing confusingly downstream (e.g.
  // findUnexplainedDekAcronym(draft.dek) on undefined) instead of failing
  // clearly at the point it actually happened.
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
