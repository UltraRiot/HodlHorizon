import { Router } from "express";
import { query } from "../db.js";
import { perIpPerResourceLimiter } from "../middleware/rateLimit.js";

const router = Router();
const voteLimiter = perIpPerResourceLimiter({ max: 5 });

async function loadPollWithOptions(pollId) {
  const { rows: pollRows } = await query("SELECT id, question FROM polls WHERE id = $1", [pollId]);
  if (pollRows.length === 0) return null;

  const { rows: options } = await query(
    "SELECT id, label, votes FROM poll_options WHERE poll_id = $1 ORDER BY id",
    [pollId]
  );
  const total = options.reduce((sum, o) => sum + o.votes, 0);

  return {
    ...pollRows[0],
    total_votes: total,
    options: options.map((o) => ({
      ...o,
      percent: total === 0 ? 0 : Math.round((o.votes / total) * 100),
    })),
  };
}

// GET /api/polls/latest - the poll shown in the homepage sidebar. Admin
// can turn the whole widget off (routes/admin/polls.js's poll-widget
// setting) without archiving/deleting the underlying poll, and an
// archived poll never shows here even while the widget is on.
router.get("/latest", async (req, res) => {
  const { rows: settingRows } = await query("SELECT value FROM settings WHERE key = 'poll_widget_enabled'");
  if (settingRows.length > 0 && settingRows[0].value === "false") {
    return res.json(null);
  }

  const { rows } = await query(
    "SELECT id FROM polls WHERE status = 'active' ORDER BY created_at DESC LIMIT 1"
  );
  if (rows.length === 0) return res.json(null);
  res.json(await loadPollWithOptions(rows[0].id));
});

// POST /api/polls/:id/vote   { optionId }
router.post("/:id/vote", voteLimiter, async (req, res) => {
  const { optionId } = req.body;
  const { rowCount } = await query(
    "UPDATE poll_options SET votes = votes + 1 WHERE id = $1 AND poll_id = $2",
    [optionId, req.params.id]
  );

  if (rowCount === 0) {
    return res.status(404).json({ error: "Poll option not found." });
  }

  res.json(await loadPollWithOptions(req.params.id));
});

export default router;
