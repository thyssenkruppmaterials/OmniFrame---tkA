-- Migration: Add kit_dock_location column + dock_location dropdown group
-- Date: 2026-05-17
-- Description: Wires the new RF Dock Staging flow.
--   1. Adds nullable `kit_dock_location TEXT` column to RR_Kitting_DATA so
--      the operator-scanned dock location can be persisted alongside the
--      existing `kit_ready_on_dock_*` audit columns. Legacy rows
--      (including kits that landed on dock via the now-corrected
--      skip-inspection path in completeKitBuild — see
--      memorybank/OmniFrame/Implementations/Optional-Kit-Inspection-Toggle.md)
--      remain NULL; only kits staged via the new RF flow carry a value.
--   2. Extends the `kitting_dropdown_options.option_group` CHECK
--      constraint to allow `'dock_location'` so dock locations can be
--      managed in-app via the existing `KittingOptionsService`/`useKittingOptions`
--      surface alongside engine programs, kit container types, etc.
--   3. Extends the `seed_kitting_dropdown_options(p_organization_id)`
--      function with two sensible default dock locations
--      (`DOCK-1`, `DOCK-2`) so newly-onboarded orgs have something to
--      scan against on day one. Existing orgs get the same defaults
--      via the trailing per-org reseed loop.

-- ---------------------------------------------------------------------------
-- 1. RR_Kitting_DATA.kit_dock_location
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."RR_Kitting_DATA"
  ADD COLUMN IF NOT EXISTS "kit_dock_location" TEXT;

COMMENT ON COLUMN "public"."RR_Kitting_DATA"."kit_dock_location"
  IS 'Operator-scanned dock location stamped by the RF Dock Staging flow. Nullable; legacy rows (and kits that reached on-dock via the pre-2026-05-17 completeKitBuild skip-inspection path) carry NULL. Validated client-side against active rows in kitting_dropdown_options where option_group = ''dock_location'' (case-insensitive). Lookups are by kit_serial_number PK; no index required.';

-- ---------------------------------------------------------------------------
-- 2. kitting_dropdown_options.option_group CHECK — allow 'dock_location'
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'kitting_dropdown_options'
      AND constraint_type = 'CHECK'
      AND constraint_name = 'kitting_dropdown_options_option_group_check'
  ) THEN
    ALTER TABLE "public"."kitting_dropdown_options"
      DROP CONSTRAINT "kitting_dropdown_options_option_group_check";
  END IF;
END $$;

ALTER TABLE "public"."kitting_dropdown_options"
  ADD CONSTRAINT "kitting_dropdown_options_option_group_check"
  CHECK (
    "option_group" IN (
      'engine_program',
      'kit_type',
      'kit_container_type',
      'bom_line_container_type',
      'charge_code',
      'dock_location'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. seed_kitting_dropdown_options — extend with dock_location defaults
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."seed_kitting_dropdown_options"(p_organization_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "public"."kitting_dropdown_options"
    WHERE organization_id = p_organization_id
      AND option_group = 'engine_program'
  ) THEN
    INSERT INTO "public"."kitting_dropdown_options" (
      organization_id,
      option_group,
      option_value,
      option_label,
      display_order
    )
    VALUES
      (p_organization_id, 'engine_program', '1107C', '1107C', 1),
      (p_organization_id, 'engine_program', '2100D2A', '2100D2A', 2),
      (p_organization_id, 'engine_program', '2100D3 (40/50)', '2100D3 (40/50)', 3),
      (p_organization_id, 'engine_program', '2100D3 (40/50 WGB)', '2100D3 (40/50 WGB)', 4),
      (p_organization_id, 'engine_program', '2100D3 (60/90)', '2100D3 (60/90)', 5),
      (p_organization_id, 'engine_program', '2100D3 (60/90 WGB)', '2100D3 (60/90 WGB)', 6),
      (p_organization_id, 'engine_program', '3007H', '3007H', 7),
      (p_organization_id, 'engine_program', '3007N', '3007N', 8),
      (p_organization_id, 'engine_program', 'A427', 'A427', 9),
      (p_organization_id, 'engine_program', 'B17F', 'B17F', 10),
      (p_organization_id, 'engine_program', 'C20W', 'C20W', 11),
      (p_organization_id, 'engine_program', 'C30HU', 'C30HU', 12),
      (p_organization_id, 'engine_program', 'C47E', 'C47E', 13),
      (p_organization_id, 'engine_program', 'KS4', 'KS4', 14),
      (p_organization_id, 'engine_program', 'Liftfan', 'Liftfan', 15),
      (p_organization_id, 'engine_program', 'Liftworks', 'Liftworks', 16),
      (p_organization_id, 'engine_program', 'MT5S HE+', 'MT5S HE+', 17),
      (p_organization_id, 'engine_program', 'MT7', 'MT7', 18),
      (p_organization_id, 'engine_program', 'RR300', 'RR300', 19);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "public"."kitting_dropdown_options"
    WHERE organization_id = p_organization_id
      AND option_group = 'kit_type'
  ) THEN
    INSERT INTO "public"."kitting_dropdown_options" (
      organization_id,
      option_group,
      option_value,
      option_label,
      display_order
    )
    VALUES
      (p_organization_id, 'kit_type', 'standard', 'Standard', 1),
      (p_organization_id, 'kit_type', 'custom', 'Custom', 2),
      (p_organization_id, 'kit_type', 'promotional', 'Promotional', 3),
      (p_organization_id, 'kit_type', 'emergency', 'Emergency', 4),
      (p_organization_id, 'kit_type', 'sample', 'Sample', 5);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "public"."kitting_dropdown_options"
    WHERE organization_id = p_organization_id
      AND option_group = 'kit_container_type'
  ) THEN
    INSERT INTO "public"."kitting_dropdown_options" (
      organization_id,
      option_group,
      option_value,
      option_label,
      display_order
    )
    VALUES
      (p_organization_id, 'kit_container_type', 'kit_cart', 'Kit Cart', 1),
      (p_organization_id, 'kit_container_type', 'pallet', 'Pallet', 2),
      (p_organization_id, 'kit_container_type', 'flight_case', 'Flight Case', 3);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "public"."kitting_dropdown_options"
    WHERE organization_id = p_organization_id
      AND option_group = 'bom_line_container_type'
  ) THEN
    INSERT INTO "public"."kitting_dropdown_options" (
      organization_id,
      option_group,
      option_value,
      option_label,
      display_order
    )
    VALUES
      (p_organization_id, 'bom_line_container_type', 'in_kit', 'In Kit', 1),
      (p_organization_id, 'bom_line_container_type', 'top_box', 'Top Cardboard Box', 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "public"."kitting_dropdown_options"
    WHERE organization_id = p_organization_id
      AND option_group = 'dock_location'
  ) THEN
    INSERT INTO "public"."kitting_dropdown_options" (
      organization_id,
      option_group,
      option_value,
      option_label,
      display_order
    )
    VALUES
      (p_organization_id, 'dock_location', 'DOCK-1', 'Dock 1', 1),
      (p_organization_id, 'dock_location', 'DOCK-2', 'Dock 2', 2);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION "public"."seed_kitting_dropdown_options"(UUID) TO authenticated;

-- Backfill dock_location defaults for existing orgs.
DO $$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM "public"."organizations" LOOP
    PERFORM "public"."seed_kitting_dropdown_options"(org_record.id);
  END LOOP;
END $$;
