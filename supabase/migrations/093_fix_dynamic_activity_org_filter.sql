-- =========================================================================
-- Fix Dynamic Activity Events for Tables Without Organization ID Column
-- Created: January 4, 2026
-- Purpose: Make organization_id_column filter optional in dynamic activity queries
--          This allows activity sources like RR_Kitting_DATA (which don't have
--          an organization_id column) to be properly queried.
--          The shift_assignments filter already provides organization scoping.
--
-- Also includes fixes for:
-- - Validating area_column exists before using it
-- - Casting status to TEXT for enum type compatibility
-- =========================================================================

-- =========================================================================
-- PART 1: Update get_team_activity_events
-- =========================================================================

DROP FUNCTION IF EXISTS get_team_activity_events(UUID, TIMESTAMPTZ, TIMESTAMPTZ);

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
  v_org_filter TEXT;
  v_area_column_expr TEXT;
BEGIN
  FOR v_config IN 
    SELECT 
      ac.activity_type,
      ac.activity_label,
      ac.source_table,
      ac.source_schema,
      ac.user_id_column,
      ac.timestamp_column,
      ac.organization_id_column,
      ac.area_column,
      ac.area_fallback,
      ac.where_conditions,
      ac.display_color,
      ac.activity_category
    FROM activity_source_config ac
    WHERE ac.is_active = true
      AND (ac.organization_id IS NULL OR ac.organization_id = p_organization_id)
    ORDER BY ac.display_order
  LOOP
    -- Build organization filter - only if column is configured AND exists
    -- This allows tables like RR_Kitting_DATA (no org_id column) to work
    IF v_config.organization_id_column IS NOT NULL 
       AND v_config.organization_id_column != '' 
       AND EXISTS (
         SELECT 1 FROM information_schema.columns 
         WHERE table_schema = v_config.source_schema 
           AND table_name = v_config.source_table 
           AND column_name = v_config.organization_id_column
       ) THEN
      v_org_filter := format(' AND %I = $1', v_config.organization_id_column);
    ELSE
      v_org_filter := '';
    END IF;
    
    -- Build area column expression - only if column exists
    IF v_config.area_column IS NOT NULL 
       AND v_config.area_column != '' 
       AND EXISTS (
         SELECT 1 FROM information_schema.columns 
         WHERE table_schema = v_config.source_schema 
           AND table_name = v_config.source_table 
           AND column_name = v_config.area_column
       ) THEN
      v_area_column_expr := quote_ident(v_config.area_column);
    ELSE
      v_area_column_expr := 'NULL';
    END IF;
    
    -- Build query
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
      WHERE %I >= $2
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
      v_config.user_id_column,
      v_config.activity_type,
      v_config.timestamp_column,
      v_area_column_expr,
      COALESCE(v_config.area_fallback, 'Unknown'),
      v_config.activity_label,
      v_config.display_color,
      v_config.activity_category,
      v_config.source_schema,
      v_config.source_table,
      v_config.timestamp_column,
      v_config.timestamp_column,
      v_config.user_id_column,
      v_config.user_id_column
    );
    
    v_query := v_query || v_org_filter;
    
    -- Handle where_conditions with TEXT cast for enum compatibility
    IF v_config.where_conditions IS NOT NULL AND v_config.where_conditions != '{}'::jsonb THEN
      IF v_config.where_conditions ? 'status' THEN
        v_query := v_query || format(
          ' AND status::TEXT = ANY(%L::text[])',
          (SELECT array_agg(elem::text) FROM jsonb_array_elements_text(v_config.where_conditions->'status') elem)
        );
      END IF;
      
      IF v_config.where_conditions ? 'confirmed_by' AND 
         v_config.where_conditions->>'confirmed_by' = 'IS NOT NULL' THEN
        v_query := v_query || ' AND confirmed_by IS NOT NULL';
      END IF;
    END IF;
    
    v_union_queries := array_append(v_union_queries, v_query);
  END LOOP;
  
  IF array_length(v_union_queries, 1) > 0 THEN
    v_final_query := array_to_string(v_union_queries, ' UNION ALL ');
    v_final_query := v_final_query || ' ORDER BY user_id, event_timestamp';
    
    RETURN QUERY EXECUTE v_final_query
      USING p_organization_id, p_start_date, p_end_date;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_team_activity_events(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION get_team_activity_events IS 
'DYNAMIC: Returns all activity events by reading from activity_source_config table. 
Supports tables with or without organization_id column - org scoping is always enforced via shift_assignments.
Also validates area_column exists before using, and casts status to TEXT for enum compatibility.';

-- =========================================================================
-- PART 2: Update get_dynamic_productivity_counts similarly
-- =========================================================================

DROP FUNCTION IF EXISTS get_dynamic_productivity_counts(UUID, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION get_dynamic_productivity_counts(
  p_organization_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS TABLE (
  user_id UUID,
  activity_type TEXT,
  task_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_config RECORD;
  v_query TEXT;
  v_union_queries TEXT[] := ARRAY[]::TEXT[];
  v_final_query TEXT;
  v_org_filter TEXT;
BEGIN
  FOR v_config IN 
    SELECT 
      ac.activity_type,
      ac.source_table,
      ac.source_schema,
      ac.user_id_column,
      ac.timestamp_column,
      ac.organization_id_column,
      ac.where_conditions,
      ac.count_column
    FROM activity_source_config ac
    WHERE ac.is_active = true
      AND ac.count_enabled = true
      AND (ac.organization_id IS NULL OR ac.organization_id = p_organization_id)
  LOOP
    IF v_config.organization_id_column IS NOT NULL 
       AND v_config.organization_id_column != '' 
       AND EXISTS (
         SELECT 1 FROM information_schema.columns 
         WHERE table_schema = v_config.source_schema 
           AND table_name = v_config.source_table 
           AND column_name = v_config.organization_id_column
       ) THEN
      v_org_filter := format(' AND %I = $1', v_config.organization_id_column);
    ELSE
      v_org_filter := '';
    END IF;
    
    v_query := format(
      $q$
      SELECT 
        %I::UUID AS user_id,
        %L::TEXT AS activity_type,
        COUNT(%s)::BIGINT AS task_count
      FROM %I.%I
      WHERE %I >= $2
        AND %I <= $3
        AND %I IN (
          SELECT sa.user_id 
          FROM shift_assignments sa 
          WHERE sa.organization_id = $1 
            AND sa.status = 'active' 
            AND sa.is_primary_position = true
        )
        AND %I IS NOT NULL
      GROUP BY %I
      $q$,
      v_config.user_id_column,
      v_config.activity_type,
      CASE WHEN v_config.count_column = '*' THEN '*' ELSE quote_ident(v_config.count_column) END,
      v_config.source_schema,
      v_config.source_table,
      v_config.timestamp_column,
      v_config.timestamp_column,
      v_config.user_id_column,
      v_config.user_id_column,
      v_config.user_id_column
    );
    
    v_query := regexp_replace(v_query, 'GROUP BY', v_org_filter || ' GROUP BY');
    
    IF v_config.where_conditions IS NOT NULL AND v_config.where_conditions != '{}'::jsonb THEN
      IF v_config.where_conditions ? 'status' THEN
        v_query := regexp_replace(
          v_query, 
          'GROUP BY',
          format('AND status::TEXT = ANY(%L::text[]) GROUP BY',
            (SELECT array_agg(elem::text) FROM jsonb_array_elements_text(v_config.where_conditions->'status') elem)
          )
        );
      END IF;
      
      IF v_config.where_conditions ? 'confirmed_by' AND 
         v_config.where_conditions->>'confirmed_by' = 'IS NOT NULL' THEN
        v_query := regexp_replace(v_query, 'GROUP BY', 'AND confirmed_by IS NOT NULL GROUP BY');
      END IF;
    END IF;
    
    v_union_queries := array_append(v_union_queries, v_query);
  END LOOP;
  
  IF array_length(v_union_queries, 1) > 0 THEN
    v_final_query := array_to_string(v_union_queries, ' UNION ALL ');
    
    RETURN QUERY EXECUTE v_final_query
      USING p_organization_id, p_start_date, p_end_date;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_dynamic_productivity_counts(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- =========================================================================
-- PART 3: Update get_team_productivity_counts (wrapper function)
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
  RETURN QUERY
  WITH dynamic_counts AS (
    SELECT 
      dc.user_id,
      dc.activity_type,
      dc.task_count
    FROM get_dynamic_productivity_counts(p_organization_id, p_start_date, p_end_date) dc
  ),
  mapped_counts AS (
    SELECT
      dc.user_id,
      CASE WHEN dc.activity_type IN ('inbound_scan') THEN dc.task_count ELSE 0 END AS inbound_scans,
      CASE WHEN dc.activity_type IN ('putaway', 'putaway_confirm') THEN dc.task_count ELSE 0 END AS put_aways,
      CASE WHEN dc.activity_type IN ('picking', 'kit_picking') THEN dc.task_count ELSE 0 END AS picking,
      CASE WHEN dc.activity_type IN ('pack') THEN dc.task_count ELSE 0 END AS packed,
      CASE WHEN dc.activity_type IN ('ship') THEN dc.task_count ELSE 0 END AS shipped,
      CASE WHEN dc.activity_type IN ('final_pack') THEN dc.task_count ELSE 0 END AS final_packed,
      CASE WHEN dc.activity_type IN ('putback') THEN dc.task_count ELSE 0 END AS putbacks,
      CASE WHEN dc.activity_type IN ('cycle_count') THEN dc.task_count ELSE 0 END AS cycle_counts,
      dc.task_count AS total
    FROM dynamic_counts dc
  )
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

-- =========================================================================
-- PART 4: Fix config data - correct area column for inbound_scan
-- =========================================================================

UPDATE activity_source_config 
SET area_column = 'scan_location'
WHERE activity_type = 'inbound_scan' 
  AND source_table = 'rr_inbound_scans'
  AND area_column = 'area';

-- Clear org_id column for kit_picking since RR_Kitting_DATA doesn't have it
UPDATE activity_source_config 
SET organization_id_column = NULL
WHERE activity_type = 'kit_picking' 
  AND source_table = 'RR_Kitting_DATA';
