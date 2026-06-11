-- Migration: Add Kit Priority Flag Tracking to RR_Kitting_DATA
-- Date: December 13, 2025
-- Description: Adds columns to track kit priority flags including who set/cleared the flag and when

-- Add kit priority flag columns
ALTER TABLE "public"."RR_Kitting_DATA"
ADD COLUMN IF NOT EXISTS "kit_flag_type" VARCHAR(20) NULL 
  CHECK (kit_flag_type IN ('purple', 'orange', 'red', 'black')),
ADD COLUMN IF NOT EXISTS "kit_flag_set_by_user" UUID NULL 
  REFERENCES "public"."user_profiles"(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS "kit_flag_set_date_time" TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS "kit_flag_cleared_by_user" UUID NULL 
  REFERENCES "public"."user_profiles"(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS "kit_flag_cleared_date_time" TIMESTAMPTZ NULL;

-- Add comment descriptions for the new columns
COMMENT ON COLUMN "public"."RR_Kitting_DATA"."kit_flag_type" IS 'Type of priority flag: purple (Inventory Issue), orange (Incora Supplier Issue), red (Quality Issue), black (Supply Chain Issue)';
COMMENT ON COLUMN "public"."RR_Kitting_DATA"."kit_flag_set_by_user" IS 'User ID who set the priority flag';
COMMENT ON COLUMN "public"."RR_Kitting_DATA"."kit_flag_set_date_time" IS 'Timestamp when the priority flag was set';
COMMENT ON COLUMN "public"."RR_Kitting_DATA"."kit_flag_cleared_by_user" IS 'User ID who cleared the priority flag';
COMMENT ON COLUMN "public"."RR_Kitting_DATA"."kit_flag_cleared_date_time" IS 'Timestamp when the priority flag was cleared';

-- Create index for efficient querying of flagged kits
CREATE INDEX IF NOT EXISTS "idx_rr_kitting_data_kit_flag_type" 
ON "public"."RR_Kitting_DATA"("kit_flag_type") 
WHERE "kit_flag_type" IS NOT NULL;

-- Create index for querying by flag set user
CREATE INDEX IF NOT EXISTS "idx_rr_kitting_data_kit_flag_set_by_user" 
ON "public"."RR_Kitting_DATA"("kit_flag_set_by_user") 
WHERE "kit_flag_set_by_user" IS NOT NULL;


