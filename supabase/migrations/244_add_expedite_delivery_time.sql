-- Migration: Add Expedite Delivery Time + Quantity to RR_Kitting_DATA
-- Date: 2026-04-28
-- Description: Adds the metadata required to store single-line expedite
--   requests added from the Kitting Data Manager. An expedite is a stand-alone
--   line item attached to a kit build plan (or stand-alone kit) with a
--   delivery time priority of Critical, 24 Hour, or 2-Day.

ALTER TABLE "public"."RR_Kitting_DATA"
  ADD COLUMN IF NOT EXISTS "part_expedite_delivery_time" TEXT;

ALTER TABLE "public"."RR_Kitting_DATA"
  ADD COLUMN IF NOT EXISTS "part_expedite_quantity" NUMERIC;

ALTER TABLE "public"."RR_Kitting_DATA"
  ADD COLUMN IF NOT EXISTS "part_expedite_description" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rr_kitting_data_expedite_delivery_time_check'
  ) THEN
    ALTER TABLE "public"."RR_Kitting_DATA"
      ADD CONSTRAINT "rr_kitting_data_expedite_delivery_time_check"
      CHECK (
        "part_expedite_delivery_time" IS NULL
        OR "part_expedite_delivery_time" IN ('critical', '24_hour', '2_day')
      );
  END IF;
END $$;

COMMENT ON COLUMN "public"."RR_Kitting_DATA"."part_expedite_delivery_time"
  IS 'Delivery priority for the expedite line: critical | 24_hour | 2_day.';

COMMENT ON COLUMN "public"."RR_Kitting_DATA"."part_expedite_quantity"
  IS 'Quantity requested for the expedite line.';

COMMENT ON COLUMN "public"."RR_Kitting_DATA"."part_expedite_description"
  IS 'Description / material name of the expedited part.';

CREATE INDEX IF NOT EXISTS "idx_rr_kitting_data_expedite_part"
  ON "public"."RR_Kitting_DATA" ("part_expedite_part_number")
  WHERE "part_expedite_part_number" IS NOT NULL;
