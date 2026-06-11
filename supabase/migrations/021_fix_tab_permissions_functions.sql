-- Migration: Fix Tab Permissions Functions
-- Date: 2025-01-21 (January 21, 2025)
-- Description: Adds missing check_user_tab_permission function and fixes parameter naming

-- Create the missing check_user_tab_permission function
CREATE OR REPLACE FUNCTION check_user_tab_permission(
  p_user_id UUID,
  p_page_resource VARCHAR,
  p_tab_id VARCHAR
)
RETURNS BOOLEAN AS $$
DECLARE
  user_role_id UUID;
  permission_granted BOOLEAN;
BEGIN
  -- Get user's role_id
  SELECT up.role_id INTO user_role_id 
  FROM user_profiles up 
  WHERE up.id = p_user_id;
  
  -- If no role found, deny access
  IF user_role_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Check if there's an explicit permission for this role and tab
  SELECT rtp.granted INTO permission_granted
  FROM tab_definitions td
  JOIN role_tab_permissions rtp ON td.id = rtp.tab_definition_id
  WHERE td.page_resource = p_page_resource
    AND td.tab_id = p_tab_id
    AND td.is_active = true
    AND rtp.role_id = user_role_id;
  
  -- If explicit permission found, return it
  IF permission_granted IS NOT NULL THEN
    RETURN permission_granted;
  END IF;
  
  -- If no explicit permission, check if tab exists and default to true
  RETURN EXISTS (
    SELECT 1 FROM tab_definitions td
    WHERE td.page_resource = p_page_resource
      AND td.tab_id = p_tab_id
      AND td.is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update the get_user_tab_permissions function to use proper parameter naming
CREATE OR REPLACE FUNCTION get_user_tab_permissions(
  p_user_id UUID,
  p_page_resource VARCHAR DEFAULT NULL
)
RETURNS TABLE(
  tab_definition_id UUID,
  page_resource VARCHAR,
  tab_id VARCHAR,
  tab_label VARCHAR,
  description TEXT,
  display_order INTEGER,
  granted BOOLEAN
) AS $$
DECLARE
  user_role_id UUID;
BEGIN
  -- Get user's role_id
  SELECT up.role_id INTO user_role_id 
  FROM user_profiles up 
  WHERE up.id = p_user_id;
  
  -- If no role found, return empty result
  IF user_role_id IS NULL THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    td.id as tab_definition_id,
    td.page_resource,
    td.tab_id,
    td.tab_label,
    td.description,
    td.display_order,
    CASE 
      WHEN rtp.granted IS NOT NULL THEN rtp.granted
      ELSE true
    END as granted
  FROM tab_definitions td
  LEFT JOIN role_tab_permissions rtp ON (td.id = rtp.tab_definition_id AND rtp.role_id = user_role_id)
  WHERE td.is_active = true
    AND (p_page_resource IS NULL OR td.page_resource = p_page_resource)
  ORDER BY td.page_resource, td.display_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions on the new function
GRANT EXECUTE ON FUNCTION check_user_tab_permission(UUID, VARCHAR, VARCHAR) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_user_tab_permissions(UUID, VARCHAR) TO authenticated, service_role;

-- Add comments for documentation
COMMENT ON FUNCTION check_user_tab_permission(UUID, VARCHAR, VARCHAR) IS 'Checks if a user has permission for a specific tab';
COMMENT ON FUNCTION get_user_tab_permissions(UUID, VARCHAR) IS 'Returns tab permissions for a specific user with proper parameter naming';

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 021: Tab permissions functions fixed successfully';
  RAISE NOTICE 'Added check_user_tab_permission function';
  RAISE NOTICE 'Updated get_user_tab_permissions function with proper parameter naming';
END $$;
