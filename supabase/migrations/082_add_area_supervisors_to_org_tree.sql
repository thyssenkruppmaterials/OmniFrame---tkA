-- =====================================================
-- Migration: 082_add_area_supervisors_to_org_tree.sql
-- Created: December 28, 2025
-- Purpose: Include area supervisors in organizational tree automatically
--          Supervisors assigned to areas don't need rate tracking for performance
-- =====================================================

-- Drop the existing function
DROP FUNCTION IF EXISTS get_organizational_tree(UUID, UUID);

-- Recreate with area supervisors included
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
    
    -- Then get the regular hierarchy tree from shift assignments
    hierarchy_tree AS (
        -- Base case: Start with root (if specified) or top-level employees
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
        
        -- Recursive case: Find direct reports
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
COMMENT ON FUNCTION get_organizational_tree IS 'Returns organizational hierarchy tree including area supervisors. Area supervisors without shift assignments are automatically included at level 1. Added is_area_supervisor flag to distinguish them.';
