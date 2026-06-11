-- ============================================================================
-- Migration 232: Treat pending+assigned rows as zone reservations
--
-- Bug (surfaced 2026-04-24)
-- -------------------------
-- Migration 231 made auto-release keep `assigned_to` when flipping a row
-- back to `pending`. Good for preserving supervisor intent. BUT the zone
-- trigger (`enforce_cycle_count_zone_exclusivity`) only counted
-- `status IN ('in_progress','recount')` as "zone occupied". So a pending
-- row reserved for David looked free to the trigger — James could claim
-- another K1 row 43 minutes later while David was still soft-released.
-- Result: 6 distinct operators had simultaneous K1 reservations/claims.
--
-- Fix
-- ---
-- 1. Trigger now treats `pending + assigned_to IS NOT NULL` as
--    "zone reserved by <user>". Any other user's claim in that zone raises
--    ZONE_LOCKED (same error, different reason).
-- 2. New RPC `escalate_stale_zone_reservations(p_threshold_minutes)` that
--    hard-unassigns reservations older than the threshold (default 60 min
--    since updated_at). Prevents a lost operator from locking a zone
--    indefinitely. Rust scheduler calls it on the 5-minute tick.
-- 3. View `v_cycle_count_active_zones` rewritten to expose both
--    `active_count_count` (in_progress/recount) AND
--    `reserved_count_count` (pending + assigned_to). Dashboards can now
--    show "reserved" vs "actively counting" distinctly.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Trigger — reservations also block zone
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_cycle_count_zone_exclusivity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bypass_guc    text;
  v_enabled       boolean;
  v_policy        text;
  v_pattern       text;
  v_bypass_prio   text[];
  v_bypass_types  text[];
  v_zone          text;
  v_owner         uuid;
  v_owner_name    text;
  v_owner_status  text;
  v_assigned_user uuid;
  v_assigned_name text;
  v_should_check  boolean := false;
BEGIN
  BEGIN
    v_bypass_guc := current_setting('app.cycle_count_zone_lock_bypass', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass_guc := NULL;
  END;
  IF v_bypass_guc IN ('on','true','1','yes') THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('completed','approved','cancelled','variance_review') THEN
    RETURN NEW;
  END IF;

  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_should_check := true;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
      v_should_check := true;
    ELSIF NEW.status IN ('in_progress','recount')
      AND OLD.status IS DISTINCT FROM NEW.status
    THEN
      v_should_check := true;
    END IF;
  END IF;

  IF NOT v_should_check THEN RETURN NEW; END IF;

  SELECT enabled, policy, zone_pattern, bypass_priorities, bypass_count_types
  INTO v_enabled, v_policy, v_pattern, v_bypass_prio, v_bypass_types
  FROM cycle_count_zone_rules
  WHERE organization_id = NEW.organization_id;

  IF NOT FOUND OR v_enabled IS NOT TRUE OR v_policy = 'off' THEN
    RETURN NEW;
  END IF;

  IF v_bypass_prio IS NOT NULL AND NEW.priority::text = ANY(v_bypass_prio) THEN
    RETURN NEW;
  END IF;
  IF v_bypass_types IS NOT NULL AND NEW.count_type = ANY(v_bypass_types) THEN
    RETURN NEW;
  END IF;

  IF v_pattern IS NULL THEN
    IF NEW.location IS NULL OR NEW.location = '' OR NEW.location = '<<empty>>' THEN
      v_zone := NULL;
    ELSE
      v_zone := NULLIF(split_part(NEW.location, '-', 1), '');
    END IF;
  ELSE
    v_zone := public.cycle_count_zone_of(NEW.location, v_pattern);
  END IF;

  IF v_zone IS NULL THEN RETURN NEW; END IF;

  -- (a) Zone-to-user assignment check
  SELECT user_id INTO v_assigned_user
  FROM cycle_count_zone_assignments
  WHERE organization_id = NEW.organization_id AND zone = v_zone;

  IF v_assigned_user IS NOT NULL AND v_assigned_user <> NEW.assigned_to THEN
    SELECT COALESCE(full_name, email, 'another counter')
    INTO v_assigned_name
    FROM user_profiles WHERE id = v_assigned_user;

    RAISE EXCEPTION
      'ZONE_ASSIGNED: Zone "%" is assigned to %. Only that counter may work this zone.',
      v_zone,
      COALESCE(v_assigned_name, 'another counter')
    USING
      ERRCODE = 'P0001',
      HINT    = 'cycle_count_zone_assigned',
      DETAIL  = format('zone=%s;assigned_to=%s', v_zone, v_assigned_user);
  END IF;

  -- (b) Active/reserved check. Zone is busy if ANY other user has a
  -- non-terminal row in the same zone:
  --   * in_progress / recount → actively counting
  --   * pending + assigned_to NOT NULL → reserved for a soft-released
  --     operator; they get priority when they come back online, so no one
  --     else should enter the zone.
  IF v_policy = 'one_counter_per_zone' THEN
    IF v_pattern IS NULL THEN
      SELECT DISTINCT assigned_to, status::text
      INTO v_owner, v_owner_status
      FROM rr_cyclecount_data
      WHERE id != NEW.id
        AND organization_id = NEW.organization_id
        AND zone = v_zone
        AND assigned_to IS NOT NULL
        AND assigned_to <> NEW.assigned_to
        AND status IN ('pending', 'in_progress', 'recount')
      ORDER BY
        -- Prefer reporting an actively-counting user over a reserved one
        -- for clearer error messaging.
        CASE status::text
          WHEN 'in_progress' THEN 1
          WHEN 'recount'     THEN 2
          WHEN 'pending'     THEN 3
        END
      LIMIT 1;
    ELSE
      SELECT DISTINCT assigned_to, status::text
      INTO v_owner, v_owner_status
      FROM rr_cyclecount_data
      WHERE id != NEW.id
        AND organization_id = NEW.organization_id
        AND public.cycle_count_zone_of(location, v_pattern) = v_zone
        AND assigned_to IS NOT NULL
        AND assigned_to <> NEW.assigned_to
        AND status IN ('pending','in_progress','recount')
      ORDER BY
        CASE status::text
          WHEN 'in_progress' THEN 1
          WHEN 'recount'     THEN 2
          WHEN 'pending'     THEN 3
        END
      LIMIT 1;
    END IF;

    IF v_owner IS NOT NULL THEN
      SELECT COALESCE(full_name, email, 'another counter')
      INTO v_owner_name
      FROM user_profiles WHERE id = v_owner;

      IF v_owner_status = 'pending' THEN
        RAISE EXCEPTION
          'ZONE_LOCKED: Zone "%" is reserved for % (pending auto-release). Admin must "+ Unassign" to free the zone.',
          v_zone,
          COALESCE(v_owner_name, 'another counter')
        USING
          ERRCODE = 'P0001',
          HINT    = 'cycle_count_zone_reserved',
          DETAIL  = format('zone=%s;owner=%s;state=reserved', v_zone, v_owner);
      ELSE
        RAISE EXCEPTION
          'ZONE_LOCKED: Zone "%" is currently being counted by %. Only one counter may work a zone at a time.',
          v_zone,
          COALESCE(v_owner_name, 'another counter')
        USING
          ERRCODE = 'P0001',
          HINT    = 'cycle_count_zone_lock',
          DETAIL  = format('zone=%s;owner=%s;state=active', v_zone, v_owner);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_cycle_count_zone_exclusivity() IS
  'Zone mutual exclusion. A zone is busy when ANY other user owns a non-terminal row (in_progress, recount, OR pending-with-assignee reservation). Reservations are rejected with a distinct ZONE_LOCKED variant (state=reserved). Supervisors bypass via app.cycle_count_zone_lock_bypass. Count-type and priority bypass lists still apply (migration 230).';

-- ---------------------------------------------------------------------------
-- 2. Escalation RPC — hard-unassign stale soft-releases after threshold
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.escalate_stale_zone_reservations(
  p_threshold_minutes int DEFAULT 60
) RETURNS TABLE (out_count_id uuid, out_count_number text, out_previous_owner uuid)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);

  RETURN QUERY
  WITH stale AS (
    SELECT rcc.id AS id,
           rcc.count_number::text AS cn,
           rcc.assigned_to AS prev_owner,
           COALESCE(rcc.counter_name, rcc.assigned_to::text) AS owner_label
    FROM rr_cyclecount_data rcc
    WHERE rcc.status = 'pending'
      AND rcc.assigned_to IS NOT NULL
      AND rcc.updated_at < NOW() - make_interval(mins => p_threshold_minutes)
      AND rcc.notes ~ '(Auto-released|Released \(reserved for|Bulk-released \(reserved for)'
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
        notes = COALESCE(target.notes || E'\n', '') || format(
          '[Escalated to hard-unassign at %s — reservation for %s exceeded %s min]',
          to_char(NOW(), 'YYYY-MM-DD HH24:MI'),
          stale.owner_label,
          p_threshold_minutes
        )
    FROM stale
    WHERE target.id = stale.id
    RETURNING target.id AS uid, target.count_number::text AS ucn, stale.prev_owner AS upo
  )
  SELECT uid, ucn, upo FROM escalated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.escalate_stale_zone_reservations(int)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.escalate_stale_zone_reservations(int) IS
  'Scheduler-facing escalation: rows that have been in pending-with-assignee (reservation) state longer than `p_threshold_minutes` get their assigned_to cleared so the zone frees up. Called by the Rust scheduler tick.';

-- ---------------------------------------------------------------------------
-- 3. Rewrite v_cycle_count_active_zones to distinguish active vs reserved
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_cycle_count_active_zones;

CREATE OR REPLACE VIEW v_cycle_count_active_zones
WITH (security_invoker = true)
AS
WITH latest_hb AS (
  SELECT user_id, max(last_heartbeat) AS last_heartbeat
  FROM worker_heartbeats
  GROUP BY user_id
),
zone_rows AS (
  SELECT
    rcc.organization_id,
    rcc.zone,
    rcc.assigned_to AS locked_by,
    up.full_name    AS locked_by_name,
    up.email        AS locked_by_email,
    rcc.id          AS count_id,
    rcc.status::text AS status,
    rcc.assigned_at AS acquired_at,
    latest_hb.last_heartbeat AS owner_last_heartbeat
  FROM rr_cyclecount_data rcc
  LEFT JOIN user_profiles up ON up.id = rcc.assigned_to
  LEFT JOIN latest_hb ON latest_hb.user_id = rcc.assigned_to
  WHERE rcc.assigned_to IS NOT NULL
    AND rcc.status IN ('pending','in_progress','recount')
    AND rcc.zone IS NOT NULL
)
SELECT
  organization_id,
  zone,
  locked_by,
  locked_by_name,
  locked_by_email,
  count(*) AS active_count_count,
  count(*) FILTER (WHERE status IN ('in_progress','recount')) AS actively_counting,
  count(*) FILTER (WHERE status = 'pending') AS reserved_count,
  min(acquired_at) AS acquired_at,
  array_agg(count_id) AS active_count_ids,
  array_agg(count_id) FILTER (WHERE status IN ('in_progress','recount')) AS active_ids,
  array_agg(count_id) FILTER (WHERE status = 'pending') AS reserved_ids,
  max(owner_last_heartbeat) AS owner_last_heartbeat,
  (max(owner_last_heartbeat) IS NOT NULL AND max(owner_last_heartbeat) >= NOW() - INTERVAL '5 minutes') AS owner_online,
  CASE WHEN max(owner_last_heartbeat) IS NULL THEN NULL
       ELSE EXTRACT(EPOCH FROM (NOW() - max(owner_last_heartbeat))) / 60.0
  END AS minutes_since_seen,
  (max(owner_last_heartbeat) IS NULL OR max(owner_last_heartbeat) < NOW() - INTERVAL '10 minutes') AS is_stuck,
  -- A zone-level flag: does this (org, zone) have ANY other active or
  -- reserved holder besides this locked_by row? Useful for rendering.
  bool_or(status = 'pending') AS has_reservation,
  bool_or(status IN ('in_progress','recount')) AS has_active
FROM zone_rows
GROUP BY organization_id, zone, locked_by, locked_by_name, locked_by_email;

COMMENT ON VIEW v_cycle_count_active_zones IS
  'Per (org, zone, user) rollup. active_count_count = total holds; actively_counting = in_progress/recount; reserved_count = pending+assigned (soft-released reservations). owner_online reflects last heartbeat.';

GRANT SELECT ON v_cycle_count_active_zones TO authenticated;

COMMIT;
