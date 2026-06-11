-- ============================================================================
-- Migration 236: Warehouse Map Revisions / Publish / Rollback
--   Implements the real revision workflow:
--     - publish_map_revision(p_map_id, p_summary, p_expected_revision)
--         Snapshots current zones, racks, mappings, building outline into
--         warehouse_map_revisions and updates warehouse_maps.active_revision_id.
--     - rollback_map_revision(p_map_id, p_revision_id)
--         Restores state from a previously published revision.
--     - get_map_revisions(p_map_id)
--         Lists revisions with metadata.
-- ============================================================================

-- =========================================================================
-- PART 1: publish_map_revision
-- =========================================================================

CREATE OR REPLACE FUNCTION publish_map_revision(
  p_map_id              UUID,
  p_summary             TEXT,
  p_expected_revision   INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id            UUID;
  v_user_id           UUID;
  v_current_version   INTEGER;
  v_new_version       INTEGER;
  v_new_revision_id   UUID;
  v_snapshot          JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT m.organization_id INTO v_org_id
    FROM warehouse_maps m WHERE m.id = p_map_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Map not found: %', p_map_id;
  END IF;

  -- Optimistic concurrency check
  SELECT COALESCE(MAX(version_number), 0)
    INTO v_current_version
    FROM warehouse_map_revisions
   WHERE map_id = p_map_id AND status = 'published';

  IF p_expected_revision IS NOT NULL AND p_expected_revision <> v_current_version THEN
    RAISE EXCEPTION 'Stale publish — current published revision is %, expected %',
      v_current_version, p_expected_revision
      USING ERRCODE = '40001';
  END IF;

  v_new_version := v_current_version + 1;

  -- Snapshot
  SELECT jsonb_build_object(
    'building_outline', m.building_outline,
    'scale_factor', m.scale_factor,
    'grid_settings', m.grid_settings,
    'canvas_settings', m.canvas_settings,
    'zones', COALESCE((
      SELECT jsonb_agg(row_to_json(z)::jsonb ORDER BY z.sort_order)
        FROM warehouse_zones z WHERE z.map_id = p_map_id
    ), '[]'::jsonb),
    'racks', COALESCE((
      SELECT jsonb_agg(row_to_json(r)::jsonb ORDER BY r.label)
        FROM warehouse_racks r WHERE r.map_id = p_map_id
    ), '[]'::jsonb),
    'mappings', COALESCE((
      SELECT jsonb_agg(row_to_json(wlm)::jsonb ORDER BY wlm.storage_bin)
        FROM warehouse_location_mappings wlm WHERE wlm.map_id = p_map_id
    ), '[]'::jsonb)
  ) INTO v_snapshot
    FROM warehouse_maps m WHERE m.id = p_map_id;

  -- Insert revision
  INSERT INTO warehouse_map_revisions (
    map_id, organization_id, version_number, status, change_summary,
    snapshot_json, created_by, published_by, published_at
  ) VALUES (
    p_map_id, v_org_id, v_new_version, 'published', p_summary,
    v_snapshot, v_user_id, v_user_id, now()
  ) RETURNING id INTO v_new_revision_id;

  -- Activate
  UPDATE warehouse_maps
     SET active_revision_id = v_new_revision_id,
         published_at       = now(),
         published_by       = v_user_id,
         updated_at         = now()
   WHERE id = p_map_id;

  RETURN jsonb_build_object(
    'revision_id',     v_new_revision_id,
    'version_number',  v_new_version,
    'published_at',    now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION publish_map_revision(UUID, TEXT, INTEGER)
  TO authenticated, service_role;

-- =========================================================================
-- PART 2: rollback_map_revision
-- =========================================================================

CREATE OR REPLACE FUNCTION rollback_map_revision(
  p_map_id      UUID,
  p_revision_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id          UUID;
  v_user_id         UUID;
  v_snapshot        JSONB;
  v_zone            JSONB;
  v_rack            JSONB;
  v_mapping         JSONB;
  v_new_revision_id UUID;
  v_current_version INTEGER;
  v_target_version  INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT m.organization_id INTO v_org_id
    FROM warehouse_maps m WHERE m.id = p_map_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Map not found: %', p_map_id;
  END IF;

  SELECT snapshot_json, version_number
    INTO v_snapshot, v_target_version
    FROM warehouse_map_revisions
   WHERE id = p_revision_id AND map_id = p_map_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Revision not found: %', p_revision_id;
  END IF;

  SELECT COALESCE(MAX(version_number), 0)
    INTO v_current_version
    FROM warehouse_map_revisions
   WHERE map_id = p_map_id AND status = 'published';

  -- Restore: clear current state, then reapply snapshot
  DELETE FROM warehouse_location_mappings WHERE map_id = p_map_id;
  DELETE FROM warehouse_racks             WHERE map_id = p_map_id;
  DELETE FROM warehouse_zones             WHERE map_id = p_map_id;

  UPDATE warehouse_maps
     SET building_outline = v_snapshot -> 'building_outline',
         scale_factor     = COALESCE((v_snapshot ->> 'scale_factor')::NUMERIC, scale_factor),
         grid_settings    = COALESCE(v_snapshot -> 'grid_settings', grid_settings),
         canvas_settings  = COALESCE(v_snapshot -> 'canvas_settings', canvas_settings),
         updated_at       = now()
   WHERE id = p_map_id;

  FOR v_zone IN SELECT * FROM jsonb_array_elements(COALESCE(v_snapshot -> 'zones', '[]'::jsonb)) LOOP
    INSERT INTO warehouse_zones (
      id, map_id, organization_id, name, zone_type, polygon, color, opacity,
      floor_level, sort_order
    ) VALUES (
      COALESCE((v_zone ->> 'id')::UUID, gen_random_uuid()),
      p_map_id, v_org_id,
      v_zone ->> 'name',
      COALESCE(v_zone ->> 'zone_type', 'storage'),
      COALESCE(v_zone -> 'polygon', '[]'::jsonb),
      COALESCE(v_zone ->> 'color', '#3B82F6'),
      COALESCE((v_zone ->> 'opacity')::NUMERIC, 0.3),
      COALESCE((v_zone ->> 'floor_level')::INT, 0),
      COALESCE((v_zone ->> 'sort_order')::INT, 0)
    ) ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      zone_type = EXCLUDED.zone_type,
      polygon = EXCLUDED.polygon,
      color = EXCLUDED.color,
      opacity = EXCLUDED.opacity,
      floor_level = EXCLUDED.floor_level,
      sort_order = EXCLUDED.sort_order,
      updated_at = now();
  END LOOP;

  FOR v_rack IN SELECT * FROM jsonb_array_elements(COALESCE(v_snapshot -> 'racks', '[]'::jsonb)) LOOP
    INSERT INTO warehouse_racks (
      id, map_id, zone_id, organization_id, label, rack_type,
      position_x, position_y, rotation, width, height, rows, columns, aisle, metadata
    ) VALUES (
      COALESCE((v_rack ->> 'id')::UUID, gen_random_uuid()),
      p_map_id,
      NULLIF(v_rack ->> 'zone_id', '')::UUID,
      v_org_id,
      v_rack ->> 'label',
      COALESCE(v_rack ->> 'rack_type', 'shelving'),
      COALESCE((v_rack ->> 'position_x')::NUMERIC, 0),
      COALESCE((v_rack ->> 'position_y')::NUMERIC, 0),
      COALESCE((v_rack ->> 'rotation')::NUMERIC, 0),
      COALESCE((v_rack ->> 'width')::NUMERIC, 100),
      COALESCE((v_rack ->> 'height')::NUMERIC, 50),
      COALESCE((v_rack ->> 'rows')::INT, 4),
      COALESCE((v_rack ->> 'columns')::INT, 6),
      v_rack ->> 'aisle',
      v_rack -> 'metadata'
    ) ON CONFLICT (id) DO UPDATE SET
      label = EXCLUDED.label,
      rack_type = EXCLUDED.rack_type,
      position_x = EXCLUDED.position_x,
      position_y = EXCLUDED.position_y,
      rotation = EXCLUDED.rotation,
      width = EXCLUDED.width,
      height = EXCLUDED.height,
      rows = EXCLUDED.rows,
      columns = EXCLUDED.columns,
      aisle = EXCLUDED.aisle,
      zone_id = EXCLUDED.zone_id,
      updated_at = now();
  END LOOP;

  FOR v_mapping IN SELECT * FROM jsonb_array_elements(COALESCE(v_snapshot -> 'mappings', '[]'::jsonb)) LOOP
    INSERT INTO warehouse_location_mappings (
      id, organization_id, map_id, rack_id, warehouse_code, storage_bin,
      rack_row, rack_column, operational_status, status_reason, status_changed_at, status_changed_by, metadata
    ) VALUES (
      COALESCE((v_mapping ->> 'id')::UUID, gen_random_uuid()),
      v_org_id, p_map_id,
      (v_mapping ->> 'rack_id')::UUID,
      v_mapping ->> 'warehouse_code',
      v_mapping ->> 'storage_bin',
      (v_mapping ->> 'rack_row')::INT,
      (v_mapping ->> 'rack_column')::INT,
      (v_mapping ->> 'operational_status')::warehouse_operational_status,
      v_mapping ->> 'status_reason',
      NULLIF(v_mapping ->> 'status_changed_at', '')::TIMESTAMPTZ,
      NULLIF(v_mapping ->> 'status_changed_by', '')::UUID,
      v_mapping -> 'metadata'
    );
  END LOOP;

  -- Insert a new "rolled_back" revision pointing back at the source
  INSERT INTO warehouse_map_revisions (
    map_id, organization_id, version_number, status, change_summary,
    snapshot_json, created_by, published_by, published_at, rolled_back_from_revision_id
  ) VALUES (
    p_map_id, v_org_id, v_current_version + 1, 'published',
    format('Rollback to revision %s', v_target_version),
    v_snapshot, v_user_id, v_user_id, now(), p_revision_id
  ) RETURNING id INTO v_new_revision_id;

  UPDATE warehouse_maps
     SET active_revision_id = v_new_revision_id,
         updated_at         = now()
   WHERE id = p_map_id;

  RETURN jsonb_build_object(
    'revision_id',          v_new_revision_id,
    'version_number',       v_current_version + 1,
    'restored_from',        p_revision_id,
    'restored_version',     v_target_version
  );
END;
$$;

GRANT EXECUTE ON FUNCTION rollback_map_revision(UUID, UUID)
  TO authenticated, service_role;

-- =========================================================================
-- PART 3: get_map_revisions
-- =========================================================================

CREATE OR REPLACE FUNCTION get_map_revisions(p_map_id UUID)
RETURNS TABLE (
  id                            UUID,
  version_number                INTEGER,
  status                        TEXT,
  change_summary                TEXT,
  created_by                    UUID,
  created_at                    TIMESTAMPTZ,
  published_at                  TIMESTAMPTZ,
  rolled_back_from_revision_id  UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.version_number,
    r.status::TEXT,
    r.change_summary,
    r.created_by,
    r.created_at,
    r.published_at,
    r.rolled_back_from_revision_id
  FROM warehouse_map_revisions r
  WHERE r.map_id = p_map_id
  ORDER BY r.version_number DESC;
$$;

GRANT EXECUTE ON FUNCTION get_map_revisions(UUID) TO authenticated, service_role;
