// Populates the database with the starting data every fresh install needs:
// categories, a few RSS sources, one admin login, and a sample poll.
// Safe to run more than once - it skips anything that already exists.
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import pool, { query } from "./db.js";

dotenv.config();

async function seedCategories() {
  const categories = [
    { slug: "stocks", name: "Stocks" },
    { slug: "indices", name: "Indices" },
    { slug: "commodities", name: "Commodities" },
    { slug: "crypto", name: "Crypto" },
    { slug: "analysis", name: "Analysis" },
  ];

  for (const c of categories) {
    await query(
      `INSERT INTO categories (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO NOTHING`,
      [c.slug, c.name]
    );
  }
  console.log(`Seeded ${categories.length} categories.`);
}

async function seedSources() {
  // Public RSS feeds, one category each (see ai-content-quality-spec.md) -
  // add/remove more later from the admin Feeds page without touching code.
  //
  // Feed URLs change. Reuters and Bloomberg both stopped offering public RSS
  // feeds years ago, so those rows were removed entirely (see migrations/
  // 003_dual_sources_and_cleanup.sql) rather than seeded as dead weight.
  // CNBC's and MarketWatch's classic feed URLs below are marked "(verify)" -
  // they could not be confirmed live from here (one returned a 403, the
  // other was blocked) but may well still work with a real feed reader;
  // don't rely on them alone for Stocks/Indices volume.
  const { rows: categories } = await query("SELECT id, slug FROM categories");
  const categoryIdBySlug = Object.fromEntries(categories.map((c) => [c.slug, c.id]));

  const sources = [
    // Crypto
    { name: "CoinDesk", rss_url: "https://www.coindesk.com/arc/outboundfeeds/rss/", homepage_url: "https://www.coindesk.com", category: "crypto" },
    { name: "CoinTelegraph", rss_url: "https://cointelegraph.com/rss", homepage_url: "https://cointelegraph.com", category: "crypto" },
    { name: "Decrypt", rss_url: "https://decrypt.co/feed", homepage_url: "https://decrypt.co", category: "crypto" },
    { name: "CryptoSlate", rss_url: "https://cryptoslate.com/feed/", homepage_url: "https://cryptoslate.com", category: "crypto" },
    { name: "The Block", rss_url: "https://www.theblock.co/rss.xml", homepage_url: "https://www.theblock.co", category: "crypto" },
    // Stocks - Yahoo Finance and Investing.com Stock Market News are general
    // finance wires, verified live, shared with Indices via dual: true (see
    // INDEX_WORDS in services/rss/scanAndGenerate.js).
    { name: "Yahoo Finance", rss_url: "https://finance.yahoo.com/news/rssindex", homepage_url: "https://finance.yahoo.com", category: "stocks", dual: true },
    { name: "Investing.com - Stock Market News", rss_url: "https://www.investing.com/rss/news_25.rss", homepage_url: "https://www.investing.com", category: "stocks", dual: true },
    { name: "CNBC Business (verify)", rss_url: "https://www.cnbc.com/id/10001147/device/rss/rss.html", homepage_url: "https://www.cnbc.com", category: "stocks" },
    { name: "MarketWatch - Top Stories (verify)", rss_url: "https://feeds.marketwatch.com/marketwatch/topstories/", homepage_url: "https://www.marketwatch.com", category: "stocks" },
    // Indices - also draws from the two dual Stocks sources above.
    { name: "CNBC Markets (verify)", rss_url: "https://www.cnbc.com/id/20910258/device/rss/rss.html", homepage_url: "https://www.cnbc.com", category: "indices" },
    // Commodities
    { name: "Investing.com - Commodities", rss_url: "https://www.investing.com/rss/commodities.rss", homepage_url: "https://www.investing.com", category: "commodities" },
    { name: "OilPrice.com", rss_url: "https://oilprice.com/rss/main", homepage_url: "https://oilprice.com", category: "commodities" },
    { name: "Kitco News", rss_url: "https://www.kitco.com/rss/KitcoNews.xml", homepage_url: "https://www.kitco.com", category: "commodities" },
    // Analysis intentionally has no RSS sources - see services/analysis/runAnalysis.js
  ];

  for (const s of sources) {
    const categoryId = categoryIdBySlug[s.category];
    if (!categoryId) continue;
    // On conflict, backfill category_id only if the existing row doesn't
    // have one yet (e.g. it was seeded before category_id existed) - never
    // overwrite a category an admin has since set by hand. dual_stocks_indices
    // is system-derived, not admin-editable, so it's always kept in sync.
    await query(
      `INSERT INTO sources (name, rss_url, homepage_url, category_id, dual_stocks_indices, active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (rss_url) DO UPDATE SET
         category_id = COALESCE(sources.category_id, EXCLUDED.category_id),
         dual_stocks_indices = EXCLUDED.dual_stocks_indices`,
      [s.name, s.rss_url, s.homepage_url, categoryId, Boolean(s.dual)]
    );
  }
  console.log(`Seeded/verified ${sources.length} source(s).`);
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || "admin@hodlhorizon.com";
  const password = process.env.ADMIN_PASSWORD || "change-this-password";

  const { rows } = await query("SELECT id FROM admin_users WHERE email = $1", [email]);
  if (rows.length > 0) {
    console.log(`Admin user ${email} already exists.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await query(
    "INSERT INTO admin_users (email, password_hash) VALUES ($1, $2)",
    [email, passwordHash]
  );
  console.log(`Created admin user: ${email}`);
}

async function seedPoll() {
  const { rows } = await query("SELECT id FROM polls LIMIT 1");
  if (rows.length > 0) return;

  const { rows: pollRows } = await query(
    "INSERT INTO polls (question) VALUES ($1) RETURNING id",
    ["Do you think BTC breaks $120,000 this week?"]
  );
  const pollId = pollRows[0].id;

  const options = ["Yes", "No", "Not sure"];
  for (const label of options) {
    await query("INSERT INTO poll_options (poll_id, label) VALUES ($1, $2)", [pollId, label]);
  }
  console.log("Seeded a sample poll.");
}

async function seedCalendar() {
  const { rows } = await query("SELECT id FROM calendar_events LIMIT 1");
  if (rows.length > 0) return;

  const now = new Date();
  const inDays = (n) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

  const events = [
    { title: "US CPI (Inflation) Report", event_time: inDays(2), impact: "high", category: "macro" },
    { title: "Federal Reserve Rate Decision", event_time: inDays(9), impact: "high", category: "macro" },
    { title: "US Non-Farm Payrolls", event_time: inDays(16), impact: "medium", category: "macro" },
  ];

  for (const e of events) {
    await query(
      "INSERT INTO calendar_events (title, event_time, impact, category) VALUES ($1, $2, $3, $4)",
      [e.title, e.event_time, e.impact, e.category]
    );
  }
  console.log(`Seeded ${events.length} calendar events.`);
}

async function seedGlossary() {
  const { rows } = await query("SELECT id FROM glossary_terms LIMIT 1");
  if (rows.length > 0) return;

  await query(
    `INSERT INTO glossary_terms (slug, term, short_definition, body, seo_title, seo_description)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      "what-is-rsi",
      "What is RSI (Relative Strength Index)?",
      "RSI is a momentum indicator that measures how fast and how far a price has moved recently.",
      "The Relative Strength Index (RSI) is a widely used momentum indicator in technical analysis. It measures the speed and size of recent price changes on a scale of 0 to 100.\n\nReadings above 70 are generally considered overbought, while readings below 30 are considered oversold. Traders often watch for RSI to diverge from price as an early signal that a trend may be losing strength.\n\nRSI works best alongside other tools such as support and resistance levels, rather than as a signal on its own.",
      "What is RSI? A Trader's Guide to the Relative Strength Index",
      "A clear, concise explanation of RSI (Relative Strength Index) and how traders use it to read momentum in stocks and crypto.",
    ]
  );
  console.log("Seeded a sample glossary entry.");
}

async function run() {
  await seedCategories();
  await seedSources();
  await seedAdmin();
  await seedPoll();
  await seedCalendar();
  await seedGlossary();
  await pool.end();
  console.log("Seeding complete.");
}

run().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
