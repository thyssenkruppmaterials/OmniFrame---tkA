-- ============================================================================
-- Migration 228: Zone column + performance indexes for pull-next
--
-- Problem
-- -------
-- Migrations 225/227 use `public.cycle_count_zone_of(location, zone_pattern)`
-- in WHERE clauses and ORDER BY. Because zone_pattern is a column (not a
-- constant), the planner treats it as a non-stable expression and can't
-- match the partial index on `split_part(location, '-', 1)`. EXPLAIN on
-- the pull-next candidate SELECT showed a nested SubPlan looping 5,340
-- times (~125 ms JUST to filter — before ORDER BY, FOR UPDATE, or the
-- 50× get_path_rule roundtrips that the Rust ranker does per candidate).
--
-- Fix
-- ---
-- 1. Materialize a `zone` column (STORED GENERATED) using the default rule
--    (first dash-separated segment). 99% of orgs use the default; the few
--    that use `zone_pattern` keep correctness via the trigger fallback
--    but eat the slow path.
-- 2. Indexes on the new column tuned for the two hot lookups:
--    (a) "is this zone actively locked by another user?" (in_progress /
--        recount + assigned_to IS NOT NULL)
--    (b) "is this row claimable?" (pending / recount + assigned_to IS NULL)
-- 3. Trigger rewritten to compare via the `zone` column whenever the
--    org's zone_pattern is NULL (fast path), falling back to
--    cycle_count_zone_of() only when zone_pattern is configured.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Generated zone column
-- ---------------------------------------------------------------------------
-- PostgreSQL materializes this on every insert/update so reads are O(1).
-- Backfill happens automatically as part of ADD COLUMN.
ALTER TABLE rr_cyclecount_data
  ADD COLUMN IF NOT EXISTS zone TEXT
  GENERATED ALWAYS AS (
    CASE
      WHEN location IS NULL OR location = '' OR location = '<<empty>>' THEN NULL
      ELSE NULLIF(split_part(location, '-', 1), '')
    END
  ) STORED;

COMMENT ON COLUMN rr_cyclecount_data.zone IS
  'Materialized zone derived from the first dash segment of location (e.g. K1-08-02-2 -> K1). Used by the zone-exclusivity enforcement engine for O(log n) lookups. Custom zone_pattern in cycle_count_zone_rules bypasses this column and uses the slower cycle_count_zone_of() helper.';

-- ---------------------------------------------------------------------------
-- 2. Replace the old partial index with column-based ones
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_rr_cyclecount_active_zone;

-- (a) Active ownership lookup: "who owns zone X in org Y?"
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_zone_active
ON rr_cyclecount_data (organization_id, zone, assigned_to)
WHERE assigned_to IS NOT NULL
  AND status IN ('in_progress', 'recount');

-- (b) Claimable candidates filtered by zone (for pull-next pre-filter
-- and sticky ORDER BY).
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_zone_claimable
ON rr_cyclecount_data (organization_id, zone)
WHERE assigned_to IS NULL
  AND status IN ('pending', 'recount');

-- ---------------------------------------------------------------------------
-- 3. Rewrite the enforcement trigger — fast path via NEW.zone
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_cycle_count_zone_exclusivity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bypass        text;
  v_enabled       boolean;
  v_policy        text;
  v_pattern       text;
  v_zone          text;
  v_owner         uuid;
  v_owner_name    text;
  v_assigned_user uuid;
  v_assigned_name text;
  v_should_check  boolean := false;
BEGIN
  BEGIN
    v_bypass := current_setting('app.cycle_count_zone_lock_bypass', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass := NULL;
  END;
  IF v_bypass IN ('on', 'true', '1', 'yes') THEN
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

  SELECT enabled, policy, zone_pattern
  INTO v_enabled, v_policy, v_pattern
  FROM cycle_count_zone_rules
  WHERE organization_id = NEW.organization_id;

  IF NOT FOUND OR v_enabled IS NOT TRUE OR v_policy = 'off' THEN
    RETURN NEW;
  END IF;

  -- Fast path: use the generated `zone` column when no custom pattern.
  IF v_pattern IS NULL THEN
    v_zone := NEW.zone;
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
      -- Fast path: indexed by (organization_id, zone, assigned_to)
      -- via idx_rr_cyclecount_zone_active.
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
      -- Custom-pattern path (rare, slower).
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

COMMENT ON FUNCTION public.enforce_cycle_count_zone_exclusivity() IS
  'Enforces zone-exclusivity policies with an indexed fast path via the `zone` generated column (default). When cycle_count_zone_rules.zone_pattern is set, falls back to the slower cycle_count_zone_of() helper. Supervisors bypass via app.cycle_count_zone_lock_bypass.';

-- Trigger registration unchanged (still fires on assigned_to / status).

COMMIT;
