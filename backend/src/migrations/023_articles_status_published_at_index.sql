-- The homepage/category feed query (GET /api/articles, routes/articles.js)
-- filters on status = 'published' and sorts by published_at DESC - only
-- single-column indexes existed for either half (idx_articles_status,
-- idx_articles_category), nothing composite covering both the filter and
-- the sort together. Not urgent at current row counts (Postgres' planner
-- is still fine with a sequential scan + sort on a table this small), but
-- cheap and correct to add now rather than waiting for it to matter.
CREATE INDEX IF NOT EXISTS idx_articles_status_published_at ON articles(status, published_at DESC);
