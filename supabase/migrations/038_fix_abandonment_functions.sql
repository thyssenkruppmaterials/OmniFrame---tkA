-- Fix Abandonment Functions SQL Issues
-- Migration: 038_fix_abandonment_functions.sql  
-- Description: Fixes SQL aggregation issues in abandonment detection functions

-- Fixed version of detect_abandoned_cycle_counts
CREATE OR REPLACE FUNCTION detect_abandoned_cycle_counts(p_abandonment_threshold_minutes INTEGER DEFAULT 30)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  abandoned_counts JSON;
  abandonment_threshold TIMESTAMPTZ;
  total_abandoned_count INTEGER;
BEGIN
  -- Calculate the abandonment threshold timestamp
  abandonment_threshold := now() - (p_abandonment_threshold_minutes || ' minutes')::INTERVAL;
  
  -- Count total abandoned counts first
  SELECT COUNT(*) INTO total_abandoned_count
  FROM rr_cyclecount_data
  WHERE status = 'in_progress'
    AND assigned_at < abandonment_threshold
    AND assigned_to IS NOT NULL;
  
  -- Get abandoned counts details without aggregation issues
  WITH abandoned_data AS (
    SELECT 
      id,
      count_number,
      material_number,
      location,
      assigned_to,
      assigned_at,
      counter_name,
      EXTRACT(EPOCH FROM (now() - assigned_at)) / 60 as minutes_since_assignment,
      organization_id
    FROM rr_cyclecount_data
    WHERE status = 'in_progress'
      AND assigned_at < abandonment_threshold
      AND assigned_to IS NOT NULL
    ORDER BY assigned_at ASC
  )
  SELECT json_agg(
    json_build_object(
      'id', id,
      'count_number', count_number,
      'material_number', material_number,
      'location', location,
      'assigned_to', assigned_to,
      'assigned_at', assigned_at,
      'counter_name', counter_name,
      'minutes_since_assignment', minutes_since_assignment,
      'organization_id', organization_id
    )
  ) INTO abandoned_counts
  FROM abandoned_data;
  
  RETURN json_build_object(
    'success', true,
    'abandonment_threshold_minutes', p_abandonment_threshold_minutes,
    'abandoned_counts', COALESCE(abandoned_counts, '[]'::json),
    'total_abandoned', total_abandoned_count
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM
    );
END;
$$;

-- Fixed version of release_abandoned_cycle_counts
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
  WITH to_release AS (
    SELECT 
      id,
      count_number,
      material_number,
      location,
      assigned_to,
      counter_name,
      EXTRACT(EPOCH FROM (now() - assigned_at)) / 60 as minutes_since_assignment
    FROM rr_cyclecount_data
    WHERE status = 'in_progress'
      AND assigned_at < abandonment_threshold
      AND assigned_to IS NOT NULL
    ORDER BY assigned_at ASC
    LIMIT p_max_releases
  )
  SELECT json_agg(
    json_build_object(
      'id', id,
      'count_number', count_number,
      'material_number', material_number,
      'location', location,
      'assigned_to', assigned_to,
      'counter_name', counter_name,
      'minutes_since_assignment', minutes_since_assignment
    )
  ) INTO released_counts
  FROM to_release;
  
  -- Release abandoned counts back to pending status
  WITH to_release AS (
    SELECT id
    FROM rr_cyclecount_data
    WHERE status = 'in_progress'
      AND assigned_at < abandonment_threshold
      AND assigned_to IS NOT NULL
    ORDER BY assigned_at ASC
    LIMIT p_max_releases
  )
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
  WHERE id IN (SELECT id FROM to_release);
    
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

-- Fixed version of get_user_potentially_abandoned_counts
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
  total_at_risk INTEGER;
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
  
  -- Count total at-risk counts
  SELECT COUNT(*) INTO total_at_risk
  FROM rr_cyclecount_data
  WHERE organization_id = user_org_id
    AND assigned_to = p_user_id
    AND status = 'in_progress'
    AND assigned_at < warning_threshold;
  
  -- Get user's counts that are approaching abandonment
  WITH at_risk_counts AS (
    SELECT 
      id,
      count_number,
      material_number,
      location,
      assigned_at,
      EXTRACT(EPOCH FROM (now() - assigned_at)) / 60 as minutes_since_assignment,
      30 - (EXTRACT(EPOCH FROM (now() - assigned_at)) / 60) as minutes_until_abandonment
    FROM rr_cyclecount_data
    WHERE organization_id = user_org_id
      AND assigned_to = p_user_id
      AND status = 'in_progress'
      AND assigned_at < warning_threshold
    ORDER BY assigned_at ASC
  )
  SELECT json_agg(
    json_build_object(
      'id', id,
      'count_number', count_number,
      'material_number', material_number,
      'location', location,
      'assigned_at', assigned_at,
      'minutes_since_assignment', minutes_since_assignment,
      'minutes_until_abandonment', minutes_until_abandonment
    )
  ) INTO potentially_abandoned
  FROM at_risk_counts;
  
  RETURN json_build_object(
    'success', true,
    'warning_threshold_minutes', p_warning_threshold_minutes,
    'potentially_abandoned_counts', COALESCE(potentially_abandoned, '[]'::json),
    'total_at_risk', total_at_risk
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM
    );
END;
$$;
