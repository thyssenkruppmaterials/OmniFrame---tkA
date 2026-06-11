-- ============================================================================
-- Migration 229: Honest "active zones" + stuck-assignment release
--
-- Problem
-- -------
-- `v_cycle_count_active_zones` blindly counted every (assigned_to,
-- in_progress) row as "active", even when the operator wasn't online.
-- This lets a supervisor dashboard-reassign a row to a user who hasn't
-- signed in, producing fake "active zone" chips (K3, SE, SF, SO, …).
--
-- Fix
-- ---
-- 1. Re-create the view joining `worker_heartbeats` so the UI knows
--    whether the lock owner is actually online.
--    - `owner_online`         → live in the last 5 minutes
--    - `minutes_since_seen`   → gauge how stale the lock is
-- 2. Expose a second column `is_stuck` for quick filtering in the UI.
-- 3. New SQL RPC `release_stuck_cycle_count_assignment(count_id)` so
--    admins can release individual stuck rows from the dashboard.
-- 4. New SQL RPC `release_all_stuck_cycle_count_assignments(threshold_mins)`
--    for bulk cleanup.
-- 5. Keep the zone-exclusivity trigger untouched; releases go through
--    a supervisor path that sets `app.cycle_count_zone_lock_bypass = on`
--    so we don't fight our own trigger when writing the release.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Rewritten view
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_cycle_count_active_zones;

CREATE OR REPLACE VIEW v_cycle_count_active_zones
WITH (security_invoker = true)
AS
WITH latest_hb AS (
  SELECT
    user_id,
    max(last_heartbeat) AS last_heartbeat
  FROM worker_heartbeats
  GROUP BY user_id
),
zone_rows AS (
  SELECT
    rcc.organization_id,
    rcc.zone,
    rcc.assigned_to                 AS locked_by,
    up.full_name                    AS locked_by_name,
    up.email                        AS locked_by_email,
    rcc.id                          AS count_id,
    rcc.assigned_at                 AS acquired_at,
    latest_hb.last_heartbeat        AS owner_last_heartbeat
  FROM rr_cyclecount_data rcc
  LEFT JOIN user_profiles   up        ON up.id       = rcc.assigned_to
  LEFT JOIN latest_hb                 ON latest_hb.user_id = rcc.assigned_to
  WHERE rcc.assigned_to IS NOT NULL
    AND rcc.status IN ('in_progress', 'recount')
    AND rcc.zone IS NOT NULL
)
SELECT
  organization_id,
  zone,
  locked_by,
  locked_by_name,
  locked_by_email,
  count(*)                       AS active_count_count,
  min(acquired_at)               AS acquired_at,
  array_agg(count_id)            AS active_count_ids,
  max(owner_last_heartbeat)      AS owner_last_heartbeat,
  (
    max(owner_last_heartbeat) IS NOT NULL
    AND max(owner_last_heartbeat) >= NOW() - INTERVAL '5 minutes'
  )                              AS owner_online,
  CASE
    WHEN max(owner_last_heartbeat) IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (NOW() - max(owner_last_heartbeat))) / 60.0
  END                            AS minutes_since_seen,
  (
    max(owner_last_heartbeat) IS NULL
    OR max(owner_last_heartbeat) < NOW() - INTERVAL '10 minutes'
  )                              AS is_stuck
FROM zone_rows
GROUP BY
  organization_id,
  zone,
  locked_by,
  locked_by_name,
  locked_by_email;

COMMENT ON VIEW v_cycle_count_active_zones IS
  'Live rollup of zones currently being counted. owner_online reflects whether the lock holder has pinged worker_heartbeats in the last 5 minutes. is_stuck = operator hasn''t pinged for > 10 minutes (admin should release). Callers: dashboard strip, Zone Rules panel.';

GRANT SELECT ON v_cycle_count_active_zones TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Release a single stuck cycle count (supervisor / admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_stuck_cycle_count_assignment(
  p_count_id uuid
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
     OR v_caller_role NOT IN ('superadmin', 'admin', 'manager', 'logistics_coordinator')
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only supervisors and admins can release stuck assignments.'
    );
  END IF;

  -- Caller's org (scoping).
  SELECT organization_id INTO v_org_id FROM user_profiles WHERE id = auth.uid();

  -- Lock + fetch the row.
  SELECT * INTO v_row FROM rr_cyclecount_data
  WHERE id = p_count_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Count not found');
  END IF;

  IF v_row.assigned_to IS NULL OR v_row.status NOT IN ('in_progress', 'recount') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Count is not currently assigned / in progress'
    );
  END IF;

  -- Bypass zone trigger for the release.
  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);

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
        '[Released stuck assignment at %s by admin override]',
        to_char(NOW(), 'YYYY-MM-DD HH24:MI')
      )
  WHERE id = p_count_id;

  RETURN jsonb_build_object(
    'success', true,
    'released_count_id', p_count_id,
    'previous_owner', v_row.assigned_to
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_stuck_cycle_count_assignment(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.release_stuck_cycle_count_assignment(uuid) IS
  'Admin release of a stuck cycle-count assignment. Clears assigned_to / assigned_at / counter_name, sets status back to pending, appends an audit note. Bypasses zone-exclusivity trigger for the release itself.';

-- ---------------------------------------------------------------------------
-- 3. Bulk release of all stuck assignments in the caller's org
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_all_stuck_cycle_count_assignments(
  p_threshold_minutes int DEFAULT 10
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
     OR v_caller_role NOT IN ('superadmin', 'admin', 'manager', 'logistics_coordinator')
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
      AND rcc.status IN ('in_progress', 'recount')
      AND (
        hb.last_hb IS NULL
        OR hb.last_hb < NOW() - make_interval(mins => p_threshold_minutes)
      )
  ),
  updated AS (
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
          '[Bulk-released stuck assignment at %s (threshold=%s min)]',
          to_char(NOW(), 'YYYY-MM-DD HH24:MI'),
          p_threshold_minutes
        )
    FROM stuck
    WHERE rr_cyclecount_data.id = stuck.id
    RETURNING rr_cyclecount_data.id
  )
  SELECT count(*) INTO v_released FROM updated;

  RETURN jsonb_build_object(
    'success', true,
    'released', v_released,
    'threshold_minutes', p_threshold_minutes
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_all_stuck_cycle_count_assignments(int)
  TO authenticated;

COMMENT ON FUNCTION public.release_all_stuck_cycle_count_assignments(int) IS
  'Bulk release cycle-count rows held by operators whose heartbeat is older than the threshold (default 10 min). Admin/manager only.';

COMMIT;
