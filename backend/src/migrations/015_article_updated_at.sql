-- Articles had no real "last modified" timestamp - admins can edit a
-- published article's body via PATCH /api/admin/articles/:id, but that
-- edit left no trace anywhere (pre-launch SEO audit finding: the
-- NewsArticle JSON-LD's dateModified was falling back to published_at,
-- which is wrong the moment an admin edits a live article). Backfilled to
-- created_at for every existing row (the best available truth for
-- anything never edited since - not a guess, since nothing has written to
-- this column yet for any of them) rather than left NULL.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
UPDATE articles SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE articles ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE articles ALTER COLUMN updated_at SET DEFAULT now();
