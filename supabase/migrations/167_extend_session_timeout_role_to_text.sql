-- Migration: 167 - Extend session_timeout_configs.role from user_role enum to TEXT
-- Date: 2026-02-06
-- Description: Changes the role column from user_role enum to TEXT so that
--   custom roles from the roles table (not just enum values) can have timeout configs.
--   Also drops the hardcoded CHECK constraint and recreates RLS policies
--   using role_id joins instead of legacy enum comparisons.

-- Step 1: Drop the CHECK constraint that hardcodes allowed roles
ALTER TABLE session_timeout_configs DROP CONSTRAINT IF EXISTS session_timeout_configs_role_check;

-- Step 2: Drop RLS policies that reference the enum type
DROP POLICY IF EXISTS "Users can view timeout configs for their roles" ON session_timeout_configs;
DROP POLICY IF EXISTS "Admins can manage timeout configs" ON session_timeout_configs;

-- Step 3: Drop the unique constraint
ALTER TABLE session_timeout_configs DROP CONSTRAINT IF EXISTS session_timeout_configs_role_global_unique;

-- Step 4: Drop the function that uses user_role type
DROP FUNCTION IF EXISTS get_user_session_config(UUID);

-- Step 5: Change column type from user_role enum to TEXT
ALTER TABLE session_timeout_configs ALTER COLUMN role TYPE TEXT USING role::TEXT;

-- Step 6: Re-add the unique constraint
ALTER TABLE session_timeout_configs ADD CONSTRAINT session_timeout_configs_role_global_unique UNIQUE(role, is_global);

-- Step 7: Recreate RLS policies using roles table join via role_id
CREATE POLICY "Admins can manage timeout configs"
  ON session_timeout_configs FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid()
      AND r.name::TEXT IN ('superadmin', 'admin')
    )
  );

CREATE POLICY "Users can view timeout configs for their roles"
  ON session_timeout_configs FOR SELECT
  TO authenticated
  USING (
    role = (
      SELECT r.name::TEXT FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid()
    )
    OR is_global = true
    OR EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid()
      AND r.name::TEXT IN ('superadmin', 'admin')
    )
  );

-- Step 8: Recreate the function with TEXT type
CREATE OR REPLACE FUNCTION get_user_session_config(p_user_id UUID)
RETURNS TABLE(
  session_timeout_minutes INTEGER,
  auto_logout_timeout_minutes INTEGER,
  warning_time_minutes INTEGER,
  remember_me_duration_hours INTEGER,
  enable_fullscreen_expiry_warning BOOLEAN
) AS $$
DECLARE
  user_role_name TEXT;
  global_config session_timeout_configs%ROWTYPE;
  role_config session_timeout_configs%ROWTYPE;
BEGIN
  SELECT r.name::TEXT INTO user_role_name
  FROM user_profiles up
  JOIN roles r ON up.role_id = r.id
  WHERE up.id = p_user_id;

  SELECT * INTO global_config
  FROM session_timeout_configs WHERE is_global = true LIMIT 1;

  SELECT * INTO role_config
  FROM session_timeout_configs WHERE session_timeout_configs.role = user_role_name AND is_global = false;

  IF role_config.id IS NOT NULL THEN
    RETURN QUERY SELECT role_config.session_timeout_minutes, role_config.auto_logout_timeout_minutes, role_config.warning_time_minutes, role_config.remember_me_duration_hours, role_config.enable_fullscreen_expiry_warning;
  ELSIF global_config.id IS NOT NULL THEN
    RETURN QUERY SELECT global_config.session_timeout_minutes, global_config.auto_logout_timeout_minutes, global_config.warning_time_minutes, global_config.remember_me_duration_hours, global_config.enable_fullscreen_expiry_warning;
  ELSE
    RETURN QUERY SELECT 240, 15, 5, 24, true;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_user_session_config(UUID) TO authenticated, service_role;
