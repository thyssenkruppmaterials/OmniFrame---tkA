-- Migration: Add Kit BOM Linkage
-- Date: March 2026
-- Description: Links kit build plans to kit definitions for BOM-driven workflows.
--   Adds engine_program to kit_definitions so a selected definition can fully
--   populate new kit builds. Adds kit_definition_id to RR_Kitting_DATA so
--   BOM automation (Black Hat auto-flag) only runs for linked kits.

-- 1. Add engine_program to kit_definitions
ALTER TABLE "public"."kit_definitions"
  ADD COLUMN IF NOT EXISTS "engine_program" VARCHAR(100);

COMMENT ON COLUMN "public"."kit_definitions"."engine_program"
  IS 'Engine program associated with this kit definition (e.g. RR300, MT7)';

CREATE INDEX IF NOT EXISTS "idx_kit_definitions_engine_program"
  ON "public"."kit_definitions"("engine_program");

-- 2. Add kit_definition_id to RR_Kitting_DATA (nullable for backward compat)
ALTER TABLE "public"."RR_Kitting_DATA"
  ADD COLUMN IF NOT EXISTS "kit_definition_id" UUID REFERENCES "public"."kit_definitions"("id") ON DELETE SET NULL;

COMMENT ON COLUMN "public"."RR_Kitting_DATA"."kit_definition_id"
  IS 'Optional link to the kit definition whose BOM drives auto-flag logic';

CREATE INDEX IF NOT EXISTS "idx_rr_kitting_data_kit_definition_id"
  ON "public"."RR_Kitting_DATA"("kit_definition_id");
