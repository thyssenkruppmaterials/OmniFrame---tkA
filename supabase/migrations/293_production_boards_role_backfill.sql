-- Migration: Backfill Production Boards visibility for custom roles
-- Date: May 10, 2026
-- Purpose: Migration 292 only enumerates the legacy `user_role` enum members
--          (superadmin / admin / manager / cashier / viewer). The deployed
--          tenant has additional custom roles (master_trainer,
--          tka_branchcoordinator, tka_supervisors, human_resources,
--          tka_associate, tka_leaders, rolls_royce_assembly) that already
--          have explicit role_navigation_permissions rows for Shift
--          Productivity and/or Standard Work. Per spec, any role that can
--          see Shift Productivity OR Standard Work must also see
--          Production Boards. This migration derives that set from the
--          existing data so future-added roles are picked up automatically.
--
-- Custom roles whose `role` enum value is set to 'viewer' below: every
-- non-canonical role in this DB stores `role = 'viewer'` for FK enum
-- purposes (see migrations 067/090). Production Boards follows the same
-- convention so the data stays uniform.
--
-- Idempotent: ON CONFLICT (role_id, navigation_item_id) updates the
-- visibility flag rather than inserting duplicates.

-- ============================================================================
-- STEP 1: Mirror visibility for any role that already sees Shift Productivity
--         OR Standard Work. visible = true if EITHER source is true.
-- ============================================================================

INSERT INTO role_navigation_permissions (role_id, navigation_item_id, visible, role)
SELECT
  src.role_id,
  '7d3e9a2b-1f5c-4cb7-9e6a-2a8e1b6f4c11'::uuid AS navigation_item_id,
  bool_or(src.visible) AS visible,
  -- Use the matching user_role enum value when available; fall back to
  -- 'viewer' for custom roles (matches existing convention in 067/090).
  COALESCE(
    (
      SELECT r.name::user_role
      FROM roles r
      WHERE r.id = src.role_id
        AND r.name IN (
          'superadmin','admin','manager','cashier','viewer',
          'tka_associate','inventory_specialist','logistics_coordinator',
          'quality_specialist'
        )
      LIMIT 1
    ),
    'viewer'::user_role
  ) AS role
FROM role_navigation_permissions src
JOIN navigation_items src_ni ON src_ni.id = src.navigation_item_id
WHERE src_ni.url IN ('/apps/shift-productivity', '/apps/standard-work')
GROUP BY src.role_id
ON CONFLICT (role_id, navigation_item_id)
DO UPDATE SET visible = EXCLUDED.visible;

-- ============================================================================
-- STEP 2: Sanity assertion -- every role with visible=true on Shift
--         Productivity OR Standard Work must now have visible=true on
--         Production Boards.
-- ============================================================================

DO $$
DECLARE
  missing_count integer;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM (
    SELECT DISTINCT src.role_id
    FROM role_navigation_permissions src
    JOIN navigation_items src_ni ON src_ni.id = src.navigation_item_id
    WHERE src_ni.url IN ('/apps/shift-productivity', '/apps/standard-work')
      AND src.visible = true
  ) needs
  LEFT JOIN role_navigation_permissions pb
    ON pb.role_id = needs.role_id
   AND pb.navigation_item_id = '7d3e9a2b-1f5c-4cb7-9e6a-2a8e1b6f4c11'::uuid
  WHERE pb.visible IS DISTINCT FROM true;

  IF missing_count > 0 THEN
    RAISE EXCEPTION
      'Production Boards backfill incomplete: % role(s) that can see Shift Productivity or Standard Work still cannot see Production Boards',
      missing_count;
  END IF;
END $$;
