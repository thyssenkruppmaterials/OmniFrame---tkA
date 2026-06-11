-- Add User Assignment to Cycle Count Data Table
-- Migration: 036_add_cycle_count_user_assignment.sql
-- Description: Adds user assignment functionality to cycle count data for user-specific count distribution

-- Add assigned_to column to track which user a count is assigned to
ALTER TABLE public.rr_cyclecount_data 
ADD COLUMN assigned_to UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- Create index for assignment filtering performance
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_assigned_to ON public.rr_cyclecount_data(assigned_to);

-- Create composite index for organization + assignment filtering  
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_org_assigned ON public.rr_cyclecount_data(organization_id, assigned_to);

-- Update the existing RLS policy to handle assignment logic
-- Drop the existing view policy and create a new one with assignment support
DROP POLICY IF EXISTS "Users can view cycle count data from their organization" ON rr_cyclecount_data;

CREATE POLICY "Users can view assigned or unassigned cycle counts from their organization" ON rr_cyclecount_data
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM user_profiles 
      WHERE id = auth.uid()
    )
    AND (
      -- Count is not assigned to anyone (available to all)
      assigned_to IS NULL
      OR 
      -- Count is assigned to the current user
      assigned_to = auth.uid()
      OR
      -- User is the creator of the count (can always see their own counts)
      created_by = auth.uid()
      OR
      -- User has admin/manager role (can see all counts)
      EXISTS (
        SELECT 1 FROM user_profiles up
        WHERE up.id = auth.uid() 
        AND up.role IN ('admin', 'manager', 'supervisor')
      )
    )
  );

-- Create RPC function to assign a count to a user
CREATE OR REPLACE FUNCTION assign_cycle_count_to_user(
  count_id UUID,
  user_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  user_org_id UUID;
  count_org_id UUID;
  current_user_org_id UUID;
BEGIN
  -- Get current user's organization ID
  SELECT organization_id INTO current_user_org_id
  FROM user_profiles
  WHERE id = auth.uid();
  
  IF current_user_org_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Current user not found or not associated with an organization'
    );
  END IF;
  
  -- Get the target user's organization ID
  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = user_id;
  
  IF user_org_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Target user not found or not associated with an organization'
    );
  END IF;
  
  -- Get the cycle count's organization ID
  SELECT organization_id INTO count_org_id
  FROM rr_cyclecount_data
  WHERE id = count_id;
  
  IF count_org_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cycle count not found'
    );
  END IF;
  
  -- Verify all parties are in the same organization
  IF user_org_id != current_user_org_id OR count_org_id != current_user_org_id THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot assign count across different organizations'
    );
  END IF;
  
  -- Check if current user has permission to assign counts
  -- (Admin, manager, supervisor, or the creator of the count)
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() 
    AND (
      up.role IN ('admin', 'manager', 'supervisor')
      OR EXISTS (
        SELECT 1 FROM rr_cyclecount_data cc
        WHERE cc.id = count_id AND cc.created_by = auth.uid()
      )
    )
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Insufficient permissions to assign cycle counts'
    );
  END IF;
  
  -- Perform the assignment
  UPDATE rr_cyclecount_data 
  SET 
    assigned_to = user_id,
    updated_at = now()
  WHERE id = count_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cycle count not found or could not be updated'
    );
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'message', 'Cycle count successfully assigned'
  );
END;
$$;

-- Create RPC function to unassign a count (make it available to everyone)
CREATE OR REPLACE FUNCTION unassign_cycle_count(
  count_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  count_org_id UUID;
  current_user_org_id UUID;
BEGIN
  -- Get current user's organization ID
  SELECT organization_id INTO current_user_org_id
  FROM user_profiles
  WHERE id = auth.uid();
  
  IF current_user_org_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Current user not found or not associated with an organization'
    );
  END IF;
  
  -- Get the cycle count's organization ID
  SELECT organization_id INTO count_org_id
  FROM rr_cyclecount_data
  WHERE id = count_id;
  
  IF count_org_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cycle count not found'
    );
  END IF;
  
  -- Verify same organization
  IF count_org_id != current_user_org_id THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot modify count from different organization'
    );
  END IF;
  
  -- Check if current user has permission to unassign counts
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() 
    AND (
      up.role IN ('admin', 'manager', 'supervisor')
      OR EXISTS (
        SELECT 1 FROM rr_cyclecount_data cc
        WHERE cc.id = count_id AND cc.created_by = auth.uid()
      )
    )
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Insufficient permissions to unassign cycle counts'
    );
  END IF;
  
  -- Remove the assignment
  UPDATE rr_cyclecount_data 
  SET 
    assigned_to = NULL,
    updated_at = now()
  WHERE id = count_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cycle count not found or could not be updated'
    );
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'message', 'Cycle count assignment removed - now available to all users'
  );
END;
$$;

-- Update the statistics function to include assignment information
DROP FUNCTION IF EXISTS get_cycle_count_statistics();

CREATE OR REPLACE FUNCTION get_cycle_count_statistics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  user_org_id UUID;
  current_user_id UUID;
BEGIN
  -- Get current user's information
  SELECT auth.uid() INTO current_user_id;
  
  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = current_user_id;
  
  IF user_org_id IS NULL THEN
    RAISE EXCEPTION 'User not found or not associated with an organization';
  END IF;
  
  -- Build statistics (only for counts the user can see based on RLS policy)
  SELECT json_build_object(
    'totalCounts', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id
      AND (
        assigned_to IS NULL
        OR assigned_to = current_user_id
        OR created_by = current_user_id
        OR EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = current_user_id 
          AND up.role IN ('admin', 'manager', 'supervisor')
        )
      )
    ),
    'pendingCounts', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id 
      AND status = 'pending'
      AND (
        assigned_to IS NULL
        OR assigned_to = current_user_id
        OR created_by = current_user_id
        OR EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = current_user_id 
          AND up.role IN ('admin', 'manager', 'supervisor')
        )
      )
    ),
    'completedCounts', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id 
      AND status = 'completed'
      AND (
        assigned_to IS NULL
        OR assigned_to = current_user_id
        OR created_by = current_user_id
        OR EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = current_user_id 
          AND up.role IN ('admin', 'manager', 'supervisor')
        )
      )
    ),
    'varianceReviewCounts', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id 
      AND status = 'variance_review'
      AND (
        assigned_to IS NULL
        OR assigned_to = current_user_id
        OR created_by = current_user_id
        OR EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = current_user_id 
          AND up.role IN ('admin', 'manager', 'supervisor')
        )
      )
    ),
    'totalVarianceValue', (
      SELECT COALESCE(SUM(ABS(variance_quantity)), 0) 
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id 
      AND variance_quantity IS NOT NULL
      AND (
        assigned_to IS NULL
        OR assigned_to = current_user_id
        OR created_by = current_user_id
        OR EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = current_user_id 
          AND up.role IN ('admin', 'manager', 'supervisor')
        )
      )
    ),
    'countsRequiringRecount', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id 
      AND requires_recount = true 
      AND recount_completed = false
      AND (
        assigned_to IS NULL
        OR assigned_to = current_user_id
        OR created_by = current_user_id
        OR EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = current_user_id 
          AND up.role IN ('admin', 'manager', 'supervisor')
        )
      )
    ),
    'myAssignedCounts', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id 
      AND assigned_to = current_user_id
    ),
    'unassignedCounts', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id 
      AND assigned_to IS NULL
    )
  ) INTO result;
  
  RETURN result;
END;
$$;

-- Update the audit trigger to log assignment changes
DROP FUNCTION IF EXISTS audit_rr_cyclecount_data() CASCADE;

CREATE OR REPLACE FUNCTION audit_rr_cyclecount_data()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Log cycle count data creation
    INSERT INTO audit_logs (
      user_id,
      organization_id,
      action,
      resource_type,
      resource_id,
      changes
    ) VALUES (
      NEW.created_by,
      NEW.organization_id,
      'create'::audit_action,
      'cycle_count',
      NEW.id::TEXT,
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Log cycle count data updates including assignments
    INSERT INTO audit_logs (
      user_id,
      organization_id,
      action,
      resource_type,
      resource_id,
      changes
    ) VALUES (
      COALESCE(auth.uid(), NEW.created_by),
      NEW.organization_id,
      CASE 
        WHEN OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN 'assign'::audit_action
        ELSE 'update'::audit_action
      END,
      'cycle_count',
      NEW.id::TEXT,
      jsonb_build_object(
        'old', to_jsonb(OLD),
        'new', to_jsonb(NEW),
        'assignment_changed', (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to),
        'old_assigned_to', OLD.assigned_to,
        'new_assigned_to', NEW.assigned_to
      )
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

-- Recreate the audit trigger
CREATE TRIGGER audit_rr_cyclecount_data_trigger
  AFTER INSERT OR UPDATE ON rr_cyclecount_data
  FOR EACH ROW
  EXECUTE FUNCTION audit_rr_cyclecount_data();

-- Add comments for documentation
COMMENT ON COLUMN rr_cyclecount_data.assigned_to IS 'User assigned to perform this count. NULL means available to all users';
COMMENT ON FUNCTION assign_cycle_count_to_user IS 'Assigns a cycle count to a specific user';
COMMENT ON FUNCTION unassign_cycle_count IS 'Removes assignment from a cycle count, making it available to all users';

-- Add foreign key constraint for assigned_to
ALTER TABLE public.rr_cyclecount_data 
ADD CONSTRAINT rr_cyclecount_data_assigned_to_fkey 
FOREIGN KEY (assigned_to) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

