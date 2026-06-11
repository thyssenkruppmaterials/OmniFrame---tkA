-- Migration: Create Session Management Tables
-- Date: 2025-01-21
-- Description: Create missing tables for complete session management functionality

-- Create basic user_sessions table (simpler version of enhanced_user_sessions for compatibility)
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  token_hash VARCHAR(255) UNIQUE NOT NULL,
  ip_address INET,
  user_agent TEXT,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '8 hours'),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create session timeout configurations table
CREATE TABLE IF NOT EXISTS session_timeout_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role user_role NOT NULL,
  session_timeout_minutes INTEGER NOT NULL DEFAULT 480, -- 8 hours
  auto_logout_timeout_minutes INTEGER NOT NULL DEFAULT 15, -- 15 minutes
  warning_time_minutes INTEGER NOT NULL DEFAULT 5, -- 5 minutes
  is_global BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create security alerts table
CREATE TABLE IF NOT EXISTS security_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  alert_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'medium',
  title VARCHAR(255),
  description TEXT,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}',
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  resolved BOOLEAN DEFAULT FALSE,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create session activities table
CREATE TABLE IF NOT EXISTS session_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id VARCHAR(255),
  event_type VARCHAR(50) NOT NULL,
  event_description TEXT,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}',
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add constraints for security alerts
ALTER TABLE security_alerts ADD CONSTRAINT security_alerts_type_check 
  CHECK (alert_type IN ('multiple_logins', 'unusual_location', 'brute_force', 'session_hijacking', 'suspicious_activity'));

ALTER TABLE security_alerts ADD CONSTRAINT security_alerts_severity_check 
  CHECK (severity IN ('low', 'medium', 'high', 'critical'));

-- Add constraints for session activities
ALTER TABLE session_activities ADD CONSTRAINT session_activities_event_type_check 
  CHECK (event_type IN ('login', 'logout', 'timeout', 'forced_logout', 'refresh', 'update_timeout_config', 'create_timeout_config', 'delete_timeout_config', 'resolve_security_alert', 'export_session_data'));

-- Add constraints for session timeout configs
ALTER TABLE session_timeout_configs ADD CONSTRAINT session_timeout_configs_role_global_unique 
  UNIQUE(role, is_global);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_activity ON user_sessions(last_activity);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(user_id, expires_at) WHERE expires_at > NOW();

CREATE INDEX IF NOT EXISTS idx_session_timeout_configs_role ON session_timeout_configs(role);
CREATE INDEX IF NOT EXISTS idx_session_timeout_configs_global ON session_timeout_configs(is_global);

CREATE INDEX IF NOT EXISTS idx_security_alerts_user_id ON security_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_security_alerts_type ON security_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_security_alerts_severity ON security_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_security_alerts_resolved ON security_alerts(resolved);
CREATE INDEX IF NOT EXISTS idx_security_alerts_timestamp ON security_alerts(timestamp);

CREATE INDEX IF NOT EXISTS idx_session_activities_user_id ON session_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_session_activities_session_id ON session_activities(session_id);
CREATE INDEX IF NOT EXISTS idx_session_activities_event_type ON session_activities(event_type);
CREATE INDEX IF NOT EXISTS idx_session_activities_timestamp ON session_activities(timestamp);

-- Enable RLS on new tables
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_timeout_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_activities ENABLE ROW LEVEL SECURITY;

-- RLS policies for user_sessions
CREATE POLICY "Users can view their own sessions" 
  ON user_sessions FOR SELECT 
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

CREATE POLICY "Admins can manage all sessions" 
  ON user_sessions FOR ALL 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid() 
      AND r.name IN ('superadmin', 'admin')
    )
  );

-- RLS policies for session_timeout_configs
CREATE POLICY "Admins can manage timeout configs" 
  ON session_timeout_configs FOR ALL 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid() 
      AND r.name IN ('superadmin', 'admin')
    )
  );

-- RLS policies for security_alerts
CREATE POLICY "Users can view their own alerts and admins can view all" 
  ON security_alerts FOR SELECT 
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

CREATE POLICY "Admins can manage all alerts" 
  ON security_alerts FOR ALL 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid() 
      AND r.name IN ('superadmin', 'admin')
    )
  );

-- RLS policies for session_activities
CREATE POLICY "Users can view their own activities and admins can view all" 
  ON session_activities FOR SELECT 
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

CREATE POLICY "System can insert activities" 
  ON session_activities FOR INSERT 
  TO authenticated, service_role 
  WITH CHECK (true);

-- Insert default timeout configurations
INSERT INTO session_timeout_configs (role, session_timeout_minutes, auto_logout_timeout_minutes, warning_time_minutes, is_global)
VALUES 
  ('superadmin', 480, 30, 5, false),  -- 8 hours session, 30 min idle
  ('admin', 480, 20, 5, false),       -- 8 hours session, 20 min idle
  ('manager', 360, 15, 5, false),     -- 6 hours session, 15 min idle
  ('cashier', 240, 15, 5, false),     -- 4 hours session, 15 min idle
  ('viewer', 180, 10, 5, false),      -- 3 hours session, 10 min idle
  ('tka_associate', 240, 15, 5, false) -- 4 hours session, 15 min idle
ON CONFLICT (role, is_global) DO NOTHING;

-- Function to get user session timeout config
CREATE OR REPLACE FUNCTION get_user_session_config(p_user_id UUID)
RETURNS TABLE(
  session_timeout_minutes INTEGER,
  auto_logout_timeout_minutes INTEGER,
  warning_time_minutes INTEGER
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
  WHERE role = user_role_name AND is_global = false;
  
  -- Return role-specific config if exists, otherwise global, otherwise default
  IF role_config.id IS NOT NULL THEN
    RETURN QUERY SELECT 
      role_config.session_timeout_minutes,
      role_config.auto_logout_timeout_minutes,
      role_config.warning_time_minutes;
  ELSIF global_config.id IS NOT NULL THEN
    RETURN QUERY SELECT 
      global_config.session_timeout_minutes,
      global_config.auto_logout_timeout_minutes,
      global_config.warning_time_minutes;
  ELSE
    -- Default fallback
    RETURN QUERY SELECT 240, 15, 5; -- 4 hours, 15 min idle, 5 min warning
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cleanup expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
BEGIN
  -- Delete expired sessions from user_sessions
  DELETE FROM user_sessions 
  WHERE expires_at <= NOW();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Also cleanup enhanced_user_sessions
  DELETE FROM enhanced_user_sessions 
  WHERE expires_at <= NOW() OR revoked_at IS NOT NULL;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create session with proper timeout
CREATE OR REPLACE FUNCTION create_user_session(
  p_user_id UUID,
  p_token_hash VARCHAR,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  session_id UUID;
  timeout_config RECORD;
  session_expires_at TIMESTAMPTZ;
BEGIN
  -- Get user timeout configuration
  SELECT * INTO timeout_config
  FROM get_user_session_config(p_user_id);
  
  -- Calculate expiration time
  session_expires_at := NOW() + INTERVAL '1 minute' * timeout_config.session_timeout_minutes;
  
  -- Insert new session
  INSERT INTO user_sessions (
    user_id, token_hash, ip_address, user_agent, expires_at
  ) VALUES (
    p_user_id, p_token_hash, p_ip_address, p_user_agent, session_expires_at
  ) RETURNING id INTO session_id;
  
  -- Log session creation
  INSERT INTO session_activities (
    user_id, session_id, event_type, event_description, ip_address, user_agent
  ) VALUES (
    p_user_id, p_token_hash, 'login', 'Session created', p_ip_address, p_user_agent
  );
  
  RETURN session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update session activity
CREATE OR REPLACE FUNCTION update_session_activity(
  p_token_hash VARCHAR,
  p_ip_address INET DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  session_found BOOLEAN := false;
BEGIN
  -- Update session last activity
  UPDATE user_sessions 
  SET 
    last_activity = NOW(),
    ip_address = COALESCE(p_ip_address, ip_address)
  WHERE token_hash = p_token_hash 
    AND expires_at > NOW()
  RETURNING TRUE INTO session_found;
  
  RETURN COALESCE(session_found, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions on new functions
GRANT EXECUTE ON FUNCTION get_user_session_config(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cleanup_expired_sessions() TO service_role;
GRANT EXECUTE ON FUNCTION create_user_session(UUID, VARCHAR, INET, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_session_activity(VARCHAR, INET) TO authenticated, service_role;

-- Add comments for documentation
COMMENT ON TABLE user_sessions IS 'Basic user session tracking for compatibility';
COMMENT ON TABLE session_timeout_configs IS 'Configurable timeout settings per role';
COMMENT ON TABLE security_alerts IS 'Security alerts and suspicious activity tracking';
COMMENT ON TABLE session_activities IS 'Session event logging and audit trail';

COMMENT ON FUNCTION get_user_session_config(UUID) IS 'Get timeout configuration for a specific user';
COMMENT ON FUNCTION cleanup_expired_sessions() IS 'Clean up expired sessions (should be called periodically)';
COMMENT ON FUNCTION create_user_session(UUID, VARCHAR, INET, TEXT) IS 'Create a new user session with proper timeout';
COMMENT ON FUNCTION update_session_activity(VARCHAR, INET) IS 'Update session last activity timestamp';

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 032: Session management tables created successfully';
END $$;