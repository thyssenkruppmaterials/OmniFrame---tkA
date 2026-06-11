-- =========================================================================
-- Migration 173: SECURITY DEFINER Search Path Hardening
-- Date: February 13, 2026
-- Purpose: Prevent search-path-based privilege escalation (CVE-2018-1058)
--          by adding SET search_path = public to ALL SECURITY DEFINER functions
-- Approach: Uses ALTER FUNCTION to set the search_path configuration on
--           existing functions without needing to redefine their bodies
-- Idempotent: Skips functions that already have search_path configured
-- =========================================================================

-- =========================================================================
-- PHASE 1: Dynamic patch — automatically finds and patches ALL SECURITY
-- DEFINER functions in the public schema that lack a search_path setting.
-- This is the primary mechanism and handles any functions that may have
-- been missed in the explicit list below.
-- =========================================================================

DO $$
DECLARE
  func_record RECORD;
  patched_count INTEGER := 0;
  skipped_count INTEGER := 0;
BEGIN
  RAISE NOTICE '=== SECURITY DEFINER search_path hardening starting ===';

  FOR func_record IN
    SELECT
      n.nspname  AS schema_name,
      p.proname  AS function_name,
      pg_get_function_identity_arguments(p.oid) AS identity_args,
      p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prosecdef = true  -- SECURITY DEFINER functions only
      AND (
        p.proconfig IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM unnest(p.proconfig) AS c(conf)
          WHERE c.conf LIKE 'search_path=%'
        )
      )
    ORDER BY p.proname
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER FUNCTION %I.%I(%s) SET search_path = public',
        func_record.schema_name,
        func_record.function_name,
        func_record.identity_args
      );
      patched_count := patched_count + 1;
      RAISE NOTICE 'Patched: %.%(%)',
        func_record.schema_name,
        func_record.function_name,
        func_record.identity_args;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to patch %.%(%): %',
        func_record.schema_name,
        func_record.function_name,
        func_record.identity_args,
        SQLERRM;
    END;
  END LOOP;

  -- Count functions that already had search_path set
  SELECT COUNT(*) INTO skipped_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prosecdef = true
    AND p.proconfig IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM unnest(p.proconfig) AS c(conf)
      WHERE c.conf LIKE 'search_path=%'
    );

  RAISE NOTICE '=== SECURITY DEFINER search_path hardening complete ===';
  RAISE NOTICE 'Functions patched: %', patched_count;
  RAISE NOTICE 'Functions already configured (skipped): %', skipped_count;
END $$;


-- =========================================================================
-- PHASE 2: Explicit list of known SECURITY DEFINER functions for
-- documentation and auditability. Wrapped in a DO block so that any
-- individual ALTER failure (e.g., due to a function not existing or a
-- signature mismatch from a later migration) is caught and logged
-- without aborting the entire migration. Phase 1 above has already
-- patched all functions dynamically, so these are a safety net.
-- =========================================================================

DO $$
DECLARE
  v_sql TEXT;
  v_errors INTEGER := 0;
BEGIN
  -- Array of ALTER FUNCTION statements for all known SECURITY DEFINER functions.
  -- Each is executed individually with error handling.
  FOREACH v_sql IN ARRAY ARRAY[
    -- 005: handle_new_user (already patched in migration 162, included for completeness)
    'ALTER FUNCTION public.handle_new_user() SET search_path = public',

    -- 006: Role hierarchy
    'ALTER FUNCTION public.get_inherited_roles(UUID) SET search_path = public',
    'ALTER FUNCTION public.check_role_circular_dependency(UUID, UUID) SET search_path = public',
    'ALTER FUNCTION public.user_has_role_feature(UUID, TEXT) SET search_path = public',

    -- 007: Permission categories
    'ALTER FUNCTION public.get_permission_with_dependencies(UUID) SET search_path = public',
    'ALTER FUNCTION public.validate_permission_assignment(UUID, UUID) SET search_path = public',

    -- 008: Audit and sessions
    'ALTER FUNCTION public.audit_roles_changes() SET search_path = public',
    'ALTER FUNCTION public.audit_role_permissions_changes() SET search_path = public',
    'ALTER FUNCTION public.audit_user_permissions_changes() SET search_path = public',
    'ALTER FUNCTION public.cleanup_audit_logs(INTEGER) SET search_path = public',

    -- 009: RBAC functions
    'ALTER FUNCTION public.get_user_inherited_permissions(UUID) SET search_path = public',
    'ALTER FUNCTION public.get_role_hierarchy_detailed(UUID) SET search_path = public',
    'ALTER FUNCTION public.validate_role_hierarchy_change(UUID, UUID) SET search_path = public',
    'ALTER FUNCTION public.cleanup_expired_permissions() SET search_path = public',
    'ALTER FUNCTION public.get_user_effective_features(UUID) SET search_path = public',
    'ALTER FUNCTION public.simulate_permission_check(UUID, JSONB) SET search_path = public',

    -- 014: Optimized auth functions
    'ALTER FUNCTION public.get_user_permissions_fast(UUID) SET search_path = public',
    'ALTER FUNCTION public.get_user_role_info(UUID) SET search_path = public',
    'ALTER FUNCTION public.get_user_session_info(UUID) SET search_path = public',
    'ALTER FUNCTION public.invalidate_user_permission_cache(UUID) SET search_path = public',
    'ALTER FUNCTION public.get_user_auth_status(UUID) SET search_path = public',

    -- 015: Delivery status RPC
    'ALTER FUNCTION public.get_delivery_status_data(UUID) SET search_path = public',

    -- 020/021: Tab permissions
    'ALTER FUNCTION public.assign_tab_permissions_to_role(UUID, UUID[]) SET search_path = public',

    -- 025: Performance indexes
    'ALTER FUNCTION public.get_index_usage_stats() SET search_path = public',
    'ALTER FUNCTION public.maintain_rbac_indexes() SET search_path = public',

    -- 026: Materialized views
    'ALTER FUNCTION public.refresh_user_permission_cache(UUID) SET search_path = public',
    'ALTER FUNCTION public.refresh_all_permission_caches() SET search_path = public',

    -- 027: Optimized RBAC functions
    'ALTER FUNCTION public.check_user_permission_fast(UUID, VARCHAR, VARCHAR) SET search_path = public',
    'ALTER FUNCTION public.check_user_permission_fallback(UUID, VARCHAR, VARCHAR) SET search_path = public',
    'ALTER FUNCTION public.check_user_permissions_batch(UUID, JSONB) SET search_path = public',
    'ALTER FUNCTION public.get_user_permissions_optimized(UUID) SET search_path = public',
    'ALTER FUNCTION public.check_user_tab_permission_fast(UUID, VARCHAR, VARCHAR) SET search_path = public',
    'ALTER FUNCTION public.get_user_tab_permissions_optimized(UUID, VARCHAR) SET search_path = public',
    'ALTER FUNCTION public.get_role_permissions_optimized(UUID) SET search_path = public',
    'ALTER FUNCTION public.get_role_hierarchy_optimized(UUID) SET search_path = public',
    'ALTER FUNCTION public.get_permission_performance_metrics(INTEGER) SET search_path = public',
    'ALTER FUNCTION public.analyze_permission_distribution() SET search_path = public',
    'ALTER FUNCTION public.warm_permission_cache(INTEGER) SET search_path = public',
    'ALTER FUNCTION public.optimize_rbac_queries() SET search_path = public',
    'ALTER FUNCTION public.check_user_permission(UUID, VARCHAR, VARCHAR) SET search_path = public',
    'ALTER FUNCTION public.check_user_tab_permission(UUID, VARCHAR, VARCHAR) SET search_path = public',
    'ALTER FUNCTION public.monitor_rbac_performance() SET search_path = public',

    -- 030: Security monitoring
    'ALTER FUNCTION public.detect_suspicious_sessions() SET search_path = public',

    -- 031: Conditional permissions
    'ALTER FUNCTION public.revoke_temporary_role_assignment(UUID) SET search_path = public',
    'ALTER FUNCTION public.cleanup_expired_temporary_assignments() SET search_path = public',

    -- 032: Session management
    'ALTER FUNCTION public.get_user_session_config(UUID) SET search_path = public',
    'ALTER FUNCTION public.cleanup_expired_sessions() SET search_path = public',

    -- 033: GRIP processing
    'ALTER FUNCTION public.get_grip_processing_statistics() SET search_path = public',

    -- 035+: Cycle count
    'ALTER FUNCTION public.get_cycle_count_statistics() SET search_path = public',
    'ALTER FUNCTION public.assign_next_cycle_count(UUID) SET search_path = public',
    'ALTER FUNCTION public.assign_cycle_count_to_user(UUID, UUID) SET search_path = public',
    'ALTER FUNCTION public.release_cycle_count_assignment(UUID, UUID) SET search_path = public',
    'ALTER FUNCTION public.get_user_assigned_counts(UUID) SET search_path = public',
    'ALTER FUNCTION public.check_pending_counts_available() SET search_path = public',

    -- 037/038: Abandonment recovery
    'ALTER FUNCTION public.detect_abandoned_cycle_counts(INTEGER) SET search_path = public',
    'ALTER FUNCTION public.release_abandoned_cycle_counts(INTEGER, INTEGER) SET search_path = public',
    'ALTER FUNCTION public.release_my_cycle_count(UUID, TEXT) SET search_path = public',
    'ALTER FUNCTION public.admin_release_abandoned_count(UUID, TEXT) SET search_path = public',
    'ALTER FUNCTION public.auto_cleanup_abandoned_counts() SET search_path = public',
    'ALTER FUNCTION public.get_abandonment_statistics() SET search_path = public',

    -- 039: Work queue system
    'ALTER FUNCTION public.rebalance_work_queue() SET search_path = public',
    'ALTER FUNCTION public.escalate_stalled_tasks() SET search_path = public',

    -- 043: GRS GRIP processing
    'ALTER FUNCTION public.get_grs_grip_processing_statistics() SET search_path = public',

    -- 044: Recount history
    'ALTER FUNCTION public.get_recount_comparison(UUID) SET search_path = public',

    -- 047: Outbound duplicates
    'ALTER FUNCTION public.get_outbound_duplicate_stats() SET search_path = public',

    -- 049: Labor management
    'ALTER FUNCTION public.get_user_current_position(UUID) SET search_path = public',
    'ALTER FUNCTION public.get_organizational_tree(UUID, UUID) SET search_path = public',
    'ALTER FUNCTION public.get_position_hierarchy(UUID) SET search_path = public',

    -- 051+: Statistics functions
    'ALTER FUNCTION public.get_putback_log_statistics() SET search_path = public',
    'ALTER FUNCTION public.get_inbound_scan_statistics() SET search_path = public',
    'ALTER FUNCTION public.get_putaway_log_statistics() SET search_path = public',
    'ALTER FUNCTION public.get_sq01_statistics() SET search_path = public',

    -- 053/080: Seed functions
    'ALTER FUNCTION public.seed_position_options(UUID) SET search_path = public',
    'ALTER FUNCTION public.seed_area_and_department_options(UUID) SET search_path = public',

    -- 069-071: LX03 functions
    'ALTER FUNCTION public.get_lx03_inventory_by_locations(TEXT[]) SET search_path = public',
    'ALTER FUNCTION public.get_lx03_inventory_by_range(TEXT, TEXT) SET search_path = public',
    'ALTER FUNCTION public.get_lx03_inventory_by_parts(TEXT[]) SET search_path = public',
    'ALTER FUNCTION public.get_lx03_statistics() SET search_path = public',
    'ALTER FUNCTION public.get_lx03_warehouses() SET search_path = public',
    'ALTER FUNCTION public.get_lx03_storage_types() SET search_path = public',
    'ALTER FUNCTION public.get_lx03_empty_bins_by_filters(TEXT, TEXT, TEXT) SET search_path = public',

    -- 084: Timeline events
    'ALTER FUNCTION public.initialize_timeline_event_categories(UUID) SET search_path = public',

    -- 085+: Team productivity
    'ALTER FUNCTION public.get_team_activity_events(UUID, TIMESTAMPTZ, TIMESTAMPTZ) SET search_path = public',
    'ALTER FUNCTION public.get_weekly_productivity_summary(UUID, DATE) SET search_path = public',
    'ALTER FUNCTION public.get_shift_assignments_with_details(UUID) SET search_path = public',

    -- 086: Dynamic activity configuration
    'ALTER FUNCTION public.get_activity_configurations(UUID) SET search_path = public',
    'ALTER FUNCTION public.get_available_activity_tables() SET search_path = public',
    'ALTER FUNCTION public.get_table_columns(TEXT) SET search_path = public',

    -- 089: User status
    'ALTER FUNCTION public.get_user_status_statistics() SET search_path = public',

    -- 090: Push mode and heartbeats
    'ALTER FUNCTION public.get_user_pushed_counts(UUID) SET search_path = public',
    'ALTER FUNCTION public.push_cycle_count_to_user(UUID, UUID, UUID) SET search_path = public',
    'ALTER FUNCTION public.acknowledge_pushed_count(UUID, UUID) SET search_path = public',

    -- 094: Standard work checklist
    'ALTER FUNCTION public.get_submission_with_responses(UUID) SET search_path = public',

    -- 100: Kit kanban trigger
    'ALTER FUNCTION public.update_kit_kanban_last_touched() SET search_path = public',

    -- 102: Drone scans
    'ALTER FUNCTION public.fail_drone_scan_analysis(UUID, TEXT) SET search_path = public',

    -- 150: Service API keys
    'ALTER FUNCTION public.validate_service_api_key(VARCHAR, VARCHAR) SET search_path = public',
    'ALTER FUNCTION public.get_api_key_stats(VARCHAR, INTEGER) SET search_path = public',

    -- 151: Role hierarchy
    'ALTER FUNCTION public.get_role_children(UUID) SET search_path = public',

    -- 155: Organization access validation
    'ALTER FUNCTION public.validate_organization_access(UUID) SET search_path = public',

    -- 160: Camera system
    'ALTER FUNCTION public.get_camera_statistics(UUID) SET search_path = public',
    'ALTER FUNCTION public.acknowledge_camera_event(UUID) SET search_path = public',
    'ALTER FUNCTION public.bulk_acknowledge_camera_events(UUID[]) SET search_path = public',

    -- 165: RBAC materialized views
    'ALTER FUNCTION public.refresh_rbac_materialized_views() SET search_path = public',

    -- 166: Conditional permission check
    'ALTER FUNCTION public.check_conditional_permission(UUID, VARCHAR, VARCHAR) SET search_path = public',

    -- 172: Hot part alerts
    'ALTER FUNCTION public.check_hot_part_alerts(TEXT, TEXT, TEXT, UUID) SET search_path = public'
  ]
  LOOP
    BEGIN
      EXECUTE v_sql;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE NOTICE 'Phase 2 (expected if signature differs): % — %', v_sql, SQLERRM;
    END;
  END LOOP;

  IF v_errors > 0 THEN
    RAISE NOTICE 'Phase 2 completed with % non-critical error(s). Phase 1 already patched these dynamically.', v_errors;
  ELSE
    RAISE NOTICE 'Phase 2 completed: all explicit ALTER statements succeeded.';
  END IF;
END $$;


-- =========================================================================
-- PHASE 3: Verification
-- =========================================================================

-- Final count of SECURITY DEFINER functions without search_path
DO $$
DECLARE
  unpatched_count INTEGER;
  func_record RECORD;
BEGIN
  SELECT COUNT(*) INTO unpatched_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prosecdef = true
    AND (
      p.proconfig IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) AS c(conf)
        WHERE c.conf LIKE 'search_path=%'
      )
    );

  IF unpatched_count > 0 THEN
    RAISE WARNING '% SECURITY DEFINER function(s) still lack search_path setting:', unpatched_count;
    FOR func_record IN
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.prosecdef = true
        AND (
          p.proconfig IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM unnest(p.proconfig) AS c(conf)
            WHERE c.conf LIKE 'search_path=%'
          )
        )
    LOOP
      RAISE WARNING '  - %(%)', func_record.proname, func_record.args;
    END LOOP;
  ELSE
    RAISE NOTICE 'SUCCESS: All SECURITY DEFINER functions in public schema have search_path configured.';
  END IF;
END $$;

-- =========================================================================
-- Manual verification query (run after applying):
--
-- SELECT
--   p.proname AS function_name,
--   pg_get_function_identity_arguments(p.oid) AS args,
--   p.proconfig
-- FROM pg_proc p
-- JOIN pg_namespace n ON p.pronamespace = n.oid
-- WHERE n.nspname = 'public'
--   AND p.prosecdef = true
--   AND (
--     p.proconfig IS NULL
--     OR NOT EXISTS (
--       SELECT 1 FROM unnest(p.proconfig) AS c(conf)
--       WHERE c.conf LIKE 'search_path=%'
--     )
--   );
--
-- Expected: 0 rows (all SECURITY DEFINER functions should have search_path)
-- =========================================================================
