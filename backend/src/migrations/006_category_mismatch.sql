-- Category-mismatch flag: catches a story filed under a category only
-- because of which source it came from (e.g. a Treasury/bond story from a
-- Crypto-assigned source like CoinDesk) rather than what it's actually
-- about. The AI's independently-detected category is compared against the
-- source's assigned one at generation time - see
-- services/rss/scanAndGenerate.js. Flagging only: the source-based
-- assignment stays the default/primary signal and the category_id is
-- never auto-changed, this just forces a human look instead of letting a
-- mismatched story auto-publish.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS category_mismatch BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS category_mismatch_note TEXT;
