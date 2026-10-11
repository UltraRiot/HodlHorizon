import { Router } from "express";
import { query } from "../../db.js";

const router = Router();

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
      if (r.check_name === "review_queue_size") {
        return { ...r, queue_size: r.failed_count, failure_rate: null };
      }
      return { ...r, failure_rate: r.checked_count > 0 ? Number((r.failed_count / r.checked_count).toFixed(3)) : 0 };
    }),
    history: history.rows,
  });
});

export default router;
