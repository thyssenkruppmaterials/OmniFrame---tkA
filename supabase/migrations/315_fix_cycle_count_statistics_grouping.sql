-- Migration 315: Fix get_cycle_count_statistics() so the "Count Status"
-- card on the Inventory Counts tab is self-consistent.
--
-- Problem
-- -------
-- The previous definition (migration 062) computed:
--   totalCounts     = COUNT(*)                        (all rows)
--   pendingCounts   = COUNT(*) WHERE status='pending'
--   completedCounts = COUNT(*) WHERE status='completed'
--
-- But the cycle_count_status enum has six values:
--   pending, in_progress, completed, variance_review, approved, cancelled
--
-- Result: totalCounts != pendingCounts + completedCounts. Rows in
-- in_progress / approved / variance_review were silently excluded from
-- the two pills the UI shows, so Pending (369) + Completed (7,679) =
-- 8,048 did not match Total (9,127).
--
-- Fix
-- ---
-- Regroup the two visible buckets so they cover every non-cancelled
-- workflow state, then derive totalCounts from those buckets:
--
--   pendingCounts   = status IN ('pending', 'in_progress')
--                       — work still to be done (or actively in flight)
--   completedCounts = status IN ('completed', 'approved', 'variance_review')
--                       — counting is finished (even if approval /
--                         variance review is still pending)
--   totalCounts     = pendingCounts + completedCounts
--                       — equivalent to COUNT(*) WHERE status != 'cancelled'
--
-- The Variance Metrics card continues to show:
--   varianceReviewCounts    = status = 'variance_review'  (subset of completed)
--   countsRequiringRecount  = requires_recount = true AND recount_completed = false
-- so its pills remain a drill-down view into the completed bucket.
--
-- The priorityBreakdown is also widened to include 'in_progress' so it
-- reflects the same "still pending" definition used by pendingCounts.

CREATE OR REPLACE FUNCTION get_cycle_count_statistics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
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
  SELECT auth.uid() INTO current_user_id;

  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = current_user_id;

  IF user_org_id IS NULL THEN
    RAISE EXCEPTION 'User not found or not associated with an organization';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = current_user_id
      AND up.role IN ('admin', 'manager', 'superadmin')
  ) INTO is_admin_or_manager;

  today_date_est := (timezone('America/New_York', CURRENT_TIMESTAMP))::DATE;
  week_start_est := date_trunc('week', today_date_est);

  -- RLS-equivalent filter applied to every aggregate below
  base_filter := 'organization_id = ''' || user_org_id || '''';

  IF NOT is_admin_or_manager THEN
    base_filter := base_filter ||
      ' AND (assigned_to IS NULL OR assigned_to = ''' || current_user_id ||
      ''' OR created_by = ''' || current_user_id || ''')';
  END IF;

  EXECUTE 'SELECT json_build_object(
    ''totalCounts'', (
      SELECT COUNT(*)
      FROM rr_cyclecount_data
      WHERE ' || base_filter || '
        AND status IN (''pending'', ''in_progress'', ''completed'', ''approved'', ''variance_review'')
    ),
    ''pendingCounts'', (
      SELECT COUNT(*)
      FROM rr_cyclecount_data
      WHERE ' || base_filter || '
        AND status IN (''pending'', ''in_progress'')
    ),
    ''completedCounts'', (
      SELECT COUNT(*)
      FROM rr_cyclecount_data
      WHERE ' || base_filter || '
        AND status IN (''completed'', ''approved'', ''variance_review'')
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
      WHERE organization_id = ''' || user_org_id || '''
        AND assigned_to = ''' || current_user_id || '''
    ),
    ''unassignedCounts'', (
      SELECT COUNT(*)
      FROM rr_cyclecount_data
      WHERE organization_id = ''' || user_org_id || '''
        AND assigned_to IS NULL
    ),
    ''priorityBreakdown'', json_build_object(
      ''critical'', (
        SELECT COUNT(*)
        FROM rr_cyclecount_data
        WHERE ' || base_filter || '
          AND priority = ''critical''
          AND status IN (''pending'', ''in_progress'')
      ),
      ''hot'', (
        SELECT COUNT(*)
        FROM rr_cyclecount_data
        WHERE ' || base_filter || '
          AND priority = ''hot''
          AND status IN (''pending'', ''in_progress'')
      ),
      ''normal'', (
        SELECT COUNT(*)
        FROM rr_cyclecount_data
        WHERE ' || base_filter || '
          AND priority = ''normal''
          AND status IN (''pending'', ''in_progress'')
      ),
      ''low'', (
        SELECT COUNT(*)
        FROM rr_cyclecount_data
        WHERE ' || base_filter || '
          AND priority = ''low''
          AND status IN (''pending'', ''in_progress'')
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
          AND status IN (''completed'', ''approved'', ''variance_review'')
          AND (timezone(''America/New_York'', completed_at))::DATE = ''' || today_date_est || '''
      ),
      ''completedThisWeek'', (
        SELECT COUNT(*)
        FROM rr_cyclecount_data
        WHERE ' || base_filter || '
          AND status IN (''completed'', ''approved'', ''variance_review'')
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
  'Returns cycle count statistics for the Inventory Counts tab. As of '
  'migration 315 (2026-05-18) the Pending / Completed buckets cover '
  'every non-cancelled status (pending+in_progress and '
  'completed+approved+variance_review respectively) so the Count Status '
  'card''s Total = Pending + Completed.';
