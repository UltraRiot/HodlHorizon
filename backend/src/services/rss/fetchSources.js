import Parser from "rss-parser";
import { query } from "../../db.js";

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "*/*",
  },
});

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

export async function fetchDualStocksIndicesItems() {
  const { rows: sources } = await query(
    "SELECT * FROM sources WHERE active = true AND dual_stocks_indices = true"
  );
  return fetchItemsFromSources(sources);
}
