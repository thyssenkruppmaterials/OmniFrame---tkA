-- =====================================================
-- Migration: 083_fix_org_tree_area_supervisor_subordinates.sql
-- Created: December 29, 2025
-- Purpose: Fix organizational tree to include employees whose supervisor is an area supervisor
--          The previous migration only showed area supervisors, but not their subordinates
-- =====================================================

-- Drop the existing function
DROP FUNCTION IF EXISTS get_organizational_tree(UUID, UUID);

-- Recreate with proper handling of area supervisor subordinates
CREATE OR REPLACE FUNCTION get_organizational_tree(
    p_organization_id UUID, 
    p_root_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
    user_id UUID,
    full_name VARCHAR,
    email VARCHAR,
    position_title VARCHAR,
    level_in_tree INTEGER,
    supervisor_id UUID,
    path_text TEXT,
    is_area_supervisor BOOLEAN
) 
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE
    -- First, get all users who are area supervisors (primary or backup)
    -- These are supervisors who may not have shift assignments themselves
    area_supervisors AS (
        SELECT DISTINCT
            up.id as user_id,
            up.full_name::VARCHAR,
            up.email::VARCHAR,
            COALESCE(
                (SELECT string_agg(
                    CASE 
                        WHEN wa2.primary_supervisor_id = up.id THEN 'Primary Supervisor - ' || wa2.area_name
                        WHEN wa2.backup_supervisor_id = up.id THEN 'Team Lead - ' || wa2.area_name
                    END, 
                    ', '
                ) FROM public.working_areas wa2 
                WHERE (wa2.primary_supervisor_id = up.id OR wa2.backup_supervisor_id = up.id)
                    AND wa2.organization_id = p_organization_id
                    AND wa2.is_active = true),
                'Area Supervisor'
            )::VARCHAR as position_title,
            1 as level_in_tree,
            NULL::UUID as supervisor_id,
            up.full_name::TEXT as path_text,
            true as is_area_supervisor
        FROM public.working_areas wa
        JOIN public.user_profiles up ON (wa.primary_supervisor_id = up.id OR wa.backup_supervisor_id = up.id)
        WHERE wa.organization_id = p_organization_id
            AND wa.is_active = true
            -- Exclude users who already have a shift assignment (they'll appear through assignments)
            AND NOT EXISTS (
                SELECT 1 FROM public.shift_assignments sa
                WHERE sa.user_id = up.id
                    AND sa.organization_id = p_organization_id
                    AND sa.status = 'active'
                    AND sa.is_primary_position = true
            )
    ),
    
    -- Get all area supervisor user IDs for lookup
    area_supervisor_ids AS (
        SELECT area_supervisors.user_id FROM area_supervisors
    ),
    
    -- The hierarchy tree that includes:
    -- 1. Top-level employees (no supervisor) 
    -- 2. Employees whose supervisor is an area supervisor (start at level 2)
    -- 3. Recursively, all their subordinates
    hierarchy_tree AS (
        -- Base case: Top-level employees (no supervisor)
        SELECT 
            sa.user_id,
            up.full_name::VARCHAR,
            up.email::VARCHAR,
            sp.position_title::VARCHAR,
            1 as level_in_tree,
            sa.direct_supervisor_id as supervisor_id,
            up.full_name::TEXT as path_text,
            false as is_area_supervisor
        FROM public.shift_assignments sa
        JOIN public.user_profiles up ON sa.user_id = up.id
        LEFT JOIN public.shift_positions sp ON sa.position_id = sp.id
        WHERE sa.organization_id = p_organization_id
            AND sa.status = 'active'
            AND sa.is_primary_position = true
            AND (p_root_user_id IS NULL OR sa.user_id = p_root_user_id)
            AND (p_root_user_id IS NOT NULL OR sa.direct_supervisor_id IS NULL)
        
        UNION ALL
        
        -- Base case 2: Employees whose supervisor is an area supervisor (start at level 2)
        SELECT 
            sa.user_id,
            up.full_name::VARCHAR,
            up.email::VARCHAR,
            sp.position_title::VARCHAR,
            2 as level_in_tree,
            sa.direct_supervisor_id as supervisor_id,
            (asup.full_name || ' > ' || up.full_name)::TEXT as path_text,
            false as is_area_supervisor
        FROM public.shift_assignments sa
        JOIN public.user_profiles up ON sa.user_id = up.id
        LEFT JOIN public.shift_positions sp ON sa.position_id = sp.id
        JOIN area_supervisors asup ON sa.direct_supervisor_id = asup.user_id
        WHERE sa.organization_id = p_organization_id
            AND sa.status = 'active'
            AND sa.is_primary_position = true
            AND p_root_user_id IS NULL  -- Only include when not filtering by root
        
        UNION ALL
        
        -- Recursive case: Find direct reports of employees in hierarchy_tree
        SELECT 
            sa.user_id,
            up.full_name::VARCHAR,
            up.email::VARCHAR,
            sp.position_title::VARCHAR,
            ht.level_in_tree + 1,
            sa.direct_supervisor_id,
            (ht.path_text || ' > ' || up.full_name)::TEXT,
            false as is_area_supervisor
        FROM public.shift_assignments sa
        JOIN public.user_profiles up ON sa.user_id = up.id
        LEFT JOIN public.shift_positions sp ON sa.position_id = sp.id
        JOIN hierarchy_tree ht ON sa.direct_supervisor_id = ht.user_id
        WHERE sa.organization_id = p_organization_id
            AND sa.status = 'active'
            AND sa.is_primary_position = true
    ),
    
    -- Combine area supervisors (who don't have assignments) with the hierarchy tree
    combined_tree AS (
        SELECT * FROM area_supervisors
        UNION ALL
        SELECT * FROM hierarchy_tree
    )
    
    -- Return combined results, ordered by level then name
    SELECT * FROM combined_tree
    ORDER BY level_in_tree, full_name;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_organizational_tree(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_organizational_tree(UUID, UUID) TO service_role;

-- Add helpful comment
COMMENT ON FUNCTION get_organizational_tree IS 'Returns organizational hierarchy tree including area supervisors and their subordinates. Area supervisors without shift assignments are included at level 1, and employees reporting to them appear at level 2+. Added is_area_supervisor flag to distinguish supervisor types.';
