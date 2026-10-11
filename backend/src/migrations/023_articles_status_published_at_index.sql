CREATE INDEX IF NOT EXISTS idx_articles_status_published_at ON articles(status, published_at DESC);
