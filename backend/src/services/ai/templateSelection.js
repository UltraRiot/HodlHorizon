// Generic "fixed variety, code chooses" selection logic - originally built
// for Analysis's opening/closing templates (analysisTemplates.js), reused
// as-is for News's paragraph-2 explanatory framings (newsParagraph2Templates.js)
// since the underlying mechanism is identical: filter to applicable
// options, exclude whatever was recently used, pick randomly among what's
// left. Extracted to its own file rather than importing it out of
// analysisTemplates.js so a News-specific reason to import that file
// doesn't exist.
//
// Pure, exported for direct testing. Filters to applicable options first
// (a hard constraint - an inapplicable template is never a valid choice
// regardless of recency), then excludes whatever was used in the last
// `recentlyUsedIds` before picking randomly among what's left. Falls back
// to ignoring the recency exclusion (never the applicability filter) if
// every applicable option was recently used - rare with a healthy pool
// size and exclusion window, but a genuinely low-volume category could
// hit it, and picking a technically-inapplicable template would be worse
// than repeating one.
export function selectTemplate(pool, context, recentlyUsedIds) {
  // Some pools (CLOSING_DIRECTIVES, PARAGRAPH2_DIRECTIVES) have no
  // applicable() at all - every entry is always a valid choice - treated
  // as unconditionally applicable rather than requiring every pool to
  // define a no-op function.
  const applicablePool = pool.filter((t) => !t.applicable || t.applicable(context));
  const usedSet = new Set(recentlyUsedIds);
  const fresh = applicablePool.filter((t) => !usedSet.has(t.id));
  const candidates = fresh.length > 0 ? fresh : applicablePool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
