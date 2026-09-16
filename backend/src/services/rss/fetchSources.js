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
          contentSnippet: (entry.contentSnippet || "").slice(0, 300),
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
