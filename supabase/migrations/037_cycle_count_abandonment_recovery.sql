-- Cycle Count Abandonment Recovery System
-- Migration: 037_cycle_count_abandonment_recovery.sql  
-- Description: Adds abandoned count detection and automatic recovery for RF Interface cycle counts

-- Create function to detect abandoned cycle counts
-- Counts are considered abandoned if they've been in_progress for more than 30 minutes
CREATE OR REPLACE FUNCTION detect_abandoned_cycle_counts(p_abandonment_threshold_minutes INTEGER DEFAULT 30)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  abandoned_counts JSON;
  abandonment_threshold TIMESTAMPTZ;
BEGIN
  -- Calculate the abandonment threshold timestamp
  abandonment_threshold := now() - (p_abandonment_threshold_minutes || ' minutes')::INTERVAL;
  
  -- Find counts that have been in_progress longer than the threshold
  SELECT json_agg(
    json_build_object(
      'id', id,
      'count_number', count_number,
      'material_number', material_number,
      'location', location,
      'assigned_to', assigned_to,
      'assigned_at', assigned_at,
      'counter_name', counter_name,
      'minutes_since_assignment', EXTRACT(EPOCH FROM (now() - assigned_at)) / 60,
      'organization_id', organization_id
    )
  ) INTO abandoned_counts
  FROM rr_cyclecount_data
  WHERE status = 'in_progress'
    AND assigned_at < abandonment_threshold
    AND assigned_to IS NOT NULL
  ORDER BY assigned_at ASC;
  
  RETURN json_build_object(
    'success', true,
    'abandonment_threshold_minutes', p_abandonment_threshold_minutes,
    'abandoned_counts', COALESCE(abandoned_counts, '[]'::json),
    'total_abandoned', (
      SELECT COUNT(*)
      FROM rr_cyclecount_data
      WHERE status = 'in_progress'
        AND assigned_at < abandonment_threshold
        AND assigned_to IS NOT NULL
    )
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM
    );
END;
$$;

-- Create function to automatically release abandoned cycle counts
CREATE OR REPLACE FUNCTION release_abandoned_cycle_counts(
  p_abandonment_threshold_minutes INTEGER DEFAULT 30,
  p_max_releases INTEGER DEFAULT 50
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  abandonment_threshold TIMESTAMPTZ;
  released_count INTEGER := 0;
  released_counts JSON;
BEGIN
  -- Calculate the abandonment threshold timestamp
  abandonment_threshold := now() - (p_abandonment_threshold_minutes || ' minutes')::INTERVAL;
  
  -- Get details of counts to be released before updating them
  SELECT json_agg(
    json_build_object(
      'id', id,
      'count_number', count_number,
      'material_number', material_number,
      'location', location,
      'assigned_to', assigned_to,
      'counter_name', counter_name,
      'minutes_since_assignment', EXTRACT(EPOCH FROM (now() - assigned_at)) / 60
    )
  ) INTO released_counts
  FROM rr_cyclecount_data
  WHERE status = 'in_progress'
    AND assigned_at < abandonment_threshold
    AND assigned_to IS NOT NULL
  ORDER BY assigned_at ASC
  LIMIT p_max_releases;
  
  -- Release abandoned counts back to pending status
  UPDATE rr_cyclecount_data
  SET 
    status = 'pending',
    assigned_to = NULL,
    assigned_at = NULL,
    counter_name = NULL,
    updated_at = now(),
    notes = CASE 
      WHEN notes IS NULL THEN 'Auto-released due to abandonment'
      ELSE notes || ' | Auto-released due to abandonment'
    END
  WHERE status = 'in_progress'
    AND assigned_at < abandonment_threshold
    AND assigned_to IS NOT NULL
    AND id IN (
      SELECT id 
      FROM rr_cyclecount_data
      WHERE status = 'in_progress'
        AND assigned_at < abandonment_threshold
        AND assigned_to IS NOT NULL
      ORDER BY assigned_at ASC
      LIMIT p_max_releases
    );
    
  GET DIAGNOSTICS released_count = ROW_COUNT;
  
  RETURN json_build_object(
    'success', true,
    'abandonment_threshold_minutes', p_abandonment_threshold_minutes,
    'released_count', released_count,
    'released_counts', COALESCE(released_counts, '[]'::json),
    'message', released_count || ' abandoned counts released back to pending status'
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM
    );
END;
$$;

-- Create function to get user's potentially abandoned counts
-- This helps users see if they have counts that might be auto-released soon
CREATE OR REPLACE FUNCTION get_user_potentially_abandoned_counts(
  p_user_id UUID,
  p_warning_threshold_minutes INTEGER DEFAULT 20
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_org_id UUID;
  warning_threshold TIMESTAMPTZ;
  potentially_abandoned JSON;
BEGIN
  -- Get user's organization ID
  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = p_user_id;
  
  IF user_org_id IS NULL THEN
    RETURN json_build_object('error', 'User not found or not associated with an organization');
  END IF;
  
  -- Calculate warning threshold (20 minutes by default, warns before 30-minute abandonment)
  warning_threshold := now() - (p_warning_threshold_minutes || ' minutes')::INTERVAL;
  
  -- Get user's counts that are approaching abandonment
  SELECT json_agg(
    json_build_object(
      'id', id,
      'count_number', count_number,
      'material_number', material_number,
      'location', location,
      'assigned_at', assigned_at,
      'minutes_since_assignment', EXTRACT(EPOCH FROM (now() - assigned_at)) / 60,
      'minutes_until_abandonment', 30 - (EXTRACT(EPOCH FROM (now() - assigned_at)) / 60)
    )
  ) INTO potentially_abandoned
  FROM rr_cyclecount_data
  WHERE organization_id = user_org_id
    AND assigned_to = p_user_id
    AND status = 'in_progress'
    AND assigned_at < warning_threshold
  ORDER BY assigned_at ASC;
  
  RETURN json_build_object(
    'success', true,
    'warning_threshold_minutes', p_warning_threshold_minutes,
    'potentially_abandoned_counts', COALESCE(potentially_abandoned, '[]'::json),
    'total_at_risk', (
      SELECT COUNT(*)
      FROM rr_cyclecount_data
      WHERE organization_id = user_org_id
        AND assigned_to = p_user_id
        AND status = 'in_progress'
        AND assigned_at < warning_threshold
    )
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM
    );
END;
$$;

-- Create function for manual release of user's own counts
-- Allows users to release their own counts if they need to stop
CREATE OR REPLACE FUNCTION release_my_cycle_count(p_count_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_org_id UUID;
  count_record RECORD;
  current_user_id UUID;
BEGIN
  -- Get current user
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('error', 'User not authenticated');
  END IF;
  
  -- Get user's organization ID
  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = current_user_id;
  
  IF user_org_id IS NULL THEN
    RETURN json_build_object('error', 'User not found or not associated with an organization');
  END IF;
  
  -- Verify the count belongs to the user
  SELECT * INTO count_record
  FROM rr_cyclecount_data
  WHERE id = p_count_id 
    AND organization_id = user_org_id
    AND assigned_to = current_user_id
    AND status = 'in_progress';
    
  IF count_record IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Count not found or not assigned to you'
    );
  END IF;
  
  -- Release the assignment
  UPDATE rr_cyclecount_data
  SET 
    assigned_to = NULL,
    assigned_at = NULL,
    status = 'pending',
    counter_name = NULL,
    updated_at = now(),
    notes = CASE 
      WHEN p_reason IS NOT NULL THEN 
        CASE 
          WHEN notes IS NULL THEN 'Manually released: ' || p_reason
          ELSE notes || ' | Manually released: ' || p_reason
        END
      ELSE 
        CASE 
          WHEN notes IS NULL THEN 'Manually released by user'
          ELSE notes || ' | Manually released by user'
        END
    END
  WHERE id = p_count_id;
  
  RETURN json_build_object(
    'success', true,
    'message', 'Count released successfully and returned to pending status',
    'count_number', count_record.count_number,
    'material_number', count_record.material_number,
    'location', count_record.location
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM
    );
END;
$$;

-- Create function for admin/supervisor to release any abandoned counts
CREATE OR REPLACE FUNCTION admin_release_abandoned_count(p_count_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_org_id UUID;
  count_record RECORD;
  current_user_id UUID;
  user_role TEXT;
BEGIN
  -- Get current user
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('error', 'User not authenticated');
  END IF;
  
  -- Get user's organization ID and role
  SELECT up.organization_id, r.name INTO user_org_id, user_role
  FROM user_profiles up
  JOIN roles r ON up.role_id = r.id
  WHERE up.id = current_user_id;
  
  IF user_org_id IS NULL THEN
    RETURN json_build_object('error', 'User not found or not associated with an organization');
  END IF;
  
  -- Check if user has admin/supervisor privileges
  IF user_role NOT IN ('admin', 'supervisor', 'manager') THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Insufficient privileges to release counts for other users'
    );
  END IF;
  
  -- Get the count details
  SELECT * INTO count_record
  FROM rr_cyclecount_data
  WHERE id = p_count_id 
    AND organization_id = user_org_id
    AND status = 'in_progress';
    
  IF count_record IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Count not found or not in progress'
    );
  END IF;
  
  -- Release the assignment
  UPDATE rr_cyclecount_data
  SET 
    assigned_to = NULL,
    assigned_at = NULL,
    status = 'pending',
    counter_name = NULL,
    updated_at = now(),
    notes = CASE 
      WHEN p_reason IS NOT NULL THEN 
        CASE 
          WHEN notes IS NULL THEN 'Admin released: ' || p_reason
          ELSE notes || ' | Admin released: ' || p_reason
        END
      ELSE 
        CASE 
          WHEN notes IS NULL THEN 'Released by admin/supervisor'
          ELSE notes || ' | Released by admin/supervisor'
        END
    END
  WHERE id = p_count_id;
  
  RETURN json_build_object(
    'success', true,
    'message', 'Count released successfully by admin',
    'count_number', count_record.count_number,
    'material_number', count_record.material_number,
    'location', count_record.location,
    'previous_assignee', count_record.counter_name
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM
    );
END;
$$;

-- Create scheduled job function to automatically clean up abandoned counts
-- This can be called periodically to maintain system hygiene
CREATE OR REPLACE FUNCTION auto_cleanup_abandoned_counts()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cleanup_result JSON;
BEGIN
  -- Run automatic cleanup with 30-minute threshold
  SELECT release_abandoned_cycle_counts(30, 100) INTO cleanup_result;
  
  -- Log the cleanup action if any counts were released
  IF (cleanup_result->>'released_count')::INTEGER > 0 THEN
    INSERT INTO audit_logs (
      user_id,
      organization_id,
      action,
      resource_type,
      resource_id,
      changes
    ) 
    SELECT 
      NULL, -- System action
      organization_id,
      'cleanup'::audit_action,
      'cycle_count_abandonment',
      'system'::TEXT,
      cleanup_result
    FROM organizations
    LIMIT 1; -- Just need one entry for the system-wide cleanup
  END IF;
  
  RETURN cleanup_result;
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM
    );
END;
$$;

-- Create function to get abandonment statistics for monitoring
CREATE OR REPLACE FUNCTION get_abandonment_statistics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_org_id UUID;
  stats JSON;
BEGIN
  -- Get user's organization ID
  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = auth.uid();
  
  IF user_org_id IS NULL THEN
    RETURN json_build_object('error', 'User not found or not associated with an organization');
  END IF;
  
  -- Build abandonment statistics
  SELECT json_build_object(
    'total_in_progress', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id 
        AND status = 'in_progress'
    ),
    'potentially_abandoned_30min', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id 
        AND status = 'in_progress'
        AND assigned_at < (now() - INTERVAL '30 minutes')
    ),
    'at_risk_20min', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id 
        AND status = 'in_progress'
        AND assigned_at < (now() - INTERVAL '20 minutes')
        AND assigned_at >= (now() - INTERVAL '30 minutes')
    ),
    'average_assignment_duration_minutes', (
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (now() - assigned_at)) / 60), 0)
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id 
        AND status = 'in_progress'
        AND assigned_at IS NOT NULL
    ),
    'longest_assignment_minutes', (
      SELECT COALESCE(MAX(EXTRACT(EPOCH FROM (now() - assigned_at)) / 60), 0)
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id 
        AND status = 'in_progress'
        AND assigned_at IS NOT NULL
    )
  ) INTO stats;
  
  RETURN json_build_object(
    'success', true,
    'data', stats
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM
    );
END;
$$;

-- Add index for efficient abandonment queries
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_abandonment_check 
ON public.rr_cyclecount_data(status, assigned_at) 
WHERE status = 'in_progress' AND assigned_to IS NOT NULL;

-- Add comments for the new functions
COMMENT ON FUNCTION detect_abandoned_cycle_counts(INTEGER) IS 'Detects cycle counts that have been in progress longer than threshold';
COMMENT ON FUNCTION release_abandoned_cycle_counts(INTEGER, INTEGER) IS 'Automatically releases abandoned cycle counts back to pending status';
COMMENT ON FUNCTION get_user_potentially_abandoned_counts(UUID, INTEGER) IS 'Gets user counts approaching abandonment threshold';
COMMENT ON FUNCTION release_my_cycle_count(UUID, TEXT) IS 'Allows user to manually release their own cycle count';
COMMENT ON FUNCTION admin_release_abandoned_count(UUID, TEXT) IS 'Allows admin/supervisor to release any abandoned count';
COMMENT ON FUNCTION auto_cleanup_abandoned_counts() IS 'Automated cleanup function for abandoned counts with audit logging';
COMMENT ON FUNCTION get_abandonment_statistics() IS 'Provides abandonment statistics for monitoring and reporting';
