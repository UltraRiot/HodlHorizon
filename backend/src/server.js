// The Express app entry point. Every route file is small and focused -
// this file's only job is wiring them together.
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import categoriesRoutes from "./routes/categories.js";
import articlesRoutes from "./routes/articles.js";
import pollsRoutes from "./routes/polls.js";
import glossaryRoutes from "./routes/glossary.js";
import calendarRoutes from "./routes/calendar.js";
import marketRoutes from "./routes/market.js";
import sitemapDataRoutes from "./routes/sitemapData.js";
import pagesRoutes from "./routes/pages.js";

import adminAuthRoutes from "./routes/admin/auth.js";
import adminArticlesRoutes from "./routes/admin/articles.js";
import adminFeedsRoutes from "./routes/admin/feeds.js";
import adminAiEngineRoutes from "./routes/admin/aiEngine.js";
import adminSeoRoutes from "./routes/admin/seo.js";
import adminUsageRoutes from "./routes/admin/usage.js";
import adminGlossaryRoutes from "./routes/admin/glossary.js";
import adminCalendarRoutes from "./routes/admin/calendar.js";
import adminPollsRoutes from "./routes/admin/polls.js";
import { requireAdmin } from "./middleware/adminAuth.js";
import { startScheduler } from "./jobs/scheduler.js";

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

// --- Public routes ---
app.use("/api/categories", categoriesRoutes);
app.use("/api/articles", articlesRoutes);
app.use("/api/polls", pollsRoutes);
app.use("/api/glossary", glossaryRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/market", marketRoutes);
app.use("/api/sitemap-data", sitemapDataRoutes);
app.use("/api/pages", pagesRoutes);

// --- Admin routes (all except login require a valid JWT) ---
app.use("/api/admin", adminAuthRoutes);
app.use("/api/admin/articles", requireAdmin, adminArticlesRoutes);
app.use("/api/admin/feeds", requireAdmin, adminFeedsRoutes);
app.use("/api/admin/ai-engine", requireAdmin, adminAiEngineRoutes);
app.use("/api/admin/seo", requireAdmin, adminSeoRoutes);
app.use("/api/admin/usage", requireAdmin, adminUsageRoutes);
app.use("/api/admin/glossary", requireAdmin, adminGlossaryRoutes);
app.use("/api/admin/calendar", requireAdmin, adminCalendarRoutes);
// Bare "/api/admin" prefix, not its own "/api/admin/polls" one - this
// router needs two different real prefixes (/api/admin/polls/... and
// /api/admin/settings/poll-widget), see routes/admin/polls.js's top
// comment. Registered after adminAuthRoutes (also mounted at bare
// "/api/admin", for /login) so /login keeps resolving there first -
// adminPollsRoutes has no /login route, so requests fall through
// correctly either way, but this keeps the ordering unsurprising.
app.use("/api/admin", requireAdmin, adminPollsRoutes);

// Basic error handler so a thrown error becomes JSON instead of crashing.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong." });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Hodl Horizon API listening on http://localhost:${port}`);

  // Loud and impossible to miss on purpose - this flag makes SPY/QQQ/Gold/
  // WTI data fake (canned, not fabricated-looking - see dryRunFixtures.js),
  // and it must never be on in production without someone noticing. See
  // backend/.env.example's MARKET_DATA_DRY_RUN comment.
  if (process.env.MARKET_DATA_DRY_RUN === "true") {
    console.log("MARKET_DATA_DRY_RUN=true - using canned responses, not calling real providers.");
  }

  // TODO(Robert): set a real ADMIN_PASSWORD in .env before this ever runs
  // against a production database - deliberately not auto-generated here
  // (see the pre-launch security review), since it's a credential you need
  // to remember and type yourself. One catch: seed.js only ever INSERTs the
  // admin row if that email doesn't already exist - if you've already run
  // seed once, changing this env var alone won't update an existing
  // account's password. Update admin_users.password_hash directly (or drop
  // the row and re-run `npm run seed`) to actually change a live password.
  if (process.env.ADMIN_PASSWORD === "change-this-password") {
    console.warn(
      "SECURITY: ADMIN_PASSWORD in .env is still the default placeholder - set a real password before deploying. " +
        "If an admin account already exists in the database, changing this value alone will NOT update its password " +
        "(seed.js only creates the row once) - update admin_users.password_hash directly, or delete that row and re-run `npm run seed`."
    );
  }

  startScheduler();
});
