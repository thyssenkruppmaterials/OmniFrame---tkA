-- ============================================================================
-- Migration 310: Wire kit workflow stages into shift-productivity RPCs
-- ----------------------------------------------------------------------------
-- Adds the four Kitting Apps workflow stages as countable activity types
-- across the productivity surfaces (My Productivity, Shift Productivity,
-- Production Boards):
--
--   kit_picking       — kit_to_line_picked_date_time   (per TO line)
--   kit_building      — kit_to_line_kitted_date_time   (per material)
--   kit_inspection    — kit_inspection_completion_date_time (per kit)
--   kit_dock_staging  — kit_ready_on_dock_date_time    (per kit)
--
-- Both productivity RPCs are re-created in full so the four new UNION arms /
-- count CTEs ship atomically and the existing arms remain byte-equivalent
-- with migration 304 (Bug A + Bug C cycle-count fixes). SECURITY DEFINER
-- mode and GRANT EXECUTE TO authenticated are preserved.
--
-- Conventions followed (per
-- memorybank/OmniFrame/Debug/Investigate-Shift-Productivity-Cycle-Counts-Hidden.md):
--
--   * Every arm filters on its ACTION timestamp, never created_at.
--   * Org scoping uses the existing `active_users` CTE (RR_Kitting_DATA does
--     not carry an `organization_id` column today). The CTE already restricts
--     to users with an active primary-position shift assignment in the
--     requested org, which is the same envelope every other arm uses.
--   * Per-kit stages (inspection, dock_staging) DISTINCT on kit_serial_number
--     because the kit-level columns are stamped on every TO-line row of the
--     kit by the underlying UPDATE.
--   * Per-line stages (picking, kitting) emit one event per row — picking a
--     TO line is one bump on the counter, kitting a material is another.
--   * Inspection-bypass exclusion: the skip-inspection branch of
--     `completeKitBuild` stamps `kit_inspection_completion_*` to preserve a
--     coherent audit trail even when an org has the workflow toggle off
--     (see Implementations/Optional-Kit-Inspection-Toggle.md). Those rows
--     are NOT productive inspection work — no operator actually inspected.
--     We gate the inspection arm on
--       `kitting_workflow_settings.kit_inspection_required = TRUE`
--     (default-true via NOT EXISTS so orgs without a settings row keep the
--     legacy three-stage behaviour). Inspection-OFF orgs simply return
--     zero `kit_inspection` events.
--   * Every per-arm filter uses the actor user column (`*_by_user`) and
--     intersects with `active_users`, preserving the existing org guard.
--
-- See: memorybank/OmniFrame/Implementations/Productivity-Wiring-Kit-Workflow-Stages.md
-- ============================================================================


-- ==========================================================================
-- PART 1: Re-create get_team_activity_events with the four kit UNION arms
-- ==========================================================================

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
  ),
  -- Inspection-bypass guard: when the org has
  -- `kitting_workflow_settings.kit_inspection_required = FALSE`, the
  -- skip-inspection branch in completeKitBuild auto-stamps the inspection
  -- columns even though no operator actually inspected. We exclude those
  -- rows from productive inspection work via this single-row CTE.
  org_inspection_required AS (
    SELECT NOT EXISTS (
      SELECT 1 FROM kitting_workflow_settings kws
      WHERE kws.organization_id = p_organization_id
        AND kws.kit_inspection_required = FALSE
    ) AS required
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

  -- Picking (outbound TO lines)
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

  -- Cycle counts (Bug A + Bug C fixes carried verbatim from migration 304)
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

  UNION ALL

  -- Kit picking (per TO line). RR_Kitting_DATA has no organization_id
  -- column; org scope comes from the active_users intersection.
  SELECT
    rkd.kit_to_line_picked_by_user AS user_id,
    'kit_picking'::TEXT AS event_type,
    rkd.kit_to_line_picked_date_time AS event_timestamp,
    'Kitting'::TEXT AS area
  FROM "RR_Kitting_DATA" rkd
  WHERE rkd.kit_to_line_picked_date_time >= p_start_date
    AND rkd.kit_to_line_picked_date_time <= p_end_date
    AND rkd.kit_to_line_picked_by_user IS NOT NULL
    AND rkd.kit_to_line_picked_by_user IN (SELECT au.uid FROM active_users au)

  UNION ALL

  -- Kit building (per material kitted on the BOM TO line).
  SELECT
    rkd.kit_to_line_kitted_by_user AS user_id,
    'kit_building'::TEXT AS event_type,
    rkd.kit_to_line_kitted_date_time AS event_timestamp,
    'Kitting'::TEXT AS area
  FROM "RR_Kitting_DATA" rkd
  WHERE rkd.kit_to_line_kitted_date_time >= p_start_date
    AND rkd.kit_to_line_kitted_date_time <= p_end_date
    AND rkd.kit_to_line_kitted_by_user IS NOT NULL
    AND rkd.kit_to_line_kitted_by_user IN (SELECT au.uid FROM active_users au)

  UNION ALL

  -- Kit inspection (per kit — DISTINCT on kit_serial_number because the
  -- inspection columns are stamped on every TO-line row of the kit).
  -- Inspection-bypass exclusion: when the org has inspection disabled
  -- the auto-stamped rows are not productive inspection work.
  SELECT
    ki.kit_inspection_by_user AS user_id,
    'kit_inspection'::TEXT AS event_type,
    ki.kit_inspection_completion_date_time AS event_timestamp,
    'Kitting'::TEXT AS area
  FROM (
    SELECT DISTINCT
      rkd.kit_serial_number,
      rkd.kit_inspection_by_user,
      rkd.kit_inspection_completion_date_time
    FROM "RR_Kitting_DATA" rkd
    WHERE rkd.kit_inspection_completion_date_time >= p_start_date
      AND rkd.kit_inspection_completion_date_time <= p_end_date
      AND rkd.kit_inspection_by_user IS NOT NULL
      AND rkd.kit_serial_number IS NOT NULL
  ) ki
  WHERE ki.kit_inspection_by_user IN (SELECT au.uid FROM active_users au)
    AND (SELECT required FROM org_inspection_required)

  UNION ALL

  -- Kit dock staging (per kit — DISTINCT on kit_serial_number; same
  -- replication pattern as the inspection columns).
  SELECT
    kd.kit_ready_on_dock_by_user AS user_id,
    'kit_dock_staging'::TEXT AS event_type,
    kd.kit_ready_on_dock_date_time AS event_timestamp,
    'Kitting'::TEXT AS area
  FROM (
    SELECT DISTINCT
      rkd.kit_serial_number,
      rkd.kit_ready_on_dock_by_user,
      rkd.kit_ready_on_dock_date_time
    FROM "RR_Kitting_DATA" rkd
    WHERE rkd.kit_ready_on_dock_date_time >= p_start_date
      AND rkd.kit_ready_on_dock_date_time <= p_end_date
      AND rkd.kit_ready_on_dock_by_user IS NOT NULL
      AND rkd.kit_serial_number IS NOT NULL
  ) kd
  WHERE kd.kit_ready_on_dock_by_user IN (SELECT au.uid FROM active_users au)

  ORDER BY user_id, event_timestamp;
END;
$$;

COMMENT ON FUNCTION get_team_activity_events IS
'Returns all activity events with timestamps for Gantt timeline visualizations. Includes kit-workflow stages (kit_picking, kit_building, kit_inspection, kit_dock_staging) added in migration 310. Inspection arm respects kitting_workflow_settings.kit_inspection_required to exclude auto-stamped bypass rows. Cycle-count arm filters by rcd.completed_at and includes status=variance_review (migration 304). Security: Validates caller belongs to the requested organization.';


-- ==========================================================================
-- PART 2: Re-create get_team_productivity_counts with four kit-stage CTEs
-- ==========================================================================
-- RETURNS TABLE shape changes additively (four new BIGINT columns trailing
-- the existing ones). All existing callers in src/lib/supabase/* are
-- updated in the same slice to consume the new fields.

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
  kit_picking BIGINT,
  kit_building BIGINT,
  kit_inspection BIGINT,
  kit_dock_staging BIGINT,
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

  org_inspection_required AS (
    SELECT NOT EXISTS (
      SELECT 1 FROM kitting_workflow_settings kws
      WHERE kws.organization_id = p_organization_id
        AND kws.kit_inspection_required = FALSE
    ) AS required
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
  ),

  kit_picking_counts AS (
    SELECT kit_to_line_picked_by_user AS uid, COUNT(*) AS cnt
    FROM "RR_Kitting_DATA"
    WHERE kit_to_line_picked_date_time >= p_start_date
      AND kit_to_line_picked_date_time <= p_end_date
      AND kit_to_line_picked_by_user IS NOT NULL
      AND kit_to_line_picked_by_user IN (SELECT au.uid FROM active_users au)
    GROUP BY kit_to_line_picked_by_user
  ),

  kit_building_counts AS (
    SELECT kit_to_line_kitted_by_user AS uid, COUNT(*) AS cnt
    FROM "RR_Kitting_DATA"
    WHERE kit_to_line_kitted_date_time >= p_start_date
      AND kit_to_line_kitted_date_time <= p_end_date
      AND kit_to_line_kitted_by_user IS NOT NULL
      AND kit_to_line_kitted_by_user IN (SELECT au.uid FROM active_users au)
    GROUP BY kit_to_line_kitted_by_user
  ),

  kit_inspection_counts AS (
    SELECT ki.kit_inspection_by_user AS uid, COUNT(*) AS cnt
    FROM (
      SELECT DISTINCT
        rkd.kit_serial_number,
        rkd.kit_inspection_by_user
      FROM "RR_Kitting_DATA" rkd
      WHERE rkd.kit_inspection_completion_date_time >= p_start_date
        AND rkd.kit_inspection_completion_date_time <= p_end_date
        AND rkd.kit_inspection_by_user IS NOT NULL
        AND rkd.kit_serial_number IS NOT NULL
    ) ki
    WHERE ki.kit_inspection_by_user IN (SELECT au.uid FROM active_users au)
      AND (SELECT required FROM org_inspection_required)
    GROUP BY ki.kit_inspection_by_user
  ),

  kit_dock_staging_counts AS (
    SELECT kd.kit_ready_on_dock_by_user AS uid, COUNT(*) AS cnt
    FROM (
      SELECT DISTINCT
        rkd.kit_serial_number,
        rkd.kit_ready_on_dock_by_user
      FROM "RR_Kitting_DATA" rkd
      WHERE rkd.kit_ready_on_dock_date_time >= p_start_date
        AND rkd.kit_ready_on_dock_date_time <= p_end_date
        AND rkd.kit_ready_on_dock_by_user IS NOT NULL
        AND rkd.kit_serial_number IS NOT NULL
    ) kd
    WHERE kd.kit_ready_on_dock_by_user IN (SELECT au.uid FROM active_users au)
    GROUP BY kd.kit_ready_on_dock_by_user
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
    COALESCE(kpc.cnt, 0) AS kit_picking,
    COALESCE(kbc.cnt, 0) AS kit_building,
    COALESCE(kic.cnt, 0) AS kit_inspection,
    COALESCE(kdsc.cnt, 0) AS kit_dock_staging,
    (
      COALESCE(ic.cnt, 0) + COALESCE(csc.cnt, 0) + COALESCE(pc.cnt, 0) +
      COALESCE(pkc.cnt, 0) + COALESCE(pac.cnt, 0) + COALESCE(sc.cnt, 0) +
      COALESCE(fpc.cnt, 0) + COALESCE(pbc.cnt, 0) + COALESCE(cc.cnt, 0) +
      COALESCE(crc.cnt, 0) + COALESCE(kpc.cnt, 0) + COALESCE(kbc.cnt, 0) +
      COALESCE(kic.cnt, 0) + COALESCE(kdsc.cnt, 0)
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
  LEFT JOIN customer_response_counts crc ON crc.uid = au.uid
  LEFT JOIN kit_picking_counts kpc ON kpc.uid = au.uid
  LEFT JOIN kit_building_counts kbc ON kbc.uid = au.uid
  LEFT JOIN kit_inspection_counts kic ON kic.uid = au.uid
  LEFT JOIN kit_dock_staging_counts kdsc ON kdsc.uid = au.uid;
END;
$$;

COMMENT ON FUNCTION get_team_productivity_counts IS
'Returns aggregated productivity task counts. Includes kit-workflow stages (kit_picking, kit_building, kit_inspection, kit_dock_staging) added in migration 310. Inspection counts respect kitting_workflow_settings.kit_inspection_required. Cycle-count arm includes status=variance_review (migration 304). Security: Validates caller belongs to the requested organization.';


-- Re-grant execute on both functions to keep parity with migration 304.
GRANT EXECUTE ON FUNCTION get_team_activity_events TO authenticated;
GRANT EXECUTE ON FUNCTION get_team_productivity_counts TO authenticated;
