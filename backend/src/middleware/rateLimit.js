// Lightweight per-IP-per-resource rate limiting for the public poll-vote
// and article-reaction endpoints (pre-launch audit: confirmed neither had
// any abuse protection at all - a trivial script could inflate/deflate a
// poll or reaction count with no limit). Deliberately basic -
// express-rate-limit's default in-memory store, no Redis/external store -
// this is meant to stop a casual script, not survive a determined
// distributed attacker; a heavier solution wasn't judged worth the
// complexity before real traffic arrives (a judgment call flagged in the
// original audit, this is the "yes, do it, keep it simple" follow-through).
//
// Keyed on IP + the specific poll/article id (req.params.id) - a visitor
// voting on 5 different polls today isn't abuse, only voting on the SAME
// one repeatedly is. ipKeyGenerator (not raw req.ip) is required here,
// not optional - express-rate-limit normalizes/truncates IPv6 addresses
// for its own internal bucketing, and combining a raw (un-normalized) IP
// into a custom key defeats that and throws in this version.
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

// Plain per-IP limiter - no :id/resource scoping, for a route where the
// abuse target is the ROUTE itself rather than a specific record (the
// motivating case: POST /api/admin/login had zero abuse protection at all,
// unlike the poll-vote/reaction routes above, which perIpPerResourceLimiter
// already covers). Same ipKeyGenerator requirement as above - express-rate-
// limit normalizes/truncates IPv6 addresses for its own bucketing, and a
// custom keyGenerator that uses req.ip without routing it through
// ipKeyGenerator defeats that and throws in this version.
//
// Known limitation, stated plainly rather than silently assumed away: like
// perIpPerResourceLimiter above, this keys on req.ip, which - with no
// `app.set("trust proxy", ...)` configured in server.js - resolves to the
// raw socket address. Deployed behind a reverse proxy/load balancer with
// trust proxy left unset, every real visitor would collapse onto the
// proxy's one IP, making this (and the existing resource limiter) key on a
// single shared bucket instead of per real client. Not fixed here: whether
// there IS a trusted proxy in front of this in production is a deployment
// fact this codebase doesn't currently record, and blindly trusting
// X-Forwarded-For without a real trusted proxy would let an attacker
// spoof any IP and defeat rate limiting entirely - worse than the current
// gap. Needs a real answer about the deployment topology, not a guess.
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
