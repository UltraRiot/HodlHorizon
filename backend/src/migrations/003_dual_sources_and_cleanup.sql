-- Follow-up fixes: Reuters/Bloomberg RSS is confirmed dead (both killed
-- public RSS years ago), and Stocks/Indices need to share two general
-- finance-wire sources rather than each having its own.

-- Lets a source feed both Stocks (its category_id, the "owning" category)
-- and Indices. The scan pipeline splits each dual source's items between
-- the two categories with a keyword check - see INDEX_WORDS in
-- services/rss/scanAndGenerate.js. Only Yahoo Finance and Investing.com
-- Stock Market News use this; every other source stays single-category.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS dual_stocks_indices BOOLEAN NOT NULL DEFAULT false;

-- These were seeded as "(verify)" placeholders and never worked - Reuters
-- and Bloomberg both stopped offering public RSS feeds years ago. seed.js
-- seeds their replacements (Yahoo Finance, Investing.com Stock Market News)
-- instead of these.
DELETE FROM sources WHERE rss_url IN (
  'https://feeds.reuters.com/reuters/businessNews',
  'https://feeds.reuters.com/reuters/marketsNews',
  'https://feeds.reuters.com/reuters/commoditiesNews',
  'https://feeds.bloomberg.com/markets/news.rss'
);
