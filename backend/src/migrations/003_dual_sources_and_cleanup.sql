ALTER TABLE sources ADD COLUMN IF NOT EXISTS dual_stocks_indices BOOLEAN NOT NULL DEFAULT false;

DELETE FROM sources WHERE rss_url IN (
  'https://feeds.reuters.com/reuters/businessNews',
  'https://feeds.reuters.com/reuters/marketsNews',
  'https://feeds.reuters.com/reuters/commoditiesNews',
  'https://feeds.bloomberg.com/markets/news.rss'
);
