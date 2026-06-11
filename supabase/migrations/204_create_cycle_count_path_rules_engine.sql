-- ============================================================================
-- Migration 204: Cycle Count Path Rules Engine
-- Description: Location-resolution rules, path-ordering strategies, operator
--              skip/defer queue, resolved location columns on cycle counts,
--              resolution SQL helper, and auto-resolve trigger.
-- ============================================================================

BEGIN;

-- =========================================================================
-- PART 1: Enums
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'path_strategy') THEN
    CREATE TYPE path_strategy AS ENUM (
      'serpentine_zone',
      'directional',
      'alternating_aisles'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'path_direction') THEN
    CREATE TYPE path_direction AS ENUM ('ascending', 'descending');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'path_fallback_behavior') THEN
    CREATE TYPE path_fallback_behavior AS ENUM (
      'allow_unmapped_last',
      'block_unmapped',
      'ignore_path_rules'
    );
  END IF;
END $$;

-- =========================================================================
-- PART 2: Location Resolution Rules
-- =========================================================================

CREATE TABLE IF NOT EXISTS cycle_count_location_resolution_rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_code        VARCHAR(50),
  name                  VARCHAR(100) NOT NULL,
  regex_pattern         TEXT NOT NULL,
  canonical_bin_template TEXT,
  zone_template         TEXT,
  aisle_template        TEXT,
  sequence_template     TEXT,
  priority              INTEGER NOT NULL DEFAULT 0,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            UUID REFERENCES user_profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_resolution_rules_org_wh
  ON cycle_count_location_resolution_rules(organization_id, warehouse_code, priority DESC)
  WHERE is_active = true;

COMMENT ON TABLE cycle_count_location_resolution_rules IS
  'Configurable regex-based rules that normalize raw cycle-count location strings into canonical bin keys, zone, aisle, and sequence values.';

-- =========================================================================
-- PART 3: Path Rules
-- =========================================================================

CREATE TABLE IF NOT EXISTS cycle_count_path_rules (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_code          VARCHAR(50),
  zone_filter             TEXT,
  aisle_filter            TEXT,
  strategy                path_strategy NOT NULL DEFAULT 'serpentine_zone',
  direction               path_direction NOT NULL DEFAULT 'ascending',
  max_counters_per_aisle  INTEGER NOT NULL DEFAULT 1,
  fallback_behavior       path_fallback_behavior NOT NULL DEFAULT 'allow_unmapped_last',
  priority                INTEGER NOT NULL DEFAULT 0,
  is_active               BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by              UUID REFERENCES user_profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_path_rules_org_wh
  ON cycle_count_path_rules(organization_id, warehouse_code, priority DESC)
  WHERE is_active = true;

COMMENT ON TABLE cycle_count_path_rules IS
  'Per-warehouse/zone path strategies that control how the pull-claim engine orders tasks and prevents aisle collisions.';

-- =========================================================================
-- PART 4: Operator Deferred Counts
-- =========================================================================

CREATE TABLE IF NOT EXISTS cycle_count_operator_deferred_counts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  count_id          UUID NOT NULL REFERENCES rr_cyclecount_data(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  defer_reason      TEXT,
  deferred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resume_priority   INTEGER NOT NULL DEFAULT 0,
  times_deferred    INTEGER NOT NULL DEFAULT 1,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  reactivated_at    TIMESTAMPTZ,
  cleared_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deferred_counts_active_unique
  ON cycle_count_operator_deferred_counts(count_id, user_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_deferred_counts_user_active
  ON cycle_count_operator_deferred_counts(user_id, is_active, deferred_at ASC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_deferred_counts_count
  ON cycle_count_operator_deferred_counts(count_id)
  WHERE is_active = true;

COMMENT ON TABLE cycle_count_operator_deferred_counts IS
  'Per-operator skip queue. When an operator skips a count, the defer record reserves it so it cycles back to that same operator after other eligible work is exhausted.';

-- =========================================================================
-- PART 5: Resolved Location Columns on rr_cyclecount_data
-- =========================================================================

ALTER TABLE rr_cyclecount_data
  ADD COLUMN IF NOT EXISTS resolved_location_key    TEXT,
  ADD COLUMN IF NOT EXISTS resolved_zone            VARCHAR(50),
  ADD COLUMN IF NOT EXISTS resolved_aisle           VARCHAR(50),
  ADD COLUMN IF NOT EXISTS resolved_sequence        NUMERIC,
  ADD COLUMN IF NOT EXISTS resolution_source        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS warehouse_location_mapping_id UUID REFERENCES warehouse_location_mappings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cyclecount_resolved_path
  ON rr_cyclecount_data(organization_id, resolved_zone, resolved_aisle, resolved_sequence)
  WHERE status IN ('pending', 'recount');

COMMENT ON COLUMN rr_cyclecount_data.resolved_location_key IS 'Canonical storage bin key after resolution rules or direct map match';
COMMENT ON COLUMN rr_cyclecount_data.resolution_source IS 'How the location was resolved: map, rule, or unresolved';

-- =========================================================================
-- PART 6: Resolution SQL Helper Function
-- =========================================================================

CREATE OR REPLACE FUNCTION resolve_cycle_count_location(
  p_org_id        UUID,
  p_warehouse     TEXT,
  p_raw_location  TEXT
)
RETURNS TABLE (
  resolved_key      TEXT,
  resolved_zone     VARCHAR(50),
  resolved_aisle    VARCHAR(50),
  resolved_seq      NUMERIC,
  source            VARCHAR(20),
  mapping_id        UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wh_code       TEXT;
  v_mapping       RECORD;
  v_rack          RECORD;
  v_zone          RECORD;
  v_rule          RECORD;
  v_resolved_key  TEXT;
  v_matches       TEXT[];
BEGIN
  v_wh_code := COALESCE(NULLIF(TRIM(p_warehouse), ''), (
    SELECT default_warehouse_code FROM warehouse_map_settings
    WHERE organization_id = p_org_id LIMIT 1
  ));

  -- Step 1: Try direct match to warehouse_location_mappings
  SELECT wlm.* INTO v_mapping
  FROM warehouse_location_mappings wlm
  JOIN warehouse_maps wm ON wlm.map_id = wm.id
  WHERE wm.organization_id = p_org_id
    AND wlm.warehouse_code = v_wh_code
    AND UPPER(wlm.storage_bin) = UPPER(TRIM(p_raw_location))
  LIMIT 1;

  IF v_mapping.id IS NOT NULL THEN
    SELECT wr.* INTO v_rack FROM warehouse_racks wr WHERE wr.id = v_mapping.rack_id;
    IF v_rack.zone_id IS NOT NULL THEN
      SELECT wz.* INTO v_zone FROM warehouse_zones wz WHERE wz.id = v_rack.zone_id;
    END IF;

    RETURN QUERY SELECT
      v_mapping.storage_bin::TEXT,
      COALESCE(v_zone.name, 'default')::VARCHAR(50),
      COALESCE(v_rack.aisle, v_rack.label)::VARCHAR(50),
      (v_rack.position_y * 1000 + v_mapping.rack_row * 10 + v_mapping.rack_column)::NUMERIC,
      'map'::VARCHAR(20),
      v_mapping.id;
    RETURN;
  END IF;

  -- Step 2: Try resolution rules (highest priority first)
  FOR v_rule IN
    SELECT * FROM cycle_count_location_resolution_rules
    WHERE organization_id = p_org_id
      AND is_active = true
      AND (warehouse_code IS NULL OR warehouse_code = v_wh_code)
    ORDER BY priority DESC
    LIMIT 5
  LOOP
    BEGIN
      v_matches := regexp_matches(TRIM(p_raw_location), v_rule.regex_pattern);
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;

    IF v_matches IS NOT NULL AND array_length(v_matches, 1) > 0 THEN
      v_resolved_key := COALESCE(v_rule.canonical_bin_template, TRIM(p_raw_location));
      FOR i IN 1..array_length(v_matches, 1) LOOP
        v_resolved_key := replace(v_resolved_key, '\' || i::text, v_matches[i]);
      END LOOP;

      -- Try map join with the resolved key
      SELECT wlm.* INTO v_mapping
      FROM warehouse_location_mappings wlm
      JOIN warehouse_maps wm ON wlm.map_id = wm.id
      WHERE wm.organization_id = p_org_id
        AND wlm.warehouse_code = v_wh_code
        AND UPPER(wlm.storage_bin) = UPPER(v_resolved_key)
      LIMIT 1;

      IF v_mapping.id IS NOT NULL THEN
        SELECT wr.* INTO v_rack FROM warehouse_racks wr WHERE wr.id = v_mapping.rack_id;
        IF v_rack.zone_id IS NOT NULL THEN
          SELECT wz.* INTO v_zone FROM warehouse_zones wz WHERE wz.id = v_rack.zone_id;
        END IF;

        RETURN QUERY SELECT
          v_mapping.storage_bin::TEXT,
          COALESCE(v_zone.name, 'default')::VARCHAR(50),
          COALESCE(v_rack.aisle, v_rack.label)::VARCHAR(50),
          (v_rack.position_y * 1000 + v_mapping.rack_row * 10 + v_mapping.rack_column)::NUMERIC,
          'map'::VARCHAR(20),
          v_mapping.id;
        RETURN;
      END IF;

      -- Derive fallback values from rule templates
      DECLARE
        v_fb_zone  TEXT := v_rule.zone_template;
        v_fb_aisle TEXT := v_rule.aisle_template;
        v_fb_seq   TEXT := v_rule.sequence_template;
      BEGIN
        FOR i IN 1..array_length(v_matches, 1) LOOP
          IF v_fb_zone IS NOT NULL THEN
            v_fb_zone := replace(v_fb_zone, '\' || i::text, v_matches[i]);
          END IF;
          IF v_fb_aisle IS NOT NULL THEN
            v_fb_aisle := replace(v_fb_aisle, '\' || i::text, v_matches[i]);
          END IF;
          IF v_fb_seq IS NOT NULL THEN
            v_fb_seq := replace(v_fb_seq, '\' || i::text, v_matches[i]);
          END IF;
        END LOOP;

        RETURN QUERY SELECT
          v_resolved_key,
          COALESCE(v_fb_zone, 'default')::VARCHAR(50),
          COALESCE(v_fb_aisle, 'unknown')::VARCHAR(50),
          CASE WHEN v_fb_seq ~ '^\d+\.?\d*$' THEN v_fb_seq::NUMERIC ELSE 0 END,
          'rule'::VARCHAR(20),
          NULL::UUID;
        RETURN;
      END;
    END IF;
  END LOOP;

  -- Step 3: Unresolved fallback
  RETURN QUERY SELECT
    TRIM(p_raw_location),
    'unresolved'::VARCHAR(50),
    'unresolved'::VARCHAR(50),
    0::NUMERIC,
    'unresolved'::VARCHAR(20),
    NULL::UUID;
  RETURN;
END;
$$;

COMMENT ON FUNCTION resolve_cycle_count_location IS
  'Resolves a raw cycle-count location string into canonical bin, zone, aisle, sequence using warehouse map data first, then resolution rules, then unresolved fallback.';

-- =========================================================================
-- PART 7: Auto-Resolve Trigger
-- =========================================================================

CREATE OR REPLACE FUNCTION auto_resolve_cycle_count_location()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_result RECORD;
BEGIN
  SELECT * INTO v_result
  FROM resolve_cycle_count_location(NEW.organization_id, NEW.warehouse, NEW.location)
  LIMIT 1;

  IF v_result IS NOT NULL THEN
    NEW.resolved_location_key         := v_result.resolved_key;
    NEW.resolved_zone                 := v_result.resolved_zone;
    NEW.resolved_aisle                := v_result.resolved_aisle;
    NEW.resolved_sequence             := v_result.resolved_seq;
    NEW.resolution_source             := v_result.source;
    NEW.warehouse_location_mapping_id := v_result.mapping_id;
  ELSE
    NEW.resolved_location_key         := TRIM(NEW.location);
    NEW.resolved_zone                 := 'unresolved';
    NEW.resolved_aisle                := 'unresolved';
    NEW.resolved_sequence             := 0;
    NEW.resolution_source             := 'unresolved';
    NEW.warehouse_location_mapping_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_resolve_location ON rr_cyclecount_data;

CREATE TRIGGER trigger_auto_resolve_location
  BEFORE INSERT OR UPDATE OF location, warehouse ON rr_cyclecount_data
  FOR EACH ROW
  EXECUTE FUNCTION auto_resolve_cycle_count_location();

-- =========================================================================
-- PART 8: RLS Policies
-- =========================================================================

ALTER TABLE cycle_count_location_resolution_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle_count_path_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle_count_operator_deferred_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view resolution rules in their org"
  ON cycle_count_location_resolution_rules FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can manage resolution rules in their org"
  ON cycle_count_location_resolution_rules FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can view path rules in their org"
  ON cycle_count_path_rules FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can manage path rules in their org"
  ON cycle_count_path_rules FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can view deferred counts in their org"
  ON cycle_count_operator_deferred_counts FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can manage deferred counts in their org"
  ON cycle_count_operator_deferred_counts FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

-- =========================================================================
-- PART 9: Tab Definition for Path Engine
-- =========================================================================

INSERT INTO tab_definitions (page_resource, tab_id, tab_label, description, display_order, is_active)
VALUES (
  'inventory_apps',
  'path-engine',
  'Path Engine',
  'Configure location resolution and path-ordering rules for cycle counts',
  80,
  true
)
ON CONFLICT (page_resource, tab_id) DO NOTHING;

-- =========================================================================
-- PART 10: Skip/Defer Helper Functions
-- =========================================================================

CREATE OR REPLACE FUNCTION skip_cycle_count_for_operator(
  p_count_id    UUID,
  p_user_id     UUID,
  p_reason      TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_existing RECORD;
  v_rows_updated INTEGER := 0;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM rr_cyclecount_data WHERE id = p_count_id;

  IF v_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Count not found');
  END IF;

  -- Clear assignment on the count row so it doesn't come back via Phase 1
  UPDATE rr_cyclecount_data
  SET assigned_to = NULL,
      assigned_at = NULL,
      counter_name = NULL,
      status = 'pending',
      push_mode = 'pull',
      pushed_by = NULL,
      pushed_at = NULL,
      push_acknowledged = false,
      updated_at = NOW()
  WHERE id = p_count_id
    AND assigned_to = p_user_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Count not found or not assigned to this operator'
    );
  END IF;

  -- Upsert active defer record
  SELECT * INTO v_existing
  FROM cycle_count_operator_deferred_counts
  WHERE count_id = p_count_id AND user_id = p_user_id AND is_active = true;

  IF v_existing.id IS NOT NULL THEN
    UPDATE cycle_count_operator_deferred_counts
    SET times_deferred = v_existing.times_deferred + 1,
        deferred_at = NOW(),
        defer_reason = COALESCE(p_reason, v_existing.defer_reason),
        updated_at = NOW()
    WHERE id = v_existing.id;
  ELSE
    INSERT INTO cycle_count_operator_deferred_counts
      (organization_id, count_id, user_id, defer_reason, deferred_at, times_deferred, is_active)
    VALUES
      (v_org_id, p_count_id, p_user_id, p_reason, NOW(), 1, true);
  END IF;

  RETURN json_build_object('success', true, 'message', 'Count deferred');
END;
$$;

CREATE OR REPLACE FUNCTION clear_deferred_count(
  p_count_id UUID,
  p_user_id  UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE cycle_count_operator_deferred_counts
  SET is_active = false,
      cleared_at = NOW(),
      updated_at = NOW()
  WHERE count_id = p_count_id
    AND user_id = p_user_id
    AND is_active = true;
END;
$$;

COMMIT;
