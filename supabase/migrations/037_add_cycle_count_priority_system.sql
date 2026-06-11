-- Add Priority System to Cycle Count Data Table
-- Migration: 037_add_cycle_count_priority_system.sql
-- Description: Adds priority system (Critical, Hot, Normal, Low) to cycle counts with proper assignment ordering

-- Create cycle count priority enum
CREATE TYPE cycle_count_priority AS ENUM ('critical', 'hot', 'normal', 'low');

-- Add priority column to rr_cyclecount_data table
ALTER TABLE public.rr_cyclecount_data 
ADD COLUMN priority cycle_count_priority DEFAULT 'normal' NOT NULL;

-- Create index for priority-based queries and assignment ordering
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_priority ON public.rr_cyclecount_data(priority);

-- Create composite index for priority-based assignment ordering (priority + created_at)
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_priority_assignment ON public.rr_cyclecount_data(
  organization_id, 
  status, 
  priority DESC,  -- Critical first, then Hot, Normal, Low
  created_at ASC   -- Oldest first within same priority
) WHERE status = 'pending' AND assigned_to IS NULL;

-- Create index for assigned counts with priority
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_assigned_priority ON public.rr_cyclecount_data(
  assigned_to, 
  priority DESC, 
  created_at ASC
) WHERE assigned_to IS NOT NULL;

-- Update the assign_next_cycle_count function to prioritize by priority level
DROP FUNCTION IF EXISTS assign_next_cycle_count(UUID);

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
  -- Order by: Priority (Critical > Hot > Normal > Low), then by creation date (oldest first)
  SELECT * INTO assigned_count
  FROM rr_cyclecount_data
  WHERE organization_id = user_org_id 
    AND status = 'pending'
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

-- Update the manual assignment function to preserve priority
DROP FUNCTION IF EXISTS assign_cycle_count_to_user(UUID, UUID);

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
  user_full_name TEXT;
  count_priority cycle_count_priority;
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
  
  -- Get the target user's organization ID and full name
  SELECT organization_id, full_name INTO user_org_id, user_full_name
  FROM user_profiles
  WHERE id = user_id;
  
  IF user_org_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Target user not found or not associated with an organization'
    );
  END IF;
  
  -- Get the cycle count's organization ID and priority
  SELECT organization_id, priority INTO count_org_id, count_priority
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
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() 
    AND (
      up.role IN ('admin', 'manager')
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
    assigned_at = now(),
    counter_name = COALESCE(user_full_name, 'Assigned User'),
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
    'message', 'Cycle count (' || UPPER(count_priority::TEXT) || ' priority) successfully assigned to ' || COALESCE(user_full_name, 'user')
  );
END;
$$;

-- Update the statistics function to include priority-based metrics
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
  is_admin_or_manager BOOLEAN;
  base_filter TEXT;
BEGIN
  -- Get current user's information
  SELECT auth.uid() INTO current_user_id;
  
  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = current_user_id;
  
  IF user_org_id IS NULL THEN
    RAISE EXCEPTION 'User not found or not associated with an organization';
  END IF;
  
  -- Check if user is admin or manager
  SELECT EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = current_user_id 
    AND up.role IN ('admin', 'manager')
  ) INTO is_admin_or_manager;
  
  -- Build base filter for RLS compliance
  base_filter := 'organization_id = ''' || user_org_id || '''';
  
  IF NOT is_admin_or_manager THEN
    base_filter := base_filter || ' AND (assigned_to IS NULL OR assigned_to = ''' || current_user_id || ''' OR created_by = ''' || current_user_id || ''')';
  END IF;
  
  -- Build comprehensive statistics including priority breakdowns
  EXECUTE 'SELECT json_build_object(
    ''totalCounts'', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE ' || base_filter || '
    ),
    ''pendingCounts'', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE ' || base_filter || ' AND status = ''pending''
    ),
    ''completedCounts'', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE ' || base_filter || ' AND status = ''completed''
    ),
    ''varianceReviewCounts'', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE ' || base_filter || ' AND status = ''variance_review''
    ),
    ''totalVarianceValue'', (
      SELECT COALESCE(SUM(ABS(variance_quantity)), 0) 
      FROM rr_cyclecount_data 
      WHERE ' || base_filter || ' AND variance_quantity IS NOT NULL
    ),
    ''countsRequiringRecount'', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE ' || base_filter || ' AND requires_recount = true AND recount_completed = false
    ),
    ''myAssignedCounts'', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE organization_id = ''' || user_org_id || ''' AND assigned_to = ''' || current_user_id || '''
    ),
    ''unassignedCounts'', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE organization_id = ''' || user_org_id || ''' AND assigned_to IS NULL
    ),
    ''priorityBreakdown'', json_build_object(
      ''critical'', (
        SELECT COUNT(*) 
        FROM rr_cyclecount_data 
        WHERE ' || base_filter || ' AND priority = ''critical'' AND status = ''pending''
      ),
      ''hot'', (
        SELECT COUNT(*) 
        FROM rr_cyclecount_data 
        WHERE ' || base_filter || ' AND priority = ''hot'' AND status = ''pending''
      ),
      ''normal'', (
        SELECT COUNT(*) 
        FROM rr_cyclecount_data 
        WHERE ' || base_filter || ' AND priority = ''normal'' AND status = ''pending''
      ),
      ''low'', (
        SELECT COUNT(*) 
        FROM rr_cyclecount_data 
        WHERE ' || base_filter || ' AND priority = ''low'' AND status = ''pending''
      )
    ),
    ''myAssignedByPriority'', json_build_object(
      ''critical'', (
        SELECT COUNT(*) 
        FROM rr_cyclecount_data 
        WHERE organization_id = ''' || user_org_id || ''' 
        AND assigned_to = ''' || current_user_id || '''
        AND priority = ''critical''
      ),
      ''hot'', (
        SELECT COUNT(*) 
        FROM rr_cyclecount_data 
        WHERE organization_id = ''' || user_org_id || ''' 
        AND assigned_to = ''' || current_user_id || '''
        AND priority = ''hot''
      ),
      ''normal'', (
        SELECT COUNT(*) 
        FROM rr_cyclecount_data 
        WHERE organization_id = ''' || user_org_id || ''' 
        AND assigned_to = ''' || current_user_id || '''
        AND priority = ''normal''
      ),
      ''low'', (
        SELECT COUNT(*) 
        FROM rr_cyclecount_data 
        WHERE organization_id = ''' || user_org_id || ''' 
        AND assigned_to = ''' || current_user_id || '''
        AND priority = ''low''
      )
    )
  )' INTO result;
  
  RETURN result;
END;
$$;

-- Function to update priority of existing counts
CREATE OR REPLACE FUNCTION update_cycle_count_priority(
  count_id UUID,
  new_priority cycle_count_priority
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  count_org_id UUID;
  current_user_org_id UUID;
  old_priority cycle_count_priority;
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
  
  -- Get the cycle count's organization ID and current priority
  SELECT organization_id, priority INTO count_org_id, old_priority
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
  
  -- Check if current user has permission to update priority
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() 
    AND (
      up.role IN ('admin', 'manager')
      OR EXISTS (
        SELECT 1 FROM rr_cyclecount_data cc
        WHERE cc.id = count_id AND cc.created_by = auth.uid()
      )
    )
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Insufficient permissions to update cycle count priority'
    );
  END IF;
  
  -- Update the priority
  UPDATE rr_cyclecount_data 
  SET 
    priority = new_priority,
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
    'message', 'Cycle count priority updated from ' || UPPER(old_priority::TEXT) || ' to ' || UPPER(new_priority::TEXT)
  );
END;
$$;

-- Update the audit trigger to log priority changes
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
    -- Log cycle count data updates including assignments and priority changes
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
        WHEN OLD.priority IS DISTINCT FROM NEW.priority THEN 'update'::audit_action
        ELSE 'update'::audit_action
      END,
      'cycle_count',
      NEW.id::TEXT,
      jsonb_build_object(
        'old', to_jsonb(OLD),
        'new', to_jsonb(NEW),
        'assignment_changed', (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to),
        'old_assigned_to', OLD.assigned_to,
        'new_assigned_to', NEW.assigned_to,
        'priority_changed', (OLD.priority IS DISTINCT FROM NEW.priority),
        'old_priority', OLD.priority,
        'new_priority', NEW.priority
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
COMMENT ON COLUMN rr_cyclecount_data.priority IS 'Priority level: critical, hot, normal, low - determines assignment order';
COMMENT ON FUNCTION update_cycle_count_priority IS 'Updates the priority level of a cycle count';

-- Set default priority for existing counts (if any)
UPDATE rr_cyclecount_data 
SET priority = 'normal' 
WHERE priority IS NULL;

