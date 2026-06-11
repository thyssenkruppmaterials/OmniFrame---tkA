-- Migration: Permission Categories and Dependencies
-- Date: 2025-01-21
-- Description: Adds dynamic permission categorization and dependency management

-- Create permission categories table
CREATE TABLE IF NOT EXISTS permission_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  order_index INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Add indexes for permission categories
CREATE INDEX IF NOT EXISTS idx_permission_categories_name ON permission_categories(name);
CREATE INDEX IF NOT EXISTS idx_permission_categories_order ON permission_categories(order_index);
CREATE INDEX IF NOT EXISTS idx_permission_categories_active ON permission_categories(is_active);

-- Add category reference and enhanced metadata to permissions table
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES permission_categories(id);
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS is_critical BOOLEAN DEFAULT FALSE;
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS requires_2fa BOOLEAN DEFAULT FALSE;
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20) DEFAULT 'low';
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS scope VARCHAR(50) DEFAULT 'application';
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add constraints for risk_level
ALTER TABLE permissions ADD CONSTRAINT permissions_risk_level_check 
  CHECK (risk_level IN ('low', 'medium', 'high', 'critical'));

-- Add constraints for scope
ALTER TABLE permissions ADD CONSTRAINT permissions_scope_check 
  CHECK (scope IN ('application', 'system', 'organization', 'user'));

-- Add indexes for enhanced permissions
CREATE INDEX IF NOT EXISTS idx_permissions_category_id ON permissions(category_id);
CREATE INDEX IF NOT EXISTS idx_permissions_is_critical ON permissions(is_critical);
CREATE INDEX IF NOT EXISTS idx_permissions_risk_level ON permissions(risk_level);
CREATE INDEX IF NOT EXISTS idx_permissions_scope ON permissions(scope);
CREATE INDEX IF NOT EXISTS idx_permissions_metadata ON permissions USING gin(metadata);

-- Create permission dependencies table
CREATE TABLE IF NOT EXISTS permission_dependencies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE NOT NULL,
  depends_on_permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE NOT NULL,
  dependency_type VARCHAR(20) DEFAULT 'requires',
  is_optional BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(permission_id, depends_on_permission_id)
);

-- Add constraint for dependency type
ALTER TABLE permission_dependencies ADD CONSTRAINT permission_dependencies_type_check 
  CHECK (dependency_type IN ('requires', 'implies', 'conflicts', 'suggests'));

-- Add indexes for permission dependencies
CREATE INDEX IF NOT EXISTS idx_permission_dependencies_permission ON permission_dependencies(permission_id);
CREATE INDEX IF NOT EXISTS idx_permission_dependencies_depends_on ON permission_dependencies(depends_on_permission_id);
CREATE INDEX IF NOT EXISTS idx_permission_dependencies_type ON permission_dependencies(dependency_type);

-- Create permission tags table for flexible tagging
CREATE TABLE IF NOT EXISTS permission_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  color VARCHAR(7) DEFAULT '#6B7280', -- Default gray color
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create junction table for permission-tag relationships
CREATE TABLE IF NOT EXISTS permission_tag_assignments (
  permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE NOT NULL,
  tag_id UUID REFERENCES permission_tags(id) ON DELETE CASCADE NOT NULL,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (permission_id, tag_id)
);

-- Add indexes for tagging system
CREATE INDEX IF NOT EXISTS idx_permission_tags_active ON permission_tags(is_active);
CREATE INDEX IF NOT EXISTS idx_permission_tag_assignments_permission ON permission_tag_assignments(permission_id);
CREATE INDEX IF NOT EXISTS idx_permission_tag_assignments_tag ON permission_tag_assignments(tag_id);

-- Insert default permission categories
INSERT INTO permission_categories (name, display_name, description, icon, order_index) VALUES
('user_management', 'User Management', 'Permissions related to creating, updating, and managing users', 'users', 10),
('role_management', 'Role Management', 'Permissions for managing roles and role assignments', 'shield', 20),
('content_management', 'Content Management', 'Permissions for managing application content and data', 'file-text', 30),
('system_administration', 'System Administration', 'System-level administrative permissions', 'settings', 40),
('security_audit', 'Security & Audit', 'Security and auditing related permissions', 'lock', 50),
('reporting_analytics', 'Reporting & Analytics', 'Permissions for accessing reports and analytics', 'bar-chart', 60),
('api_access', 'API Access', 'Permissions for API endpoints and integrations', 'link', 70),
('file_storage', 'File & Storage', 'Permissions for file upload, download, and storage management', 'folder', 80),
('communication', 'Communication', 'Permissions for messaging, notifications, and communication', 'mail', 90),
('billing_payments', 'Billing & Payments', 'Permissions related to billing, payments, and subscriptions', 'credit-card', 100)
ON CONFLICT (name) DO NOTHING;

-- Insert default permission tags
INSERT INTO permission_tags (name, display_name, color, description) VALUES
('high-risk', 'High Risk', '#EF4444', 'High-risk permissions that require special attention'),
('data-access', 'Data Access', '#3B82F6', 'Permissions that grant access to sensitive data'),
('destructive', 'Destructive', '#DC2626', 'Permissions that can delete or permanently modify data'),
('admin-only', 'Admin Only', '#7C2D12', 'Permissions reserved for administrators'),
('audit-required', 'Audit Required', '#059669', 'Permissions that require audit logging'),
('2fa-required', '2FA Required', '#7C3AED', 'Permissions that require two-factor authentication'),
('beta-feature', 'Beta Feature', '#F59E0B', 'Permissions for beta or experimental features'),
('deprecated', 'Deprecated', '#6B7280', 'Deprecated permissions scheduled for removal')
ON CONFLICT (name) DO NOTHING;

-- Update existing permissions with categories and enhanced metadata
DO $$
DECLARE
  user_mgmt_cat_id UUID;
  role_mgmt_cat_id UUID;
  content_mgmt_cat_id UUID;
  system_admin_cat_id UUID;
  security_audit_cat_id UUID;
  api_access_cat_id UUID;
BEGIN
  -- Get category IDs
  SELECT id INTO user_mgmt_cat_id FROM permission_categories WHERE name = 'user_management';
  SELECT id INTO role_mgmt_cat_id FROM permission_categories WHERE name = 'role_management';
  SELECT id INTO content_mgmt_cat_id FROM permission_categories WHERE name = 'content_management';
  SELECT id INTO system_admin_cat_id FROM permission_categories WHERE name = 'system_administration';
  SELECT id INTO security_audit_cat_id FROM permission_categories WHERE name = 'security_audit';
  SELECT id INTO api_access_cat_id FROM permission_categories WHERE name = 'api_access';

  -- Update existing permissions with appropriate categories
  UPDATE permissions SET 
    category_id = user_mgmt_cat_id,
    is_critical = CASE WHEN action IN ('delete', 'create') THEN true ELSE false END,
    risk_level = CASE WHEN action = 'delete' THEN 'high' WHEN action = 'create' THEN 'medium' ELSE 'low' END,
    scope = 'application'
  WHERE resource IN ('users', 'user_profiles', 'user_management');

  UPDATE permissions SET 
    category_id = role_mgmt_cat_id,
    is_critical = true,
    requires_2fa = CASE WHEN action IN ('create', 'update', 'delete') THEN true ELSE false END,
    risk_level = 'high',
    scope = 'system'
  WHERE resource IN ('roles', 'permissions', 'role_permissions');

  UPDATE permissions SET 
    category_id = content_mgmt_cat_id,
    is_critical = CASE WHEN action = 'delete' THEN true ELSE false END,
    risk_level = CASE WHEN action = 'delete' THEN 'medium' ELSE 'low' END,
    scope = 'application'
  WHERE resource IN ('tasks', 'chats', 'messages', 'files', 'applications');

  UPDATE permissions SET 
    category_id = system_admin_cat_id,
    is_critical = true,
    requires_2fa = true,
    risk_level = 'critical',
    scope = 'system'
  WHERE resource IN ('settings', 'organizations', 'audit_logs');

  UPDATE permissions SET 
    category_id = security_audit_cat_id,
    is_critical = false,
    risk_level = 'medium',
    scope = 'organization'
  WHERE resource IN ('audit', 'logs', 'security');

  UPDATE permissions SET 
    category_id = api_access_cat_id,
    is_critical = false,
    risk_level = 'low',
    scope = 'application'
  WHERE resource LIKE '%api%' OR resource LIKE '%webhook%';
END $$;

-- Create function to get permissions with their dependencies
CREATE OR REPLACE FUNCTION get_permission_with_dependencies(permission_id UUID)
RETURNS TABLE(
  perm_id UUID,
  perm_name VARCHAR,
  perm_resource VARCHAR,
  perm_action VARCHAR,
  dependency_id UUID,
  dependency_name VARCHAR,
  dependency_resource VARCHAR,
  dependency_action VARCHAR,
  dependency_type VARCHAR,
  is_optional BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id as perm_id,
    p.name as perm_name,
    p.resource as perm_resource,
    p.action as perm_action,
    dep_p.id as dependency_id,
    dep_p.name as dependency_name,
    dep_p.resource as dependency_resource,
    dep_p.action as dependency_action,
    pd.dependency_type,
    pd.is_optional
  FROM permissions p
  LEFT JOIN permission_dependencies pd ON p.id = pd.permission_id
  LEFT JOIN permissions dep_p ON pd.depends_on_permission_id = dep_p.id
  WHERE p.id = permission_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to validate permission dependencies
CREATE OR REPLACE FUNCTION validate_permission_assignment(
  user_id UUID,
  permission_id UUID
) RETURNS TABLE(
  is_valid BOOLEAN,
  missing_dependencies UUID[],
  conflicting_permissions UUID[]
) AS $$
DECLARE
  missing_deps UUID[] := '{}';
  conflicts UUID[] := '{}';
  is_valid_result BOOLEAN := TRUE;
BEGIN
  -- Check for missing required dependencies
  SELECT ARRAY_AGG(pd.depends_on_permission_id) INTO missing_deps
  FROM permission_dependencies pd
  WHERE pd.permission_id = permission_id
    AND pd.dependency_type = 'requires'
    AND pd.is_optional = false
    AND NOT EXISTS (
      SELECT 1 FROM user_permissions up
      WHERE up.user_id = user_id 
        AND up.permission_id = pd.depends_on_permission_id
        AND up.granted = true
        AND (up.expires_at IS NULL OR up.expires_at > NOW())
    );

  -- Check for conflicting permissions
  SELECT ARRAY_AGG(pd.depends_on_permission_id) INTO conflicts
  FROM permission_dependencies pd
  WHERE pd.permission_id = permission_id
    AND pd.dependency_type = 'conflicts'
    AND EXISTS (
      SELECT 1 FROM user_permissions up
      WHERE up.user_id = user_id 
        AND up.permission_id = pd.depends_on_permission_id
        AND up.granted = true
        AND (up.expires_at IS NULL OR up.expires_at > NOW())
    );

  -- Determine if assignment is valid
  is_valid_result := (COALESCE(array_length(missing_deps, 1), 0) = 0) 
                    AND (COALESCE(array_length(conflicts, 1), 0) = 0);

  RETURN QUERY SELECT is_valid_result, COALESCE(missing_deps, '{}'), COALESCE(conflicts, '{}');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create view for permissions with category and dependency info
CREATE OR REPLACE VIEW permissions_with_metadata AS
SELECT 
  p.id,
  p.name,
  p.resource,
  p.action,
  p.description,
  p.is_critical,
  p.requires_2fa,
  p.risk_level,
  p.scope,
  p.metadata,
  pc.name as category_name,
  pc.display_name as category_display_name,
  pc.icon as category_icon,
  pc.order_index as category_order,
  COALESCE(dep_count.required_deps, 0) as required_dependencies_count,
  COALESCE(dep_count.optional_deps, 0) as optional_dependencies_count,
  COALESCE(conflict_count.conflicts, 0) as conflicts_count,
  COALESCE(tag_list.tags, '{}') as tags
FROM permissions p
LEFT JOIN permission_categories pc ON p.category_id = pc.id
LEFT JOIN (
  SELECT 
    permission_id,
    SUM(CASE WHEN dependency_type = 'requires' AND is_optional = false THEN 1 ELSE 0 END) as required_deps,
    SUM(CASE WHEN dependency_type = 'requires' AND is_optional = true THEN 1 ELSE 0 END) as optional_deps
  FROM permission_dependencies
  GROUP BY permission_id
) dep_count ON p.id = dep_count.permission_id
LEFT JOIN (
  SELECT 
    permission_id,
    COUNT(*) as conflicts
  FROM permission_dependencies
  WHERE dependency_type = 'conflicts'
  GROUP BY permission_id
) conflict_count ON p.id = conflict_count.permission_id
LEFT JOIN (
  SELECT 
    pta.permission_id,
    ARRAY_AGG(pt.name ORDER BY pt.name) as tags
  FROM permission_tag_assignments pta
  JOIN permission_tags pt ON pta.tag_id = pt.id
  WHERE pt.is_active = true
  GROUP BY pta.permission_id
) tag_list ON p.id = tag_list.permission_id;

-- Add RLS policies for new tables
ALTER TABLE permission_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_tag_assignments ENABLE ROW LEVEL SECURITY;

-- RLS policies for permission_categories
CREATE POLICY "Categories viewable by authenticated users" 
  ON permission_categories FOR SELECT 
  TO authenticated 
  USING (true);

CREATE POLICY "Only admins can manage categories" 
  ON permission_categories FOR ALL 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid() 
      AND r.name IN ('superadmin', 'admin')
    )
  );

-- RLS policies for permission_dependencies
CREATE POLICY "Dependencies viewable by authenticated users" 
  ON permission_dependencies FOR SELECT 
  TO authenticated 
  USING (true);

CREATE POLICY "Only admins can manage dependencies" 
  ON permission_dependencies FOR ALL 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid() 
      AND r.name IN ('superadmin', 'admin')
    )
  );

-- RLS policies for permission_tags
CREATE POLICY "Tags viewable by authenticated users" 
  ON permission_tags FOR SELECT 
  TO authenticated 
  USING (true);

CREATE POLICY "Only admins can manage tags" 
  ON permission_tags FOR ALL 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid() 
      AND r.name IN ('superadmin', 'admin')
    )
  );

-- RLS policies for permission_tag_assignments
CREATE POLICY "Tag assignments viewable by authenticated users" 
  ON permission_tag_assignments FOR SELECT 
  TO authenticated 
  USING (true);

CREATE POLICY "Only admins can manage tag assignments" 
  ON permission_tag_assignments FOR ALL 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid() 
      AND r.name IN ('superadmin', 'admin')
    )
  );

-- Grant permissions on new functions
GRANT EXECUTE ON FUNCTION get_permission_with_dependencies(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION validate_permission_assignment(UUID, UUID) TO authenticated, service_role;

-- Add comments for documentation
COMMENT ON TABLE permission_categories IS 'Categorizes permissions for better organization and UI grouping';
COMMENT ON TABLE permission_dependencies IS 'Defines dependencies and conflicts between permissions';
COMMENT ON TABLE permission_tags IS 'Flexible tagging system for permissions';
COMMENT ON TABLE permission_tag_assignments IS 'Many-to-many relationship between permissions and tags';
COMMENT ON VIEW permissions_with_metadata IS 'Comprehensive view of permissions with category, dependency, and tag information';

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 007: Permission categories and dependencies completed successfully';
END $$;
