import express from "express";
import cors from "cors";
import helmet from "helmet";
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
import adminContentAuditRoutes from "./routes/admin/contentAudit.js";
import { requireAdmin } from "./middleware/adminAuth.js";
import { startScheduler } from "./jobs/scheduler.js";

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());
app.use(helmet());

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
app.use("/api/admin/content-audit", requireAdmin, adminContentAuditRoutes);
app.use("/api/admin", requireAdmin, adminPollsRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong." });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Hodl Horizon API listening on http://localhost:${port}`);

  if (process.env.MARKET_DATA_DRY_RUN === "true") {
    console.log("MARKET_DATA_DRY_RUN=true - using canned responses, not calling real providers.");
  }

  if (process.env.ADMIN_PASSWORD === "change-this-password") {
    console.warn(
      "SECURITY: ADMIN_PASSWORD in .env is still the default placeholder - set a real password before deploying. " +
        "If an admin account already exists in the database, changing this value alone will NOT update its password " +
        "(seed.js only creates the row once) - update admin_users.password_hash directly, or delete that row and re-run `npm run seed`."
    );
  }

  startScheduler();
});
