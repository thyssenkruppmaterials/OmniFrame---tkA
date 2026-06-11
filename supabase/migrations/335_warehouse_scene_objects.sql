-- ============================================================================
-- Migration 335: Warehouse Scene Objects (3D floor-layout furniture / fixtures)
--
-- Backs the configurable 3D Location-tab editor. Stores parametric objects the
-- user places in the isometric scene — desks, offices, meeting rooms, tables,
-- conveyors, dock doors, columns, pallets, barriers, etc. The DB holds only
-- placement + dimensions; the visual recipe per `kind` lives in the frontend
-- (src/components/warehouse-map/scene3d/object-catalog.ts), so the catalog can
-- evolve without schema changes. Additive only — no existing table is touched.
--
-- Mirrors the table + RLS shape of migration 334 (warehouses) and the warehouse
-- map editing roles. Coordinates use the same world-unit (~cm) convention as
-- warehouse_racks; unlike racks (corner origin) position_x/y is the footprint
-- CENTER, which keeps the 3D transform gizmo simple.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS warehouse_scene_objects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id           uuid NOT NULL REFERENCES warehouse_maps(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Catalog kind (e.g. 'desk','office','conveyor','dock_door','column','pallet').
  -- Free text so the frontend catalog can add kinds without a migration.
  kind             text NOT NULL,
  label            text,
  -- World units (~cm). Footprint CENTER (not corner) + elevation.
  position_x       double precision NOT NULL DEFAULT 0,
  position_y       double precision NOT NULL DEFAULT 0,
  position_z       double precision NOT NULL DEFAULT 0,
  -- Footprint + vertical extent, world units.
  width            double precision NOT NULL DEFAULT 100,
  depth            double precision NOT NULL DEFAULT 100,
  height           double precision NOT NULL DEFAULT 100,
  -- Degrees, same convention as warehouse_racks.rotation.
  rotation         double precision NOT NULL DEFAULT 0,
  -- Optional color override; NULL → frontend catalog default for the kind.
  color            text,
  floor_level      int NOT NULL DEFAULT 0,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES user_profiles(id),
  updated_by       uuid REFERENCES user_profiles(id),
  CHECK (kind <> ''),
  CHECK (width > 0 AND depth > 0 AND height >= 0)
);

COMMENT ON TABLE warehouse_scene_objects IS
  'Parametric objects placed in the 3D Location-tab scene editor (desks, offices, conveyors, columns, pallets, …). Placement/dimensions only; the per-kind visual recipe lives in the frontend object catalog. Coordinates in world units (~cm); position_x/y is the footprint CENTER.';

CREATE INDEX IF NOT EXISTS idx_warehouse_scene_objects_map
  ON warehouse_scene_objects (map_id, floor_level);

CREATE INDEX IF NOT EXISTS idx_warehouse_scene_objects_org
  ON warehouse_scene_objects (organization_id);

CREATE TRIGGER warehouse_scene_objects_set_updated_at
BEFORE UPDATE ON warehouse_scene_objects
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE warehouse_scene_objects ENABLE ROW LEVEL SECURITY;

-- Everyone in the org can read the layout.
CREATE POLICY warehouse_scene_objects_select ON warehouse_scene_objects
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  );

-- Layout editors (same roles that may edit the warehouse map) can write.
CREATE POLICY warehouse_scene_objects_write ON warehouse_scene_objects
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

COMMIT;
