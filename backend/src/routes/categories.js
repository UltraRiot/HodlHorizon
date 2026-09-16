import { Router } from "express";
import { query } from "../db.js";

const router = Router();

router.get("/", async (req, res) => {
  const { rows } = await query("SELECT slug, name FROM categories ORDER BY name");
  res.json(rows);
});

export default router;
