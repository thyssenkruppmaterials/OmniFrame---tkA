-- Migration to add missing tka_associate role to the roles table
-- This role is referenced in tab permissions but may not have been created

-- Insert the tka_associate role if it doesn't exist
INSERT INTO roles (name, display_name, description, is_system, is_active)
VALUES ('tka_associate', 'TKA Associate', 'Warehouse operations associate with specific tab access', true, true)
ON CONFLICT (name) DO NOTHING;

-- Verify the role was created
DO $$
DECLARE
  tka_role_id UUID;
BEGIN
  SELECT id INTO tka_role_id FROM roles WHERE name = 'tka_associate';

  IF tka_role_id IS NOT NULL THEN
    RAISE NOTICE '✅ TKA Associate role exists with ID: %', tka_role_id;

    -- Assign tab permissions for TKA Associate (similar to existing tab permissions)
    PERFORM assign_tab_permissions_to_role(
      tka_role_id,
      ARRAY(SELECT id FROM tab_definitions WHERE tab_id IN ('overview', 'products', 'reports'))
    );

    RAISE NOTICE '✅ Tab permissions assigned to TKA Associate role';
  ELSE
    RAISE EXCEPTION '❌ Failed to create or find TKA Associate role';
  END IF;
END $$;

-- Log the migration completion
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 028_add_tka_associate_role.sql completed successfully';
END $$;
