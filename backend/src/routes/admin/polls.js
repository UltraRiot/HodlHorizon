// Full admin management for polls: create (with 2-6 options), archive/
// restore instead of only ever hard-deleting, delete outright, and a
// site-wide on/off switch for the homepage widget (routes/polls.js's
// GET /latest reads both the switch and each poll's status).
//
// Mounted at the bare "/api/admin" prefix (see server.js), not its own
// "/api/admin/polls" prefix like feeds.js/glossary.js - this file needs
// two different prefixes (/api/admin/polls/... AND
// /api/admin/settings/poll-widget), so every route below spells out its
// own full path from "/api/admin" rather than assuming one shared base.
import { Router } from "express";
import pool, { query } from "../../db.js";

const router = Router();

// GET /api/admin/polls - every poll, both statuses, newest first, with
// options/votes/percentages. Batches the options lookup in one query
// (grouped in memory) instead of one query per poll.
router.get("/polls", async (req, res) => {
  const { rows: polls } = await query(
    "SELECT id, question, status, created_at FROM polls ORDER BY created_at DESC"
  );
  const { rows: options } = await query(
    "SELECT id, poll_id, label, votes FROM poll_options ORDER BY id"
  );

  const optionsByPoll = new Map();
  for (const option of options) {
    if (!optionsByPoll.has(option.poll_id)) optionsByPoll.set(option.poll_id, []);
    optionsByPoll.get(option.poll_id).push(option);
  }

  res.json(
    polls.map((poll) => {
      const pollOptions = optionsByPoll.get(poll.id) || [];
      const total = pollOptions.reduce((sum, o) => sum + o.votes, 0);
      return {
        ...poll,
        total_votes: total,
        options: pollOptions.map((o) => ({
          ...o,
          percent: total === 0 ? 0 : Math.round((o.votes / total) * 100),
        })),
      };
    })
  );
});

// POST /api/admin/polls   { question, options: string[] } (2-6 options)
// Inserts the poll then its options in one transaction - a failure
// partway through (e.g. a bad option row) rolls back the poll insert too,
// so a poll can never end up saved with zero or partial options.
router.post("/polls", async (req, res) => {
  const { question, options } = req.body;

  if (!question || typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "question is required." });
  }
  const cleanOptions = Array.isArray(options) ? options.map((o) => (typeof o === "string" ? o.trim() : "")) : [];
  if (cleanOptions.length < 2 || cleanOptions.length > 6 || cleanOptions.some((o) => !o)) {
    return res.status(400).json({ error: "options must be 2-6 non-empty strings." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: pollRows } = await client.query(
      "INSERT INTO polls (question) VALUES ($1) RETURNING id, question, status, created_at",
      [question.trim()]
    );
    const poll = pollRows[0];

    const insertedOptions = [];
    for (const label of cleanOptions) {
      const { rows } = await client.query(
        "INSERT INTO poll_options (poll_id, label) VALUES ($1, $2) RETURNING id, poll_id, label, votes",
        [poll.id, label]
      );
      insertedOptions.push(rows[0]);
    }

    await client.query("COMMIT");
    res.status(201).json({
      ...poll,
      total_votes: 0,
      options: insertedOptions.map((o) => ({ ...o, percent: 0 })),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Could not create poll.", detail: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/admin/polls/:id/archive - takes it off the homepage widget
// (routes/polls.js filters WHERE status = 'active') without losing its
// vote history, unlike DELETE below.
router.patch("/polls/:id/archive", async (req, res) => {
  const { rows } = await query(
    "UPDATE polls SET status = 'archived' WHERE id = $1 RETURNING id, question, status, created_at",
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Poll not found." });
  res.json(rows[0]);
});

// PATCH /api/admin/polls/:id/restore - makes an archived poll eligible to
// show on the homepage widget again (still subject to being the most
// recent active poll, and the widget being enabled at all).
router.patch("/polls/:id/restore", async (req, res) => {
  const { rows } = await query(
    "UPDATE polls SET status = 'active' WHERE id = $1 RETURNING id, question, status, created_at",
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Poll not found." });
  res.json(rows[0]);
});

// DELETE /api/admin/polls/:id - hard delete; poll_options cascades via its
// existing FK (migrations/001_init.sql). Unlike archive, this loses vote
// history permanently - the frontend confirms before calling this.
router.delete("/polls/:id", async (req, res) => {
  await query("DELETE FROM polls WHERE id = $1", [req.params.id]);
  res.status(204).end();
});

// GET/PATCH /api/admin/settings/poll-widget - reuses the settings table,
// same on/off-switch pattern as auto_publish (routes/admin/aiEngine.js).
router.get("/settings/poll-widget", async (req, res) => {
  const { rows } = await query("SELECT value FROM settings WHERE key = 'poll_widget_enabled'");
  const enabled = rows.length === 0 || rows[0].value === "true";
  res.json({ poll_widget_enabled: enabled });
});

router.patch("/settings/poll-widget", async (req, res) => {
  const { poll_widget_enabled } = req.body;
  if (poll_widget_enabled === undefined) {
    return res.status(400).json({ error: "poll_widget_enabled is required." });
  }
  await query(
    "INSERT INTO settings (key, value) VALUES ('poll_widget_enabled', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [String(Boolean(poll_widget_enabled))]
  );
  res.json({ poll_widget_enabled: Boolean(poll_widget_enabled) });
});

export default router;
