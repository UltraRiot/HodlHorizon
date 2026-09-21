// Visibility into the recurring content-quality audit (services/audit/
// contentQualityAudit.js, run weekly by jobs/scheduler.js) - "a table, or
// a simple admin-panel view... so failure rates are visible over time,
// not just at the moment someone asks." Read-only: this route never
// triggers a run itself, it only shows what the scheduled job already
// found.
import { Router } from "express";
import { query } from "../../db.js";

const router = Router();

// Latest result per (check_name, category_scope) pair, plus enough
// history for each to compute a simple trend client-side if wanted -
// DISTINCT ON gives the latest row per check/scope in one query rather
// than N round trips.
router.get("/", async (req, res) => {
  const latest = await query(
    `SELECT DISTINCT ON (check_name, category_scope)
       check_name, category_scope, checked_count, failed_count, run_at, sample_findings
     FROM content_audit_runs
     ORDER BY check_name, category_scope, run_at DESC`
  );

  const history = await query(
    `SELECT check_name, category_scope, checked_count, failed_count, run_at
     FROM content_audit_runs
     ORDER BY run_at DESC
     LIMIT 200`
  );

  res.json({
    latest: latest.rows.map((r) => {
      // review_queue_size is a gauge (current backlog count), not a
      // pass/fail check - checked_count and failed_count are always equal
      // by construction there (see contentQualityAudit.js), so a computed
      // "failure_rate" of 100% would read as an alarming, meaningless
      // number rather than the queue size it actually is.
      if (r.check_name === "review_queue_size") {
        return { ...r, queue_size: r.failed_count, failure_rate: null };
      }
      return { ...r, failure_rate: r.checked_count > 0 ? Number((r.failed_count / r.checked_count).toFixed(3)) : 0 };
    }),
    history: history.rows,
  });
});

export default router;
