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

function padToward(str, min) {
  if (!str) return str;
  let padded = str;
  while (padded.length < min) padded += " Read more on Hodl Horizon.";
  return padded;
}

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

const SEO_TITLE_MAX = 60;
const SEO_DESCRIPTION_MAX = 155;

export function trimToWordBoundary(str, max) {
  if (!str || str.length <= max) return str;
  const sliced = str.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
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

const ANALYSIS_MAX_BODY_PARAGRAPHS = 7;

export function findBannedWordViolation(body) {
  const haystack = (body || "").toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (haystack.includes(phrase.toLowerCase())) {
      return `the body uses "${phrase}," which STYLE_INSTRUCTIONS explicitly forbids`;
    }
  }
  return null;
}

const SOURCE_PHRASING_SIMILARITY_THRESHOLD = 0.35;

function splitIntoSentences(text) {
  return (text || "").split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 10);
}

export function findSourcePhrasingTooClose(body, sourceText) {
  if (!sourceText) return null;

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

function hasConcreteContent(text) {
  if (/\d/.test(text)) return true;
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
        continue;
      }
      newSentences.push(stripped);
    }
    const paragraphText = newSentences.join(" ").trim();
    if (paragraphText.length > 0) {
      resultParagraphs.push(paragraphText);
    }
  }

  return changed ? resultParagraphs.join("\n\n") : body;
}

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
    const expandsBefore = new RegExp(`\\(${acronym}\\)`).test(dek);
    const expandsAfter = new RegExp(`${acronym}\\s*\\([^)]+\\)`).test(dek);
    if (expandsBefore || expandsAfter) continue;
    return `the dek uses "${acronym}" without expanding it anywhere in the dek itself - a reader who only sees the dek/teaser (not the body) won't know what this refers to. Spell it out on first use in the dek (e.g. "Global Infrastructure Partners (GIP)") or avoid the acronym there.`;
  }
  return null;
}

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

    const inSentenceValue = inSentence[0];
    const reference = allDurations.find((d) => d.sentenceIndex !== i && d.seconds !== inSentenceValue.seconds);
    if (!reference) continue;
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

const VAGUE_CROSS_ASSET_PHRASE_RE = /\b(ripple effects?|could impact|may impact|could affect|may affect|has implications for)\b/i;
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

const CURRENTLY_SERVING_OFFICE_HOLDERS = [
  { title: "President", surname: "Trump" },
  { title: "Fed Chair", surname: "Warsh" },
  { title: "Federal Reserve Chair", surname: "Warsh" },
  { title: "Federal Reserve Chairman", surname: "Warsh" },
  { title: "ECB President", surname: "Lagarde" },
  { title: "Treasury Secretary", surname: "Bessent" },
];

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
  if (redundancyCheck.unsupported_causal_claim) {
    return { problem: `an independent check found an unsupported causal claim: ${redundancyCheck.causal_claim_reason}` };
  }
  if (redundancyCheck.unacknowledged_divergence) {
    return { problem: `an independent check found the brief states two facts that read as counterintuitive without acknowledging the tension: ${redundancyCheck.divergence_reason}. Add a brief, plain acknowledgment that the source material doesn't address the reason for this (e.g. "the reason for this divergence wasn't addressed in the available coverage") - do not invent a cause.` };
  }
  return { problem: null };
}

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

export async function generateArticle(items, previousCoverage, assignedCategoryName, paragraph2Directive, isThinSource) {
  const provider = currentProvider();

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
    let retryProblem = (await verifyDraft(result)).problem;
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
  return { ...enforceSeoLength(withFallback), provider, verificationClean };
}

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
