-- ============================================================================
-- Migration 231: Preserve supervisor assignment on auto-release
--
-- Problem
-- -------
-- Migration 229's release RPCs (both single and bulk) cleared `assigned_to`
-- in addition to flipping status back to `pending`. When a supervisor had
-- dashboard-assigned a count to a specific operator, that intent was
-- silently wiped the moment the operator's heartbeat went stale — letting
-- another operator claim the count via Pull Next. Reproduced on prod with
-- CC-20260326-0008 (Angela reassigned to Alessandro → auto-released →
-- someone else pulled it).
--
-- Policy fix
-- ----------
-- Auto-release (scheduler, heartbeat-based, bulk "stuck" cleanup) is now
-- SOFT by default: flip status to `pending`, keep `assigned_to`. Phase 2
-- of the Rust claim query already filters `assigned_to IS NULL`, so no
-- other operator sees the row. Phase 1 of the same query already returns
-- pending rows assigned to the caller, so the original assignee gets it
-- back on their next Pull Next.
--
-- Admin callers that explicitly need to return the row to the general
-- queue pass `p_also_unassign := true`.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Single release — preserve assignment by default
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.release_stuck_cycle_count_assignment(uuid);

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

  IF v_row.assigned_to IS NULL OR v_row.status NOT IN ('in_progress','recount') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Count is not currently assigned / in progress'
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
    -- Soft release: status → pending, keep assigned_to so the
    -- original assignee keeps priority when they come back online.
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
    'also_unassigned', p_also_unassign
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_stuck_cycle_count_assignment(uuid, boolean)
  TO authenticated;

COMMENT ON FUNCTION public.release_stuck_cycle_count_assignment(uuid, boolean) IS
  'Admin release. Default (p_also_unassign=false): flips status to pending but keeps assigned_to so the original assignee retains priority. p_also_unassign=true: clears assigned_to as well (count returns to general pool).';

-- ---------------------------------------------------------------------------
-- 2. Bulk release — same policy
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.release_all_stuck_cycle_count_assignments(int);

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
        AND rcc.status IN ('in_progress','recount')
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
    -- Soft bulk release: keep assigned_to.
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
        AND rcc.status IN ('in_progress','recount')
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
  'Bulk admin release. Default (p_also_unassign=false): soft release keeps assigned_to so originals get their counts back. p_also_unassign=true: clears assignment (general pool).';

-- ---------------------------------------------------------------------------
-- 3. Scheduler-facing release — always soft (preserves assignment)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.release_stale_heartbeat_assignments(int);

CREATE OR REPLACE FUNCTION public.release_stale_heartbeat_assignments(
  p_threshold_minutes int DEFAULT 10
) RETURNS TABLE (out_count_id uuid, out_count_number text, out_previous_owner uuid)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);

  RETURN QUERY
  WITH stuck AS (
    SELECT rcc.id AS id,
           rcc.count_number::text AS cn,
           rcc.assigned_to AS prev_owner,
           COALESCE(rcc.counter_name, rcc.assigned_to::text) AS owner_label
    FROM rr_cyclecount_data rcc
    LEFT JOIN LATERAL (
      SELECT max(last_heartbeat) AS last_hb
      FROM worker_heartbeats
      WHERE user_id = rcc.assigned_to
    ) hb ON true
    WHERE rcc.assigned_to IS NOT NULL
      AND rcc.status IN ('in_progress','recount')
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
        notes = COALESCE(target.notes || E'\n', '') || format(
          '[Auto-released (reserved for %s) at %s — heartbeat stale > %s min]',
          stuck.owner_label,
          to_char(NOW(), 'YYYY-MM-DD HH24:MI'),
          p_threshold_minutes
        )
    FROM stuck
    WHERE target.id = stuck.id
    RETURNING target.id AS uid, target.count_number::text AS ucn, stuck.prev_owner AS upo
  )
  SELECT uid, ucn, upo FROM updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_stale_heartbeat_assignments(int)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.release_stale_heartbeat_assignments(int) IS
  'Scheduler-facing soft release. Flips status to pending but KEEPS assigned_to so the original assignee retains priority when they come back online. Migration 231 fix for supervisor-intent preservation.';

COMMIT;
