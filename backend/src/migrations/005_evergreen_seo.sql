-- Powers the evergreen SEO refresh job (services/seo/evergreenRefresh.js).
-- Scope is glossary_terms + a handful of static pages - never published
-- news/Analysis articles, which are timestamped and shouldn't have their
-- metadata silently changed after the fact.

ALTER TABLE glossary_terms ADD COLUMN IF NOT EXISTS seo_last_reviewed_at TIMESTAMPTZ;

-- Static pages have no other DB row at all (they're hardcoded Next.js
-- pages) - this table is their only source of truth for seo_title/
-- seo_description, plus a plain-text body_text snapshot used purely as
-- input for the AI when refreshing those two fields. body_text is never
-- rendered anywhere; the actual page prose lives in the frontend page file
-- and this job never touches it.
CREATE TABLE IF NOT EXISTS page_seo (
  path TEXT PRIMARY KEY,
  seo_title TEXT,
  seo_description TEXT,
  body_text TEXT NOT NULL,
  seo_last_reviewed_at TIMESTAMPTZ
);

INSERT INTO page_seo (path, seo_title, seo_description, body_text) VALUES
  (
    'about',
    'About Hodl Horizon',
    'How Hodl Horizon works, and how our AI writes the news.',
    'Hodl Horizon is a finance and crypto news site built for readers who want the story, not the padding. Every article is a short, factual summary, no filler, no images, just what happened and why it matters. How our AI works: our system continuously scans a set of established finance and crypto news sources. When two or more independent sources report the same story, our AI writes a short, original summary in a professional but human tone. Stories reported by only one source are held for a human editor to review before anything is published. Every article links back to the original sources it was drawn from, at the bottom of the page, so you can always go deeper. Nothing on Hodl Horizon is financial advice. Our Analysis section describes market conditions and technical indicators factually, it never tells you what to buy or sell.'
  ),
  (
    'disclosure',
    'Disclosure | Hodl Horizon',
    NULL,
    'AI-generated content: news summaries and analysis on this site are drafted automatically by AI from publicly available sources, and reviewed against our editorial rules before publication. Sources are linked at the bottom of every article. Affiliate links: some links on this site, for example to exchanges or brokers, may be affiliate links. If you sign up through one, Hodl Horizon may earn a commission at no extra cost to you. This never affects the factual content of our news coverage. Not financial advice: nothing on this site should be taken as a recommendation to buy, sell, or hold any asset.'
  ),
  (
    'privacy',
    'Privacy Policy | Hodl Horizon',
    NULL,
    'Hodl Horizon does not require an account and does not collect personal data to let you read the site. We do not use tracking cookies for advertising or profiling. If analytics are enabled, we use a cookieless, privacy-friendly analytics tool that reports aggregate traffic numbers only and cannot identify individual visitors. If a display advertising network is added in the future, that network may set its own cookies. Should that happen, this policy and a cookie consent notice will be updated accordingly. For questions about this policy, contact us at the address on our Contact page.'
  ),
  (
    'terms',
    'Terms of Use | Hodl Horizon',
    NULL,
    'Content on Hodl Horizon, including AI-generated news summaries and market analysis, is provided for informational purposes only and does not constitute financial, investment, tax, or legal advice. Market data and technical analysis may be delayed, incomplete, or inaccurate. Always verify important information independently before acting on it. We are not responsible for decisions made based on content published on this site.'
  ),
  (
    'learn',
    'Learn — Finance & Crypto Terms Explained | Hodl Horizon',
    'Clear, concise explanations of finance and crypto terms every trader should know.',
    'The Learn hub is a glossary of short, clear explanations of the finance and crypto terms that come up in Hodl Horizon''s news coverage - things like RSI, market cap, stablecoins, and other terms traders run into regularly.'
  )
ON CONFLICT (path) DO NOTHING;
