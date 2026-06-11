-- Migration: Role Hierarchy and Features Enhancement
-- Date: 2025-01-21
-- Description: Adds hierarchical role structure with inheritance capabilities

-- Add hierarchical role structure and enhanced metadata
ALTER TABLE roles ADD COLUMN IF NOT EXISTS parent_role_id UUID REFERENCES roles(id);
ALTER TABLE roles ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS max_users INTEGER;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '{}';
ALTER TABLE roles ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add constraints and indexes for performance
CREATE INDEX IF NOT EXISTS idx_roles_parent_role_id ON roles(parent_role_id);
CREATE INDEX IF NOT EXISTS idx_roles_priority ON roles(priority);
CREATE INDEX IF NOT EXISTS idx_roles_features ON roles USING gin(features);
CREATE INDEX IF NOT EXISTS idx_roles_metadata ON roles USING gin(metadata);

-- Create role hierarchy view for inherited permissions
CREATE OR REPLACE VIEW role_hierarchy AS
WITH RECURSIVE role_tree AS (
  -- Base case: root roles (no parent)
  SELECT 
    id, 
    name, 
    parent_role_id, 
    display_name,
    priority,
    0 as level,
    ARRAY[id] as path,
    ARRAY[name] as name_path
  FROM roles
  WHERE parent_role_id IS NULL AND is_active = true
  
  UNION ALL
  
  -- Recursive case: child roles
  SELECT 
    r.id, 
    r.name, 
    r.parent_role_id, 
    r.display_name,
    r.priority,
    rt.level + 1,
    rt.path || r.id,
    rt.name_path || r.name
  FROM roles r
  JOIN role_tree rt ON r.parent_role_id = rt.id
  WHERE r.is_active = true
    AND NOT r.id = ANY(rt.path) -- Prevent cycles
    AND rt.level < 10 -- Prevent infinite recursion
)
SELECT 
  id,
  name,
  parent_role_id,
  display_name,
  priority,
  level,
  path,
  name_path,
  array_length(path, 1) as depth
FROM role_tree
ORDER BY level, priority, name;

-- Create function to get all inherited roles for a given role
CREATE OR REPLACE FUNCTION get_inherited_roles(role_id UUID)
RETURNS TABLE(
  inherited_role_id UUID,
  inherited_role_name VARCHAR,
  level INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE role_inheritance AS (
    -- Start with the given role
    SELECT 
      r.id as inherited_role_id,
      r.name as inherited_role_name,
      0 as level
    FROM roles r
    WHERE r.id = role_id AND r.is_active = true
    
    UNION
    
    -- Add parent roles recursively
    SELECT 
      p.id as inherited_role_id,
      p.name as inherited_role_name,
      ri.level + 1
    FROM roles p
    JOIN role_inheritance ri ON p.id = (
      SELECT parent_role_id FROM roles WHERE id = ri.inherited_role_id
    )
    WHERE p.is_active = true
      AND ri.level < 10 -- Prevent infinite recursion
  )
  SELECT * FROM role_inheritance
  ORDER BY level;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to check for circular dependencies
CREATE OR REPLACE FUNCTION check_role_circular_dependency(
  child_role_id UUID,
  parent_role_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  has_circular BOOLEAN := FALSE;
BEGIN
  -- Check if parent_role_id is already a descendant of child_role_id
  SELECT EXISTS(
    SELECT 1 
    FROM get_inherited_roles(child_role_id) 
    WHERE inherited_role_id = parent_role_id
  ) INTO has_circular;
  
  RETURN has_circular;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add trigger to prevent circular dependencies
CREATE OR REPLACE FUNCTION prevent_role_circular_dependency()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_role_id IS NOT NULL THEN
    -- Prevent self-reference
    IF NEW.id = NEW.parent_role_id THEN
      RAISE EXCEPTION 'A role cannot be its own parent';
    END IF;
    
    -- Prevent circular dependencies
    IF check_role_circular_dependency(NEW.id, NEW.parent_role_id) THEN
      RAISE EXCEPTION 'This parent role assignment would create a circular dependency';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the circular dependency prevention trigger
DROP TRIGGER IF EXISTS role_circular_dependency_trigger ON roles;
CREATE TRIGGER role_circular_dependency_trigger
  BEFORE INSERT OR UPDATE ON roles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_role_circular_dependency();

-- Update existing system roles with hierarchy and features
UPDATE roles 
SET 
  priority = CASE 
    WHEN name = 'superadmin' THEN 100
    WHEN name = 'admin' THEN 80
    WHEN name = 'manager' THEN 60
    WHEN name = 'cashier' THEN 40
    WHEN name = 'viewer' THEN 20
    ELSE 0
  END,
  features = CASE 
    WHEN name = 'superadmin' THEN '{"system_access": true, "user_management": true, "role_management": true, "audit_access": true, "settings_management": true}'
    WHEN name = 'admin' THEN '{"user_management": true, "role_management": true, "audit_access": true, "settings_management": false}'
    WHEN name = 'manager' THEN '{"user_management": false, "role_management": false, "audit_access": false, "settings_management": false}'
    WHEN name = 'cashier' THEN '{"user_management": false, "role_management": false, "audit_access": false, "settings_management": false}'
    WHEN name = 'viewer' THEN '{"user_management": false, "role_management": false, "audit_access": false, "settings_management": false}'
    ELSE '{}'
  END,
  metadata = '{"system_role": true, "created_by": "migration_006"}'
WHERE is_system = true;

-- Set up basic role hierarchy (admin inherits from superadmin permissions conceptually)
-- Note: We won't set actual parent relationships for system roles to maintain independence
-- Custom roles can be created with parent relationships

-- Grant necessary permissions for the new functions
GRANT EXECUTE ON FUNCTION get_inherited_roles(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION check_role_circular_dependency(UUID, UUID) TO authenticated, service_role;

-- Update RLS policies for enhanced roles table access
DROP POLICY IF EXISTS "Enhanced roles are viewable by authenticated users" ON roles;
CREATE POLICY "Enhanced roles are viewable by authenticated users" 
  ON roles FOR SELECT 
  TO authenticated 
  USING (true);

-- Policy for role creation with hierarchy validation
DROP POLICY IF EXISTS "Only admins can create roles with hierarchy" ON roles;
CREATE POLICY "Only admins can create roles with hierarchy" 
  ON roles FOR INSERT 
  TO authenticated 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid() 
      AND r.name IN ('superadmin', 'admin')
    )
  );

-- Policy for role updates with hierarchy validation
DROP POLICY IF EXISTS "Only admins can update roles with hierarchy" ON roles;
CREATE POLICY "Only admins can update roles with hierarchy" 
  ON roles FOR UPDATE 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid() 
      AND r.name IN ('superadmin', 'admin')
    )
  )
  WITH CHECK (
    -- Cannot change is_system flag
    is_system = OLD.is_system
  );

-- Add comment for migration tracking
COMMENT ON COLUMN roles.parent_role_id IS 'References parent role for inheritance hierarchy';
COMMENT ON COLUMN roles.priority IS 'Role priority for ordering and precedence (higher = more priority)';
COMMENT ON COLUMN roles.max_users IS 'Maximum number of users that can be assigned to this role';
COMMENT ON COLUMN roles.features IS 'JSON object defining role-specific feature access flags';
COMMENT ON COLUMN roles.metadata IS 'Additional role metadata for extensions and customization';
COMMENT ON VIEW role_hierarchy IS 'Hierarchical view of roles showing inheritance tree';

-- Create helper function to check if user has role feature
CREATE OR REPLACE FUNCTION user_has_role_feature(
  user_id UUID,
  feature_name TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  has_feature BOOLEAN := FALSE;
BEGIN
  SELECT COALESCE(
    (r.features->feature_name)::boolean, 
    false
  ) INTO has_feature
  FROM user_profiles up
  JOIN roles r ON up.role_id = r.id
  WHERE up.id = user_id AND r.is_active = true;
  
  RETURN COALESCE(has_feature, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions on helper functions
GRANT EXECUTE ON FUNCTION user_has_role_feature(UUID, TEXT) TO authenticated, service_role;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 006: Role hierarchy and features enhancement completed successfully';
END $$;
