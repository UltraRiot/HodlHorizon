DELETE FROM articles WHERE id IN (274, 276, 278, 280);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'article_sources_source_url_key'
  ) THEN
    ALTER TABLE article_sources ADD CONSTRAINT article_sources_source_url_key UNIQUE (source_url);
  END IF;
END $$;

ALTER TABLE analysis_snapshots ADD COLUMN IF NOT EXISTS trend TEXT;
