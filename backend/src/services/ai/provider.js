// The one place the rest of the app calls into to generate content. It
// picks the right provider based on AI_PROVIDER in .env, and always logs
// what it cost so the admin panel's usage tracker stays accurate.
import { query } from "../../db.js";
import { mockGenerateArticle, mockGenerateGlossary, mockGenerateAnalysis, mockGenerateSeoRefresh, mockCheckRedundancy, mockCheckAnalysisFreshness } from "./mockProvider.js";
import { openaiGenerateArticle, openaiGenerateGlossary, openaiGenerateAnalysis, openaiGenerateSeoRefresh, openaiCheckRedundancy, openaiCheckAnalysisFreshness } from "./openaiProvider.js";
import { anthropicGenerateArticle, anthropicGenerateGlossary, anthropicGenerateAnalysis, anthropicGenerateSeoRefresh, anthropicCheckRedundancy, anthropicCheckAnalysisFreshness } from "./anthropicProvider.js";
import { normalize, jaccardSimilarity, DUPLICATE_SIMILARITY_THRESHOLD } from "../rss/grouping.js";
import { BANNED_PHRASES } from "./prompts.js";

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

// Analysis pieces are the one category allowed to run long (5-7
// paragraphs - real synthesis/context, not a padded rewrite) - see
// generateAnalysis() below and buildAnalysisPrompt()'s length override in
// prompts.js. Every other category stays on MAX_BODY_PARAGRAPHS.
const ANALYSIS_MAX_BODY_PARAGRAPHS = 7;

// Verification in code, not just hope in the prompt - the same principle
// that made Structured Outputs replace prompt-only instructions for
// seo_title/seo_description. Checked once per generation, retried once
// with an explicit correction note if it fails, then accepted as-is
// either way - never retried more than once, so a persistently bad draft
// can't loop. Reuses the exact same word-overlap function and similarity
// bar as the pre-save duplicate-article check (articleUtils.js): every
// paragraph from the second on is compared against every paragraph before
// it (not just its immediate neighbor), and the worst (highest-similarity)
// match wins - generalized from the old hardcoded "para 2 vs para 1, para
// 3 vs para 1 or para 2" so it still catches redundancy in a longer
// Analysis body (paragraph 6 restating paragraph 2, say), not just a
// 3-paragraph news brief.
//
// Known limitation, worth knowing rather than hiding: this only catches
// LEXICAL redundancy (shared words). A paragraph that restates an
// earlier point in fully paraphrased language - different vocabulary,
// same underlying claim - can still slip through, because Jaccard
// similarity has no notion of meaning, only word overlap. Confirmed
// this in practice against article 138: its paragraph 3 restates
// paragraph 2's "this validates confidence/strategic significance" point
// in almost entirely different words, and measures at ~0.08-0.11 overlap
// against paragraphs 1 and 2 - nowhere near the 0.6 bar. That gap is
// inherent to word-overlap similarity, not a bug in this check.
// Verification in code for a rule that had none, despite existing in the
// prompt since STYLE_INSTRUCTIONS' first version - real regression: "Market
// participants will be closely monitoring the Fed's stance..." (article
// 332) and "This divergence in focus underscores Bitcoin's unique
// position..." (article 338) both shipped with an explicitly banned word,
// found during a real batch-generation audit. Every other STYLE_INSTRUCTIONS
// rule with a documented real failure eventually got a code-level check
// (numbers, causal claims, attribution, the ETF-price rule) - this one
// just hadn't yet. Case-insensitive substring match against
// BANNED_PHRASES (prompts.js) - deliberately simple, since these are
// fixed phrases, not a pattern needing regex flexibility.
export function findBannedWordViolation(body) {
  const haystack = (body || "").toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (haystack.includes(phrase.toLowerCase())) {
      return `the body uses "${phrase}," which STYLE_INSTRUCTIONS explicitly forbids`;
    }
  }
  return null;
}

// Originality/plagiarism safeguard - verified before building this that
// nothing in the codebase measured a generated article's phrasing
// against its OWN source RSS content (every existing similarity check
// compares against OTHER already-published articles, never the source
// material being rewritten - isDuplicateInCategory, findAnalysisSimilarityMismatch,
// the audit's duplicate-in-category pass, all article-vs-article).
// Confirmed the gap was real, not hypothetical: sampled 18 real published
// articles against their live source RSS items and found genuine close
// paraphrasing, not just topical overlap - e.g. real article 211
// ("Bitcoin Down 1.5% in September") vs its CoinDesk source: "Bitcoin is
// down just 1.5% in its historically weakest month and remains on track
// for its first quarterly gain in a year, despite rising rates..." became
// "Bitcoin is down 1.5% in September, historically its weakest month, but
// remains on track for its first quarterly gain in a year amid rising
// interest rates..." - the same clause order and structure with light
// word-swaps, not independent phrasing of the same fact.
//
// Threshold calibrated from that real sample, not guessed: the 5
// genuinely-too-close real cases found (articles 211, 240, 231, 242, 210)
// scored 0.379-0.516 sentence-vs-source Jaccard similarity; clearly
// independent rewrites of the same facts (articles 233, 228, 209, 207)
// scored 0.045-0.263. One real case (article 236) sits right in the
// middle at 0.385 despite reading as genuinely independent phrasing -
// pure word-overlap can't perfectly separate "same facts, copied
// structure" from "same facts, coincidentally overlapping vocabulary,"
// the identical limitation already documented for
// findAnalysisSimilarityMismatch and isDuplicateInCategory. Set at 0.35
// (comfortably catching all 5 real concerning cases) accepting that an
// occasional independently-phrased article like 236 will also get
// flagged - acceptable here specifically because this routes to human
// review, not a silent rejection, the same tolerance this project
// already extends to every other check with unavoidable false positives.
const SOURCE_PHRASING_SIMILARITY_THRESHOLD = 0.35;

function splitIntoSentences(text) {
  return (text || "").split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 10);
}

export function findSourcePhrasingTooClose(body, sourceText) {
  if (!sourceText) return null; // Analysis has no RSS source text to check against

  const sourceWords = normalize(sourceText);
  if (sourceWords.length === 0) return null;

  for (const sentence of splitIntoSentences(body)) {
    const similarity = jaccardSimilarity(normalize(sentence), sourceWords);
    if (similarity >= SOURCE_PHRASING_SIMILARITY_THRESHOLD) {
      return `a sentence in the body is ${Math.round(similarity * 100)}% similar (word-overlap) to the source material's own phrasing: "${sentence.trim()}" - restate this fact in genuinely different sentence structure, not a light paraphrase of the source's own wording.`;
    }
  }
  return null;
}

// Paragraph-2 formulaic transition - first observed anecdotally in
// articles #324-327 ("This [noun] highlights/indicates/suggests..."
// opening paragraph 2), then measured properly before building anything:
// sampled the 60 most recent News articles with a real paragraph 2 and
// found 15/60 (25%) opened it with this exact "This <word> <verb>" shape,
// e.g. "This scenario highlights the emotional and financial strain..."
// (article 435), "This move highlights the ECB's influence..." (article
// 236), "This projection signals strong confidence..." (article 203).
// 25% is a real, meaningful incidence - a quarter of all News output
// leaning on the identical connective tissue - even though it's lower
// than the near-universal (94%/76%) formulaic opening/closing patterns
// found in Analysis, because News paragraphs are shorter and have less
// room for structural variety to begin with. Deterministic regex, not an
// LLM call, since the pattern itself is a fixed grammatical shape
// (This + noun + verb-from-a-small-set), the same reasoning already
// applied to findBannedWordViolation and hasFormulaicOpening/
// hasFormulaicClosing (analysis side) - cheap, exact, and testable
// without mocking a model response.
// Widened after a real regression: article #626 (Outcrop Silver) had this
// exact pattern - "This increase highlights the potential of the
// project..." - as the SECOND SENTENCE of paragraph 1, not the opening of
// paragraph 2, so the original paragraph-2-only check never saw it. The
// pattern is a fixed grammatical shape regardless of WHERE it lands in
// the body, so the check now scans every sentence (reusing
// splitIntoSentences, which already splits on paragraph breaks too - see
// its own regex), not just paragraph 2's first sentence.
const FORMULAIC_TRANSITION_RE = /^this\s+\w+\s+(highlights|indicates|suggests|reflects|signals|underscores|demonstrates)\b/i;

export function findFormulaicParagraphTransition(body) {
  for (const sentence of splitIntoSentences(body)) {
    const trimmed = sentence.trim();
    const match = trimmed.match(FORMULAIC_TRANSITION_RE);
    if (match) {
      const preview = trimmed.length > 90 ? `${trimmed.slice(0, 90)}...` : trimmed;
      return `the body contains the formulaic "This ${match[0].split(/\s+/)[1]} ${match[1]}..." transition ("${preview}") - restate the connection in a genuinely different sentence shape, not this recurring template.`;
    }
  }
  return null;
}

// "Who this matters to" generic-significance filler - promoted from a
// prompt-only STYLE_INSTRUCTIONS rule to a code-level check after real
// measurement showed the instruction alone only partially holds: 18%
// incidence (18/100) before the instruction was added, 13.8% (8/58) in a
// fresh real batch after it - a real but partial reduction, the same
// "instructions alone don't reliably hold" lesson findFormulaicParagraphTransition
// and every other code-level check in this file already teaches. Real
// examples still slipping through post-instruction: articles #761
// ("This incident raises concerns about the security of customer data...")
// and #775 ("This update is crucial for enhancing user experience...").
// Deterministic pattern match, not an LLM call - these are fixed
// grammatical constructions, the same reasoning as findBannedWordViolation
// and findFormulaicParagraphTransition.
const GENERIC_SIGNIFICANCE_FILLER_PATTERNS = [
  { re: /\bis (?:particularly |especially )?(?:relevant|significant|important|critical|crucial) (?:for|to)\b/i, label: "is [particularly] relevant/significant/important/critical/crucial for" },
  { re: /\bis a (?:positive|negative|good|bad) (?:indicator|sign|signal)\b/i, label: "is a positive/negative indicator" },
  { re: /\bsuggest(?:s|ing) (?:enhanced|improved|reduced|diminished|increased|decreased) prospects\b/i, label: "suggests enhanced/improved/reduced/diminished prospects" },
  { re: /\braises concerns about\b/i, label: "raises concerns about" },
  { re: /\braises questions about\b/i, label: "raises questions about" },
  { re: /\bunderscores the importance of\b/i, label: "underscores the importance of" },
  { re: /\breflects (?:the )?(?:growing|increasing|broader)\b/i, label: "reflects the growing/increasing/broader" },
];

export function findGenericSignificanceFiller(body) {
  for (const sentence of splitIntoSentences(body)) {
    for (const pattern of GENERIC_SIGNIFICANCE_FILLER_PATTERNS) {
      if (pattern.re.test(sentence)) {
        const trimmed = sentence.trim();
        const preview = trimmed.length > 110 ? `${trimmed.slice(0, 110)}...` : trimmed;
        return `the body uses the generic-significance filler construction "${pattern.label}" instead of naming a concrete detail - restate this with the SPECIFIC mechanism (a concrete next step, a named consequence, a number that changes as a result) or drop the sentence. Real sentence: "${preview}"`;
      }
    }
  }
  return null;
}

// Mechanical fallback for one real retry limitation: the model's own retry
// (already given findGenericSignificanceFiller's problem description as a
// correction note) doesn't reliably fix the sentence, and generateArticle/
// generateAnalysis only ever retry ONCE - a still-dirty retry today just
// ships as-is to review. This is a targeted mechanical fix for THAT one
// check specifically, not a general "clean up the draft" pass, because
// it's the one case where the fix is mechanically safe: the flagged
// construction (findGenericSignificanceFiller) is always a bolted-on
// editorializing clause layered onto a sentence, not the sentence's only
// content - UNLESS stripping it away leaves nothing concrete behind.
//
// Real risk this guards against, not hypothetical: findGenericSignificanceFiller
// flags whole SENTENCES, and a flagged sentence can carry a real fact
// alongside the filler construction - e.g. "This update is crucial for
// enhancing user experience, adding two new API endpoints" (article #775's
// own shape). Blindly dropping the whole sentence would lose the API-
// endpoint fact along with the filler. So this strips only the matched
// filler CLAUSE (from the nearest preceding comma/semicolon to the
// nearest following one, or a sentence boundary) and keeps the rest,
// falling back to dropping the whole sentence only when what's left is
// under ~15 characters or has no digit/proper-noun content left to anchor
// it (hasConcreteContent below) - the same bar findRedundancyCheck's own
// anchor-fact question uses, applied here mechanically instead of by an
// LLM. If a paragraph's only sentence gets fully dropped, the empty
// paragraph is removed entirely rather than left as a gap.
//
// Applied ONLY after the retry has already happened once (see
// generateArticle/generateAnalysis below) - a draft that can still be
// fixed by asking the model again gets that chance first; this is the
// last resort, not the first response to a filler hit.
function hasConcreteContent(text) {
  if (/\d/.test(text)) return true;
  // A capitalized word anywhere after the first character counts as a
  // proper noun/acronym - the first character is excluded because the
  // caller always capitalizes it regardless of what was there before.
  return /\b[A-Z][A-Za-z]*\b/.test(text.slice(1));
}

function stripFillerClauseFromSentence(sentence) {
  let filler = null;
  for (const pattern of GENERIC_SIGNIFICANCE_FILLER_PATTERNS) {
    const m = sentence.match(pattern.re);
    if (m) {
      filler = m;
      break;
    }
  }
  if (!filler) return sentence;

  const matchStart = filler.index;
  const matchEnd = matchStart + filler[0].length;
  const beforeText = sentence.slice(0, matchStart);
  const afterText = sentence.slice(matchEnd);

  const lastBoundaryBefore = Math.max(beforeText.lastIndexOf(","), beforeText.lastIndexOf(";"));
  const clauseStart = lastBoundaryBefore === -1 ? 0 : lastBoundaryBefore + 1;

  const nextCommaAfter = afterText.indexOf(",");
  const nextSemiAfter = afterText.indexOf(";");
  const candidates = [nextCommaAfter, nextSemiAfter].filter((i) => i !== -1);
  const clauseEndRel = candidates.length ? Math.min(...candidates) : afterText.length;
  const clauseEnd = matchEnd + clauseEndRel;
  const boundaryChar = sentence[clauseEnd];
  const hadBoundary = boundaryChar === "," || boundaryChar === ";";

  const before = sentence.slice(0, clauseStart).replace(/[,;]\s*$/, "").trim();
  const after = sentence.slice(clauseEnd + (hadBoundary ? 1 : 0)).trim();

  let remainder = before && after ? `${before}, ${after}` : before || after;
  remainder = remainder.trim();
  if (!remainder) return "";
  if (!/[.!?]$/.test(remainder)) remainder += ".";
  return remainder.charAt(0).toUpperCase() + remainder.slice(1);
}

// Exported for direct testing against real flagged sentences (see
// provider.test.js) - operates paragraph-by-paragraph (not on the flat,
// paragraph-break-collapsing splitIntoSentences output) so paragraph
// structure survives, and never touches a paragraph/sentence
// findGenericSignificanceFiller doesn't itself flag. Returns the body
// unchanged (same string) when nothing was flagged, so callers can check
// `=== body` to know whether anything actually changed.
export function stripGenericSignificanceFillerClauses(body) {
  const paragraphs = (body || "").split(/\n\n+/).filter((p) => p.trim().length > 0);
  let changed = false;
  const resultParagraphs = [];

  for (const paragraph of paragraphs) {
    const sentences = paragraph.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    const newSentences = [];
    for (const sentence of sentences) {
      const hasFiller = GENERIC_SIGNIFICANCE_FILLER_PATTERNS.some((p) => p.re.test(sentence));
      if (!hasFiller) {
        newSentences.push(sentence);
        continue;
      }
      changed = true;
      const stripped = stripFillerClauseFromSentence(sentence);
      if (stripped.length < 15 || !hasConcreteContent(stripped)) {
        continue; // drop the whole sentence - nothing concrete left to keep
      }
      newSentences.push(stripped);
    }
    const paragraphText = newSentences.join(" ").trim();
    if (paragraphText.length > 0) {
      resultParagraphs.push(paragraphText);
    }
    // else: this paragraph's only sentence(s) were fully dropped - the
    // paragraph is removed entirely rather than left as an empty gap.
  }

  return changed ? resultParagraphs.join("\n\n") : body;
}

// Dek-quality check, News-only (called from generateArticle, not
// verifyBody - a dek isn't part of the "body" concept the checks above
// share). Real regression: article #232's dek read "...with a tariff
// structure for GIP." - "GIP" (BlackRock's Global Infrastructure
// Partners) is expanded once, but only in the BODY's first paragraph; a
// reader who only sees the dek/teaser (a homepage card, a search result)
// has no way to know what GIP means. Deterministic, not an LLM call - an
// acronym either has a plausible expansion pattern in the dek text or it
// doesn't, which a regex can check exactly as reliably as a model would.
//
// KNOWN_FINANCE_ACRONYMS is deliberately short and generic - terms a
// finance-literate reader of this site is assumed to already know without
// inline expansion (the same "reader already knows what RSI/support/
// resistance ARE" reasoning buildAnalysisPrompt's noTextbookRule already
// applies elsewhere). A story-specific acronym like "GIP" is exactly what
// this list is NOT meant to cover.
// "ATM" added after a real false positive (a live Visa/Mastercard batch
// item): common English usage ("ATM fees"), not story-specific jargon,
// despite technically being an initialism.
const KNOWN_FINANCE_ACRONYMS = new Set([
  "CEO", "CFO", "COO", "CTO", "CIO", "IPO", "ETF", "ETFS", "GDP", "SEC", "CFTC", "FOMC", "FED",
  "NYSE", "NASDAQ", "OPEC", "LNG", "ECB", "IMF", "EU", "UK", "US", "USA", "UAE", "AI", "ESG",
  "EPS", "IRS", "CPI", "PPI", "ISM", "WTI", "GLD", "SPY", "QQQ", "RSI", "NFT", "DEFI", "ATM", "FX",
]);

export function findUnexplainedDekAcronym(dek) {
  if (!dek) return null;
  const candidates = dek.match(/\b[A-Z]{2,6}\b/g) || [];
  for (const acronym of candidates) {
    if (KNOWN_FINANCE_ACRONYMS.has(acronym)) continue;
    // A dek that already expands the acronym itself - "Global
    // Infrastructure Partners (GIP)" or "GIP (Global Infrastructure
    // Partners)" - has a parenthetical pairing somewhere; only flag when
    // neither pattern is present anywhere in the dek.
    const expandsBefore = new RegExp(`\\(${acronym}\\)`).test(dek);
    const expandsAfter = new RegExp(`${acronym}\\s*\\([^)]+\\)`).test(dek);
    if (expandsBefore || expandsAfter) continue;
    return `the dek uses "${acronym}" without expanding it anywhere in the dek itself - a reader who only sees the dek/teaser (not the body) won't know what this refers to. Spell it out on first use in the dek (e.g. "Global Infrastructure Partners (GIP)") or avoid the acronym there.`;
  }
  return null;
}

// Comparison-direction mismatch - the same category of check already
// built for Analysis (findAnalysisDistanceMismatch's direction
// verification), applied to News. Real regression: article #660 (Zcash)
// stated "other cryptocurrencies that already offer faster transaction
// times, such as Bitcoin, which has a block time of 10 minutes" - backwards,
// since Zcash's own new block time (stated earlier in the same body) is
// 25 seconds, and 10 minutes (600 seconds) is 24x LONGER, not faster. No
// existing check caught this: both numbers are individually real (not
// fabricated), findPriceMismatch/findPercentMismatch have nothing to
// check them against, and findSourcePhrasingTooClose only compares
// against source text, not the body's own internal consistency. This is
// a purely internal-consistency check - it never touches source material.
//
// Scoped specifically to time-duration comparisons (seconds/minutes/
// hours/days/milliseconds), not a general numeric-comparison engine -
// that's the one real example found so far, and building a broader
// dollar/percentage comparator without a second real case to calibrate
// against would be guessing at false-positive risk rather than measuring
// it, the same discipline this project applies everywhere else. Durations
// are also the one case where the comparison word's direction INVERTS
// against the raw number (a SMALLER duration is "faster"/"shorter"), so
// this can't reuse a simple bigger-number-means-more comparator even if
// one existed.
//
// Known limitation, worth stating plainly: when the compared value isn't
// in the same sentence (the real Zcash case - Zcash's own 25-second figure
// sat in an earlier sentence), this picks the nearest other duration
// mentioned anywhere else in the body as the reference. For a short,
// 2-3-paragraph news brief that's almost always the one real point of
// comparison, but a body with 3+ unrelated duration mentions could in
// principle pick the wrong one - the same class of imprecision this
// project already accepts for Jaccard-based checks, tolerable because
// this routes to human review, never a silent block.
const DURATION_RE = /(\d[\d,]*\.?\d*)\s*(milliseconds?|ms|seconds?|secs?|hours?|hrs?|minutes?|mins?|days?)\b/gi;
const FASTER_WORDS_RE = /\b(faster|quicker|shorter)\b/i;
const SLOWER_WORDS_RE = /\b(slower|longer)\b/i;

function durationToSeconds(rawValue, rawUnit) {
  const value = parseFloat(rawValue.replace(/,/g, ""));
  const unit = rawUnit.toLowerCase();
  if (unit === "ms" || unit.startsWith("millisecond")) return value / 1000;
  if (unit.startsWith("sec")) return value;
  if (unit.startsWith("min")) return value * 60;
  if (unit.startsWith("hour") || unit.startsWith("hr")) return value * 3600;
  if (unit.startsWith("day")) return value * 86400;
  return value;
}

// Only meaningful for the single-in-sentence fallback case (see below):
// when the article's OWN value sits in an earlier sentence, the sentence
// making the claim uses one of two grammatical shapes with opposite
// roles for the value it actually contains -
//   "such as Bitcoin, which has 10 minutes" (Bitcoin SHARES the claimed
//   property - here, is itself one of the "faster" ones)
// vs.
//   "faster than Bitcoin, which has 10 minutes" (Bitcoin is the baseline
//   being exceeded - the OPPOSITE of the claimed property).
// Whichever connector ("than" vs "such as"/"like"/"including") sits
// closer to the duration's own position in the sentence decides its
// role. Ambiguous (neither connector found) defaults to "same" - the
// simpler, more common shape (the real Zcash case).
function durationRoleInSentence(sentence, durationText) {
  const idx = sentence.indexOf(durationText);
  if (idx === -1) return "same";
  const before = sentence.slice(0, idx).toLowerCase();
  const thanIdx = before.lastIndexOf(" than ");
  const sameIdx = Math.max(before.lastIndexOf("such as"), before.lastIndexOf(" like "), before.lastIndexOf("including"));
  return thanIdx > sameIdx ? "opposite" : "same";
}

export function findComparisonDirectionMismatch(body) {
  const sentences = splitIntoSentences(body);

  const allDurations = [];
  sentences.forEach((sentence, sentenceIndex) => {
    for (const m of sentence.matchAll(DURATION_RE)) {
      allDurations.push({ seconds: durationToSeconds(m[1], m[2]), text: m[0], sentenceIndex });
    }
  });
  if (allDurations.length < 2) return null;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const claimsFaster = FASTER_WORDS_RE.test(sentence);
    const claimsSlower = SLOWER_WORDS_RE.test(sentence);
    if (!claimsFaster && !claimsSlower) continue;

    const inSentence = allDurations.filter((d) => d.sentenceIndex === i);
    if (inSentence.length === 0) continue;

    if (inSentence.length >= 2) {
      // Both compared values are right here - text order reliably matches
      // grammatical subject/object for this simpler, more common shape
      // ("A's 250ms is faster than B's 10 minutes").
      const [subject, reference] = inSentence;
      if (subject.seconds === reference.seconds) continue;
      if (claimsFaster && subject.seconds > reference.seconds) {
        return `the body describes "${subject.text}" as faster/quicker/shorter, but that is a LONGER duration than "${reference.text}" in the same sentence - a longer duration is slower, not faster. Real sentence: "${sentence.trim()}"`;
      }
      if (claimsSlower && subject.seconds < reference.seconds) {
        return `the body describes "${subject.text}" as slower/longer, but that is a SHORTER duration than "${reference.text}" in the same sentence - a shorter duration is faster, not slower. Real sentence: "${sentence.trim()}"`;
      }
      continue;
    }

    // Only one duration in this sentence - the real Zcash case, where the
    // article's own reference value sat in an earlier sentence. Its role
    // (does it share the claimed property, or is it the baseline being
    // exceeded?) has to be read from the connector word, not just
    // grammatical order - see durationRoleInSentence above.
    const inSentenceValue = inSentence[0];
    const reference = allDurations.find((d) => d.sentenceIndex !== i && d.seconds !== inSentenceValue.seconds);
    if (!reference) continue;
    // "same" role: this value is claimed to share the property (e.g. is
    // itself one of the "faster" ones) - it should sit on the expected
    // side of the reference. "opposite" role: this value is the baseline
    // being exceeded - it should sit on the OPPOSITE side of the reference.
    const sharesClaim = durationRoleInSentence(sentence, inSentenceValue.text) === "same";

    if (claimsFaster) {
      const violatesDirection = sharesClaim ? inSentenceValue.seconds > reference.seconds : inSentenceValue.seconds < reference.seconds;
      if (violatesDirection) {
        return `the body describes "${inSentenceValue.text}" as faster/quicker/shorter, but that is a LONGER duration than "${reference.text}" mentioned elsewhere in the body - a longer duration is slower, not faster. Real sentence: "${sentence.trim()}"`;
      }
    } else if (claimsSlower) {
      const violatesDirection = sharesClaim ? inSentenceValue.seconds < reference.seconds : inSentenceValue.seconds > reference.seconds;
      if (violatesDirection) {
        return `the body describes "${inSentenceValue.text}" as slower/longer, but that is a SHORTER duration than "${reference.text}" mentioned elsewhere in the body - a shorter duration is faster, not slower. Real sentence: "${sentence.trim()}"`;
      }
    }
  }
  return null;
}

// Vague cross-asset "ripple effects" claim - prompts.js's CROSS-ASSET
// IMPACT block already asks the model to state a concrete mechanism when
// it claims one asset affects another, but (confirmed by reading it, not
// assumed) nothing backs that instruction with a code-level check, the
// same "a prompt instruction alone isn't a guarantee" gap every other
// check in this file was built to close for its own pattern. Real
// regression: article #875 ("Bitcoin Faces Key Test on October 18 Amid
// New Tariffs") states "The decision will influence energy markets and
// could have ripple effects on cryptocurrency valuations" - vague enough
// that the real source article (CryptoSlate, fetched live to confirm)
// actually NAMES concrete transmission channels this draft dropped
// entirely (tariffs -> energy disruption -> inflation pressure -> Fed
// policy constraints -> higher yields/dollar strength -> reduced
// liquidity for risk assets including crypto), while the generated body
// just asserts an unexplained "ripple effect."
//
// Deliberately narrow, same shape as GENERIC_SIGNIFICANCE_FILLER_PATTERNS
// above: a small, explicit allowlist of vague impact phrases, only flagged
// when the same sentence also names another asset/market AND contains
// none of a small allowlist of concrete mechanism nouns. A sentence that
// DOES name a mechanism ("...could affect Bitcoin as investors rotate into
// higher-yield bonds") is exactly the CROSS-ASSET IMPACT block working as
// intended and is correctly left alone.
const VAGUE_CROSS_ASSET_PHRASE_RE = /\b(ripple effects?|could impact|may impact|could affect|may affect|has implications for)\b/i;
// "stocks?"/"equities" as bare words were tried and dropped after a real
// spot-check (150 recent articles) false positive: article #855 ("Zscaler
// CEO Jay Chaudhry Sells 2,852 Shares") matched on "executive stock
// movements at Zscaler" - a company's OWN stock, not a genuinely different
// other asset - so this uses the market-level phrasing instead, which
// doesn't false-positive on a single company's own shares.
const NAMED_OTHER_ASSET_RE = /\b(bitcoin|btc|ethereum|eth|gold|s&p ?500|nasdaq|dow|the stock market|equity markets|oil|wti|the dollar|treasur(?:y|ies)|bonds?|stablecoins?|crypto|cryptocurrenc(?:y|ies)|altcoins?)\b/i;
const CROSS_ASSET_MECHANISM_RE = /\b(inflation|interest rates?|rate hikes?|rate cuts?|\bfed\b|hash rate|energy costs?|electricity costs?|energy prices?|yields?|dollar strength)\b/i;

export function findVagueCrossAssetClaim(body) {
  for (const sentence of splitIntoSentences(body)) {
    if (!VAGUE_CROSS_ASSET_PHRASE_RE.test(sentence)) continue;
    if (!NAMED_OTHER_ASSET_RE.test(sentence)) continue;
    if (CROSS_ASSET_MECHANISM_RE.test(sentence)) continue;
    const trimmed = sentence.trim();
    const preview = trimmed.length > 110 ? `${trimmed.slice(0, 110)}...` : trimmed;
    return `the body claims a cross-asset "ripple effect"/impact without naming a concrete mechanism (inflation, rates/Fed, hash rate, energy/electricity cost, yield, dollar strength) - restate with the SPECIFIC transmission channel from the source material, or drop the claim. Real sentence: "${preview}"`;
  }
  return null;
}

// Stale role/title assertion - real regression: article #875 ("Bitcoin
// Faces Key Test on October 18 Amid New Tariffs") stated "former President
// Trump prepares to implement new tariffs on Russia" - Trump is the
// sitting US president (second term since January 2025). Root cause
// investigated before building this, not assumed: fetched the real source
// (CryptoSlate) live and confirmed it never says "former President"
// anywhere, only "President Donald Trump" - this was inserted by the
// model from its own (in this case simply wrong, not even stale) general
// knowledge, not copied from the source. Same failure category as
// findStaleForwardLookingDate just below: the model asserting a status
// from its own training-data knowledge instead of the article's own
// current-tense framing, just for a person's office instead of a year.
//
// Deliberately narrow, per the same discipline as every other check in
// this file: this does NOT attempt to verify anyone's current role in
// general (that needs live external knowledge this codebase has no way to
// fetch) - it only flags "former <title> <name>" for a small, explicitly-
// curated list of currently-serving office holders relevant to this
// site's beat, paired with a present/future-tense verb in the same
// sentence describing them actively exercising that role's powers.
//
// CURRENTLY_SERVING_OFFICE_HOLDERS encodes real-world state that WILL go
// stale and needs periodic manual review - unlike every other check in
// this file, that's a real, ongoing cost worth stating plainly rather than
// pretending this is "build once, done." Confirmed how real that risk is
// while building this: Kevin Warsh replaced Jerome Powell as Fed Chair in
// May 2026 - after this model's own January 2026 knowledge cutoff. Every
// name below was verified with a live search before being written, not
// recalled from training data, specifically to avoid baking a second
// stale-title bug into the fix for the first one.
const CURRENTLY_SERVING_OFFICE_HOLDERS = [
  // Verified live 2026-09-20 - re-verify periodically, do not extend this
  // list from memory.
  { title: "President", surname: "Trump" },
  { title: "Fed Chair", surname: "Warsh" },
  { title: "Federal Reserve Chair", surname: "Warsh" },
  { title: "Federal Reserve Chairman", surname: "Warsh" },
  { title: "ECB President", surname: "Lagarde" },
  { title: "Treasury Secretary", surname: "Bessent" },
];

// Present/future-tense verbs describing someone actively exercising a
// role's powers (signing, ordering, imposing) rather than just being
// mentioned in passing - narrower than a generic present-tense check so
// this doesn't fire on, say, "former President Bush spoke at the event."
//
// Known limitation, found during a real 150-article spot-check rather than
// hidden: this only catches the self-contradicting SAME-SENTENCE pattern
// (a stale title paired with an active-role verb), not every wrong "former
// <title>" mention - article #823 ("House Committee Advances Bill for
// Strategic Bitcoin Reserve") also incorrectly says "former President
// Trump's plan," with no active-role verb nearby, and this check does not
// catch it. Broadening to "any 'former <title> <surname>' where surname is
// in CURRENTLY_SERVING_OFFICE_HOLDERS, verb or not" was considered and
// deliberately not done here - it's a reasonable next step once there's
// more than one real example to calibrate the false-positive risk against
// (a passing reminiscence like "former President Bush's 2008 remarks
// still shape policy" has no active verb either but is a correct use of
// "former"), the same "don't build to a single data point" discipline
// this project applies everywhere else.
const ACTIVE_ROLE_VERB_RE = /\b(prepares? to|is set to|are set to|will\b|signs?\b|announces?\b|implements?\b|imposes?\b|orders?\b|directs?\b|declares?\b)\b/i;

export function findStaleRoleAssertion(body) {
  for (const sentence of splitIntoSentences(body)) {
    for (const holder of CURRENTLY_SERVING_OFFICE_HOLDERS) {
      const formerRe = new RegExp(`\\bformer\\s+(?:U\\.?S\\.?\\s+|the\\s+)?${holder.title}\\s+(?:\\w+\\s+)?${holder.surname}\\b`, "i");
      if (formerRe.test(sentence) && ACTIVE_ROLE_VERB_RE.test(sentence)) {
        return `the body calls ${holder.surname} a "former ${holder.title}" while the same sentence describes them actively exercising that role's powers - ${holder.surname} is the CURRENTLY serving ${holder.title} as of this check's last manual review, so this reads as an incorrect/stale title, not a genuine former-officeholder reference. Real sentence: "${sentence.trim()}"`;
      }
    }
  }
  return null;
}

// Stale forward-looking date claim - real regression, worse than a
// filler-sentence issue because it directly damages credibility: article
// #759 (Bastion Platforms), published 2026-09-19, stated "Bastion aims to
// launch its services in early 2024" as a pending future milestone. Root
// cause investigated before building this, not assumed: the RSS item's
// own pubDate WAS genuinely fresh (a real CoinTelegraph story published
// the same day), and the real source article, fetched live, never
// mentions "2024" anywhere - the date was invented outright by the model
// from its own training-data knowledge of the real company, not copied
// from a stale source. This means:
//   - FRESHNESS_WINDOW_HOURS/filterFreshItems() (scanAndGenerate.js) is
//     NOT the gap here and needed no change - it already exists, already
//     checks the item's real pubDate, and correctly found nothing wrong
//     with this genuinely-fresh item.
//   - findStaleSubjectMention (scanAndGenerate.js) also could not have
//     caught this - it checks whether the SOURCE material's own text
//     mentions a past year, and the source never mentions 2024 at all.
//   - findSourcePhrasingTooClose doesn't apply either - it measures
//     wording similarity to the source, not factual/temporal grounding.
// This is a distinct failure mode from all of the above: a forward-
// looking claim ("aims to," "plans to," "is set to," "will," "expected
// to," "upcoming") paired with a specific year that has already passed
// relative to TODAY'S real date - catchable purely by reading the
// generated body against the real clock, independent of what the RSS
// item's metadata says. This also catches the case STYLE_INSTRUCTIONS'
// own "don't invent a number" rule doesn't reliably prevent (an invented
// date is exactly that failure, restated with the same lesson this whole
// project keeps relearning: a prompt instruction alone isn't a guarantee).
//
// Scoped to full years only (not month/quarter precision) - the one real
// case found is a 2-year gap, and month-level "is January still valid to
// call upcoming in December" edge cases aren't evidenced yet; building
// that without a real failure to calibrate against would be guessing at
// false-positive risk rather than measuring it.
const FORWARD_LOOKING_RE = /\b(aims? to|plans? to|is set to|are set to|will|is expected to|are expected to|expects? to|scheduled to|upcoming)\b/i;
const YEAR_REFERENCE_RE = /\b(?:(early|mid|late)\s+)?(?:(Q[1-4])\s+)?(20\d{2})\b/gi;

export function findStaleForwardLookingDate(body, now = new Date()) {
  const currentYear = now.getUTCFullYear();
  for (const sentence of splitIntoSentences(body)) {
    if (!FORWARD_LOOKING_RE.test(sentence)) continue;
    for (const m of sentence.matchAll(YEAR_REFERENCE_RE)) {
      const year = parseInt(m[3], 10);
      if (year < currentYear) {
        return `the body states a forward-looking claim referencing "${m[0].trim()}," but that year has already passed (current year: ${currentYear}) - this reads as a pending/future event that is actually stale, not current news. Real sentence: "${sentence.trim()}"`;
      }
    }
  }
  return null;
}

function findBodyProblem(body, maxParagraphs = MAX_BODY_PARAGRAPHS) {
  const paragraphs = (body || "").split("\n\n").filter((p) => p.trim().length > 0);

  if (paragraphs.length > maxParagraphs) {
    return `the body has ${paragraphs.length} paragraphs but the limit is ${maxParagraphs}`;
  }

  const normalized = paragraphs.map((p) => normalize(p));
  for (let i = 1; i < normalized.length; i++) {
    let worst = null;
    for (let j = 0; j < i; j++) {
      const similarity = jaccardSimilarity(normalized[i], normalized[j]);
      if (!worst || similarity > worst.similarity) worst = { against: j, similarity };
    }
    if (worst && worst.similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
      return `paragraph ${i + 1} repeats information already in paragraph ${worst.against + 1} (${Math.round(worst.similarity * 100)}% word overlap) instead of adding new information`;
    }
  }

  return null;
}

// Extracted from generateArticle() so generateAnalysis() can run the exact
// same lexical + semantic verification pipeline instead of a separate,
// weaker check of its own - just parameterized on maxParagraphs (3 for a
// news brief, 7 for Analysis) since the redundancy-API call itself still
// only looks at the first 3 paragraphs (the "fact, why it matters, new
// detail" shape every article - including the first 3 paragraphs of a
// longer Analysis piece - is expected to follow); paragraphs beyond that
// are still covered by findBodyProblem()'s lexical pairwise check above,
// just not by the extra semantic API call.
// sourceText (optional): the original RSS title/snippet(s) this draft was
// written from - only generateArticle() (news pipeline) has this;
// generateAnalysis() passes nothing, since an Analysis piece is grounded
// in computed snapshot numbers, not RSS source text, so the causal-claim
// question below has nothing to check against for that path (the prompt
// is told to always answer false in that case - see buildRedundancyCheckPrompt).
async function verifyBody(body, provider, maxParagraphs, sourceText) {
  const bannedWordProblem = findBannedWordViolation(body);
  if (bannedWordProblem) return { problem: bannedWordProblem };

  const phrasingProblem = findSourcePhrasingTooClose(body, sourceText);
  if (phrasingProblem) return { problem: phrasingProblem };

  const transitionProblem = findFormulaicParagraphTransition(body);
  if (transitionProblem) return { problem: transitionProblem };

  const fillerProblem = findGenericSignificanceFiller(body);
  if (fillerProblem) return { problem: fillerProblem };

  const comparisonProblem = findComparisonDirectionMismatch(body);
  if (comparisonProblem) return { problem: comparisonProblem };

  const vagueCrossAssetProblem = findVagueCrossAssetClaim(body);
  if (vagueCrossAssetProblem) return { problem: vagueCrossAssetProblem };

  const staleDateProblem = findStaleForwardLookingDate(body);
  if (staleDateProblem) return { problem: staleDateProblem };

  const staleRoleProblem = findStaleRoleAssertion(body);
  if (staleRoleProblem) return { problem: staleRoleProblem };

  const lexicalProblem = findBodyProblem(body, maxParagraphs);
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
    sourceText,
  });
  if (!redundancyCheck.adds_new_information) {
    return { problem: `an independent redundancy check found paragraph 3 doesn't add new information: ${redundancyCheck.reason}` };
  }
  if (!redundancyCheck.paragraph1_has_anchor_fact) {
    return { problem: `an independent check found paragraph 1 lacks a genuine anchor fact: ${redundancyCheck.anchor_fact_reason}` };
  }
  // Honest limitation, worth restating here where the result is actually
  // acted on: this is one LLM judging another LLM's reasoning, not a
  // deterministic diff like the checks above - it can miss a subtler
  // invented connection than the real one that motivated it. Still routed
  // exactly the same as the other two questions (a single retry, then
  // accepted either way) rather than trusted less or more than them.
  if (redundancyCheck.unsupported_causal_claim) {
    return { problem: `an independent check found an unsupported causal claim: ${redundancyCheck.causal_claim_reason}` };
  }
  // Real regression this catches: article #429 stated a BOJ rate hike and
  // the yen weakening right after, with zero acknowledgment that this runs
  // against typical expectation (a hike would normally be expected to
  // support the currency) - read as confusing rather than reported. This
  // is deliberately the counterpart to the causal-claim check just above,
  // not a duplicate of it: that one catches an INVENTED explanation for a
  // tension, this one catches a real tension left completely silent. See
  // buildRedundancyCheckPrompt's question 4 for exactly where the line is
  // drawn - stating plainly that the source doesn't resolve the tension
  // satisfies this without ever tripping the causal-claim check.
  if (redundancyCheck.unacknowledged_divergence) {
    return { problem: `an independent check found the brief states two facts that read as counterintuitive without acknowledging the tension: ${redundancyCheck.divergence_reason}. Add a brief, plain acknowledgment that the source material doesn't address the reason for this (e.g. "the reason for this divergence wasn't addressed in the available coverage") - do not invent a cause.` };
  }
  return { problem: null };
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
async function generateRedundancyCheck({ paragraph1, paragraph2, paragraph3, sourceText }) {
  const provider = currentProvider();
  const result =
    provider === "openai"
      ? await openaiCheckRedundancy({ paragraph1, paragraph2, paragraph3, sourceText })
      : provider === "anthropic"
      ? await anthropicCheckRedundancy({ paragraph1, paragraph2, paragraph3, sourceText })
      : mockCheckRedundancy({ paragraph1, paragraph2, paragraph3, sourceText });
  await logUsage(provider, "redundancy_check", result.tokensEstimate, result.costEstimateUsd);
  return result;
}

// Exported (unlike generateRedundancyCheck above) because runAnalysis.js
// calls this directly, one level up from generateAnalysis() - it needs
// the prior published article for this instrument, which generateAnalysis()
// has no reason to know about. Added after auditPublishedAnalysis.js found
// a real gap the deterministic similarity check can't close (see
// ANALYSIS_FRESHNESS_CHECK_FIELDS in schemas.js) - mirrors
// generateRedundancyCheck's shape exactly, just a different prompt/schema
// and a different, narrower question.
export async function generateAnalysisFreshnessCheck({ body, priorArticleBody }) {
  const provider = currentProvider();
  const result =
    provider === "openai"
      ? await openaiCheckAnalysisFreshness({ body, priorArticleBody })
      : provider === "anthropic"
      ? await anthropicCheckAnalysisFreshness({ body, priorArticleBody })
      : mockCheckAnalysisFreshness({ body, priorArticleBody });
  await logUsage(provider, "analysis_freshness_check", result.tokensEstimate, result.costEstimateUsd);
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
// paragraph2Directive (optional): the code-chosen instruction string for
// paragraph 2's explanatory framing (services/ai/newsParagraph2Templates.js,
// scanAndGenerate.js selects the actual template/id and passes its
// .instruction through here) - the same "code chooses, model complies"
// mechanism already proven for Analysis's opening/closing templates.
// isThinSource (optional): true when scanAndGenerate.js's
// groupHasNoSubstantiveContent() found no source in this group supplies
// real content beyond a headline - told to the model up front (see
// buildArticlePrompt's thinSourceBlock) instead of only ever being caught
// after generation by findStaleOrThinSource/findPriceMismatch. Real
// regression this fixes: a headline-only item produced a specific,
// invented Nasdaq level roughly half the real cached one - the after-the-
// fact check correctly caught it, but a thin source tempting the model to
// fabricate a specific number in the first place is exactly why Stocks/
// Indices (whose main feeds return no contentSnippet at all) so rarely
// produce a clean, auto-publishable draft.
export async function generateArticle(items, previousCoverage, assignedCategoryName, paragraph2Directive, isThinSource) {
  const provider = currentProvider();

  // Same shape scanAndGenerate.js already builds for its own source-text
  // checks (findCommodityPriceMismatch etc.) - the original title/snippet(s)
  // this draft was written from, so the causal-claim question in
  // verifyBody() below has real material to check against instead of
  // nothing (see its comment).
  const sourceText = items.map((i) => `${i.sourceName}: "${i.title}"${i.contentSnippet ? ` - ${i.contentSnippet}` : ""}`).join("\n");

  async function callProvider(correctionNote) {
    const result =
      provider === "openai"
        ? await openaiGenerateArticle(items, previousCoverage, correctionNote, paragraph2Directive, isThinSource)
        : provider === "anthropic"
        ? await anthropicGenerateArticle(items, previousCoverage, correctionNote, paragraph2Directive, isThinSource)
        : mockGenerateArticle(items, previousCoverage, correctionNote, assignedCategoryName);
    await logUsage(provider, "article", result.tokensEstimate, result.costEstimateUsd);
    return result;
  }

  // Runs every check (dek + body) against one draft and returns a single
  // problem description (or null if it's clean) - used both on the first
  // draft and, if a retry fires, again on the retried draft. Re-running it
  // on the retried draft (not just trusting the retry worked) is what lets
  // callers know the article is actually clean enough for the delayed-
  // auto-publish path (scanAndGenerate.js) rather than just "was retried
  // and moved on regardless," which was fine when every non-auto-publish
  // draft was heading to indefinite review anyway but isn't precise enough
  // now. The dek-acronym check runs first: it's a trivial, free check with
  // no reason to wait on verifyBody's paragraph parsing.
  async function verifyDraft(draft) {
    const dekProblem = findUnexplainedDekAcronym(draft.dek);
    if (dekProblem) return { problem: dekProblem };
    return verifyBody(draft.body, provider, MAX_BODY_PARAGRAPHS, sourceText);
  }

  let result = await callProvider();
  let { problem } = await verifyDraft(result);
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
    let retryProblem = (await verifyDraft(result)).problem;
    // Mechanical last resort, findGenericSignificanceFiller only, post-retry
    // only - see stripGenericSignificanceFillerClauses's own comment for why
    // this one check specifically gets a mechanical fix instead of just
    // accepting a still-dirty retry.
    if (retryProblem && findGenericSignificanceFiller(result.body)) {
      const stripped = stripGenericSignificanceFillerClauses(result.body);
      if (stripped !== result.body) {
        result = { ...result, body: stripped };
        retryProblem = (await verifyDraft(result)).problem;
      }
    }
    verificationClean = !retryProblem;
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
// context (optional): { relatedCoverage, calendarContext } - see
// runAnalysis.js for where these come from (recent same-asset coverage
// already published in the regular news categories, and any imminent
// high-impact calendar event) and prompts.js's buildAnalysisPrompt for how
// they're turned into prompt text. Both are genuinely optional: an asset
// with no recent related coverage and no imminent calendar event still
// gets a perfectly valid Analysis piece from the snapshot numbers alone,
// same as before this feature existed.
//
// Runs the exact same verifyBody() pipeline generateArticle() does (see
// its comment above), just with ANALYSIS_MAX_BODY_PARAGRAPHS instead of
// MAX_BODY_PARAGRAPHS and verificationClean now actually returned - it
// used to retry once on a lexical problem but never surfaced whether the
// retry actually worked, so runAnalysis.js had nothing to gate
// publish-vs-review on beyond a mock-provider check. It does now, the
// same way scanAndGenerate.js already does for news articles.
//
// externalCorrectionNote (optional): runAnalysis.js's own fact-check suite
// (verifyAnalysisDraft - price/qualifier/distance/similarity-to-prior-
// article) runs AFTER this function returns, since it needs the real
// snapshot/symbol context this function doesn't have. Those checks used to
// have no way to trigger a second attempt - a failure went straight to
// "review" with no chance to self-correct, unlike the lexical/redundancy/
// causal-claim checks below, which already retry once internally. Passing
// the specific external failure reason in here (used as the FIRST attempt's
// correction note, before this function's own internal retry logic even
// runs) reuses the exact prompt mechanism (buildAnalysisPrompt's
// correctionBlock) that already existed for the internal case - no new
// prompt plumbing needed, just a second caller for the same parameter.
export async function generateAnalysis(snapshot, context, externalCorrectionNote) {
  const provider = currentProvider();

  async function callProvider(correctionNote) {
    const result =
      provider === "openai"
        ? await openaiGenerateAnalysis(snapshot, correctionNote, context)
        : provider === "anthropic"
        ? await anthropicGenerateAnalysis(snapshot, correctionNote, context)
        : mockGenerateAnalysis(snapshot, correctionNote);
    await logUsage(provider, "analysis", result.tokensEstimate, result.costEstimateUsd);
    return result;
  }

  let result = await callProvider(externalCorrectionNote);
  let { problem } = await verifyBody(result.body, provider, ANALYSIS_MAX_BODY_PARAGRAPHS);
  let verificationClean = !problem;

  if (problem) {
    console.warn(`AI provider: retrying analysis generation once - ${problem}.`);
    result = await callProvider(problem);
    let retryProblem = (await verifyBody(result.body, provider, ANALYSIS_MAX_BODY_PARAGRAPHS)).problem;
    // Same mechanical last resort as generateArticle - see
    // stripGenericSignificanceFillerClauses's comment.
    if (retryProblem && findGenericSignificanceFiller(result.body)) {
      const stripped = stripGenericSignificanceFillerClauses(result.body);
      if (stripped !== result.body) {
        result = { ...result, body: stripped };
        retryProblem = (await verifyBody(result.body, provider, ANALYSIS_MAX_BODY_PARAGRAPHS)).problem;
      }
    }
    verificationClean = !retryProblem;
  }

  const withFallback = applySeoFallback(result, {
    fallbackTitle: result.title,
    fallbackDescription: result.dek,
    context: `analysis "${result.title}"`,
  });
  return { ...enforceSeoLength(withFallback), provider, verificationClean };
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
