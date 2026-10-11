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
