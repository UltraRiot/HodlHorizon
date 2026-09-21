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
// candidates, asking four direct questions in the same request (see
// buildRedundancyCheckPrompt in prompts.js for the full reasoning behind
// each, including the real regressions that motivated them):
// 1. Does paragraph 3 add genuinely new information beyond paragraphs 1-2?
//    Catches paraphrased/semantic redundancy the Jaccard word-overlap
//    check structurally can't (see findBodyProblem()).
// 2. Does paragraph 1 contain a genuine anchor fact (a number, date, or
//    named source/report) rather than vague scene-setting? The prompt
//    (STYLE_INSTRUCTIONS) already instructs this, but as with SEO length
//    and body-problem detection, a prompt instruction isn't a guarantee -
//    this is the same "verify in code" pattern applied to that rule too.
// 3. Does the draft invent or misdirect a causal link between two facts
//    that the source material doesn't actually support?
// 4. Does the draft present two facts that read as counterintuitive
//    relative to typical expectation (e.g. a rate hike coinciding with
//    currency weakness) without acknowledging that tension, when the
//    source material never explains why? Real regression: article #429
//    stated the yen weakened right after a BOJ rate hike - the opposite
//    of the normal expectation - with zero acknowledgment that this was
//    unusual, reading as confusing rather than explained. This is the
//    deliberate counterpart to question 3, not a duplicate of it:
//    question 3 catches an INVENTED explanation for a tension; this one
//    catches an tension left completely unacknowledged instead. A brief
//    that plainly states "the reason for this wasn't addressed in the
//    available coverage" satisfies this without ever tripping question 3.
// Kept in this same field set/DB flag rather than a new mechanism - still
// named REDUNDANCY_CHECK_FIELDS despite covering more than redundancy now,
// the same way price_mismatch's column covers more than just price (see
// runAnalysis.js) - a rename here would touch 4 files for a label only,
// not a behavior change.
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

// Analysis-only independent verification (services/ai/provider.js,
// generateAnalysisFreshnessCheck) - added after auditPublishedAnalysis.js
// found a real, confirmed gap: articles 281/285/301 (real published
// Bitcoin pieces) reused the same "1.5% decline in September... first
// quarterly gain in a year... Ether/XRP outflows" narrative near-verbatim
// across successive pieces, and the deterministic lexical similarity
// check (findAnalysisSimilarityMismatch, runAnalysis.js) does NOT catch
// it - confirmed empirically before writing this: even the single most
// obviously-reused sentence pair between those three articles scores only
// ~0.36-0.43 word-overlap similarity, well under any threshold that
// wouldn't also flag ordinary legitimate day-to-day variation. Jaccard has
// no notion of meaning, only word overlap - the same documented limitation
// as findBodyProblem() in provider.js. This is a genuinely semantic
// question ("does this restate the SAME fact in different words"), so it
// reuses the established pattern for exactly that class of problem (the
// redundancy/causal-claim check above) instead of trying to force a
// regex/lexical check to do a job it's structurally bad at.
// Separate from REDUNDANCY_CHECK_FIELDS (not a 4th question bolted onto
// it) because that check's paragraph-1/2/3 inputs and this check's
// whole-body-vs-prior-article inputs are shaped too differently to share
// one prompt/schema cleanly, and because news articles (which also use
// REDUNDANCY_CHECK_FIELDS) have no equivalent "prior article about this
// same recurring instrument" concept to compare against.
export const ANALYSIS_FRESHNESS_CHECK_FIELDS = {
  type: "object",
  properties: {
    restates_stale_fact: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["restates_stale_fact", "reason"],
};
