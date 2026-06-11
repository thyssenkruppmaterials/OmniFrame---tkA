-- Migration to convert enum-based roles to table-based roles for custom role support

-- Step 1: Create the new roles table
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE, -- System roles cannot be deleted
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Step 2: Insert existing enum values as system roles
INSERT INTO roles (name, display_name, description, is_system) VALUES
  ('superadmin', 'Super Administrator', 'Full system access with all privileges', true),
  ('admin', 'Administrator', 'Administrative access with user management', true),
  ('manager', 'Manager', 'Team management and operational oversight', true),
  ('cashier', 'Cashier', 'Customer-facing operations and transactions', true),
  ('viewer', 'Viewer', 'Read-only access to assigned resources', true);

-- Step 3: Add role_id column to user_profiles (temporarily keeping the enum)
ALTER TABLE user_profiles ADD COLUMN role_id UUID;

-- Step 4: Populate role_id based on existing role enum values
UPDATE user_profiles 
SET role_id = roles.id 
FROM roles 
WHERE user_profiles.role::text = roles.name;

-- Step 5: Update role_permissions table to use role_id
ALTER TABLE role_permissions ADD COLUMN role_id UUID REFERENCES roles(id) ON DELETE CASCADE;

-- Populate role_id in role_permissions
UPDATE role_permissions 
SET role_id = roles.id 
FROM roles 
WHERE role_permissions.role::text = roles.name;

-- Step 6: Update role_navigation_permissions table
ALTER TABLE role_navigation_permissions ADD COLUMN role_id UUID REFERENCES roles(id) ON DELETE CASCADE;

-- Populate role_id in role_navigation_permissions
UPDATE role_navigation_permissions 
SET role_id = roles.id 
FROM roles 
WHERE role_navigation_permissions.role::text = roles.name;

-- Step 7: Update organizations table for default role
ALTER TABLE organizations ADD COLUMN default_role_id UUID REFERENCES roles(id);

-- Set default_role_id based on existing default_user_role
UPDATE organizations 
SET default_role_id = roles.id 
FROM roles 
WHERE organizations.default_user_role::text = roles.name;

-- Step 8: Make role_id columns NOT NULL and add foreign key constraints
ALTER TABLE user_profiles 
  ALTER COLUMN role_id SET NOT NULL,
  ADD CONSTRAINT user_profiles_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id);

ALTER TABLE role_permissions 
  ALTER COLUMN role_id SET NOT NULL;

ALTER TABLE role_navigation_permissions 
  ALTER COLUMN role_id SET NOT NULL;

-- Step 9: Drop old enum-based columns (keeping them commented for safety)
-- ALTER TABLE user_profiles DROP COLUMN role;
-- ALTER TABLE role_permissions DROP COLUMN role;
-- ALTER TABLE role_navigation_permissions DROP COLUMN role;
-- ALTER TABLE organizations DROP COLUMN default_user_role;

-- Step 10: Update the handle_new_user() trigger to use role_id
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  default_org_id UUID;
  org_default_role_id UUID;
BEGIN
  -- Get or create default organization
  SELECT id, default_role_id INTO default_org_id, org_default_role_id 
  FROM organizations 
  WHERE slug = 'default' 
  LIMIT 1;
  
  IF default_org_id IS NULL THEN
    -- Get the default viewer role
    SELECT id INTO org_default_role_id FROM roles WHERE name = 'viewer' LIMIT 1;
    
    INSERT INTO organizations (name, slug, default_role_id) 
    VALUES ('Default Organization', 'default', org_default_role_id)
    RETURNING id INTO default_org_id;
  END IF;

  -- Create user profile with the organization's default role
  INSERT INTO public.user_profiles (
    id,
    organization_id,
    email,
    username,
    first_name,
    last_name,
    status,
    role_id -- Use role_id instead of role
  ) VALUES (
    NEW.id,
    default_org_id,
    NEW.email,
    LOWER(SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    'active',
    COALESCE(org_default_role_id, (SELECT id FROM roles WHERE name = 'viewer' LIMIT 1))
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 11: Create indexes for better performance
CREATE INDEX idx_user_profiles_role_id ON user_profiles(role_id);
CREATE INDEX idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX idx_role_navigation_permissions_role_id ON role_navigation_permissions(role_id);
CREATE INDEX idx_roles_is_system ON roles(is_system);
CREATE INDEX idx_roles_is_active ON roles(is_active);

-- Step 12: Add RLS policies for the roles table
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read roles
CREATE POLICY "Roles are viewable by authenticated users" 
  ON roles FOR SELECT 
  TO authenticated 
  USING (true);

-- Only superadmin and admin can insert roles
CREATE POLICY "Only admins can create roles" 
  ON roles FOR INSERT 
  TO authenticated 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role_id IN (
        SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
      )
    )
  );

-- Only superadmin and admin can update roles
CREATE POLICY "Only admins can update roles" 
  ON roles FOR UPDATE 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role_id IN (
        SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
      )
    )
  )
  WITH CHECK (
    -- Cannot change is_system flag
    is_system = OLD.is_system
  );

-- Only superadmin and admin can delete non-system roles
CREATE POLICY "Only admins can delete custom roles" 
  ON roles FOR DELETE 
  TO authenticated 
  USING (
    is_system = false AND
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role_id IN (
        SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
      )
    )
  );

-- Step 13: Create function to safely drop old columns later
CREATE OR REPLACE FUNCTION drop_old_role_columns()
RETURNS void AS $$
BEGIN
  -- Drop old enum-based columns
  ALTER TABLE user_profiles DROP COLUMN IF EXISTS role;
  ALTER TABLE role_permissions DROP COLUMN IF EXISTS role;
  ALTER TABLE role_navigation_permissions DROP COLUMN IF EXISTS role;
  ALTER TABLE organizations DROP COLUMN IF EXISTS default_user_role;
  
  -- Drop the old enum type
  DROP TYPE IF EXISTS user_role;
END;
$$ LANGUAGE plpgsql;

-- Note: Run SELECT drop_old_role_columns(); after verifying everything works
