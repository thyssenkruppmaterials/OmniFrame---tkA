-- Migration: Add Supply Chain Mapping navigation item under Testing
-- Date: June 11, 2026
-- Purpose: Register /admin/supply-chain-mapping in navigation_items and grant
--          role visibility. Route-protection's Step 3 does an INNER-join
--          .single() query against navigation_items + role_navigation_permissions
--          and 403s any route with no row — same failure class as
--          Fix-Production-Boards-403 (migrations 292/293).

-- ============================================================================
-- STEP 1: Insert Supply Chain Mapping navigation item as child of Testing
-- ============================================================================
-- Generated UUID: e4b8c2d6-7a91-4f3e-8b5c-1d2a6f9e0c44

INSERT INTO navigation_items (id, name, title, url, icon, parent_id, position)
VALUES (
  'e4b8c2d6-7a91-4f3e-8b5c-1d2a6f9e0c44',
  'admin_supply_chain_mapping',
  'Supply Chain Mapping',
  '/admin/supply-chain-mapping',
  'IconTopologyStar3',
  '2b4f9800-8537-4807-a998-11f2c0e9b764',  -- Testing parent ID (admin_testing)
  9  -- after Work Queue Management (position 8)
)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- STEP 2: Derive role visibility from Device Manager
-- ============================================================================
-- Device Manager is the sibling Testing tool with the identical gate
-- (manage/system), so its visibility map (superadmin + admin visible,
-- everyone else hidden) is copied verbatim. Deriving instead of hardcoding
-- the 5 canonical enum roles means custom roles inherit correct visibility
-- automatically (lesson from Fix-Production-Boards-403).
--
-- NOTE: the unique constraint on role_navigation_permissions is the PK
-- (role_id, navigation_item_id) — NOT the legacy (role, navigation_item_id).
-- The nav item id is resolved by URL (not hardcoded) so this step stays
-- correct even if STEP 1's ON CONFLICT (name) hit a pre-existing row.

INSERT INTO role_navigation_permissions (role_id, navigation_item_id, visible, role)
SELECT
  src.role_id,
  (SELECT id FROM navigation_items WHERE url = '/admin/supply-chain-mapping'),
  src.visible,
  src.role
FROM role_navigation_permissions src
JOIN navigation_items src_ni ON src_ni.id = src.navigation_item_id
WHERE src_ni.url = '/admin/device-manager'
ON CONFLICT (role_id, navigation_item_id) DO UPDATE SET visible = EXCLUDED.visible;

-- ============================================================================
-- STEP 3: Assert the backfill is complete
-- ============================================================================
-- Fail the migration if any role that can see Device Manager cannot see
-- Supply Chain Mapping.

DO $$
DECLARE
  missing integer;
BEGIN
  SELECT count(*) INTO missing
  FROM role_navigation_permissions src
  JOIN navigation_items src_ni ON src_ni.id = src.navigation_item_id
  WHERE src_ni.url = '/admin/device-manager'
    AND src.visible
    AND NOT EXISTS (
      SELECT 1
      FROM role_navigation_permissions dst
      WHERE dst.navigation_item_id =
            (SELECT id FROM navigation_items WHERE url = '/admin/supply-chain-mapping')
        AND dst.role_id = src.role_id
        AND dst.visible
    );
  IF missing > 0 THEN
    RAISE EXCEPTION
      'supply_chain_mapping nav backfill incomplete: % visible role(s) missing',
      missing;
  END IF;
END $$;
