-- Migration: 030_security_monitoring.sql
-- Description: Advanced security monitoring system with threat detection and compliance reporting
-- Created: September 13, 2025

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Security Events Table
CREATE TABLE security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'login_anomaly',
    'permission_escalation',
    'data_access',
    'failed_login',
    'suspicious_activity'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  user_id UUID REFERENCES user_profiles(id),
  ip_address INET,
  user_agent TEXT,
  location JSONB,
  metadata JSONB DEFAULT '{}',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'investigating', 'resolved', 'false_positive')),
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);

-- Threat Indicators Table
CREATE TABLE threat_indicators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_type TEXT NOT NULL,
  value TEXT NOT NULL,
  threat_level TEXT NOT NULL CHECK (threat_level IN ('low', 'medium', 'high')),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Compliance Reports Table
CREATE TABLE compliance_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL CHECK (report_type IN ('gdpr', 'sox', 'hipaa', 'custom')),
  report_data JSONB NOT NULL,
  generated_by UUID REFERENCES user_profiles(id),
  date_range DATERANGE NOT NULL,
  status TEXT DEFAULT 'generated' CHECK (status IN ('generated', 'reviewed', 'approved', 'archived')),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Data Processing Activities Table
CREATE TABLE data_processing_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type TEXT NOT NULL,
  user_id UUID REFERENCES user_profiles(id),
  data_subject TEXT,
  purpose TEXT NOT NULL,
  legal_basis TEXT,
  data_categories JSONB,
  retention_period INTERVAL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Session Security Extensions
ALTER TABLE active_sessions ADD COLUMN IF NOT EXISTS ip_address INET;
ALTER TABLE active_sessions ADD COLUMN IF NOT EXISTS location JSONB;
ALTER TABLE active_sessions ADD COLUMN IF NOT EXISTS device_info JSONB;
ALTER TABLE active_sessions ADD COLUMN IF NOT EXISTS is_suspicious BOOLEAN DEFAULT false;
ALTER TABLE active_sessions ADD COLUMN IF NOT EXISTS risk_score INTEGER DEFAULT 0;

-- Session Restrictions Table
CREATE TABLE session_restrictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id),
  restriction_type TEXT NOT NULL CHECK (restriction_type IN (
    'ip_whitelist',
    'geo_restriction',
    'device_limit',
    'time_restriction'
  )),
  restriction_value JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_security_events_user_id ON security_events(user_id);
CREATE INDEX idx_security_events_severity ON security_events(severity);
CREATE INDEX idx_security_events_created_at ON security_events(created_at);
CREATE INDEX idx_security_events_status ON security_events(status);
CREATE INDEX idx_threat_indicators_active ON threat_indicators(is_active);
CREATE INDEX idx_compliance_reports_type ON compliance_reports(report_type);
CREATE INDEX idx_data_processing_user_id ON data_processing_activities(user_id);
CREATE INDEX idx_session_restrictions_user_id ON session_restrictions(user_id);
CREATE INDEX idx_session_restrictions_active ON session_restrictions(is_active);

-- Row Level Security Policies
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE threat_indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_processing_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_restrictions ENABLE ROW LEVEL SECURITY;

-- Security Events RLS
CREATE POLICY "Security events are viewable by admins and security personnel"
ON security_events FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

CREATE POLICY "Security events can be inserted by system"
ON security_events FOR INSERT WITH CHECK (true);

CREATE POLICY "Security events can be updated by admins"
ON security_events FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

-- Threat Indicators RLS
CREATE POLICY "Threat indicators are viewable by admins"
ON threat_indicators FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

CREATE POLICY "Threat indicators can be managed by admins"
ON threat_indicators FOR ALL USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

-- Compliance Reports RLS
CREATE POLICY "Compliance reports are viewable by authorized users"
ON compliance_reports FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

CREATE POLICY "Compliance reports can be managed by authorized users"
ON compliance_reports FOR ALL USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

-- Data Processing Activities RLS
CREATE POLICY "Users can view their own data processing activities"
ON data_processing_activities FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

CREATE POLICY "Data processing activities can be inserted by system"
ON data_processing_activities FOR INSERT WITH CHECK (true);

-- Session Restrictions RLS
CREATE POLICY "Users can view their own session restrictions"
ON session_restrictions FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

CREATE POLICY "Session restrictions can be managed by admins"
ON session_restrictions FOR ALL USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

-- Functions for security monitoring
CREATE OR REPLACE FUNCTION log_security_event(
  p_event_type TEXT,
  p_severity TEXT,
  p_user_id UUID DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_location JSONB DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
  event_id UUID;
BEGIN
  INSERT INTO security_events (
    event_type, severity, user_id, ip_address, user_agent, location, metadata
  ) VALUES (
    p_event_type, p_severity, p_user_id, p_ip_address, p_user_agent, p_location, p_metadata
  ) RETURNING id INTO event_id;

  RETURN event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate security metrics
CREATE OR REPLACE FUNCTION get_security_metrics(
  p_days INTEGER DEFAULT 30
) RETURNS TABLE (
  total_events BIGINT,
  critical_events BIGINT,
  high_events BIGINT,
  active_threats BIGINT,
  resolved_events BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) as total_events,
    COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_events,
    COUNT(CASE WHEN severity = 'high' THEN 1 END) as high_events,
    COUNT(CASE WHEN ti.id IS NOT NULL THEN 1 END) as active_threats,
    COUNT(CASE WHEN se.status = 'resolved' THEN 1 END) as resolved_events
  FROM security_events se
  LEFT JOIN threat_indicators ti ON ti.is_active = true
  WHERE se.created_at >= NOW() - INTERVAL '1 day' * p_days;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to detect suspicious sessions
CREATE OR REPLACE FUNCTION detect_suspicious_sessions()
RETURNS TABLE (
  session_id UUID,
  user_id UUID,
  risk_score INTEGER,
  risk_factors TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    as2.id,
    as2.user_id,
    CASE
      WHEN as2.ip_address NOT IN (
        SELECT (sr.restriction_value->>'ip')::INET
        FROM session_restrictions sr
        WHERE sr.user_id = as2.user_id
        AND sr.restriction_type = 'ip_whitelist'
        AND sr.is_active = true
      ) THEN 50
      WHEN as2.location->>'country' NOT IN (
        SELECT jsonb_array_elements_text(sr.restriction_value->'countries')
        FROM session_restrictions sr
        WHERE sr.user_id = as2.user_id
        AND sr.restriction_type = 'geo_restriction'
        AND sr.is_active = true
      ) THEN 30
      ELSE 0
    END as risk_score,
    ARRAY[
      CASE WHEN as2.ip_address NOT IN (
        SELECT (sr.restriction_value->>'ip')::INET
        FROM session_restrictions sr
        WHERE sr.user_id = as2.user_id
        AND sr.restriction_type = 'ip_whitelist'
        AND sr.is_active = true
      ) THEN 'Unusual IP address' END,
      CASE WHEN as2.location->>'country' NOT IN (
        SELECT jsonb_array_elements_text(sr.restriction_value->'countries')
        FROM session_restrictions sr
        WHERE sr.user_id = as2.user_id
        AND sr.restriction_type = 'geo_restriction'
        AND sr.is_active = true
      ) THEN 'Unusual location' END
    ] FILTER (WHERE item IS NOT NULL) as risk_factors
  FROM active_sessions as2
  WHERE as2.created_at >= NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
