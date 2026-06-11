-- Migration: Optimized Authentication Functions
-- Date: 2025-01-30
-- Description: Creates high-performance RPC functions for unified auth system

-- Function to get all user permissions as simple strings for fast caching
CREATE OR REPLACE FUNCTION get_user_permissions_fast(p_user_id UUID)
RETURNS TABLE(permission_key TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE role_chain AS (
    -- Get user's direct role
    SELECT
      r.id,
      r.name,
      r.parent_role_id,
      0 as level,
      ARRAY[r.id] as path
    FROM roles r
    JOIN user_profiles up ON up.role_id = r.id
    WHERE up.id = p_user_id AND r.is_active = true

    UNION ALL

    -- Get parent roles recursively
    SELECT
      r.id,
      r.name,
      r.parent_role_id,
      rc.level + 1,
      rc.path || r.id
    FROM roles r
    JOIN role_chain rc ON r.id = rc.parent_role_id
    WHERE r.is_active = true
      AND rc.level < 10 -- Prevent infinite recursion
      AND NOT r.id = ANY(rc.path) -- Prevent cycles
  ),
  -- Get all permissions from role chain
  role_permissions AS (
    SELECT DISTINCT
      CONCAT(p.resource, ':', p.action) as permission_key
    FROM role_chain rc
    JOIN role_permissions rp ON rp.role_id = rc.id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE p.is_active = true
  ),
  -- Get direct user permissions
  direct_permissions AS (
    SELECT
      CONCAT(p.resource, ':', p.action) as permission_key
    FROM user_permissions up
    JOIN permissions p ON p.id = up.permission_id
    WHERE up.user_id = p_user_id
      AND up.granted = true
      AND p.is_active = true
      AND (up.expires_at IS NULL OR up.expires_at > NOW())
  )
  -- Combine role and direct permissions, remove duplicates
  SELECT DISTINCT permission_key
  FROM (
    SELECT * FROM role_permissions
    UNION ALL
    SELECT * FROM direct_permissions
  ) all_permissions
  ORDER BY permission_key;
END;
$$;

-- Function to check specific permission with minimal overhead
CREATE OR REPLACE FUNCTION check_user_permission_fast(
  p_user_id UUID,
  p_resource VARCHAR,
  p_action VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_granted BOOLEAN := FALSE;
BEGIN
  -- Check inherited permissions first (most common case)
  SELECT EXISTS(
    SELECT 1
    FROM get_user_inherited_permissions(p_user_id)
    WHERE (resource = p_resource OR resource = '*')
      AND (action = p_action OR action = '*')
  ) INTO v_granted;

  -- If not found, check direct user permissions
  IF NOT v_granted THEN
    SELECT EXISTS(
      SELECT 1
      FROM user_permissions up
      JOIN permissions p ON p.id = up.permission_id
      WHERE up.user_id = p_user_id
        AND up.granted = true
        AND p.is_active = true
        AND (p.resource = p_resource OR p.resource = '*')
        AND (p.action = p_action OR p.action = '*')
        AND (up.expires_at IS NULL OR up.expires_at > NOW())
    ) INTO v_granted;
  END IF;

  RETURN v_granted;
END;
$$;

-- Function to get user role information with hierarchy
CREATE OR REPLACE FUNCTION get_user_role_info(p_user_id UUID)
RETURNS TABLE(
  role_id UUID,
  role_name VARCHAR,
  role_display_name VARCHAR,
  is_system BOOLEAN,
  is_active BOOLEAN,
  hierarchy_level INTEGER,
  parent_role_id UUID,
  features JSONB,
  permissions_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE role_chain AS (
    -- Get user's direct role
    SELECT
      r.id,
      r.name,
      r.display_name,
      r.is_system,
      r.is_active,
      r.parent_role_id,
      0 as level,
      ARRAY[r.id] as path,
      r.features
    FROM roles r
    JOIN user_profiles up ON up.role_id = r.id
    WHERE up.id = p_user_id AND r.is_active = true

    UNION ALL

    -- Get parent roles recursively
    SELECT
      r.id,
      r.name,
      r.display_name,
      r.is_system,
      r.is_active,
      r.parent_role_id,
      rc.level + 1,
      rc.path || r.id,
      r.features
    FROM roles r
    JOIN role_chain rc ON r.id = rc.parent_role_id
    WHERE r.is_active = true
      AND rc.level < 10 -- Prevent infinite recursion
      AND NOT r.id = ANY(rc.path) -- Prevent cycles
  )
  SELECT
    rc.id,
    rc.name,
    rc.display_name,
    rc.is_system,
    rc.is_active,
    rc.level,
    rc.parent_role_id,
    rc.features,
    COUNT(rp.permission_id)::INTEGER as permissions_count
  FROM role_chain rc
  LEFT JOIN role_permissions rp ON rp.role_id = rc.id
  GROUP BY rc.id, rc.name, rc.display_name, rc.is_system, rc.is_active, rc.level, rc.parent_role_id, rc.features
  ORDER BY rc.level ASC;
END;
$$;

-- Function to get user session information for audit
CREATE OR REPLACE FUNCTION get_user_session_info(p_user_id UUID)
RETURNS TABLE(
  session_id TEXT,
  created_at TIMESTAMPTZ,
  last_activity TIMESTAMPTZ,
  ip_address INET,
  user_agent TEXT,
  is_current BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    us.token_hash as session_id,
    us.created_at,
    us.last_activity,
    us.ip_address::INET,
    us.user_agent,
    FALSE as is_current -- We'll handle current session logic in application
  FROM user_sessions us
  WHERE us.user_id = p_user_id
    AND us.expires_at > NOW()
  ORDER BY us.last_activity DESC NULLS LAST
  LIMIT 10; -- Last 10 sessions for audit
END;
$$;

-- Function to invalidate user permission cache (call after role/permission changes)
CREATE OR REPLACE FUNCTION invalidate_user_permission_cache(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- This is a placeholder for cache invalidation
  -- In a real system, this might trigger cache clearing in Redis or similar
  -- For now, we'll just log the invalidation
  INSERT INTO audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    details,
    ip_address,
    user_agent,
    session_id
  ) VALUES (
    p_user_id,
    'cache_invalidated',
    'permissions',
    p_user_id,
    jsonb_build_object('reason', 'permission_change'),
    inet_client_addr(),
    current_setting('request.headers')::jsonb->>'user-agent',
    current_setting('request.jwt.claims')::jsonb->>'session_id'
  );
END;
$$;

-- Function to log permission usage for analytics
CREATE OR REPLACE FUNCTION log_permission_usage(
  p_user_id UUID,
  p_resource VARCHAR,
  p_action VARCHAR,
  p_granted BOOLEAN,
  p_context JSONB DEFAULT '{}'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    details,
    ip_address,
    user_agent,
    session_id
  ) VALUES (
    p_user_id,
    'permission_check',
    'permission',
    NULL,
    jsonb_build_object(
      'resource', p_resource,
      'action', p_action,
      'granted', p_granted,
      'context', p_context
    ),
    inet_client_addr(),
    current_setting('request.headers')::jsonb->>'user-agent',
    current_setting('request.jwt.claims')::jsonb->>'session_id'
  );
END;
$$;

-- Function to get user authentication status with all relevant info
CREATE OR REPLACE FUNCTION get_user_auth_status(p_user_id UUID)
RETURNS TABLE(
  user_id UUID,
  email VARCHAR,
  role_name VARCHAR,
  is_active BOOLEAN,
  email_verified BOOLEAN,
  two_factor_enabled BOOLEAN,
  last_login TIMESTAMPTZ,
  permissions_count INTEGER,
  active_sessions INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    up.id,
    up.email,
    r.name as role_name,
    up.status = 'active' as is_active,
    up.email_verified,
    up.two_factor_enabled,
    up.last_seen as last_login,
    (SELECT COUNT(*)::INTEGER FROM get_user_permissions_fast(p_user_id)) as permissions_count,
    (SELECT COUNT(*)::INTEGER FROM user_sessions WHERE user_id = p_user_id AND expires_at > NOW()) as active_sessions
  FROM user_profiles up
  LEFT JOIN roles r ON up.role_id = r.id
  WHERE up.id = p_user_id;
END;
$$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_permissions_resource_action ON permissions(resource, action) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_permissions_user_granted ON user_permissions(user_id, granted) WHERE granted = true;
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_expires ON user_sessions(user_id, expires_at) WHERE expires_at > NOW();
CREATE INDEX IF NOT EXISTS idx_user_profiles_role_active ON user_profiles(role_id, status) WHERE status = 'active';
