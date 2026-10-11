const STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "in", "on", "for", "and", "is", "as", "at",
  "by", "with", "after", "over", "amid", "its", "it's", "into",
]);

export function normalize(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export const DUPLICATE_SIMILARITY_THRESHOLD = 0.6;

export function jaccardSimilarity(wordsA, wordsB) {
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

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
