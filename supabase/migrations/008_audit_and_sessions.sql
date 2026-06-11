-- Migration: Enhanced Audit and Session Management
-- Date: 2025-01-21
-- Description: Adds comprehensive audit logging and session management for RBAC

-- Enhanced audit log for RBAC changes with detailed tracking
CREATE TABLE IF NOT EXISTS rbac_audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL,
  target_type VARCHAR(50) NOT NULL, -- 'role', 'permission', 'user_role', etc.
  target_id UUID NOT NULL,
  target_name VARCHAR(255), -- Store name for reference even if target is deleted
  old_value JSONB,
  new_value JSONB,
  changes JSONB, -- Specific field changes for updates
  reason TEXT,
  ip_address INET,
  user_agent TEXT,
  session_id TEXT,
  request_id TEXT,
  organization_id UUID REFERENCES organizations(id),
  severity VARCHAR(20) DEFAULT 'info',
  success BOOLEAN DEFAULT TRUE,
  error_message TEXT,
  execution_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add constraints for audit log severity
ALTER TABLE rbac_audit_logs ADD CONSTRAINT rbac_audit_severity_check 
  CHECK (severity IN ('info', 'warning', 'error', 'critical'));

-- Add constraints for audit log actions
ALTER TABLE rbac_audit_logs ADD CONSTRAINT rbac_audit_action_check 
  CHECK (action IN (
    'create', 'update', 'delete', 'assign', 'revoke', 'grant', 'deny',
    'login', 'logout', 'password_change', 'role_change', 'permission_check',
    'bulk_update', 'import', 'export', 'restore', 'backup'
  ));

-- Add constraints for target types
ALTER TABLE rbac_audit_logs ADD CONSTRAINT rbac_audit_target_type_check 
  CHECK (target_type IN (
    'role', 'permission', 'user_role', 'user_permission', 'role_permission',
    'user_profile', 'organization', 'navigation_item', 'category', 'tag'
  ));

-- Add indexes for audit logs
CREATE INDEX IF NOT EXISTS idx_rbac_audit_logs_actor_id ON rbac_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_logs_target ON rbac_audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_logs_action ON rbac_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_logs_created_at ON rbac_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_logs_organization ON rbac_audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_logs_severity ON rbac_audit_logs(severity);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_logs_session ON rbac_audit_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_logs_ip ON rbac_audit_logs(ip_address);

-- Permission usage tracking for analytics and monitoring
CREATE TABLE IF NOT EXISTS permission_usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  permission_id UUID REFERENCES permissions(id) ON DELETE SET NULL,
  permission_name VARCHAR(255), -- Store name for reference
  resource VARCHAR(100),
  action VARCHAR(100),
  resource_id UUID,
  granted BOOLEAN NOT NULL,
  check_method VARCHAR(50) DEFAULT 'direct', -- 'direct', 'inherited', 'cached'
  response_time_ms INTEGER,
  context JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  session_id TEXT,
  request_path TEXT,
  organization_id UUID REFERENCES organizations(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add constraints for permission usage logs
ALTER TABLE permission_usage_logs ADD CONSTRAINT permission_usage_check_method_check 
  CHECK (check_method IN ('direct', 'inherited', 'cached', 'api', 'middleware'));

-- Add indexes for permission usage logs
CREATE INDEX IF NOT EXISTS idx_permission_usage_logs_user_id ON permission_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_permission_usage_logs_permission_id ON permission_usage_logs(permission_id);
CREATE INDEX IF NOT EXISTS idx_permission_usage_logs_granted ON permission_usage_logs(granted);
CREATE INDEX IF NOT EXISTS idx_permission_usage_logs_created_at ON permission_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_permission_usage_logs_resource ON permission_usage_logs(resource, action);
CREATE INDEX IF NOT EXISTS idx_permission_usage_logs_organization ON permission_usage_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_permission_usage_logs_session ON permission_usage_logs(session_id);

-- Enhanced user sessions table with security tracking
CREATE TABLE IF NOT EXISTS enhanced_user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_token_hash VARCHAR(255) UNIQUE NOT NULL,
  refresh_token_hash VARCHAR(255),
  ip_address INET NOT NULL,
  user_agent TEXT,
  device_fingerprint TEXT,
  location_country VARCHAR(2),
  location_city VARCHAR(100),
  is_mobile BOOLEAN DEFAULT FALSE,
  is_trusted_device BOOLEAN DEFAULT FALSE,
  login_method VARCHAR(50) DEFAULT 'password',
  mfa_verified BOOLEAN DEFAULT FALSE,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id),
  revoke_reason VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add constraints for login methods
ALTER TABLE enhanced_user_sessions ADD CONSTRAINT enhanced_sessions_login_method_check 
  CHECK (login_method IN ('password', 'oauth', 'sso', 'magic_link', 'otp', 'biometric'));

-- Add indexes for enhanced sessions
CREATE INDEX IF NOT EXISTS idx_enhanced_sessions_user_id ON enhanced_user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_enhanced_sessions_token_hash ON enhanced_user_sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_enhanced_sessions_active ON enhanced_user_sessions(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_enhanced_sessions_ip ON enhanced_user_sessions(ip_address);
CREATE INDEX IF NOT EXISTS idx_enhanced_sessions_last_activity ON enhanced_user_sessions(last_activity);
CREATE INDEX IF NOT EXISTS idx_enhanced_sessions_device ON enhanced_user_sessions(device_fingerprint);

-- Failed authentication attempts tracking
CREATE TABLE IF NOT EXISTS failed_auth_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255),
  ip_address INET NOT NULL,
  user_agent TEXT,
  attempt_type VARCHAR(50) NOT NULL, -- 'login', 'password_reset', 'mfa', etc.
  failure_reason VARCHAR(100) NOT NULL,
  blocked_until TIMESTAMPTZ,
  organization_id UUID REFERENCES organizations(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add constraints for attempt types
ALTER TABLE failed_auth_attempts ADD CONSTRAINT failed_auth_attempt_type_check 
  CHECK (attempt_type IN ('login', 'password_reset', 'mfa', 'token_refresh', 'api_key'));

-- Add indexes for failed auth attempts
CREATE INDEX IF NOT EXISTS idx_failed_auth_attempts_ip ON failed_auth_attempts(ip_address);
CREATE INDEX IF NOT EXISTS idx_failed_auth_attempts_email ON failed_auth_attempts(email);
CREATE INDEX IF NOT EXISTS idx_failed_auth_attempts_created_at ON failed_auth_attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_failed_auth_attempts_blocked ON failed_auth_attempts(blocked_until) WHERE blocked_until IS NOT NULL;

-- Permission cache invalidation tracking
CREATE TABLE IF NOT EXISTS permission_cache_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  cache_type VARCHAR(50) NOT NULL, -- 'user_permissions', 'role_permissions', 'global'
  event_type VARCHAR(50) NOT NULL, -- 'invalidate', 'refresh', 'miss', 'hit'
  cache_key VARCHAR(255),
  reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add constraints for cache events
ALTER TABLE permission_cache_events ADD CONSTRAINT permission_cache_type_check 
  CHECK (cache_type IN ('user_permissions', 'role_permissions', 'global', 'navigation', 'features'));

ALTER TABLE permission_cache_events ADD CONSTRAINT permission_cache_event_type_check 
  CHECK (event_type IN ('invalidate', 'refresh', 'miss', 'hit', 'expire', 'clear'));

-- Add indexes for cache events
CREATE INDEX IF NOT EXISTS idx_permission_cache_events_user_id ON permission_cache_events(user_id);
CREATE INDEX IF NOT EXISTS idx_permission_cache_events_type ON permission_cache_events(cache_type, event_type);
CREATE INDEX IF NOT EXISTS idx_permission_cache_events_created_at ON permission_cache_events(created_at);

-- Function to log RBAC audit events
CREATE OR REPLACE FUNCTION log_rbac_audit_event(
  p_actor_id UUID,
  p_action VARCHAR,
  p_target_type VARCHAR,
  p_target_id UUID,
  p_target_name VARCHAR DEFAULT NULL,
  p_old_value JSONB DEFAULT NULL,
  p_new_value JSONB DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_session_id TEXT DEFAULT NULL,
  p_severity VARCHAR DEFAULT 'info'
) RETURNS UUID AS $$
DECLARE
  audit_id UUID;
  user_org_id UUID;
  changes_json JSONB;
BEGIN
  -- Get user's organization
  SELECT organization_id INTO user_org_id 
  FROM user_profiles 
  WHERE id = p_actor_id;
  
  -- Calculate changes if both old and new values exist
  IF p_old_value IS NOT NULL AND p_new_value IS NOT NULL THEN
    SELECT jsonb_object_agg(key, jsonb_build_object(
      'old', p_old_value->key,
      'new', p_new_value->key
    )) INTO changes_json
    FROM jsonb_each(p_new_value)
    WHERE p_old_value->key IS DISTINCT FROM p_new_value->key;
  END IF;

  -- Insert audit log
  INSERT INTO rbac_audit_logs (
    actor_id, action, target_type, target_id, target_name,
    old_value, new_value, changes, reason, ip_address,
    user_agent, session_id, organization_id, severity
  ) VALUES (
    p_actor_id, p_action, p_target_type, p_target_id, p_target_name,
    p_old_value, p_new_value, changes_json, p_reason, p_ip_address,
    p_user_agent, p_session_id, user_org_id, p_severity
  ) RETURNING id INTO audit_id;
  
  RETURN audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log permission usage
CREATE OR REPLACE FUNCTION log_permission_usage(
  p_user_id UUID,
  p_permission_id UUID,
  p_resource VARCHAR,
  p_action VARCHAR,
  p_resource_id UUID DEFAULT NULL,
  p_granted BOOLEAN DEFAULT TRUE,
  p_check_method VARCHAR DEFAULT 'direct',
  p_response_time_ms INTEGER DEFAULT NULL,
  p_context JSONB DEFAULT '{}',
  p_session_id TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  usage_id UUID;
  user_org_id UUID;
  perm_name VARCHAR;
BEGIN
  -- Get user's organization and permission name
  SELECT up.organization_id INTO user_org_id 
  FROM user_profiles up 
  WHERE up.id = p_user_id;
  
  SELECT p.name INTO perm_name 
  FROM permissions p 
  WHERE p.id = p_permission_id;

  -- Insert usage log
  INSERT INTO permission_usage_logs (
    user_id, permission_id, permission_name, resource, action,
    resource_id, granted, check_method, response_time_ms, context,
    session_id, organization_id
  ) VALUES (
    p_user_id, p_permission_id, perm_name, p_resource, p_action,
    p_resource_id, p_granted, p_check_method, p_response_time_ms, p_context,
    p_session_id, user_org_id
  ) RETURNING id INTO usage_id;
  
  RETURN usage_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clean old audit logs (retention policy)
CREATE OR REPLACE FUNCTION cleanup_audit_logs(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
BEGIN
  -- Delete old RBAC audit logs
  DELETE FROM rbac_audit_logs 
  WHERE created_at < NOW() - INTERVAL '1 day' * retention_days;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Delete old permission usage logs (keep less time for performance)
  DELETE FROM permission_usage_logs 
  WHERE created_at < NOW() - INTERVAL '1 day' * (retention_days / 2);
  
  -- Delete old failed auth attempts
  DELETE FROM failed_auth_attempts 
  WHERE created_at < NOW() - INTERVAL '1 day' * 30; -- Keep 30 days
  
  -- Delete old cache events
  DELETE FROM permission_cache_events 
  WHERE created_at < NOW() - INTERVAL '1 day' * 7; -- Keep 7 days
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check for suspicious activity
CREATE OR REPLACE FUNCTION detect_suspicious_activity(
  p_user_id UUID,
  p_time_window_minutes INTEGER DEFAULT 15
) RETURNS TABLE(
  is_suspicious BOOLEAN,
  risk_score INTEGER,
  reasons TEXT[]
) AS $$
DECLARE
  failed_logins INTEGER;
  permission_denials INTEGER;
  multiple_ips INTEGER;
  risk INTEGER := 0;
  reason_list TEXT[] := '{}';
  is_risky BOOLEAN := FALSE;
BEGIN
  -- Check failed login attempts
  SELECT COUNT(*) INTO failed_logins
  FROM failed_auth_attempts faa
  JOIN user_profiles up ON faa.email = up.email
  WHERE up.id = p_user_id
    AND faa.created_at > NOW() - INTERVAL '1 minute' * p_time_window_minutes
    AND faa.attempt_type = 'login';
  
  -- Check permission denials
  SELECT COUNT(*) INTO permission_denials
  FROM permission_usage_logs
  WHERE user_id = p_user_id
    AND granted = false
    AND created_at > NOW() - INTERVAL '1 minute' * p_time_window_minutes;
  
  -- Check multiple IP addresses
  SELECT COUNT(DISTINCT ip_address) INTO multiple_ips
  FROM enhanced_user_sessions
  WHERE user_id = p_user_id
    AND last_activity > NOW() - INTERVAL '1 minute' * p_time_window_minutes
    AND revoked_at IS NULL;
  
  -- Calculate risk score and reasons
  IF failed_logins > 3 THEN
    risk := risk + 40;
    reason_list := reason_list || ARRAY['Multiple failed login attempts'];
  END IF;
  
  IF permission_denials > 10 THEN
    risk := risk + 30;
    reason_list := reason_list || ARRAY['Excessive permission denials'];
  END IF;
  
  IF multiple_ips > 2 THEN
    risk := risk + 25;
    reason_list := reason_list || ARRAY['Multiple concurrent IP addresses'];
  END IF;
  
  is_risky := risk >= 50;
  
  RETURN QUERY SELECT is_risky, risk, reason_list;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create audit trigger for roles table
CREATE OR REPLACE FUNCTION audit_roles_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM log_rbac_audit_event(
      auth.uid(),
      'delete',
      'role',
      OLD.id,
      OLD.name,
      row_to_json(OLD)::jsonb,
      NULL,
      'Role deleted'
    );
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM log_rbac_audit_event(
      auth.uid(),
      'update',
      'role',
      NEW.id,
      NEW.name,
      row_to_json(OLD)::jsonb,
      row_to_json(NEW)::jsonb,
      'Role updated'
    );
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM log_rbac_audit_event(
      auth.uid(),
      'create',
      'role',
      NEW.id,
      NEW.name,
      NULL,
      row_to_json(NEW)::jsonb,
      'Role created'
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create audit trigger for role_permissions table
CREATE OR REPLACE FUNCTION audit_role_permissions_changes()
RETURNS TRIGGER AS $$
DECLARE
  role_name VARCHAR;
  perm_name VARCHAR;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT r.name, p.name INTO role_name, perm_name
    FROM roles r, permissions p
    WHERE r.id = OLD.role_id AND p.id = OLD.permission_id;
    
    PERFORM log_rbac_audit_event(
      auth.uid(),
      'revoke',
      'role_permission',
      OLD.role_id,
      role_name || ' -> ' || perm_name,
      row_to_json(OLD)::jsonb,
      NULL,
      'Permission revoked from role'
    );
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT r.name, p.name INTO role_name, perm_name
    FROM roles r, permissions p
    WHERE r.id = NEW.role_id AND p.id = NEW.permission_id;
    
    PERFORM log_rbac_audit_event(
      auth.uid(),
      'grant',
      'role_permission',
      NEW.role_id,
      role_name || ' -> ' || perm_name,
      NULL,
      row_to_json(NEW)::jsonb,
      'Permission granted to role'
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create audit trigger for user_permissions table
CREATE OR REPLACE FUNCTION audit_user_permissions_changes()
RETURNS TRIGGER AS $$
DECLARE
  user_email VARCHAR;
  perm_name VARCHAR;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT up.email, p.name INTO user_email, perm_name
    FROM user_profiles up, permissions p
    WHERE up.id = OLD.user_id AND p.id = OLD.permission_id;
    
    PERFORM log_rbac_audit_event(
      auth.uid(),
      'revoke',
      'user_permission',
      OLD.user_id,
      user_email || ' -> ' || perm_name,
      row_to_json(OLD)::jsonb,
      NULL,
      'Permission revoked from user'
    );
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT up.email, p.name INTO user_email, perm_name
    FROM user_profiles up, permissions p
    WHERE up.id = NEW.user_id AND p.id = NEW.permission_id;
    
    PERFORM log_rbac_audit_event(
      auth.uid(),
      CASE WHEN NEW.granted THEN 'grant' ELSE 'deny' END,
      'user_permission',
      NEW.user_id,
      user_email || ' -> ' || perm_name,
      row_to_json(OLD)::jsonb,
      row_to_json(NEW)::jsonb,
      'User permission updated'
    );
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT up.email, p.name INTO user_email, perm_name
    FROM user_profiles up, permissions p
    WHERE up.id = NEW.user_id AND p.id = NEW.permission_id;
    
    PERFORM log_rbac_audit_event(
      auth.uid(),
      CASE WHEN NEW.granted THEN 'grant' ELSE 'deny' END,
      'user_permission',
      NEW.user_id,
      user_email || ' -> ' || perm_name,
      NULL,
      row_to_json(NEW)::jsonb,
      'Permission assigned to user'
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply audit triggers
DROP TRIGGER IF EXISTS roles_audit_trigger ON roles;
CREATE TRIGGER roles_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION audit_roles_changes();

DROP TRIGGER IF EXISTS role_permissions_audit_trigger ON role_permissions;
CREATE TRIGGER role_permissions_audit_trigger
  AFTER INSERT OR DELETE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION audit_role_permissions_changes();

DROP TRIGGER IF EXISTS user_permissions_audit_trigger ON user_permissions;
CREATE TRIGGER user_permissions_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON user_permissions
  FOR EACH ROW EXECUTE FUNCTION audit_user_permissions_changes();

-- Enable RLS on new tables
ALTER TABLE rbac_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE enhanced_user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE failed_auth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_cache_events ENABLE ROW LEVEL SECURITY;

-- RLS policies for audit tables (admin access only for sensitive data)
CREATE POLICY "Admins can view all audit logs" 
  ON rbac_audit_logs FOR SELECT 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid() 
      AND r.name IN ('superadmin', 'admin')
    )
  );

CREATE POLICY "Users can view their own usage logs" 
  ON permission_usage_logs FOR SELECT 
  TO authenticated 
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid() 
      AND r.name IN ('superadmin', 'admin')
    )
  );

CREATE POLICY "Users can view their own sessions" 
  ON enhanced_user_sessions FOR SELECT 
  TO authenticated 
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid() 
      AND r.name IN ('superadmin', 'admin')
    )
  );

-- Grant permissions on new functions
GRANT EXECUTE ON FUNCTION log_rbac_audit_event(UUID, VARCHAR, VARCHAR, UUID, VARCHAR, JSONB, JSONB, TEXT, INET, TEXT, TEXT, VARCHAR) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION log_permission_usage(UUID, UUID, VARCHAR, VARCHAR, UUID, BOOLEAN, VARCHAR, INTEGER, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cleanup_audit_logs(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION detect_suspicious_activity(UUID, INTEGER) TO authenticated, service_role;

-- Add comments for documentation
COMMENT ON TABLE rbac_audit_logs IS 'Comprehensive audit log for all RBAC-related changes and actions';
COMMENT ON TABLE permission_usage_logs IS 'Tracks permission checks for analytics and monitoring';
COMMENT ON TABLE enhanced_user_sessions IS 'Enhanced session tracking with security metadata';
COMMENT ON TABLE failed_auth_attempts IS 'Tracks failed authentication attempts for security monitoring';
COMMENT ON TABLE permission_cache_events IS 'Tracks permission cache operations for performance monitoring';

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 008: Enhanced audit and session management completed successfully';
END $$;
