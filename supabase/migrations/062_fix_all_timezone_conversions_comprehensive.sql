-- Migration: Fix ALL statistics functions to use correct timezone() conversion
-- Date: October 31, 2025
-- Issue: All statistics functions using incorrect AT TIME ZONE double conversion
-- Root Cause: Pattern (field AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') doesn't work correctly
-- Solution: Use timezone('America/New_York', field) for proper UTC to EST/EDT conversion
-- Scope: Fixes 5 RPC functions - putaway log, putback log, GRIP, GRS GRIP, cycle count

-- ============================================================================
-- Fix #1: get_putaway_log_statistics() - Putaway Log Search
-- ============================================================================
CREATE OR REPLACE FUNCTION get_putaway_log_statistics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  user_org_id UUID;
  today_date_est DATE;
  total_count INTEGER;
  today_count INTEGER;
  mca_count INTEGER;
  completed_count INTEGER;
  unique_materials_count INTEGER;
  unique_drivers_count INTEGER;
  drivers_today INTEGER;
  avg_per_driver DECIMAL;
  status_breakdown JSON;
  warehouse_distribution JSON;
BEGIN
  -- Get the user's organization ID
  SELECT (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID INTO user_org_id;
  
  -- If organization_id not in JWT, try getting from user_profiles
  IF user_org_id IS NULL THEN
    SELECT organization_id INTO user_org_id
    FROM user_profiles
    WHERE id = auth.uid();
  END IF;

  -- Get today's date in EST timezone
  today_date_est := (timezone('America/New_York', CURRENT_TIMESTAMP))::DATE;

  -- Get total count
  SELECT COUNT(*) INTO total_count
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id;

  -- Get today's putaways count (EST timezone) - FIXED
  SELECT COUNT(*) INTO today_count
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id
  AND (timezone('America/New_York', created_at))::DATE = today_date_est;

  -- Get MCA workflow count
  SELECT COUNT(*) INTO mca_count
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id
  AND is_mca_workflow = true;

  -- Get completed count
  SELECT COUNT(*) INTO completed_count
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id
  AND to_status = 'Completed';

  -- Get unique materials count
  SELECT COUNT(DISTINCT material_number) INTO unique_materials_count
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id
  AND material_number IS NOT NULL;

  -- Get unique drivers count (all time)
  SELECT COUNT(DISTINCT putaway_driver) INTO unique_drivers_count
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id
  AND putaway_driver IS NOT NULL;

  -- Get drivers who worked today - FIXED
  SELECT COUNT(DISTINCT putaway_driver) INTO drivers_today
  FROM rf_putaway_operations
  WHERE organization_id = user_org_id
  AND (timezone('America/New_York', created_at))::DATE = today_date_est
  AND putaway_driver IS NOT NULL;

  -- Calculate daily average per driver (today's putaways / drivers who worked today)
  IF drivers_today > 0 THEN
    avg_per_driver := today_count::DECIMAL / drivers_today;
  ELSE
    avg_per_driver := 0;
  END IF;

  -- Get status breakdown
  SELECT json_object_agg(COALESCE(to_status, 'Unknown'), count) INTO status_breakdown
  FROM (
    SELECT to_status, COUNT(*) as count
    FROM rf_putaway_operations
    WHERE organization_id = user_org_id
    GROUP BY to_status
  ) t;

  -- Get warehouse distribution
  SELECT json_object_agg(COALESCE(warehouse, 'Unknown'), count) INTO warehouse_distribution
  FROM (
    SELECT warehouse, COUNT(*) as count
    FROM rf_putaway_operations
    WHERE organization_id = user_org_id
    GROUP BY warehouse
  ) t;

  -- Build result JSON
  result := json_build_object(
    'totalPutaways', COALESCE(total_count, 0),
    'todayPutaways', COALESCE(today_count, 0),
    'uniqueMaterials', COALESCE(unique_materials_count, 0),
    'uniqueDrivers', COALESCE(unique_drivers_count, 0),
    'averagePerDriver', ROUND(COALESCE(avg_per_driver, 0)),
    'mcaPutaways', COALESCE(mca_count, 0),
    'completedPutaways', COALESCE(completed_count, 0),
    'averageCompletionTime', NULL,
    'statusBreakdown', COALESCE(status_breakdown, '{}'::JSON),
    'warehouseDistribution', COALESCE(warehouse_distribution, '{}'::JSON)
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_putaway_log_statistics() TO authenticated;

COMMENT ON FUNCTION get_putaway_log_statistics() IS 'Returns comprehensive statistics for putaway operations using EST timezone with CORRECTED timezone conversion. Fixed October 31, 2025 to use timezone() function.';

-- ============================================================================
-- Fix #2: get_putback_log_statistics() - Putback Log Search
-- ============================================================================
CREATE OR REPLACE FUNCTION get_putback_log_statistics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  user_org_id UUID;
  today_date_est DATE;
BEGIN
  -- Get the user's organization ID
  SELECT (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID INTO user_org_id;
  
  -- If organization_id not in JWT, try getting from user_profiles
  IF user_org_id IS NULL THEN
    SELECT organization_id INTO user_org_id
    FROM user_profiles
    WHERE id = auth.uid();
  END IF;

  -- Get today's date in EST timezone
  today_date_est := (timezone('America/New_York', CURRENT_TIMESTAMP))::DATE;

  -- Calculate statistics - FIXED
  WITH stats AS (
    SELECT
      COUNT(*) AS total_tickets,
      COUNT(*) FILTER (
        WHERE (timezone('America/New_York', created_at))::DATE = today_date_est
      ) AS today_tickets,
      COUNT(*) FILTER (WHERE status = 'open') AS open_tickets,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed_tickets,
      COUNT(DISTINCT material_number) AS unique_materials,
      COUNT(DISTINCT created_by) AS unique_creators
    FROM putback_tickets
    WHERE organization_id = user_org_id
  )
  SELECT json_build_object(
    'totalTickets', COALESCE(total_tickets, 0),
    'todayTickets', COALESCE(today_tickets, 0),
    'openTickets', COALESCE(open_tickets, 0),
    'completedTickets', COALESCE(completed_tickets, 0),
    'uniqueMaterials', COALESCE(unique_materials, 0),
    'uniqueCreators', COALESCE(unique_creators, 0)
  )
  INTO result
  FROM stats;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_putback_log_statistics() TO authenticated;

COMMENT ON FUNCTION get_putback_log_statistics() IS 'Returns statistics for putback tickets using EST timezone with CORRECTED timezone conversion. Fixed October 31, 2025 to use timezone() function.';

-- ============================================================================
-- Fix #3: get_grip_processing_statistics() - GRIP Processing
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_grip_processing_statistics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  organization_id_val TEXT;
  total_processing INTEGER;
  today_processing INTEGER;
  unique_materials INTEGER;
  unique_operators INTEGER;
  quality_hold_processing INTEGER;
  completed_processing INTEGER;
  avg_completion_time_hours DECIMAL;
  status_breakdown JSON;
  warehouse_distribution JSON;
  grip_stage_breakdown JSON;
  priority_breakdown JSON;
  today_date_est DATE;
BEGIN
  -- Get organization ID from JWT
  organization_id_val := (auth.jwt() -> 'user_metadata' ->> 'organization_id');
  
  -- Get today's date in EST timezone
  today_date_est := (timezone('America/New_York', CURRENT_TIMESTAMP))::DATE;
  
  -- Get total count
  SELECT COUNT(*) INTO total_processing
  FROM public.rr_grip_processing
  WHERE organization_id = organization_id_val::UUID;
  
  -- Get today's processing count (EST timezone) - FIXED
  SELECT COUNT(*) INTO today_processing
  FROM public.rr_grip_processing
  WHERE organization_id = organization_id_val::UUID
  AND (timezone('America/New_York', created_at))::DATE = today_date_est;
  
  -- Get unique materials count
  SELECT COUNT(DISTINCT material_number) INTO unique_materials
  FROM public.rr_grip_processing
  WHERE organization_id = organization_id_val::UUID AND material_number IS NOT NULL;
  
  -- Get unique operators count
  SELECT COUNT(DISTINCT processed_by) INTO unique_operators
  FROM public.rr_grip_processing
  WHERE organization_id = organization_id_val::UUID AND processed_by IS NOT NULL;
  
  -- Get quality hold processing count
  SELECT COUNT(*) INTO quality_hold_processing
  FROM public.rr_grip_processing
  WHERE organization_id = organization_id_val::UUID AND is_quality_hold = true;
  
  -- Get completed processing count
  SELECT COUNT(*) INTO completed_processing
  FROM public.rr_grip_processing
  WHERE organization_id = organization_id_val::UUID AND processing_status = 'Completed';
  
  -- Calculate average completion time in hours
  SELECT AVG(EXTRACT(EPOCH FROM (processing_date - created_at)) / 3600) INTO avg_completion_time_hours
  FROM public.rr_grip_processing
  WHERE organization_id = organization_id_val::UUID 
  AND processing_status = 'Completed'
  AND processing_date IS NOT NULL;
  
  -- Get status breakdown
  SELECT json_object_agg(COALESCE(processing_status, 'Unknown'), count) INTO status_breakdown
  FROM (
    SELECT processing_status, COUNT(*) as count
    FROM public.rr_grip_processing
    WHERE organization_id = organization_id_val::UUID
    GROUP BY processing_status
  ) t;
  
  -- Get warehouse distribution
  SELECT json_object_agg(COALESCE(warehouse_number, 'Unknown'), count) INTO warehouse_distribution
  FROM (
    SELECT warehouse_number, COUNT(*) as count
    FROM public.rr_grip_processing
    WHERE organization_id = organization_id_val::UUID
    GROUP BY warehouse_number
  ) t;
  
  -- Get GRIP stage breakdown
  SELECT json_object_agg(COALESCE(grip_stage, 'Unknown'), count) INTO grip_stage_breakdown
  FROM (
    SELECT grip_stage, COUNT(*) as count
    FROM public.rr_grip_processing
    WHERE organization_id = organization_id_val::UUID
    GROUP BY grip_stage
  ) t;
  
  -- Get priority breakdown
  SELECT json_object_agg(COALESCE(grip_priority, 'NORMAL'), count) INTO priority_breakdown
  FROM (
    SELECT grip_priority, COUNT(*) as count
    FROM public.rr_grip_processing
    WHERE organization_id = organization_id_val::UUID
    GROUP BY grip_priority
  ) t;
  
  -- Return comprehensive statistics
  RETURN json_build_object(
    'total_processing', COALESCE(total_processing, 0),
    'today_processing', COALESCE(today_processing, 0),
    'unique_materials', COALESCE(unique_materials, 0),
    'unique_operators', COALESCE(unique_operators, 0),
    'quality_hold_processing', COALESCE(quality_hold_processing, 0),
    'completed_processing', COALESCE(completed_processing, 0),
    'average_completion_time_hours', avg_completion_time_hours,
    'status_breakdown', COALESCE(status_breakdown, '{}'::JSON),
    'warehouse_distribution', COALESCE(warehouse_distribution, '{}'::JSON),
    'grip_stage_breakdown', COALESCE(grip_stage_breakdown, '{}'::JSON),
    'priority_breakdown', COALESCE(priority_breakdown, '{}'::JSON)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_grip_processing_statistics() TO authenticated;

COMMENT ON FUNCTION public.get_grip_processing_statistics() IS 
  'Returns comprehensive GRIP processing statistics using EST timezone with CORRECTED timezone conversion. Fixed October 31, 2025 to use timezone() function.';

-- ============================================================================
-- Fix #4: get_grs_grip_processing_statistics() - GRS GRIP Processing
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_grs_grip_processing_statistics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  organization_id_val TEXT;
  total_processing INTEGER;
  today_processing INTEGER;
  unique_materials INTEGER;
  unique_operators INTEGER;
  quality_hold_processing INTEGER;
  completed_processing INTEGER;
  avg_completion_time_hours DECIMAL;
  status_breakdown JSON;
  warehouse_distribution JSON;
  grip_stage_breakdown JSON;
  priority_breakdown JSON;
  today_date_est DATE;
BEGIN
  -- Get organization ID from JWT
  organization_id_val := (auth.jwt() -> 'user_metadata' ->> 'organization_id');
  
  -- Get today's date in EST timezone
  today_date_est := (timezone('America/New_York', CURRENT_TIMESTAMP))::DATE;
  
  -- Get total count
  SELECT COUNT(*) INTO total_processing
  FROM public.rr_grsgrip_processing
  WHERE organization_id = organization_id_val::UUID;
  
  -- Get today's processing count (EST timezone) - FIXED
  SELECT COUNT(*) INTO today_processing
  FROM public.rr_grsgrip_processing
  WHERE organization_id = organization_id_val::UUID
  AND (timezone('America/New_York', created_at))::DATE = today_date_est;
  
  -- Get unique materials count
  SELECT COUNT(DISTINCT material_number) INTO unique_materials
  FROM public.rr_grsgrip_processing
  WHERE organization_id = organization_id_val::UUID AND material_number IS NOT NULL;
  
  -- Get unique operators count
  SELECT COUNT(DISTINCT processed_by) INTO unique_operators
  FROM public.rr_grsgrip_processing
  WHERE organization_id = organization_id_val::UUID AND processed_by IS NOT NULL;
  
  -- Get quality hold processing count
  SELECT COUNT(*) INTO quality_hold_processing
  FROM public.rr_grsgrip_processing
  WHERE organization_id = organization_id_val::UUID AND is_quality_hold = true;
  
  -- Get completed processing count
  SELECT COUNT(*) INTO completed_processing
  FROM public.rr_grsgrip_processing
  WHERE organization_id = organization_id_val::UUID AND processing_status = 'Completed';
  
  -- Calculate average completion time in hours
  SELECT AVG(EXTRACT(EPOCH FROM (processing_date - created_at)) / 3600) INTO avg_completion_time_hours
  FROM public.rr_grsgrip_processing
  WHERE organization_id = organization_id_val::UUID 
  AND processing_status = 'Completed'
  AND processing_date IS NOT NULL;
  
  -- Get status breakdown
  SELECT json_object_agg(COALESCE(processing_status, 'Unknown'), count) INTO status_breakdown
  FROM (
    SELECT processing_status, COUNT(*) as count
    FROM public.rr_grsgrip_processing
    WHERE organization_id = organization_id_val::UUID
    GROUP BY processing_status
  ) t;
  
  -- Get warehouse distribution
  SELECT json_object_agg(COALESCE(warehouse_number, 'Unknown'), count) INTO warehouse_distribution
  FROM (
    SELECT warehouse_number, COUNT(*) as count
    FROM public.rr_grsgrip_processing
    WHERE organization_id = organization_id_val::UUID
    GROUP BY warehouse_number
  ) t;
  
  -- Get GRIP stage breakdown
  SELECT json_object_agg(COALESCE(grip_stage, 'Unknown'), count) INTO grip_stage_breakdown
  FROM (
    SELECT grip_stage, COUNT(*) as count
    FROM public.rr_grsgrip_processing
    WHERE organization_id = organization_id_val::UUID
    GROUP BY grip_stage
  ) t;
  
  -- Get priority breakdown
  SELECT json_object_agg(COALESCE(grip_priority, 'NORMAL'), count) INTO priority_breakdown
  FROM (
    SELECT grip_priority, COUNT(*) as count
    FROM public.rr_grsgrip_processing
    WHERE organization_id = organization_id_val::UUID
    GROUP BY grip_priority
  ) t;
  
  -- Return comprehensive statistics
  RETURN json_build_object(
    'total_processing', COALESCE(total_processing, 0),
    'today_processing', COALESCE(today_processing, 0),
    'unique_materials', COALESCE(unique_materials, 0),
    'unique_operators', COALESCE(unique_operators, 0),
    'quality_hold_processing', COALESCE(quality_hold_processing, 0),
    'completed_processing', COALESCE(completed_processing, 0),
    'average_completion_time_hours', avg_completion_time_hours,
    'status_breakdown', COALESCE(status_breakdown, '{}'::JSON),
    'warehouse_distribution', COALESCE(warehouse_distribution, '{}'::JSON),
    'grip_stage_breakdown', COALESCE(grip_stage_breakdown, '{}'::JSON),
    'priority_breakdown', COALESCE(priority_breakdown, '{}'::JSON)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_grs_grip_processing_statistics() TO authenticated;

COMMENT ON FUNCTION public.get_grs_grip_processing_statistics() IS 
  'Returns comprehensive GRS GRIP processing statistics using EST timezone with CORRECTED timezone conversion. Fixed October 31, 2025 to use timezone() function.';

-- ============================================================================
-- Fix #5: get_cycle_count_statistics() - Cycle Count Statistics
-- ============================================================================
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
  today_date_est DATE;
  week_start_est DATE;
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
    AND up.role IN ('admin', 'manager', 'superadmin')
  ) INTO is_admin_or_manager;
  
  -- Get today's date and week start in EST timezone - FIXED
  today_date_est := (timezone('America/New_York', CURRENT_TIMESTAMP))::DATE;
  week_start_est := date_trunc('week', today_date_est);
  
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
        AND (timezone(''America/New_York'', completed_at))::DATE = ''' || today_date_est || '''
      ),
      ''completedThisWeek'', (
        SELECT COUNT(*) 
        FROM rr_cyclecount_data 
        WHERE ' || base_filter || ' 
        AND status = ''completed''
        AND (timezone(''America/New_York'', completed_at))::DATE >= ''' || week_start_est || '''
      ),
      ''averageCompletionTimeMinutes'', (
        SELECT COALESCE(
          AVG(EXTRACT(EPOCH FROM (completed_at - assigned_at)) / 60), 0
        )
        FROM rr_cyclecount_data
        WHERE ' || base_filter || ' AND completed_at IS NOT NULL
      )
    )
  )'
  INTO result;
  
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_cycle_count_statistics() TO authenticated;

COMMENT ON FUNCTION get_cycle_count_statistics() IS 
  'Returns comprehensive cycle count statistics using EST timezone with CORRECTED timezone conversion. Fixed October 31, 2025 to use timezone() function for accurate daily and weekly counts.';

