-- =====================================================
-- Fix Organizational Tree Function
-- Migration: 050_fix_organizational_tree_function.sql
-- Created: October 20, 2025
-- Purpose: Fix datatype mismatch error (42804) in get_organizational_tree function
-- =====================================================

-- Drop the existing function
DROP FUNCTION IF EXISTS get_organizational_tree(UUID, UUID);

-- Recreate with proper type handling
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
    path_text TEXT  -- Changed from TEXT[] to TEXT for compatibility
) 
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE hierarchy_tree AS (
        -- Base case: Start with root (if specified) or top-level employees
        SELECT 
            sa.user_id,
            up.full_name::VARCHAR,
            up.email::VARCHAR,
            sp.position_title::VARCHAR,
            1 as level_in_tree,
            sa.direct_supervisor_id as supervisor_id,
            up.full_name::TEXT as path_text  -- Convert array to delimited text
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
            (ht.path_text || ' > ' || up.full_name)::TEXT  -- Concatenate path as text
        FROM public.shift_assignments sa
        JOIN public.user_profiles up ON sa.user_id = up.id
        LEFT JOIN public.shift_positions sp ON sa.position_id = sp.id
        JOIN hierarchy_tree ht ON sa.direct_supervisor_id = ht.user_id
        WHERE sa.organization_id = p_organization_id
            AND sa.status = 'active'
            AND sa.is_primary_position = true
    )
    SELECT 
        hierarchy_tree.user_id,
        hierarchy_tree.full_name,
        hierarchy_tree.email,
        hierarchy_tree.position_title,
        hierarchy_tree.level_in_tree,
        hierarchy_tree.supervisor_id,
        hierarchy_tree.path_text
    FROM hierarchy_tree
    ORDER BY level_in_tree, full_name;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_organizational_tree(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_organizational_tree(UUID, UUID) TO service_role;

-- Add helpful comment
COMMENT ON FUNCTION get_organizational_tree IS 'Returns organizational hierarchy tree with path as delimited text (> separator) instead of array to avoid type casting issues';

