// Field shapes shared between the OpenAI provider (Structured Outputs -
// response_format: json_schema) and the Anthropic provider (forced
// tool-use). Both ultimately need "these keys must be present as strings" -
// described once here so the two provider files can't drift out of sync,
// and so a required field can't silently go missing under prompt load the
// way seo_title/seo_description did before this file existed.
export const ARTICLE_FIELDS = {
  type: "object",
  properties: {
    title: { type: "string" },
    dek: { type: "string" },
    body: { type: "string" },
    seo_title: { type: "string" },
    seo_description: { type: "string" },
  },
  required: ["title", "dek", "body", "seo_title", "seo_description"],
};

// The 5 fixed categories a story can be filed under.
export const CATEGORY_ENUM = ["Crypto", "Stocks", "Indices", "Commodities", "Analysis"];

// News articles only (buildArticlePrompt) - adds detected_category so a
// mismatch between the category a source is pre-assigned to and what the
// story is actually about can be caught (see services/rss/scanAndGenerate.js).
// Analysis briefs stay on plain ARTICLE_FIELDS above: they're always tied
// to a fixed watchlist symbol -> the Analysis category directly, with no
// source-based assignment to double check.
export const NEWS_ARTICLE_FIELDS = {
  type: "object",
  properties: {
    title: { type: "string" },
    dek: { type: "string" },
    body: { type: "string" },
    seo_title: { type: "string" },
    seo_description: { type: "string" },
    detected_category: { type: "string", enum: CATEGORY_ENUM },
  },
  required: ["title", "dek", "body", "seo_title", "seo_description", "detected_category"],
};

export const GLOSSARY_FIELDS = {
  type: "object",
  properties: {
    short_definition: { type: "string" },
    body: { type: "string" },
    seo_title: { type: "string" },
    seo_description: { type: "string" },
  },
  required: ["short_definition", "body", "seo_title", "seo_description"],
};

export const SEO_REFRESH_FIELDS = {
  type: "object",
  properties: {
    seo_title: { type: "string" },
    seo_description: { type: "string" },
  },
  required: ["seo_title", "seo_description"],
};

// Independent verification check (services/ai/provider.js,
// generateRedundancyCheck) - one small call scoped only to auto-publish
// candidates, asking two direct questions in the same request:
// 1. Does paragraph 3 add genuinely new information beyond paragraphs 1-2?
//    Catches paraphrased/semantic redundancy the Jaccard word-overlap
//    check structurally can't (see findBodyProblem()).
// 2. Does paragraph 1 contain a genuine anchor fact (a number, date, or
//    named source/report) rather than vague scene-setting? The prompt
//    (STYLE_INSTRUCTIONS) already instructs this, but as with SEO length
//    and body-problem detection, a prompt instruction isn't a guarantee -
//    this is the same "verify in code" pattern applied to that rule too.
export const REDUNDANCY_CHECK_FIELDS = {
  type: "object",
  properties: {
    adds_new_information: { type: "boolean" },
    reason: { type: "string" },
    paragraph1_has_anchor_fact: { type: "boolean" },
    anchor_fact_reason: { type: "string" },
  },
  required: ["adds_new_information", "reason", "paragraph1_has_anchor_fact", "anchor_fact_reason"],
};
