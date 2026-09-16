// Protects admin routes. The admin panel sends the JWT it got from
// POST /api/admin/login as "Authorization: Bearer <token>".
import jwt from "jsonwebtoken";

export function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing admin token." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = payload; // { adminId, email }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}
