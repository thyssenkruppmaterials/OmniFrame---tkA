-- =========================================================================
-- Dynamic Activity Events Integration
-- Created: January 4, 2026
-- Purpose: Update get_team_activity_events to use activity_source_config
--          This makes activity sources fully dynamic - new sources added 
--          to activity_source_config will automatically appear in timelines
-- =========================================================================

-- =========================================================================
-- PART 1: Drop existing hardcoded function
-- =========================================================================

DROP FUNCTION IF EXISTS get_team_activity_events(UUID, TIMESTAMPTZ, TIMESTAMPTZ);

-- =========================================================================
-- PART 2: Create new dynamic get_team_activity_events function
-- This function reads from activity_source_config and dynamically queries
-- all configured activity sources
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
  area TEXT,
  activity_label TEXT,
  display_color TEXT,
  activity_category TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_config RECORD;
  v_query TEXT;
  v_union_queries TEXT[] := ARRAY[]::TEXT[];
  v_final_query TEXT;
BEGIN
  -- Get active configurations for this organization (including global configs)
  FOR v_config IN 
    SELECT 
      asc.activity_type,
      asc.activity_label,
      asc.source_table,
      asc.source_schema,
      asc.user_id_column,
      asc.timestamp_column,
      asc.organization_id_column,
      asc.area_column,
      asc.area_fallback,
      asc.where_conditions,
      asc.display_color,
      asc.activity_category
    FROM activity_source_config asc
    WHERE asc.is_active = true
      AND (asc.organization_id IS NULL OR asc.organization_id = p_organization_id)
    ORDER BY asc.display_order
  LOOP
    -- Build query for this activity source
    -- Note: Using COALESCE and explicit TEXT casting for proper type handling
    v_query := format(
      $q$
      SELECT 
        %I::UUID AS user_id,
        %L::TEXT AS event_type,
        %I::TIMESTAMPTZ AS event_timestamp,
        COALESCE(%s::TEXT, %L::TEXT) AS area,
        %L::TEXT AS activity_label,
        %L::TEXT AS display_color,
        %L::TEXT AS activity_category
      FROM %I.%I
      WHERE %I = $1
        AND %I >= $2
        AND %I <= $3
        AND %I IN (
          SELECT sa.user_id 
          FROM shift_assignments sa 
          WHERE sa.organization_id = $1 
            AND sa.status = 'active' 
            AND sa.is_primary_position = true
        )
        AND %I IS NOT NULL
      $q$,
      -- Column references
      v_config.user_id_column,                    -- user_id
      v_config.activity_type,                      -- event_type (literal)
      v_config.timestamp_column,                   -- event_timestamp
      CASE 
        WHEN v_config.area_column IS NOT NULL THEN quote_ident(v_config.area_column)
        ELSE 'NULL'
      END,                                         -- area column or NULL
      COALESCE(v_config.area_fallback, 'Unknown'), -- area fallback
      v_config.activity_label,                     -- activity_label
      v_config.display_color,                      -- display_color
      v_config.activity_category,                  -- activity_category
      -- Table reference
      v_config.source_schema,
      v_config.source_table,
      -- WHERE conditions
      v_config.organization_id_column,             -- org filter
      v_config.timestamp_column,                   -- date start
      v_config.timestamp_column,                   -- date end
      v_config.user_id_column,                     -- active users filter
      v_config.user_id_column                      -- NOT NULL filter
    );
    
    -- Add any custom where conditions from config
    IF v_config.where_conditions IS NOT NULL AND v_config.where_conditions != '{}'::jsonb THEN
      -- Handle special status array conditions
      IF v_config.where_conditions ? 'status' THEN
        v_query := v_query || format(
          ' AND status = ANY(%L::text[])',
          (SELECT array_agg(elem::text) FROM jsonb_array_elements_text(v_config.where_conditions->'status') elem)
        );
      END IF;
      
      -- Handle IS NOT NULL conditions
      IF v_config.where_conditions ? 'confirmed_by' AND 
         v_config.where_conditions->>'confirmed_by' = 'IS NOT NULL' THEN
        v_query := v_query || ' AND confirmed_by IS NOT NULL';
      END IF;
    END IF;
    
    v_union_queries := array_append(v_union_queries, v_query);
  END LOOP;
  
  -- Combine all queries with UNION ALL
  IF array_length(v_union_queries, 1) > 0 THEN
    v_final_query := array_to_string(v_union_queries, ' UNION ALL ');
    v_final_query := v_final_query || ' ORDER BY user_id, event_timestamp';
    
    -- Execute the dynamic query
    RETURN QUERY EXECUTE v_final_query
      USING p_organization_id, p_start_date, p_end_date;
  END IF;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_team_activity_events(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- Update function comment
COMMENT ON FUNCTION get_team_activity_events IS 
'DYNAMIC: Returns all activity events by reading from activity_source_config table. 
New activity sources added via Settings → Activity Sources will automatically appear in timelines.
No code changes required to add new activity types.';

-- =========================================================================
-- PART 3: Update get_team_productivity_counts to also be dynamic
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
  total_tasks BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- This function maintains backward compatibility by returning the standard column names
  -- It aggregates counts from all active activity sources into these categories
  
  RETURN QUERY
  WITH dynamic_counts AS (
    -- Get counts from all configured sources
    SELECT 
      dc.user_id,
      dc.activity_type,
      dc.task_count
    FROM get_dynamic_productivity_counts(p_organization_id, p_start_date, p_end_date) dc
  ),
  -- Map activity types to standard column names for backward compatibility
  mapped_counts AS (
    SELECT
      dc.user_id,
      -- Map to standard categories (handles both system and custom types)
      CASE WHEN dc.activity_type IN ('inbound_scan') THEN dc.task_count ELSE 0 END AS inbound_scans,
      CASE WHEN dc.activity_type IN ('putaway', 'putaway_confirm') THEN dc.task_count ELSE 0 END AS put_aways,
      CASE WHEN dc.activity_type IN ('picking') THEN dc.task_count ELSE 0 END AS picking,
      CASE WHEN dc.activity_type IN ('pack') THEN dc.task_count ELSE 0 END AS packed,
      CASE WHEN dc.activity_type IN ('ship') THEN dc.task_count ELSE 0 END AS shipped,
      CASE WHEN dc.activity_type IN ('final_pack') THEN dc.task_count ELSE 0 END AS final_packed,
      CASE WHEN dc.activity_type IN ('putback') THEN dc.task_count ELSE 0 END AS putbacks,
      CASE WHEN dc.activity_type IN ('cycle_count') THEN dc.task_count ELSE 0 END AS cycle_counts,
      dc.task_count AS total  -- All activity types contribute to total
    FROM dynamic_counts dc
  )
  -- Aggregate per user
  SELECT
    mc.user_id,
    SUM(mc.inbound_scans)::BIGINT AS inbound_scans,
    SUM(mc.put_aways)::BIGINT AS put_aways,
    SUM(mc.picking)::BIGINT AS picking,
    SUM(mc.packed)::BIGINT AS packed,
    SUM(mc.shipped)::BIGINT AS shipped,
    SUM(mc.final_packed)::BIGINT AS final_packed,
    SUM(mc.putbacks)::BIGINT AS putbacks,
    SUM(mc.cycle_counts)::BIGINT AS cycle_counts,
    SUM(mc.total)::BIGINT AS total_tasks
  FROM mapped_counts mc
  GROUP BY mc.user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_team_productivity_counts(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION get_team_productivity_counts IS 
'DYNAMIC: Returns productivity counts by reading from activity_source_config.
Standard columns (inbound_scans, put_aways, etc.) are populated from configured sources.
Custom activity types are included in total_tasks.';

-- =========================================================================
-- PART 4: Add new RPC to get productivity by activity type (for custom types)
-- This allows frontend to show counts for ALL activity types, not just standard ones
-- =========================================================================

CREATE OR REPLACE FUNCTION get_productivity_by_activity_type(
  p_organization_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS TABLE (
  user_id UUID,
  activity_type TEXT,
  activity_label TEXT,
  display_color TEXT,
  task_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dpc.user_id,
    dpc.activity_type,
    asc.activity_label,
    asc.display_color,
    dpc.task_count
  FROM get_dynamic_productivity_counts(p_organization_id, p_start_date, p_end_date) dpc
  LEFT JOIN activity_source_config asc ON asc.activity_type = dpc.activity_type
    AND (asc.organization_id IS NULL OR asc.organization_id = p_organization_id)
  ORDER BY dpc.user_id, asc.display_order, dpc.activity_type;
END;
$$;

GRANT EXECUTE ON FUNCTION get_productivity_by_activity_type(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION get_productivity_by_activity_type IS 
'Returns productivity counts with full metadata for all activity types (including custom).
Use this for dashboards that need to show custom activity type counts.';

-- =========================================================================
-- PART 5: Add helper view for easy activity config lookup
-- =========================================================================

CREATE OR REPLACE VIEW v_active_activity_configs AS
SELECT 
  asc.id,
  asc.organization_id,
  asc.activity_type,
  asc.activity_label,
  asc.activity_description,
  asc.source_table,
  asc.display_color,
  asc.display_order,
  asc.activity_category,
  asc.is_system,
  COALESCE(adc.gantt_bg_class, 'bg-' || asc.display_color) AS gantt_bg_class,
  COALESCE(adc.gantt_hover_class, 'hover:bg-' || replace(asc.display_color, '-500', '-400')) AS gantt_hover_class,
  COALESCE(adc.gantt_text_class, 'text-white') AS gantt_text_class,
  COALESCE(adc.show_on_timeline, true) AS show_on_timeline,
  COALESCE(adc.show_in_summary, true) AS show_in_summary,
  COALESCE(adc.include_in_efficiency, true) AS include_in_efficiency
FROM activity_source_config asc
LEFT JOIN activity_display_config adc 
  ON adc.activity_type = asc.activity_type
  AND (adc.organization_id = asc.organization_id OR adc.organization_id IS NULL)
WHERE asc.is_active = true
ORDER BY asc.display_order, asc.activity_type;

-- =========================================================================
-- PART 6: Comments
-- =========================================================================

COMMENT ON VIEW v_active_activity_configs IS 
'Convenience view showing all active activity configurations with display settings merged.
Use get_activity_configurations() RPC for organization-specific filtering.';
