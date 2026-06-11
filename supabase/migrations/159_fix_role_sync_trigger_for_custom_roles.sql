-- Migration: 159_fix_role_sync_trigger_for_custom_roles.sql
-- Description: Fix the sync_user_role_display trigger to handle custom roles
-- Created: January 29, 2026
-- 
-- PROBLEM: When updating a user to a custom role (e.g., "tka_supervisors"), the 
-- sync_user_role_display trigger tries to update the legacy 'role' enum column 
-- with the custom role name. This fails because custom roles are not valid enum values.
--
-- ERROR: "invalid input value for enum user_role: "tka_supervisors""
--
-- FIX: Check if the role name is a valid enum value before setting it.
-- If not, leave the role column unchanged (preserving the previous value).

-- ============================================================================
-- Step 1: Create helper function to check if a role name is a valid enum value
-- ============================================================================

CREATE OR REPLACE FUNCTION is_valid_user_role_enum(role_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    valid_roles TEXT[] := ARRAY[
        'superadmin', 'admin', 'manager', 'cashier', 'viewer',
        'tka_associate', 'inventory_specialist', 'logistics_coordinator', 'quality_specialist'
    ];
BEGIN
    RETURN role_name = ANY(valid_roles);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION is_valid_user_role_enum IS 
    'Checks if a role name is a valid user_role enum value. '
    'Custom roles not in the enum will return false.';

-- ============================================================================
-- Step 2: Update the sync_user_role_display function to handle custom roles
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_user_role_display()
RETURNS TRIGGER AS $$
DECLARE
    role_name_from_table TEXT;
BEGIN
    -- Only process if role_id actually changed
    IF NEW.role_id IS NOT NULL AND (OLD.role_id IS NULL OR NEW.role_id <> OLD.role_id) THEN
        -- Get the role name from the roles table
        SELECT name INTO role_name_from_table 
        FROM roles 
        WHERE id = NEW.role_id;
        
        -- Only update the legacy role column if:
        -- 1. We found a role name, AND
        -- 2. The role name is a valid enum value
        -- Otherwise, leave the role column unchanged to avoid enum validation errors
        IF role_name_from_table IS NOT NULL AND is_valid_user_role_enum(role_name_from_table) THEN
            NEW.role := role_name_from_table::user_role;
        ELSE
            -- For custom roles, keep the existing role value or default to 'viewer'
            -- This preserves the previous system behavior while supporting custom roles
            IF NEW.role IS NULL THEN
                NEW.role := 'viewer';
            END IF;
            -- Log that we skipped updating the role column for a custom role
            RAISE NOTICE 'Custom role detected: %. Keeping existing role column value.', role_name_from_table;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sync_user_role_display IS 
    'Automatically syncs the legacy role column when role_id is updated. '
    'For system roles (in the enum), updates the role column. '
    'For custom roles (not in enum), preserves the existing role column value. '
    'This keeps display values consistent while role_id remains authoritative. '
    'Fixed January 29, 2026 to handle custom roles without enum validation errors.';

-- ============================================================================
-- Step 3: Ensure the trigger is properly attached
-- ============================================================================

DROP TRIGGER IF EXISTS sync_user_role_display_trigger ON user_profiles;
CREATE TRIGGER sync_user_role_display_trigger
    BEFORE INSERT OR UPDATE OF role_id ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION sync_user_role_display();

-- ============================================================================
-- Step 4: Verify the fix by checking for any users with custom roles
-- ============================================================================

DO $$
DECLARE
    custom_role_count INTEGER;
BEGIN
    -- Count users who have a role_id pointing to a custom role
    SELECT COUNT(*) INTO custom_role_count
    FROM user_profiles up
    JOIN roles r ON up.role_id = r.id
    WHERE NOT is_valid_user_role_enum(r.name);
    
    IF custom_role_count > 0 THEN
        RAISE NOTICE 'Found % users with custom roles. These can now be updated without enum errors.', custom_role_count;
    ELSE
        RAISE NOTICE 'No users with custom roles found. Trigger fix is ready for future custom role assignments.';
    END IF;
END $$;

-- ============================================================================
-- Success notification
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE 'Migration 159: Fixed sync_user_role_display trigger to handle custom roles';
    RAISE NOTICE 'Custom roles like "tka_supervisors" can now be assigned without enum validation errors';
END $$;
