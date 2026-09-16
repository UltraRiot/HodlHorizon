import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "../../db.js";

const router = Router();

// POST /api/admin/login   { email, password } -> { token }
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await query("SELECT * FROM admin_users WHERE email = $1", [email]);

  if (rows.length === 0) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const admin = rows[0];
  const ok = await bcrypt.compare(password, admin.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const token = jwt.sign({ adminId: admin.id, email: admin.email }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  res.json({ token, email: admin.email });
});

export default router;
