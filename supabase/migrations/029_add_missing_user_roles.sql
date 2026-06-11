-- Migration to add missing user roles that exist in frontend types but not in database
-- This ensures frontend TypeScript types match the database schema

-- Insert the missing system roles if they don't exist
INSERT INTO roles (name, display_name, description, is_system, is_active)
VALUES 
  ('inventory_specialist', 'Inventory Specialist', 'Specialized role for inventory management and tracking operations', true, true),
  ('logistics_coordinator', 'Logistics Coordinator', 'Coordinates logistics operations and supply chain activities', true, true),
  ('quality_specialist', 'Quality Specialist', 'Specialized role for quality control and assurance processes', true, true)
ON CONFLICT (name) DO NOTHING;

-- Verify the roles were created and log their IDs
DO $$
DECLARE
  inventory_role_id UUID;
  logistics_role_id UUID;
  quality_role_id UUID;
BEGIN
  -- Check inventory_specialist role
  SELECT id INTO inventory_role_id FROM roles WHERE name = 'inventory_specialist';
  IF inventory_role_id IS NOT NULL THEN
    RAISE NOTICE '✅ Inventory Specialist role exists with ID: %', inventory_role_id;
  ELSE
    RAISE EXCEPTION '❌ Failed to create or find Inventory Specialist role';
  END IF;

  -- Check logistics_coordinator role
  SELECT id INTO logistics_role_id FROM roles WHERE name = 'logistics_coordinator';
  IF logistics_role_id IS NOT NULL THEN
    RAISE NOTICE '✅ Logistics Coordinator role exists with ID: %', logistics_role_id;
  ELSE
    RAISE EXCEPTION '❌ Failed to create or find Logistics Coordinator role';
  END IF;

  -- Check quality_specialist role
  SELECT id INTO quality_role_id FROM roles WHERE name = 'quality_specialist';
  IF quality_role_id IS NOT NULL THEN
    RAISE NOTICE '✅ Quality Specialist role exists with ID: %', quality_role_id;
  ELSE
    RAISE EXCEPTION '❌ Failed to create or find Quality Specialist role';
  END IF;
END $$;

-- Update the user_role enum to include new roles (if it still exists)
-- This ensures compatibility during the transition period
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    -- Add new enum values to existing enum type
    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'inventory_specialist';
    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'logistics_coordinator';
    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'quality_specialist';
    RAISE NOTICE '✅ Updated user_role enum with new values';
  ELSE
    RAISE NOTICE 'ℹ️ user_role enum type does not exist (table-based roles in use)';
  END IF;
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'ℹ️ Could not update user_role enum: %', SQLERRM;
END $$;

-- Log migration completion
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 029_add_missing_user_roles.sql completed successfully';
  RAISE NOTICE 'ℹ️ Total roles in system: %', (SELECT COUNT(*) FROM roles WHERE is_system = true);
END $$;
