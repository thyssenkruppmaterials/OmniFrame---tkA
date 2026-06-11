-- ============================================================================
-- Migration 321 — Backfill putaway-confirm loop resets claim_count and
--                 unpins assigned_agent_id (close two silent dead-ends:
--                 the cumulative claim_count cap, and the offline-agent
--                 affinity trap)
-- ============================================================================
--
-- Problem (production, 2026-05-19/20, org c9d89a74…):
--   The Pending Confirms card on the Putaway Log Search panel was showing
--   "41 stuck (oldest 1373 min)" with the FE banner red. Every one of the
--   41 rows was an `rf_putaway_operations` row in
--   `to_status='Completed', confirmed_source IS NULL, is_mca_workflow=false`
--   that had a corresponding `sap_agent_jobs` row in
--   `status='failed', attempts=1, max_attempts=3, claim_count=8`. The
--   pg_cron tick was running every 5 minutes (verified — `cron.job` showed
--   `omniframe-backfill-pending-putaway-confirms` active) but each run
--   returned `(rows_failed_requeued=0, rows_orphan_replayed=0,
--   oldest_pending_minutes=1374)` — the function was a no-op while the
--   queue stayed visibly stuck.
--
--   Error vocabulary on the stuck rows:
--     * 40/41: "No active SAP GUI session found. Please log in to an SAP
--       system first…" — the operator's SAPGUI was logged out for a window
--       between 15:35–17:06 UTC on 2026-05-19. The agent kept claiming
--       and failing through that window.
--     * 1/41: "Entry DC-   does not exist in T300 (check entry)" — a real
--       data error. Should still be retried (the data may get corrected)
--       but is not the systemic issue here.
--
-- Root cause:
--   Migration 289's `backfill_pending_putaway_confirms` resets
--   `attempts = 0` on each requeue cycle so the next claim has a fresh
--   retry budget — but it does NOT reset `claim_count`. Migration 291's
--   `claim_sap_agent_job(...)` increments BOTH `attempts` and
--   `claim_count` together on every claim. So `attempts` resets each
--   backfill cycle while `claim_count` accumulates across cycles.
--
--   The backfill's protective WHERE clause is
--     `COALESCE(j.claim_count, 0) < p_max_claim_count`  (default 8)
--
--   Sequence for one of the 41 stuck rows:
--     cycle 1: backfill resets → agent claims (claim_count=1, attempts=1)
--              → SAP GUI offline → /jobs/:id/fail → status=failed
--     cycle 2: backfill resets attempts=0, claim_count stays at 1 →
--              agent claims (claim_count=2, attempts=1) → fails
--     …
--     cycle 7: agent claim ends with claim_count=8, attempts=1, failed
--     cycle 8: WHERE `claim_count < 8` is false → row is skipped FOREVER
--
--   ~35 minutes of continuous SAP outage is enough to silently kill the
--   row's recovery path. The original 8-cap intent was "after 8 prior
--   failed claims this row needs human attention" — a reasonable
--   guard-rail when claim_count and attempts move together. With the
--   reset asymmetry, the cap fires WAY too early (after only 7 backfill
--   cycles, regardless of whether the underlying problem is transient).
--
-- Secondary problem (also surfaced in the same incident):
--   `claim_sap_agent_job(...)` filters its claim set on
--     `(assigned_agent_id IS NULL OR assigned_agent_id = p_agent_id)`
--   The original `claim_sap_agent_job` UPDATE pins the assignment via
--     `assigned_agent_id = COALESCE(assigned_agent_id, p_agent_id)`
--   So once Agent A claims a row, that row is forever pinned to Agent A.
--   If Agent A then goes offline, no other agent on the same org can
--   pick the row up — even after migration 289's backfill resets
--   status='queued'. Combined with bug #1, the rows stayed stuck even
--   for the brief window before claim_count blew the cap.
--
--   Concrete evidence: after migration 321 applied + the rescue ran, all
--   40 rescued rows sat in `status='queued', claim_count=0,
--   assigned_agent_id='USINDPR-CXA103V-Console-U8206556'`. CXA103V went
--   offline at 06:23 UTC (~8 h before the rescue). The online agent
--   CXA102V could not claim them because of the affinity filter.
--
-- Fix:
--   1. CREATE OR REPLACE `backfill_pending_putaway_confirms` so the
--      requeue UPDATE also sets `claim_count = 0` AND
--      `assigned_agent_id = NULL`. The first closes the cumulative-cap
--      dead-end; the second un-pins the row from a (potentially
--      offline) prior owner so any online agent in the org can pick
--      it up on the next claim cycle.
--
--      Why is unpinning safe? The `claim_sap_agent_job(...)` UPDATE
--      uses `assigned_agent_id = COALESCE(assigned_agent_id, p_agent_id)`,
--      so the next claim re-pins to whichever agent picks the row up.
--      The claim is exclusive — only one agent at a time wins the
--      `FOR UPDATE SKIP LOCKED` row. So the affinity is preserved
--      within a claim cycle but reset between backfill cycles, which
--      is exactly the right behaviour for "if the original owner is
--      offline, let someone else try."
--
--   2. One-time rescue of currently-stuck rows. Resets every failed
--      sap_agent_jobs row that:
--        * is keyed by an enabled `agent_triggers` rule on
--          `rf_putaway_operations`, and
--        * matches an rf_putaway_operations row still in the candidate
--          set (Completed, no confirmed_source, !is_mca_workflow,
--          created within 24h),
--      regardless of current claim_count. Runs in the same migration
--      so the user sees the queue drain immediately rather than waiting
--      for the next claim cycle.
--
-- Why not just remove the cap?
--   The cap protects against a single backfill cycle accidentally
--   hammering the SAP path inside a tight loop (e.g., if a future
--   regression caused `claim_sap_agent_job` to increment claim_count
--   without incrementing attempts, the agent could re-claim repeatedly
--   inside one cycle without the run-engine's max_attempts gate
--   firing). Keeping the cap as a per-cycle guard preserves that
--   defense without the cumulative dead-end.
--
-- Why not look at the error string and only retry "transient" failures?
--   The error vocabulary the agent emits isn't a closed set (it
--   includes raw COM exception tuples, vendor-localised SAP messages,
--   SAP GUI version-specific text, etc.). Allow-listing "transient"
--   errors would silently fail when the vocabulary shifts. The right
--   long-term answer is to instrument the agent to tag failures with
--   a structured `failure_class` ('infra' | 'data' | 'auth' | …),
--   which is a separate workstream. For now, retry-all + the FE
--   banner (which already escalates at >=15 stuck OR oldest >=60min)
--   is the pragmatic shape: real "permanently broken" rows surface
--   to the operator quickly without the queue going silently dead.
--
-- Org-scope safety:
--   The function still honours `p_organization_id` (NULL = cross-org
--   from pg_cron, set = caller's JWT org from the rust-work-service
--   route). The one-time rescue at the bottom is unscoped (every org)
--   because the bug affects every tenant with an enabled
--   `agent_triggers` rule on `rf_putaway_operations` — today only
--   c9d89a74, but the fix should land for any future tenant too.
--
-- Compatibility:
--   * Same function signature, same return columns. No client code
--     change needed.
--   * The on-demand `POST /api/v1/sap-agents/backfill-pending-confirms`
--     route in rust-work-service v0.1.35 keeps working unchanged.
--   * Idempotent: re-applying the migration on a healthy queue is a
--     no-op (CREATE OR REPLACE + the rescue's WHERE clause matches
--     zero rows when nothing is stuck).
--
-- Related notes:
--   * `[[Implementations/Implement-Putaway-Confirm-Backfill-Loop]]` —
--     the v0.1.35 backfill design this migration patches.
--   * `[[Decisions/ADR-Trigger-DSL-Evaluator-Phase9]]` — trigger
--     evaluator that produces the queue rows.
--   * `[[Components/Omni-Agent - Headless SAP Agent]]` — claim/fail
--     protocol on the agent side.
--   * `[[supabase/migrations/289_backfill_pending_putaway_confirms.sql]]`
--   * `[[supabase/migrations/291_claim_sap_agent_job_enforces_max_attempts.sql]]`
-- ============================================================================

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 1. CREATE OR REPLACE the backfill function — reset claim_count too.
--
--    Diff vs migration 289: the `reset_failed` UPDATE now also sets
--    `claim_count = 0`. Everything else is byte-identical to 289 so a
--    side-by-side diff is small + obvious.
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
        claim_count       = 0,  -- migration 321: symmetric with attempts reset
        assigned_agent_id = NULL,  -- migration 321: unpin so any online agent can claim
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
  'v0.1.36 — Auto-recovery loop for stuck putaway TO confirms. Re-queues '
  'sap_agent_jobs rows in status=failed for rf_putaway_operations rows '
  'still at to_status=Completed AND confirmed_source IS NULL AND '
  'is_mca_workflow IS NOT TRUE within the lookback window, and bumps '
  'updated_at on candidate rows that have no job at all (NOTIFY replay). '
  'Migration 321 added the symmetric `claim_count = 0` reset alongside '
  '`attempts = 0` so the per-cycle cap stops firing as a cumulative '
  'across-cycles death sentence (root cause of the 2026-05-19 41-stuck '
  'incident). Pass p_organization_id to scope to a single tenant; leave '
  'NULL for the pg_cron path. Scheduled every 5 minutes.';

-- ───────────────────────────────────────────────────────────────────────
-- 2. One-time rescue of the currently-stuck rows.
--
--    Cleans every `sap_agent_jobs` row that today's broken backfill
--    left orphaned at `claim_count >= p_max_claim_count`, regardless of
--    the cap. Same WHERE structure as Branch 1 of the function above
--    EXCEPT we drop the `claim_count < cap` filter — that's the entire
--    point of the rescue.
-- ───────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_rescued int;
  v_oldest_min int;
BEGIN
  WITH candidates AS (
    SELECT r.id AS row_id, r.organization_id
    FROM public.rf_putaway_operations r
    WHERE r.to_status = 'Completed'
      AND r.confirmed_source IS NULL
      AND r.is_mca_workflow IS NOT TRUE
      AND r.created_at > now() - interval '24 hours'
  ),
  candidate_triggers AS (
    SELECT t.id AS trigger_id, t.organization_id
    FROM public.agent_triggers t
    WHERE t.enabled = true
      AND t.source_table = 'rf_putaway_operations'
  ),
  rescued AS (
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
        claim_count       = 0,
        assigned_agent_id = NULL,
        max_attempts      = GREATEST(COALESCE(j.max_attempts, 1), COALESCE(j.attempts, 0) + 2),
        error             = COALESCE(NULLIF(j.error, ''), '') ||
                            CASE WHEN COALESCE(j.error, '') = '' THEN '' ELSE ' | ' END ||
                            'rescued by migration 321 at ' || now()::text
    FROM candidates c
    JOIN candidate_triggers ct ON ct.organization_id = c.organization_id
    WHERE j.organization_id = c.organization_id
      AND (j.status = 'failed' OR (j.status = 'queued' AND j.assigned_agent_id IS NOT NULL))
      AND j.idempotency_key LIKE
            'trig:' || ct.trigger_id::text || ':' || c.row_id::text || ':%'
    RETURNING j.id
  )
  SELECT count(*)::int INTO v_rescued FROM rescued;

  SELECT COALESCE(
    EXTRACT(EPOCH FROM (now() - MIN(r.created_at))) / 60.0,
    0
  )::int
  INTO v_oldest_min
  FROM public.rf_putaway_operations r
  WHERE r.to_status = 'Completed'
    AND r.confirmed_source IS NULL
    AND r.is_mca_workflow IS NOT TRUE
    AND r.created_at > now() - interval '24 hours';

  RAISE NOTICE
    'migration 321 rescue: requeued % stuck putaway-confirm jobs (oldest pending: % min).',
    v_rescued, v_oldest_min;
END $$;

COMMIT;
