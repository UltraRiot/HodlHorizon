-- Recurring content-quality audit (services/audit/contentQualityAudit.js,
-- wired weekly into jobs/scheduler.js): re-runs every existing guardrail
-- check against the most recently published batch and needs somewhere
-- durable to log results, so failure rates are visible as a trend over
-- time ("did this check's failure rate just spike") rather than only
-- knowable at the moment someone happens to ask. One row per (run,
-- check_name) pair rather than one wide row per run - keeps adding a new
-- check in the future a pure INSERT, no ALTER TABLE, and makes "show me
-- this one check's history over the last 10 runs" a plain WHERE clause
-- instead of unpacking a JSON blob.
CREATE TABLE IF NOT EXISTS content_audit_runs (
  id SERIAL PRIMARY KEY,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  check_name TEXT NOT NULL,
  category_scope TEXT, -- category slug, or NULL for a site-wide check
  checked_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,
  -- A handful of real failing article ids/notes from this run, so a human
  -- looking at a spike doesn't have to re-run the audit to see an example.
  sample_findings JSONB
);

CREATE INDEX IF NOT EXISTS content_audit_runs_check_name_idx ON content_audit_runs (check_name, run_at DESC);
