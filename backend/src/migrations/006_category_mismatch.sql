ALTER TABLE articles ADD COLUMN IF NOT EXISTS category_mismatch BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS category_mismatch_note TEXT;
