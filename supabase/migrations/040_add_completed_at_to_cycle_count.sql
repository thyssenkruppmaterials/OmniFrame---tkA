-- Add completed_at column to cycle count data table
-- Migration: 040_add_completed_at_to_cycle_count.sql
-- Description: Adds completed_at column to track when cycle counts are finished

-- Add completed_at column to rr_cyclecount_data table
ALTER TABLE public.rr_cyclecount_data 
ADD COLUMN completed_at TIMESTAMPTZ NULL;

-- Create index for performance on completed_at queries
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_completed_at ON public.rr_cyclecount_data(completed_at DESC);

-- Create composite index for status and completion filtering
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_status_completed ON public.rr_cyclecount_data(
  organization_id, 
  status, 
  completed_at DESC
) WHERE status = 'completed';

-- Update the audit trigger to log completion time changes
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
    -- Log cycle count data updates including assignments, priority changes, and completion
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
        WHEN OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed' THEN 'complete'::audit_action
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
        'new_priority', NEW.priority,
        'completion_changed', (OLD.completed_at IS DISTINCT FROM NEW.completed_at),
        'old_completed_at', OLD.completed_at,
        'new_completed_at', NEW.completed_at,
        'status_changed', (OLD.status IS DISTINCT FROM NEW.status),
        'old_status', OLD.status,
        'new_status', NEW.status
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

-- Update the cycle count statistics function to include completion time metrics
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
  
  -- Build comprehensive statistics including priority breakdowns and completion metrics
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
    ),
    ''completionMetrics'', json_build_object(
      ''completedToday'', (
        SELECT COUNT(*) 
        FROM rr_cyclecount_data 
        WHERE ' || base_filter || ' 
        AND status = ''completed''
        AND completed_at >= CURRENT_DATE
      ),
      ''completedThisWeek'', (
        SELECT COUNT(*) 
        FROM rr_cyclecount_data 
        WHERE ' || base_filter || ' 
        AND status = ''completed''
        AND completed_at >= date_trunc(''week'', CURRENT_DATE)
      ),
      ''averageCompletionTimeMinutes'', (
        SELECT COALESCE(
          AVG(EXTRACT(EPOCH FROM (completed_at - assigned_at)) / 60), 0
        )
        FROM rr_cyclecount_data 
        WHERE ' || base_filter || ' 
        AND status = ''completed''
        AND completed_at IS NOT NULL
        AND assigned_at IS NOT NULL
      )
    )
  )' INTO result;
  
  RETURN result;
END;
$$;

-- Add comments for documentation
COMMENT ON COLUMN rr_cyclecount_data.completed_at IS 'Timestamp when the cycle count was completed by the user';

-- Add a trigger to automatically set completed_at when status changes to completed
CREATE OR REPLACE FUNCTION auto_set_completed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Set completed_at when status changes to completed and it wasn't already set
  IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at = now();
  END IF;
  
  -- Clear completed_at if status changes away from completed
  IF NEW.status != 'completed' AND OLD.status = 'completed' THEN
    NEW.completed_at = NULL;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER auto_set_completed_at_trigger
  BEFORE UPDATE ON rr_cyclecount_data
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_completed_at();

