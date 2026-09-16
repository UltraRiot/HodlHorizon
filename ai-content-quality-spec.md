# Hodl Horizon — AI Article Engine Upgrade Spec

This is a implementation brief for the coding agent working on the Hodl Horizon
codebase (Express backend + Next.js frontend, PostgreSQL). It covers four
related fixes: separating news categories by source, setting sane daily
article volumes, fixing the Analysis category, and making the AI's writing
itself sound less repetitive and less "AI-generated."

**How to use this doc:** paste the whole thing to your coding agent with an
instruction like: *"Implement the changes described in this spec in our Hodl
Horizon backend. Ask me if anything about the current code doesn't match what
this assumes."*

---

## 1. Problem being solved

Today, category is guessed after the fact from keywords in the headline, all
sources feed every category, there's no daily cap, "Analysis" articles are
generated the same way as regular news (so they don't reliably contain real
analysis), and the AI's writing style tends toward generic, repetitive,
AI-sounding prose.

Goal: separated categories with their own curated sources, sane daily
volume, an Analysis category grounded in real computed data, and short news
briefs that read like they were written by a real person who's on deadline —
not padded, not repetitive, no em dashes.

---

## 2. Separate categories by source (remove keyword-guessing)

**Schema change:** add a `category_id` column to the `sources` table
(`ALTER TABLE sources ADD COLUMN category_id INTEGER REFERENCES categories(id);`).
Every source is assigned to exactly one category up front, by a human, when
it's added — not guessed by the AI after the fact.

**Pipeline change:** run the scan-and-generate job once per category, each
time only fetching and grouping items from that category's own sources.
Delete the keyword-based `guessCategory()` step entirely — it becomes
unnecessary once sources are pre-tagged.

**Starting source list per category** (verify each RSS feed URL still works
before adding it — feed URLs change):

| Category | Sources to add |
|---|---|
| Crypto | CoinDesk, CoinTelegraph, The Block, Decrypt, CryptoSlate |
| Stocks | Reuters Business, CNBC, MarketWatch, Yahoo Finance |
| Indices | Reuters Markets, Bloomberg Markets, CNBC Markets |
| Commodities | Investing.com Commodities, OilPrice.com, Kitco (metals), Reuters Commodities |

Analysis does **not** get RSS sources at all — see section 4.

---

## 3. Daily article volume (quality over quantity)

Add a per-category daily cap the pipeline enforces (stop generating new
articles in a category once its cap for the day is hit, even if there's more
to write about). Store this in the existing `settings` table, e.g.
`daily_cap_crypto`, `daily_cap_stocks`, etc., editable from the admin panel.

Recommended starting caps:

| Category | Articles / day |
|---|---|
| Crypto | 6–10 |
| Stocks | 4–6 |
| Indices | 2–4 |
| Commodities | 2–3 |
| Analysis | 2–4 |

Total: roughly 16–27 articles/day. Thin or repetitive content hurts SEO more
than it helps — start at the low end of each range and raise it only if the
review queue shows consistently good, non-redundant stories being left out.

---

## 4. Fix the Analysis category: compute it, don't scan for it

Analysis articles should **not** come from the RSS/news pipeline at all.
Right now there's no guarantee a story tagged "Analysis" contains any real
analysis — it's just whatever matched a keyword.

**New approach:** a separate scheduled job, independent of the news scanner,
that:

1. Runs on a fixed schedule (e.g. once daily, or twice for higher-volatility
   assets) for a fixed watchlist: BTC, ETH, Gold, S&P 500, Oil (WTI) — reuse
   `getMarketSnapshot()` from `services/marketData/prices.js`, which already
   computes real trend/RSI/support/resistance from CoinGecko price history.
   For non-crypto assets, this needs the same math wired up to a stocks/
   commodities price history source (see the existing `STOCKS_DATA_API_KEY`
   TODO).
2. Passes the **computed numbers** (not headlines) to the AI with a prompt
   that asks it to narrate what the numbers mean in plain language — see the
   analysis-specific prompt in section 5.
3. Only generates a new Analysis article for an asset if its numbers have
   moved meaningfully since the last one (e.g. price moved >2%, or RSI
   crossed into/out of overbought/oversold, or a support/resistance level
   was broken) — otherwise skip that asset for the day. This is what keeps
   Analysis from becoming repetitive filler.

This guarantees every Analysis article is grounded in real, current numbers
instead of being assembled from whatever news happened to mention "RSI" or
"support."

---

## 5. Make the writing itself better

This is a prompt change in `backend/src/services/ai/prompts.js`. Replace the
current `STYLE_INSTRUCTIONS` and `buildArticlePrompt` with the version below.

### 5.1 News brief prompt (replaces `buildArticlePrompt`)

```js
export const STYLE_INSTRUCTIONS = `You write short news briefs for Hodl Horizon, a finance and crypto news site. You write like an experienced wire-service journalist on a deadline: precise, factual, plain language, zero padding.

HARD RULES:
- Maximum 130 words total. Three short paragraphs, no more.
- Paragraph 1: the single most newsworthy fact, with the actual number. No throat-clearing, no "in a significant development," no scene-setting.
- Paragraph 2: why it matters to a trader or investor, in one or two sentences.
- Paragraph 3: one more concrete detail - a specific figure, a named source's claim, or what happens next. Not a generic wrap-up.
- Never use an em dash (—). Use a period, a comma, or "and" instead.
- Never use these words/phrases: "notable," "significant development," "market participants," "in the world of," "as of this writing," "it remains to be seen," "moving forward," "stay tuned," "in conclusion," "landscape," "realm," "underscores," "boasts."
- Never restate the headline's wording in the first sentence - lead with the fact itself.
- Only use facts present in the source material below. Never invent a number, quote, or name.
- Do not give buy/sell/hold instructions. Describe what happened and let the reader draw conclusions.
- Do not mention or describe images. This site never uses images in articles.`;
```

```js
export function buildArticlePrompt(items, previousCoverage) {
  const sourcesText = items
    .map((i, idx) => `Source ${idx + 1} (${i.sourceName}): "${i.title}"${i.contentSnippet ? ` — ${i.contentSnippet}` : ""}`)
    .join("\n");

  const continuationNote = previousCoverage
    ? `\nThis site already covered this story ${previousCoverage.hoursAgo} hours ago, reporting: "${previousCoverage.title}" (key figures then: ${previousCoverage.keyFacts}). Write this as an UPDATE - lead with what has changed since then, don't re-report the same facts as if new.`
    : "";

  return `${STYLE_INSTRUCTIONS}

Below are headlines and snippets about the same story from ${items.length} source(s).
${sourcesText}
${continuationNote}

Respond with ONLY a JSON object with these exact keys:
{
  "title": "a clear, specific headline, under 90 characters, stating the fact - not a question, not clickbait",
  "dek": "1-2 sentences that add NEW information beyond the headline - never a rewording of it",
  "body": "the full brief, exactly 3 short paragraphs separated by \\n\\n, following the HARD RULES above",
  "seo_title": "under 60 characters",
  "seo_description": "between 50 and 160 characters"
}`;
}
```

**`previousCoverage` is new**: before calling `generateArticle`, look up the
most recently published article in the same category whose title has word
overlap with the current story group (reuse the similarity function already
in `services/rss/grouping.js`). If one is found and it's less than ~72 hours
old, pass `{ title, hoursAgo, keyFacts }` in so the AI writes an update
instead of repeating itself. If nothing matches, pass `undefined`.

### 5.2 Analysis prompt (new function, e.g. `buildAnalysisPrompt`)

```js
export function buildAnalysisPrompt(snapshot) {
  return `${STYLE_INSTRUCTIONS}

Write a short analysis brief for ${snapshot.symbol} using ONLY these computed figures - do not add any fact not listed here:
- Current price: $${snapshot.price}
- Trend: ${snapshot.trend} (price ${snapshot.trend === "Bullish" ? "above" : "below"} its 50-day moving average)
- RSI (14-day): ${snapshot.rsi_14} (${snapshot.rsi_note})
- Support: $${snapshot.support}
- Resistance: $${snapshot.resistance}

Explain in plain language what these numbers suggest about current momentum, using the HARD RULES above. End with a plain-language note that this is not financial advice - readers should draw their own conclusions.

Respond with ONLY a JSON object with these exact keys: { "title": "...", "dek": "...", "body": "...", "seo_title": "...", "seo_description": "..." }`;
}
```

### 5.3 Few-shot examples (add these, they matter more than any instruction)

Language models match a couple of concrete examples far better than they
match adjectives like "professional but human." Write 2-3 short articles by
hand (or heavily edit AI drafts until they're genuinely good), in different
categories, and append them to the end of `buildArticlePrompt`'s returned
string as:

```
Here are two examples of the exact tone and length to match:

Example 1:
[paste a real 3-paragraph, ~120-word example here]

Example 2:
[paste a second example, different category, here]
```

This one change usually improves perceived quality more than any wording
tweak to the instructions above - budget time for writing genuinely good
examples, don't skip this step.

### 5.4 Duplicate-similarity check before saving

Before inserting a new article, compare its `body` against the last ~40
published articles in the same category using the same word-overlap
function already in `services/rss/grouping.js` (`jaccardSimilarity` on
normalized text). If similarity is above ~0.6 against any of them, discard
the draft and log it rather than publishing/reviewing a near-duplicate.

---

## 6. Implementation checklist

- [ ] Add `category_id` to `sources`; assign every existing/new source to one category
- [ ] Remove `guessCategory()`; run the scan job once per category using only that category's sources
- [ ] Add per-category daily caps to `settings`; enforce in the pipeline; expose in admin
- [ ] Build the separate Analysis job (fixed watchlist, computed snapshot, "only if it moved" gate)
- [ ] Replace `STYLE_INSTRUCTIONS` / `buildArticlePrompt` with section 5.1
- [ ] Add `buildAnalysisPrompt` (section 5.2) and wire the Analysis job to use it
- [ ] Write 2-3 real few-shot examples and append them to the article prompt (5.3)
- [ ] Add "previous coverage" lookup and pass it into `buildArticlePrompt` for continuation stories
- [ ] Add the pre-save duplicate-similarity check (5.4)
