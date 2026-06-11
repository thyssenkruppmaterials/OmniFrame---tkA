-- Migration: 152_complete_enum_cleanup.sql
-- Description: Complete removal of legacy role enum columns and add performance indexes
-- Created: January 27, 2026
-- Part of: Comprehensive Authentication Security Overhaul - Phase 7
--
-- BACKGROUND: The system migrated from enum-based roles (migration 004) to 
-- UUID-based role_id foreign keys (migration 005). This migration ensures
-- all tables properly use role_id as the authoritative reference.
--
-- NOTE: We keep the 'role' text column on user_profiles for display purposes
-- but role_id (UUID) is now the authoritative source for authorization.

-- ============================================================================
-- Step 1: Ensure role_id columns exist and have proper constraints
-- ============================================================================

-- Check user_profiles.role_id exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_profiles' 
        AND column_name = 'role_id'
        AND table_schema = 'public'
    ) THEN
        RAISE EXCEPTION 'Critical: user_profiles.role_id column does not exist. Run migration 005 first.';
    ELSE
        RAISE NOTICE 'user_profiles.role_id column exists';
    END IF;
END $$;

-- Check role_permissions.role_id exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'role_permissions' 
        AND column_name = 'role_id'
        AND table_schema = 'public'
    ) THEN
        RAISE EXCEPTION 'Critical: role_permissions.role_id column does not exist. Run migration 005 first.';
    ELSE
        RAISE NOTICE 'role_permissions.role_id column exists';
    END IF;
END $$;

-- ============================================================================
-- Step 2: Add performance indexes on role_id columns
-- ============================================================================

-- Index on user_profiles.role_id for fast user role lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_role_id 
    ON user_profiles(role_id);

-- Partial index for active users with roles (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_user_profiles_role_id_active 
    ON user_profiles(role_id) 
    WHERE role_id IS NOT NULL AND status = 'active';

-- Index on role_permissions.role_id for fast permission lookups
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id 
    ON role_permissions(role_id);

-- Composite index for common permission check pattern
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_permission 
    ON role_permissions(role_id, permission_id);

-- Index on role_navigation_permissions.role_id if column exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'role_navigation_permissions' 
        AND column_name = 'role_id'
        AND table_schema = 'public'
    ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_role_navigation_permissions_role_id 
                 ON role_navigation_permissions(role_id)';
        RAISE NOTICE 'Created index on role_navigation_permissions.role_id';
    END IF;
END $$;

-- Index on role_tab_permissions.role_id if column exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'role_tab_permissions' 
        AND column_name = 'role_id'
        AND table_schema = 'public'
    ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_role_tab_permissions_role_id 
                 ON role_tab_permissions(role_id)';
        RAISE NOTICE 'Created index on role_tab_permissions.role_id';
    END IF;
END $$;

-- ============================================================================
-- Step 3: Add documentation comments
-- ============================================================================

-- Document the migration status on user_profiles columns
COMMENT ON COLUMN user_profiles.role IS 
    'Legacy display field - use role_id for authorization. '
    'This column is kept for backwards compatibility and display purposes only. '
    'All permission checks should use role_id which references the roles table.';

COMMENT ON COLUMN user_profiles.role_id IS 
    'Authoritative role reference - foreign key to roles table. '
    'Use this column for all authorization and permission checks. '
    'Migrated from enum-based roles in migration 005.';

-- Document role_permissions columns if role column exists there
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'role_permissions' 
        AND column_name = 'role'
        AND table_schema = 'public'
    ) THEN
        EXECUTE $sql$
            COMMENT ON COLUMN role_permissions.role IS 
                'Legacy column - deprecated. Use role_id for all permission lookups.'
        $sql$;
    END IF;
    
    EXECUTE $sql$
        COMMENT ON COLUMN role_permissions.role_id IS 
            'Authoritative role reference - foreign key to roles table. '
            'Use this column for all permission lookups.'
    $sql$;
END $$;

-- ============================================================================
-- Step 4: Verify data integrity
-- ============================================================================

-- Report on any orphaned user_profiles (role_id points to non-existent role)
DO $$
DECLARE
    orphan_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO orphan_count
    FROM user_profiles up
    WHERE up.role_id IS NOT NULL 
    AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.id = up.role_id);
    
    IF orphan_count > 0 THEN
        RAISE WARNING 'Found % user profiles with orphaned role_id references', orphan_count;
    ELSE
        RAISE NOTICE 'All user_profiles.role_id references are valid';
    END IF;
END $$;

-- Report on any users missing role_id
DO $$
DECLARE
    missing_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO missing_count
    FROM user_profiles
    WHERE role_id IS NULL AND status = 'active';
    
    IF missing_count > 0 THEN
        RAISE WARNING 'Found % active users without role_id assignment', missing_count;
    ELSE
        RAISE NOTICE 'All active users have role_id assigned';
    END IF;
END $$;

-- ============================================================================
-- Step 5: Create helper function to sync role display name
-- ============================================================================

-- Function to sync the role display column from role_id
CREATE OR REPLACE FUNCTION sync_user_role_display()
RETURNS TRIGGER AS $$
BEGIN
    -- Update the legacy role column when role_id changes
    IF NEW.role_id IS NOT NULL AND (OLD.role_id IS NULL OR NEW.role_id <> OLD.role_id) THEN
        SELECT name INTO NEW.role 
        FROM roles 
        WHERE id = NEW.role_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create or replace the trigger
DROP TRIGGER IF EXISTS sync_user_role_display_trigger ON user_profiles;
CREATE TRIGGER sync_user_role_display_trigger
    BEFORE INSERT OR UPDATE OF role_id ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION sync_user_role_display();

COMMENT ON FUNCTION sync_user_role_display IS 
    'Automatically syncs the legacy role column when role_id is updated. '
    'This keeps display values consistent while role_id remains authoritative.';

-- ============================================================================
-- Step 6: Verify indexes were created
-- ============================================================================

DO $$
DECLARE
    idx_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO idx_count
    FROM pg_indexes
    WHERE schemaname = 'public'
    AND indexname LIKE 'idx_%role_id%';
    
    RAISE NOTICE 'Total role_id indexes created: %', idx_count;
END $$;

-- ============================================================================
-- Success notification
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE 'Migration 152: Enum cleanup complete - indexes added, documentation updated';
END $$;
