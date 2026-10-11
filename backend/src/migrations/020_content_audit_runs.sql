CREATE TABLE IF NOT EXISTS content_audit_runs (
  id SERIAL PRIMARY KEY,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  check_name TEXT NOT NULL,
  category_scope TEXT,
  checked_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,
  sample_findings JSONB
);

CREATE INDEX IF NOT EXISTS content_audit_runs_check_name_idx ON content_audit_runs (check_name, run_at DESC);
