// The "AI Engine" page: toggle auto-publish, change the scan interval, and
// trigger an immediate scan.
import { Router } from "express";
import { query } from "../../db.js";
import { runScanAndGenerate } from "../../services/rss/scanAndGenerate.js";
import { runAnalysisScan } from "../../services/analysis/runAnalysis.js";

const router = Router();

const DAILY_CAP_SLUGS = ["crypto", "stocks", "indices", "commodities", "analysis"];
const DEFAULT_DAILY_CAPS = { crypto: 6, stocks: 4, indices: 2, commodities: 2, analysis: 2 };

router.get("/settings", async (req, res) => {
  const { rows } = await query("SELECT key, value FROM settings");
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const daily_caps = {};
  for (const slug of DAILY_CAP_SLUGS) {
    daily_caps[slug] = Number(settings[`daily_cap_${slug}`] ?? DEFAULT_DAILY_CAPS[slug]);
  }

  res.json({
    auto_publish: settings.auto_publish === "true",
    scan_interval_minutes: Number(settings.scan_interval_minutes || 15),
    ai_provider: process.env.AI_PROVIDER || "mock",
    daily_caps,
  });
});

// PATCH body can include any of: auto_publish, scan_interval_minutes,
// daily_caps: { crypto, stocks, indices, commodities, analysis } (partial ok)
router.patch("/settings", async (req, res) => {
  const { auto_publish, scan_interval_minutes, daily_caps } = req.body;

  if (auto_publish !== undefined) {
    await query(
      "INSERT INTO settings (key, value) VALUES ('auto_publish', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [String(auto_publish)]
    );
  }
  if (scan_interval_minutes !== undefined) {
    await query(
      "INSERT INTO settings (key, value) VALUES ('scan_interval_minutes', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [String(scan_interval_minutes)]
    );
  }
  if (daily_caps && typeof daily_caps === "object") {
    for (const slug of DAILY_CAP_SLUGS) {
      if (daily_caps[slug] === undefined) continue;
      await query(
        "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
        [`daily_cap_${slug}`, String(daily_caps[slug])]
      );
    }
  }

  res.json({ ok: true });
});

// POST /api/admin/ai-engine/scan-now - run the news pipeline immediately
// instead of waiting for the next scheduled tick. Useful for testing.
router.post("/scan-now", async (req, res) => {
  try {
    const result = await runScanAndGenerate();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Scan failed.", detail: err.message });
  }
});

// POST /api/admin/ai-engine/analysis-now - run the Analysis job immediately.
router.post("/analysis-now", async (req, res) => {
  try {
    const result = await runAnalysisScan();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Analysis run failed.", detail: err.message });
  }
});

export default router;
