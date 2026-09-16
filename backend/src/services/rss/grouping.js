// Groups RSS items that look like the same story from different sources.
// Deliberately simple (word-overlap on the headline) rather than a real NLP
// similarity model - easy to read, easy to tune, good enough to find the
// "2+ sources agree" signal the auto-publish rule relies on.
const STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "in", "on", "for", "and", "is", "as", "at",
  "by", "with", "after", "over", "amid", "its", "it's", "into",
]);

// Exported (not just used internally) so other places that need the same
// word-overlap heuristic - the "previous coverage" lookup and the pre-save
// duplicate check in services/shared/articleUtils.js - don't reimplement it.
export function normalize(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// The bar for "these two texts are saying the same thing" - used for the
// pre-save near-duplicate check against other articles (articleUtils.js)
// and for the paragraph-1-vs-paragraph-2 check in provider.js. Exported as
// one named constant so both call sites move together if it's ever tuned.
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.6;

export function jaccardSimilarity(wordsA, wordsB) {
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

// Returns an array of groups, each an array of the original items.
export function groupSimilarItems(items, threshold = 0.4) {
  const groups = []; // [{ words, items: [...] }]

  for (const item of items) {
    const words = normalize(item.title);
    let matched = false;

    for (const group of groups) {
      if (jaccardSimilarity(words, group.words) >= threshold) {
        group.items.push(item);
        matched = true;
        break;
      }
    }

    if (!matched) {
      groups.push({ words, items: [item] });
    }
  }

  return groups.map((g) => g.items);
}
