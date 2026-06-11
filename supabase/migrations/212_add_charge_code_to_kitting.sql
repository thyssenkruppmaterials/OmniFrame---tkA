-- Migration: Add charge_code to kitting definitions and runtime rows
-- Date: 2026-03-31
-- Description: Adds definition-level and runtime charge_code fields so kit
-- build sheets can show the selected charge code from Kit BOM settings.

ALTER TABLE "public"."kit_definitions"
  ADD COLUMN IF NOT EXISTS "charge_code" TEXT;

COMMENT ON COLUMN "public"."kit_definitions"."charge_code"
  IS 'Optional charge code selected from the kitting dropdown options list';

ALTER TABLE "public"."RR_Kitting_DATA"
  ADD COLUMN IF NOT EXISTS "charge_code" TEXT;

COMMENT ON COLUMN "public"."RR_Kitting_DATA"."charge_code"
  IS 'Snapshot of kit_definitions.charge_code at build-plan creation time';
