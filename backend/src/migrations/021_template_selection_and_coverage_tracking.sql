-- Two real-evidence-driven fixes, both moving from "ask the model to vary
-- itself" to "give it fixed variety and let code choose," since two
-- separate rounds of real generation showed a prompt instruction to vary
-- structure doesn't hold even when fed back explicitly as a correction
-- note (see runAnalysis.js's structuralFailure retry path - the SAME
-- opening-clause check kept failing on 20+ successive real drafts even
-- after being told the specific failure).
--
-- PART 1 - opening_template_id / closing_template_id: code now picks a
-- fixed opening sentence and a fixed closing directive from a small pool
-- (services/ai/analysisTemplates.js) instead of asking the model to
-- "vary" - these columns record which one was used so the NEXT
-- generation for the same category can exclude whichever were used in
-- the last 5 published articles, the same "recent window, not a random
-- roll every time" principle findRepeatedOpeningClause/
-- findRepeatedClosingClause already use for detection.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS opening_template_id INTEGER;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS closing_template_id INTEGER;

-- PART 2 - used_coverage_article_ids: real regression (articles 372-380,
-- BTC) - the same relatedCoverage fact ("despite a 1.5% decline in
-- September, Bitcoin is on track for its first quarterly gain in a year")
-- kept getting fed into findRelatedCoverage()'s result and reworded fresh
-- in article after article, because that function only ever asked "is
-- there coverage in the last 48h," never "have I already used this
-- specific coverage for this instrument recently." Records which source
-- article ids (from this site's own news categories - see
-- findRelatedCoverage()) were actually included in a given Analysis
-- piece's prompt, so the next one can exclude them.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS used_coverage_article_ids INTEGER[];
