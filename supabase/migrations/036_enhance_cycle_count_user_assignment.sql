-- Enhance Cycle Count User Assignment
-- Migration: 036_enhance_cycle_count_user_assignment.sql  
-- Description: Adds user assignment tracking and atomic assignment logic for RF Interface cycle counts

-- Add assigned_to field to track user assignments
ALTER TABLE public.rr_cyclecount_data 
ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- Add assignment timestamp to track when count was assigned
ALTER TABLE public.rr_cyclecount_data 
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

-- Create index for efficient assignment queries
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_assigned_to ON public.rr_cyclecount_data(assigned_to);
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_status_assigned ON public.rr_cyclecount_data(status, assigned_to) 
WHERE status IN ('pending', 'in_progress');

-- Create function to atomically assign next pending count to a user
CREATE OR REPLACE FUNCTION assign_next_cycle_count(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  assigned_count RECORD;
  user_org_id UUID;
  result JSON;
BEGIN
  -- Get user's organization ID
  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = p_user_id;
  
  IF user_org_id IS NULL THEN
    RETURN json_build_object('error', 'User not found or not associated with an organization');
  END IF;
  
  -- Atomically find and assign next pending count
  -- Use FOR UPDATE SKIP LOCKED to prevent conflicts between concurrent requests
  SELECT * INTO assigned_count
  FROM rr_cyclecount_data
  WHERE organization_id = user_org_id 
    AND status = 'pending'
    AND (assigned_to IS NULL OR assigned_to = p_user_id)
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  
  IF assigned_count IS NULL THEN
    -- No pending counts available
    RETURN json_build_object(
      'success', false,
      'message', 'No pending cycle counts available',
      'data', NULL
    );
  END IF;
  
  -- Update the count to assign it to the user and set status to in_progress
  UPDATE rr_cyclecount_data
  SET 
    assigned_to = p_user_id,
    assigned_at = now(),
    status = 'in_progress',
    updated_at = now()
  WHERE id = assigned_count.id;
  
  -- Get user's full name for counter_name
  UPDATE rr_cyclecount_data
  SET counter_name = COALESCE(
    (SELECT full_name FROM user_profiles WHERE id = p_user_id),
    (SELECT email FROM auth.users WHERE id = p_user_id),
    'RF User'
  )
  WHERE id = assigned_count.id;
  
  -- Return the assigned count
  SELECT 
    id,
    count_number,
    material_number,
    material_description,
    location,
    warehouse,
    system_quantity,
    unit_of_measure,
    count_type,
    status,
    counter_name,
    assigned_at,
    organization_id
  INTO assigned_count
  FROM rr_cyclecount_data
  WHERE id = assigned_count.id;
  
  RETURN json_build_object(
    'success', true,
    'message', 'Cycle count assigned successfully',
    'data', row_to_json(assigned_count)
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM,
      'data', NULL
    );
END;
$$;

-- Create function to release a count assignment (for cancellation or reassignment)
CREATE OR REPLACE FUNCTION release_cycle_count_assignment(p_count_id UUID, p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_org_id UUID;
  count_record RECORD;
BEGIN
  -- Get user's organization ID
  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = p_user_id;
  
  IF user_org_id IS NULL THEN
    RETURN json_build_object('error', 'User not found or not associated with an organization');
  END IF;
  
  -- Verify the count belongs to the user and organization
  SELECT * INTO count_record
  FROM rr_cyclecount_data
  WHERE id = p_count_id 
    AND organization_id = user_org_id
    AND assigned_to = p_user_id
    AND status = 'in_progress';
    
  IF count_record IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Count not found or not assigned to user'
    );
  END IF;
  
  -- Release the assignment
  UPDATE rr_cyclecount_data
  SET 
    assigned_to = NULL,
    assigned_at = NULL,
    status = 'pending',
    counter_name = NULL,
    updated_at = now()
  WHERE id = p_count_id;
  
  RETURN json_build_object(
    'success', true,
    'message', 'Count assignment released successfully'
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM
    );
END;
$$;

-- Create function to get user's current assigned counts
CREATE OR REPLACE FUNCTION get_user_assigned_counts(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_org_id UUID;
  assigned_counts JSON;
BEGIN
  -- Get user's organization ID
  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = p_user_id;
  
  IF user_org_id IS NULL THEN
    RETURN json_build_object('error', 'User not found or not associated with an organization');
  END IF;
  
  -- Get all assigned counts for the user
  SELECT json_agg(
    json_build_object(
      'id', id,
      'count_number', count_number,
      'material_number', material_number,
      'material_description', material_description,
      'location', location,
      'warehouse', warehouse,
      'system_quantity', system_quantity,
      'unit_of_measure', unit_of_measure,
      'status', status,
      'assigned_at', assigned_at
    )
  ) INTO assigned_counts
  FROM rr_cyclecount_data
  WHERE organization_id = user_org_id
    AND assigned_to = p_user_id
    AND status = 'in_progress'
  ORDER BY assigned_at ASC;
  
  RETURN json_build_object(
    'success', true,
    'data', COALESCE(assigned_counts, '[]'::json)
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM
    );
END;
$$;

-- Create function to check if there are pending counts available
CREATE OR REPLACE FUNCTION check_pending_counts_available()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_org_id UUID;
  pending_count INTEGER;
BEGIN
  -- Get user's organization ID
  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = auth.uid();
  
  IF user_org_id IS NULL THEN
    RETURN json_build_object('error', 'User not found or not associated with an organization');
  END IF;
  
  -- Count pending unassigned counts
  SELECT COUNT(*) INTO pending_count
  FROM rr_cyclecount_data
  WHERE organization_id = user_org_id
    AND status = 'pending'
    AND assigned_to IS NULL;
  
  RETURN json_build_object(
    'success', true,
    'pending_counts', pending_count,
    'has_pending', pending_count > 0
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM
    );
END;
$$;

-- Update RLS policies to include assigned_to field
DROP POLICY IF EXISTS "Users can view cycle count data from their organization" ON rr_cyclecount_data;
DROP POLICY IF EXISTS "Users can update cycle count data in their organization" ON rr_cyclecount_data;

-- Enhanced RLS policy for viewing (users can see counts from their org, and specifically assigned counts)
CREATE POLICY "Users can view cycle count data from their organization" ON rr_cyclecount_data
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM user_profiles
      WHERE id = auth.uid()
    )
  );

-- Enhanced RLS policy for updating (users can update counts assigned to them or pending counts in their org)
CREATE POLICY "Users can update cycle count data in their organization" ON rr_cyclecount_data
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM user_profiles
      WHERE id = auth.uid()
    ) AND (
      assigned_to = auth.uid() OR 
      status = 'pending'
    )
  );

-- Add comments for the new fields
COMMENT ON COLUMN rr_cyclecount_data.assigned_to IS 'User assigned to perform this cycle count';
COMMENT ON COLUMN rr_cyclecount_data.assigned_at IS 'Timestamp when count was assigned to user';

-- Add comments for the new functions
COMMENT ON FUNCTION assign_next_cycle_count(UUID) IS 'Atomically assigns next pending cycle count to a user';
COMMENT ON FUNCTION release_cycle_count_assignment(UUID, UUID) IS 'Releases a cycle count assignment back to pending status';
COMMENT ON FUNCTION get_user_assigned_counts(UUID) IS 'Gets all cycle counts currently assigned to a user';
COMMENT ON FUNCTION check_pending_counts_available() IS 'Checks if there are pending cycle counts available for assignment';
