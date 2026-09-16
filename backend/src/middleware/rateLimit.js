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
