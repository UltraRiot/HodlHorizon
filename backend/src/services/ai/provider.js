// The one place the rest of the app calls into to generate content. It
// picks the right provider based on AI_PROVIDER in .env, and always logs
// what it cost so the admin panel's usage tracker stays accurate.
import { query } from "../../db.js";
import { mockGenerateArticle, mockGenerateGlossary, mockGenerateAnalysis, mockGenerateSeoRefresh, mockCheckRedundancy } from "./mockProvider.js";
import { openaiGenerateArticle, openaiGenerateGlossary, openaiGenerateAnalysis, openaiGenerateSeoRefresh, openaiCheckRedundancy } from "./openaiProvider.js";
import { anthropicGenerateArticle, anthropicGenerateGlossary, anthropicGenerateAnalysis, anthropicGenerateSeoRefresh, anthropicCheckRedundancy } from "./anthropicProvider.js";
import { normalize, jaccardSimilarity, DUPLICATE_SIMILARITY_THRESHOLD } from "../rss/grouping.js";

function currentProvider() {
  return process.env.AI_PROVIDER || "mock";
}

function truncate(str, max) {
  if (!str) return str;
  return str.length > max ? `${str.slice(0, max - 1).trimEnd()}…` : str;
}

// Last-resort padding toward a minimum length, used ONLY when the AI
// omitted seo_description entirely and we're deriving one from a shorter
// field (a dek, a short_definition). Never touches real AI-written output.
function padToward(str, min) {
  if (!str) return str;
  let padded = str;
  while (padded.length < min) padded += " Read more on Hodl Horizon.";
  return padded;
}

// Safety net behind Structured Outputs/forced tool-use: those make it
// structurally impossible for the model to omit the fields in most cases,
// but this still guards against an empty string, a provider that doesn't
// support either mechanism, or a future provider added without updating
// its schema. Derives seo_title from a short identifying field already in
// the result (title/term/label) and seo_description from a slightly
// longer one (dek/short_definition/body) rather than saving null. Logs a
// warning so real usage of this path (which should be rare-to-zero after
// the schema fix) stays visible.
function applySeoFallback(result, { fallbackTitle, fallbackDescription, context }) {
  let { seo_title, seo_description } = result;
  let usedFallback = false;

  if (!seo_title || seo_title.trim().length === 0) {
    seo_title = truncate(fallbackTitle, 60);
    usedFallback = true;
  }
  if (!seo_description || seo_description.trim().length === 0) {
    seo_description = truncate(padToward(fallbackDescription, 120), 155);
    usedFallback = true;
  }

  if (usedFallback) {
    console.warn(`AI provider: seo_title/seo_description fallback used for ${context}.`);
  }

  return { ...result, seo_title, seo_description };
}

// Hard length ceilings, enforced deterministically after generation - the
// same "verify in code, not just hope in the prompt" pattern as
// findBodyProblem() below and formatPrice() (services/marketData/prices.js).
// SEO_FIELD_RULES (prompts.js) already asks the model for 50-60/120-155
// chars, but a prompt is a request, not a guarantee - this is what actually
// stops an over-length seo_title/seo_description from ever reaching the
// database, regardless of what the model returned. Trims to the last full
// word at-or-under the limit rather than a hard character slice, so the
// stored value never ends mid-word.
const SEO_TITLE_MAX = 60;
const SEO_DESCRIPTION_MAX = 155;

export function trimToWordBoundary(str, max) {
  if (!str || str.length <= max) return str;
  const sliced = str.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  // No space at all under the limit (one very long word) - fall back to a
  // hard slice rather than returning an empty string.
  const trimmed = lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced;
  return trimmed.trimEnd();
}

function enforceSeoLength(result) {
  return {
    ...result,
    seo_title: trimToWordBoundary(result.seo_title, SEO_TITLE_MAX),
    seo_description: trimToWordBoundary(result.seo_description, SEO_DESCRIPTION_MAX),
  };
}

const MAX_BODY_PARAGRAPHS = 3;

// Verification in code, not just hope in the prompt - the same principle
// that made Structured Outputs replace prompt-only instructions for
// seo_title/seo_description. Checked once per generation, retried once
// with an explicit correction note if it fails, then accepted as-is
// either way - never retried more than once, so a persistently bad draft
// can't loop. Reuses the exact same word-overlap function and similarity
// bar as the pre-save duplicate-article check (articleUtils.js): first
// paragraph 1 vs paragraph 2, then paragraph 3 checked separately against
// each of paragraph 1 and paragraph 2 (not the two combined - checking
// separately catches a paragraph 3 that only restates paragraph 2, say,
// which a combined-bag-of-words comparison could dilute below the threshold).
//
// Known limitation, worth knowing rather than hiding: this only catches
// LEXICAL redundancy (shared words). A paragraph 3 that restates an
// earlier point in fully paraphrased language - different vocabulary,
// same underlying claim - can still slip through, because Jaccard
// similarity has no notion of meaning, only word overlap. Confirmed
// this in practice against article 138: its paragraph 3 restates
// paragraph 2's "this validates confidence/strategic significance" point
// in almost entirely different words, and measures at ~0.08-0.11 overlap
// against paragraphs 1 and 2 - nowhere near the 0.6 bar. That gap is
// inherent to word-overlap similarity, not a bug in this check.
function findBodyProblem(body) {
  const paragraphs = (body || "").split("\n\n").filter((p) => p.trim().length > 0);

  if (paragraphs.length > MAX_BODY_PARAGRAPHS) {
    return `the body has ${paragraphs.length} paragraphs but the limit is ${MAX_BODY_PARAGRAPHS}`;
  }

  if (paragraphs.length >= 2) {
    const similarity = jaccardSimilarity(normalize(paragraphs[0]), normalize(paragraphs[1]));
    if (similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
      return `paragraph 1 and paragraph 2 repeat the same information (${Math.round(similarity * 100)}% word overlap) instead of paragraph 1 being the fact and paragraph 2 being why it matters`;
    }
  }

  if (paragraphs.length >= 3) {
    const words3 = normalize(paragraphs[2]);
    const similarityTo1 = jaccardSimilarity(words3, normalize(paragraphs[0]));
    const similarityTo2 = jaccardSimilarity(words3, normalize(paragraphs[1]));
    const worseMatch = similarityTo1 >= similarityTo2
      ? { against: "paragraph 1", similarity: similarityTo1 }
      : { against: "paragraph 2", similarity: similarityTo2 };

    if (worseMatch.similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
      return `paragraph 3 repeats information already in ${worseMatch.against} (${Math.round(worseMatch.similarity * 100)}% word overlap) instead of adding a different figure, a different named party's reaction, or a concrete next step`;
    }
  }

  return null;
}

// Independent verification check - a small extra AI call. Originally
// scoped only to auto-publish candidates (2+ sources), back when
// single-source articles always landed in indefinite manual review and a
// human was already the safety net for them. Now that a clean single-source
// article can also skip review (via the delayed-auto-publish path - see
// scanAndGenerate.js's "scheduled" status), this check is the only
// automated gate for THAT path too, so it runs for every non-mock article
// regardless of source count - the cost (a few hundredths of a cent per
// call) is trivial next to what it's now guarding. One call, two questions
// (see buildRedundancyCheckPrompt): paragraph 3 semantic redundancy
// (catches paraphrased redundancy findBodyProblem()'s Jaccard check can't -
// see its comment above, and the article-138 case that motivated this) and
// paragraph 1 anchor-fact presence (verifies the STYLE_INSTRUCTIONS rule
// against vague scene-setting actually held).
async function generateRedundancyCheck({ paragraph1, paragraph2, paragraph3 }) {
  const provider = currentProvider();
  const result =
    provider === "openai"
      ? await openaiCheckRedundancy({ paragraph1, paragraph2, paragraph3 })
      : provider === "anthropic"
      ? await anthropicCheckRedundancy({ paragraph1, paragraph2, paragraph3 })
      : mockCheckRedundancy({ paragraph1, paragraph2, paragraph3 });
  await logUsage(provider, "redundancy_check", result.tokensEstimate, result.costEstimateUsd);
  return result;
}

async function logUsage(provider, purpose, tokensEstimate, costEstimateUsd) {
  await query(
    `INSERT INTO ai_usage_log (provider, model, tokens_estimate, cost_estimate_usd, purpose)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      provider,
      provider === "openai" ? process.env.OPENAI_MODEL : provider === "anthropic" ? process.env.ANTHROPIC_MODEL : "mock",
      tokensEstimate || 0,
      costEstimateUsd || 0,
      purpose,
    ]
  );
}

// items: [{ title, sourceName, sourceUrl, contentSnippet }]
// previousCoverage (optional): { title, hoursAgo, keyFacts } - set when this
// site already covered the same story recently, so the AI writes an update
// instead of repeating itself. See services/shared/articleUtils.js.
// Returns { ...draft, provider } - callers must use draft.provider (not
// their own read of process.env.AI_PROVIDER) wherever the actual resolved
// provider matters, e.g. deciding whether a mock draft is allowed to
// publish. This is the one place that already normalizes AI_PROVIDER
// (currentProvider() falls back to "mock" on anything unrecognized/mis-cased) -
// re-reading the raw env var anywhere else risks drifting out of sync with
// which generator actually ran, which is exactly what let a mock-provider
// article slip through as ai_provider: "openai" previously.
// assignedCategoryName (optional): the source's own assigned category
// (e.g. "Crypto") - passed through only to the mock provider, which has no
// real content understanding to independently detect a category with (see
// mockGenerateArticle). openai/anthropic are never told this: the whole
// point of detected_category is an independent judgment from the content
// alone, not one anchored on what it's already filed as.
export async function generateArticle(items, previousCoverage, assignedCategoryName) {
  const provider = currentProvider();

  async function callProvider(correctionNote) {
    const result =
      provider === "openai"
        ? await openaiGenerateArticle(items, previousCoverage, correctionNote)
        : provider === "anthropic"
        ? await anthropicGenerateArticle(items, previousCoverage, correctionNote)
        : mockGenerateArticle(items, previousCoverage, correctionNote, assignedCategoryName);
    await logUsage(provider, "article", result.tokensEstimate, result.costEstimateUsd);
    return result;
  }

  // Runs every check against one body and returns a single problem
  // description (or null if it's clean) - used both on the first draft and,
  // if a retry fires, again on the retried draft. Re-running it on the
  // retried draft (not just trusting the retry worked) is what lets callers
  // know the article is actually clean enough for the delayed-auto-publish
  // path (scanAndGenerate.js) rather than just "was retried and moved on
  // regardless," which was fine when every non-auto-publish draft was
  // heading to indefinite review anyway but isn't precise enough now.
  async function verifyBody(body) {
    const lexicalProblem = findBodyProblem(body);
    if (lexicalProblem || provider === "mock") {
      return { problem: lexicalProblem };
    }
    const paragraphs = (body || "").split("\n\n").filter((p) => p.trim().length > 0);
    if (paragraphs.length < 3) {
      return { problem: null };
    }
    const redundancyCheck = await generateRedundancyCheck({
      paragraph1: paragraphs[0],
      paragraph2: paragraphs[1],
      paragraph3: paragraphs[2],
    });
    if (!redundancyCheck.adds_new_information) {
      return { problem: `an independent redundancy check found paragraph 3 doesn't add new information: ${redundancyCheck.reason}` };
    }
    if (!redundancyCheck.paragraph1_has_anchor_fact) {
      return { problem: `an independent check found paragraph 1 lacks a genuine anchor fact: ${redundancyCheck.anchor_fact_reason}` };
    }
    return { problem: null };
  }

  let result = await callProvider();
  let { problem } = await verifyBody(result.body);
  let verificationClean = !problem;

  if (problem) {
    console.warn(`AI provider: retrying article generation once - ${problem}.`);
    result = await callProvider(problem);
    // Still only one regeneration of the article's actual content, exactly
    // as before - but the retried draft IS re-verified once (not a further
    // retry, just a check) so scanAndGenerate.js knows whether the retry
    // actually fixed things. Accepted either way regardless of the result:
    // a still-dirty retry just means verificationClean stays false, which
    // routes it to plain review instead of delayed auto-publish/immediate
    // publish - never a second regeneration attempt.
    verificationClean = !(await verifyBody(result.body)).problem;
  }

  const withFallback = applySeoFallback(result, {
    fallbackTitle: result.title,
    fallbackDescription: result.dek,
    context: `article "${result.title}"`,
  });
  // verificationClean: true only if every automated check (lexical body
  // checks + the semantic redundancy/anchor-fact check) passed with no
  // retry needed, or a retry was needed and the re-check confirmed it's
  // fixed now. Read by scanAndGenerate.js to decide between immediate
  // publish (2+ sources), delayed "scheduled" publish (1 source, clean),
  // or plain review (anything not clean, any source count).
  return { ...enforceSeoLength(withFallback), provider, verificationClean };
}

// snapshot: the output of getMarketSnapshot() (real computed technicals) -
// used only by the Analysis job (services/analysis/runAnalysis.js), never
// by the news pipeline.
export async function generateAnalysis(snapshot) {
  const provider = currentProvider();

  async function callProvider(correctionNote) {
    const result =
      provider === "openai"
        ? await openaiGenerateAnalysis(snapshot, correctionNote)
        : provider === "anthropic"
        ? await anthropicGenerateAnalysis(snapshot, correctionNote)
        : mockGenerateAnalysis(snapshot, correctionNote);
    await logUsage(provider, "analysis", result.tokensEstimate, result.costEstimateUsd);
    return result;
  }

  let result = await callProvider();

  const problem = findBodyProblem(result.body);
  if (problem) {
    console.warn(`AI provider: retrying analysis generation once - ${problem}.`);
    result = await callProvider(problem);
  }

  const withFallback = applySeoFallback(result, {
    fallbackTitle: result.title,
    fallbackDescription: result.dek,
    context: `analysis "${result.title}"`,
  });
  return { ...enforceSeoLength(withFallback), provider };
}

// label/body: a human-readable name and the item's existing content, used
// only as input - never touches or regenerates body content itself. Tags
// .provider like generateArticle/generateAnalysis do, so the evergreen
// refresh job (services/seo/evergreenRefresh.js) can skip applying a
// mock-provider result instead of overwriting real production SEO fields
// with placeholder text if AI_PROVIDER is ever unset/mis-cased.
export async function generateSeoRefresh({ label, body }) {
  const provider = currentProvider();
  const result =
    provider === "openai"
      ? await openaiGenerateSeoRefresh({ label, body })
      : provider === "anthropic"
      ? await anthropicGenerateSeoRefresh({ label, body })
      : mockGenerateSeoRefresh({ label, body });

  await logUsage(provider, "seo_refresh", result.tokensEstimate, result.costEstimateUsd);
  const withFallback = applySeoFallback(result, {
    fallbackTitle: label,
    fallbackDescription: body,
    context: `SEO refresh for "${label}"`,
  });
  return { ...enforceSeoLength(withFallback), provider };
}

export async function generateGlossaryEntry(term) {
  const provider = currentProvider();
  const result =
    provider === "openai"
      ? await openaiGenerateGlossary(term)
      : provider === "anthropic"
      ? await anthropicGenerateGlossary(term)
      : mockGenerateGlossary(term);

  await logUsage(provider, "glossary", result.tokensEstimate, result.costEstimateUsd);
  return enforceSeoLength(applySeoFallback(result, {
    fallbackTitle: result.term,
    fallbackDescription: result.short_definition,
    context: `glossary entry "${result.term}"`,
  }));
}
