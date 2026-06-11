-- ============================================================================
-- Migration 289 — Auto-recovery loop for stuck putaway TO confirms
-- ============================================================================
--
-- Problem (production, 2026-05-08, org c9d89a74…):
--   The Phase 9 trigger evaluator (rust-work-service v0.1.34) IS firing for
--   newly-completed putaway TOs and INSERTing rows into `sap_agent_jobs`.
--   The agent IS claiming them via `claim_sap_agent_job(...)`. But when the
--   SAP GUI session has a transient hiccup — "control could not be found by
--   id" (LT12 layout error), "No active SAP GUI session found" (operator
--   logged out of SAPGUI), or "Watchdog: job exceeded 120s timeout" (SAP
--   session hang) — the agent calls `/jobs/:id/fail` and the row sits at
--   `status='failed', attempts=1, max_attempts=1` forever. Nothing in the
--   stack ever revisits it.
--
--   Concrete evidence captured today: 11 stuck rows on
--   `c9d89a74-7179-4033-93ea-56267cf42a17`, every one with a corresponding
--   `sap_agent_jobs` row keyed by
--   `trig:b8160159-ac8c-4488-bce2-3d193dc33697:<row_id>:20581` in
--   `status='failed'`. The agent recovered by 21:27 UTC and confirmed
--   ~30 fresher TOs without issue, so the underlying SAP path is healthy —
--   only the earlier failed jobs were left orphaned.
--
--   The `<unix-day>` suffix on the idempotency key is what makes "just bump
--   `updated_at` to drive a fresh NOTIFY" insufficient: the fresh NOTIFY
--   fires, the trigger evaluator runs, but its INSERT collides with the
--   existing `failed` row on
--   `UNIQUE (organization_id, idempotency_key)` (see migration 247) and
--   silently no-ops. So this migration's recovery path has to reset the
--   failed job in-place.
--
-- Fix:
--   `public.backfill_pending_putaway_confirms(...)` runs every 5 minutes
--   via pg_cron. It does TWO things:
--
--   1. RESET FAILED JOBS — for `rf_putaway_operations` rows in the
--      auto-confirm candidate set (Completed, non-MCA, NULL
--      confirmed_source) within the lookback window, find the matching
--      `sap_agent_jobs` row(s) in `status='failed'` and flip them back to
--      `status='queued'`. Clears `claimed_by`, `claimed_at`,
--      `claim_lease_until`, `started_at`, `completed_at`, `heartbeat_at`,
--      `step` and resets `attempts=0` so the next claim cycle starts
--      clean. Increments `max_attempts` to GREATEST(max_attempts,
--      attempts + 2) so the re-queued job has retry budget. Appends a
--      `| retried by backfill at <ts>` breadcrumb to `error` for ops.
--
--      Guards against hammering: only resets jobs whose `completed_at`
--      is older than `p_failed_min_age_seconds` (default 60s) and whose
--      `claim_count < p_max_claim_count` (default 8). The 60s floor lets
--      a single "SAP GUI logged out" outage settle before we re-queue;
--      the claim-count cap prevents a permanently-broken row (e.g., a
--      TO that no longer exists in SAP) from churning forever.
--
--   2. REPLAY ORPHAN NOTIFYS — for candidate rows with NO `sap_agent_jobs`
--      row at all in the lookback window AND whose org has at least one
--      enabled `agent_triggers` rule on `rf_putaway_operations`, bump
--      `updated_at = now()`. The `rf_putaway_notify_changed` trigger fires
--      `notify_rf_putaway_changed`, the trigger evaluator runs, and
--      INSERTs a fresh job (no idempotency-key collision because there
--      was no prior job for this row in the window). The "org has an
--      enabled trigger" guard avoids pointlessly bumping rows for tenants
--      that don't run auto-confirm at all.
--
--   The function returns `(rows_failed_requeued, rows_orphan_replayed,
--   oldest_pending_minutes)` so the FE Force-Backfill button can display
--   meaningful feedback.
--
-- Org scoping:
--   * pg_cron path passes `p_organization_id := NULL`, which scopes by
--     "any org with an enabled trigger" — currently c9d89a74. New tenants
--     light up automatically the moment they enable an `agent_triggers`
--     rule on `rf_putaway_operations`.
--   * The rust-work-service `POST /api/v1/sap-agents/backfill-pending-confirms`
--     route passes the caller's `organization_id` from their JWT, so an
--     admin can only ever drain their own tenant.
--
-- Lookback windows (tunable via function args, NOT hardcoded):
--   * Candidate row lookback: 24h (default). Rows older than 24h are
--     intentionally left alone — they're either pre-Phase 9 historical
--     data (the org has 1,206 such rows going back to 2025-09) or rows
--     the operator has decided to leave unconfirmed for a reason. The
--     "Force backfill now" admin button can override this if needed.
--   * Failed-job min age before re-queue: 60s. Tight enough that a
--     transient SAP error gets retried within 60s of the next cron tick;
--     loose enough that a known-broken job doesn't churn at machine
--     speed.
--   * Max claim_count cap: 8. Six prior failed claims is plenty of
--     evidence that the row needs human attention.
--
-- Loop-detection compatibility:
--   The Phase 9 evaluator's Redis depth counter trips at depth > 3.
--   This migration's NOTIFY-replay path (orphan branch) is depth=1
--   from the cron context (no upstream NOTIFY chain). Depth=2 would
--   only happen if the evaluator's INSERT triggers a downstream NOTIFY
--   chain that loops back, which is impossible here — `sap_agent_jobs`
--   inserts notify on `sap_agent_job_changed`, which is consumed by the
--   agent + WS broadcaster, not by the rf_putaway listener.
--
-- Related notes:
--   * `Components/Rust-Work-Service.md` — listener resilience pairs with
--     this data-plane backfill.
--   * `Implementations/Implement-Putaway-Confirm-Backfill-Loop.md` —
--     full design rationale.
--   * `Decisions/ADR-Trigger-DSL-Evaluator-Phase9.md` — the trigger
--     evaluator this migration shores up.
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────
-- 1. SQL function
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.backfill_pending_putaway_confirms(
  p_lookback_hours int DEFAULT 24,
  p_failed_min_age_seconds int DEFAULT 60,
  p_max_claim_count int DEFAULT 8,
  p_organization_id uuid DEFAULT NULL
)
RETURNS TABLE (
  rows_failed_requeued integer,
  rows_orphan_replayed integer,
  oldest_pending_minutes integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_failed_requeued integer := 0;
  v_orphan_replayed integer := 0;
  v_oldest_minutes integer := 0;
  v_lookback interval := make_interval(hours => p_lookback_hours);
  v_min_failed_age interval := make_interval(secs => p_failed_min_age_seconds);
BEGIN
  -- ── Branch 1: reset stale failed jobs back to 'queued' ──────────────
  --
  -- We match `sap_agent_jobs` rows to candidate `rf_putaway_operations`
  -- rows via the `idempotency_key` shape the Phase 9 evaluator builds:
  -- `trig:<trigger_id>:<row_id>:<unix-day>`. Joining through
  -- `agent_triggers` lets us avoid hardcoding trigger UUIDs — any
  -- enabled rule sourced from `rf_putaway_operations` qualifies.
  WITH candidates AS (
    SELECT r.id AS row_id, r.organization_id
    FROM public.rf_putaway_operations r
    WHERE r.to_status = 'Completed'
      AND r.confirmed_source IS NULL
      AND r.is_mca_workflow IS NOT TRUE
      AND r.created_at > now() - v_lookback
      AND (p_organization_id IS NULL OR r.organization_id = p_organization_id)
  ),
  candidate_triggers AS (
    SELECT t.id AS trigger_id, t.organization_id
    FROM public.agent_triggers t
    WHERE t.enabled = true
      AND t.source_table = 'rf_putaway_operations'
  ),
  failed_jobs AS (
    SELECT j.id
    FROM public.sap_agent_jobs j
    JOIN candidates c          ON c.organization_id = j.organization_id
    JOIN candidate_triggers ct ON ct.organization_id = j.organization_id
    WHERE j.status = 'failed'
      AND j.completed_at IS NOT NULL
      AND j.completed_at < now() - v_min_failed_age
      AND COALESCE(j.claim_count, 0) < p_max_claim_count
      AND j.idempotency_key LIKE
            'trig:' || ct.trigger_id::text || ':' || c.row_id::text || ':%'
  ),
  reset_failed AS (
    UPDATE public.sap_agent_jobs j
    SET status            = 'queued',
        claimed_by        = NULL,
        claimed_at        = NULL,
        claim_lease_until = NULL,
        heartbeat_at      = NULL,
        completed_at      = NULL,
        started_at        = NULL,
        step              = NULL,
        attempts          = 0,
        max_attempts      = GREATEST(COALESCE(j.max_attempts, 1), COALESCE(j.attempts, 0) + 2),
        error             = COALESCE(NULLIF(j.error, ''), '') ||
                            CASE WHEN COALESCE(j.error, '') = '' THEN '' ELSE ' | ' END ||
                            'retried by backfill at ' || now()::text
    FROM failed_jobs fj
    WHERE j.id = fj.id
    RETURNING j.id
  )
  SELECT count(*)::integer FROM reset_failed INTO v_failed_requeued;

  -- ── Branch 2: replay NOTIFY for orphan rows (no job at all in window) ─
  --
  -- "Orphan" = the row is a candidate AND its org has at least one
  -- enabled trigger on `rf_putaway_operations` AND there's no
  -- `sap_agent_jobs` row keyed by ANY of that org's triggers for this
  -- row in the lookback window. Bumping `updated_at` fires
  -- `notify_rf_putaway_changed`; the Phase 9 evaluator picks it up,
  -- matches the rule(s), and INSERTs a fresh job.
  WITH candidates AS (
    SELECT r.id AS row_id, r.organization_id
    FROM public.rf_putaway_operations r
    WHERE r.to_status = 'Completed'
      AND r.confirmed_source IS NULL
      AND r.is_mca_workflow IS NOT TRUE
      AND r.created_at > now() - v_lookback
      AND (p_organization_id IS NULL OR r.organization_id = p_organization_id)
  ),
  enabled_orgs AS (
    SELECT DISTINCT t.organization_id
    FROM public.agent_triggers t
    WHERE t.enabled = true
      AND t.source_table = 'rf_putaway_operations'
  ),
  orphans AS (
    SELECT c.row_id, c.organization_id
    FROM candidates c
    JOIN enabled_orgs eo ON eo.organization_id = c.organization_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.sap_agent_jobs j
      JOIN public.agent_triggers t
        ON t.organization_id = j.organization_id
       AND t.enabled = true
       AND t.source_table = 'rf_putaway_operations'
      WHERE j.organization_id = c.organization_id
        AND j.idempotency_key LIKE
              'trig:' || t.id::text || ':' || c.row_id::text || ':%'
        AND j.created_at > now() - v_lookback
    )
  ),
  bumped AS (
    UPDATE public.rf_putaway_operations r
    SET updated_at = now()
    FROM orphans o
    WHERE r.id = o.row_id
    RETURNING r.id
  )
  SELECT count(*)::integer FROM bumped INTO v_orphan_replayed;

  -- ── Telemetry (residual oldest-pending after the actions above) ─────
  SELECT COALESCE(
    EXTRACT(EPOCH FROM (now() - MIN(r.created_at))) / 60.0,
    0
  )::integer
  INTO v_oldest_minutes
  FROM public.rf_putaway_operations r
  WHERE r.to_status = 'Completed'
    AND r.confirmed_source IS NULL
    AND r.is_mca_workflow IS NOT TRUE
    AND r.created_at > now() - v_lookback
    AND (p_organization_id IS NULL OR r.organization_id = p_organization_id);

  -- Quiet operation: only log when we actually did something. The
  -- pg_cron job runs every 5 minutes; logging on every tick would
  -- swamp `pg_logs` for no signal.
  IF v_failed_requeued > 0 OR v_orphan_replayed > 0 THEN
    RAISE NOTICE
      'backfill_pending_putaway_confirms: failed_requeued=%, orphan_replayed=%, oldest_pending_minutes=%, lookback_hours=%, scope=%',
      v_failed_requeued, v_orphan_replayed, v_oldest_minutes, p_lookback_hours,
      COALESCE(p_organization_id::text, 'all-orgs');
  END IF;

  RETURN QUERY SELECT v_failed_requeued, v_orphan_replayed, v_oldest_minutes;
END;
$$;

COMMENT ON FUNCTION public.backfill_pending_putaway_confirms(int, int, int, uuid) IS
  'v0.1.35 — Auto-recovery loop for stuck putaway TO confirms. Re-queues '
  'sap_agent_jobs rows in status=failed for rf_putaway_operations rows '
  'still at to_status=Completed AND confirmed_source IS NULL AND '
  'is_mca_workflow IS NOT TRUE within the lookback window, and bumps '
  'updated_at on candidate rows that have no job at all (NOTIFY replay). '
  'Pass p_organization_id to scope to a single tenant (used by the rust-'
  'work-service POST /api/v1/sap-agents/backfill-pending-confirms route); '
  'leave NULL for the pg_cron path which scopes by "any org with an '
  'enabled trigger on rf_putaway_operations". Scheduled every 5 minutes. '
  'See migration 289 for design rationale.';

-- ───────────────────────────────────────────────────────────────────────
-- 2. pg_cron registration (idempotent, gracefully no-ops if absent)
-- ───────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
      FROM cron.job
     WHERE jobname = 'omniframe-backfill-pending-putaway-confirms';

    -- Every 5 minutes is the upper bound on how stale a confirm can
    -- get under steady-state SAP outages. Aligns with the FE banner
    -- threshold (oldest pending > 30 min => warn) so a single SAP
    -- hiccup that spans 2-3 cron ticks never lights up the banner.
    PERFORM cron.schedule(
      'omniframe-backfill-pending-putaway-confirms',
      '*/5 * * * *',
      $cron$ SELECT public.backfill_pending_putaway_confirms(); $cron$
    );
    RAISE NOTICE 'pg_cron job omniframe-backfill-pending-putaway-confirms scheduled (every 5 minutes).';
  ELSE
    RAISE NOTICE
      'pg_cron extension not enabled — putaway confirm backfill will only '
      'run when the rust-work-service /backfill-pending-confirms route is '
      'invoked manually. Enable pg_cron in Supabase Dashboard → Database '
      '→ Extensions and re-run this migration.';
  END IF;
END $$;
