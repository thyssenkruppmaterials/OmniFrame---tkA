-- Migration: 031_conditional_permissions.sql
-- Description: Advanced conditional permissions system with time-based, location-based, and IP restrictions
-- Created: September 13, 2025

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===== ROLE PERMISSIONS EXTENSIONS =====
-- Add conditional permission columns to role_permissions table
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS conditions JSONB DEFAULT '{}';
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS valid_from TIMESTAMP;
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS valid_to TIMESTAMP;
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS ip_restrictions JSONB DEFAULT '[]';
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS geo_restrictions JSONB DEFAULT '{}';
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS requires_conditions BOOLEAN DEFAULT false;
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS condition_logic TEXT DEFAULT 'AND' CHECK (condition_logic IN ('AND', 'OR'));

-- ===== TEMPORARY ROLE ASSIGNMENTS =====
-- Table for temporary role assignments with expiration
CREATE TABLE IF NOT EXISTS temporary_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  expires_at TIMESTAMP NOT NULL,
  reason TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ===== ROLE HIERARCHY =====
-- Table for role inheritance and hierarchy
CREATE TABLE IF NOT EXISTS role_hierarchy (
  parent_role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  child_role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  inheritance_type TEXT DEFAULT 'inherit' CHECK (inheritance_type IN ('inherit', 'override', 'extend')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (parent_role_id, child_role_id)
);

-- ===== ROLE DELEGATION =====
-- Table for role delegation between users
CREATE TABLE IF NOT EXISTS role_delegation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delegator_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  delegate_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  permissions JSONB NOT NULL,
  expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ===== ACCESS REQUESTS =====
-- Table for user access requests (role changes, temporary elevation, etc.)
CREATE TABLE IF NOT EXISTS access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('role_change', 'permission_grant', 'resource_access', 'temporary_elevation')),
  requested_data JSONB NOT NULL,
  justification TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewer_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  review_notes TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ===== APPROVAL WORKFLOWS =====
-- Table for configurable approval workflows
CREATE TABLE IF NOT EXISTS approval_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_conditions JSONB NOT NULL,
  steps JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ===== WORKFLOW INSTANCES =====
-- Table for tracking workflow execution instances
CREATE TABLE IF NOT EXISTS workflow_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES approval_workflows(id) ON DELETE CASCADE,
  trigger_data JSONB NOT NULL,
  current_step INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- ===== INDEXES FOR PERFORMANCE =====
-- Role permissions conditional indexes
CREATE INDEX IF NOT EXISTS idx_role_permissions_conditions ON role_permissions USING GIN(conditions);
CREATE INDEX IF NOT EXISTS idx_role_permissions_valid_from ON role_permissions(valid_from);
CREATE INDEX IF NOT EXISTS idx_role_permissions_valid_to ON role_permissions(valid_to);
CREATE INDEX IF NOT EXISTS idx_role_permissions_requires_conditions ON role_permissions(requires_conditions);

-- Temporary role assignments indexes
CREATE INDEX IF NOT EXISTS idx_temp_role_assignments_user_id ON temporary_role_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_temp_role_assignments_expires_at ON temporary_role_assignments(expires_at);
CREATE INDEX IF NOT EXISTS idx_temp_role_assignments_active ON temporary_role_assignments(is_active);

-- Role hierarchy indexes
CREATE INDEX IF NOT EXISTS idx_role_hierarchy_parent ON role_hierarchy(parent_role_id);
CREATE INDEX IF NOT EXISTS idx_role_hierarchy_child ON role_hierarchy(child_role_id);

-- Role delegation indexes
CREATE INDEX IF NOT EXISTS idx_role_delegation_delegator ON role_delegation(delegator_id);
CREATE INDEX IF NOT EXISTS idx_role_delegation_delegate ON role_delegation(delegate_id);
CREATE INDEX IF NOT EXISTS idx_role_delegation_active ON role_delegation(is_active);

-- Access requests indexes
CREATE INDEX IF NOT EXISTS idx_access_requests_requester ON access_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);
CREATE INDEX IF NOT EXISTS idx_access_requests_reviewer ON access_requests(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_type ON access_requests(request_type);

-- Workflow indexes
CREATE INDEX IF NOT EXISTS idx_approval_workflows_trigger_type ON approval_workflows(trigger_type);
CREATE INDEX IF NOT EXISTS idx_approval_workflows_active ON approval_workflows(is_active);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_workflow_id ON workflow_instances(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_status ON workflow_instances(status);

-- ===== ROW LEVEL SECURITY POLICIES =====
-- Enable RLS on new tables
ALTER TABLE temporary_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_hierarchy ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_delegation ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_instances ENABLE ROW LEVEL SECURITY;

-- Temporary role assignments RLS
CREATE POLICY "Temporary role assignments viewable by user or admin"
ON temporary_role_assignments FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

CREATE POLICY "Temporary role assignments manageable by admin"
ON temporary_role_assignments FOR ALL USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

-- Role hierarchy RLS
CREATE POLICY "Role hierarchy viewable by admin"
ON role_hierarchy FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

CREATE POLICY "Role hierarchy manageable by superadmin"
ON role_hierarchy FOR ALL USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name = 'superadmin'
    )
  )
);

-- Role delegation RLS
CREATE POLICY "Role delegation viewable by delegator, delegate, or admin"
ON role_delegation FOR SELECT USING (
  delegator_id = auth.uid() OR
  delegate_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

CREATE POLICY "Role delegation manageable by delegator or admin"
ON role_delegation FOR ALL USING (
  delegator_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

-- Access requests RLS
CREATE POLICY "Access requests viewable by requester or admin"
ON access_requests FOR SELECT USING (
  requester_id = auth.uid() OR
  reviewer_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

CREATE POLICY "Access requests can be inserted by authenticated users"
ON access_requests FOR INSERT WITH CHECK (
  requester_id = auth.uid()
);

CREATE POLICY "Access requests can be updated by requester or admin"
ON access_requests FOR UPDATE USING (
  requester_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

-- Approval workflows RLS
CREATE POLICY "Approval workflows viewable by admin"
ON approval_workflows FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

CREATE POLICY "Approval workflows manageable by admin"
ON approval_workflows FOR ALL USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

-- Workflow instances RLS
CREATE POLICY "Workflow instances viewable by admin or involved users"
ON workflow_instances FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  ) OR
  EXISTS (
    SELECT 1 FROM access_requests ar
    WHERE ar.id = (trigger_data->>'request_id')::UUID
    AND (ar.requester_id = auth.uid() OR ar.reviewer_id = auth.uid())
  )
);

CREATE POLICY "Workflow instances manageable by admin"
ON workflow_instances FOR ALL USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role_id IN (
      SELECT id FROM roles WHERE name IN ('superadmin', 'admin')
    )
  )
);

-- ===== FUNCTIONS FOR CONDITIONAL PERMISSIONS =====

-- Function to check if permission conditions are met
CREATE OR REPLACE FUNCTION check_permission_conditions(
  p_conditions JSONB,
  p_user_id UUID,
  p_ip_address INET DEFAULT NULL,
  p_location JSONB DEFAULT NULL,
  p_current_time TIMESTAMP DEFAULT NOW()
) RETURNS BOOLEAN AS $$
DECLARE
  time_conditions JSONB;
  location_conditions JSONB;
  ip_conditions JSONB;
  custom_conditions JSONB;
  result BOOLEAN DEFAULT true;
BEGIN
  -- If no conditions, allow access
  IF p_conditions IS NULL OR p_conditions = '{}'::JSONB THEN
    RETURN true;
  END IF;

  -- Check time-based conditions
  time_conditions := p_conditions->'time';
  IF time_conditions IS NOT NULL THEN
    -- Check day of week
    IF time_conditions->'allowed_days' IS NOT NULL THEN
      IF NOT (EXTRACT(DOW FROM p_current_time)::TEXT = ANY(
        SELECT jsonb_array_elements_text(time_conditions->'allowed_days')
      )) THEN
        result := false;
      END IF;
    END IF;
    
    -- Check time of day
    IF time_conditions->'start_time' IS NOT NULL AND time_conditions->'end_time' IS NOT NULL THEN
      IF NOT (p_current_time::TIME BETWEEN 
        (time_conditions->>'start_time')::TIME AND 
        (time_conditions->>'end_time')::TIME) THEN
        result := false;
      END IF;
    END IF;
  END IF;

  -- Check location-based conditions
  location_conditions := p_conditions->'location';
  IF location_conditions IS NOT NULL AND p_location IS NOT NULL THEN
    -- Check allowed countries
    IF location_conditions->'allowed_countries' IS NOT NULL THEN
      IF NOT (p_location->>'country' = ANY(
        SELECT jsonb_array_elements_text(location_conditions->'allowed_countries')
      )) THEN
        result := false;
      END IF;
    END IF;
  END IF;

  -- Check IP-based conditions
  ip_conditions := p_conditions->'ip';
  IF ip_conditions IS NOT NULL AND p_ip_address IS NOT NULL THEN
    -- Check IP whitelist
    IF ip_conditions->'whitelist' IS NOT NULL THEN
      IF NOT (p_ip_address << ANY(
        SELECT (jsonb_array_elements_text(ip_conditions->'whitelist'))::INET
      )) THEN
        result := false;
      END IF;
    END IF;
    
    -- Check IP blacklist
    IF ip_conditions->'blacklist' IS NOT NULL THEN
      IF p_ip_address << ANY(
        SELECT (jsonb_array_elements_text(ip_conditions->'blacklist'))::INET
      ) THEN
        result := false;
      END IF;
    END IF;
  END IF;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get effective role permissions with conditions
CREATE OR REPLACE FUNCTION get_effective_role_permissions(
  p_user_id UUID,
  p_ip_address INET DEFAULT NULL,
  p_location JSONB DEFAULT NULL,
  p_current_time TIMESTAMP DEFAULT NOW()
) RETURNS TABLE (
  permission_id UUID,
  resource TEXT,
  action TEXT,
  conditions_met BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  WITH user_roles AS (
    -- Get user's primary role
    SELECT up.role_id
    FROM user_profiles up
    WHERE up.id = p_user_id
    
    UNION
    
    -- Get temporary role assignments that are active
    SELECT tra.role_id
    FROM temporary_role_assignments tra
    WHERE tra.user_id = p_user_id
      AND tra.is_active = true
      AND tra.expires_at > p_current_time
  )
  SELECT 
    p.id as permission_id,
    p.resource,
    p.action,
    CASE 
      WHEN rp.requires_conditions AND rp.conditions IS NOT NULL THEN
        check_permission_conditions(rp.conditions, p_user_id, p_ip_address, p_location, p_current_time)
      ELSE true
    END as conditions_met
  FROM user_roles ur
  JOIN role_permissions rp ON rp.role_id = ur.role_id
  JOIN permissions p ON p.id = rp.permission_id
  WHERE p.is_active = true
    AND (rp.valid_from IS NULL OR rp.valid_from <= p_current_time)
    AND (rp.valid_to IS NULL OR rp.valid_to > p_current_time);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create temporary role assignment
CREATE OR REPLACE FUNCTION create_temporary_role_assignment(
  p_user_id UUID,
  p_role_id UUID,
  p_expires_at TIMESTAMP,
  p_reason TEXT DEFAULT NULL,
  p_granted_by UUID DEFAULT auth.uid()
) RETURNS UUID AS $$
DECLARE
  assignment_id UUID;
BEGIN
  INSERT INTO temporary_role_assignments (
    user_id, role_id, expires_at, reason, granted_by
  ) VALUES (
    p_user_id, p_role_id, p_expires_at, p_reason, p_granted_by
  ) RETURNING id INTO assignment_id;

  -- Log the temporary assignment
  PERFORM log_security_event(
    'permission_escalation',
    'medium',
    p_user_id,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'temporary_role_id', p_role_id,
      'expires_at', p_expires_at,
      'granted_by', p_granted_by,
      'reason', p_reason
    )
  );

  RETURN assignment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to revoke temporary role assignment
CREATE OR REPLACE FUNCTION revoke_temporary_role_assignment(
  p_assignment_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE temporary_role_assignments 
  SET is_active = false, updated_at = NOW()
  WHERE id = p_assignment_id;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clean up expired temporary assignments
CREATE OR REPLACE FUNCTION cleanup_expired_temporary_assignments()
RETURNS INTEGER AS $$
DECLARE
  cleaned_count INTEGER;
BEGIN
  UPDATE temporary_role_assignments 
  SET is_active = false, updated_at = NOW()
  WHERE expires_at <= NOW() AND is_active = true;

  GET DIAGNOSTICS cleaned_count = ROW_COUNT;
  
  RETURN cleaned_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION check_permission_conditions(JSONB, UUID, INET, JSONB, TIMESTAMP) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_effective_role_permissions(UUID, INET, JSONB, TIMESTAMP) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_temporary_role_assignment(UUID, UUID, TIMESTAMP, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION revoke_temporary_role_assignment(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cleanup_expired_temporary_assignments() TO service_role;

-- Add a trigger to automatically clean up expired assignments (runs daily)
CREATE OR REPLACE FUNCTION trigger_cleanup_expired_assignments()
RETURNS trigger AS $$
BEGIN
  -- Only run cleanup once per day to avoid excessive overhead
  IF (SELECT COUNT(*) FROM temporary_role_assignments WHERE updated_at > NOW() - INTERVAL '1 day') = 0 THEN
    PERFORM cleanup_expired_temporary_assignments();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on temporary_role_assignments table
DROP TRIGGER IF EXISTS cleanup_expired_assignments_trigger ON temporary_role_assignments;
CREATE TRIGGER cleanup_expired_assignments_trigger
  AFTER INSERT OR UPDATE ON temporary_role_assignments
  FOR EACH ROW EXECUTE FUNCTION trigger_cleanup_expired_assignments();

-- Add updated_at trigger for all new tables
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at triggers
CREATE TRIGGER update_temporary_role_assignments_updated_at BEFORE UPDATE ON temporary_role_assignments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_role_hierarchy_updated_at BEFORE UPDATE ON role_hierarchy FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_role_delegation_updated_at BEFORE UPDATE ON role_delegation FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_access_requests_updated_at BEFORE UPDATE ON access_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_approval_workflows_updated_at BEFORE UPDATE ON approval_workflows FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_workflow_instances_updated_at BEFORE UPDATE ON workflow_instances FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;