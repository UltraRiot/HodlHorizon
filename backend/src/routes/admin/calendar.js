import { Router } from "express";
import { query } from "../../db.js";

const router = Router();

router.get("/", async (req, res) => {
  const { rows } = await query("SELECT * FROM calendar_events ORDER BY event_time");
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { title, event_time, impact, category } = req.body;
  const { rows } = await query(
    "INSERT INTO calendar_events (title, event_time, impact, category) VALUES ($1, $2, $3, $4) RETURNING *",
    [title, event_time, impact || "medium", category || "macro"]
  );
  res.status(201).json(rows[0]);
});

router.delete("/:id", async (req, res) => {
  await query("DELETE FROM calendar_events WHERE id = $1", [req.params.id]);
  res.status(204).end();
});

export default router;
