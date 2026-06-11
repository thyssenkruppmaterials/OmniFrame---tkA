-- Migration: Add role-based "Remember Me" with configurable session duration
-- Date: 2026-02-05
-- Description: Adds remember_me_duration_hours and enable_fullscreen_expiry_warning
--              columns to session_timeout_configs for Step 6 of session management

-- Step 1: Add remember_me_duration_hours column (default 24 hours)
ALTER TABLE session_timeout_configs
  ADD COLUMN IF NOT EXISTS remember_me_duration_hours INTEGER NOT NULL DEFAULT 24;

-- Step 2: Add enable_fullscreen_expiry_warning column (default true)
ALTER TABLE session_timeout_configs
  ADD COLUMN IF NOT EXISTS enable_fullscreen_expiry_warning BOOLEAN NOT NULL DEFAULT true;

-- Step 3: Update existing rows with sensible role-based defaults
UPDATE session_timeout_configs
SET
  remember_me_duration_hours = CASE role
    WHEN 'superadmin'     THEN 720   -- 30 days
    WHEN 'admin'          THEN 720   -- 30 days
    WHEN 'manager'        THEN 168   -- 7 days
    WHEN 'cashier'        THEN 48    -- 2 days
    WHEN 'viewer'         THEN 24    -- 1 day
    WHEN 'tka_associate'  THEN 48    -- 2 days
    ELSE 24
  END,
  enable_fullscreen_expiry_warning = true,
  updated_at = NOW()
WHERE role IN ('superadmin', 'admin', 'manager', 'cashier', 'viewer', 'tka_associate');

-- Step 4: Update get_user_session_config to return the new columns
CREATE OR REPLACE FUNCTION get_user_session_config(p_user_id UUID)
RETURNS TABLE(
  session_timeout_minutes INTEGER,
  auto_logout_timeout_minutes INTEGER,
  warning_time_minutes INTEGER,
  remember_me_duration_hours INTEGER,
  enable_fullscreen_expiry_warning BOOLEAN
) AS $$
DECLARE
  user_role_name user_role;
  global_config session_timeout_configs%ROWTYPE;
  role_config session_timeout_configs%ROWTYPE;
BEGIN
  -- Get user role
  SELECT r.name INTO user_role_name
  FROM user_profiles up
  JOIN roles r ON up.role_id = r.id
  WHERE up.id = p_user_id;

  -- Get global config
  SELECT * INTO global_config
  FROM session_timeout_configs
  WHERE is_global = true
  LIMIT 1;

  -- Get role-specific config
  SELECT * INTO role_config
  FROM session_timeout_configs
  WHERE session_timeout_configs.role = user_role_name AND is_global = false;

  -- Return role-specific config if exists, otherwise global, otherwise default
  IF role_config.id IS NOT NULL THEN
    RETURN QUERY SELECT
      role_config.session_timeout_minutes,
      role_config.auto_logout_timeout_minutes,
      role_config.warning_time_minutes,
      role_config.remember_me_duration_hours,
      role_config.enable_fullscreen_expiry_warning;
  ELSIF global_config.id IS NOT NULL THEN
    RETURN QUERY SELECT
      global_config.session_timeout_minutes,
      global_config.auto_logout_timeout_minutes,
      global_config.warning_time_minutes,
      global_config.remember_me_duration_hours,
      global_config.enable_fullscreen_expiry_warning;
  ELSE
    -- Default fallback: 4 hours session, 15 min idle, 5 min warning, 24h remember me, warning enabled
    RETURN QUERY SELECT 240, 15, 5, 24, true;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-grant permissions (CREATE OR REPLACE preserves grants, but be explicit)
GRANT EXECUTE ON FUNCTION get_user_session_config(UUID) TO authenticated, service_role;

-- Add column comments
COMMENT ON COLUMN session_timeout_configs.remember_me_duration_hours IS 'Duration in hours that a "Remember Me" session persists before requiring re-authentication';
COMMENT ON COLUMN session_timeout_configs.enable_fullscreen_expiry_warning IS 'Whether to show a fullscreen warning overlay when the session is about to expire';

-- Update table comment
COMMENT ON TABLE session_timeout_configs IS 'Configurable timeout settings per role - Updated 2026-02-05 to add remember_me and fullscreen warning columns';

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 163: Added remember_me_duration_hours and enable_fullscreen_expiry_warning columns to session_timeout_configs';
END $$;
