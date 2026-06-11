-- ============================================================================
-- Migration 230: Priority Rules Engine + Zone Bypass Overrides
--
-- Three additions, all composable with the 225/227/229 zone engine:
--
-- 1. Heartbeat-based auto-release RPC — the Rust scheduler calls this on
--    its existing 5-minute tick so tasks abandoned by offline operators
--    get returned to the queue without admin intervention. Complements
--    the existing 30-minute `updated_at` rule.
--
-- 2. Zone bypass overrides — two new array columns on
--    `cycle_count_zone_rules`:
--      - `bypass_priorities`   TEXT[]  (e.g. {'critical','hot'})
--      - `bypass_count_types`  TEXT[]  (e.g. {'part_verification','audit'})
--    The trigger checks these BEFORE raising ZONE_LOCKED / ZONE_ASSIGNED,
--    so high-priority counts or specific count types can cut through an
--    active zone lock (very useful for urgent recounts / priority
--    inspections that can't wait).
--
-- 3. Priority Rules engine — `cycle_count_priority_rules` table + an
--    `apply_cycle_count_priority_rules(org_id)` function that re-scores
--    every pending/recount row based on admin-configured conditions
--    (zone, count_type, age_hours, variance_pct, warehouse). The function
--    is idempotent and safe to run from a cron or on demand from the UI.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Heartbeat-based auto-release (called from Rust scheduler)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_stale_heartbeat_assignments(
  p_threshold_minutes int DEFAULT 10
) RETURNS TABLE (released_count_id uuid, count_number text, previous_owner uuid)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Bypass the zone-exclusivity trigger: we're releasing, not claiming.
  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);

  RETURN QUERY
  WITH stuck AS (
    SELECT rcc.id,
           rcc.count_number,
           rcc.assigned_to AS previous_owner
    FROM rr_cyclecount_data rcc
    LEFT JOIN LATERAL (
      SELECT max(last_heartbeat) AS last_hb
      FROM worker_heartbeats
      WHERE user_id = rcc.assigned_to
    ) hb ON true
    WHERE rcc.assigned_to IS NOT NULL
      AND rcc.status IN ('in_progress', 'recount')
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
          '[Auto-released at %s — operator offline > %s min]',
          to_char(NOW(), 'YYYY-MM-DD HH24:MI'),
          p_threshold_minutes
        )
    FROM stuck
    WHERE target.id = stuck.id
    RETURNING target.id, target.count_number, stuck.previous_owner
  )
  SELECT id, count_number, previous_owner FROM updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_stale_heartbeat_assignments(int)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.release_stale_heartbeat_assignments(int) IS
  'Scheduler-facing release: clears in_progress / recount assignments whose owner has not pinged worker_heartbeats in `p_threshold_minutes`. Returns one row per released count.';

-- ---------------------------------------------------------------------------
-- 2. Zone bypass overrides
-- ---------------------------------------------------------------------------
ALTER TABLE cycle_count_zone_rules
  ADD COLUMN IF NOT EXISTS bypass_priorities TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS bypass_count_types TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN cycle_count_zone_rules.bypass_priorities IS
  'Priority values (e.g. {''critical'',''hot''}) that can cut through an active zone lock. Use sparingly — intended for emergency recounts or urgent inspections.';
COMMENT ON COLUMN cycle_count_zone_rules.bypass_count_types IS
  'Count type slugs (e.g. {''part_verification'',''audit''}) that are exempt from zone mutual exclusion. Use for non-disruptive checks that don''t truly conflict with an active counter.';

-- Rewrite the trigger so it honors the bypass lists.
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
  v_assigned_user uuid;
  v_assigned_name text;
  v_should_check  boolean := false;
BEGIN
  BEGIN
    v_bypass_guc := current_setting('app.cycle_count_zone_lock_bypass', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass_guc := NULL;
  END;
  IF v_bypass_guc IN ('on', 'true', '1', 'yes') THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('completed', 'approved', 'cancelled', 'variance_review') THEN
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
    ELSIF NEW.status IN ('in_progress', 'recount')
      AND OLD.status IS DISTINCT FROM NEW.status
    THEN
      v_should_check := true;
    END IF;
  END IF;

  IF NOT v_should_check THEN
    RETURN NEW;
  END IF;

  SELECT enabled, policy, zone_pattern, bypass_priorities, bypass_count_types
  INTO v_enabled, v_policy, v_pattern, v_bypass_prio, v_bypass_types
  FROM cycle_count_zone_rules
  WHERE organization_id = NEW.organization_id;

  IF NOT FOUND OR v_enabled IS NOT TRUE OR v_policy = 'off' THEN
    RETURN NEW;
  END IF;

  -- Per-row bypass: high-priority counts or whitelisted count types cut
  -- through the lock. This is the "dynamic override" surface.
  IF v_bypass_prio IS NOT NULL
     AND NEW.priority::text = ANY(v_bypass_prio)
  THEN
    RETURN NEW;
  END IF;

  IF v_bypass_types IS NOT NULL
     AND NEW.count_type = ANY(v_bypass_types)
  THEN
    RETURN NEW;
  END IF;

  -- Derive zone (inline; STORED generated columns aren't populated in BEFORE
  -- triggers on the NEW row — see migration 228).
  IF v_pattern IS NULL THEN
    IF NEW.location IS NULL OR NEW.location = '' OR NEW.location = '<<empty>>' THEN
      v_zone := NULL;
    ELSE
      v_zone := NULLIF(split_part(NEW.location, '-', 1), '');
    END IF;
  ELSE
    v_zone := public.cycle_count_zone_of(NEW.location, v_pattern);
  END IF;

  IF v_zone IS NULL THEN
    RETURN NEW;
  END IF;

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

  -- (b) Active-lock check
  IF v_policy = 'one_counter_per_zone' THEN
    IF v_pattern IS NULL THEN
      SELECT DISTINCT assigned_to INTO v_owner
      FROM rr_cyclecount_data
      WHERE id != NEW.id
        AND organization_id = NEW.organization_id
        AND zone = v_zone
        AND assigned_to IS NOT NULL
        AND assigned_to <> NEW.assigned_to
        AND status IN ('in_progress', 'recount')
      LIMIT 1;
    ELSE
      SELECT DISTINCT assigned_to INTO v_owner
      FROM rr_cyclecount_data
      WHERE id != NEW.id
        AND organization_id = NEW.organization_id
        AND public.cycle_count_zone_of(location, v_pattern) = v_zone
        AND assigned_to IS NOT NULL
        AND assigned_to <> NEW.assigned_to
        AND status IN ('in_progress', 'recount')
      LIMIT 1;
    END IF;

    IF v_owner IS NOT NULL THEN
      SELECT COALESCE(full_name, email, 'another counter')
      INTO v_owner_name
      FROM user_profiles WHERE id = v_owner;

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

-- ---------------------------------------------------------------------------
-- 3. Priority Rules engine
-- ---------------------------------------------------------------------------
-- A pending/recount row's priority is determined by the highest-matching
-- rule in `cycle_count_priority_rules`. Rules are evaluated in `sort_order`
-- (lowest first — like CSS specificity: lower number = more specific /
-- higher precedence). An admin-triggered or scheduled call to
-- `apply_cycle_count_priority_rules(org_id)` updates every matching row.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cycle_count_priority_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  enabled          boolean NOT NULL DEFAULT true,
  -- Desired priority when this rule matches.
  priority_level   text NOT NULL
                   CHECK (priority_level IN ('critical', 'hot', 'normal', 'low')),
  -- Conditions (NULL = "don't care"). A rule matches when ALL set fields
  -- match the candidate row.
  match_zone            text,
  match_count_type      text,
  match_warehouse       text,
  match_age_gte_hours   int,
  match_variance_gte_pct numeric(6,2),
  match_requires_recount boolean,
  sort_order       int NOT NULL DEFAULT 100,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES user_profiles(id),
  updated_by       uuid REFERENCES user_profiles(id),
  CHECK (name <> ''),
  CHECK (sort_order >= 0 AND sort_order < 10000)
);

COMMENT ON TABLE cycle_count_priority_rules IS
  'Admin-configured rules that set cycle-count priority based on zone, count_type, age, variance, or requires_recount. Evaluated by apply_cycle_count_priority_rules(org). Lower sort_order = higher precedence (CSS-specificity model).';

CREATE INDEX IF NOT EXISTS idx_cycle_count_priority_rules_org_order
  ON cycle_count_priority_rules (organization_id, sort_order);

CREATE TRIGGER cycle_count_priority_rules_set_updated_at
BEFORE UPDATE ON cycle_count_priority_rules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE cycle_count_priority_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY cycle_count_priority_rules_select ON cycle_count_priority_rules
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY cycle_count_priority_rules_admin_write ON cycle_count_priority_rules
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND role IN ('superadmin', 'admin', 'manager', 'logistics_coordinator')
    )
  ) WITH CHECK (
    organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND role IN ('superadmin', 'admin', 'manager', 'logistics_coordinator')
    )
  );

-- ---------------------------------------------------------------------------
-- apply_cycle_count_priority_rules(org_id)
--
-- Re-scores every pending/recount row in the given org. For each row we:
--   1. Walk rules in ascending sort_order where all set conditions match.
--   2. First matching rule wins; if none match, priority stays as-is.
--   3. UPDATE priority in bulk.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_cycle_count_priority_rules(
  p_org_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_org_id      uuid;
  v_touched     int;
BEGIN
  IF p_org_id IS NULL THEN
    SELECT role::text, organization_id
      INTO v_caller_role, v_org_id
    FROM user_profiles WHERE id = auth.uid();

    IF v_caller_role NOT IN ('superadmin', 'admin', 'manager', 'logistics_coordinator') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Only supervisors and admins may apply priority rules.'
      );
    END IF;
  ELSE
    v_org_id := p_org_id;
  END IF;

  WITH candidates AS (
    SELECT
      cc.id,
      cc.priority::text AS current_priority,
      cc.zone,
      cc.count_type,
      cc.warehouse,
      cc.created_at,
      cc.variance_percentage,
      COALESCE(cc.requires_recount, false) AS requires_recount
    FROM rr_cyclecount_data cc
    WHERE cc.organization_id = v_org_id
      AND cc.status IN ('pending', 'recount')
  ),
  matched AS (
    SELECT DISTINCT ON (c.id)
      c.id,
      c.current_priority,
      r.priority_level  AS new_priority
    FROM candidates c
    JOIN cycle_count_priority_rules r
      ON r.organization_id = v_org_id
     AND r.enabled = true
     AND (r.match_zone            IS NULL OR r.match_zone            = c.zone)
     AND (r.match_count_type      IS NULL OR r.match_count_type      = c.count_type)
     AND (r.match_warehouse       IS NULL OR r.match_warehouse       = c.warehouse)
     AND (r.match_requires_recount IS NULL OR r.match_requires_recount = c.requires_recount)
     AND (r.match_age_gte_hours   IS NULL
          OR EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 3600.0 >= r.match_age_gte_hours)
     AND (r.match_variance_gte_pct IS NULL
          OR COALESCE(c.variance_percentage, 0) >= r.match_variance_gte_pct)
    ORDER BY c.id, r.sort_order ASC
  ),
  updated AS (
    UPDATE rr_cyclecount_data target
    SET priority = m.new_priority::cycle_count_priority,
        updated_at = NOW()
    FROM matched m
    WHERE target.id = m.id
      AND target.priority::text <> m.new_priority
    RETURNING target.id
  )
  SELECT count(*) INTO v_touched FROM updated;

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_org_id,
    'touched', v_touched
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_cycle_count_priority_rules(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.apply_cycle_count_priority_rules(uuid) IS
  'Re-scores pending/recount cycle counts based on cycle_count_priority_rules. Lower sort_order wins. Safe to run repeatedly; only updates rows whose priority actually changes.';

COMMIT;
