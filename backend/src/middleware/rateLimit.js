import { rateLimit, ipKeyGenerator, DAY } from "express-rate-limit";

export function perIpPerResourceLimiter({ max }) {
  return rateLimit({
    windowMs: DAY,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${req.params.id}`,
    handler: (req, res) => {
      res.status(429).json({ error: "Too many requests for this item today - please try again later." });
    },
  });
}

export function perIpLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: (req, res) => {
      res.status(429).json({ error: message || "Too many requests - please try again later." });
    },
  });
}
