-- ============================================================================
-- 311 — Cycle-count reapers: per-org filter + idle-status-aware heartbeat guard
-- ============================================================================
-- See:
--   - memorybank/OmniFrame/Debug/Fix-RF-Cycle-Count-Zone-Soft-Reservation-Cascade-2026-05-18.md
--   - memorybank/OmniFrame/Decisions/ADR-Cycle-Count-Soft-Reservation-Cascade-Mitigation.md (Option B2)
--   - memorybank/OmniFrame/Decisions/ADR-Work-Distribution-Pipeline-Architecture-Review-2026-05-18.md (F18 / T-1 / T-2 / T-5)
--
-- Two changes, both backward-compatible (new args default to NULL/legacy):
--
-- (A) escalate_stale_zone_reservations(int, uuid DEFAULT NULL) — B2:
--     The 2026-05-18 cascade fired because James Dearman was still heart-
--     beating with `status='idle'` while his `pending+assigned` row sat
--     occupying zone RP. The pre-311 heartbeat guard only checked
--     `hb.last_hb` freshness, so a still-online-but-idle operator blocked
--     escalation indefinitely.  311 widens the guard: any status NOT in
--     ('online','busy') — i.e. idle / break / offline / NULL — counts as
--     inactive even when the heartbeat is fresh.  Also adds an optional
--     p_organization_id filter so the scheduler can pass per-org thresholds
--     via a per-org loop (closes F18).
--
-- (B) release_stale_heartbeat_assignments(int, uuid DEFAULT NULL):
--     Same per-org filter, semantics otherwise unchanged (this is the
--     second-line reaper that fires on stale heartbeat alone; idle-status
--     is irrelevant because by construction the operator hasn't pinged).
--
-- The functions retain their legacy single-arg shape via DEFAULT NULL so
-- the rust-work-service binary can be deployed before / after this migration
-- without breakage (NULL p_organization_id ⇒ legacy whole-org behaviour).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- (A) escalate_stale_zone_reservations — idle-aware heartbeat guard + org filter
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.escalate_stale_zone_reservations(int);
DROP FUNCTION IF EXISTS public.escalate_stale_zone_reservations(int, uuid);

CREATE OR REPLACE FUNCTION public.escalate_stale_zone_reservations(
  p_threshold_minutes int  DEFAULT 60,
  p_organization_id   uuid DEFAULT NULL
)
RETURNS TABLE (
  out_count_id        uuid,
  out_count_number    text,
  out_previous_owner  uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);

  RETURN QUERY
  WITH stale AS (
    SELECT rcc.id           AS id,
           rcc.count_number::text AS cn,
           rcc.assigned_to  AS prev_owner,
           COALESCE(rcc.counter_name, rcc.assigned_to::text) AS owner_label
    FROM rr_cyclecount_data rcc
    LEFT JOIN cycle_count_zone_rules zr
      ON zr.organization_id = rcc.organization_id
    -- LATERAL: pick the freshest heartbeat row AND its status. Pre-311
    -- this read only `max(last_heartbeat)`; 311 also reads status so the
    -- guard can treat idle / break / offline as inactive.
    LEFT JOIN LATERAL (
      SELECT last_heartbeat AS last_hb, status AS hb_status
      FROM worker_heartbeats
      WHERE user_id = rcc.assigned_to
      ORDER BY last_heartbeat DESC
      LIMIT 1
    ) hb ON true
    WHERE rcc.status = 'pending'
      AND rcc.assigned_to IS NOT NULL
      AND (p_organization_id IS NULL OR rcc.organization_id = p_organization_id)
      AND COALESCE(rcc.reservation_started_at, rcc.updated_at)
            < NOW() - make_interval(mins => p_threshold_minutes)
      AND (
        hb.last_hb IS NULL
        OR hb.last_hb < NOW() - make_interval(mins => p_threshold_minutes)
        OR hb.hb_status IS NULL
        OR hb.hb_status NOT IN ('online','busy')
      )
      AND (
        rcc.supervisor_assigned_at IS NULL
        OR rcc.supervisor_assigned_at <
           NOW() - make_interval(
             hours => COALESCE(zr.supervisor_assignment_protection_hours, 24)
           )
      )
  ), escalated AS (
    UPDATE rr_cyclecount_data target
    SET assigned_to = NULL,
        assigned_at = NULL,
        counter_name = NULL,
        push_mode = 'pull',
        pushed_by = NULL,
        pushed_at = NULL,
        push_acknowledged = false,
        updated_at = NOW(),
        notes = COALESCE(target.notes || E'\n', '') ||
                format(
                  '[Escalated to hard-unassign at %s — reservation for %s exceeded %s min, owner idle/offline, no supervisor protection]',
                  to_char(NOW(), 'YYYY-MM-DD HH24:MI'),
                  stale.owner_label,
                  p_threshold_minutes
                )
    FROM stale WHERE target.id = stale.id
    RETURNING target.id                AS uid,
              target.count_number::text AS ucn,
              stale.prev_owner         AS upo
  )
  SELECT uid, ucn, upo FROM escalated;
END;
$$;

REVOKE ALL ON FUNCTION public.escalate_stale_zone_reservations(int, uuid)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.escalate_stale_zone_reservations(int, uuid)
  TO service_role;

COMMENT ON FUNCTION public.escalate_stale_zone_reservations(int, uuid) IS
  'Scheduler-only hard-unassign of stale reservations. Idle-aware heartbeat guard: any worker_heartbeats.status outside (online,busy) counts as inactive even when heartbeat is fresh. Optional p_organization_id filter (NULL = all orgs). SECURITY DEFINER, service_role only. Migration 311.';

-- ---------------------------------------------------------------------------
-- (B) release_stale_heartbeat_assignments — add org filter
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.release_stale_heartbeat_assignments(int);
DROP FUNCTION IF EXISTS public.release_stale_heartbeat_assignments(int, uuid);

CREATE OR REPLACE FUNCTION public.release_stale_heartbeat_assignments(
  p_threshold_minutes int  DEFAULT 10,
  p_organization_id   uuid DEFAULT NULL
)
RETURNS TABLE (
  out_count_id        uuid,
  out_count_number    text,
  out_previous_owner  uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);

  RETURN QUERY
  WITH stuck AS (
    SELECT rcc.id           AS id,
           rcc.count_number::text AS cn,
           rcc.assigned_to  AS prev_owner,
           COALESCE(rcc.counter_name, rcc.assigned_to::text) AS owner_label
    FROM rr_cyclecount_data rcc
    LEFT JOIN LATERAL (
      SELECT max(last_heartbeat) AS last_hb
      FROM worker_heartbeats WHERE user_id = rcc.assigned_to
    ) hb ON true
    WHERE rcc.assigned_to IS NOT NULL
      AND rcc.status IN ('in_progress','recount')
      AND (p_organization_id IS NULL OR rcc.organization_id = p_organization_id)
      AND (
        hb.last_hb IS NULL
        OR hb.last_hb < NOW() - make_interval(mins => p_threshold_minutes)
      )
  ), updated AS (
    UPDATE rr_cyclecount_data target
    SET status = 'pending',
        push_mode = 'pull',
        pushed_by = NULL,
        pushed_at = NULL,
        push_acknowledged = false,
        updated_at = NOW(),
        notes = COALESCE(target.notes || E'\n', '') ||
                format('[Auto-released (reserved for %s) at %s — heartbeat stale > %s min]',
                       stuck.owner_label,
                       to_char(NOW(), 'YYYY-MM-DD HH24:MI'),
                       p_threshold_minutes)
    FROM stuck WHERE target.id = stuck.id
    RETURNING target.id                AS uid,
              target.count_number::text AS ucn,
              stuck.prev_owner         AS upo
  )
  SELECT uid, ucn, upo FROM updated;
END;
$$;

REVOKE ALL ON FUNCTION public.release_stale_heartbeat_assignments(int, uuid)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.release_stale_heartbeat_assignments(int, uuid)
  TO service_role;

COMMENT ON FUNCTION public.release_stale_heartbeat_assignments(int, uuid) IS
  'Scheduler-only soft release of in_progress/recount rows with stale heartbeat. Optional p_organization_id filter (NULL = all orgs). SECURITY DEFINER, service_role only. Migration 311.';

COMMIT;
