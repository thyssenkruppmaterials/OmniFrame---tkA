-- ============================================================================
-- Migration 334: Warehouse Allowlist
--
-- Backs the "Warehouses" sub-tab in Count Settings and the RF put-away scan
-- allowlist. The scanner encodes the warehouse as the trailing segment of the
-- T.O. barcode (e.g. NUMBER$XXXX$IWH5); a brittle fixed-offset `slice(-3)`
-- parse meant any scan jitter silently persisted garbage codes (H52, -01,
-- SF1, ...). This table is the canonical per-organization set of valid codes
-- that the RF form validates against (hard block) and that admins manage from
-- the UI. Mirrors the table + RLS shape of migration 230 (priority rules).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS warehouses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Canonical short warehouse code, stored UPPER (e.g. 'PDC', 'WH5', 'JSF').
  code             text NOT NULL,
  -- Optional friendly name for admins (e.g. 'Primary Distribution Center').
  name             text,
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       int NOT NULL DEFAULT 100,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES user_profiles(id),
  updated_by       uuid REFERENCES user_profiles(id),
  CHECK (code <> ''),
  CHECK (sort_order >= 0 AND sort_order < 10000),
  UNIQUE (organization_id, code)
);

COMMENT ON TABLE warehouses IS
  'Per-organization allowlist of valid warehouse codes. Enforced by the RF put-away scan path (parseTONumber) and managed from Count Settings > Warehouses. Prevents scanner-corrupted codes (H52, -01, SF1, ...) from persisting.';

CREATE INDEX IF NOT EXISTS idx_warehouses_org_order
  ON warehouses (organization_id, sort_order);

CREATE TRIGGER warehouses_set_updated_at
BEFORE UPDATE ON warehouses
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

CREATE POLICY warehouses_select ON warehouses
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY warehouses_admin_write ON warehouses
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND role IN ('superadmin', 'admin', 'manager', 'logistics_coordinator')
    )
  ) WITH CHECK (
    organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND role IN ('superadmin', 'admin', 'manager', 'logistics_coordinator')
    )
  );

-- Seed the three real warehouses for every existing org. Everything else seen
-- in the data was scanner garbage; admins add any additional real codes in the
-- new Count Settings > Warehouses UI.
INSERT INTO warehouses (organization_id, code, sort_order)
SELECT o.id, seed.code, seed.ord
FROM organizations o
CROSS JOIN (VALUES ('PDC', 10), ('WH5', 20), ('JSF', 30)) AS seed(code, ord)
ON CONFLICT (organization_id, code) DO NOTHING;

COMMIT;
