-- ============================================================================
-- Migration 336: Warehouse Layout Templates (facility template library)
--
-- Lets users save a complete floor-plan layout (building outline, floor-plan
-- envelope, zones, racks incl. appearance, scene objects, aisle graph) as a
-- named, org-scoped TEMPLATE — e.g. "Standard DC", "Cold Storage", "Cross-
-- dock" — and stamp out new facilities (new warehouse_maps rows) from it.
-- The snapshot is a frontend-versioned JSONB document; bin/location mappings
-- are deliberately NOT captured (bins are facility-specific SAP data).
--
-- Additive only. Mirrors the table + RLS shape of migration 335
-- (warehouse_scene_objects) and the warehouse-map editing roles.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS warehouse_layout_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  -- Facility classification driving the picker UI. Free text so the frontend
  -- list can evolve without a migration ('warehouse','distribution_center',
  -- 'cold_storage','manufacturing','cross_dock','fulfillment','yard','other').
  facility_kind    text NOT NULL DEFAULT 'warehouse',
  description      text,
  -- Versioned layout document (see src/components/warehouse-map/
  -- layout-template-core.ts): building_outline, canvas_settings (incl.
  -- floor_plan envelope + wall_height), grid_settings, scale_factor, zones,
  -- racks (with metadata.appearance), scene_objects, aisle_nodes/edges.
  snapshot         jsonb NOT NULL,
  -- Denormalised counts/areas for the library list (zones, racks, objects,
  -- locations, area_m2) — avoids parsing the snapshot to render a row.
  stats            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by       uuid REFERENCES user_profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (name <> ''),
  CHECK (facility_kind <> '')
);

COMMENT ON TABLE warehouse_layout_templates IS
  'Named, org-scoped warehouse layout templates ("Standard DC", "Cold Storage", …). snapshot holds the full layout document (zones, racks, scene objects, aisle graph, floor-plan envelope); new facilities are stamped out of it as fresh warehouse_maps rows. Location mappings are not captured.';

CREATE INDEX IF NOT EXISTS idx_warehouse_layout_templates_org
  ON warehouse_layout_templates (organization_id, created_at DESC);

CREATE TRIGGER warehouse_layout_templates_set_updated_at
BEFORE UPDATE ON warehouse_layout_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE warehouse_layout_templates ENABLE ROW LEVEL SECURITY;

-- Everyone in the org can browse the template library.
CREATE POLICY warehouse_layout_templates_select ON warehouse_layout_templates
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  );

-- Layout editors (same roles that may edit the warehouse map) can write.
CREATE POLICY warehouse_layout_templates_write ON warehouse_layout_templates
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
