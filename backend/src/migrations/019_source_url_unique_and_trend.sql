-- Two unrelated fixes bundled together because both came out of the same
-- duplicate-coverage audit and need to land together for the trend-flip
-- regression test to run cleanly against a consistent schema.

-- PART 1 — alreadyStored() race condition (services/rss/scanAndGenerate.js):
-- real duplicate articles confirmed in the backlog - four pairs, each the
-- IDENTICAL source_url, articles created 5-8 seconds apart (273/274,
-- 275/276, 277/278, 279/280) - from two scan invocations overlapping
-- closely enough that the first one's article_sources INSERT for that URL
-- hadn't landed before the second one's alreadyStored() SELECT ran. A
-- check-then-insert pattern can't close this race no matter how the
-- SELECT is written; only a real UNIQUE constraint can. Existing
-- duplicates are cleaned up first (all four pairs were still "review" or
-- "scheduled", never published - confirmed before deleting anything) so
-- the constraint can actually be added; article_sources' article_id FK is
-- ON DELETE CASCADE, so deleting the duplicate articles row is enough.
-- The later (higher-id) row of each pair is removed, keeping whichever
-- one actually landed first.
DELETE FROM articles WHERE id IN (274, 276, 278, 280);

-- Plain ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS form in
-- Postgres (unlike ADD COLUMN) - every migration in this project re-runs
-- on every `npm run migrate` (see migrate.js's own comment: "safe to run
-- more than once"), so this needs the DO-block guard below or a second
-- run would fail with "constraint already exists."
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'article_sources_source_url_key'
  ) THEN
    ALTER TABLE article_sources ADD CONSTRAINT article_sources_source_url_key UNIQUE (source_url);
  END IF;
END $$;

-- PART 2 — trend-flip as a 4th movedMeaningfully() condition
-- (services/analysis/runAnalysis.js): analysis_snapshots never stored the
-- computed trend (Bullish/Bearish), only price/rsi_14/support/resistance,
-- so there was nothing to compare a new snapshot's trend against. Text,
-- not boolean, so the column self-documents in a raw SELECT rather than
-- needing "true = bullish, right?" tribal knowledge.
ALTER TABLE analysis_snapshots ADD COLUMN IF NOT EXISTS trend TEXT;
