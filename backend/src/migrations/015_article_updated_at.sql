ALTER TABLE articles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
UPDATE articles SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE articles ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE articles ALTER COLUMN updated_at SET DEFAULT now();
