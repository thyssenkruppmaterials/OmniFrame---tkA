-- ============================================================================
-- Migration 235: Warehouse Map Phase A Fixes
--   1. Add warehouse_location_mappings + auto_map_runs to supabase_realtime publication
--   2. Add get_windowed_location_details RPC (called from frontend, was missing)
--   3. Add get_warehouse_map_diagnostics RPC
--   4. Add a default warehouse_map_settings row inserter (org-init helper)
-- ============================================================================

-- =========================================================================
-- PART 1: Realtime publication
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'warehouse_location_mappings'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE warehouse_location_mappings';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'warehouse_auto_map_runs'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE warehouse_auto_map_runs';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'warehouse_location_status_log'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE warehouse_location_status_log';
  END IF;
END $$;

-- =========================================================================
-- PART 2: get_windowed_location_details
--   Returns enriched per-mapping rows for a list of mapping ids OR a viewport
--   bounds box. Includes occupancy, freshness, MLGT, and stock.
-- =========================================================================

CREATE OR REPLACE FUNCTION get_windowed_location_details(
  p_map_id        UUID,
  p_mapping_ids   UUID[]   DEFAULT NULL,
  p_min_x         NUMERIC  DEFAULT NULL,
  p_min_y         NUMERIC  DEFAULT NULL,
  p_max_x         NUMERIC  DEFAULT NULL,
  p_max_y         NUMERIC  DEFAULT NULL,
  p_limit         INT      DEFAULT 2000
)
RETURNS TABLE (
  mapping_id          UUID,
  storage_bin         TEXT,
  rack_id             UUID,
  rack_row            INT,
  rack_column         INT,
  operational_status  TEXT,
  occupancy_state     TEXT,
  freshness_state     TEXT,
  last_lx03_seen_at   TIMESTAMPTZ,
  material_summary    TEXT,
  total_stock         NUMERIC,
  available_stock     NUMERIC,
  mlgt_match_status   TEXT,
  mlgt_height         NUMERIC,
  mlgt_width          NUMERIC,
  mlgt_length         NUMERIC,
  mlgt_max_quantity   NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wh_code         VARCHAR(50);
  v_org_id          UUID;
  v_stale_minutes   INT;
BEGIN
  SELECT m.warehouse_code, m.organization_id
    INTO v_wh_code, v_org_id
    FROM warehouse_maps m
   WHERE m.id = p_map_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Map not found: %', p_map_id;
  END IF;

  SELECT COALESCE(s.stale_after_minutes, 120)
    INTO v_stale_minutes
    FROM warehouse_map_settings s
   WHERE s.organization_id = v_org_id;

  RETURN QUERY
  WITH viewport_racks AS (
    SELECT r.id
      FROM warehouse_racks r
     WHERE r.map_id = p_map_id
       AND (
         p_min_x IS NULL OR (
           r.position_x + r.width  >= p_min_x AND r.position_x <= p_max_x AND
           r.position_y + r.height >= p_min_y AND r.position_y <= p_max_y
         )
       )
  ),
  base AS (
    SELECT wlm.*
      FROM warehouse_location_mappings wlm
     WHERE wlm.map_id = p_map_id
       AND (
         p_mapping_ids IS NULL
         OR wlm.id = ANY(p_mapping_ids)
       )
       AND (
         p_min_x IS NULL
         OR wlm.rack_id IN (SELECT vr.id FROM viewport_racks vr)
       )
     LIMIT p_limit
  )
  SELECT
    b.id                                             AS mapping_id,
    b.storage_bin::TEXT                              AS storage_bin,
    b.rack_id                                        AS rack_id,
    b.rack_row                                       AS rack_row,
    b.rack_column                                    AS rack_column,
    b.operational_status::TEXT                       AS operational_status,
    CASE
      WHEN lx.material IS NULL OR lx.material = '<<empty>>' THEN 'empty'
      WHEN COALESCE(lx.total_stock, 0) > 0 THEN 'occupied'
      ELSE 'unknown'
    END                                              AS occupancy_state,
    CASE
      WHEN lx.updated_at IS NULL THEN 'unavailable'
      WHEN lx.updated_at >= now() - make_interval(mins => v_stale_minutes) THEN 'fresh'
      ELSE 'stale'
    END                                              AS freshness_state,
    lx.updated_at                                    AS last_lx03_seen_at,
    lx.material::TEXT                                AS material_summary,
    lx.total_stock                                   AS total_stock,
    lx.available_stock                               AS available_stock,
    CASE
      WHEN mlgt_count.cnt = 0 THEN 'missing'
      WHEN mlgt_count.cnt > 1 THEN 'ambiguous'
      ELSE 'matched'
    END                                              AS mlgt_match_status,
    mlgt_match.height                                AS mlgt_height,
    mlgt_match.width                                 AS mlgt_width,
    mlgt_match.length                                AS mlgt_length,
    mlgt_match.max_quantity                          AS mlgt_max_quantity
  FROM base b
  LEFT JOIN LATERAL (
    SELECT lx.material, lx.total_stock, lx.available_stock, lx.updated_at
      FROM rr_lx03_data lx
     WHERE lx.warehouse = v_wh_code
       AND lx.storage_bin = b.storage_bin
     ORDER BY lx.updated_at DESC
     LIMIT 1
  ) lx ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
      FROM rr_mlgt_data mg
     WHERE mg.storage_bin = b.storage_bin
  ) mlgt_count ON true
  LEFT JOIN LATERAL (
    SELECT mg.height, mg.width, mg.length, mg.max_quantity
      FROM rr_mlgt_data mg
     WHERE mg.storage_bin = b.storage_bin
     LIMIT 1
  ) mlgt_match ON true;
END;
$$;

GRANT EXECUTE ON FUNCTION get_windowed_location_details(UUID, UUID[], NUMERIC, NUMERIC, NUMERIC, NUMERIC, INT)
  TO authenticated, service_role;

-- =========================================================================
-- PART 3: get_warehouse_map_diagnostics
-- =========================================================================

CREATE OR REPLACE FUNCTION get_warehouse_map_diagnostics(p_map_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wh_code        VARCHAR(50);
  v_org_id         UUID;
  v_stale_minutes  INT;
  v_result         JSONB;
BEGIN
  SELECT m.warehouse_code, m.organization_id
    INTO v_wh_code, v_org_id
    FROM warehouse_maps m
   WHERE m.id = p_map_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Map not found: %', p_map_id;
  END IF;

  SELECT COALESCE(s.stale_after_minutes, 120)
    INTO v_stale_minutes
    FROM warehouse_map_settings s
   WHERE s.organization_id = v_org_id;

  SELECT jsonb_build_object(
    'unmapped_bins', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'storage_bin', lx.storage_bin,
        'storage_area', categorize_storage_area(lx.storage_bin),
        'material', lx.material,
        'total_stock', COALESCE(lx.total_stock, 0),
        'occupancy_state', CASE WHEN COALESCE(lx.total_stock, 0) > 0 THEN 'occupied' ELSE 'empty' END
      ) ORDER BY lx.storage_bin)
      FROM (
        SELECT DISTINCT ON (lx.storage_bin) lx.storage_bin, lx.material, lx.total_stock
          FROM rr_lx03_data lx
          LEFT JOIN warehouse_location_mappings wlm
            ON wlm.storage_bin = lx.storage_bin
           AND wlm.map_id = p_map_id
         WHERE lx.warehouse = v_wh_code
           AND wlm.id IS NULL
           AND lx.storage_bin IS NOT NULL
         ORDER BY lx.storage_bin, lx.updated_at DESC
         LIMIT 500
      ) lx
    ), '[]'::jsonb),

    'orphaned_mappings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'mapping_id', wlm.id,
        'storage_bin', wlm.storage_bin,
        'rack_id', wlm.rack_id,
        'rack_label', r.label
      ) ORDER BY wlm.storage_bin)
      FROM warehouse_location_mappings wlm
      JOIN warehouse_racks r ON r.id = wlm.rack_id
      LEFT JOIN rr_lx03_data lx
        ON lx.storage_bin = wlm.storage_bin
       AND lx.warehouse = v_wh_code
     WHERE wlm.map_id = p_map_id
       AND lx.storage_bin IS NULL
    ), '[]'::jsonb),

    'stale_bins', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'storage_bin', wlm.storage_bin,
        'last_lx03_seen_at', last_seen.last_seen,
        'minutes_since_sync',
          EXTRACT(EPOCH FROM (now() - last_seen.last_seen))::INT / 60
      ) ORDER BY last_seen.last_seen ASC)
      FROM warehouse_location_mappings wlm
      JOIN LATERAL (
        SELECT MAX(lx.updated_at) AS last_seen
          FROM rr_lx03_data lx
         WHERE lx.storage_bin = wlm.storage_bin
           AND lx.warehouse = v_wh_code
      ) last_seen ON true
     WHERE wlm.map_id = p_map_id
       AND last_seen.last_seen IS NOT NULL
       AND last_seen.last_seen < now() - make_interval(mins => v_stale_minutes)
     LIMIT 500
    ), '[]'::jsonb),

    'ambiguous_mlgt_matches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'storage_bin', sub.storage_bin,
        'match_count', sub.cnt,
        'matched_warehouse_numbers', sub.warehouses
      ))
      FROM (
        SELECT
          mg.storage_bin,
          COUNT(*) AS cnt,
          jsonb_agg(DISTINCT mg.warehouse) AS warehouses
          FROM rr_mlgt_data mg
          JOIN warehouse_location_mappings wlm
            ON wlm.storage_bin = mg.storage_bin
           AND wlm.map_id = p_map_id
         GROUP BY mg.storage_bin
        HAVING COUNT(*) > 1
         LIMIT 200
      ) sub
    ), '[]'::jsonb),

    'duplicate_rack_labels', COALESCE((
      SELECT jsonb_agg(label)
      FROM (
        SELECT label
          FROM warehouse_racks
         WHERE map_id = p_map_id
         GROUP BY label
        HAVING COUNT(*) > 1
      ) sub
    ), '[]'::jsonb),

    'pending_auto_map_warnings', COALESCE((
      SELECT jsonb_agg(warning)
      FROM (
        SELECT jsonb_array_elements_text(warnings) AS warning
          FROM warehouse_auto_map_runs
         WHERE map_id = p_map_id
           AND status IN ('queued', 'running', 'awaiting_review', 'failed')
         ORDER BY started_at DESC
         LIMIT 50
      ) w
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION get_warehouse_map_diagnostics(UUID) TO authenticated, service_role;

-- =========================================================================
-- PART 4: ensure_warehouse_map_settings (initialize a row per org)
-- =========================================================================

CREATE OR REPLACE FUNCTION ensure_warehouse_map_settings()
RETURNS warehouse_map_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id  UUID;
  v_user_id UUID;
  v_row     warehouse_map_settings;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID
    INTO v_org_id;

  IF v_org_id IS NULL THEN
    SELECT organization_id INTO v_org_id
      FROM user_profiles WHERE id = v_user_id;
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization for user';
  END IF;

  SELECT * INTO v_row
    FROM warehouse_map_settings
   WHERE organization_id = v_org_id;

  IF NOT FOUND THEN
    INSERT INTO warehouse_map_settings (
      organization_id,
      enabled,
      read_only_mode,
      live_updates_enabled,
      allow_layout_edits,
      allow_status_changes,
      show_3d_viewer,
      fallback_mode,
      stale_after_minutes,
      updated_by
    ) VALUES (
      v_org_id, true, false, true, true, true, true, 'map', 120, v_user_id
    ) RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_warehouse_map_settings() TO authenticated;
