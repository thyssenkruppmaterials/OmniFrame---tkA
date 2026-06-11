-- Migration: Fix get_putback_log_statistics() to use correct EST timezone pattern
-- Date: October 31, 2025
-- Purpose: Apply the correct timezone conversion that was missed in migration 055

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

GRANT EXECUTE ON FUNCTION get_putback_log_statistics() TO authenticated;

COMMENT ON FUNCTION get_putback_log_statistics() IS 'Returns statistics for putback tickets using EST timezone. Fixed October 31, 2025 to use proper AT TIME ZONE UTC AT TIME ZONE America/New_York conversion.';


