-- ============================================================================
-- Migration 290: Allow stuck-release RPCs to operate on reserved rows
--
-- Problem
-- -------
-- Migration 231 made auto-release SOFT (status flips to `pending`, `assigned_to`
-- preserved) so the supervisor's intent isn't wiped when an operator's
-- heartbeat goes stale. Migration 233 then surfaced both `actively_counting`
-- (in_progress/recount) AND `reserved_count` (pending+assigned) rows in
-- v_cycle_count_active_zones, so admins see soft-released rows in the
-- "Stuck Assignments" card under Count Settings → Zone Rules.
--
-- However the release RPCs themselves were never updated. They still gate on
-- `status IN ('in_progress','recount')`, so the moment a row has been
-- soft-released by the scheduler it can no longer be cleared via the UI:
--
--   * Per-row "Release" → returns "Count is not currently assigned / in progress"
--   * Per-row "+ Unassign" → same error
--   * Header "Release All" → bulk RPC's WHERE filters out reserved rows, so
--     admin sees "No stuck assignments to release." even though the card lists them.
--
-- Reproduced on prod with K3 / Jai Singh (CC-20260424-0611): row was in
-- `pending` + `assigned_to` for ~50 min and any release attempt produced the
-- error toast shown in the screenshot.
--
-- Fix
-- ---
-- Both the single RPC and the bulk RPC now accept reserved rows
-- (`assigned_to IS NOT NULL AND status IN ('pending','in_progress','recount')`).
-- The soft branch is idempotent on already-pending rows — it just bumps
-- `updated_at` and appends an audit note. The hard branch (`+ Unassign`) does
-- the actual cleanup that admins want when they click that button against a
-- stale reservation.
--
-- The scheduler-facing `release_stale_heartbeat_assignments` already operates
-- on reserved rows correctly (migration 231) so it's untouched.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Single release — accept reserved (pending+assigned) rows
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.release_stuck_cycle_count_assignment(uuid, boolean);

CREATE OR REPLACE FUNCTION public.release_stuck_cycle_count_assignment(
  p_count_id        uuid,
  p_also_unassign   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_org_id      uuid;
  v_row         rr_cyclecount_data%ROWTYPE;
BEGIN
  SELECT role::text INTO v_caller_role
  FROM user_profiles WHERE id = auth.uid();

  IF v_caller_role IS NULL
     OR v_caller_role NOT IN ('superadmin','admin','manager','logistics_coordinator')
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only supervisors and admins can release stuck assignments.'
    );
  END IF;

  SELECT organization_id INTO v_org_id FROM user_profiles WHERE id = auth.uid();

  SELECT * INTO v_row FROM rr_cyclecount_data
  WHERE id = p_count_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Count not found');
  END IF;

  -- Migration 290: accept reserved (pending+assigned) rows in addition to
  -- actively-counting ones. Without this, soft-released rows can never be
  -- cleared from the Stuck Assignments card.
  IF v_row.assigned_to IS NULL
     OR v_row.status NOT IN ('pending','in_progress','recount')
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Count has no live assignment to release'
    );
  END IF;

  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);

  IF p_also_unassign THEN
    UPDATE rr_cyclecount_data
    SET assigned_to = NULL,
        assigned_at = NULL,
        counter_name = NULL,
        status = 'pending',
        push_mode = 'pull',
        pushed_by = NULL,
        pushed_at = NULL,
        push_acknowledged = false,
        updated_at = NOW(),
        notes = COALESCE(notes || E'\n', '') || format(
          '[Released + unassigned at %s by admin override]',
          to_char(NOW(), 'YYYY-MM-DD HH24:MI')
        )
    WHERE id = p_count_id;
  ELSE
    -- Soft release: status → pending, keep assigned_to so the original
    -- assignee retains priority on next Pull Next. Idempotent for rows
    -- already in pending+assigned state — just bumps the timestamp + note.
    UPDATE rr_cyclecount_data
    SET status = 'pending',
        push_mode = 'pull',
        pushed_by = NULL,
        pushed_at = NULL,
        push_acknowledged = false,
        updated_at = NOW(),
        notes = COALESCE(notes || E'\n', '') || format(
          '[Released (reserved for %s) at %s — will route to them on next Pull Next]',
          COALESCE(v_row.counter_name, v_row.assigned_to::text),
          to_char(NOW(), 'YYYY-MM-DD HH24:MI')
        )
    WHERE id = p_count_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'released_count_id', p_count_id,
    'previous_owner', v_row.assigned_to,
    'previous_status', v_row.status,
    'also_unassigned', p_also_unassign
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_stuck_cycle_count_assignment(uuid, boolean)
  TO authenticated;

COMMENT ON FUNCTION public.release_stuck_cycle_count_assignment(uuid, boolean) IS
  'Admin release. Operates on rows with assigned_to set and status in (pending, in_progress, recount) — i.e. both actively-counted and soft-released/reserved rows surfaced by v_cycle_count_active_zones. Default (p_also_unassign=false) is a soft release that keeps assigned_to. p_also_unassign=true clears assigned_to (returns the row to the general pool). Migration 290 widened the precondition so reserved rows can be cleared from Count Settings.';

-- ---------------------------------------------------------------------------
-- 2. Bulk release — accept reserved rows too
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.release_all_stuck_cycle_count_assignments(int, boolean);

CREATE OR REPLACE FUNCTION public.release_all_stuck_cycle_count_assignments(
  p_threshold_minutes int DEFAULT 10,
  p_also_unassign     boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_org_id      uuid;
  v_released    int;
BEGIN
  SELECT role::text, organization_id
    INTO v_caller_role, v_org_id
  FROM user_profiles WHERE id = auth.uid();

  IF v_caller_role IS NULL
     OR v_caller_role NOT IN ('superadmin','admin','manager','logistics_coordinator')
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only supervisors and admins may bulk-release stuck assignments.'
    );
  END IF;

  IF p_threshold_minutes < 2 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'threshold_minutes must be >= 2 (safety floor)'
    );
  END IF;

  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);

  IF p_also_unassign THEN
    WITH stuck AS (
      SELECT rcc.id
      FROM rr_cyclecount_data rcc
      LEFT JOIN LATERAL (
        SELECT max(last_heartbeat) AS last_hb
        FROM worker_heartbeats
        WHERE user_id = rcc.assigned_to
      ) hb ON true
      WHERE rcc.organization_id = v_org_id
        AND rcc.assigned_to IS NOT NULL
        -- Migration 290: include reserved rows.
        AND rcc.status IN ('pending','in_progress','recount')
        AND (
          hb.last_hb IS NULL
          OR hb.last_hb < NOW() - make_interval(mins => p_threshold_minutes)
        )
    ),
    updated AS (
      UPDATE rr_cyclecount_data target
      SET assigned_to = NULL,
          assigned_at = NULL,
          counter_name = NULL,
          status = 'pending',
          push_mode = 'pull',
          pushed_by = NULL,
          pushed_at = NULL,
          push_acknowledged = false,
          updated_at = NOW(),
          notes = COALESCE(target.notes || E'\n', '') || format(
            '[Bulk-released + unassigned at %s (threshold=%s min)]',
            to_char(NOW(), 'YYYY-MM-DD HH24:MI'),
            p_threshold_minutes
          )
      FROM stuck
      WHERE target.id = stuck.id
      RETURNING target.id
    )
    SELECT count(*) INTO v_released FROM updated;
  ELSE
    -- Soft bulk release: keep assigned_to. Idempotent on already-pending rows.
    WITH stuck AS (
      SELECT rcc.id,
             COALESCE(rcc.counter_name, rcc.assigned_to::text) AS owner_label
      FROM rr_cyclecount_data rcc
      LEFT JOIN LATERAL (
        SELECT max(last_heartbeat) AS last_hb
        FROM worker_heartbeats
        WHERE user_id = rcc.assigned_to
      ) hb ON true
      WHERE rcc.organization_id = v_org_id
        AND rcc.assigned_to IS NOT NULL
        -- Migration 290: include reserved rows.
        AND rcc.status IN ('pending','in_progress','recount')
        AND (
          hb.last_hb IS NULL
          OR hb.last_hb < NOW() - make_interval(mins => p_threshold_minutes)
        )
    ),
    updated AS (
      UPDATE rr_cyclecount_data target
      SET status = 'pending',
          push_mode = 'pull',
          pushed_by = NULL,
          pushed_at = NULL,
          push_acknowledged = false,
          updated_at = NOW(),
          notes = COALESCE(target.notes || E'\n', '') || format(
            '[Bulk-released (reserved for %s) at %s — will route back on their next Pull Next]',
            stuck.owner_label,
            to_char(NOW(), 'YYYY-MM-DD HH24:MI')
          )
      FROM stuck
      WHERE target.id = stuck.id
      RETURNING target.id
    )
    SELECT count(*) INTO v_released FROM updated;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'released', v_released,
    'threshold_minutes', p_threshold_minutes,
    'also_unassigned', p_also_unassign
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_all_stuck_cycle_count_assignments(int, boolean)
  TO authenticated;

COMMENT ON FUNCTION public.release_all_stuck_cycle_count_assignments(int, boolean) IS
  'Bulk admin release. Includes both actively-counted and reserved (pending+assigned) rows whose owner heartbeat is older than p_threshold_minutes. Default (p_also_unassign=false): soft release keeps assigned_to. p_also_unassign=true: clears assignment (general pool). Migration 290 widened the predicate so soft-released rows can be cleaned up.';

COMMIT;
