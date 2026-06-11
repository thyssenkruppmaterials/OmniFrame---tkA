-- ==========================================================================
-- Migration 169: Customer Portal Productivity Tracking
-- Date: 2026-02-06
-- Description: Adds tables, indexes, RLS policies, activity source config,
--   and RPC functions to track customer portal user actions and integrate
--   them into the Activity Gantt / Labor Management productivity system.
-- ==========================================================================

-- =========================================================================
-- PART 1: Create smartsheet_activity_log table
-- This table is referenced in database.types.ts but was never created via
-- migration. It stores audit logs of all Smartsheet API operations.
-- =========================================================================

CREATE TABLE IF NOT EXISTS smartsheet_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  user_id UUID,
  organization_id UUID REFERENCES organizations(id),
  sheet_id BIGINT,
  sheet_name TEXT,
  details JSONB,
  status TEXT DEFAULT 'success',
  error_message TEXT,
  duration_ms INTEGER,
  ip_address INET,
  user_agent TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for smartsheet_activity_log
CREATE INDEX IF NOT EXISTS idx_smartsheet_activity_log_user_created
  ON smartsheet_activity_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_smartsheet_activity_log_org_created
  ON smartsheet_activity_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_smartsheet_activity_log_sheet
  ON smartsheet_activity_log (sheet_id);
CREATE INDEX IF NOT EXISTS idx_smartsheet_activity_log_action
  ON smartsheet_activity_log (action);

-- RLS for smartsheet_activity_log
ALTER TABLE smartsheet_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their organization activity logs"
  ON smartsheet_activity_log FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Service role can insert activity logs"
  ON smartsheet_activity_log FOR INSERT
  WITH CHECK (true);


-- =========================================================================
-- PART 2: Create ticket_user_actions table
-- Stores every structured user action on the customer portal for
-- productivity tracking and integration with the Activity Gantt.
-- =========================================================================

CREATE TABLE IF NOT EXISTS ticket_user_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_row_id BIGINT NOT NULL,
  action_type TEXT NOT NULL,  -- 'comment', 'status_change', 'field_update', 'attachment', 'ticket_create'
  details JSONB DEFAULT '{}',
  response_time_ms BIGINT,    -- time since last customer message (null if N/A)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for ticket_user_actions
CREATE INDEX IF NOT EXISTS idx_ticket_user_actions_user_created
  ON ticket_user_actions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_user_actions_org_created
  ON ticket_user_actions (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_user_actions_ticket
  ON ticket_user_actions (ticket_row_id);
CREATE INDEX IF NOT EXISTS idx_ticket_user_actions_action_type
  ON ticket_user_actions (action_type);
CREATE INDEX IF NOT EXISTS idx_ticket_user_actions_org_user_created
  ON ticket_user_actions (organization_id, user_id, created_at DESC);

-- RLS for ticket_user_actions
ALTER TABLE ticket_user_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their organization ticket actions"
  ON ticket_user_actions FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own ticket actions"
  ON ticket_user_actions FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
  );

COMMENT ON TABLE ticket_user_actions IS 
'Tracks all customer portal user actions for productivity analytics and Activity Gantt integration. Each row represents a discrete action (comment, status change, field update, attachment, ticket creation) performed by an authenticated user.';


-- =========================================================================
-- PART 3: Insert customer_response into activity_source_config
-- Registers the new activity type so it appears on the Activity Gantt.
-- =========================================================================

INSERT INTO activity_source_config (
  organization_id,
  activity_type,
  activity_label,
  activity_description,
  source_table,
  source_schema,
  user_id_column,
  timestamp_column,
  organization_id_column,
  area_column,
  area_fallback,
  where_conditions,
  count_enabled,
  count_column,
  display_color,
  display_icon,
  display_order,
  activity_category,
  department,
  is_active,
  is_system
) VALUES (
  NULL,                           -- organization_id (NULL = global/system)
  'customer_response',            -- activity_type
  'Customer Portal',              -- activity_label
  'Ticket management and customer communication',  -- activity_description
  'ticket_user_actions',          -- source_table
  'public',                       -- source_schema
  'user_id',                      -- user_id_column
  'created_at',                   -- timestamp_column
  'organization_id',              -- organization_id_column
  NULL,                           -- area_column (no area for portal work)
  'Customer Portal',              -- area_fallback
  '{}',                           -- where_conditions (no filters needed)
  true,                           -- count_enabled
  '*',                            -- count_column
  'pink-500',                     -- display_color
  NULL,                           -- display_icon
  80,                             -- display_order (after cycle_count at 70)
  'work',                         -- activity_category
  NULL,                           -- department
  true,                           -- is_active
  true                            -- is_system
) ON CONFLICT (organization_id, activity_type) DO NOTHING;


-- =========================================================================
-- PART 4: Update get_team_activity_events() RPC
-- Add customer_response events from ticket_user_actions
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
  -- SECURITY VALIDATION: Verify caller has access to this organization
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
  SELECT 
    rcd.assigned_to AS user_id,
    'cycle_count'::TEXT AS event_type,
    COALESCE(rcd.completed_at, rcd.created_at) AS event_timestamp,
    'Inventory'::TEXT AS area
  FROM rr_cyclecount_data rcd
  WHERE rcd.organization_id = p_organization_id
    AND rcd.status IN ('completed', 'approved')
    AND rcd.created_at >= p_start_date
    AND rcd.created_at <= p_end_date
    AND rcd.assigned_to IN (SELECT au.uid FROM active_users au)
  
  UNION ALL
  
  -- Customer portal actions (NEW)
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
'Returns all activity events with timestamps for Gantt timeline visualizations. Includes customer portal actions from ticket_user_actions table. Security: Validates caller belongs to the requested organization.';


-- =========================================================================
-- PART 5: Update get_team_productivity_counts() RPC
-- Add customer_responses count from ticket_user_actions
-- Must DROP first because return type changed (added customer_responses)
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
  -- SECURITY VALIDATION: Verify caller has access to this organization
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
  
  -- Count inbound scans per user
  inbound_counts AS (
    SELECT scanned_by AS uid, COUNT(*) AS cnt
    FROM rr_inbound_scans
    WHERE organization_id = p_organization_id
      AND scanned_at >= p_start_date
      AND scanned_at <= p_end_date
      AND scanned_by IN (SELECT au.uid FROM active_users au)
    GROUP BY scanned_by
  ),
  
  -- Count putaways per user (created_by)
  putaway_counts AS (
    SELECT created_by AS uid, COUNT(*) AS cnt
    FROM rf_putaway_operations
    WHERE organization_id = p_organization_id
      AND created_at >= p_start_date
      AND created_at <= p_end_date
      AND created_by IN (SELECT au.uid FROM active_users au)
    GROUP BY created_by
  ),
  
  -- Count picking per user
  picking_counts AS (
    SELECT picked_by AS uid, COUNT(*) AS cnt
    FROM outbound_to_data
    WHERE organization_id = p_organization_id
      AND picked_at >= p_start_date
      AND picked_at <= p_end_date
      AND picked_by IN (SELECT au.uid FROM active_users au)
    GROUP BY picked_by
  ),
  
  -- Count packed per user
  packed_counts AS (
    SELECT packed_by AS uid, COUNT(*) AS cnt
    FROM outbound_to_data
    WHERE organization_id = p_organization_id
      AND packed_at >= p_start_date
      AND packed_at <= p_end_date
      AND packed_by IN (SELECT au.uid FROM active_users au)
    GROUP BY packed_by
  ),
  
  -- Count shipped per user
  shipped_counts AS (
    SELECT shipped_by AS uid, COUNT(*) AS cnt
    FROM outbound_to_data
    WHERE organization_id = p_organization_id
      AND shipped_at >= p_start_date
      AND shipped_at <= p_end_date
      AND shipped_by IN (SELECT au.uid FROM active_users au)
    GROUP BY shipped_by
  ),
  
  -- Count final_packed per user
  final_packed_counts AS (
    SELECT final_packed_by AS uid, COUNT(*) AS cnt
    FROM outbound_to_data
    WHERE organization_id = p_organization_id
      AND final_packed_at >= p_start_date
      AND final_packed_at <= p_end_date
      AND final_packed_by IN (SELECT au.uid FROM active_users au)
    GROUP BY final_packed_by
  ),
  
  -- Count putbacks per user
  putback_counts AS (
    SELECT created_by AS uid, COUNT(*) AS cnt
    FROM putback_tickets
    WHERE organization_id = p_organization_id
      AND created_at >= p_start_date
      AND created_at <= p_end_date
      AND created_by IN (SELECT au.uid FROM active_users au)
    GROUP BY created_by
  ),
  
  -- Count cycle counts per user
  cyclecount_counts AS (
    SELECT assigned_to AS uid, COUNT(*) AS cnt
    FROM rr_cyclecount_data
    WHERE organization_id = p_organization_id
      AND status IN ('completed', 'approved')
      AND completed_at >= p_start_date
      AND completed_at <= p_end_date
      AND assigned_to IN (SELECT au.uid FROM active_users au)
    GROUP BY assigned_to
  ),
  
  -- Count customer portal actions per user (NEW)
  customer_response_counts AS (
    SELECT tua.user_id AS uid, COUNT(*) AS cnt
    FROM ticket_user_actions tua
    WHERE tua.organization_id = p_organization_id
      AND tua.created_at >= p_start_date
      AND tua.created_at <= p_end_date
      AND tua.user_id IN (SELECT au.uid FROM active_users au)
    GROUP BY tua.user_id
  )
  
  -- Combine all counts for each user
  SELECT 
    au.uid AS user_id,
    COALESCE(ic.cnt, 0) AS inbound_scans,
    COALESCE(pc.cnt, 0) AS put_aways,
    COALESCE(pkc.cnt, 0) AS picking,
    COALESCE(pac.cnt, 0) AS packed,
    COALESCE(sc.cnt, 0) AS shipped,
    COALESCE(fpc.cnt, 0) AS final_packed,
    COALESCE(pbc.cnt, 0) AS putbacks,
    COALESCE(cc.cnt, 0) AS cycle_counts,
    COALESCE(crc.cnt, 0) AS customer_responses,
    (
      COALESCE(ic.cnt, 0) + COALESCE(pc.cnt, 0) + COALESCE(pkc.cnt, 0) +
      COALESCE(pac.cnt, 0) + COALESCE(sc.cnt, 0) + COALESCE(fpc.cnt, 0) +
      COALESCE(pbc.cnt, 0) + COALESCE(cc.cnt, 0) + COALESCE(crc.cnt, 0)
    ) AS total_tasks
  FROM active_users au
  LEFT JOIN inbound_counts ic ON ic.uid = au.uid
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
'Returns aggregated productivity task counts for all active associates including customer portal actions. Security: Validates caller belongs to the requested organization.';


-- =========================================================================
-- PART 6: Create get_customer_portal_metrics() RPC
-- Returns per-user productivity metrics for customer portal work
-- =========================================================================

CREATE OR REPLACE FUNCTION get_customer_portal_metrics(
  p_organization_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS TABLE (
  user_id UUID,
  user_first_name TEXT,
  user_last_name TEXT,
  user_full_name TEXT,
  user_email TEXT,
  tickets_handled BIGINT,
  comments_made BIGINT,
  status_changes BIGINT,
  field_updates BIGINT,
  attachments_added BIGINT,
  tickets_created BIGINT,
  total_actions BIGINT,
  avg_response_time_ms BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- SECURITY VALIDATION: Verify caller has access to this organization
  PERFORM validate_organization_access(p_organization_id);
  
  RETURN QUERY
  SELECT
    tua.user_id,
    up.first_name::TEXT AS user_first_name,
    up.last_name::TEXT AS user_last_name,
    up.full_name::TEXT AS user_full_name,
    up.email::TEXT AS user_email,
    COUNT(DISTINCT tua.ticket_row_id) AS tickets_handled,
    COUNT(*) FILTER (WHERE tua.action_type = 'comment') AS comments_made,
    COUNT(*) FILTER (WHERE tua.action_type = 'status_change') AS status_changes,
    COUNT(*) FILTER (WHERE tua.action_type = 'field_update') AS field_updates,
    COUNT(*) FILTER (WHERE tua.action_type = 'attachment') AS attachments_added,
    COUNT(*) FILTER (WHERE tua.action_type = 'ticket_create') AS tickets_created,
    COUNT(*) AS total_actions,
    COALESCE(AVG(tua.response_time_ms) FILTER (WHERE tua.response_time_ms IS NOT NULL), 0)::BIGINT AS avg_response_time_ms
  FROM ticket_user_actions tua
  LEFT JOIN user_profiles up ON up.id = tua.user_id
  WHERE tua.organization_id = p_organization_id
    AND tua.created_at >= p_start_date
    AND tua.created_at <= p_end_date
  GROUP BY tua.user_id, up.first_name, up.last_name, up.full_name, up.email
  ORDER BY total_actions DESC;
END;
$$;

COMMENT ON FUNCTION get_customer_portal_metrics IS 
'Returns per-user customer portal productivity metrics with user profile names. Security: Validates caller belongs to the requested organization.';


-- =========================================================================
-- GRANTS
-- =========================================================================

-- Grant execute on new function to authenticated users
GRANT EXECUTE ON FUNCTION get_customer_portal_metrics TO authenticated;

-- Ensure existing functions still have correct grants
GRANT EXECUTE ON FUNCTION get_team_activity_events TO authenticated;
GRANT EXECUTE ON FUNCTION get_team_productivity_counts TO authenticated;
