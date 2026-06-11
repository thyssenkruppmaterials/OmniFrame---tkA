-- ============================================================================
-- Migration 331 — Auto-retry budget for /sap/confirm-to jobs (putaway
--                 auto-confirm) so a transient SAP GUI layout race no longer
--                 wedges a TO at "Pending TO Confirm" forever.
-- ============================================================================
--
-- Incident (production, 2026-05-28, org c9d89a74…):
--   27 putaway TOs created 2026-05-27 sat stuck at
--   `rf_putaway_operations.to_status='Completed', confirmed_source IS NULL`
--   ("Pending TO Confirm" pill). Every one had a `sap_agent_jobs` row that
--   FAILED on the same transient SAP GUI scripting error:
--
--     (-2147352567, 'Exception occurred.', (619, 'SAP Frontend Server',
--       'The control could not be found by id.', ... ))
--
--   raised by `sess.findById(...)` when the LT12 screen was mid-transition
--   under fleet load (4 workers hammering one pinned SAP session). The race
--   is intermittent — `sap_audit_log` for the burst window showed
--   17 success / 44 of these 619 failures across the fleet on the SAME
--   idempotent code path. The agent recovered minutes later, but the 27
--   rows were already terminal because:
--
--     * The trigger evaluator
--       (`rust-work-service::triggers::evaluator::fire_trigger`) INSERTs
--       `sap_agent_jobs` WITHOUT a `max_attempts`, so each row inherited the
--       table default of **1** (migration 245). One transient blip = one
--       burned attempt = permanent `status='failed'`.
--     * The backfill re-queue loop (migration 289 /
--       `backfill_pending_putaway_confirms`) only re-fires `failed` confirm
--       jobs inside a lookback window (default 24h). Once the rows aged past
--       24h they stopped being retried and wedged.
--
--   See [[Debug/Fix-Putaway-Confirms-Stuck-At-29-Layout-Race]].
--
-- Fix (this migration):
--   Give `/sap/confirm-to` jobs an attempts budget > 1 so a transient race
--   is auto-retried via the lease-expiry re-claim path
--   (`claim_sap_agent_job`, migration 291) instead of dying on the first
--   blip. We do NOT raise the global `sap_agent_jobs.max_attempts` default,
--   because that would let genuinely long-running jobs (e.g. an LT10
--   full-warehouse query whose run exceeds its claim lease) be re-claimed up
--   to N times — exactly the phantom-multi-execution regression migration
--   291 was written to bound. Instead we scope the bump to the idempotent
--   confirm-TO endpoint via a BEFORE INSERT trigger.
--
--   Why 3 (not 5): the 2026-05-28 race burst lasted ~4 minutes. With the
--   90-second claim lease, 3 attempts span ~3–5 minutes of re-claim
--   opportunity — enough to ride out a transient GUI race or let a sibling
--   worker on a healthier session pick it up — without churning a truly
--   broken row for long. Migration 291's `watchdog_max_attempts` sweep
--   still caps the total: once `attempts >= max_attempts` and the lease
--   lapses, the row is auto-failed with a breadcrumb. Bounded retry, not
--   infinite churn.
--
-- Safety / scope:
--   * Endpoint-scoped to `/sap/confirm-to` ONLY. Every other endpoint
--     (`/sap/lt12` picks, `/sap/query`, `/sap/import-lt22`, master-data,
--     etc.) keeps the table default of 1 — byte-identical behaviour.
--   * NEVER lowers an explicitly-set higher value: the trigger only bumps
--     when the incoming `max_attempts` is below 3 (covers the default-1
--     path the evaluator uses). A future caller that sets 5 is left alone.
--   * Idempotent on apply: re-running just re-creates the function +
--     trigger. No data migration, no RLS change, no row rewrite.
--   * Pairs with the agent-side change in
--     `omni_agent/agent.py::confirm_transfer_order` (v2.1.x) which now
--     classifies the 619 error as transient/retryable and leaves the job
--     'running' for lease-expiry re-claim instead of marking it failed.
--     That agent change requires an EXE rebuild to take effect; this
--     migration is the DB half and takes effect immediately for newly
--     enqueued confirm-TO jobs.
--
-- Related:
--   * [[Debug/Fix-Putaway-Confirms-Stuck-At-29-Layout-Race]] — incident.
--   * migration 245 — `sap_agent_jobs` table + default max_attempts=1.
--   * migration 291 — `claim_sap_agent_job` max_attempts enforcement +
--     lease-expiry re-claim (the path this budget feeds).
--   * migration 289 — `backfill_pending_putaway_confirms` re-queue loop.
--   * [[Implementations/Implement-Putaway-Confirm-Backfill-Loop]].
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.set_confirm_to_max_attempts()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Only the idempotent putaway confirm endpoint gets the larger retry
  -- budget. Never lower an explicitly-set higher value.
  IF NEW.endpoint = '/sap/confirm-to'
     AND COALESCE(NEW.max_attempts, 1) < 3 THEN
    NEW.max_attempts := 3;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.set_confirm_to_max_attempts() IS
  'BEFORE INSERT trigger fn (migration 331): raises max_attempts to 3 for '
  '/sap/confirm-to jobs so a transient SAP GUI 619 "control could not be '
  'found by id" layout race is auto-retried via the migration-291 '
  'lease-expiry re-claim path instead of wedging the putaway TO at '
  '"Pending TO Confirm". Endpoint-scoped; never lowers a higher explicit '
  'value. See Debug/Fix-Putaway-Confirms-Stuck-At-29-Layout-Race.';

DROP TRIGGER IF EXISTS trg_set_confirm_to_max_attempts
  ON public.sap_agent_jobs;

CREATE TRIGGER trg_set_confirm_to_max_attempts
  BEFORE INSERT ON public.sap_agent_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_confirm_to_max_attempts();

COMMIT;
