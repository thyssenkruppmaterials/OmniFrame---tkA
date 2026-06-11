-- =====================================================
-- Migration: 084_fix_team_lead_hierarchy.sql
-- Created: December 29, 2025
-- Purpose: Fix Team Lead hierarchy - Team Leads (backup supervisors) should report to
--          the Primary Supervisor of their area and display as "Area Lead" not "Area Supervisor"
-- =====================================================

-- Drop the existing function
DROP FUNCTION IF EXISTS get_organizational_tree(UUID, UUID);

-- Recreate with proper Team Lead hierarchy
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
    -- Get PRIMARY supervisors only (these are the top-level area supervisors)
    primary_supervisors AS (
        SELECT DISTINCT
            up.id as user_id,
            up.full_name::VARCHAR,
            up.email::VARCHAR,
            COALESCE(
                (SELECT string_agg('Primary Supervisor - ' || wa2.area_name, ', ') 
                FROM public.working_areas wa2 
                WHERE wa2.primary_supervisor_id = up.id
                    AND wa2.organization_id = p_organization_id
                    AND wa2.is_active = true),
                'Area Supervisor'
            )::VARCHAR as position_title,
            1 as level_in_tree,
            NULL::UUID as supervisor_id,
            up.full_name::TEXT as path_text,
            true as is_area_supervisor
        FROM public.working_areas wa
        JOIN public.user_profiles up ON wa.primary_supervisor_id = up.id
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
    
    -- Get BACKUP supervisors (Team Leads) who report to Primary Supervisors
    -- These are at level 2 and their supervisor is the primary supervisor of their area
    team_leads AS (
        SELECT DISTINCT
            up.id as user_id,
            up.full_name::VARCHAR,
            up.email::VARCHAR,
            COALESCE(
                (SELECT string_agg('Area Lead - ' || wa2.area_name, ', ') 
                FROM public.working_areas wa2 
                WHERE wa2.backup_supervisor_id = up.id
                    AND wa2.organization_id = p_organization_id
                    AND wa2.is_active = true),
                'Area Lead'
            )::VARCHAR as position_title,
            2 as level_in_tree,
            -- Team lead reports to the primary supervisor of their area
            (SELECT wa3.primary_supervisor_id 
             FROM public.working_areas wa3 
             WHERE wa3.backup_supervisor_id = up.id 
                AND wa3.organization_id = p_organization_id 
                AND wa3.is_active = true 
             LIMIT 1) as supervisor_id,
            -- Build path with supervisor name
            (SELECT ps.full_name || ' > ' || up.full_name 
             FROM public.working_areas wa3 
             JOIN public.user_profiles ps ON wa3.primary_supervisor_id = ps.id
             WHERE wa3.backup_supervisor_id = up.id 
                AND wa3.organization_id = p_organization_id 
                AND wa3.is_active = true 
             LIMIT 1)::TEXT as path_text,
            false as is_area_supervisor  -- Team leads are NOT area supervisors, they are "Area Leads"
        FROM public.working_areas wa
        JOIN public.user_profiles up ON wa.backup_supervisor_id = up.id
        WHERE wa.organization_id = p_organization_id
            AND wa.is_active = true
            -- Only include if there IS a primary supervisor to report to
            AND wa.primary_supervisor_id IS NOT NULL
            -- Exclude users who already have a shift assignment (they'll appear through assignments)
            AND NOT EXISTS (
                SELECT 1 FROM public.shift_assignments sa
                WHERE sa.user_id = up.id
                    AND sa.organization_id = p_organization_id
                    AND sa.status = 'active'
                    AND sa.is_primary_position = true
            )
    ),
    
    -- Get all area-level user IDs (both primary supervisors and team leads) for lookup
    area_level_ids AS (
        SELECT primary_supervisors.user_id FROM primary_supervisors
        UNION
        SELECT team_leads.user_id FROM team_leads
    ),
    
    -- The hierarchy tree that includes:
    -- 1. Top-level employees (no supervisor) 
    -- 2. Employees whose supervisor is a primary supervisor or team lead (start at appropriate level)
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
        
        -- Base case 2: Employees whose supervisor is a PRIMARY supervisor (start at level 2)
        SELECT 
            sa.user_id,
            up.full_name::VARCHAR,
            up.email::VARCHAR,
            sp.position_title::VARCHAR,
            2 as level_in_tree,
            sa.direct_supervisor_id as supervisor_id,
            (psup.full_name || ' > ' || up.full_name)::TEXT as path_text,
            false as is_area_supervisor
        FROM public.shift_assignments sa
        JOIN public.user_profiles up ON sa.user_id = up.id
        LEFT JOIN public.shift_positions sp ON sa.position_id = sp.id
        JOIN primary_supervisors psup ON sa.direct_supervisor_id = psup.user_id
        WHERE sa.organization_id = p_organization_id
            AND sa.status = 'active'
            AND sa.is_primary_position = true
            AND p_root_user_id IS NULL  -- Only include when not filtering by root
        
        UNION ALL
        
        -- Base case 3: Employees whose supervisor is a TEAM LEAD (start at level 3)
        SELECT 
            sa.user_id,
            up.full_name::VARCHAR,
            up.email::VARCHAR,
            sp.position_title::VARCHAR,
            3 as level_in_tree,
            sa.direct_supervisor_id as supervisor_id,
            (tlead.path_text || ' > ' || up.full_name)::TEXT as path_text,
            false as is_area_supervisor
        FROM public.shift_assignments sa
        JOIN public.user_profiles up ON sa.user_id = up.id
        LEFT JOIN public.shift_positions sp ON sa.position_id = sp.id
        JOIN team_leads tlead ON sa.direct_supervisor_id = tlead.user_id
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
    
    -- Combine primary supervisors, team leads, and hierarchy tree
    combined_tree AS (
        SELECT * FROM primary_supervisors
        UNION ALL
        SELECT * FROM team_leads
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
COMMENT ON FUNCTION get_organizational_tree IS 'Returns organizational hierarchy tree with proper structure: Primary Supervisors at level 1, Team Leads (Area Leads) at level 2 reporting to Primary Supervisors, and employees at level 2+ reporting to their assigned supervisors.';
