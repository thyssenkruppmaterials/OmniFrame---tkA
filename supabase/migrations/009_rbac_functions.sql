-- Migration: RBAC Functions and Enhanced Permission Checking
-- Date: 2025-01-21
-- Description: Creates comprehensive database functions for enhanced RBAC system

-- Function to get all inherited permissions for a user through role hierarchy
CREATE OR REPLACE FUNCTION get_user_inherited_permissions(p_user_id UUID)
RETURNS TABLE(
  permission_id UUID,
  resource VARCHAR,
  action VARCHAR,
  source VARCHAR,
  role_name VARCHAR,
  role_level INTEGER,
  is_critical BOOLEAN,
  requires_2fa BOOLEAN,
  risk_level VARCHAR
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
  role_permissions_expanded AS (
    SELECT DISTINCT 
      p.id as permission_id,
      p.resource,
      p.action,
      'role:' || rc.name as source,
      rc.name as role_name,
      rc.level as role_level,
      p.is_critical,
      p.requires_2fa,
      p.risk_level
    FROM role_chain rc
    JOIN role_permissions rp ON rp.role_id = rc.id
    JOIN permissions p ON p.id = rp.permission_id
  ),
  -- Get direct user permissions
  direct_permissions AS (
    SELECT 
      p.id as permission_id,
      p.resource,
      p.action,
      'direct' as source,
      'user' as role_name,
      -1 as role_level,
      p.is_critical,
      p.requires_2fa,
      p.risk_level
    FROM user_permissions up
    JOIN permissions p ON p.id = up.permission_id
    WHERE up.user_id = p_user_id
      AND up.granted = true
      AND (up.expires_at IS NULL OR up.expires_at > NOW())
  )
  -- Combine role and direct permissions
  SELECT * FROM role_permissions_expanded
  UNION
  SELECT * FROM direct_permissions
  ORDER BY role_level ASC, resource ASC, action ASC;
END;
$$;

-- Function to check specific permission with detailed context and logging
CREATE OR REPLACE FUNCTION check_permission_with_context(
  p_user_id UUID,
  p_resource VARCHAR,
  p_action VARCHAR,
  p_context JSONB DEFAULT '{}'
)
RETURNS TABLE(
  granted BOOLEAN,
  source VARCHAR,
  role_sources VARCHAR[],
  requires_2fa BOOLEAN,
  risk_level VARCHAR,
  check_duration_ms INTEGER
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_granted BOOLEAN := FALSE;
  v_source VARCHAR := 'none';
  v_role_sources VARCHAR[] := '{}';
  v_requires_2fa BOOLEAN := FALSE;
  v_risk_level VARCHAR := 'low';
  v_start_time TIMESTAMPTZ;
  v_duration_ms INTEGER;
  v_permission_id UUID;
BEGIN
  v_start_time := clock_timestamp();
  
  -- Get permission details
  SELECT id, requires_2fa, risk_level 
  INTO v_permission_id, v_requires_2fa, v_risk_level
  FROM permissions 
  WHERE resource = p_resource AND action = p_action;
  
  -- Check inherited permissions first
  SELECT 
    bool_or(true),
    'inherited',
    array_agg(DISTINCT role_name ORDER BY role_name)
  INTO v_granted, v_source, v_role_sources
  FROM get_user_inherited_permissions(p_user_id)
  WHERE (resource = p_resource OR resource = '*')
    AND (action = p_action OR action = '*');
  
  -- If not found through inheritance, check wildcards more broadly
  IF NOT v_granted THEN
    SELECT EXISTS(
      SELECT 1
      FROM get_user_inherited_permissions(p_user_id)
      WHERE resource = '*' AND action = '*'
    ) INTO v_granted;
    
    IF v_granted THEN
      v_source := 'wildcard';
      v_role_sources := ARRAY['*'];
    END IF;
  END IF;
  
  -- Calculate execution time
  v_duration_ms := EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time)) * 1000;
  
  -- Log the permission check (async to avoid slowing down the check)
  PERFORM log_permission_usage(
    p_user_id,
    v_permission_id,
    p_resource,
    p_action,
    (p_context->>'resource_id')::UUID,
    v_granted,
    'inherited',
    v_duration_ms,
    p_context,
    p_context->>'session_id'
  );
  
  RETURN QUERY SELECT 
    v_granted,
    v_source,
    COALESCE(v_role_sources, '{}'),
    COALESCE(v_requires_2fa, FALSE),
    COALESCE(v_risk_level, 'low'),
    v_duration_ms;
END;
$$;

-- Function to get role hierarchy with full details
CREATE OR REPLACE FUNCTION get_role_hierarchy_detailed(p_role_id UUID DEFAULT NULL)
RETURNS TABLE(
  id UUID,
  name VARCHAR,
  display_name VARCHAR,
  description TEXT,
  parent_role_id UUID,
  priority INTEGER,
  max_users INTEGER,
  features JSONB,
  metadata JSONB,
  is_system BOOLEAN,
  is_active BOOLEAN,
  level INTEGER,
  path UUID[],
  name_path VARCHAR[],
  depth INTEGER,
  user_count BIGINT,
  permission_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rh.id,
    rh.name,
    r.display_name,
    r.description,
    rh.parent_role_id,
    r.priority,
    r.max_users,
    r.features,
    r.metadata,
    r.is_system,
    r.is_active,
    rh.level,
    rh.path,
    rh.name_path,
    rh.depth,
    COALESCE(uc.user_count, 0) as user_count,
    COALESCE(pc.permission_count, 0) as permission_count
  FROM role_hierarchy rh
  JOIN roles r ON rh.id = r.id
  LEFT JOIN (
    SELECT role_id, COUNT(*) as user_count
    FROM user_profiles
    WHERE deleted_at IS NULL
    GROUP BY role_id
  ) uc ON r.id = uc.role_id
  LEFT JOIN (
    SELECT role_id, COUNT(*) as permission_count
    FROM role_permissions
    GROUP BY role_id
  ) pc ON r.id = pc.role_id
  WHERE (p_role_id IS NULL OR rh.id = p_role_id OR rh.path @> ARRAY[p_role_id])
  ORDER BY rh.level, r.priority DESC, r.name;
END;
$$;

-- Function to validate role hierarchy changes
CREATE OR REPLACE FUNCTION validate_role_hierarchy_change(
  p_role_id UUID,
  p_new_parent_id UUID
)
RETURNS TABLE(
  is_valid BOOLEAN,
  error_message TEXT,
  affected_users INTEGER,
  permission_changes INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_valid BOOLEAN := TRUE;
  v_error_message TEXT := NULL;
  v_affected_users INTEGER := 0;
  v_permission_changes INTEGER := 0;
BEGIN
  -- Check if the new parent would create a cycle
  IF p_new_parent_id IS NOT NULL THEN
    IF check_role_circular_dependency(p_role_id, p_new_parent_id) THEN
      v_is_valid := FALSE;
      v_error_message := 'This change would create a circular dependency in the role hierarchy';
    END IF;
  END IF;
  
  -- Count affected users
  SELECT COUNT(*) INTO v_affected_users
  FROM user_profiles
  WHERE role_id = p_role_id AND deleted_at IS NULL;
  
  -- Estimate permission changes (simplified calculation)
  SELECT COUNT(*) INTO v_permission_changes
  FROM role_permissions
  WHERE role_id = p_role_id;
  
  RETURN QUERY SELECT v_is_valid, v_error_message, v_affected_users, v_permission_changes;
END;
$$;

-- Function to bulk assign permissions with validation
CREATE OR REPLACE FUNCTION bulk_assign_permissions(
  p_target_type VARCHAR, -- 'user' or 'role'
  p_target_id UUID,
  p_permission_ids UUID[],
  p_granted BOOLEAN DEFAULT TRUE,
  p_reason TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(
  success_count INTEGER,
  error_count INTEGER,
  errors JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_success_count INTEGER := 0;
  v_error_count INTEGER := 0;
  v_errors JSONB := '[]'::jsonb;
  v_permission_id UUID;
  v_error_info JSONB;
BEGIN
  -- Validate target exists
  IF p_target_type = 'user' THEN
    IF NOT EXISTS(SELECT 1 FROM user_profiles WHERE id = p_target_id) THEN
      RETURN QUERY SELECT 0, 1, '["Target user not found"]'::jsonb;
      RETURN;
    END IF;
  ELSIF p_target_type = 'role' THEN
    IF NOT EXISTS(SELECT 1 FROM roles WHERE id = p_target_id) THEN
      RETURN QUERY SELECT 0, 1, '["Target role not found"]'::jsonb;
      RETURN;
    END IF;
  ELSE
    RETURN QUERY SELECT 0, 1, '["Invalid target type"]'::jsonb;
    RETURN;
  END IF;

  -- Process each permission
  FOREACH v_permission_id IN ARRAY p_permission_ids
  LOOP
    BEGIN
      -- Validate permission exists
      IF NOT EXISTS(SELECT 1 FROM permissions WHERE id = v_permission_id) THEN
        v_error_info := jsonb_build_object(
          'permission_id', v_permission_id,
          'error', 'Permission not found'
        );
        v_errors := v_errors || jsonb_build_array(v_error_info);
        v_error_count := v_error_count + 1;
        CONTINUE;
      END IF;

      -- Assign permission based on target type
      IF p_target_type = 'user' THEN
        -- Validate dependencies if granting
        IF p_granted THEN
          DECLARE
            v_validation RECORD;
          BEGIN
            SELECT * INTO v_validation FROM validate_permission_assignment(p_target_id, v_permission_id);
            
            IF NOT v_validation.is_valid THEN
              v_error_info := jsonb_build_object(
                'permission_id', v_permission_id,
                'error', 'Validation failed',
                'missing_dependencies', v_validation.missing_dependencies,
                'conflicts', v_validation.conflicting_permissions
              );
              v_errors := v_errors || jsonb_build_array(v_error_info);
              v_error_count := v_error_count + 1;
              CONTINUE;
            END IF;
          END;
        END IF;

        -- Insert or update user permission
        INSERT INTO user_permissions (user_id, permission_id, granted, expires_at, metadata)
        VALUES (p_target_id, v_permission_id, p_granted, p_expires_at, jsonb_build_object('reason', p_reason))
        ON CONFLICT (user_id, permission_id) 
        DO UPDATE SET 
          granted = EXCLUDED.granted,
          expires_at = EXCLUDED.expires_at,
          metadata = EXCLUDED.metadata,
          created_at = NOW();
          
      ELSIF p_target_type = 'role' THEN
        -- Get role enum value for role_permissions table
        DECLARE
          v_role_enum VARCHAR;
        BEGIN
          SELECT name INTO v_role_enum FROM roles WHERE id = p_target_id;
          
          IF p_granted THEN
            -- Add permission to role
            INSERT INTO role_permissions (role_id, permission_id, role)
            VALUES (p_target_id, v_permission_id, v_role_enum)
            ON CONFLICT (role_id, permission_id) DO NOTHING;
          ELSE
            -- Remove permission from role
            DELETE FROM role_permissions 
            WHERE role_id = p_target_id AND permission_id = v_permission_id;
          END IF;
        END;
      END IF;
      
      v_success_count := v_success_count + 1;
      
    EXCEPTION WHEN OTHERS THEN
      v_error_info := jsonb_build_object(
        'permission_id', v_permission_id,
        'error', SQLERRM
      );
      v_errors := v_errors || jsonb_build_array(v_error_info);
      v_error_count := v_error_count + 1;
    END;
  END LOOP;
  
  RETURN QUERY SELECT v_success_count, v_error_count, v_errors;
END;
$$;

-- Function to get comprehensive permission analytics
CREATE OR REPLACE FUNCTION get_permission_analytics(
  p_time_range_days INTEGER DEFAULT 30,
  p_organization_id UUID DEFAULT NULL
)
RETURNS TABLE(
  total_permission_checks BIGINT,
  denied_checks BIGINT,
  unique_users BIGINT,
  most_checked_permission VARCHAR,
  most_checked_resource VARCHAR,
  avg_response_time NUMERIC,
  high_risk_denials BIGINT,
  suspicious_activity_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_time_cutoff TIMESTAMPTZ;
BEGIN
  v_time_cutoff := NOW() - INTERVAL '1 day' * p_time_range_days;
  
  RETURN QUERY
  SELECT 
    COUNT(*) as total_permission_checks,
    COUNT(*) FILTER (WHERE granted = false) as denied_checks,
    COUNT(DISTINCT user_id) as unique_users,
    MODE() WITHIN GROUP (ORDER BY permission_name) as most_checked_permission,
    MODE() WITHIN GROUP (ORDER BY resource) as most_checked_resource,
    AVG(response_time_ms)::numeric as avg_response_time,
    COUNT(*) FILTER (WHERE granted = false AND resource IN (
      SELECT resource FROM permissions WHERE risk_level IN ('high', 'critical')
    )) as high_risk_denials,
    (SELECT COUNT(*) FROM rbac_audit_logs 
     WHERE severity IN ('warning', 'error', 'critical') 
     AND created_at >= v_time_cutoff) as suspicious_activity_count
  FROM permission_usage_logs
  WHERE created_at >= v_time_cutoff
    AND (p_organization_id IS NULL OR organization_id = p_organization_id);
END;
$$;

-- Function to cleanup expired permissions automatically
CREATE OR REPLACE FUNCTION cleanup_expired_permissions()
RETURNS TABLE(
  cleaned_user_permissions INTEGER,
  cleaned_sessions INTEGER,
  notified_users UUID[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cleaned_perms INTEGER := 0;
  v_cleaned_sessions INTEGER := 0;
  v_notified_users UUID[] := '{}';
  v_user_id UUID;
BEGIN
  -- Clean expired user permissions
  DELETE FROM user_permissions 
  WHERE expires_at IS NOT NULL AND expires_at <= NOW()
  RETURNING user_id INTO v_user_id;
  
  GET DIAGNOSTICS v_cleaned_perms = ROW_COUNT;
  
  -- Collect unique user IDs for notifications
  SELECT ARRAY_AGG(DISTINCT user_id) INTO v_notified_users
  FROM user_permissions 
  WHERE expires_at IS NOT NULL AND expires_at <= NOW();
  
  -- Clean expired sessions
  DELETE FROM enhanced_user_sessions 
  WHERE expires_at <= NOW() OR revoked_at IS NOT NULL;
  
  GET DIAGNOSTICS v_cleaned_sessions = ROW_COUNT;
  
  -- Log cleanup activity
  PERFORM log_rbac_audit_event(
    NULL, -- System action
    'cleanup',
    'system',
    'cleanup-job'::UUID,
    'Expired Permissions Cleanup',
    NULL,
    jsonb_build_object(
      'cleaned_permissions', v_cleaned_perms,
      'cleaned_sessions', v_cleaned_sessions,
      'affected_users', v_notified_users
    ),
    'Automated cleanup of expired permissions and sessions'
  );
  
  RETURN QUERY SELECT v_cleaned_perms, v_cleaned_sessions, COALESCE(v_notified_users, '{}');
END;
$$;

-- Function to get user's effective role features
CREATE OR REPLACE FUNCTION get_user_effective_features(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_features JSONB := '{}'::jsonb;
  v_role_features JSONB;
BEGIN
  -- Get features from user's role hierarchy
  WITH role_chain AS (
    SELECT 
      r.features,
      rh.level
    FROM user_profiles up
    JOIN roles r ON up.role_id = r.id
    JOIN role_hierarchy rh ON rh.id = r.id
    WHERE up.id = p_user_id AND r.is_active = true
    
    UNION
    
    SELECT 
      pr.features,
      rh.level
    FROM user_profiles up
    JOIN roles ur ON up.role_id = ur.id
    JOIN role_hierarchy rh ON ur.id = ANY(rh.path)
    JOIN roles pr ON pr.id = rh.id
    WHERE up.id = p_user_id AND pr.is_active = true
  )
  SELECT jsonb_object_agg(key, value::boolean) INTO v_features
  FROM (
    SELECT DISTINCT key, value
    FROM role_chain rc,
    jsonb_each(rc.features)
    WHERE value::boolean = true
  ) combined_features;
  
  RETURN COALESCE(v_features, '{}'::jsonb);
END;
$$;

-- Function to simulate permission check for testing
CREATE OR REPLACE FUNCTION simulate_permission_check(
  p_user_id UUID,
  p_permissions JSONB -- Array of {resource, action} objects
)
RETURNS TABLE(
  resource VARCHAR,
  action VARCHAR,
  granted BOOLEAN,
  source VARCHAR,
  requires_2fa BOOLEAN,
  missing_dependencies UUID[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_permission JSONB;
  v_resource VARCHAR;
  v_action VARCHAR;
  v_result RECORD;
  v_validation RECORD;
BEGIN
  -- Process each permission check
  FOR v_permission IN SELECT jsonb_array_elements(p_permissions)
  LOOP
    v_resource := v_permission->>'resource';
    v_action := v_permission->>'action';
    
    -- Get check result
    SELECT * INTO v_result
    FROM check_permission_with_context(p_user_id, v_resource, v_action);
    
    -- Get validation info
    DECLARE
      v_perm_id UUID;
    BEGIN
      SELECT id INTO v_perm_id FROM permissions WHERE resource = v_resource AND action = v_action;
      
      IF v_perm_id IS NOT NULL THEN
        SELECT * INTO v_validation FROM validate_permission_assignment(p_user_id, v_perm_id);
      END IF;
    END;
    
    RETURN QUERY SELECT 
      v_resource,
      v_action,
      COALESCE(v_result.granted, false),
      COALESCE(v_result.source, 'none'),
      COALESCE(v_result.requires_2fa, false),
      COALESCE(v_validation.missing_dependencies, '{}');
  END LOOP;
END;
$$;

-- Function to get permission usage statistics
CREATE OR REPLACE FUNCTION get_permission_usage_stats(
  p_user_id UUID DEFAULT NULL,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE(
  permission_name VARCHAR,
  resource VARCHAR,
  action VARCHAR,
  total_checks BIGINT,
  granted_checks BIGINT,
  denied_checks BIGINT,
  avg_response_time NUMERIC,
  last_used TIMESTAMPTZ,
  risk_score NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_time_cutoff TIMESTAMPTZ;
BEGIN
  v_time_cutoff := NOW() - INTERVAL '1 day' * p_days;
  
  RETURN QUERY
  SELECT 
    pul.permission_name,
    pul.resource,
    pul.action,
    COUNT(*) as total_checks,
    COUNT(*) FILTER (WHERE pul.granted = true) as granted_checks,
    COUNT(*) FILTER (WHERE pul.granted = false) as denied_checks,
    AVG(pul.response_time_ms)::numeric as avg_response_time,
    MAX(pul.created_at) as last_used,
    -- Risk score based on denial rate and permission risk level
    CASE 
      WHEN COUNT(*) = 0 THEN 0
      ELSE (COUNT(*) FILTER (WHERE pul.granted = false)::numeric / COUNT(*)::numeric) * 
           CASE p.risk_level
             WHEN 'critical' THEN 100
             WHEN 'high' THEN 75
             WHEN 'medium' THEN 50
             ELSE 25
           END
    END as risk_score
  FROM permission_usage_logs pul
  LEFT JOIN permissions p ON pul.permission_id = p.id
  WHERE pul.created_at >= v_time_cutoff
    AND (p_user_id IS NULL OR pul.user_id = p_user_id)
  GROUP BY pul.permission_name, pul.resource, pul.action, p.risk_level
  ORDER BY total_checks DESC, risk_score DESC;
END;
$$;

-- Grant appropriate permissions on all new functions
GRANT EXECUTE ON FUNCTION get_user_inherited_permissions(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION check_permission_with_context(UUID, VARCHAR, VARCHAR, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_role_hierarchy_detailed(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION validate_role_hierarchy_change(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION bulk_assign_permissions(VARCHAR, UUID, UUID[], BOOLEAN, TEXT, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_user_effective_features(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION simulate_permission_check(UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_permission_usage_stats(UUID, INTEGER) TO authenticated, service_role;

-- Only service role can execute cleanup functions
GRANT EXECUTE ON FUNCTION cleanup_expired_permissions() TO service_role;

-- Create indexes for better performance on audit and usage tables
CREATE INDEX IF NOT EXISTS idx_rbac_audit_logs_composite ON rbac_audit_logs(actor_id, action, created_at);
CREATE INDEX IF NOT EXISTS idx_permission_usage_logs_composite ON permission_usage_logs(user_id, resource, action, created_at);
CREATE INDEX IF NOT EXISTS idx_user_permissions_expires_at ON user_permissions(expires_at) WHERE expires_at IS NOT NULL;

-- Add helpful comments
COMMENT ON FUNCTION get_user_inherited_permissions IS 'Gets all permissions for a user including inherited permissions from role hierarchy';
COMMENT ON FUNCTION check_permission_with_context IS 'Comprehensive permission check with context logging and performance tracking';
COMMENT ON FUNCTION get_role_hierarchy_detailed IS 'Returns detailed role hierarchy with user counts and permission counts';
COMMENT ON FUNCTION validate_role_hierarchy_change IS 'Validates potential role hierarchy changes before execution';
COMMENT ON FUNCTION bulk_assign_permissions IS 'Safely assigns multiple permissions with validation and error handling';
COMMENT ON FUNCTION get_user_effective_features IS 'Gets combined features from user role hierarchy';
COMMENT ON FUNCTION simulate_permission_check IS 'Simulates permission checks for testing and validation';
COMMENT ON FUNCTION get_permission_usage_stats IS 'Returns detailed permission usage analytics';
COMMENT ON FUNCTION cleanup_expired_permissions IS 'Automated cleanup of expired permissions and sessions';

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 009: RBAC functions and enhanced permission checking completed successfully';
END $$;
