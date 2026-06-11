-- =====================================================
-- Add Onboarding Navigation Item
-- Migration: 079_add_onboarding_navigation.sql
-- Created: December 22, 2025
-- Purpose: Add Onboarding sub-menu item under Role Management
-- =====================================================

-- Get the Role Management parent navigation item ID
DO $$
DECLARE
    v_role_management_id UUID;
    v_onboarding_id UUID;
BEGIN
    -- Find Role Management parent item
    SELECT id INTO v_role_management_id
    FROM navigation_items
    WHERE name = 'role_management' OR title = 'Role Management'
    LIMIT 1;
    
    -- If Role Management doesn't exist, create it first
    IF v_role_management_id IS NULL THEN
        INSERT INTO navigation_items (name, title, url, icon, parent_id, position)
        VALUES ('role_management', 'Role Management', NULL, 'IconUsersGroup', NULL, 50)
        RETURNING id INTO v_role_management_id;
    END IF;
    
    -- Check if Onboarding navigation item already exists
    SELECT id INTO v_onboarding_id
    FROM navigation_items
    WHERE name = 'employee_onboarding'
    LIMIT 1;
    
    -- Create Onboarding navigation item if it doesn't exist
    IF v_onboarding_id IS NULL THEN
        INSERT INTO navigation_items (name, title, url, icon, parent_id, position)
        VALUES (
            'employee_onboarding',
            'Onboarding',
            '/admin/onboarding',
            'IconUserPlus',
            v_role_management_id,
            30  -- After Roles (10) and User Management (20)
        )
        RETURNING id INTO v_onboarding_id;
        
        RAISE NOTICE 'Created Onboarding navigation item with ID: %', v_onboarding_id;
    ELSE
        RAISE NOTICE 'Onboarding navigation item already exists with ID: %', v_onboarding_id;
    END IF;
    
    -- Create navigation permissions for all roles that have access to Role Management
    -- This ensures admins, managers, and superadmins can see the Onboarding menu item
    INSERT INTO role_navigation_permissions (role_id, navigation_item_id, visible, role)
    SELECT r.id, v_onboarding_id, 
           CASE 
               WHEN r.name IN ('superadmin', 'admin', 'manager') THEN true 
               ELSE false 
           END,
           r.name::user_role
    FROM roles r
    WHERE NOT EXISTS (
        SELECT 1 FROM role_navigation_permissions rnp
        WHERE rnp.role_id = r.id AND rnp.navigation_item_id = v_onboarding_id
    )
    ON CONFLICT DO NOTHING;
    
    RAISE NOTICE 'Created navigation permissions for Onboarding';
END $$;

-- Add comment for documentation
COMMENT ON TABLE navigation_items IS 'Sidebar navigation items with hierarchical structure. Updated December 22, 2025 to include Employee Onboarding under Role Management.';

