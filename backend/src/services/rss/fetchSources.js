// Fetches and parses active RSS sources from the database. One broken feed
// should never take down the whole scan, so each source is fetched
// independently and failures are just logged and skipped.
import Parser from "rss-parser";
import { query } from "../../db.js";

// Some feeds (Mining.com's Cloudflare/CloudFront-fronted one among them)
// 403 any request with no User-Agent or a generic one - a plain browser UA
// clears it without needing anything feed-specific.
const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
});

// Checked a real sample of every active source's live contentSnippet
// (uncut) to size this rather than guessing: most feeds (CoinDesk,
// CoinTelegraph, Decrypt, The Block, MarketWatch, Yahoo, CNBC x2,
// Mining.com) run 110-250 chars and never came close to the old 300-char
// cap - raising it changes nothing for them. Two feeds genuinely did run
// long and were losing real figures at 300: CryptoSlate (avg ~347, max
// ~519 chars - e.g. cut mid-sentence before "$269 million in assets were
// borrowed") and OilPrice.com (avg ~543, every single sampled item over
// 300 - e.g. cut before "$230 million advance", "November 29, 2023", "down
// 9.6% on the same period of 2025"). Every sampled feed's own snippet tops
// out at ~554 chars on its own (they truncate with "[…]" upstream), so 600
// captures effectively all of it without an open-ended cap. (A separate
// third group - Investing.com's two feeds and Yahoo Finance - supply no
// contentSnippet at all, empty string regardless of this limit; that's a
// different problem, see scanAndGenerate.js's stale/thin-source check.)
// Cost impact: negligible - gpt-4o-mini input tokens are $0.00015/1K, and
// this only adds real length for 2 of 13 sources, at most ~250 extra chars
// (~60 tokens, a fraction of a cent) per source line in a story that draws
// from one of them.
const MAX_SNIPPET_LENGTH = 600;

async function fetchItemsFromSources(sources) {
  const items = [];

  for (const source of sources) {
    try {
      const feed = await parser.parseURL(source.rss_url);
      for (const entry of feed.items || []) {
        items.push({
          title: entry.title?.trim() || "",
          link: entry.link,
          pubDate: entry.pubDate ? new Date(entry.pubDate) : new Date(),
          contentSnippet: (entry.contentSnippet || "").slice(0, MAX_SNIPPET_LENGTH),
          sourceName: source.name,
        });
      }
    } catch (err) {
      console.error(`Could not fetch RSS feed for ${source.name}: ${err.message}`);
    }
  }

  return items;
}

export async function fetchSourceItemsForCategory(categoryId) {
  const { rows: sources } = await query(
    "SELECT * FROM sources WHERE active = true AND category_id = $1",
    [categoryId]
  );
  return fetchItemsFromSources(sources);
}

// Sources that cover both Stocks and Indices - general finance wires where a
// single story could be about either. They're tagged category_id = stocks
// (their primary/owning category, so fetchSourceItemsForCategory already
// includes them there) plus dual_stocks_indices = true so Indices can also
// draw from the same feed. The scan pipeline (INDEX_WORDS in
// scanAndGenerate.js) decides per-item which category each one actually goes to.
export async function fetchDualStocksIndicesItems() {
  const { rows: sources } = await query(
    "SELECT * FROM sources WHERE active = true AND dual_stocks_indices = true"
  );
  return fetchItemsFromSources(sources);
}
