import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { MINUTE } from "express-rate-limit";
import { query } from "../../db.js";
import { perIpLimiter } from "../../middleware/rateLimit.js";

const router = Router();

// Pre-launch security review: this route had zero abuse protection - unlike
// the poll-vote/reaction routes (perIpPerResourceLimiter, middleware/
// rateLimit.js), nothing stopped unlimited password-guessing attempts.
// 10/15min is generous enough for a real admin who fat-fingers a password
// a couple of times, tight enough to make brute-forcing impractical.
const loginLimiter = perIpLimiter({
  windowMs: 15 * MINUTE,
  max: 10,
  message: "Too many login attempts - please try again in 15 minutes.",
});

// POST /api/admin/login   { email, password } -> { token }
router.post("/login", loginLimiter, async (req, res) => {
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
