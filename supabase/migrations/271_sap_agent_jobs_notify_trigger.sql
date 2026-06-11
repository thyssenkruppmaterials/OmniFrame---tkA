-- Migration: NOTIFY trigger on `sap_agent_jobs` for the Rust WS migration
-- Date: 2026-05-06
-- Description:
--   Companion to the `WsEvent::SapJobStatusChanged` migration documented
--   in memorybank/OmniFrame/Implementations/Migrate-Tier1-Deferred-
--   Channels-To-Rust-WS.md. Replaces the ephemeral `supabase.channel(
--   'sap-agent-job-{id}')` callsite in
--   `src/features/admin/sap-testing/hooks/use-job-queue.ts`. Each job
--   submission used to spin up its own short-lived Realtime channel,
--   tear it down 250ms after terminal status — that channel churn is
--   what this migration retires.
--
-- Mirrors the shape of `notify_sap_agent_changed()` (mig 270):
--   * SECURITY DEFINER — trigger runs irrespective of caller RLS.
--   * `search_path = public, pg_temp` — paranoia hardening.
--   * `OR REPLACE` / `IF NOT EXISTS` so the migration is re-runnable.
--   * Trigger fires AFTER INSERT OR UPDATE OR DELETE.
--
-- Payload shape (consumed by `rust-work-service::sap_jobs_listener`):
--   {
--     "job_id":          uuid,
--     "organization_id": uuid,        -- NOT NULL on this table
--     "status":          text,        -- 'queued'|'running'|'completed'|'failed'|'canceled'
--     "step":            text|null,   -- agent-reported progress label
--     "op":              text         -- 'INSERT' | 'UPDATE' | 'DELETE'
--   }
--
-- Channel name: `sap_agent_job_changed`.
--
-- Trigger is a no-op from the row's POV beyond the cost of one
-- `pg_notify` per row change. Job rows update on each agent
-- heartbeat-while-running (~5s cadence) so the volume per active job
-- is modest; load testing was done at fleet scale before this lands.

-- ───────────────────────────────────────────────────────────────────────
-- 1. Notifier function
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_sap_agent_job_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payload jsonb;
  v_row     public.sap_agent_jobs;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;

  v_payload := jsonb_build_object(
    'job_id',          v_row.id,
    'organization_id', v_row.organization_id,
    'status',          v_row.status,
    'step',            v_row.step,
    'op',              TG_OP
  );

  PERFORM pg_notify('sap_agent_job_changed', v_payload::text);
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION public.notify_sap_agent_job_changed() IS
  'NOTIFY trigger emitted on sap_agent_jobs row change. Consumed by '
  'rust-work-service via sqlx PgListener; broadcast as '
  'WsEvent::SapJobStatusChanged to org-scoped WS subscribers. Replaces '
  'the per-job supabase.channel(`sap-agent-job-{id}`) ephemeral '
  'channels in src/features/admin/sap-testing/hooks/use-job-queue.ts.';

-- ───────────────────────────────────────────────────────────────────────
-- 2. Trigger
-- ───────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS sap_agent_jobs_notify_changed ON public.sap_agent_jobs;

CREATE TRIGGER sap_agent_jobs_notify_changed
  AFTER INSERT OR UPDATE OR DELETE
  ON public.sap_agent_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_sap_agent_job_changed();

COMMENT ON TRIGGER sap_agent_jobs_notify_changed ON public.sap_agent_jobs IS
  'Per-row pg_notify on sap_agent_jobs change → channel '
  'sap_agent_job_changed. See notify_sap_agent_job_changed() for payload.';
