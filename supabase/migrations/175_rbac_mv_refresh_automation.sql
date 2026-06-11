-- Migration: 175 - RBAC Materialized View Refresh Automation
-- Date: 2026-02-13
-- Description: Implements automatic refresh of RBAC materialized views so that
--   permission changes are reflected promptly. Two strategies are used:
--
--   Strategy 1 (primary): Statement-level AFTER triggers on RBAC tables call
--     REFRESH MATERIALIZED VIEW CONCURRENTLY after every DDL-affecting statement.
--     This gives near-real-time freshness for interactive permission changes.
--
--   Strategy 2 (safety net): A pg_cron job (if the extension is available) calls
--     refresh_rbac_materialized_views() every 5 minutes to catch any edge cases
--     the triggers might miss (e.g. direct SQL updates, restored backups).
--
--   The existing ROW-level triggers from migration 165 (pg_notify) are left in
--   place — they serve as event signals for any future external listeners.
--
-- Depends on: 165_create_rbac_materialized_views.sql


-- ============================================================
-- STEP 1: Ensure unique indexes exist for CONCURRENTLY refresh
-- ============================================================
-- Migration 165 already creates these, but we use IF NOT EXISTS
-- as a defensive guard so this migration is fully idempotent.

-- user_permission_aggregate: one row per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_perm_agg_user_id
  ON user_permission_aggregate (user_id);

-- tab_permission_aggregate: one row per (user, page_resource)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tab_perm_agg_user_page
  ON tab_permission_aggregate (user_id, page_resource);

-- role_permission_summary: one row per role
CREATE UNIQUE INDEX IF NOT EXISTS idx_role_perm_summary_role_id
  ON role_permission_summary (role_id);


-- ============================================================
-- STEP 2: Create trigger function for immediate MV refresh
-- ============================================================
-- Refreshes all three RBAC materialized views CONCURRENTLY (non-blocking)
-- after any statement that modifies RBAC data.
--
-- Key design decisions:
--   • SECURITY DEFINER + SET search_path = public  — hardened per project policy
--   • CONCURRENTLY — readers are never blocked during refresh
--   • BEGIN / EXCEPTION — failures are logged as WARNINGs, never abort the
--     triggering transaction
--   • Returns NULL (AFTER trigger, statement-level — return value is ignored)

CREATE OR REPLACE FUNCTION public.trigger_refresh_rbac_mvs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Refresh all three materialized views concurrently (non-blocking).
    -- Each refresh is wrapped individually so a failure on one view does not
    -- prevent the others from being refreshed.
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY user_permission_aggregate;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'RBAC MV refresh failed for user_permission_aggregate: %', SQLERRM;
    END;

    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY tab_permission_aggregate;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'RBAC MV refresh failed for tab_permission_aggregate: %', SQLERRM;
    END;

    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY role_permission_summary;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'RBAC MV refresh failed for role_permission_summary: %', SQLERRM;
    END;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.trigger_refresh_rbac_mvs() IS
  'Statement-level trigger function that refreshes all RBAC materialized views '
  'CONCURRENTLY after RBAC data changes. Failures are logged as warnings and '
  'never abort the triggering transaction.';


-- ============================================================
-- STEP 3: Create statement-level triggers on RBAC tables
-- ============================================================
-- Statement-level (FOR EACH STATEMENT) triggers fire once per SQL statement,
-- not once per affected row, avoiding excessive refreshes during bulk operations.
--
-- Tables covered:
--   • role_permissions      — affects user_permission_aggregate, role_permission_summary
--   • user_permissions      — affects user_permission_aggregate
--   • roles                 — affects all three MVs (role metadata)
--   • permissions           — affects user_permission_aggregate, role_permission_summary
--   • role_tab_permissions  — affects tab_permission_aggregate
--   • user_profiles         — affects all three MVs (user ↔ role assignment)

-- role_permissions
DROP TRIGGER IF EXISTS refresh_rbac_mvs_on_role_permissions ON role_permissions;
CREATE TRIGGER refresh_rbac_mvs_on_role_permissions
    AFTER INSERT OR UPDATE OR DELETE ON role_permissions
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.trigger_refresh_rbac_mvs();

-- user_permissions
DROP TRIGGER IF EXISTS refresh_rbac_mvs_on_user_permissions ON user_permissions;
CREATE TRIGGER refresh_rbac_mvs_on_user_permissions
    AFTER INSERT OR UPDATE OR DELETE ON user_permissions
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.trigger_refresh_rbac_mvs();

-- roles
DROP TRIGGER IF EXISTS refresh_rbac_mvs_on_roles ON roles;
CREATE TRIGGER refresh_rbac_mvs_on_roles
    AFTER INSERT OR UPDATE OR DELETE ON roles
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.trigger_refresh_rbac_mvs();

-- permissions
DROP TRIGGER IF EXISTS refresh_rbac_mvs_on_permissions ON permissions;
CREATE TRIGGER refresh_rbac_mvs_on_permissions
    AFTER INSERT OR UPDATE OR DELETE ON permissions
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.trigger_refresh_rbac_mvs();

-- role_tab_permissions (affects tab_permission_aggregate)
DROP TRIGGER IF EXISTS refresh_rbac_mvs_on_role_tab_permissions ON role_tab_permissions;
CREATE TRIGGER refresh_rbac_mvs_on_role_tab_permissions
    AFTER INSERT OR UPDATE OR DELETE ON role_tab_permissions
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.trigger_refresh_rbac_mvs();

-- user_profiles (role assignment changes affect all MVs)
DROP TRIGGER IF EXISTS refresh_rbac_mvs_on_user_profiles ON user_profiles;
CREATE TRIGGER refresh_rbac_mvs_on_user_profiles
    AFTER UPDATE OF role_id, status, deleted_at ON user_profiles
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.trigger_refresh_rbac_mvs();


-- ============================================================
-- STEP 4: Scheduled backup refresh via pg_cron (if available)
-- ============================================================
-- pg_cron provides a safety-net periodic refresh every 5 minutes.
-- This catches edge cases the triggers might miss (direct SQL,
-- restored backups, replicated changes, etc.).
-- Wrapped in an anonymous block with exception handling because
-- pg_cron may not be installed or enabled.

DO $$
BEGIN
    -- Check if pg_cron extension is available
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Remove any existing job with this name to make migration idempotent
        BEGIN
            PERFORM cron.unschedule('refresh-rbac-materialized-views');
        EXCEPTION WHEN OTHERS THEN
            -- Job may not exist yet; ignore
            NULL;
        END;

        -- Schedule refresh every 5 minutes
        PERFORM cron.schedule(
            'refresh-rbac-materialized-views',
            '*/5 * * * *',
            'SELECT refresh_rbac_materialized_views()'
        );

        RAISE NOTICE 'pg_cron job scheduled: refresh-rbac-materialized-views (every 5 minutes)';
    ELSE
        RAISE NOTICE 'pg_cron extension not available — using trigger-based refresh only';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron setup skipped (not critical): %', SQLERRM;
END $$;


-- ============================================================
-- STEP 5: Grant execute on the new trigger function
-- ============================================================

GRANT EXECUTE ON FUNCTION public.trigger_refresh_rbac_mvs() TO service_role;


-- ============================================================
-- STEP 6: Migration completion notice
-- ============================================================

DO $$
BEGIN
    RAISE NOTICE '============================================================';
    RAISE NOTICE 'Migration 175: RBAC MV Refresh Automation — COMPLETED';
    RAISE NOTICE '============================================================';
    RAISE NOTICE 'Strategy 1 (trigger-based):';
    RAISE NOTICE '  Created: trigger_refresh_rbac_mvs() [SECURITY DEFINER]';
    RAISE NOTICE '  Triggers (statement-level, AFTER INSERT/UPDATE/DELETE):';
    RAISE NOTICE '    • refresh_rbac_mvs_on_role_permissions';
    RAISE NOTICE '    • refresh_rbac_mvs_on_user_permissions';
    RAISE NOTICE '    • refresh_rbac_mvs_on_roles';
    RAISE NOTICE '    • refresh_rbac_mvs_on_permissions';
    RAISE NOTICE '    • refresh_rbac_mvs_on_role_tab_permissions';
    RAISE NOTICE '    • refresh_rbac_mvs_on_user_profiles (role_id, status, deleted_at)';
    RAISE NOTICE 'Strategy 2 (pg_cron safety net):';
    RAISE NOTICE '  Scheduled refresh_rbac_materialized_views() every 5 minutes (if pg_cron available)';
    RAISE NOTICE 'Existing row-level pg_notify triggers from migration 165 remain unchanged.';
    RAISE NOTICE '============================================================';
END $$;
