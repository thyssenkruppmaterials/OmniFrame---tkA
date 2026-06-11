-- Recount History Table
-- Migration: 044_recount_history_table.sql  
-- Description: Creates comprehensive audit trail for cycle count recounts with comparison capabilities

-- Create recount history table
CREATE TABLE IF NOT EXISTS public.rr_cycle_count_recount_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Reference to original cycle count
  original_count_id UUID NOT NULL REFERENCES public.rr_cyclecount_data(id) ON DELETE CASCADE,
  
  -- Original count information (snapshot at time of recount initiation)
  original_counted_quantity NUMERIC(10,3),
  original_variance_quantity NUMERIC(10,3),
  original_variance_percentage NUMERIC(5,2),
  original_counter_name VARCHAR(100),
  original_counter_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  original_count_date DATE,
  original_notes TEXT,
  
  -- Recount information
  recount_number INTEGER DEFAULT 1, -- 1st recount, 2nd recount, etc.
  recount_quantity NUMERIC(10,3),
  recount_variance_quantity NUMERIC(10,3),
  recount_variance_percentage NUMERIC(5,2),
  recount_counter_name VARCHAR(100),
  recount_counter_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  recount_date DATE,
  recount_notes TEXT,
  
  -- Recount workflow tracking
  recount_reason TEXT NOT NULL,
  initiated_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  initiated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  completed_at TIMESTAMPTZ,
  
  -- Comparison and resolution
  variance_difference NUMERIC(10,3), -- Difference between original and recount variance
  agreement_status VARCHAR(50), -- 'matches', 'close', 'significant_diff', 'opposite_direction'
  resolution_action VARCHAR(50), -- 'accepted_original', 'accepted_recount', 'third_count_required', 'pending'
  resolved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  
  -- Metadata
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_recount_history_original_count ON public.rr_cycle_count_recount_history(original_count_id);
CREATE INDEX IF NOT EXISTS idx_recount_history_initiated_by ON public.rr_cycle_count_recount_history(initiated_by);
CREATE INDEX IF NOT EXISTS idx_recount_history_organization ON public.rr_cycle_count_recount_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_recount_history_resolution ON public.rr_cycle_count_recount_history(resolution_action, completed_at);
CREATE INDEX IF NOT EXISTS idx_recount_history_created_at ON public.rr_cycle_count_recount_history(created_at DESC);

-- Enable Row Level Security
ALTER TABLE rr_cycle_count_recount_history ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view recount history from their organization
CREATE POLICY "Users can view recount history from their organization" ON rr_cycle_count_recount_history
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM user_profiles 
      WHERE id = auth.uid()
    )
  );

-- RLS Policy: Users can insert recount history for their organization
CREATE POLICY "Users can insert recount history for their organization" ON rr_cycle_count_recount_history
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM user_profiles 
      WHERE id = auth.uid()
    )
    AND initiated_by = auth.uid()
  );

-- RLS Policy: Users can update recount history in their organization
CREATE POLICY "Users can update recount history in their organization" ON rr_cycle_count_recount_history
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Function to initiate recount with history tracking
CREATE OR REPLACE FUNCTION initiate_recount_with_history(
  p_count_id UUID,
  p_recount_reason TEXT,
  p_initiated_by UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  original_count RECORD;
  user_org_id UUID;
  current_user_id UUID;
  recount_number INTEGER;
  history_record RECORD;
BEGIN
  -- Get current user
  current_user_id := COALESCE(p_initiated_by, auth.uid());
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not authenticated');
  END IF;
  
  -- Get user's organization ID
  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = current_user_id;
  
  IF user_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found or not associated with an organization');
  END IF;
  
  -- Get the original count details
  SELECT * INTO original_count
  FROM rr_cyclecount_data
  WHERE id = p_count_id 
    AND organization_id = user_org_id;
    
  IF original_count IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Count not found or access denied');
  END IF;
  
  -- Determine recount number (how many recounts have been done already)
  SELECT COALESCE(MAX(recount_number), 0) + 1 INTO recount_number
  FROM rr_cycle_count_recount_history
  WHERE original_count_id = p_count_id;
  
  -- Create history record capturing current state
  INSERT INTO rr_cycle_count_recount_history (
    original_count_id,
    original_counted_quantity,
    original_variance_quantity,
    original_variance_percentage,
    original_counter_name,
    original_counter_id,
    original_count_date,
    original_notes,
    recount_number,
    recount_reason,
    initiated_by,
    initiated_at,
    organization_id,
    resolution_action
  ) VALUES (
    p_count_id,
    original_count.counted_quantity,
    original_count.variance_quantity,
    original_count.variance_percentage,
    original_count.counter_name,
    original_count.assigned_to,
    original_count.count_date,
    original_count.notes,
    recount_number,
    p_recount_reason,
    current_user_id,
    now(),
    user_org_id,
    'pending'
  )
  RETURNING * INTO history_record;
  
  -- Update the cycle count to recount status
  UPDATE rr_cyclecount_data
  SET 
    status = 'recount',
    requires_recount = true,
    recount_completed = false,
    assigned_to = NULL,
    assigned_at = NULL,
    notes = CASE 
      WHEN notes IS NULL THEN 'Recount initiated: ' || p_recount_reason
      ELSE notes || ' | Recount initiated: ' || p_recount_reason
    END,
    updated_at = now()
  WHERE id = p_count_id;
  
  RETURN json_build_object(
    'success', true,
    'message', 'Recount initiated successfully',
    'recount_number', recount_number,
    'history_id', history_record.id,
    'original_counter', original_count.counter_name
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM
    );
END;
$$;

-- Function to complete recount and update history
CREATE OR REPLACE FUNCTION complete_recount_with_history(
  p_count_id UUID,
  p_recount_quantity NUMERIC,
  p_recount_counter_name VARCHAR,
  p_recount_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  original_count RECORD;
  current_user_id UUID;
  latest_history RECORD;
  variance_diff NUMERIC;
  agreement VARCHAR(50);
BEGIN
  -- Get current user
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not authenticated');
  END IF;
  
  -- Get the original count
  SELECT * INTO original_count
  FROM rr_cyclecount_data
  WHERE id = p_count_id;
    
  IF original_count IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Count not found');
  END IF;
  
  -- Get the latest recount history record
  SELECT * INTO latest_history
  FROM rr_cycle_count_recount_history
  WHERE original_count_id = p_count_id
    AND completed_at IS NULL
  ORDER BY initiated_at DESC
  LIMIT 1;
  
  IF latest_history IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No pending recount found');
  END IF;
  
  -- Calculate recount variance
  DECLARE
    recount_variance NUMERIC;
    recount_variance_pct NUMERIC;
  BEGIN
    recount_variance := p_recount_quantity - original_count.system_quantity;
    
    IF original_count.system_quantity > 0 THEN
      recount_variance_pct := (ABS(recount_variance) / original_count.system_quantity) * 100;
    ELSE
      recount_variance_pct := NULL;
    END IF;
    
    -- Calculate variance difference (how much the recount differed from original)
    variance_diff := ABS(recount_variance - COALESCE(latest_history.original_variance_quantity, 0));
    
    -- Determine agreement status
    IF original_count.counted_quantity = p_recount_quantity THEN
      agreement := 'matches';
    ELSIF variance_diff <= 2 THEN
      agreement := 'close';
    ELSIF (latest_history.original_variance_quantity > 0 AND recount_variance < 0) OR 
          (latest_history.original_variance_quantity < 0 AND recount_variance > 0) THEN
      agreement := 'opposite_direction';
    ELSE
      agreement := 'significant_diff';
    END IF;
    
    -- Update history record
    UPDATE rr_cycle_count_recount_history
    SET 
      recount_quantity = p_recount_quantity,
      recount_variance_quantity = recount_variance,
      recount_variance_percentage = recount_variance_pct,
      recount_counter_name = p_recount_counter_name,
      recount_counter_id = current_user_id,
      recount_date = CURRENT_DATE,
      recount_notes = p_recount_notes,
      variance_difference = variance_diff,
      agreement_status = agreement,
      completed_at = now(),
      updated_at = now()
    WHERE id = latest_history.id;
    
    -- Update the original cycle count
    UPDATE rr_cyclecount_data
    SET 
      counted_quantity = p_recount_quantity,
      variance_quantity = recount_variance,
      variance_percentage = recount_variance_pct,
      recount_by = p_recount_counter_name,
      recount_date = CURRENT_DATE,
      recount_completed = true,
      status = CASE 
        WHEN agreement = 'matches' THEN 'completed'
        WHEN agreement = 'close' THEN 'completed'
        ELSE 'variance_review'
      END,
      updated_at = now()
    WHERE id = p_count_id;
    
    RETURN json_build_object(
      'success', true,
      'message', 'Recount completed successfully',
      'agreement_status', agreement,
      'variance_difference', variance_diff,
      'final_status', CASE 
        WHEN agreement IN ('matches', 'close') THEN 'completed'
        ELSE 'variance_review'
      END
    );
  END;
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM
    );
END;
$$;

-- Function to get recount comparison data
CREATE OR REPLACE FUNCTION get_recount_comparison(p_count_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_org_id UUID;
  comparison_data JSON;
BEGIN
  -- Get user's organization ID
  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = auth.uid();
  
  IF user_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found or not associated with an organization');
  END IF;
  
  -- Build comparison data
  SELECT json_build_object(
    'success', true,
    'count_info', (
      SELECT row_to_json(cc)
      FROM rr_cyclecount_data cc
      WHERE cc.id = p_count_id
        AND cc.organization_id = user_org_id
    ),
    'recount_history', (
      SELECT json_agg(
        json_build_object(
          'recount_number', rh.recount_number,
          'original_quantity', rh.original_counted_quantity,
          'recount_quantity', rh.recount_quantity,
          'variance_difference', rh.variance_difference,
          'agreement_status', rh.agreement_status,
          'recount_reason', rh.recount_reason,
          'initiated_by_name', (SELECT full_name FROM user_profiles WHERE id = rh.initiated_by),
          'recount_counter_name', rh.recount_counter_name,
          'initiated_at', rh.initiated_at,
          'completed_at', rh.completed_at,
          'resolution_action', rh.resolution_action
        ) ORDER BY rh.recount_number
      )
      FROM rr_cycle_count_recount_history rh
      WHERE rh.original_count_id = p_count_id
        AND rh.organization_id = user_org_id
    )
  ) INTO comparison_data;
  
  RETURN comparison_data;
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM
    );
END;
$$;

-- Function to resolve recount (admin/supervisor decision)
CREATE OR REPLACE FUNCTION resolve_recount(
  p_count_id UUID,
  p_history_id UUID,
  p_resolution_action VARCHAR,
  p_resolution_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_org_id UUID;
  current_user_id UUID;
  user_role TEXT;
  history_record RECORD;
BEGIN
  -- Get current user
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not authenticated');
  END IF;
  
  -- Get user's organization ID and role
  SELECT up.organization_id, r.name INTO user_org_id, user_role
  FROM user_profiles up
  JOIN roles r ON up.role_id = r.id
  WHERE up.id = current_user_id;
  
  IF user_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found or not associated with an organization');
  END IF;
  
  -- Check if user has supervisor/admin privileges
  IF user_role NOT IN ('admin', 'manager', 'supervisor') THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Insufficient privileges to resolve recounts'
    );
  END IF;
  
  -- Get history record
  SELECT * INTO history_record
  FROM rr_cycle_count_recount_history
  WHERE id = p_history_id
    AND original_count_id = p_count_id
    AND organization_id = user_org_id;
    
  IF history_record IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Recount history not found');
  END IF;
  
  -- Update history resolution
  UPDATE rr_cycle_count_recount_history
  SET 
    resolution_action = p_resolution_action,
    resolved_by = current_user_id,
    resolved_at = now(),
    resolution_notes = p_resolution_notes,
    updated_at = now()
  WHERE id = p_history_id;
  
  -- Update main count based on resolution
  IF p_resolution_action = 'accepted_recount' THEN
    -- Accept the recount values
    UPDATE rr_cyclecount_data
    SET 
      status = 'approved',
      approved_by = current_user_id,
      approved_at = now(),
      approval_comments = 'Recount accepted by supervisor: ' || COALESCE(p_resolution_notes, 'No comments'),
      updated_at = now()
    WHERE id = p_count_id;
  ELSIF p_resolution_action = 'accepted_original' THEN
    -- Revert to original count values
    UPDATE rr_cyclecount_data
    SET 
      counted_quantity = history_record.original_counted_quantity,
      variance_quantity = history_record.original_variance_quantity,
      variance_percentage = history_record.original_variance_percentage,
      counter_name = history_record.original_counter_name,
      status = 'approved',
      approved_by = current_user_id,
      approved_at = now(),
      approval_comments = 'Original count accepted by supervisor: ' || COALESCE(p_resolution_notes, 'No comments'),
      recount_completed = false,
      updated_at = now()
    WHERE id = p_count_id;
  ELSIF p_resolution_action = 'third_count_required' THEN
    -- Reset to pending for another recount
    UPDATE rr_cyclecount_data
    SET 
      status = 'recount',
      assigned_to = NULL,
      assigned_at = NULL,
      notes = notes || ' | Third count required by supervisor',
      updated_at = now()
    WHERE id = p_count_id;
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'message', 'Recount resolved successfully',
    'resolution_action', p_resolution_action
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM
    );
END;
$$;

-- Add audit trigger for recount history
CREATE OR REPLACE FUNCTION audit_recount_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (
      user_id,
      organization_id,
      action,
      resource_type,
      resource_id,
      changes
    ) VALUES (
      NEW.initiated_by,
      NEW.organization_id,
      'create'::audit_action,
      'recount_history',
      NEW.id::TEXT,
      to_jsonb(NEW)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (
      user_id,
      organization_id,
      action,
      resource_type,
      resource_id,
      changes
    ) VALUES (
      COALESCE(NEW.resolved_by, NEW.recount_counter_id, NEW.initiated_by),
      NEW.organization_id,
      'update'::audit_action,
      'recount_history',
      NEW.id::TEXT,
      jsonb_build_object(
        'old', to_jsonb(OLD),
        'new', to_jsonb(NEW),
        'resolution_changed', (OLD.resolution_action IS DISTINCT FROM NEW.resolution_action)
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_recount_history_trigger
  AFTER INSERT OR UPDATE ON rr_cycle_count_recount_history
  FOR EACH ROW
  EXECUTE FUNCTION audit_recount_history();

-- Add comments
COMMENT ON TABLE rr_cycle_count_recount_history IS 'Comprehensive audit trail for cycle count recounts with comparison and resolution tracking';
COMMENT ON COLUMN rr_cycle_count_recount_history.variance_difference IS 'Absolute difference between original variance and recount variance';
COMMENT ON COLUMN rr_cycle_count_recount_history.agreement_status IS 'Indicates how closely recount matches original: matches, close, significant_diff, opposite_direction';
COMMENT ON COLUMN rr_cycle_count_recount_history.resolution_action IS 'Supervisor decision: accepted_original, accepted_recount, third_count_required, pending';
COMMENT ON FUNCTION initiate_recount_with_history IS 'Initiates recount and creates comprehensive history record';
COMMENT ON FUNCTION complete_recount_with_history IS 'Completes recount, updates history, and determines agreement status';
COMMENT ON FUNCTION get_recount_comparison IS 'Retrieves complete recount history with comparison data for supervisor review';

