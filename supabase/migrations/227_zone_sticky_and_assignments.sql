-- ============================================================================
-- Migration 227: Sticky Zone + Zone-to-User Assignments
--
-- Two additions on top of the 225/226 zone-exclusivity foundation:
--
--  1. sticky_zone  — per-org optional toggle on cycle_count_zone_rules.
--     When true, the Rust claim ranker prefers candidates whose zone the
--     operator already owns, so an operator finishes a zone before
--     moving to a new one.
--
--  2. cycle_count_zone_assignments — explicit zone → user mapping. When
--     a zone has a named assignee, ONLY that user may be assigned /
--     claim / start counts in that zone. Other users are blocked with
--     ZONE_ASSIGNED (distinct from ZONE_LOCKED so clients can show a
--     tailored message). Supervisors retain the existing
--     app.cycle_count_zone_lock_bypass override.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. sticky_zone column
-- ---------------------------------------------------------------------------
ALTER TABLE cycle_count_zone_rules
  ADD COLUMN IF NOT EXISTS sticky_zone boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN cycle_count_zone_rules.sticky_zone IS
  'When true (and policy != off), the Rust work-service ranks pull-next candidates so zones the operator already holds come first. Effectively "finish the zone before leaving it".';

-- ---------------------------------------------------------------------------
-- 2. Zone assignments table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cycle_count_zone_assignments (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  zone             text NOT NULL,
  user_id          uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES user_profiles(id),
  updated_by       uuid REFERENCES user_profiles(id),
  PRIMARY KEY (organization_id, zone),
  CHECK (zone <> '' AND zone = upper(zone))
);

COMMENT ON TABLE cycle_count_zone_assignments IS
  'Admin-configured zone-to-user ownership. When a row exists for (org, zone), only that user may claim / be assigned / start counts in that zone. Supervisors override via app.cycle_count_zone_lock_bypass (migration 225).';

CREATE INDEX IF NOT EXISTS idx_zone_assignments_user
  ON cycle_count_zone_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_zone_assignments_org
  ON cycle_count_zone_assignments (organization_id);

CREATE TRIGGER cycle_count_zone_assignments_set_updated_at
BEFORE UPDATE ON cycle_count_zone_assignments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE cycle_count_zone_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY cycle_count_zone_assignments_select ON cycle_count_zone_assignments
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY cycle_count_zone_assignments_admin_write ON cycle_count_zone_assignments
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
-- 3. Updated enforcement trigger — honors both active locks AND zone assignments
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

  -- No assignee → nothing to enforce.
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

  -- ------------------------------------------------------------------
  -- (a) Zone-to-user assignment check (admin-configured ownership)
  -- ------------------------------------------------------------------
  SELECT user_id
  INTO v_assigned_user
  FROM cycle_count_zone_assignments
  WHERE organization_id = NEW.organization_id
    AND zone = v_zone;

  IF v_assigned_user IS NOT NULL AND v_assigned_user <> NEW.assigned_to THEN
    SELECT COALESCE(full_name, email, 'another counter')
    INTO v_assigned_name
    FROM user_profiles
    WHERE id = v_assigned_user;

    RAISE EXCEPTION
      'ZONE_ASSIGNED: Zone "%" is assigned to %. Only that counter may work this zone.',
      v_zone,
      COALESCE(v_assigned_name, 'another counter')
    USING
      ERRCODE = 'P0001',
      HINT    = 'cycle_count_zone_assigned',
      DETAIL  = format('zone=%s;assigned_to=%s', v_zone, v_assigned_user);
  END IF;

  -- ------------------------------------------------------------------
  -- (b) Active-lock check (another user currently counting the zone)
  -- ------------------------------------------------------------------
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
  'Enforces cycle-count zone exclusivity: (a) if the zone has an explicit cycle_count_zone_assignments row, only that user may work it (ZONE_ASSIGNED); (b) otherwise, only one user may actively count the zone at a time (ZONE_LOCKED). Supervisors override via app.cycle_count_zone_lock_bypass.';

-- ---------------------------------------------------------------------------
-- 4. View with joined user names for the dashboard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_cycle_count_zone_assignments
WITH (security_invoker = true)
AS
SELECT
  a.organization_id,
  a.zone,
  a.user_id,
  up.full_name  AS user_name,
  up.email      AS user_email,
  a.notes,
  a.created_at,
  a.updated_at
FROM cycle_count_zone_assignments a
LEFT JOIN user_profiles up ON up.id = a.user_id;

COMMENT ON VIEW v_cycle_count_zone_assignments IS
  'Zone assignments with joined user_profiles for display (security_invoker so RLS on the base table applies).';

GRANT SELECT ON v_cycle_count_zone_assignments TO authenticated;

COMMIT;
