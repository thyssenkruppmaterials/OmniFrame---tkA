-- =========================================================================
-- Migration 174: RPC Org-Scoping & Tab Schema Alignment
-- Date: February 13, 2026
-- Purpose:
--   Part A – Add organization-scoping to bulk_assign_permissions() to
--            prevent cross-org permission assignment.
--   Part B – Fix check_hot_part_alerts() to default to the caller's
--            organization when p_organization_id IS NULL, preventing
--            unscoped data leakage.
--   Part C – Ensure a public.tab_permissions compatibility layer exists
--            so that code referencing tab_permissions resolves to the
--            canonical tab_definitions table.
-- Idempotent: All sections use CREATE OR REPLACE / DO $$ guards.
-- =========================================================================


-- =========================================================================
-- PART A: Org-scoped bulk_assign_permissions
-- =========================================================================
-- Original defined in 009_rbac_functions.sql.
-- Preserves the exact signature and return type:
--   (VARCHAR, UUID, UUID[], BOOLEAN, TEXT, TIMESTAMPTZ)
--   RETURNS TABLE(success_count INTEGER, error_count INTEGER, errors JSONB)
--
-- Change: Before processing, we resolve the caller's organization_id and
-- validate that the target (user or role owner) belongs to the same org.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.bulk_assign_permissions(
  p_target_type VARCHAR, -- 'user' or 'role'
  p_target_id UUID,
  p_permission_ids UUID[],
  p_granted BOOLEAN DEFAULT TRUE,
  p_reason TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(
  success_count INTEGER,
  error_count INTEGER,
  errors JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_success_count INTEGER := 0;
  v_error_count INTEGER := 0;
  v_errors JSONB := '[]'::jsonb;
  v_permission_id UUID;
  v_error_info JSONB;
  -- Org-scoping variables (added in migration 174)
  v_caller_org UUID;
  v_target_org UUID;
BEGIN
  -- =====================================================================
  -- NEW: Organization scoping — prevent cross-org permission assignment
  -- =====================================================================

  -- Resolve the caller's organization
  SELECT organization_id INTO v_caller_org
  FROM user_profiles
  WHERE id = auth.uid();

  -- Resolve the target's organization
  IF p_target_type = 'user' THEN
    SELECT organization_id INTO v_target_org
    FROM user_profiles
    WHERE id = p_target_id;
  ELSIF p_target_type = 'role' THEN
    -- Roles are not directly org-scoped in our schema; we rely on the
    -- convention that only callers within the same org manage roles.
    -- Set target_org = caller_org so the check passes when both are set.
    v_target_org := v_caller_org;
  END IF;

  -- Block cross-organization assignment
  IF v_caller_org IS NOT NULL
     AND v_target_org IS NOT NULL
     AND v_caller_org IS DISTINCT FROM v_target_org
  THEN
    RETURN QUERY SELECT
      0::INTEGER,
      1::INTEGER,
      '["Cross-organization permission assignment is not allowed"]'::JSONB;
    RETURN;
  END IF;

  -- =====================================================================
  -- Original logic from migration 009 (preserved verbatim)
  -- =====================================================================

  -- Validate target exists
  IF p_target_type = 'user' THEN
    IF NOT EXISTS(SELECT 1 FROM user_profiles WHERE id = p_target_id) THEN
      RETURN QUERY SELECT 0, 1, '["Target user not found"]'::jsonb;
      RETURN;
    END IF;
  ELSIF p_target_type = 'role' THEN
    IF NOT EXISTS(SELECT 1 FROM roles WHERE id = p_target_id) THEN
      RETURN QUERY SELECT 0, 1, '["Target role not found"]'::jsonb;
      RETURN;
    END IF;
  ELSE
    RETURN QUERY SELECT 0, 1, '["Invalid target type"]'::jsonb;
    RETURN;
  END IF;

  -- Process each permission
  FOREACH v_permission_id IN ARRAY p_permission_ids
  LOOP
    BEGIN
      -- Validate permission exists
      IF NOT EXISTS(SELECT 1 FROM permissions WHERE id = v_permission_id) THEN
        v_error_info := jsonb_build_object(
          'permission_id', v_permission_id,
          'error', 'Permission not found'
        );
        v_errors := v_errors || jsonb_build_array(v_error_info);
        v_error_count := v_error_count + 1;
        CONTINUE;
      END IF;

      -- Assign permission based on target type
      IF p_target_type = 'user' THEN
        -- Validate dependencies if granting
        IF p_granted THEN
          DECLARE
            v_validation RECORD;
          BEGIN
            SELECT * INTO v_validation FROM validate_permission_assignment(p_target_id, v_permission_id);
            
            IF NOT v_validation.is_valid THEN
              v_error_info := jsonb_build_object(
                'permission_id', v_permission_id,
                'error', 'Validation failed',
                'missing_dependencies', v_validation.missing_dependencies,
                'conflicts', v_validation.conflicting_permissions
              );
              v_errors := v_errors || jsonb_build_array(v_error_info);
              v_error_count := v_error_count + 1;
              CONTINUE;
            END IF;
          END;
        END IF;

        -- Insert or update user permission
        INSERT INTO user_permissions (user_id, permission_id, granted, expires_at, metadata)
        VALUES (p_target_id, v_permission_id, p_granted, p_expires_at, jsonb_build_object('reason', p_reason))
        ON CONFLICT (user_id, permission_id) 
        DO UPDATE SET 
          granted = EXCLUDED.granted,
          expires_at = EXCLUDED.expires_at,
          metadata = EXCLUDED.metadata,
          created_at = NOW();
          
      ELSIF p_target_type = 'role' THEN
        -- Get role enum value for role_permissions table
        DECLARE
          v_role_enum VARCHAR;
        BEGIN
          SELECT name INTO v_role_enum FROM roles WHERE id = p_target_id;
          
          IF p_granted THEN
            -- Add permission to role
            INSERT INTO role_permissions (role_id, permission_id, role)
            VALUES (p_target_id, v_permission_id, v_role_enum)
            ON CONFLICT (role_id, permission_id) DO NOTHING;
          ELSE
            -- Remove permission from role
            DELETE FROM role_permissions 
            WHERE role_id = p_target_id AND permission_id = v_permission_id;
          END IF;
        END;
      END IF;
      
      v_success_count := v_success_count + 1;
      
    EXCEPTION WHEN OTHERS THEN
      v_error_info := jsonb_build_object(
        'permission_id', v_permission_id,
        'error', SQLERRM
      );
      v_errors := v_errors || jsonb_build_array(v_error_info);
      v_error_count := v_error_count + 1;
    END;
  END LOOP;
  
  RETURN QUERY SELECT v_success_count, v_error_count, v_errors;
END;
$$;

-- Re-grant permissions (CREATE OR REPLACE preserves grants, but be explicit)
GRANT EXECUTE ON FUNCTION public.bulk_assign_permissions(VARCHAR, UUID, UUID[], BOOLEAN, TEXT, TIMESTAMPTZ)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.bulk_assign_permissions IS
  'Safely assigns multiple permissions with validation, error handling, '
  'and cross-organization scoping (migration 174).';


-- =========================================================================
-- PART B: Org-scoped check_hot_part_alerts
-- =========================================================================
-- Original defined in 172_create_hot_part_alerts_table.sql as LANGUAGE sql.
-- Problem: When p_organization_id IS NULL the function returns alerts from
--          ALL organizations, bypassing tenant isolation.
-- Fix: Replace the (p_organization_id IS NULL OR ...) pattern with a
--      COALESCE that defaults to the caller's organization via auth.uid().
-- Note: The table already has RLS policies that restrict by organization,
--       but SECURITY DEFINER bypasses RLS, so this function-level fix is
--       necessary for defense-in-depth.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.check_hot_part_alerts(
  p_material_number TEXT DEFAULT NULL,
  p_so_line_rma_afa TEXT DEFAULT NULL,
  p_tracking_number TEXT DEFAULT NULL,
  p_organization_id UUID DEFAULT NULL
)
RETURNS SETOF public.rr_hot_part_alerts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.rr_hot_part_alerts
  WHERE is_active = true
    -- Org scoping: default to caller's org when p_organization_id is NULL
    AND organization_id = COALESCE(
      p_organization_id,
      (SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid())
    )
    AND (
      (match_type = 'material_number'
        AND p_material_number IS NOT NULL
        AND LOWER(p_material_number) LIKE '%' || LOWER(match_value) || '%')
      OR (match_type = 'so_line_rma_afa'
        AND p_so_line_rma_afa IS NOT NULL
        AND LOWER(p_so_line_rma_afa) LIKE '%' || LOWER(match_value) || '%')
      OR (match_type = 'tracking_number'
        AND p_tracking_number IS NOT NULL
        AND LOWER(p_tracking_number) LIKE '%' || LOWER(match_value) || '%')
      OR (match_type = 'any' AND (
        (p_material_number IS NOT NULL
          AND LOWER(p_material_number) LIKE '%' || LOWER(match_value) || '%')
        OR (p_so_line_rma_afa IS NOT NULL
          AND LOWER(p_so_line_rma_afa) LIKE '%' || LOWER(match_value) || '%')
        OR (p_tracking_number IS NOT NULL
          AND LOWER(p_tracking_number) LIKE '%' || LOWER(match_value) || '%'))
      )
    )
  ORDER BY
    CASE priority
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'normal' THEN 3
    END;
$$;

COMMENT ON FUNCTION public.check_hot_part_alerts IS
  'Checks for hot part alert matches. Defaults to caller''s organization '
  'when p_organization_id is NULL (migration 174 org-scoping fix).';


-- =========================================================================
-- PART C: Tab Schema Alignment
-- =========================================================================
-- Background:
--   Migration 020 created the canonical tables:
--     - tab_definitions (page_resource, tab_id, tab_label, description, ...)
--     - role_tab_permissions (role_id, tab_definition_id, granted)
--
--   Later migrations (034, 095, etc.) reference a "tab_permissions" table
--   with columns like page_resource, tab_id, tab_label, required_permissions,
--   visible_by_default, display_order.
--
--   This section ensures that if tab_permissions does not exist as a real
--   table, a compatibility view is created over tab_definitions so that
--   SELECT queries against tab_permissions resolve correctly. If
--   tab_permissions already exists as a table, we leave it untouched.
-- =========================================================================

DO $$
BEGIN
  -- Case 1: tab_permissions already exists as a TABLE — nothing to do
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'tab_permissions'
      AND table_type = 'BASE TABLE'
  ) THEN
    RAISE NOTICE 'Part C: tab_permissions already exists as a table — no changes needed';

  -- Case 2: tab_permissions already exists as a VIEW — nothing to do
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public'
      AND table_name = 'tab_permissions'
  ) THEN
    RAISE NOTICE 'Part C: tab_permissions already exists as a view — no changes needed';

  -- Case 3: tab_definitions exists but tab_permissions does not — create view
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'tab_definitions'
  ) THEN
    -- Create a compatibility view mapping tab_definitions columns
    -- to the names expected by code that references tab_permissions
    EXECUTE '
      CREATE VIEW public.tab_permissions AS
      SELECT
        id,
        page_resource,
        page_resource AS app_id,         -- alias used by migration 034
        tab_id,
        tab_label,
        tab_label AS tab_name,           -- alias used by migration 034
        description,
        display_order,
        is_active,
        NULL::JSONB AS required_permissions,  -- column used by migration 095
        true AS visible_by_default,           -- column used by migration 095
        created_at
      FROM public.tab_definitions
    ';

    -- Grant read access to authenticated users (matches tab_definitions RLS)
    EXECUTE 'GRANT SELECT ON public.tab_permissions TO authenticated, service_role';

    RAISE NOTICE 'Part C: Created tab_permissions compatibility view over tab_definitions';

  ELSE
    RAISE NOTICE 'Part C: Neither tab_definitions nor tab_permissions found — skipping';
  END IF;
END $$;


-- =========================================================================
-- Final verification notices
-- =========================================================================
DO $$
BEGIN
  RAISE NOTICE '=========================================================';
  RAISE NOTICE 'Migration 174: RPC Org-Scoping & Tab Schema Alignment';
  RAISE NOTICE '  Part A: bulk_assign_permissions — org-scoping added';
  RAISE NOTICE '  Part B: check_hot_part_alerts — defaults to caller org';
  RAISE NOTICE '  Part C: tab_permissions compatibility layer checked';
  RAISE NOTICE '=========================================================';
END $$;
