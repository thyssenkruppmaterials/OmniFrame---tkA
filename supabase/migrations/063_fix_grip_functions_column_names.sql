-- Migration: Fix GRIP processing statistics functions - remove non-existent column references
-- Date: October 31, 2025
-- Issue: Functions reference processing_date which doesn't exist
-- Solution: Remove avg_completion_time_hours calculation that uses non-existent column

-- ============================================================================
-- Fix: get_grip_processing_statistics() - Remove processing_date reference
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
  
  -- Return comprehensive statistics (removed avg_completion_time_hours)
  RETURN json_build_object(
    'total_processing', COALESCE(total_processing, 0),
    'today_processing', COALESCE(today_processing, 0),
    'unique_materials', COALESCE(unique_materials, 0),
    'unique_operators', COALESCE(unique_operators, 0),
    'quality_hold_processing', COALESCE(quality_hold_processing, 0),
    'completed_processing', COALESCE(completed_processing, 0),
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
-- Fix: get_grs_grip_processing_statistics() - Remove processing_date reference
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
  
  -- Return comprehensive statistics (removed avg_completion_time_hours)
  RETURN json_build_object(
    'total_processing', COALESCE(total_processing, 0),
    'today_processing', COALESCE(today_processing, 0),
    'unique_materials', COALESCE(unique_materials, 0),
    'unique_operators', COALESCE(unique_operators, 0),
    'quality_hold_processing', COALESCE(quality_hold_processing, 0),
    'completed_processing', COALESCE(completed_processing, 0),
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

