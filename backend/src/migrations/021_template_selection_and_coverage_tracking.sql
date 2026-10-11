ALTER TABLE articles ADD COLUMN IF NOT EXISTS opening_template_id INTEGER;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS closing_template_id INTEGER;

ALTER TABLE articles ADD COLUMN IF NOT EXISTS used_coverage_article_ids INTEGER[];
