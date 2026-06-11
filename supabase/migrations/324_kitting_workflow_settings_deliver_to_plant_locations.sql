-- Migration: Extend kitting_workflow_settings with configurable Deliver-To-Plant locations
-- Date: 2026-05-20
-- Description: Adds `deliver_to_plant_locations` TEXT[] to `kitting_workflow_settings`. The Add Kit
--   Build Plan dialog's "Deliver To Plant" dropdown previously hardcoded an 8-entry list inside
--   `src/components/ui/add-kit-build-plan-dialog.tsx` (PLANT_LOCATIONS const). That meant every
--   facility change required a code push + redeploy, even though the field is purely
--   organisation-scoped configuration. This migration moves the list onto
--   `kitting_workflow_settings` so floor leads can edit it from
--   Settings → Workflow Settings without engineering involvement.
--
--   Stored as TEXT[] (Postgres array of human-readable plant labels), matching the sibling
--   `non_warehouse_bin_patterns` shape introduced by migration 314. One row per org, UPSERT keyed
--   on `organization_id`, scalar / array primitives only. The dropdown reads from this column via
--   `useDeliverToPlantLocations()`; the settings UI edits via `setDeliverToPlantLocationsAsync()`.
--
--   Default seeds the exact 8 entries that used to be hardcoded so existing org behaviour is
--   preserved verbatim until a floor lead decides to customise the list.

ALTER TABLE "public"."kitting_workflow_settings"
  ADD COLUMN IF NOT EXISTS "deliver_to_plant_locations" TEXT[] NOT NULL DEFAULT ARRAY[
    'Plant A - Main Assembly',
    'Plant B - Component Shop',
    'Plant C - Engine Test',
    'Plant D - Logistics Hub',
    'Plant E - Quality Center',
    'Warehouse 1',
    'Warehouse 2',
    'Shipping Dock'
  ]::TEXT[];

COMMENT ON COLUMN "public"."kitting_workflow_settings"."deliver_to_plant_locations"
  IS 'Operator-editable list of "Deliver To Plant" destinations shown in the Add Kit Build Plan dialog. Stored as the human-readable label that lands on the kit row (e.g. "Plant A - Main Assembly"). Managed from Settings → Workflow Settings; default seeds the eight values that used to be hardcoded in the frontend.';
