-- Phase 5 (2026-05-06) — extend sap_audit_log status check to support
-- the lifecycle states used by the rust-work-service
-- /api/v1/sap-mutations/material-master endpoint.
--
-- Pre-flight rows land at 'pending'; the sap_jobs_listener patches
-- the row to 'completed' / 'failed' / 'canceled' when the matching
-- sap_agent_jobs row reaches a terminal state. The legacy values
-- ('success', 'error', 'warning') stay accepted so the existing
-- frontend `logSapAudit(...)` callsites don't have to migrate in
-- lock-step.
--
-- Idempotent — safe to re-run if needed.

ALTER TABLE public.sap_audit_log
  DROP CONSTRAINT IF EXISTS sap_audit_log_status_check;

ALTER TABLE public.sap_audit_log
  ADD CONSTRAINT sap_audit_log_status_check
  CHECK (status = ANY (ARRAY[
    'success'::text,
    'error'::text,
    'warning'::text,
    'pending'::text,
    'completed'::text,
    'failed'::text,
    'canceled'::text
  ]));

COMMENT ON CONSTRAINT sap_audit_log_status_check ON public.sap_audit_log IS
  'Phase 5 (rust-work-service /api/v1/sap-mutations) extended the
   allowed status values from the legacy {success, error, warning}
   triplet to also accept the lifecycle states the new pre-flight
   path uses: pending (just inserted), completed / failed / canceled
   (set by the sap_jobs_listener on terminal sap_agent_jobs UPDATE).';

-- Speed up the listener-side `WHERE id = $audit_log_id` patch and
-- `WHERE job_id = $job_id` lookup that the rust-work-service
-- sap_jobs_listener uses on every terminal status flip. The id PK
-- already covers the first; the job_id index covers the second.
CREATE INDEX IF NOT EXISTS idx_sap_audit_log_job_id
  ON public.sap_audit_log(job_id)
  WHERE job_id IS NOT NULL;
