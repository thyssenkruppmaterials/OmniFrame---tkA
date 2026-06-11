-- =====================================================
-- OVERTIME MANAGEMENT SYSTEM
-- Migration: 086_overtime_management.sql
-- Created: January 3, 2026
-- Description: Creates tables and functions for managing
--              associate overtime requests and approvals
-- =====================================================

-- ===== OVERTIME REQUEST STATUS ENUM =====
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'overtime_status') THEN
    CREATE TYPE overtime_status AS ENUM (
      'pending',      -- Request submitted, awaiting approval
      'approved',     -- Supervisor approved the overtime
      'denied',       -- Supervisor denied the request
      'completed',    -- Overtime period completed
      'cancelled'     -- Request cancelled by employee or supervisor
    );
  END IF;
END $$;

-- ===== OVERTIME REQUESTS TABLE =====
-- Stores overtime requests from associates
CREATE TABLE IF NOT EXISTS overtime_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Request details
  request_date DATE NOT NULL,                    -- The date the overtime is for
  original_shift_end TIME NOT NULL,              -- Original scheduled shift end time
  extended_shift_end TIME NOT NULL,              -- New extended end time with overtime
  overtime_minutes INTEGER NOT NULL,             -- Total overtime minutes requested
  
  -- Employee who is requesting overtime
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Status and workflow
  status overtime_status NOT NULL DEFAULT 'pending',
  
  -- Approval tracking
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  denied_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  denied_at TIMESTAMPTZ,
  denial_reason TEXT,
  
  -- Optional details
  reason TEXT,                                   -- Employee's reason for requesting
  supervisor_notes TEXT,                         -- Notes from approving supervisor
  working_area_id UUID REFERENCES working_areas(id) ON DELETE SET NULL,
  
  -- Actual overtime tracking
  actual_clock_out TIMESTAMPTZ,                  -- When employee actually clocked out
  actual_overtime_minutes INTEGER,               -- Actual overtime worked
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Constraints
  CONSTRAINT valid_overtime_duration CHECK (overtime_minutes > 0 AND overtime_minutes <= 480),
  CONSTRAINT extended_after_original CHECK (extended_shift_end > original_shift_end)
);

-- ===== OVERTIME BATCH/GROUP REQUESTS =====
-- Allows supervisors to create overtime for multiple employees at once
CREATE TABLE IF NOT EXISTS overtime_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Batch details
  batch_name TEXT NOT NULL,                      -- e.g., "Q4 Surge - Evening Shift"
  request_date DATE NOT NULL,                    -- Date the overtime applies to
  original_shift_end TIME NOT NULL,
  extended_shift_end TIME NOT NULL,
  overtime_minutes INTEGER NOT NULL,
  
  -- Scope
  working_area_id UUID REFERENCES working_areas(id) ON DELETE SET NULL,
  
  -- Auto-approval (for supervisor-initiated batches)
  auto_approve BOOLEAN NOT NULL DEFAULT false,
  
  -- Tracking
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_batch_overtime CHECK (overtime_minutes > 0 AND overtime_minutes <= 480)
);

-- Link table between batches and individual requests
CREATE TABLE IF NOT EXISTS overtime_batch_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES overtime_batches(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES overtime_requests(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(batch_id, request_id)
);

-- ===== INDEXES =====
CREATE INDEX IF NOT EXISTS idx_overtime_requests_org_date 
  ON overtime_requests(organization_id, request_date);
CREATE INDEX IF NOT EXISTS idx_overtime_requests_user_id 
  ON overtime_requests(user_id, request_date);
CREATE INDEX IF NOT EXISTS idx_overtime_requests_status 
  ON overtime_requests(status);
CREATE INDEX IF NOT EXISTS idx_overtime_requests_approved_by 
  ON overtime_requests(approved_by) WHERE approved_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_overtime_batches_org_date 
  ON overtime_batches(organization_id, request_date);
CREATE INDEX IF NOT EXISTS idx_overtime_batch_members_batch 
  ON overtime_batch_members(batch_id);

-- ===== UPDATED_AT TRIGGER =====
CREATE OR REPLACE FUNCTION update_overtime_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_overtime_requests_updated_at ON overtime_requests;
CREATE TRIGGER trigger_overtime_requests_updated_at
  BEFORE UPDATE ON overtime_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_overtime_updated_at();

DROP TRIGGER IF EXISTS trigger_overtime_batches_updated_at ON overtime_batches;
CREATE TRIGGER trigger_overtime_batches_updated_at
  BEFORE UPDATE ON overtime_batches
  FOR EACH ROW
  EXECUTE FUNCTION update_overtime_updated_at();

-- ===== ROW LEVEL SECURITY =====
ALTER TABLE overtime_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE overtime_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE overtime_batch_members ENABLE ROW LEVEL SECURITY;

-- Policies for overtime_requests
DROP POLICY IF EXISTS overtime_requests_org_read ON overtime_requests;
CREATE POLICY overtime_requests_org_read ON overtime_requests
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS overtime_requests_insert ON overtime_requests;
CREATE POLICY overtime_requests_insert ON overtime_requests
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS overtime_requests_update ON overtime_requests;
CREATE POLICY overtime_requests_update ON overtime_requests
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS overtime_requests_delete ON overtime_requests;
CREATE POLICY overtime_requests_delete ON overtime_requests
  FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

-- Policies for overtime_batches
DROP POLICY IF EXISTS overtime_batches_org_read ON overtime_batches;
CREATE POLICY overtime_batches_org_read ON overtime_batches
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS overtime_batches_insert ON overtime_batches;
CREATE POLICY overtime_batches_insert ON overtime_batches
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS overtime_batches_update ON overtime_batches;
CREATE POLICY overtime_batches_update ON overtime_batches
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS overtime_batches_delete ON overtime_batches;
CREATE POLICY overtime_batches_delete ON overtime_batches
  FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

-- Policies for overtime_batch_members (inherit from batch)
DROP POLICY IF EXISTS overtime_batch_members_read ON overtime_batch_members;
CREATE POLICY overtime_batch_members_read ON overtime_batch_members
  FOR SELECT
  USING (
    batch_id IN (
      SELECT id FROM overtime_batches WHERE organization_id IN (
        SELECT organization_id FROM user_profiles WHERE id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS overtime_batch_members_insert ON overtime_batch_members;
CREATE POLICY overtime_batch_members_insert ON overtime_batch_members
  FOR INSERT
  WITH CHECK (
    batch_id IN (
      SELECT id FROM overtime_batches WHERE organization_id IN (
        SELECT organization_id FROM user_profiles WHERE id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS overtime_batch_members_delete ON overtime_batch_members;
CREATE POLICY overtime_batch_members_delete ON overtime_batch_members
  FOR DELETE
  USING (
    batch_id IN (
      SELECT id FROM overtime_batches WHERE organization_id IN (
        SELECT organization_id FROM user_profiles WHERE id = auth.uid()
      )
    )
  );

-- ===== RPC FUNCTIONS =====

-- Get overtime requests for a specific date with user details
CREATE OR REPLACE FUNCTION get_overtime_requests_for_date(
  p_organization_id UUID,
  p_date DATE,
  p_status overtime_status DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  request_date DATE,
  original_shift_end TIME,
  extended_shift_end TIME,
  overtime_minutes INTEGER,
  user_id UUID,
  user_name TEXT,
  user_email TEXT,
  user_avatar TEXT,
  working_area_id UUID,
  working_area_name TEXT,
  status overtime_status,
  reason TEXT,
  supervisor_notes TEXT,
  approved_by UUID,
  approved_by_name TEXT,
  approved_at TIMESTAMPTZ,
  denied_by UUID,
  denied_by_name TEXT,
  denied_at TIMESTAMPTZ,
  denial_reason TEXT,
  created_at TIMESTAMPTZ,
  batch_id UUID,
  batch_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id,
    r.request_date,
    r.original_shift_end,
    r.extended_shift_end,
    r.overtime_minutes,
    r.user_id,
    COALESCE(up.full_name, up.email) AS user_name,
    up.email AS user_email,
    up.avatar_url AS user_avatar,
    r.working_area_id,
    wa.area_name AS working_area_name,
    r.status,
    r.reason,
    r.supervisor_notes,
    r.approved_by,
    COALESCE(ap.full_name, ap.email) AS approved_by_name,
    r.approved_at,
    r.denied_by,
    COALESCE(dp.full_name, dp.email) AS denied_by_name,
    r.denied_at,
    r.denial_reason,
    r.created_at,
    bm.batch_id,
    b.batch_name
  FROM overtime_requests r
  LEFT JOIN user_profiles up ON r.user_id = up.id
  LEFT JOIN user_profiles ap ON r.approved_by = ap.id
  LEFT JOIN user_profiles dp ON r.denied_by = dp.id
  LEFT JOIN working_areas wa ON r.working_area_id = wa.id
  LEFT JOIN overtime_batch_members bm ON bm.request_id = r.id
  LEFT JOIN overtime_batches b ON bm.batch_id = b.id
  WHERE r.organization_id = p_organization_id
    AND r.request_date = p_date
    AND (p_status IS NULL OR r.status = p_status)
  ORDER BY r.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get approved overtime for timeline display
CREATE OR REPLACE FUNCTION get_approved_overtime_for_date(
  p_organization_id UUID,
  p_date DATE
)
RETURNS TABLE (
  user_id UUID,
  original_shift_end TIME,
  extended_shift_end TIME,
  overtime_minutes INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.user_id,
    r.original_shift_end,
    r.extended_shift_end,
    r.overtime_minutes
  FROM overtime_requests r
  WHERE r.organization_id = p_organization_id
    AND r.request_date = p_date
    AND r.status = 'approved';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create overtime request
CREATE OR REPLACE FUNCTION create_overtime_request(
  p_organization_id UUID,
  p_user_id UUID,
  p_request_date DATE,
  p_original_shift_end TIME,
  p_extended_shift_end TIME,
  p_reason TEXT DEFAULT NULL,
  p_working_area_id UUID DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_overtime_minutes INTEGER;
  v_request_id UUID;
BEGIN
  -- Calculate overtime minutes
  v_overtime_minutes := EXTRACT(EPOCH FROM (p_extended_shift_end - p_original_shift_end)) / 60;
  
  INSERT INTO overtime_requests (
    organization_id,
    user_id,
    request_date,
    original_shift_end,
    extended_shift_end,
    overtime_minutes,
    reason,
    working_area_id,
    created_by,
    status
  ) VALUES (
    p_organization_id,
    p_user_id,
    p_request_date,
    p_original_shift_end,
    p_extended_shift_end,
    v_overtime_minutes,
    p_reason,
    p_working_area_id,
    COALESCE(p_created_by, auth.uid()),
    'pending'
  )
  RETURNING id INTO v_request_id;
  
  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Approve overtime request
CREATE OR REPLACE FUNCTION approve_overtime_request(
  p_request_id UUID,
  p_supervisor_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE overtime_requests
  SET 
    status = 'approved',
    approved_by = auth.uid(),
    approved_at = NOW(),
    supervisor_notes = COALESCE(p_supervisor_notes, supervisor_notes)
  WHERE id = p_request_id
    AND status = 'pending';
    
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Deny overtime request
CREATE OR REPLACE FUNCTION deny_overtime_request(
  p_request_id UUID,
  p_denial_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE overtime_requests
  SET 
    status = 'denied',
    denied_by = auth.uid(),
    denied_at = NOW(),
    denial_reason = p_denial_reason
  WHERE id = p_request_id
    AND status = 'pending';
    
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create batch overtime (supervisor-initiated)
CREATE OR REPLACE FUNCTION create_batch_overtime(
  p_organization_id UUID,
  p_batch_name TEXT,
  p_request_date DATE,
  p_original_shift_end TIME,
  p_extended_shift_end TIME,
  p_user_ids UUID[],
  p_working_area_id UUID DEFAULT NULL,
  p_auto_approve BOOLEAN DEFAULT true
)
RETURNS UUID AS $$
DECLARE
  v_batch_id UUID;
  v_request_id UUID;
  v_user_id UUID;
  v_overtime_minutes INTEGER;
  v_status overtime_status;
BEGIN
  -- Calculate overtime minutes
  v_overtime_minutes := EXTRACT(EPOCH FROM (p_extended_shift_end - p_original_shift_end)) / 60;
  
  -- Determine initial status
  v_status := CASE WHEN p_auto_approve THEN 'approved' ELSE 'pending' END;
  
  -- Create batch record
  INSERT INTO overtime_batches (
    organization_id,
    batch_name,
    request_date,
    original_shift_end,
    extended_shift_end,
    overtime_minutes,
    working_area_id,
    auto_approve,
    created_by
  ) VALUES (
    p_organization_id,
    p_batch_name,
    p_request_date,
    p_original_shift_end,
    p_extended_shift_end,
    v_overtime_minutes,
    p_working_area_id,
    p_auto_approve,
    auth.uid()
  )
  RETURNING id INTO v_batch_id;
  
  -- Create individual requests for each user
  FOREACH v_user_id IN ARRAY p_user_ids
  LOOP
    INSERT INTO overtime_requests (
      organization_id,
      user_id,
      request_date,
      original_shift_end,
      extended_shift_end,
      overtime_minutes,
      working_area_id,
      created_by,
      status,
      approved_by,
      approved_at
    ) VALUES (
      p_organization_id,
      v_user_id,
      p_request_date,
      p_original_shift_end,
      p_extended_shift_end,
      v_overtime_minutes,
      p_working_area_id,
      auth.uid(),
      v_status,
      CASE WHEN p_auto_approve THEN auth.uid() ELSE NULL END,
      CASE WHEN p_auto_approve THEN NOW() ELSE NULL END
    )
    RETURNING id INTO v_request_id;
    
    -- Link to batch
    INSERT INTO overtime_batch_members (batch_id, request_id)
    VALUES (v_batch_id, v_request_id);
  END LOOP;
  
  RETURN v_batch_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get overtime statistics for a date range
CREATE OR REPLACE FUNCTION get_overtime_statistics(
  p_organization_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  total_requests BIGINT,
  pending_count BIGINT,
  approved_count BIGINT,
  denied_count BIGINT,
  completed_count BIGINT,
  total_overtime_minutes BIGINT,
  approved_overtime_minutes BIGINT,
  unique_employees BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT AS total_requests,
    COUNT(*) FILTER (WHERE status = 'pending')::BIGINT AS pending_count,
    COUNT(*) FILTER (WHERE status = 'approved')::BIGINT AS approved_count,
    COUNT(*) FILTER (WHERE status = 'denied')::BIGINT AS denied_count,
    COUNT(*) FILTER (WHERE status = 'completed')::BIGINT AS completed_count,
    COALESCE(SUM(overtime_minutes), 0)::BIGINT AS total_overtime_minutes,
    COALESCE(SUM(overtime_minutes) FILTER (WHERE status IN ('approved', 'completed')), 0)::BIGINT AS approved_overtime_minutes,
    COUNT(DISTINCT user_id)::BIGINT AS unique_employees
  FROM overtime_requests
  WHERE organization_id = p_organization_id
    AND request_date BETWEEN p_start_date AND p_end_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_overtime_requests_for_date TO authenticated;
GRANT EXECUTE ON FUNCTION get_approved_overtime_for_date TO authenticated;
GRANT EXECUTE ON FUNCTION create_overtime_request TO authenticated;
GRANT EXECUTE ON FUNCTION approve_overtime_request TO authenticated;
GRANT EXECUTE ON FUNCTION deny_overtime_request TO authenticated;
GRANT EXECUTE ON FUNCTION create_batch_overtime TO authenticated;
GRANT EXECUTE ON FUNCTION get_overtime_statistics TO authenticated;

-- ===== COMMENTS =====
COMMENT ON TABLE overtime_requests IS 'Stores overtime requests from associates with approval workflow';
COMMENT ON TABLE overtime_batches IS 'Groups multiple overtime requests created by supervisor';
COMMENT ON TABLE overtime_batch_members IS 'Links individual overtime requests to batches';
COMMENT ON FUNCTION get_overtime_requests_for_date IS 'Get all overtime requests for a specific date with user details';
COMMENT ON FUNCTION get_approved_overtime_for_date IS 'Get approved overtime for timeline marker display';
COMMENT ON FUNCTION create_batch_overtime IS 'Create overtime requests for multiple employees at once';
