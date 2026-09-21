-- News paragraph-2 template rotation (services/ai/newsParagraph2Templates.js) -
-- the same "code chooses, model complies" mechanism migrations/021 already
-- built for Analysis's opening/closing templates, applied to News after a
-- real manual read found paragraph 2 defaulting to a vague hedge template
-- ("...which could impact global markets") almost every time a generic
-- "why it matters" prompt instruction was left to the model's own
-- judgment. Records which framing was used so the next generation in the
-- same category can exclude whichever were used in the last 5 published
-- articles, mirroring opening_template_id/closing_template_id exactly.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS paragraph2_template_id INTEGER;
