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

export const REDUNDANCY_CHECK_FIELDS = {
  type: "object",
  properties: {
    adds_new_information: { type: "boolean" },
    reason: { type: "string" },
    paragraph1_has_anchor_fact: { type: "boolean" },
    anchor_fact_reason: { type: "string" },
    unsupported_causal_claim: { type: "boolean" },
    causal_claim_reason: { type: "string" },
    unacknowledged_divergence: { type: "boolean" },
    divergence_reason: { type: "string" },
  },
  required: [
    "adds_new_information",
    "reason",
    "paragraph1_has_anchor_fact",
    "anchor_fact_reason",
    "unsupported_causal_claim",
    "causal_claim_reason",
    "unacknowledged_divergence",
    "divergence_reason",
  ],
};

export const ANALYSIS_FRESHNESS_CHECK_FIELDS = {
  type: "object",
  properties: {
    restates_stale_fact: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["restates_stale_fact", "reason"],
};
