-- =====================================================
-- Migration: fix_org_tree_area_supervisor_subordinates.sql
-- Created: December 29, 2025
-- Purpose: Fix organizational tree to include employees who report to area supervisors
--          Previously, employees whose supervisor was an area supervisor (without shift assignment)
--          were not appearing because the recursive CTE couldn't find their supervisor
-- =====================================================

-- Drop the existing function
DROP FUNCTION IF EXISTS get_organizational_tree(UUID, UUID);

-- Recreate with fixed logic for area supervisor subordinates
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
    -- Identify area supervisors (primary or backup) who don't have shift assignments
    area_supervisor_ids AS (
        SELECT DISTINCT up.id as sup_id
        FROM public.working_areas wa
        JOIN public.user_profiles up ON (wa.primary_supervisor_id = up.id OR wa.backup_supervisor_id = up.id)
        WHERE wa.organization_id = p_organization_id
            AND wa.is_active = true
            AND NOT EXISTS (
                SELECT 1 FROM public.shift_assignments sa
                WHERE sa.user_id = up.id
                    AND sa.organization_id = p_organization_id
                    AND sa.status = 'active'
                    AND sa.is_primary_position = true
            )
    ),
    
    -- Build hierarchy tree with area supervisors as roots
    hierarchy_tree AS (
        -- NON-RECURSIVE PART: All root nodes (area supervisors + top-level employees)
        
        -- Area supervisors at level 1
        SELECT 
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
        FROM area_supervisor_ids asi
        JOIN public.user_profiles up ON up.id = asi.sup_id
        WHERE p_root_user_id IS NULL OR up.id = p_root_user_id
        
        UNION ALL
        
        -- Top-level employees with no supervisor (only when not filtering by root_user_id)
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
            AND sa.direct_supervisor_id IS NULL
            AND (p_root_user_id IS NULL OR sa.user_id = p_root_user_id)
        
        UNION ALL
        
        -- RECURSIVE PART: Find all direct reports of nodes already in the tree
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
        INNER JOIN hierarchy_tree ht ON sa.direct_supervisor_id = ht.user_id
        WHERE sa.organization_id = p_organization_id
            AND sa.status = 'active'
            AND sa.is_primary_position = true
    )
    
    -- Return deduplicated results ordered properly
    SELECT DISTINCT ON (ht2.user_id)
        ht2.user_id,
        ht2.full_name,
        ht2.email,
        ht2.position_title,
        ht2.level_in_tree,
        ht2.supervisor_id,
        ht2.path_text,
        ht2.is_area_supervisor
    FROM hierarchy_tree ht2
    ORDER BY ht2.user_id, ht2.level_in_tree;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_organizational_tree(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_organizational_tree(UUID, UUID) TO service_role;

-- Add helpful comment
COMMENT ON FUNCTION get_organizational_tree IS 'Returns organizational hierarchy tree including area supervisors and their subordinates. Area supervisors without shift assignments are included at level 1, and employees reporting to them are properly included at level 2+. Fixed December 29, 2025.';
