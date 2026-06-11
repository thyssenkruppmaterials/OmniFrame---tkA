-- ============================================================================
-- Migration 304: Fix shift-productivity cycle-count visibility
-- ----------------------------------------------------------------------------
-- Bug A (events arm): get_team_activity_events filtered the cycle-count
--   UNION arm by rcd.created_at, while every other arm filters by its
--   action timestamp and get_team_productivity_counts already filters by
--   rcd.completed_at. In OmniFrame, cycle counts are mass-created in
--   nightly/weekly batches and worked off later, so the created_at filter
--   silently dropped ~93% of today's completed counts from the Gantt
--   while still counting them in the per-row task total. Switch to
--   rcd.completed_at to align with the counts side.
--
-- Bug C (status allowlist): both RPCs excluded rr_cyclecount_data rows in
--   status 'variance_review' (operator finished the count, supervisor
--   hasn't signed off yet). The operator's work is invisible until
--   review completes. Widen the allowlist to
--   ('completed','approved','variance_review') in both arms so the
--   productivity dashboard reflects work the associate actually performed.
--
-- Both functions are re-created in full so they remain byte-equivalent
-- with migration 188 outside the cycle-count arm. SECURITY DEFINER mode
-- and GRANT EXECUTE TO authenticated are preserved. No search_path setting
-- is applied because migration 188's DROP+CREATE of
-- get_team_productivity_counts already wiped the hardening from
-- migration 173 and the production state of both functions today is
-- proconfig=NULL; re-hardening, if desired, belongs in a separate pass.
--
-- See: memorybank/OmniFrame/Debug/Investigate-Shift-Productivity-Cycle-Counts-Hidden.md
-- ============================================================================


-- =========================================================================
-- PART 1: Re-create get_team_activity_events with Bug A + Bug C fixes
-- =========================================================================

CREATE OR REPLACE FUNCTION get_team_activity_events(
  p_organization_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS TABLE (
  user_id UUID,
  event_type TEXT,
  event_timestamp TIMESTAMPTZ,
  area TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM validate_organization_access(p_organization_id);

  RETURN QUERY
  WITH active_users AS (
    SELECT DISTINCT sa.user_id AS uid
    FROM shift_assignments sa
    WHERE sa.organization_id = p_organization_id
      AND sa.status = 'active'
      AND sa.is_primary_position = true
  )

  -- Inbound scans
  SELECT
    ris.scanned_by AS user_id,
    'inbound_scan'::TEXT AS event_type,
    ris.scanned_at AS event_timestamp,
    COALESCE(ris.scan_location::TEXT, 'Receiving'::TEXT) AS area
  FROM rr_inbound_scans ris
  WHERE ris.organization_id = p_organization_id
    AND ris.scanned_at >= p_start_date
    AND ris.scanned_at <= p_end_date
    AND ris.scanned_by IN (SELECT au.uid FROM active_users au)

  UNION ALL

  -- Cart stows
  SELECT
    ica.stowed_by AS user_id,
    'cart_stow'::TEXT AS event_type,
    ica.stowed_at AS event_timestamp,
    COALESCE(ica.warehouse::TEXT, 'Inbound'::TEXT) AS area
  FROM inbound_cart_assignments ica
  WHERE ica.organization_id = p_organization_id
    AND ica.stowed_at >= p_start_date
    AND ica.stowed_at <= p_end_date
    AND ica.stowed_by IN (SELECT au.uid FROM active_users au)

  UNION ALL

  -- Putaways (created_by)
  SELECT
    rpo.created_by AS user_id,
    'putaway'::TEXT AS event_type,
    COALESCE(rpo.confirmed_at, rpo.created_at) AS event_timestamp,
    COALESCE(rpo.shelf_location::TEXT, rpo.to_location::TEXT, 'Putaway'::TEXT) AS area
  FROM rf_putaway_operations rpo
  WHERE rpo.organization_id = p_organization_id
    AND rpo.created_at >= p_start_date
    AND rpo.created_at <= p_end_date
    AND rpo.created_by IN (SELECT au.uid FROM active_users au)

  UNION ALL

  -- Putaway confirmations (confirmed_by - ONLY if different from creator)
  SELECT
    rpo.confirmed_by AS user_id,
    'putaway_confirm'::TEXT AS event_type,
    rpo.confirmed_at AS event_timestamp,
    COALESCE(rpo.shelf_location::TEXT, rpo.to_location::TEXT, 'Putaway'::TEXT) AS area
  FROM rf_putaway_operations rpo
  WHERE rpo.organization_id = p_organization_id
    AND rpo.confirmed_at >= p_start_date
    AND rpo.confirmed_at <= p_end_date
    AND rpo.confirmed_by IS NOT NULL
    AND rpo.confirmed_by != rpo.created_by
    AND rpo.confirmed_by IN (SELECT au.uid FROM active_users au)

  UNION ALL

  -- Picking
  SELECT
    otd.picked_by AS user_id,
    'picking'::TEXT AS event_type,
    otd.picked_at AS event_timestamp,
    'Picking'::TEXT AS area
  FROM outbound_to_data otd
  WHERE otd.organization_id = p_organization_id
    AND otd.picked_at >= p_start_date
    AND otd.picked_at <= p_end_date
    AND otd.picked_by IS NOT NULL
    AND otd.picked_by IN (SELECT au.uid FROM active_users au)

  UNION ALL

  -- Packed
  SELECT
    otd.packed_by AS user_id,
    'pack'::TEXT AS event_type,
    otd.packed_at AS event_timestamp,
    'Packing'::TEXT AS area
  FROM outbound_to_data otd
  WHERE otd.organization_id = p_organization_id
    AND otd.packed_at >= p_start_date
    AND otd.packed_at <= p_end_date
    AND otd.packed_by IS NOT NULL
    AND otd.packed_by IN (SELECT au.uid FROM active_users au)

  UNION ALL

  -- Shipped
  SELECT
    otd.shipped_by AS user_id,
    'ship'::TEXT AS event_type,
    otd.shipped_at AS event_timestamp,
    'Shipping'::TEXT AS area
  FROM outbound_to_data otd
  WHERE otd.organization_id = p_organization_id
    AND otd.shipped_at >= p_start_date
    AND otd.shipped_at <= p_end_date
    AND otd.shipped_by IS NOT NULL
    AND otd.shipped_by IN (SELECT au.uid FROM active_users au)

  UNION ALL

  -- Final packed
  SELECT
    otd.final_packed_by AS user_id,
    'final_pack'::TEXT AS event_type,
    otd.final_packed_at AS event_timestamp,
    'Final Pack'::TEXT AS area
  FROM outbound_to_data otd
  WHERE otd.organization_id = p_organization_id
    AND otd.final_packed_at >= p_start_date
    AND otd.final_packed_at <= p_end_date
    AND otd.final_packed_by IS NOT NULL
    AND otd.final_packed_by IN (SELECT au.uid FROM active_users au)

  UNION ALL

  -- Putbacks
  SELECT
    pt.created_by AS user_id,
    'putback'::TEXT AS event_type,
    COALESCE(pt.processed_at, pt.created_at) AS event_timestamp,
    'Putback'::TEXT AS area
  FROM putback_tickets pt
  WHERE pt.organization_id = p_organization_id
    AND pt.created_at >= p_start_date
    AND pt.created_at <= p_end_date
    AND pt.created_by IN (SELECT au.uid FROM active_users au)

  UNION ALL

  -- Cycle counts
  -- Bug A fix: filter by completed_at (was created_at) to match the
  --   counts arm and reflect the day the work was actually performed.
  -- Bug C fix: include 'variance_review' alongside 'completed' / 'approved'
  --   so operator work-in-progress (awaiting supervisor sign-off) is visible
  --   on the Gantt rather than silently dropped.
  SELECT
    rcd.assigned_to AS user_id,
    'cycle_count'::TEXT AS event_type,
    COALESCE(rcd.completed_at, rcd.created_at) AS event_timestamp,
    'Inventory'::TEXT AS area
  FROM rr_cyclecount_data rcd
  WHERE rcd.organization_id = p_organization_id
    AND rcd.status IN ('completed', 'approved', 'variance_review')
    AND rcd.completed_at >= p_start_date
    AND rcd.completed_at <= p_end_date
    AND rcd.assigned_to IN (SELECT au.uid FROM active_users au)

  UNION ALL

  -- Customer portal actions
  SELECT
    tua.user_id AS user_id,
    'customer_response'::TEXT AS event_type,
    tua.created_at AS event_timestamp,
    'Customer Portal'::TEXT AS area
  FROM ticket_user_actions tua
  WHERE tua.organization_id = p_organization_id
    AND tua.created_at >= p_start_date
    AND tua.created_at <= p_end_date
    AND tua.user_id IN (SELECT au.uid FROM active_users au)

  ORDER BY user_id, event_timestamp;
END;
$$;

COMMENT ON FUNCTION get_team_activity_events IS
'Returns all activity events with timestamps for Gantt timeline visualizations. Includes cart stow events from inbound_cart_assignments. Cycle-count arm filters by rcd.completed_at and includes status=variance_review (migration 304). Security: Validates caller belongs to the requested organization.';


-- =========================================================================
-- PART 2: Re-create get_team_productivity_counts with Bug C fix
-- (Bug A does not apply on this side: counts arm already used completed_at)
-- =========================================================================

DROP FUNCTION IF EXISTS get_team_productivity_counts(UUID, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION get_team_productivity_counts(
  p_organization_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS TABLE (
  user_id UUID,
  inbound_scans BIGINT,
  cart_stows BIGINT,
  put_aways BIGINT,
  picking BIGINT,
  packed BIGINT,
  shipped BIGINT,
  final_packed BIGINT,
  putbacks BIGINT,
  cycle_counts BIGINT,
  customer_responses BIGINT,
  total_tasks BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM validate_organization_access(p_organization_id);

  RETURN QUERY
  WITH
  active_users AS (
    SELECT DISTINCT sa.user_id AS uid
    FROM shift_assignments sa
    WHERE sa.organization_id = p_organization_id
      AND sa.status = 'active'
      AND sa.is_primary_position = true
  ),

  inbound_counts AS (
    SELECT scanned_by AS uid, COUNT(*) AS cnt
    FROM rr_inbound_scans
    WHERE organization_id = p_organization_id
      AND scanned_at >= p_start_date AND scanned_at <= p_end_date
      AND scanned_by IN (SELECT au.uid FROM active_users au)
    GROUP BY scanned_by
  ),

  cart_stow_counts AS (
    SELECT stowed_by AS uid, COUNT(*) AS cnt
    FROM inbound_cart_assignments
    WHERE organization_id = p_organization_id
      AND stowed_at >= p_start_date AND stowed_at <= p_end_date
      AND stowed_by IN (SELECT au.uid FROM active_users au)
    GROUP BY stowed_by
  ),

  putaway_counts AS (
    SELECT created_by AS uid, COUNT(*) AS cnt
    FROM rf_putaway_operations
    WHERE organization_id = p_organization_id
      AND created_at >= p_start_date AND created_at <= p_end_date
      AND created_by IN (SELECT au.uid FROM active_users au)
    GROUP BY created_by
  ),

  picking_counts AS (
    SELECT picked_by AS uid, COUNT(*) AS cnt
    FROM outbound_to_data
    WHERE organization_id = p_organization_id
      AND picked_at >= p_start_date AND picked_at <= p_end_date
      AND picked_by IN (SELECT au.uid FROM active_users au)
    GROUP BY picked_by
  ),

  packed_counts AS (
    SELECT packed_by AS uid, COUNT(*) AS cnt
    FROM outbound_to_data
    WHERE organization_id = p_organization_id
      AND packed_at >= p_start_date AND packed_at <= p_end_date
      AND packed_by IN (SELECT au.uid FROM active_users au)
    GROUP BY packed_by
  ),

  shipped_counts AS (
    SELECT shipped_by AS uid, COUNT(*) AS cnt
    FROM outbound_to_data
    WHERE organization_id = p_organization_id
      AND shipped_at >= p_start_date AND shipped_at <= p_end_date
      AND shipped_by IN (SELECT au.uid FROM active_users au)
    GROUP BY shipped_by
  ),

  final_packed_counts AS (
    SELECT final_packed_by AS uid, COUNT(*) AS cnt
    FROM outbound_to_data
    WHERE organization_id = p_organization_id
      AND final_packed_at >= p_start_date AND final_packed_at <= p_end_date
      AND final_packed_by IN (SELECT au.uid FROM active_users au)
    GROUP BY final_packed_by
  ),

  putback_counts AS (
    SELECT created_by AS uid, COUNT(*) AS cnt
    FROM putback_tickets
    WHERE organization_id = p_organization_id
      AND created_at >= p_start_date AND created_at <= p_end_date
      AND created_by IN (SELECT au.uid FROM active_users au)
    GROUP BY created_by
  ),

  cyclecount_counts AS (
    -- Bug C fix: include 'variance_review' alongside 'completed'/'approved'
    SELECT assigned_to AS uid, COUNT(*) AS cnt
    FROM rr_cyclecount_data
    WHERE organization_id = p_organization_id
      AND status IN ('completed', 'approved', 'variance_review')
      AND completed_at >= p_start_date AND completed_at <= p_end_date
      AND assigned_to IN (SELECT au.uid FROM active_users au)
    GROUP BY assigned_to
  ),

  customer_response_counts AS (
    SELECT tua.user_id AS uid, COUNT(*) AS cnt
    FROM ticket_user_actions tua
    WHERE tua.organization_id = p_organization_id
      AND tua.created_at >= p_start_date AND tua.created_at <= p_end_date
      AND tua.user_id IN (SELECT au.uid FROM active_users au)
    GROUP BY tua.user_id
  )

  SELECT
    au.uid AS user_id,
    COALESCE(ic.cnt, 0) AS inbound_scans,
    COALESCE(csc.cnt, 0) AS cart_stows,
    COALESCE(pc.cnt, 0) AS put_aways,
    COALESCE(pkc.cnt, 0) AS picking,
    COALESCE(pac.cnt, 0) AS packed,
    COALESCE(sc.cnt, 0) AS shipped,
    COALESCE(fpc.cnt, 0) AS final_packed,
    COALESCE(pbc.cnt, 0) AS putbacks,
    COALESCE(cc.cnt, 0) AS cycle_counts,
    COALESCE(crc.cnt, 0) AS customer_responses,
    (
      COALESCE(ic.cnt, 0) + COALESCE(csc.cnt, 0) + COALESCE(pc.cnt, 0) +
      COALESCE(pkc.cnt, 0) + COALESCE(pac.cnt, 0) + COALESCE(sc.cnt, 0) +
      COALESCE(fpc.cnt, 0) + COALESCE(pbc.cnt, 0) + COALESCE(cc.cnt, 0) +
      COALESCE(crc.cnt, 0)
    ) AS total_tasks
  FROM active_users au
  LEFT JOIN inbound_counts ic ON ic.uid = au.uid
  LEFT JOIN cart_stow_counts csc ON csc.uid = au.uid
  LEFT JOIN putaway_counts pc ON pc.uid = au.uid
  LEFT JOIN picking_counts pkc ON pkc.uid = au.uid
  LEFT JOIN packed_counts pac ON pac.uid = au.uid
  LEFT JOIN shipped_counts sc ON sc.uid = au.uid
  LEFT JOIN final_packed_counts fpc ON fpc.uid = au.uid
  LEFT JOIN putback_counts pbc ON pbc.uid = au.uid
  LEFT JOIN cyclecount_counts cc ON cc.uid = au.uid
  LEFT JOIN customer_response_counts crc ON crc.uid = au.uid;
END;
$$;

COMMENT ON FUNCTION get_team_productivity_counts IS
'Returns aggregated productivity task counts including cart stow events from inbound_cart_assignments. Cycle-count arm includes status=variance_review (migration 304). Security: Validates caller belongs to the requested organization.';


-- Re-grant execute on both functions to keep parity with migration 188.
GRANT EXECUTE ON FUNCTION get_team_activity_events TO authenticated;
GRANT EXECUTE ON FUNCTION get_team_productivity_counts TO authenticated;
