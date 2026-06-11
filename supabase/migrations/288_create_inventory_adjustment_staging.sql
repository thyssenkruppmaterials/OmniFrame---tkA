-- Migration 288 — Inventory Adjustment Staging table.
--
-- Backs the new "Inventory Adjustment" workflow shipped on 2026-05-07
-- (see Implementations/Implement-Inventory-Adjustment-Workflow.md).
--
-- Workflow recap:
--   1. User runs an LT10 query in the SAP Testing → Inventory Management
--      tab (existing read-only LT10 handler).
--   2. From any row's Actions dropdown, the new "+ Add to Inv. Adjust"
--      action calls the new agent endpoint POST /sap/zmm60/lookup which
--      returns the unit price (`Price` column) + currency from ZMM60.
--   3. The browser INSERTs one row into `inventory_adjustment_staging`
--      with the LT10 row attributes + the ZMM60 price.
--   4. A new "Inventory Adjustment" entry in the Query Library renders
--      the staging rows with three stat cards (Net Value / Gross Gains /
--      Gross Losses) and an Excel export button.
--
-- Design notes:
--   * `extended_value` is a STORED generated column so the FE never has
--     to recompute it on read. Aggregations (`SUM(extended_value) FILTER
--     (WHERE total_stock > 0)`) stay simple.
--   * `unit_value` is the SAP `Price` (column 13 in the ZMM60 export
--     "Dynamic List Display" output, after the leading-tab empty
--     column). For the test material 23067754 / plant 8303 this maps
--     to 287.63 USD per the recorded ValueExport.
--   * `currency` is captured from the same ZMM60 row when present so
--     multi-currency orgs render correctly via Intl.NumberFormat.
--   * `zmm60_raw` carries the entire parsed ZMM60 row (one record from
--     `_extract_via_pc_export()`) so future features ("show moving avg
--     price too", "compare std vs PO price") can grab additional fields
--     without a second SAP roundtrip per row.
--   * The same material / bin can be added more than once on purpose:
--     a re-count later in the day should be a NEW row, not an update of
--     the prior row. So NO composite uniqueness on
--     (organization_id, material, storage_bin).
--   * RLS — org members read/write their own org. No admin role
--     restriction beyond org membership; this is a working scratch pad,
--     not a system-of-record. Service role bypasses RLS as usual.
--   * NOT added to the supabase_realtime publication. The control
--     plane is the user driving the inserts (one-at-a-time via the
--     agent), so TanStack Query invalidation on insert/delete is
--     sufficient — see `.cursor/rules/realtime-policy.mdc`.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.inventory_adjustment_staging (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by        UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  -- LT10 row attributes (free-form text — SAP renders these as strings
  -- in the list output; we store verbatim so the export can round-trip
  -- without coercion).
  storage_type      TEXT,
  plant             TEXT,
  storage_location  TEXT,
  storage_bin       TEXT,
  material          TEXT        NOT NULL,

  -- Quantity from the LT10 `Total Stock` column. NUMERIC because SAP can
  -- emit negative stock (shortfalls) and fractional quantities (e.g.
  -- decimalised UoMs); the FE renders sign-aware via the Gross Gains /
  -- Gross Losses split.
  total_stock       NUMERIC     NOT NULL,

  -- ZMM60 unit price + optional currency code.
  unit_value        NUMERIC     NOT NULL,
  currency          TEXT,

  -- Pre-computed extended value so aggregations stay trivial. Generated
  -- columns require all referenced columns to be deterministic and not
  -- itself generated, which is satisfied here.
  extended_value    NUMERIC     GENERATED ALWAYS AS (total_stock * unit_value) STORED,

  -- Raw ZMM60 row (parsed key→value dict from the `_extract_via_pc_export`
  -- pass) so future enhancements can read extra fields without re-querying
  -- SAP. NULL when the agent is unable to parse the row but still resolves
  -- a price (defensive — the column is informational, not load-bearing).
  zmm60_raw         JSONB,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Most-common access path: list-by-org sorted by recency.
CREATE INDEX IF NOT EXISTS idx_inventory_adjustment_staging_org_created
  ON public.inventory_adjustment_staging (organization_id, created_at DESC);

-- Secondary: per-material lookup so the FE can highlight rows where the
-- same material has been added multiple times across different bins.
CREATE INDEX IF NOT EXISTS idx_inventory_adjustment_staging_org_material
  ON public.inventory_adjustment_staging (organization_id, material);

ALTER TABLE public.inventory_adjustment_staging ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_adjustment_staging org read"
  ON public.inventory_adjustment_staging;
CREATE POLICY "inventory_adjustment_staging org read"
  ON public.inventory_adjustment_staging
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "inventory_adjustment_staging org insert"
  ON public.inventory_adjustment_staging;
CREATE POLICY "inventory_adjustment_staging org insert"
  ON public.inventory_adjustment_staging
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "inventory_adjustment_staging org delete"
  ON public.inventory_adjustment_staging;
CREATE POLICY "inventory_adjustment_staging org delete"
  ON public.inventory_adjustment_staging
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

-- Documentation comments (so `\d+` and Supabase Studio render context).
COMMENT ON TABLE public.inventory_adjustment_staging IS
  'Per-org scratch pad of inventory rows pulled from LT10 + priced via ZMM60. '
  'Backs the SAP Testing → Inventory Management → Inventory Adjustment view. '
  'NOT added to supabase_realtime publication; FE refreshes via TanStack '
  'invalidation after the agent-driven INSERT/DELETE. See realtime-policy.mdc.';

COMMENT ON COLUMN public.inventory_adjustment_staging.unit_value IS
  'ZMM60 ''Price'' field (column 13 in the ZMM60 PC-export, after the '
  'leading-tab empty column). Currency lives in the sibling `currency` '
  'column; if NULL the FE defaults to USD via Intl.NumberFormat.';

COMMENT ON COLUMN public.inventory_adjustment_staging.extended_value IS
  'GENERATED column = total_stock * unit_value. Sign-aware: negative '
  'total_stock (SAP shortfall) yields negative extended_value, which the '
  'FE surfaces under Gross Losses.';

COMMENT ON COLUMN public.inventory_adjustment_staging.zmm60_raw IS
  'Full parsed ZMM60 row (key->value dict). Informational — kept so '
  'future features (moving avg price, std price comparison, etc.) can '
  'read additional fields without a second SAP roundtrip.';
