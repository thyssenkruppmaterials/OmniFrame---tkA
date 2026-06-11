-- =====================================================
-- Area Type Options and Department Options Migration
-- Created: December 25, 2025
-- Description: Adds configurable area types for working areas
--              and departments for positions
-- =====================================================

-- ===== AREA TYPE OPTIONS TABLE =====
CREATE TABLE IF NOT EXISTS area_type_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type_value TEXT NOT NULL,
  type_label TEXT NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  color_code TEXT,
  icon_name TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, type_value)
);

-- ===== DEPARTMENT OPTIONS TABLE =====
CREATE TABLE IF NOT EXISTS department_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_value TEXT NOT NULL,
  department_label TEXT NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  color_code TEXT,
  icon_name TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, department_value)
);

-- ===== INDEXES =====
CREATE INDEX IF NOT EXISTS idx_area_type_options_org ON area_type_options(organization_id);
CREATE INDEX IF NOT EXISTS idx_area_type_options_active ON area_type_options(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_department_options_org ON department_options(organization_id);
CREATE INDEX IF NOT EXISTS idx_department_options_active ON department_options(organization_id, is_active);

-- ===== RLS POLICIES =====
ALTER TABLE area_type_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_options ENABLE ROW LEVEL SECURITY;

-- Area Type Options policies
CREATE POLICY "area_type_options_select_org" ON area_type_options
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "area_type_options_insert_org" ON area_type_options
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "area_type_options_update_org" ON area_type_options
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "area_type_options_delete_org" ON area_type_options
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

-- Department Options policies
CREATE POLICY "department_options_select_org" ON department_options
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "department_options_insert_org" ON department_options
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "department_options_update_org" ON department_options
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "department_options_delete_org" ON department_options
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

-- ===== UPDATED_AT TRIGGERS =====
CREATE OR REPLACE FUNCTION update_area_type_options_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_department_options_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS area_type_options_updated_at ON area_type_options;
CREATE TRIGGER area_type_options_updated_at
  BEFORE UPDATE ON area_type_options
  FOR EACH ROW
  EXECUTE FUNCTION update_area_type_options_updated_at();

DROP TRIGGER IF EXISTS department_options_updated_at ON department_options;
CREATE TRIGGER department_options_updated_at
  BEFORE UPDATE ON department_options
  FOR EACH ROW
  EXECUTE FUNCTION update_department_options_updated_at();

-- ===== SEED FUNCTION =====
CREATE OR REPLACE FUNCTION seed_area_and_department_options(p_organization_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Seed default area types if none exist
  IF NOT EXISTS (SELECT 1 FROM area_type_options WHERE organization_id = p_organization_id) THEN
    INSERT INTO area_type_options (organization_id, type_value, type_label, description, display_order, color_code)
    VALUES
      (p_organization_id, 'warehouse_zone', 'Warehouse Zone', 'General warehouse storage and picking areas', 1, '#3b82f6'),
      (p_organization_id, 'shipping_dock', 'Shipping Dock', 'Outbound shipping and loading areas', 2, '#10b981'),
      (p_organization_id, 'receiving_dock', 'Receiving Dock', 'Inbound receiving and unloading areas', 3, '#f59e0b'),
      (p_organization_id, 'quality_lab', 'Quality Lab', 'Quality control and inspection areas', 4, '#8b5cf6'),
      (p_organization_id, 'office', 'Office', 'Administrative and office spaces', 5, '#6366f1'),
      (p_organization_id, 'yard', 'Yard/Exterior', 'Outdoor yard and exterior areas', 6, '#14b8a6'),
      (p_organization_id, 'staging', 'Staging Area', 'Temporary staging and holding areas', 7, '#f97316'),
      (p_organization_id, 'kitting', 'Kitting Area', 'Kit assembly and preparation areas', 8, '#ec4899'),
      (p_organization_id, 'returns', 'Returns Processing', 'Returns and RMA processing areas', 9, '#ef4444');
  END IF;

  -- Seed default departments if none exist
  IF NOT EXISTS (SELECT 1 FROM department_options WHERE organization_id = p_organization_id) THEN
    INSERT INTO department_options (organization_id, department_value, department_label, description, display_order, color_code)
    VALUES
      (p_organization_id, 'operations', 'Operations', 'General warehouse operations', 1, '#3b82f6'),
      (p_organization_id, 'shipping', 'Shipping', 'Outbound shipping and logistics', 2, '#10b981'),
      (p_organization_id, 'receiving', 'Receiving', 'Inbound receiving and put-away', 3, '#f59e0b'),
      (p_organization_id, 'quality', 'Quality Control', 'Quality assurance and inspection', 4, '#8b5cf6'),
      (p_organization_id, 'inventory', 'Inventory Control', 'Inventory management and cycle counts', 5, '#6366f1'),
      (p_organization_id, 'kitting', 'Kitting', 'Kit assembly and preparation', 6, '#ec4899'),
      (p_organization_id, 'management', 'Management', 'Supervisory and management roles', 7, '#14b8a6'),
      (p_organization_id, 'maintenance', 'Maintenance', 'Equipment and facility maintenance', 8, '#f97316'),
      (p_organization_id, 'admin', 'Administration', 'Administrative and clerical roles', 9, '#64748b');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION seed_area_and_department_options(UUID) TO authenticated;

COMMENT ON TABLE area_type_options IS 'Configurable area types for working areas per organization';
COMMENT ON TABLE department_options IS 'Configurable department options for positions per organization';



