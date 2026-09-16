// Shows how much the AI engine has cost this month, broken down by provider.
// Every AI call (services/ai/provider.js) writes one row to ai_usage_log.
import { Router } from "express";
import { query } from "../../db.js";

const router = Router();

router.get("/", async (req, res) => {
  const { rows } = await query(
    `SELECT provider, COUNT(*) AS calls, SUM(tokens_estimate) AS tokens,
            SUM(cost_estimate_usd) AS cost_usd
     FROM ai_usage_log
     WHERE created_at >= date_trunc('month', now())
     GROUP BY provider`
  );

  const totalCost = rows.reduce((sum, r) => sum + Number(r.cost_usd || 0), 0);
  res.json({ by_provider: rows, total_cost_usd: Number(totalCost.toFixed(4)) });
});

export default router;
