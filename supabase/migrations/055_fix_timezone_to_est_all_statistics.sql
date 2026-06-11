-- Migration: Fix all statistics functions to use EST/New York timezone
-- Date: October 30, 2025
-- Purpose: Ensure all "today" calculations use America/New_York timezone instead of UTC

-- ============================================================================
-- Fix: get_inbound_scan_statistics() to use EST timezone
-- ============================================================================
CREATE OR REPLACE FUNCTION get_inbound_scan_statistics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  total_scans INTEGER;
  today_scans INTEGER;
  unique_materials INTEGER;
  unique_locations INTEGER;
  hot_truck_scans INTEGER;
  avg_quantity DECIMAL;
  today_date_est DATE;
BEGIN
  -- Get today's date in EST timezone (America/New_York)
  today_date_est := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE;
  
  -- Get total scans count
  SELECT COUNT(*)
  INTO total_scans
  FROM rr_inbound_scans;
  
  -- Get today's scans count (EST timezone)
  SELECT COUNT(*)
  INTO today_scans
  FROM rr_inbound_scans
  WHERE (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::DATE = today_date_est;
  
  -- Get unique materials count (non-null only)
  SELECT COUNT(DISTINCT material_number)
  INTO unique_materials
  FROM rr_inbound_scans
  WHERE material_number IS NOT NULL AND material_number != '';
  
  -- Get unique locations count (non-null only)
  SELECT COUNT(DISTINCT scan_location)
  INTO unique_locations
  FROM rr_inbound_scans
  WHERE scan_location IS NOT NULL AND scan_location != '';
  
  -- Get hot truck scans count
  SELECT COUNT(*)
  INTO hot_truck_scans
  FROM rr_inbound_scans
  WHERE hot_truck = TRUE;
  
  -- Get average quantity (non-null only)
  SELECT AVG(quantity)
  INTO avg_quantity
  FROM rr_inbound_scans
  WHERE quantity IS NOT NULL;
  
  -- Build result JSON object
  result := json_build_object(
    'totalScans', COALESCE(total_scans, 0),
    'todayScans', COALESCE(today_scans, 0),
    'uniqueMaterials', COALESCE(unique_materials, 0),
    'uniqueLocations', COALESCE(unique_locations, 0),
    'hotTruckScans', COALESCE(hot_truck_scans, 0),
    'averageQuantity', avg_quantity,
    'statusBreakdown', json_build_object(
      'total', COALESCE(total_scans, 0),
      'with_notes', (
        SELECT COUNT(*)
        FROM rr_inbound_scans
        WHERE notes IS NOT NULL AND notes != ''
      ),
      'hot_truck', COALESCE(hot_truck_scans, 0)
    )
  );
  
  RETURN result;
END;
$$;

COMMENT ON FUNCTION get_inbound_scan_statistics() IS 
  'Returns comprehensive statistics for inbound scans using EST timezone. Updated October 30, 2025 to use America/New_York timezone for accurate daily counts.';

-- ============================================================================
-- Fix: get_putback_log_statistics() to use EST timezone correctly
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
  today_date_est := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE;

  -- Calculate statistics
  WITH stats AS (
    SELECT
      COUNT(*) AS total_tickets,
      COUNT(*) FILTER (
        WHERE (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::DATE = today_date_est
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

COMMENT ON FUNCTION get_putback_log_statistics() IS 
  'Returns statistics for putback tickets using EST timezone. Updated October 30, 2025 to properly use America/New_York timezone.';

-- ============================================================================
-- Fix: get_grip_processing_statistics() to use EST timezone
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
  today_date_est := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE;
  
  -- Get total count
  SELECT COUNT(*) INTO total_processing
  FROM public.rr_grip_processing
  WHERE organization_id = organization_id_val::UUID;
  
  -- Get today's processing count (EST timezone)
  SELECT COUNT(*) INTO today_processing
  FROM public.rr_grip_processing
  WHERE organization_id = organization_id_val::UUID
  AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::DATE = today_date_est;
  
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

COMMENT ON FUNCTION public.get_grip_processing_statistics() IS 
  'Returns comprehensive GRIP processing statistics using EST timezone. ' ||
  'Updated October 30, 2025 to use America/New_York timezone for accurate daily counts.';

-- ============================================================================
-- Fix: get_grs_grip_processing_statistics() to use EST timezone
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
  today_date_est := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE;
  
  -- Get total count
  SELECT COUNT(*) INTO total_processing
  FROM public.rr_grsgrip_processing
  WHERE organization_id = organization_id_val::UUID;
  
  -- Get today's processing count (EST timezone)
  SELECT COUNT(*) INTO today_processing
  FROM public.rr_grsgrip_processing
  WHERE organization_id = organization_id_val::UUID
  AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::DATE = today_date_est;
  
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

COMMENT ON FUNCTION public.get_grip_processing_statistics() IS 
  'Returns comprehensive GRIP processing statistics using EST timezone. ' ||
  'Updated October 30, 2025 to use America/New_York timezone for accurate daily counts.';

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_inbound_scan_statistics() TO authenticated;
GRANT EXECUTE ON FUNCTION get_putback_log_statistics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_grip_processing_statistics() TO authenticated;

-- Final comment on get_putback_log_statistics (duplicate removed)

-- ============================================================================
-- Fix: get_cycle_count_statistics() to use EST timezone
-- ============================================================================
-- Note: This function is complex with dynamic SQL. The key fixes are:
-- 1. Use (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE instead of CURRENT_DATE
-- 2. Use date_trunc('week', (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE) for week calculations
-- 
-- The function rebuilds with EST-aware date calculations:

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
  
  -- Get today's date and week start in EST timezone
  today_date_est := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE;
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
        WHERE ' || base_filter || ' AND completed_at IS NOT NULL
      )
    )
  )'
  INTO result;
  
  RETURN result;
END;
$$;
... 165 lines not shown ...</output>
</result>
</function_calls>

<function_results>
<result>
<name>read_file</name>
<output>-- Update the cycle count statistics function to include completion time metrics
-- Migration 040: Add completed_at to cycle count table and update statistics
-- September 22, 2025

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS auto_set_completed_at_trigger ON rr_cyclecount_data;
DROP FUNCTION IF EXISTS auto_set_completed_at();

-- Create function to automatically set completed_at when status becomes 'completed' or 'approved'
CREATE OR REPLACE FUNCTION auto_set_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  -- If status is being changed to completed or approved, set completed_at
  IF NEW.status IN ('completed', 'approved') AND OLD.status NOT IN ('completed', 'approved') AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
CREATE TRIGGER auto_set_completed_at_trigger
  BEFORE UPDATE ON rr_cyclecount_data
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_completed_at();

-- Add the completed_at column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'rr_cyclecount_data'
    AND column_name = 'completed_at'
  ) THEN
    ALTER TABLE rr_cyclecount_data
    ADD COLUMN completed_at TIMESTAMPTZ;
    
    -- Add index for performance
    CREATE INDEX IF NOT EXISTS idx_cyclecount_completed_at ON rr_cyclecount_data(completed_at) WHERE completed_at IS NOT NULL;
    
    -- Add to audit trigger
    COMMENT ON COLUMN rr_cyclecount_data.completed_at IS 'Timestamp when cycle count was completed or approved';
  END IF;
END $$;

-- Recreate the variance auto-calculation trigger
CREATE OR REPLACE FUNCTION auto_calculate_cycle_count_variance()
RETURNS TRIGGER AS $$
DECLARE
  variance_qty INTEGER;
  variance_pct DECIMAL;
BEGIN
  -- Only calculate if we have both system and counted quantities
  IF NEW.system_quantity IS NOT NULL AND NEW.counted_quantity IS NOT NULL THEN
    -- Calculate variance quantity and percentage
    variance_qty := NEW.counted_quantity - NEW.system_quantity;
    
    IF NEW.system_quantity = 0 AND NEW.counted_quantity != 0 THEN
      -- Prevent numeric overflow - cap at 999.99 for extreme variances
      variance_pct := 999.99;
    ELSIF NEW.system_quantity != 0 THEN
      variance_pct := (variance_qty::DECIMAL / NEW.system_quantity::DECIMAL) * 100;
      -- Cap extreme variances at 999.99 to prevent numeric field overflow
      variance_pct := LEAST(variance_pct, 999.99);
    ELSE
      variance_pct := NULL;
    END IF;
    
    NEW.variance_quantity := variance_qty;
    NEW.variance_percentage := variance_pct;
    
    -- Determine if recount is required (>10% variance OR >10 units absolute variance)
    IF ABS(variance_qty) > 10 OR ABS(variance_pct) > 10 THEN
      NEW.requires_recount := true;
      -- Auto-promote to variance_review status
      IF NEW.status = 'completed' THEN
        NEW.status := 'variance_review';
      END IF;
    ELSE
      NEW.requires_recount := false;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger
DROP TRIGGER IF EXISTS auto_calculate_variance_trigger ON rr_cyclecount_data;
CREATE TRIGGER auto_calculate_variance_trigger
  BEFORE INSERT OR UPDATE OF counted_quantity, system_quantity ON rr_cyclecount_data
  FOR EACH ROW
  EXECUTE FUNCTION auto_calculate_cycle_count_variance();

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
        AND (completed_at AT TIME ZONE ''UTC'' AT TIME ZONE ''America/New_York'')::DATE = ''' || today_date_est || '''
      ),
      ''completedThisWeek'', (
        SELECT COUNT(*) 
        FROM rr_cyclecount_data 
        WHERE ' || base_filter || ' 
        AND status = ''completed''
        AND (completed_at AT TIME ZONE ''UTC'' AT TIME ZONE ''America/New_York'')::DATE >= ''' || week_start_est || '''
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

COMMENT ON FUNCTION get_cycle_count_statistics() IS 
  'Returns comprehensive cycle count statistics using EST timezone. Updated October 30, 2025 to use America/New_York timezone for accurate daily and weekly counts.';

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_cycle_count_statistics() TO authenticated;

