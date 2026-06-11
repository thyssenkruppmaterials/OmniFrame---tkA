-- =========================================================================
-- Dynamic Activity Configuration Migration
-- Created: January 4, 2026
-- Purpose: Enable configuration-driven activity tracking without code changes
-- 
-- This migration creates a system where new activity types can be added
-- simply by inserting rows into configuration tables - no code updates needed.
-- =========================================================================

-- =========================================================================
-- PART 1: ACTIVITY SOURCE CONFIGURATION TABLE
-- Defines which database tables contribute to activity tracking
-- =========================================================================

CREATE TABLE IF NOT EXISTS activity_source_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Activity identification
  activity_type TEXT NOT NULL,           -- e.g., 'inbound_scan', 'picking', 'custom_task'
  activity_label TEXT NOT NULL,          -- Display name: 'Scanning', 'Picking', 'Quality Check'
  activity_description TEXT,             -- Detailed description for tooltips
  
  -- Source table configuration
  source_table TEXT NOT NULL,            -- e.g., 'rr_inbound_scans', 'outbound_to_data'
  source_schema TEXT DEFAULT 'public',   -- Schema name (usually 'public')
  
  -- Column mappings (which columns to use from source table)
  user_id_column TEXT NOT NULL,          -- Column containing user ID: 'scanned_by', 'picked_by'
  timestamp_column TEXT NOT NULL,        -- Column for event time: 'scanned_at', 'picked_at'
  organization_id_column TEXT DEFAULT 'organization_id',  -- Column for org filtering
  area_column TEXT,                      -- Optional: column for work area: 'area', 'location'
  area_fallback TEXT,                    -- Default area if column is null: 'Receiving', 'Shipping'
  
  -- Optional filters (JSON format for flexibility)
  -- Example: {"status": ["completed", "approved"], "is_active": true}
  where_conditions JSONB DEFAULT '{}',
  
  -- Count configuration (for productivity counts)
  count_enabled BOOLEAN DEFAULT true,    -- Include in productivity counts
  count_column TEXT DEFAULT '*',         -- What to count: '*' or specific column
  
  -- Display configuration
  display_color TEXT NOT NULL,           -- Tailwind color class: 'sky-500', 'emerald-500'
  display_icon TEXT,                     -- Optional icon identifier
  display_order INTEGER DEFAULT 100,     -- Sort order in UI (lower = first)
  
  -- Categorization
  activity_category TEXT DEFAULT 'work', -- 'work', 'admin', 'quality', 'maintenance'
  department TEXT,                       -- Optional department association
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,       -- System-defined (not editable by users)
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  
  -- Ensure unique activity types per organization (or global if org is null)
  UNIQUE(organization_id, activity_type)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_activity_source_config_org 
  ON activity_source_config(organization_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_activity_source_config_type 
  ON activity_source_config(activity_type) WHERE is_active = true;

-- Enable RLS
ALTER TABLE activity_source_config ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "activity_source_config_select" ON activity_source_config
  FOR SELECT TO authenticated
  USING (
    organization_id IS NULL  -- Global configs visible to all
    OR organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "activity_source_config_admin" ON activity_source_config
  FOR ALL TO authenticated
  USING (
    is_system = false  -- Can't modify system configs
    AND organization_id IN (
      SELECT organization_id FROM user_profiles 
      WHERE id = auth.uid() 
      AND role IN ('superadmin', 'admin')
    )
  );

-- =========================================================================
-- PART 2: ACTIVITY DISPLAY CONFIGURATION TABLE
-- UI display settings that can be customized per organization
-- =========================================================================

CREATE TABLE IF NOT EXISTS activity_display_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  
  activity_type TEXT NOT NULL,
  
  -- Display properties (override defaults from source config)
  label_override TEXT,
  color_override TEXT,
  icon_override TEXT,
  
  -- Timeline display
  show_on_timeline BOOLEAN DEFAULT true,
  show_in_summary BOOLEAN DEFAULT true,
  show_in_breakdown BOOLEAN DEFAULT true,
  
  -- Gantt chart styling
  gantt_bg_class TEXT,           -- e.g., 'bg-sky-500'
  gantt_hover_class TEXT,        -- e.g., 'hover:bg-sky-400'
  gantt_text_class TEXT,         -- e.g., 'text-white'
  gantt_min_width_percent NUMERIC(5,2) DEFAULT 0.3,
  
  -- Efficiency calculation
  include_in_efficiency BOOLEAN DEFAULT true,
  efficiency_weight NUMERIC(5,2) DEFAULT 1.0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id, activity_type)
);

-- Enable RLS
ALTER TABLE activity_display_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_display_config_select" ON activity_display_config
  FOR SELECT TO authenticated
  USING (
    organization_id IS NULL
    OR organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "activity_display_config_admin" ON activity_display_config
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles 
      WHERE id = auth.uid() 
      AND role IN ('superadmin', 'admin')
    )
  );

-- =========================================================================
-- PART 3: SEED DEFAULT ACTIVITY CONFIGURATIONS
-- Pre-populate with the existing activity types
-- =========================================================================

INSERT INTO activity_source_config (
  organization_id, activity_type, activity_label, source_table, 
  user_id_column, timestamp_column, area_column, area_fallback,
  display_color, display_order, activity_category, is_system
) VALUES
  -- Inbound Scanning
  (NULL, 'inbound_scan', 'Scanning', 'rr_inbound_scans',
   'scanned_by', 'scanned_at', 'area', 'Receiving',
   'sky-500', 10, 'work', true),
  
  -- Putaway (created_by)
  (NULL, 'putaway', 'Putaway', 'rf_putaway_operations',
   'created_by', 'created_at', 'shelf_location', 'Putaway',
   'violet-500', 20, 'work', true),
  
  -- Putaway (confirmed_by - separate config for different user)
  (NULL, 'putaway_confirm', 'Putaway Confirm', 'rf_putaway_operations',
   'confirmed_by', 'confirmed_at', 'shelf_location', 'Putaway',
   'violet-500', 21, 'work', true),
  
  -- Picking
  (NULL, 'picking', 'Picking', 'outbound_to_data',
   'picked_by', 'picked_at', NULL, 'Picking',
   'emerald-500', 30, 'work', true),
  
  -- Packing
  (NULL, 'pack', 'Packing', 'outbound_to_data',
   'packed_by', 'packed_at', NULL, 'Packing',
   'orange-500', 40, 'work', true),
  
  -- Shipping
  (NULL, 'ship', 'Shipping', 'outbound_to_data',
   'shipped_by', 'shipped_at', NULL, 'Shipping',
   'cyan-500', 50, 'work', true),
  
  -- Final Pack
  (NULL, 'final_pack', 'Final Pack', 'outbound_to_data',
   'final_packed_by', 'final_packed_at', NULL, 'Final Pack',
   'amber-500', 45, 'work', true),
  
  -- Putback
  (NULL, 'putback', 'Putback', 'putback_tickets',
   'created_by', 'created_at', NULL, 'Putback',
   'rose-500', 60, 'work', true),
  
  -- Cycle Count
  (NULL, 'cycle_count', 'Counting', 'rr_cyclecount_data',
   'assigned_to', 'completed_at', NULL, 'Inventory',
   'indigo-500', 70, 'work', true)
   
ON CONFLICT (organization_id, activity_type) DO NOTHING;

-- Add where_conditions for cycle count (requires specific statuses)
UPDATE activity_source_config 
SET where_conditions = '{"status": ["completed", "approved"]}'::jsonb
WHERE activity_type = 'cycle_count' AND organization_id IS NULL;

-- Add where_conditions for putaway_confirm (requires non-null confirmed_by)
UPDATE activity_source_config 
SET where_conditions = '{"confirmed_by": "IS NOT NULL"}'::jsonb
WHERE activity_type = 'putaway_confirm' AND organization_id IS NULL;

-- =========================================================================
-- PART 4: DYNAMIC ACTIVITY EVENTS RPC FUNCTION
-- Reads configuration and dynamically builds the query
-- =========================================================================

CREATE OR REPLACE FUNCTION get_dynamic_activity_events(
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
    v_query := format(
      $q$
      SELECT 
        %I::UUID AS user_id,
        %L::TEXT AS event_type,
        %I::TIMESTAMPTZ AS event_timestamp,
        COALESCE(%s, %L)::TEXT AS area,
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

GRANT EXECUTE ON FUNCTION get_dynamic_activity_events(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- =========================================================================
-- PART 5: DYNAMIC PRODUCTIVITY COUNTS RPC FUNCTION
-- Reads configuration and dynamically counts activities
-- =========================================================================

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
BEGIN
  -- Get active configurations that should be counted
  FOR v_config IN 
    SELECT 
      asc.activity_type,
      asc.source_table,
      asc.source_schema,
      asc.user_id_column,
      asc.timestamp_column,
      asc.organization_id_column,
      asc.where_conditions,
      asc.count_column
    FROM activity_source_config asc
    WHERE asc.is_active = true
      AND asc.count_enabled = true
      AND (asc.organization_id IS NULL OR asc.organization_id = p_organization_id)
  LOOP
    -- Build count query for this activity source
    v_query := format(
      $q$
      SELECT 
        %I::UUID AS user_id,
        %L::TEXT AS activity_type,
        COUNT(%s)::BIGINT AS task_count
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
      GROUP BY %I
      $q$,
      v_config.user_id_column,                    -- SELECT user_id
      v_config.activity_type,                      -- activity_type literal
      CASE WHEN v_config.count_column = '*' THEN '*' ELSE quote_ident(v_config.count_column) END,
      v_config.source_schema,
      v_config.source_table,
      v_config.organization_id_column,
      v_config.timestamp_column,
      v_config.timestamp_column,
      v_config.user_id_column,
      v_config.user_id_column,
      v_config.user_id_column                     -- GROUP BY
    );
    
    -- Add custom where conditions
    IF v_config.where_conditions IS NOT NULL AND v_config.where_conditions != '{}'::jsonb THEN
      IF v_config.where_conditions ? 'status' THEN
        v_query := regexp_replace(
          v_query, 
          'GROUP BY',
          format('AND status = ANY(%L::text[]) GROUP BY',
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
  
  -- Combine all queries
  IF array_length(v_union_queries, 1) > 0 THEN
    v_final_query := array_to_string(v_union_queries, ' UNION ALL ');
    
    RETURN QUERY EXECUTE v_final_query
      USING p_organization_id, p_start_date, p_end_date;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_dynamic_productivity_counts(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- =========================================================================
-- PART 6: HELPER FUNCTION TO GET ACTIVITY CONFIGURATIONS
-- Returns all active configurations for the frontend
-- =========================================================================

CREATE OR REPLACE FUNCTION get_activity_configurations(
  p_organization_id UUID
)
RETURNS TABLE (
  activity_type TEXT,
  activity_label TEXT,
  activity_description TEXT,
  display_color TEXT,
  display_order INTEGER,
  activity_category TEXT,
  gantt_bg_class TEXT,
  gantt_hover_class TEXT,
  gantt_text_class TEXT,
  show_on_timeline BOOLEAN,
  show_in_summary BOOLEAN,
  include_in_efficiency BOOLEAN,
  efficiency_weight NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    asc.activity_type,
    COALESCE(adc.label_override, asc.activity_label) AS activity_label,
    asc.activity_description,
    COALESCE(adc.color_override, asc.display_color) AS display_color,
    asc.display_order,
    asc.activity_category,
    COALESCE(adc.gantt_bg_class, 'bg-' || asc.display_color) AS gantt_bg_class,
    COALESCE(adc.gantt_hover_class, 'hover:bg-' || replace(asc.display_color, '-500', '-400')) AS gantt_hover_class,
    COALESCE(adc.gantt_text_class, 'text-white') AS gantt_text_class,
    COALESCE(adc.show_on_timeline, true) AS show_on_timeline,
    COALESCE(adc.show_in_summary, true) AS show_in_summary,
    COALESCE(adc.include_in_efficiency, true) AS include_in_efficiency,
    COALESCE(adc.efficiency_weight, 1.0) AS efficiency_weight
  FROM activity_source_config asc
  LEFT JOIN activity_display_config adc 
    ON adc.activity_type = asc.activity_type
    AND (adc.organization_id = p_organization_id OR adc.organization_id IS NULL)
  WHERE asc.is_active = true
    AND (asc.organization_id IS NULL OR asc.organization_id = p_organization_id)
  ORDER BY asc.display_order, asc.activity_type;
END;
$$;

GRANT EXECUTE ON FUNCTION get_activity_configurations(UUID) TO authenticated;

-- =========================================================================
-- PART 7: ADMIN FUNCTION TO ADD NEW ACTIVITY SOURCE
-- Makes it easy to add new activity types through a function call
-- =========================================================================

CREATE OR REPLACE FUNCTION add_activity_source(
  p_organization_id UUID,
  p_activity_type TEXT,
  p_activity_label TEXT,
  p_source_table TEXT,
  p_user_id_column TEXT,
  p_timestamp_column TEXT,
  p_display_color TEXT,
  p_area_column TEXT DEFAULT NULL,
  p_area_fallback TEXT DEFAULT 'Other',
  p_where_conditions JSONB DEFAULT '{}',
  p_activity_category TEXT DEFAULT 'work',
  p_display_order INTEGER DEFAULT 100,
  p_activity_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Verify caller has admin permissions
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE id = auth.uid() 
    AND role IN ('superadmin', 'admin')
    AND (organization_id = p_organization_id OR p_organization_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to add activity source';
  END IF;
  
  -- Verify the source table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = p_source_table
  ) THEN
    RAISE EXCEPTION 'Source table % does not exist', p_source_table;
  END IF;
  
  -- Verify the columns exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = p_source_table 
    AND column_name = p_user_id_column
  ) THEN
    RAISE EXCEPTION 'User ID column % does not exist in table %', p_user_id_column, p_source_table;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = p_source_table 
    AND column_name = p_timestamp_column
  ) THEN
    RAISE EXCEPTION 'Timestamp column % does not exist in table %', p_timestamp_column, p_source_table;
  END IF;
  
  -- Insert the configuration
  INSERT INTO activity_source_config (
    organization_id,
    activity_type,
    activity_label,
    activity_description,
    source_table,
    user_id_column,
    timestamp_column,
    area_column,
    area_fallback,
    where_conditions,
    display_color,
    display_order,
    activity_category,
    created_by
  ) VALUES (
    p_organization_id,
    p_activity_type,
    p_activity_label,
    p_activity_description,
    p_source_table,
    p_user_id_column,
    p_timestamp_column,
    p_area_column,
    p_area_fallback,
    p_where_conditions,
    p_display_color,
    p_display_order,
    p_activity_category,
    auth.uid()
  )
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION add_activity_source(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, INTEGER, TEXT) TO authenticated;

-- =========================================================================
-- PART 8: HELPER FUNCTIONS FOR FRONTEND TABLE DISCOVERY
-- =========================================================================

-- Function to get available tables that could be activity sources
CREATE OR REPLACE FUNCTION get_available_activity_tables()
RETURNS TABLE (
  table_name TEXT,
  columns JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.table_name::TEXT,
    jsonb_agg(
      jsonb_build_object(
        'column_name', c.column_name,
        'data_type', c.data_type,
        'is_nullable', c.is_nullable = 'YES'
      )
      ORDER BY c.ordinal_position
    ) AS columns
  FROM information_schema.tables t
  JOIN information_schema.columns c ON c.table_name = t.table_name AND c.table_schema = t.table_schema
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND t.table_name NOT LIKE 'pg_%'
    AND t.table_name NOT LIKE '_prisma_%'
    -- Focus on tables likely to have activity data
    AND EXISTS (
      SELECT 1 FROM information_schema.columns ic
      WHERE ic.table_name = t.table_name
        AND ic.table_schema = t.table_schema
        AND ic.data_type IN ('uuid', 'timestamp with time zone', 'timestamp without time zone')
    )
  GROUP BY t.table_name
  ORDER BY t.table_name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_available_activity_tables() TO authenticated;

-- Function to get columns for a specific table
CREATE OR REPLACE FUNCTION get_table_columns(p_table_name TEXT)
RETURNS TABLE (
  column_name TEXT,
  data_type TEXT,
  is_nullable BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.column_name::TEXT,
    c.data_type::TEXT,
    (c.is_nullable = 'YES') AS is_nullable
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = p_table_name
  ORDER BY c.ordinal_position;
END;
$$;

GRANT EXECUTE ON FUNCTION get_table_columns(TEXT) TO authenticated;

-- =========================================================================
-- PART 9: COMMENTS FOR DOCUMENTATION
-- =========================================================================

COMMENT ON TABLE activity_source_config IS 
'Configuration table defining which database tables and columns contribute to activity tracking. 
Add new activity types by inserting rows here - no code changes required.';

COMMENT ON TABLE activity_display_config IS 
'Per-organization display customizations for activity types. Overrides defaults from activity_source_config.';

COMMENT ON FUNCTION get_dynamic_activity_events IS 
'Dynamically queries all configured activity sources and returns unified event stream for timeline visualization.';

COMMENT ON FUNCTION get_dynamic_productivity_counts IS 
'Dynamically counts activities from all configured sources grouped by user.';

COMMENT ON FUNCTION get_activity_configurations IS 
'Returns all active activity configurations with display settings for frontend rendering.';

COMMENT ON FUNCTION add_activity_source IS 
'Admin function to add new activity sources. Validates table and column existence before adding.';

-- =========================================================================
-- EXAMPLE: How to add a new activity type (Quality Inspection)
-- =========================================================================
/*
-- Example: Add a new "Quality Inspection" activity type
-- First, ensure your table exists with required columns:
-- - organization_id (UUID)
-- - inspector_id or similar user ID column (UUID)
-- - inspected_at or similar timestamp column (TIMESTAMPTZ)

SELECT add_activity_source(
  p_organization_id := NULL,  -- NULL for global, or specific org UUID
  p_activity_type := 'quality_inspection',
  p_activity_label := 'Quality Check',
  p_source_table := 'quality_inspections',
  p_user_id_column := 'inspector_id',
  p_timestamp_column := 'inspected_at',
  p_display_color := 'teal-500',
  p_area_column := 'inspection_area',
  p_area_fallback := 'Quality',
  p_where_conditions := '{"status": ["passed", "failed"]}'::jsonb,
  p_activity_category := 'quality',
  p_display_order := 55,
  p_activity_description := 'Quality control inspections'
);

-- Or insert directly:
INSERT INTO activity_source_config (
  organization_id,
  activity_type,
  activity_label,
  source_table,
  user_id_column,
  timestamp_column,
  display_color,
  area_fallback,
  activity_category
) VALUES (
  NULL,
  'loading',
  'Loading',
  'truck_loading_events',
  'loaded_by',
  'loaded_at',
  'lime-500',
  'Dock',
  'work'
);
*/
