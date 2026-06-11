-- Add 'recount' status to cycle_count_status enum
-- Migration: 041_add_recount_status.sql
-- Description: Adds 'recount' status to support cycle count recount workflow

-- Add 'recount' to the cycle_count_status enum
ALTER TYPE cycle_count_status ADD VALUE IF NOT EXISTS 'recount';

-- Update the status color mapping comment to include recount status
COMMENT ON TYPE cycle_count_status IS 'Cycle count status: pending, in_progress, completed, variance_review, approved, cancelled, recount';

-- Create index for recount status queries (for performance)
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_recount_status 
ON public.rr_cyclecount_data(status, requires_recount, recount_completed)
WHERE status = 'recount';

-- Update cycle count assignment function to handle recount status
-- This ensures recount status counts are available for assignment
CREATE OR REPLACE FUNCTION assign_next_cycle_count(p_user_id uuid)
RETURNS json
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
  
  -- Atomically find and assign next pending count based on priority
  -- Include 'recount' status counts in available work
  -- Order by: Priority (Critical > Hot > Normal > Low), then by creation date (oldest first)
  SELECT * INTO assigned_count
  FROM rr_cyclecount_data
  WHERE organization_id = user_org_id 
    AND status IN ('pending', 'recount')  -- Include recount status
    AND (assigned_to IS NULL OR assigned_to = p_user_id)
  ORDER BY 
    CASE priority 
      WHEN 'critical' THEN 1
      WHEN 'hot' THEN 2  
      WHEN 'normal' THEN 3
      WHEN 'low' THEN 4
    END ASC,
    created_at ASC
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
  
  -- Return the assigned count with priority information
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
    priority,
    counter_name,
    assigned_at,
    organization_id
  INTO assigned_count
  FROM rr_cyclecount_data
  WHERE id = assigned_count.id;
  
  RETURN json_build_object(
    'success', true,
    'message', 'Cycle count assigned successfully',
    'data', json_build_object(
      'id', assigned_count.id,
      'count_number', assigned_count.count_number,
      'material_number', assigned_count.material_number,
      'material_description', assigned_count.material_description,
      'location', assigned_count.location,
      'warehouse', assigned_count.warehouse,
      'system_quantity', assigned_count.system_quantity,
      'unit_of_measure', assigned_count.unit_of_measure,
      'count_type', assigned_count.count_type,
      'status', assigned_count.status,
      'priority', assigned_count.priority,
      'counter_name', assigned_count.counter_name,
      'assigned_at', assigned_count.assigned_at,
      'organization_id', assigned_count.organization_id
    )
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('error', 'Failed to assign cycle count: ' || SQLERRM);
END;
$$;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION assign_next_cycle_count(uuid) TO authenticated;
