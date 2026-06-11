-- ============================================================================
-- Migration 225: Cycle Count Zone Exclusivity
--
-- Enterprise-grade mutual exclusion so that only ONE counter can be actively
-- counting in a given zone at a time. A "zone" is derived from the first
-- dash-separated segment of `rr_cyclecount_data.location`
--   e.g.  K1-08-02-2  →  zone "K1"
--         SC-22-C-01  →  zone "SC"
--
-- Configuration is per-organization, with a hard-block-with-override policy:
--   - regular counters (claim / pull-next / start / self-assign) are blocked
--   - supervisors / admins may override via a bypass flag on the session
--   - UI surfaces who holds each zone
--
-- Architecture
-- ------------
-- 1. `cycle_count_zone_rules`      -- org-level config (one row per org)
-- 2. `cycle_count_zone_of(...)`    -- pure SQL helper to derive zone string
-- 3. Partial index on active rows  -- O(log n) zone-owner lookups
-- 4. `enforce_cycle_count_zone_exclusivity()` -- BEFORE UPDATE trigger that
--    rejects writes that would violate the per-org policy
-- 5. `v_cycle_count_active_zones`  -- live roll-up view for dashboards
-- 6. Seed rows for every org (disabled by default); enable for j.AI OneBox
--
-- Override mechanism
-- ------------------
-- The trigger honors a session GUC, `app.cycle_count_zone_lock_bypass`.
-- Supervisors / admins can set it per-call to bypass enforcement:
--     SET LOCAL app.cycle_count_zone_lock_bypass = 'on';
--     UPDATE rr_cyclecount_data SET assigned_to = ... ;
-- This is safer than a column flag because the bypass is scoped to a single
-- transaction and cannot leak between callers.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Org-level zone rules table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cycle_count_zone_rules (
  organization_id  uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled          boolean NOT NULL DEFAULT false,
  policy           text NOT NULL DEFAULT 'one_counter_per_zone'
                   CHECK (policy IN ('off', 'one_counter_per_zone')),
  zone_pattern     text,                              -- NULL = first dash segment
  exclusion_pairs  jsonb NOT NULL DEFAULT '[]'::jsonb, -- reserved for pair rules
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES user_profiles(id),
  updated_by       uuid REFERENCES user_profiles(id)
);

COMMENT ON TABLE cycle_count_zone_rules IS
  'Per-organization configuration for cycle-count zone mutual exclusion. A zone is derived from `rr_cyclecount_data.location` via cycle_count_zone_of(). Policy one_counter_per_zone prevents two users from being assigned active counts in the same zone simultaneously.';
COMMENT ON COLUMN cycle_count_zone_rules.zone_pattern IS
  'Optional POSIX regex override for deriving the zone. NULL means "first dash-separated segment" (split_part(location, ''-'', 1)).';
COMMENT ON COLUMN cycle_count_zone_rules.exclusion_pairs IS
  'Reserved. JSON array of pair objects: [{"zone_a":"K1","zone_b":"K2"}] — when populated and policy supports it, the pair counts as "one big zone" for locking purposes.';

-- updated_at trigger (reuses the existing shared helper)
CREATE TRIGGER cycle_count_zone_rules_set_updated_at
BEFORE UPDATE ON cycle_count_zone_rules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS — counters can READ their org's rules; only admins/managers/supervisors
-- can modify.
ALTER TABLE cycle_count_zone_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY cycle_count_zone_rules_select ON cycle_count_zone_rules
  FOR SELECT USING (
    organization_id = (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY cycle_count_zone_rules_admin_write ON cycle_count_zone_rules
  FOR ALL USING (
    organization_id = (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND role IN ('superadmin', 'admin', 'manager', 'logistics_coordinator')
    )
  ) WITH CHECK (
    organization_id = (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND role IN ('superadmin', 'admin', 'manager', 'logistics_coordinator')
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Zone derivation helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cycle_count_zone_of(
  p_location text,
  p_pattern  text DEFAULT NULL
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_location IS NULL OR p_location = '' THEN NULL
    WHEN p_location = '<<empty>>' THEN NULL
    WHEN p_pattern IS NOT NULL AND p_pattern <> ''
      THEN NULLIF(substring(p_location FROM p_pattern), '')
    ELSE NULLIF(split_part(p_location, '-', 1), '')
  END;
$$;

COMMENT ON FUNCTION public.cycle_count_zone_of(text, text) IS
  'Derives a zone string from a location code. When pattern is NULL, returns the first dash-separated segment (e.g. K1-08-02-2 → K1). When pattern is set, returns the first regex match.';

-- ---------------------------------------------------------------------------
-- 3. Partial index for fast zone-owner lookup
--    Only active rows are indexed (tiny fraction of the table).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_active_zone
ON rr_cyclecount_data (
  organization_id,
  (split_part(location, '-', 1)),
  assigned_to
)
WHERE assigned_to IS NOT NULL
  AND status IN ('in_progress', 'recount');

-- ---------------------------------------------------------------------------
-- 4. Enforcement trigger
-- ---------------------------------------------------------------------------
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

  -- Fast-path: only enforce when the row is being made (or staying) actively
  -- claimed by a real user. Pending / completed / variance_review / approved
  -- / cancelled rows don't hold a zone lock.
  IF NEW.assigned_to IS NULL
     OR NEW.status NOT IN ('in_progress', 'recount') THEN
    RETURN NEW;
  END IF;

  -- Idempotent re-save of an already-owned row (no change in owner/status)
  -- — nothing to enforce.
  IF TG_OP = 'UPDATE'
     AND OLD.assigned_to IS NOT DISTINCT FROM NEW.assigned_to
     AND OLD.status       IS NOT DISTINCT FROM NEW.status
  THEN
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
    RETURN NEW;  -- empty / missing location → not a real zone
  END IF;

  IF v_policy = 'one_counter_per_zone' THEN
    -- Find any OTHER active count in the same zone held by a different user.
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
  'BEFORE UPDATE trigger on rr_cyclecount_data that rejects claim/assign/start transitions when the target row is in a zone already held by another active counter (per cycle_count_zone_rules). Set session GUC app.cycle_count_zone_lock_bypass=on to bypass (supervisor/admin override).';

-- Name this trigger so it fires AFTER all other BEFORE UPDATE triggers
-- (alphabetical order), so NEW.status has been normalized by
-- trigger_track_assignment_changes before we check it.
DROP TRIGGER IF EXISTS zzz_trigger_enforce_zone_exclusivity ON rr_cyclecount_data;
CREATE TRIGGER zzz_trigger_enforce_zone_exclusivity
BEFORE UPDATE OF assigned_to, status ON rr_cyclecount_data
FOR EACH ROW
EXECUTE FUNCTION public.enforce_cycle_count_zone_exclusivity();

-- ---------------------------------------------------------------------------
-- 5. Active zones roll-up view (for dashboard / operators panel)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_cycle_count_active_zones
WITH (security_invoker = true)
AS
SELECT
  rcc.organization_id,
  public.cycle_count_zone_of(rcc.location, r.zone_pattern) AS zone,
  rcc.assigned_to        AS locked_by,
  up.full_name           AS locked_by_name,
  up.email               AS locked_by_email,
  count(*)               AS active_count_count,
  min(rcc.assigned_at)   AS acquired_at,
  array_agg(rcc.id)      AS active_count_ids
FROM rr_cyclecount_data rcc
LEFT JOIN cycle_count_zone_rules r
  ON r.organization_id = rcc.organization_id
LEFT JOIN user_profiles up
  ON up.id = rcc.assigned_to
WHERE rcc.assigned_to IS NOT NULL
  AND rcc.status IN ('in_progress', 'recount')
  AND public.cycle_count_zone_of(rcc.location, r.zone_pattern) IS NOT NULL
GROUP BY
  rcc.organization_id,
  public.cycle_count_zone_of(rcc.location, r.zone_pattern),
  rcc.assigned_to,
  up.full_name,
  up.email;

COMMENT ON VIEW v_cycle_count_active_zones IS
  'Live rollup of zones currently being counted, grouped by (org, zone, counter). Joins user_profiles for display name / email. Security invoker so RLS on rr_cyclecount_data applies.';

GRANT SELECT ON v_cycle_count_active_zones TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Seed a default rule row for every organization (disabled by default).
--    Enable for j.AI OneBox (c9d89a74-7179-4033-93ea-56267cf42a17) per request.
-- ---------------------------------------------------------------------------
INSERT INTO cycle_count_zone_rules (organization_id, enabled, policy, notes)
SELECT id, false, 'one_counter_per_zone',
       'Auto-seeded by migration 225. Toggle enabled=true in Count Settings → Zone Rules to activate.'
FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

UPDATE cycle_count_zone_rules
SET enabled = true,
    notes = 'Enabled by migration 225 at owner request (K1 zone overlap incident).'
WHERE organization_id = 'c9d89a74-7179-4033-93ea-56267cf42a17';

COMMIT;
