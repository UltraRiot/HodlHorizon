-- Trust/transparency signal: an article that was published, then pulled
-- back to review by the price/category-mismatch guardrails (or a human),
-- then republished, used to go back live with no visible trace that
-- anything had changed - a reader who saw the original wrong figure had
-- no way to know it had been corrected. Set only at the moment of that
-- specific transition (see routes/admin/articles.js's PATCH handler) -
-- never on a plain first-time publish, and never touched again after
-- that, so it marks "this article was corrected once," not "this is the
-- last edit time" (articles.updated_at already covers that).
ALTER TABLE articles ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ;
