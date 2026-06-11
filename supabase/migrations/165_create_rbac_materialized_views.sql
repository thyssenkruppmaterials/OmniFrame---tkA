-- Migration: 165 - Create RBAC Materialized Views
-- Date: 2026-02-05
-- Description: Creates/recreates materialized views required by optimized RBAC functions (migration 027).
--   This is a defensive migration that ensures all three materialized views exist with the correct
--   schema, regardless of whether migration 026 ran successfully. Views are dropped and recreated
--   to guarantee schema correctness. PL/pgSQL functions (from 027) reference views at execution
--   time, so dropping views does not cascade to or invalidate those functions.

-- ============================================================
-- STEP 1: Drop existing materialized views if they exist
-- ============================================================
-- CASCADE handles any dependent indexes or objects automatically.
-- PL/pgSQL function bodies are stored as text and resolved at runtime,
-- so this will NOT drop functions from migration 027.
DROP MATERIALIZED VIEW IF EXISTS user_permission_aggregate CASCADE;
DROP MATERIALIZED VIEW IF EXISTS tab_permission_aggregate CASCADE;
DROP MATERIALIZED VIEW IF EXISTS role_permission_summary CASCADE;

-- Also drop the old trigger function and triggers so we can recreate cleanly
DROP TRIGGER IF EXISTS trigger_refresh_on_user_permissions ON user_permissions;
DROP TRIGGER IF EXISTS trigger_refresh_on_role_permissions ON role_permissions;
DROP TRIGGER IF EXISTS trigger_refresh_on_user_profiles ON user_profiles;
DROP TRIGGER IF EXISTS trigger_refresh_on_role_tab_permissions ON role_tab_permissions;
DROP FUNCTION IF EXISTS trigger_permission_cache_refresh() CASCADE;
DROP FUNCTION IF EXISTS refresh_rbac_materialized_views() CASCADE;
DROP FUNCTION IF EXISTS refresh_user_permission_cache(UUID) CASCADE;
DROP FUNCTION IF EXISTS refresh_all_permission_caches() CASCADE;


-- ============================================================
-- STEP 2: Create user_permission_aggregate materialized view
-- ============================================================
-- Aggregates all permissions for each user from both role_permissions
-- and direct user_permissions into a single row per user.
--
-- Key columns used by 027 functions:
--   user_id        - lookup key (WHERE user_id = ...)
--   all_permissions - TEXT[] of "resource:action" strings for fast array checks
--   total_permission_count - analytics/metrics
--   aggregated_at  - cache freshness monitoring
--
-- Additional columns for analytics and admin interfaces:
--   permission_name, resource, action are embedded in the all_permissions array
--   source is tracked via role_permissions vs direct_permissions arrays
--   role_name is included for display/filtering

CREATE MATERIALIZED VIEW user_permission_aggregate AS
SELECT
  up.id AS user_id,
  up.email,
  up.role_id,
  r.name AS role_name,
  r.display_name AS role_display_name,
  up.status AS user_status,
  up.created_at AS user_created_at,
  up.last_sign_in_at,

  -- Role-based permissions (resource:action format)
  array_agg(DISTINCT p.resource || ':' || p.action)
    FILTER (WHERE p.id IS NOT NULL) AS role_permissions,
  array_agg(DISTINCT p.resource)
    FILTER (WHERE p.id IS NOT NULL) AS role_resources,
  array_agg(DISTINCT p.action)
    FILTER (WHERE p.id IS NOT NULL) AS role_actions,

  -- Direct user permissions (resource:action format)
  array_agg(DISTINCT dp.resource || ':' || dp.action)
    FILTER (WHERE dp.id IS NOT NULL
      AND upm.granted = true
      AND (upm.expires_at IS NULL OR upm.expires_at > NOW())
    ) AS direct_permissions,
  array_agg(DISTINCT dp.resource)
    FILTER (WHERE dp.id IS NOT NULL
      AND upm.granted = true
      AND (upm.expires_at IS NULL OR upm.expires_at > NOW())
    ) AS direct_resources,

  -- Combined all permissions (role + direct) - PRIMARY lookup column
  array_agg(DISTINCT
    CASE
      WHEN p.id IS NOT NULL THEN p.resource || ':' || p.action
      WHEN dp.id IS NOT NULL
        AND upm.granted = true
        AND (upm.expires_at IS NULL OR upm.expires_at > NOW())
        THEN dp.resource || ':' || dp.action
    END
  ) FILTER (WHERE
    p.id IS NOT NULL OR
    (dp.id IS NOT NULL AND upm.granted = true AND (upm.expires_at IS NULL OR upm.expires_at > NOW()))
  ) AS all_permissions,

  -- Permission counts for analytics
  COUNT(DISTINCT p.id) AS role_permission_count,
  COUNT(DISTINCT CASE
    WHEN upm.granted = true AND (upm.expires_at IS NULL OR upm.expires_at > NOW())
    THEN dp.id
  END) AS direct_permission_count,
  COUNT(DISTINCT CASE
    WHEN p.id IS NOT NULL
      OR (dp.id IS NOT NULL AND upm.granted = true AND (upm.expires_at IS NULL OR upm.expires_at > NOW()))
    THEN 1
  END) AS total_permission_count,

  -- Risk assessment aggregation
  COUNT(DISTINCT CASE WHEN p.risk_level IN ('high', 'critical') THEN p.id END) AS high_risk_role_permissions,
  COUNT(DISTINCT CASE
    WHEN dp.risk_level IN ('high', 'critical')
      AND upm.granted = true
      AND (upm.expires_at IS NULL OR upm.expires_at > NOW())
    THEN dp.id
  END) AS high_risk_direct_permissions,

  -- 2FA requirements
  bool_or(p.requires_2fa) AS requires_2fa_role,
  bool_or(
    dp.requires_2fa
    AND upm.granted = true
    AND (upm.expires_at IS NULL OR upm.expires_at > NOW())
  ) AS requires_2fa_direct,

  -- Critical permissions
  COUNT(DISTINCT CASE WHEN p.is_critical = true THEN p.id END) AS critical_role_permissions,
  COUNT(DISTINCT CASE
    WHEN dp.is_critical = true
      AND upm.granted = true
      AND (upm.expires_at IS NULL OR upm.expires_at > NOW())
    THEN dp.id
  END) AS critical_direct_permissions,

  -- Wildcard detection
  bool_or(p.resource = '*' AND p.action = '*') AS has_wildcard_role,
  bool_or(
    dp.resource = '*' AND dp.action = '*'
    AND upm.granted = true
    AND (upm.expires_at IS NULL OR upm.expires_at > NOW())
  ) AS has_wildcard_direct,

  -- Cache timestamp
  NOW() AS aggregated_at

FROM user_profiles up
LEFT JOIN roles r ON r.id = up.role_id AND r.is_active = true
LEFT JOIN role_permissions rp ON rp.role_id = up.role_id
LEFT JOIN permissions p ON p.id = rp.permission_id AND p.is_active = true
LEFT JOIN user_permissions upm ON upm.user_id = up.id
LEFT JOIN permissions dp ON dp.id = upm.permission_id AND dp.is_active = true
WHERE up.deleted_at IS NULL
GROUP BY up.id, up.email, up.role_id, r.name, r.display_name,
         up.status, up.created_at, up.last_sign_in_at;


-- ============================================================
-- STEP 3: Create tab_permission_aggregate materialized view
-- ============================================================
-- Aggregates tab permissions for each user per page_resource.
-- One row per (user_id, page_resource) combination.
--
-- Key columns used by 027 functions:
--   user_id         - lookup key
--   page_resource   - lookup key
--   tab_permissions  - JSONB[] array with tab_definition_id, tab_id, tab_label, granted, source

CREATE MATERIALIZED VIEW tab_permission_aggregate AS
SELECT
  up.id AS user_id,
  up.email,
  r.name AS role_name,
  td.page_resource,

  -- Tab permissions as JSONB array (one entry per tab on this page)
  array_agg(
    jsonb_build_object(
      'tab_definition_id', td.id,
      'tab_id', td.tab_id,
      'tab_label', td.tab_label,
      'description', td.description,
      'display_order', td.display_order,
      'granted', COALESCE(rtp.granted, false),
      'source', CASE WHEN rtp.granted IS NOT NULL THEN 'role' ELSE 'default' END
    ) ORDER BY td.display_order
  ) AS tab_permissions,

  -- Tab statistics per page
  COUNT(td.id) AS total_tabs,
  COUNT(td.id) FILTER (WHERE COALESCE(rtp.granted, false) = true) AS granted_tabs,
  COUNT(td.id) FILTER (WHERE COALESCE(rtp.granted, false) = false) AS denied_tabs,

  -- Cache timestamp
  NOW() AS aggregated_at

FROM user_profiles up
LEFT JOIN roles r ON r.id = up.role_id AND r.is_active = true
CROSS JOIN tab_definitions td
LEFT JOIN role_tab_permissions rtp ON rtp.role_id = r.id AND rtp.tab_definition_id = td.id
WHERE up.deleted_at IS NULL
  AND td.is_active = true
GROUP BY up.id, up.email, r.name, td.page_resource;


-- ============================================================
-- STEP 4: Create role_permission_summary materialized view
-- ============================================================
-- Summarizes all permissions per role for admin interfaces.
-- One row per role.
--
-- Key columns used by 027 functions:
--   role_id, role_name, display_name, parent_role_id,
--   active_user_count, total_permissions, is_system, hierarchy_level,
--   permissions (TEXT[])

CREATE MATERIALIZED VIEW role_permission_summary AS
SELECT
  r.id AS role_id,
  r.name AS role_name,
  r.display_name,
  r.description,
  r.is_system,
  r.is_active,
  r.priority,
  r.parent_role_id,
  pr.name AS parent_role_name,
  r.features,

  -- User counts
  COUNT(DISTINCT up.id) FILTER (WHERE up.deleted_at IS NULL AND up.status = 'active') AS active_user_count,
  COUNT(DISTINCT up.id) FILTER (WHERE up.deleted_at IS NULL) AS total_user_count,

  -- Permission aggregations (resource:action format)
  array_agg(DISTINCT p.resource || ':' || p.action ORDER BY p.resource, p.action)
    FILTER (WHERE p.id IS NOT NULL) AS permissions,
  array_agg(DISTINCT p.resource ORDER BY p.resource)
    FILTER (WHERE p.id IS NOT NULL) AS resources,
  array_agg(DISTINCT p.action ORDER BY p.action)
    FILTER (WHERE p.id IS NOT NULL) AS actions,

  -- Permission counts by risk level
  COUNT(DISTINCT p.id) AS total_permissions,
  COUNT(DISTINCT CASE WHEN p.risk_level = 'critical' THEN p.id END) AS critical_permissions,
  COUNT(DISTINCT CASE WHEN p.risk_level = 'high' THEN p.id END) AS high_risk_permissions,
  COUNT(DISTINCT CASE WHEN p.requires_2fa = true THEN p.id END) AS mfa_required_permissions,
  COUNT(DISTINCT CASE WHEN p.is_critical = true THEN p.id END) AS business_critical_permissions,

  -- Resource coverage
  COUNT(DISTINCT p.resource) AS unique_resources,
  COUNT(DISTINCT p.action) AS unique_actions,

  -- Wildcard detection
  bool_or(p.resource = '*') AS has_resource_wildcard,
  bool_or(p.action = '*') AS has_action_wildcard,
  bool_or(p.resource = '*' AND p.action = '*') AS has_full_wildcard,

  -- Hierarchy depth (simplified: 0 = root, 1 = child)
  CASE
    WHEN r.parent_role_id IS NULL THEN 0
    ELSE 1
  END AS hierarchy_level,

  -- Cache timestamp
  NOW() AS summarized_at

FROM roles r
LEFT JOIN roles pr ON pr.id = r.parent_role_id
LEFT JOIN user_profiles up ON up.role_id = r.id
LEFT JOIN role_permissions rp ON rp.role_id = r.id
LEFT JOIN permissions p ON p.id = rp.permission_id AND p.is_active = true
WHERE r.is_active = true
GROUP BY r.id, r.name, r.display_name, r.description, r.is_system,
         r.is_active, r.priority, r.parent_role_id, pr.name, r.features;


-- ============================================================
-- STEP 5: Create unique indexes (required for CONCURRENTLY refresh)
-- ============================================================

-- user_permission_aggregate: one row per user
CREATE UNIQUE INDEX idx_user_perm_agg_user_id
  ON user_permission_aggregate (user_id);

-- tab_permission_aggregate: one row per (user, page)
CREATE UNIQUE INDEX idx_tab_perm_agg_user_page
  ON tab_permission_aggregate (user_id, page_resource);

-- role_permission_summary: one row per role
CREATE UNIQUE INDEX idx_role_perm_summary_role_id
  ON role_permission_summary (role_id);


-- ============================================================
-- STEP 6: Create additional performance indexes
-- ============================================================

-- user_permission_aggregate indexes
CREATE INDEX idx_user_perm_agg_role_id
  ON user_permission_aggregate (role_id);
CREATE INDEX idx_user_perm_agg_email
  ON user_permission_aggregate (email);
CREATE INDEX idx_user_perm_agg_status
  ON user_permission_aggregate (user_status);
CREATE INDEX idx_user_perm_agg_role_name
  ON user_permission_aggregate (role_name);
CREATE INDEX idx_user_perm_agg_all_permissions_gin
  ON user_permission_aggregate USING GIN (all_permissions);
CREATE INDEX idx_user_perm_agg_role_permissions_gin
  ON user_permission_aggregate USING GIN (role_permissions);
CREATE INDEX idx_user_perm_agg_direct_permissions_gin
  ON user_permission_aggregate USING GIN (direct_permissions);

-- tab_permission_aggregate indexes
CREATE INDEX idx_tab_perm_agg_user_id
  ON tab_permission_aggregate (user_id);
CREATE INDEX idx_tab_perm_agg_page_resource
  ON tab_permission_aggregate (page_resource);
CREATE INDEX idx_tab_perm_agg_role_name
  ON tab_permission_aggregate (role_name);

-- role_permission_summary indexes
CREATE INDEX idx_role_perm_summary_name
  ON role_permission_summary (role_name);
CREATE INDEX idx_role_perm_summary_parent
  ON role_permission_summary (parent_role_id);
CREATE INDEX idx_role_perm_summary_user_count
  ON role_permission_summary (active_user_count);
CREATE INDEX idx_role_perm_summary_permissions_gin
  ON role_permission_summary USING GIN (permissions);


-- ============================================================
-- STEP 7: Create refresh_rbac_materialized_views() function
-- ============================================================
-- Refreshes all three RBAC views CONCURRENTLY (non-blocking reads)
-- Returns timing information for each view refresh.

CREATE OR REPLACE FUNCTION refresh_rbac_materialized_views()
RETURNS TABLE(
  view_name TEXT,
  refresh_status TEXT,
  duration_ms INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
BEGIN
  -- Refresh user_permission_aggregate
  v_start := clock_timestamp();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY user_permission_aggregate;
    v_end := clock_timestamp();
    RETURN QUERY SELECT
      'user_permission_aggregate'::TEXT,
      'SUCCESS'::TEXT,
      (EXTRACT(EPOCH FROM (v_end - v_start)) * 1000)::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    v_end := clock_timestamp();
    RETURN QUERY SELECT
      'user_permission_aggregate'::TEXT,
      ('ERROR: ' || SQLERRM)::TEXT,
      (EXTRACT(EPOCH FROM (v_end - v_start)) * 1000)::INTEGER;
  END;

  -- Refresh tab_permission_aggregate
  v_start := clock_timestamp();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY tab_permission_aggregate;
    v_end := clock_timestamp();
    RETURN QUERY SELECT
      'tab_permission_aggregate'::TEXT,
      'SUCCESS'::TEXT,
      (EXTRACT(EPOCH FROM (v_end - v_start)) * 1000)::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    v_end := clock_timestamp();
    RETURN QUERY SELECT
      'tab_permission_aggregate'::TEXT,
      ('ERROR: ' || SQLERRM)::TEXT,
      (EXTRACT(EPOCH FROM (v_end - v_start)) * 1000)::INTEGER;
  END;

  -- Refresh role_permission_summary
  v_start := clock_timestamp();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY role_permission_summary;
    v_end := clock_timestamp();
    RETURN QUERY SELECT
      'role_permission_summary'::TEXT,
      'SUCCESS'::TEXT,
      (EXTRACT(EPOCH FROM (v_end - v_start)) * 1000)::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    v_end := clock_timestamp();
    RETURN QUERY SELECT
      'role_permission_summary'::TEXT,
      ('ERROR: ' || SQLERRM)::TEXT,
      (EXTRACT(EPOCH FROM (v_end - v_start)) * 1000)::INTEGER;
  END;

  RETURN;
END;
$$;


-- ============================================================
-- STEP 8: Create trigger function for automatic refresh
-- ============================================================
-- Sends a pg_notify event on RBAC data changes so an external listener
-- (or pg_cron job) can refresh the materialized views asynchronously.
-- Direct synchronous refresh inside triggers is avoided because
-- REFRESH MATERIALIZED VIEW CONCURRENTLY cannot run inside a transaction
-- that modified the underlying tables.

CREATE OR REPLACE FUNCTION trigger_permission_cache_refresh()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Notify listeners that RBAC data changed (for async refresh)
  PERFORM pg_notify(
    'permission_cache_refresh',
    jsonb_build_object(
      'table', TG_TABLE_NAME,
      'operation', TG_OP,
      'timestamp', NOW(),
      'user_id', CASE
        WHEN TG_TABLE_NAME = 'user_permissions' THEN COALESCE(NEW.user_id, OLD.user_id)
        WHEN TG_TABLE_NAME = 'user_profiles' THEN COALESCE(NEW.id, OLD.id)
        ELSE NULL
      END,
      'role_id', CASE
        WHEN TG_TABLE_NAME IN ('role_permissions', 'role_tab_permissions')
          THEN COALESCE(NEW.role_id, OLD.role_id)
        WHEN TG_TABLE_NAME = 'user_profiles'
          THEN COALESCE(NEW.role_id, OLD.role_id)
        ELSE NULL
      END
    )::text
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;


-- ============================================================
-- STEP 9: Create triggers on RBAC tables
-- ============================================================

-- Trigger on role_permissions (insert/update/delete)
CREATE TRIGGER trigger_refresh_on_role_permissions
  AFTER INSERT OR UPDATE OR DELETE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION trigger_permission_cache_refresh();

-- Trigger on user_permissions (insert/update/delete)
CREATE TRIGGER trigger_refresh_on_user_permissions
  AFTER INSERT OR UPDATE OR DELETE ON user_permissions
  FOR EACH ROW EXECUTE FUNCTION trigger_permission_cache_refresh();

-- Trigger on role_tab_permissions (insert/update/delete)
CREATE TRIGGER trigger_refresh_on_role_tab_permissions
  AFTER INSERT OR UPDATE OR DELETE ON role_tab_permissions
  FOR EACH ROW EXECUTE FUNCTION trigger_permission_cache_refresh();

-- Trigger on user_profiles when role changes
CREATE TRIGGER trigger_refresh_on_user_profiles
  AFTER UPDATE OF role_id, status, deleted_at ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_permission_cache_refresh();


-- ============================================================
-- STEP 10: Grant SELECT on materialized views
-- ============================================================

GRANT SELECT ON user_permission_aggregate TO authenticated, service_role;
GRANT SELECT ON tab_permission_aggregate TO authenticated, service_role;
GRANT SELECT ON role_permission_summary TO authenticated, service_role;

-- Refresh function is service_role only (admin operation)
GRANT EXECUTE ON FUNCTION refresh_rbac_materialized_views() TO service_role;


-- ============================================================
-- STEP 11: Initial data population (non-concurrent first refresh)
-- ============================================================
-- First refresh must be non-concurrent since the views have no data yet.

DO $$
BEGIN
  REFRESH MATERIALIZED VIEW user_permission_aggregate;
  RAISE NOTICE 'Refreshed user_permission_aggregate: % rows',
    (SELECT COUNT(*) FROM user_permission_aggregate);

  REFRESH MATERIALIZED VIEW tab_permission_aggregate;
  RAISE NOTICE 'Refreshed tab_permission_aggregate: % rows',
    (SELECT COUNT(*) FROM tab_permission_aggregate);

  REFRESH MATERIALIZED VIEW role_permission_summary;
  RAISE NOTICE 'Refreshed role_permission_summary: % rows',
    (SELECT COUNT(*) FROM role_permission_summary);
END $$;


-- ============================================================
-- STEP 12: Add documentation comments
-- ============================================================

COMMENT ON MATERIALIZED VIEW user_permission_aggregate IS
  'Pre-computed user permissions for lightning-fast permission checks. '
  'Columns: user_id, all_permissions (TEXT[] of resource:action), role_name, source tracking. '
  'Referenced by check_user_permission_fast(), check_user_permissions_batch(), get_user_permissions_optimized().';

COMMENT ON MATERIALIZED VIEW tab_permission_aggregate IS
  'Pre-computed tab permissions per user per page for fast UI rendering. '
  'Columns: user_id, page_resource, tab_permissions (JSONB[] with tab_id, tab_label, granted, source). '
  'Referenced by check_user_tab_permission_fast(), get_user_tab_permissions_optimized().';

COMMENT ON MATERIALIZED VIEW role_permission_summary IS
  'Aggregated role permission summaries for admin interfaces. '
  'Columns: role_id, role_name, permission_count, permissions (TEXT[]), features, hierarchy_level. '
  'Referenced by get_role_permissions_optimized(), get_role_hierarchy_optimized().';

COMMENT ON FUNCTION refresh_rbac_materialized_views() IS
  'Refreshes all three RBAC materialized views CONCURRENTLY with timing and error reporting.';

COMMENT ON FUNCTION trigger_permission_cache_refresh() IS
  'Trigger function that sends pg_notify events when RBAC data changes for async cache refresh.';


-- ============================================================
-- STEP 13: Migration completion notice
-- ============================================================

DO $$
DECLARE
  v_user_count BIGINT;
  v_tab_count BIGINT;
  v_role_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_user_count FROM user_permission_aggregate;
  SELECT COUNT(*) INTO v_tab_count FROM tab_permission_aggregate;
  SELECT COUNT(*) INTO v_role_count FROM role_permission_summary;

  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Migration 165: RBAC Materialized Views - COMPLETED';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Created materialized views:';
  RAISE NOTICE '  user_permission_aggregate  : % rows (permissions per user)', v_user_count;
  RAISE NOTICE '  tab_permission_aggregate   : % rows (tab permissions per user/page)', v_tab_count;
  RAISE NOTICE '  role_permission_summary    : % rows (permission summary per role)', v_role_count;
  RAISE NOTICE 'Created unique indexes for CONCURRENTLY refresh support';
  RAISE NOTICE 'Created refresh_rbac_materialized_views() function';
  RAISE NOTICE 'Created triggers on: role_permissions, user_permissions, role_tab_permissions, user_profiles';
  RAISE NOTICE 'Granted SELECT to authenticated and service_role';
  RAISE NOTICE '============================================================';
END $$;
