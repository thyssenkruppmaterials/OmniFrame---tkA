-- Migration: 151_fix_role_hierarchy_conflict.sql
-- Description: Fix role_hierarchy naming conflict (TABLE vs VIEW)
-- Created: January 27, 2026
-- Part of: Comprehensive Authentication Security Overhaul - Phase 7
--
-- ISSUE: Migration 006 creates role_hierarchy as a VIEW (using recursive CTE)
--        Migration 031 creates role_hierarchy as a TABLE (join table approach)
--        These conflict with each other.
--
-- RESOLUTION: The VIEW approach from 006 is preferred because:
--   1. It uses the parent_role_id column on roles table (single source of truth)
--   2. It automatically reflects changes to role relationships
--   3. It provides hierarchy depth calculation via recursive CTE
--
-- The TABLE approach from 031 is redundant since parent_role_id exists on roles.

-- ============================================================================
-- Step 0: Ensure parent_role_id and priority columns exist on roles table
-- These columns are required for the role hierarchy feature
-- ============================================================================
DO $$
BEGIN
    -- Add parent_role_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'roles' 
        AND column_name = 'parent_role_id'
    ) THEN
        ALTER TABLE roles ADD COLUMN parent_role_id UUID REFERENCES roles(id);
        RAISE NOTICE 'Added parent_role_id column to roles table';
    ELSE
        RAISE NOTICE 'parent_role_id column already exists on roles table';
    END IF;
    
    -- Add priority column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'roles' 
        AND column_name = 'priority'
    ) THEN
        ALTER TABLE roles ADD COLUMN priority INTEGER DEFAULT 0;
        RAISE NOTICE 'Added priority column to roles table';
    ELSE
        RAISE NOTICE 'priority column already exists on roles table';
    END IF;
END $$;

-- ============================================================================
-- Step 1: Check if role_hierarchy exists and determine its type
-- ============================================================================
DO $$
DECLARE
    obj_type text;
    obj_exists boolean;
BEGIN
    -- Check if role_hierarchy exists
    SELECT EXISTS(
        SELECT 1 
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'role_hierarchy' AND n.nspname = 'public'
    ) INTO obj_exists;
    
    IF NOT obj_exists THEN
        RAISE NOTICE 'role_hierarchy does not exist - will be created as VIEW';
    ELSE
        -- Determine the object type
        SELECT 
            CASE 
                WHEN c.relkind = 'v' THEN 'view'
                WHEN c.relkind = 'r' THEN 'table'
                WHEN c.relkind = 'm' THEN 'materialized_view'
                ELSE 'other'
            END INTO obj_type
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'role_hierarchy' AND n.nspname = 'public';
        
        IF obj_type = 'view' THEN
            RAISE NOTICE 'role_hierarchy is already a VIEW - this is correct, will recreate for consistency';
        ELSIF obj_type = 'table' THEN
            RAISE WARNING 'role_hierarchy is a TABLE - dropping and recreating as VIEW';
            
            -- First, drop any RLS policies on the table
            DROP POLICY IF EXISTS "Role hierarchy viewable by admin" ON role_hierarchy;
            DROP POLICY IF EXISTS "Role hierarchy manageable by superadmin" ON role_hierarchy;
            
            -- Drop any triggers
            DROP TRIGGER IF EXISTS update_role_hierarchy_updated_at ON role_hierarchy;
            
            -- Drop the table
            DROP TABLE IF EXISTS role_hierarchy CASCADE;
            
            RAISE NOTICE 'TABLE role_hierarchy dropped successfully';
        ELSIF obj_type = 'materialized_view' THEN
            RAISE WARNING 'role_hierarchy is a MATERIALIZED VIEW - dropping and recreating as VIEW';
            DROP MATERIALIZED VIEW IF EXISTS role_hierarchy CASCADE;
        ELSE
            RAISE WARNING 'role_hierarchy is of unknown type (%) - dropping', obj_type;
            EXECUTE 'DROP ' || obj_type || ' IF EXISTS role_hierarchy CASCADE';
        END IF;
    END IF;
END $$;

-- ============================================================================
-- Step 2: Recreate the VIEW (idempotent using CREATE OR REPLACE)
-- ============================================================================
CREATE OR REPLACE VIEW role_hierarchy AS
WITH RECURSIVE role_tree AS (
    -- Base case: root roles (no parent)
    SELECT 
        id, 
        name, 
        parent_role_id, 
        display_name,
        priority,
        0 as level,
        ARRAY[id] as path,
        ARRAY[name::text] as name_path
    FROM roles
    WHERE parent_role_id IS NULL AND is_active = true
    
    UNION ALL
    
    -- Recursive case: child roles
    SELECT 
        r.id, 
        r.name, 
        r.parent_role_id, 
        r.display_name,
        r.priority,
        rt.level + 1,
        rt.path || r.id,
        rt.name_path || r.name::text
    FROM roles r
    JOIN role_tree rt ON r.parent_role_id = rt.id
    WHERE r.is_active = true
        AND NOT r.id = ANY(rt.path)  -- Prevent cycles
        AND rt.level < 10            -- Prevent infinite recursion
)
SELECT 
    id,
    name,
    parent_role_id,
    display_name,
    priority,
    level,
    path,
    name_path,
    array_length(path, 1) as depth
FROM role_tree
ORDER BY level, priority, name;

-- ============================================================================
-- Step 3: Grant permissions on the VIEW
-- ============================================================================
GRANT SELECT ON role_hierarchy TO authenticated;
GRANT SELECT ON role_hierarchy TO service_role;

-- ============================================================================
-- Step 4: Add documentation
-- ============================================================================
COMMENT ON VIEW role_hierarchy IS 
    'Hierarchical view of roles showing inheritance tree. '
    'Uses recursive CTE to traverse parent_role_id relationships on the roles table. '
    'Recreated by migration 151 to resolve TABLE/VIEW conflict from migrations 006 and 031.';

-- ============================================================================
-- Step 5: Create helper function to get role children (if not exists)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_role_children(target_role_id UUID)
RETURNS TABLE(
    child_role_id UUID,
    child_role_name VARCHAR,
    level INTEGER
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE children AS (
        SELECT 
            r.id as child_role_id,
            r.name as child_role_name,
            1 as level
        FROM roles r
        WHERE r.parent_role_id = target_role_id AND r.is_active = true
        
        UNION ALL
        
        SELECT 
            r.id,
            r.name,
            c.level + 1
        FROM roles r
        JOIN children c ON r.parent_role_id = c.child_role_id
        WHERE r.is_active = true AND c.level < 10
    )
    SELECT * FROM children
    ORDER BY level, child_role_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_role_children(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION get_role_children IS 
    'Returns all child roles for a given role, traversing the hierarchy downward.';

-- ============================================================================
-- Success notification
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE 'Migration 151: role_hierarchy conflict resolved - VIEW recreated successfully';
END $$;
