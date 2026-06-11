-- ============================================================================
-- Migration 226: Expand zone-exclusivity enforcement
--
-- Migration 225 only fired when status transitioned to in_progress/recount.
-- That misses two important paths:
--   1. Admin uses "Assign to …" in the dashboard — the existing RPC
--      (assign_cycle_count_to_user) updates `assigned_to` but leaves
--      `status = 'pending'`, so the trigger never fired. The admin could
--      silently put a second counter into a zone that's already busy.
--   2. Rust supervisor push — sets `assigned_to` + `push_mode = 'push'`
--      while keeping `status = 'pending'`.
--
-- This migration:
--   - Broadens the trigger to fire whenever `assigned_to` changes to a
--     new (non-null) value OR when status transitions into
--     in_progress/recount, and the row is not in a terminal status.
--   - Adds `assign_cycle_count_to_user_force(count_id, user_id)` — a
--     supervisor-only RPC that sets `app.cycle_count_zone_lock_bypass`
--     inside the transaction so the underlying RPC succeeds regardless
--     of the zone policy. Dashboards use this for explicit override.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_cycle_count_zone_exclusivity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bypass     text;
  v_enabled    boolean;
  v_policy     text;
  v_pattern    text;
  v_zone       text;
  v_owner      uuid;
  v_owner_name text;
  v_should_check boolean := false;
BEGIN
  -- Session bypass for supervisor / admin overrides.
  BEGIN
    v_bypass := current_setting('app.cycle_count_zone_lock_bypass', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass := NULL;
  END;
  IF v_bypass IN ('on', 'true', '1', 'yes') THEN
    RETURN NEW;
  END IF;

  -- Never block on terminal transitions.
  IF NEW.status IN ('completed', 'approved', 'cancelled', 'variance_review') THEN
    RETURN NEW;
  END IF;

  -- Skip rows without an assignee — no lock being acquired.
  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;

  -- Decide whether the transition acquires / rebinds a zone lock.
  IF TG_OP = 'INSERT' THEN
    v_should_check := true;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Case A: assigned_to just changed (nil→user, or user_a→user_b)
    IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
      v_should_check := true;
    -- Case B: status just moved into active (pending→in_progress, etc.)
    ELSIF NEW.status IN ('in_progress', 'recount')
      AND OLD.status IS DISTINCT FROM NEW.status
    THEN
      v_should_check := true;
    END IF;
  END IF;

  IF NOT v_should_check THEN
    RETURN NEW;
  END IF;

  -- Org-level rules.
  SELECT enabled, policy, zone_pattern
  INTO v_enabled, v_policy, v_pattern
  FROM cycle_count_zone_rules
  WHERE organization_id = NEW.organization_id;

  IF NOT FOUND OR v_enabled IS NOT TRUE OR v_policy = 'off' THEN
    RETURN NEW;
  END IF;

  v_zone := public.cycle_count_zone_of(NEW.location, v_pattern);
  IF v_zone IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_policy = 'one_counter_per_zone' THEN
    SELECT DISTINCT assigned_to
    INTO v_owner
    FROM rr_cyclecount_data
    WHERE id != NEW.id
      AND organization_id = NEW.organization_id
      AND public.cycle_count_zone_of(location, v_pattern) = v_zone
      AND assigned_to IS NOT NULL
      AND assigned_to <> NEW.assigned_to
      AND status IN ('in_progress', 'recount')
    LIMIT 1;

    IF v_owner IS NOT NULL THEN
      SELECT COALESCE(full_name, email, 'another counter')
      INTO v_owner_name
      FROM user_profiles
      WHERE id = v_owner;

      RAISE EXCEPTION
        'ZONE_LOCKED: Zone "%" is currently being counted by %. Only one counter may work a zone at a time.',
        v_zone,
        COALESCE(v_owner_name, 'another counter')
      USING
        ERRCODE = 'P0001',
        HINT    = 'cycle_count_zone_lock',
        DETAIL  = format('zone=%s;owner=%s', v_zone, v_owner);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_cycle_count_zone_exclusivity() IS
  'Rejects cycle-count writes (INSERT or UPDATE of assigned_to / status) that would put a second counter into a zone already held by another active counter. Supervisors / admins can bypass per-transaction by setting app.cycle_count_zone_lock_bypass = on (migration 225 / 226).';

-- Make sure the trigger fires on the right columns (add assigned_to change
-- detection even when status stays pending).
DROP TRIGGER IF EXISTS zzz_trigger_enforce_zone_exclusivity ON rr_cyclecount_data;
CREATE TRIGGER zzz_trigger_enforce_zone_exclusivity
BEFORE INSERT OR UPDATE OF assigned_to, status ON rr_cyclecount_data
FOR EACH ROW
EXECUTE FUNCTION public.enforce_cycle_count_zone_exclusivity();

-- ---------------------------------------------------------------------------
-- Supervisor override RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_cycle_count_to_user_force(
  p_count_id uuid,
  p_user_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_result      jsonb;
BEGIN
  -- Caller must be superadmin / admin / manager / logistics_coordinator.
  SELECT role::text INTO v_caller_role
  FROM user_profiles
  WHERE id = auth.uid();

  IF v_caller_role IS NULL
     OR v_caller_role NOT IN ('superadmin', 'admin', 'manager', 'logistics_coordinator')
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only supervisors and admins can force-assign into a locked zone.'
    );
  END IF;

  -- Bypass the zone trigger for the rest of this transaction.
  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);

  -- Delegate to the canonical assign RPC (migration 037 replaced it).
  SELECT public.assign_cycle_count_to_user(p_count_id, p_user_id)
  INTO v_result;

  RETURN COALESCE(v_result,
    jsonb_build_object('success', false, 'error', 'Underlying RPC returned no result')
  );
END;
$$;

COMMENT ON FUNCTION public.assign_cycle_count_to_user_force(uuid, uuid) IS
  'Supervisor override for zone-exclusivity. Sets the bypass GUC for the transaction and delegates to assign_cycle_count_to_user. Caller must be superadmin / admin / manager / logistics_coordinator.';

GRANT EXECUTE ON FUNCTION public.assign_cycle_count_to_user_force(uuid, uuid)
  TO authenticated;

COMMIT;
