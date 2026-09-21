-- Analysis pieces have never stored which WATCHLIST symbol (BTC/ETH/Gold/
-- S&P 500/Oil (WTI)) they're about as a real column - only encoded loosely
-- in the free-text title ("Bitcoin Price Holds at...", "Gold Price at...").
-- That made "find the last published article about this same instrument"
-- (needed for the new prior-article similarity guardrail in
-- services/analysis/runAnalysis.js, and for the audit script that re-checks
-- the whole backlog) a fuzzy, title-parsing exercise instead of a real
-- query. New rows are populated directly (runAnalysisScan() already knows
-- asset.symbol at insert time - see articleUtils.js's insertArticle).
--
-- Existing rows predate this column, so they're backfilled here with a
-- best-effort title-keyword match against the same 5 watchlist symbols -
-- verified against the real distinct titles in this table before writing
-- these patterns (checked 2026-09-18: every existing Analysis title
-- unambiguously matches exactly one of these). This is a one-time,
-- good-enough backfill for the current backlog, not a guarantee for
-- hypothetical future title wording - which is exactly why new rows are
-- populated directly at insert time instead of relying on this pattern
-- match going forward.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS analysis_symbol TEXT;

UPDATE articles a
SET analysis_symbol = CASE
  WHEN a.title ILIKE '%bitcoin%' THEN 'BTC'
  WHEN a.title ILIKE '%ethereum%' OR a.title ILIKE 'ETH %' OR a.title ILIKE 'ETH:%' THEN 'ETH'
  WHEN a.title ILIKE '%gold%' THEN 'Gold'
  WHEN a.title ILIKE '%S&P 500%' OR a.title ILIKE '%S&P500%' THEN 'S&P 500'
  WHEN a.title ILIKE '%WTI%' OR a.title ILIKE '%oil%' THEN 'Oil (WTI)'
  ELSE NULL
END
FROM categories c
WHERE a.category_id = c.id
  AND c.slug = 'analysis'
  AND a.analysis_symbol IS NULL;
