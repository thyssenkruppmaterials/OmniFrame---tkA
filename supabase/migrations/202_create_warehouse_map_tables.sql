-- ============================================================================
-- Migration 202: Create Warehouse Map Tables
-- Description: Full schema for the warehouse-map feature — tables, enums, RLS,
--              indexes, RPC functions, permissions, storage bucket, and triggers.
-- ============================================================================

-- =========================================================================
-- PART 1: Enums
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'warehouse_operational_status') THEN
    CREATE TYPE warehouse_operational_status AS ENUM ('active', 'maintenance', 'shutdown', 'reserved', 'blocked');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'warehouse_revision_status') THEN
    CREATE TYPE warehouse_revision_status AS ENUM ('draft', 'published', 'archived', 'rolled_back');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'warehouse_auto_map_status') THEN
    CREATE TYPE warehouse_auto_map_status AS ENUM ('queued', 'running', 'awaiting_review', 'applied', 'failed', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'warehouse_fallback_mode') THEN
    CREATE TYPE warehouse_fallback_mode AS ENUM ('placeholder', 'list', 'map');
  END IF;
END $$;

-- =========================================================================
-- PART 2: Tables
-- =========================================================================

CREATE TABLE IF NOT EXISTS warehouse_map_settings (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  enabled                BOOLEAN NOT NULL DEFAULT false,
  read_only_mode         BOOLEAN NOT NULL DEFAULT true,
  live_updates_enabled   BOOLEAN NOT NULL DEFAULT false,
  allow_layout_edits     BOOLEAN NOT NULL DEFAULT false,
  allow_status_changes   BOOLEAN NOT NULL DEFAULT false,
  show_3d_viewer         BOOLEAN NOT NULL DEFAULT true,
  fallback_mode          warehouse_fallback_mode NOT NULL DEFAULT 'placeholder',
  stale_after_minutes    INTEGER NOT NULL DEFAULT 120,
  default_warehouse_code VARCHAR(50),
  updated_by             UUID REFERENCES user_profiles(id),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouse_maps (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_code              VARCHAR(50) NOT NULL,
  name                        VARCHAR(255) NOT NULL,
  is_default                  BOOLEAN NOT NULL DEFAULT false,
  scale_factor                NUMERIC NOT NULL DEFAULT 1.0,
  grid_settings               JSONB NOT NULL DEFAULT '{"size": 1, "snap": true, "visible": true}',
  canvas_settings             JSONB NOT NULL DEFAULT '{}',
  building_outline            JSONB,
  active_revision_id          UUID,
  active_background_asset_id  UUID,
  published_at                TIMESTAMPTZ,
  published_by                UUID REFERENCES user_profiles(id),
  created_by                  UUID REFERENCES user_profiles(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, warehouse_code)
);

CREATE TABLE IF NOT EXISTS warehouse_map_revisions (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id                     UUID NOT NULL REFERENCES warehouse_maps(id) ON DELETE CASCADE,
  organization_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_number             INTEGER NOT NULL DEFAULT 1,
  status                     warehouse_revision_status NOT NULL DEFAULT 'draft',
  change_summary             TEXT,
  snapshot_json              JSONB NOT NULL DEFAULT '{}',
  created_by                 UUID REFERENCES user_profiles(id),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by               UUID REFERENCES user_profiles(id),
  published_at               TIMESTAMPTZ,
  rolled_back_from_revision_id UUID REFERENCES warehouse_map_revisions(id)
);

CREATE TABLE IF NOT EXISTS warehouse_map_background_assets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id           UUID NOT NULL REFERENCES warehouse_maps(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  storage_path     TEXT NOT NULL,
  content_hash     VARCHAR(64),
  version_number   INTEGER NOT NULL DEFAULT 1,
  mime_type        VARCHAR(50) NOT NULL DEFAULT 'image/png',
  width            INTEGER,
  height           INTEGER,
  file_size_bytes  BIGINT,
  is_active        BOOLEAN NOT NULL DEFAULT false,
  uploaded_by      UUID REFERENCES user_profiles(id),
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS warehouse_zones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id           UUID NOT NULL REFERENCES warehouse_maps(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  zone_type        VARCHAR(50) NOT NULL DEFAULT 'storage',
  polygon          JSONB NOT NULL DEFAULT '[]',
  color            VARCHAR(7) NOT NULL DEFAULT '#3B82F6',
  opacity          NUMERIC NOT NULL DEFAULT 0.3,
  floor_level      INTEGER NOT NULL DEFAULT 0,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouse_racks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id           UUID NOT NULL REFERENCES warehouse_maps(id) ON DELETE CASCADE,
  zone_id          UUID REFERENCES warehouse_zones(id) ON DELETE SET NULL,
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label            VARCHAR(100) NOT NULL,
  rack_type        VARCHAR(50) NOT NULL DEFAULT 'shelving',
  position_x       NUMERIC NOT NULL DEFAULT 0,
  position_y       NUMERIC NOT NULL DEFAULT 0,
  rotation         NUMERIC NOT NULL DEFAULT 0,
  width            NUMERIC NOT NULL DEFAULT 100,
  height           NUMERIC NOT NULL DEFAULT 50,
  rows             INTEGER NOT NULL DEFAULT 4,
  columns          INTEGER NOT NULL DEFAULT 6,
  aisle            VARCHAR(50),
  metadata         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouse_location_mappings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  map_id              UUID NOT NULL REFERENCES warehouse_maps(id) ON DELETE CASCADE,
  rack_id             UUID NOT NULL REFERENCES warehouse_racks(id) ON DELETE CASCADE,
  warehouse_code      VARCHAR(50) NOT NULL,
  storage_bin         VARCHAR(100) NOT NULL,
  rack_row            INTEGER NOT NULL,
  rack_column         INTEGER NOT NULL,
  operational_status  warehouse_operational_status NOT NULL DEFAULT 'active',
  status_reason       TEXT,
  status_changed_at   TIMESTAMPTZ,
  status_changed_by   UUID REFERENCES user_profiles(id),
  metadata            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(map_id, storage_bin),
  UNIQUE(rack_id, rack_row, rack_column)
);

CREATE TABLE IF NOT EXISTS warehouse_location_status_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_id       UUID NOT NULL REFERENCES warehouse_location_mappings(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  old_status       warehouse_operational_status,
  new_status       warehouse_operational_status NOT NULL,
  reason           TEXT,
  changed_by       UUID NOT NULL REFERENCES user_profiles(id),
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouse_auto_map_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id                UUID NOT NULL REFERENCES warehouse_maps(id) ON DELETE CASCADE,
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_code        VARCHAR(50) NOT NULL,
  status                warehouse_auto_map_status NOT NULL DEFAULT 'queued',
  requested_area        VARCHAR(50),
  requested_by          UUID REFERENCES user_profiles(id),
  proposed_assignments  JSONB NOT NULL DEFAULT '[]',
  applied_assignments   JSONB NOT NULL DEFAULT '[]',
  conflicts             JSONB NOT NULL DEFAULT '[]',
  warnings              JSONB NOT NULL DEFAULT '[]',
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  error_message         TEXT
);

-- =========================================================================
-- PART 3: Row Level Security
-- =========================================================================

ALTER TABLE warehouse_map_settings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_maps                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_map_revisions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_map_background_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_zones                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_racks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_location_mappings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_location_status_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_auto_map_runs         ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- PART 4: RLS Policies
-- =========================================================================

-- warehouse_map_settings
CREATE POLICY warehouse_map_settings_select_org ON warehouse_map_settings FOR SELECT
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_map_settings_insert_org ON warehouse_map_settings FOR INSERT
  WITH CHECK (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_map_settings_update_org ON warehouse_map_settings FOR UPDATE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_map_settings_delete_org ON warehouse_map_settings FOR DELETE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

-- warehouse_maps
CREATE POLICY warehouse_maps_select_org ON warehouse_maps FOR SELECT
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_maps_insert_org ON warehouse_maps FOR INSERT
  WITH CHECK (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_maps_update_org ON warehouse_maps FOR UPDATE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_maps_delete_org ON warehouse_maps FOR DELETE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

-- warehouse_map_revisions
CREATE POLICY warehouse_map_revisions_select_org ON warehouse_map_revisions FOR SELECT
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_map_revisions_insert_org ON warehouse_map_revisions FOR INSERT
  WITH CHECK (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_map_revisions_update_org ON warehouse_map_revisions FOR UPDATE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_map_revisions_delete_org ON warehouse_map_revisions FOR DELETE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

-- warehouse_map_background_assets
CREATE POLICY warehouse_map_background_assets_select_org ON warehouse_map_background_assets FOR SELECT
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_map_background_assets_insert_org ON warehouse_map_background_assets FOR INSERT
  WITH CHECK (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_map_background_assets_update_org ON warehouse_map_background_assets FOR UPDATE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_map_background_assets_delete_org ON warehouse_map_background_assets FOR DELETE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

-- warehouse_zones
CREATE POLICY warehouse_zones_select_org ON warehouse_zones FOR SELECT
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_zones_insert_org ON warehouse_zones FOR INSERT
  WITH CHECK (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_zones_update_org ON warehouse_zones FOR UPDATE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_zones_delete_org ON warehouse_zones FOR DELETE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

-- warehouse_racks
CREATE POLICY warehouse_racks_select_org ON warehouse_racks FOR SELECT
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_racks_insert_org ON warehouse_racks FOR INSERT
  WITH CHECK (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_racks_update_org ON warehouse_racks FOR UPDATE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_racks_delete_org ON warehouse_racks FOR DELETE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

-- warehouse_location_mappings
CREATE POLICY warehouse_location_mappings_select_org ON warehouse_location_mappings FOR SELECT
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_location_mappings_insert_org ON warehouse_location_mappings FOR INSERT
  WITH CHECK (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_location_mappings_update_org ON warehouse_location_mappings FOR UPDATE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_location_mappings_delete_org ON warehouse_location_mappings FOR DELETE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

-- warehouse_location_status_log
CREATE POLICY warehouse_location_status_log_select_org ON warehouse_location_status_log FOR SELECT
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_location_status_log_insert_org ON warehouse_location_status_log FOR INSERT
  WITH CHECK (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_location_status_log_update_org ON warehouse_location_status_log FOR UPDATE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_location_status_log_delete_org ON warehouse_location_status_log FOR DELETE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

-- warehouse_auto_map_runs
CREATE POLICY warehouse_auto_map_runs_select_org ON warehouse_auto_map_runs FOR SELECT
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_auto_map_runs_insert_org ON warehouse_auto_map_runs FOR INSERT
  WITH CHECK (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_auto_map_runs_update_org ON warehouse_auto_map_runs FOR UPDATE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_auto_map_runs_delete_org ON warehouse_auto_map_runs FOR DELETE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

-- =========================================================================
-- PART 5: Indexes
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_warehouse_maps_org_code
  ON warehouse_maps (organization_id, warehouse_code);
CREATE INDEX IF NOT EXISTS idx_warehouse_maps_org_default
  ON warehouse_maps (organization_id, is_default);

CREATE INDEX IF NOT EXISTS idx_warehouse_map_revisions_map_version
  ON warehouse_map_revisions (map_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_warehouse_map_revisions_map_status
  ON warehouse_map_revisions (map_id, status);

CREATE INDEX IF NOT EXISTS idx_warehouse_map_bg_assets_map_active
  ON warehouse_map_background_assets (map_id, is_active);
CREATE INDEX IF NOT EXISTS idx_warehouse_map_bg_assets_org
  ON warehouse_map_background_assets (organization_id);

CREATE INDEX IF NOT EXISTS idx_warehouse_zones_map
  ON warehouse_zones (map_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_zones_org
  ON warehouse_zones (organization_id);

CREATE INDEX IF NOT EXISTS idx_warehouse_racks_map
  ON warehouse_racks (map_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_racks_zone
  ON warehouse_racks (zone_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_racks_org
  ON warehouse_racks (organization_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_racks_aisle
  ON warehouse_racks (aisle);

CREATE INDEX IF NOT EXISTS idx_warehouse_loc_map_bin
  ON warehouse_location_mappings (map_id, storage_bin);
CREATE INDEX IF NOT EXISTS idx_warehouse_loc_rack
  ON warehouse_location_mappings (rack_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_loc_org_code
  ON warehouse_location_mappings (organization_id, warehouse_code);
CREATE INDEX IF NOT EXISTS idx_warehouse_loc_map_status
  ON warehouse_location_mappings (map_id, operational_status);

CREATE INDEX IF NOT EXISTS idx_warehouse_status_log_mapping
  ON warehouse_location_status_log (mapping_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_status_log_org_changed
  ON warehouse_location_status_log (organization_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_warehouse_auto_map_runs_map_started
  ON warehouse_auto_map_runs (map_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_warehouse_auto_map_runs_org_status
  ON warehouse_auto_map_runs (organization_id, status);

-- =========================================================================
-- PART 6: Deferred Foreign Keys on warehouse_maps
-- =========================================================================

ALTER TABLE warehouse_maps
  ADD CONSTRAINT fk_active_revision
  FOREIGN KEY (active_revision_id)
  REFERENCES warehouse_map_revisions(id) ON DELETE SET NULL;

ALTER TABLE warehouse_maps
  ADD CONSTRAINT fk_active_background
  FOREIGN KEY (active_background_asset_id)
  REFERENCES warehouse_map_background_assets(id) ON DELETE SET NULL;

-- =========================================================================
-- PART 7: Permission Category & Permissions
-- =========================================================================

DO $$
DECLARE
  v_cat_id UUID;
BEGIN
  INSERT INTO permission_categories (name, display_name, description, icon, order_index, is_active)
  VALUES ('warehouse_map_management', 'Warehouse Map Management', 'Manage warehouse location maps and layouts', 'Map', 20, true)
  ON CONFLICT (name) DO NOTHING;

  SELECT id INTO v_cat_id FROM permission_categories WHERE name = 'warehouse_map_management';

  INSERT INTO permissions (name, resource, action, description, category_id, scope, risk_level)
  VALUES
    ('warehouse_maps.view',   'warehouse_maps', 'read',   'View warehouse map and locations',                v_cat_id, 'organization', 'low'),
    ('warehouse_maps.create', 'warehouse_maps', 'create', 'Create new warehouse maps',                      v_cat_id, 'organization', 'medium'),
    ('warehouse_maps.update', 'warehouse_maps', 'update', 'Edit building shape, zones, racks',               v_cat_id, 'organization', 'medium'),
    ('warehouse_maps.delete', 'warehouse_maps', 'delete', 'Delete maps, zones, racks',                      v_cat_id, 'organization', 'high'),
    ('warehouse_maps.manage', 'warehouse_maps', 'manage', 'Full management: status changes, bulk operations', v_cat_id, 'organization', 'high')
  ON CONFLICT (name) DO NOTHING;
END $$;

-- =========================================================================
-- PART 8: Role Permission Seeding
-- =========================================================================

DO $$
DECLARE
  v_perm_view   UUID;
  v_perm_create UUID;
  v_perm_update UUID;
  v_perm_delete UUID;
  v_perm_manage UUID;
  v_role        RECORD;
BEGIN
  SELECT id INTO v_perm_view   FROM permissions WHERE name = 'warehouse_maps.view';
  SELECT id INTO v_perm_create FROM permissions WHERE name = 'warehouse_maps.create';
  SELECT id INTO v_perm_update FROM permissions WHERE name = 'warehouse_maps.update';
  SELECT id INTO v_perm_delete FROM permissions WHERE name = 'warehouse_maps.delete';
  SELECT id INTO v_perm_manage FROM permissions WHERE name = 'warehouse_maps.manage';

  FOR v_role IN SELECT id FROM roles WHERE name IN ('superadmin', 'admin') LOOP
    INSERT INTO role_permissions (role_id, permission_id)
    VALUES
      (v_role.id, v_perm_view),
      (v_role.id, v_perm_create),
      (v_role.id, v_perm_update),
      (v_role.id, v_perm_delete),
      (v_role.id, v_perm_manage)
    ON CONFLICT DO NOTHING;
  END LOOP;

  FOR v_role IN SELECT id FROM roles WHERE name = 'manager' LOOP
    INSERT INTO role_permissions (role_id, permission_id)
    VALUES (v_role.id, v_perm_view)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- =========================================================================
-- PART 9: RPC Functions
-- =========================================================================

-- 9a. get_warehouse_map_layout
CREATE OR REPLACE FUNCTION get_warehouse_map_layout(p_map_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_map    RECORD;
BEGIN
  SELECT * INTO v_map FROM warehouse_maps WHERE id = p_map_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Map not found: %', p_map_id;
  END IF;

  SELECT jsonb_build_object(
    'map', row_to_json(m)::jsonb,
    'settings', (
      SELECT row_to_json(s)::jsonb
      FROM warehouse_map_settings s
      WHERE s.organization_id = m.organization_id
    ),
    'zones', COALESCE((
      SELECT jsonb_agg(row_to_json(z)::jsonb ORDER BY z.sort_order)
      FROM warehouse_zones z
      WHERE z.map_id = m.id
    ), '[]'::jsonb),
    'racks', COALESCE((
      SELECT jsonb_agg(row_to_json(r)::jsonb ORDER BY r.label)
      FROM warehouse_racks r
      WHERE r.map_id = m.id
    ), '[]'::jsonb),
    'active_background', (
      SELECT row_to_json(ba)::jsonb
      FROM warehouse_map_background_assets ba
      WHERE ba.id = m.active_background_asset_id
    ),
    'current_revision_number', COALESCE((
      SELECT MAX(rev.version_number)
      FROM warehouse_map_revisions rev
      WHERE rev.map_id = m.id AND rev.status = 'published'
    ), 0)
  ) INTO v_result
  FROM warehouse_maps m
  WHERE m.id = p_map_id;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- 9b. update_location_operational_status (optimistic concurrency)
CREATE OR REPLACE FUNCTION update_location_operational_status(
  p_mapping_id         UUID,
  p_new_status         warehouse_operational_status,
  p_reason             TEXT,
  p_changed_by         UUID,
  p_expected_updated_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status  warehouse_operational_status;
  v_current_ts  TIMESTAMPTZ;
  v_org_id      UUID;
  v_result      JSONB;
BEGIN
  SELECT operational_status, updated_at, organization_id
    INTO v_old_status, v_current_ts, v_org_id
    FROM warehouse_location_mappings
   WHERE id = p_mapping_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mapping not found: %', p_mapping_id;
  END IF;

  IF v_current_ts <> p_expected_updated_at THEN
    RAISE EXCEPTION 'Stale update — record was modified at %. Expected %.', v_current_ts, p_expected_updated_at;
  END IF;

  UPDATE warehouse_location_mappings
     SET operational_status = p_new_status,
         status_reason      = p_reason,
         status_changed_at  = now(),
         status_changed_by  = p_changed_by,
         updated_at         = now()
   WHERE id = p_mapping_id;

  INSERT INTO warehouse_location_status_log (mapping_id, organization_id, old_status, new_status, reason, changed_by)
  VALUES (p_mapping_id, v_org_id, v_old_status, p_new_status, p_reason, p_changed_by);

  SELECT row_to_json(wlm)::jsonb INTO v_result
    FROM warehouse_location_mappings wlm
   WHERE wlm.id = p_mapping_id;

  RETURN v_result;
END;
$$;

-- 9c. get_warehouse_map_statistics
CREATE OR REPLACE FUNCTION get_warehouse_map_statistics(p_map_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wh_code       VARCHAR(50);
  v_org_id        UUID;
  v_total_mapped  BIGINT;
  v_total_lx03    BIGINT;
  v_result        JSONB;
BEGIN
  SELECT warehouse_code, organization_id
    INTO v_wh_code, v_org_id
    FROM warehouse_maps
   WHERE id = p_map_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Map not found: %', p_map_id;
  END IF;

  SELECT COUNT(*) INTO v_total_mapped
    FROM warehouse_location_mappings
   WHERE map_id = p_map_id;

  SELECT COUNT(DISTINCT storage_bin) INTO v_total_lx03
    FROM rr_lx03_data
   WHERE warehouse = v_wh_code
     AND storage_bin IS NOT NULL;

  SELECT jsonb_build_object(
    'counts_by_status', COALESCE((
      SELECT jsonb_object_agg(operational_status::text, cnt)
      FROM (
        SELECT operational_status, COUNT(*) AS cnt
          FROM warehouse_location_mappings
         WHERE map_id = p_map_id
         GROUP BY operational_status
      ) sub
    ), '{}'::jsonb),
    'occupied_bins', (
      SELECT COUNT(DISTINCT wlm.storage_bin)
        FROM warehouse_location_mappings wlm
        JOIN rr_lx03_data lx ON lx.storage_bin = wlm.storage_bin
                             AND lx.warehouse = v_wh_code
                             AND lx.material <> '<<empty>>'
                             AND lx.total_stock > 0
       WHERE wlm.map_id = p_map_id
    ),
    'total_mapped_bins', v_total_mapped,
    'utilization_pct', CASE
      WHEN v_total_mapped = 0 THEN 0
      ELSE ROUND(
        (SELECT COUNT(DISTINCT wlm.storage_bin)
           FROM warehouse_location_mappings wlm
           JOIN rr_lx03_data lx ON lx.storage_bin = wlm.storage_bin
                                AND lx.warehouse = v_wh_code
                                AND lx.material <> '<<empty>>'
                                AND lx.total_stock > 0
          WHERE wlm.map_id = p_map_id
        )::numeric / v_total_mapped * 100, 1)
    END,
    'unmapped_bins', GREATEST(v_total_lx03 - v_total_mapped, 0),
    'last_lx03_sync', (
      SELECT MAX(lx.updated_at)
        FROM rr_lx03_data lx
       WHERE lx.warehouse = v_wh_code
    )
  ) INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- 9d. get_unassigned_bins
CREATE OR REPLACE FUNCTION get_unassigned_bins(
  p_map_id              UUID,
  p_storage_area_filter TEXT    DEFAULT NULL,
  p_search              TEXT    DEFAULT NULL,
  p_limit               INT    DEFAULT 200
)
RETURNS TABLE (
  storage_bin   TEXT,
  storage_area  TEXT,
  material      TEXT,
  total_stock   NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wh_code VARCHAR(50);
BEGIN
  SELECT warehouse_code INTO v_wh_code
    FROM warehouse_maps
   WHERE id = p_map_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Map not found: %', p_map_id;
  END IF;

  RETURN QUERY
  SELECT
    lx.storage_bin,
    categorize_storage_area(lx.storage_bin) AS storage_area,
    lx.material,
    COALESCE(lx.total_stock, 0) AS total_stock
  FROM rr_lx03_data lx
  LEFT JOIN warehouse_location_mappings wlm
    ON wlm.storage_bin = lx.storage_bin
   AND wlm.map_id = p_map_id
  WHERE lx.warehouse = v_wh_code
    AND lx.storage_bin IS NOT NULL
    AND wlm.id IS NULL
    AND (p_storage_area_filter IS NULL OR categorize_storage_area(lx.storage_bin) = p_storage_area_filter)
    AND (p_search IS NULL OR lx.storage_bin ILIKE '%' || p_search || '%')
  GROUP BY lx.storage_bin, lx.material, lx.total_stock
  ORDER BY lx.storage_bin
  LIMIT p_limit;
END;
$$;

-- 9e. bulk_assign_locations
CREATE OR REPLACE FUNCTION bulk_assign_locations(
  p_rack_id         UUID,
  p_assignments     JSONB,
  p_organization_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_map_id         UUID;
  v_warehouse_code VARCHAR(50);
  v_item           JSONB;
  v_count          INTEGER := 0;
BEGIN
  SELECT r.map_id, m.warehouse_code
    INTO v_map_id, v_warehouse_code
    FROM warehouse_racks r
    JOIN warehouse_maps m ON m.id = r.map_id
   WHERE r.id = p_rack_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rack not found: %', p_rack_id;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_assignments)
  LOOP
    INSERT INTO warehouse_location_mappings (
      organization_id, map_id, rack_id, warehouse_code,
      storage_bin, rack_row, rack_column
    ) VALUES (
      p_organization_id,
      v_map_id,
      p_rack_id,
      v_warehouse_code,
      v_item ->> 'storage_bin',
      (v_item ->> 'rack_row')::INTEGER,
      (v_item ->> 'rack_column')::INTEGER
    )
    ON CONFLICT DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- =========================================================================
-- PART 10: Storage Bucket
-- =========================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('warehouse-map-backgrounds', 'warehouse-map-backgrounds', false, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- PART 11: Triggers (updated_at)
-- =========================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_warehouse_maps_updated_at
  BEFORE UPDATE ON warehouse_maps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_warehouse_zones_updated_at
  BEFORE UPDATE ON warehouse_zones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_warehouse_racks_updated_at
  BEFORE UPDATE ON warehouse_racks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_warehouse_location_mappings_updated_at
  BEFORE UPDATE ON warehouse_location_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================================
-- PART 12: Table Comments
-- =========================================================================

COMMENT ON TABLE warehouse_map_settings          IS 'Per-org rollout gate and feature flags for the warehouse map feature';
COMMENT ON TABLE warehouse_maps                  IS 'Top-level warehouse map, one per warehouse_code per organization';
COMMENT ON TABLE warehouse_map_revisions         IS 'Versioned snapshots of a warehouse map layout for publish/rollback';
COMMENT ON TABLE warehouse_map_background_assets IS 'Uploaded floor-plan images used as map backgrounds';
COMMENT ON TABLE warehouse_zones                 IS 'Polygonal zones drawn on a warehouse map (storage, shipping, staging, etc.)';
COMMENT ON TABLE warehouse_racks                 IS 'Individual rack/shelving units placed on the map canvas';
COMMENT ON TABLE warehouse_location_mappings     IS 'Links SAP storage bins to rack cells (row, column) on the map';
COMMENT ON TABLE warehouse_location_status_log   IS 'Audit trail of operational-status changes on location mappings';
COMMENT ON TABLE warehouse_auto_map_runs         IS 'Auto-map job runs that propose and apply bin-to-rack assignments';

-- =========================================================================
-- PART 13: Grant Execute on Functions
-- =========================================================================

GRANT EXECUTE ON FUNCTION get_warehouse_map_layout(UUID)                                                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_location_operational_status(UUID, warehouse_operational_status, TEXT, UUID, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_warehouse_map_statistics(UUID)                                                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_unassigned_bins(UUID, TEXT, TEXT, INT)                                         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION bulk_assign_locations(UUID, JSONB, UUID)                                          TO authenticated, service_role;
