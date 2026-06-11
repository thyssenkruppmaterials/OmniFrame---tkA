-- Migration: Add Multiple Kit Build Flags Support
-- Date: December 16, 2025
-- Description: Creates kit_build_flags table to support multiple flags per kit with full audit trail

-- Create the kit_build_flags table for tracking multiple flags per kit
CREATE TABLE IF NOT EXISTS "public"."kit_build_flags" (
    "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    "kit_po_number" VARCHAR(100) NOT NULL,
    "flag_type" VARCHAR(20) NOT NULL CHECK (flag_type IN ('purple', 'orange', 'red', 'black')),
    "is_active" BOOLEAN DEFAULT true,
    
    -- Flag set tracking
    "set_by_user" UUID REFERENCES "public"."user_profiles"(id) ON DELETE SET NULL,
    "set_date_time" TIMESTAMPTZ DEFAULT NOW(),
    
    -- Flag cleared tracking
    "cleared_by_user" UUID REFERENCES "public"."user_profiles"(id) ON DELETE SET NULL,
    "cleared_date_time" TIMESTAMPTZ,
    
    -- Notes/comments for the flag
    "notes" TEXT,
    
    -- Audit fields
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Create a partial unique index to prevent duplicate active flags of the same type
CREATE UNIQUE INDEX IF NOT EXISTS "idx_kit_build_flags_unique_active" 
ON "public"."kit_build_flags"("kit_po_number", "flag_type") 
WHERE "is_active" = true;

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS "idx_kit_build_flags_kit_po_number" 
ON "public"."kit_build_flags"("kit_po_number");

CREATE INDEX IF NOT EXISTS "idx_kit_build_flags_active" 
ON "public"."kit_build_flags"("kit_po_number", "is_active") 
WHERE "is_active" = true;

CREATE INDEX IF NOT EXISTS "idx_kit_build_flags_flag_type" 
ON "public"."kit_build_flags"("flag_type");

CREATE INDEX IF NOT EXISTS "idx_kit_build_flags_set_by_user" 
ON "public"."kit_build_flags"("set_by_user");

-- Add comments for documentation
COMMENT ON TABLE "public"."kit_build_flags" IS 'Tracks multiple kit build flags per kit with full audit trail history';
COMMENT ON COLUMN "public"."kit_build_flags"."kit_po_number" IS 'The Kit PO Number this flag is associated with';
COMMENT ON COLUMN "public"."kit_build_flags"."flag_type" IS 'Type of priority flag: purple (Inventory Issue), orange (Incora Supplier Issue), red (Quality Issue), black (Supply Chain Issue)';
COMMENT ON COLUMN "public"."kit_build_flags"."is_active" IS 'Whether this flag is currently active (false = cleared/historical)';
COMMENT ON COLUMN "public"."kit_build_flags"."set_by_user" IS 'User ID who set the flag';
COMMENT ON COLUMN "public"."kit_build_flags"."set_date_time" IS 'Timestamp when the flag was set';
COMMENT ON COLUMN "public"."kit_build_flags"."cleared_by_user" IS 'User ID who cleared the flag';
COMMENT ON COLUMN "public"."kit_build_flags"."cleared_date_time" IS 'Timestamp when the flag was cleared';
COMMENT ON COLUMN "public"."kit_build_flags"."notes" IS 'Optional notes or comments about this flag';

-- Enable RLS
ALTER TABLE "public"."kit_build_flags" ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
DO $$ BEGIN
    CREATE POLICY "kit_build_flags_select_policy" ON "public"."kit_build_flags"
        FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY "kit_build_flags_insert_policy" ON "public"."kit_build_flags"
        FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY "kit_build_flags_update_policy" ON "public"."kit_build_flags"
        FOR UPDATE USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY "kit_build_flags_delete_policy" ON "public"."kit_build_flags"
        FOR DELETE USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION "public"."update_kit_build_flags_updated_at"()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trigger_kit_build_flags_updated_at" ON "public"."kit_build_flags";
CREATE TRIGGER "trigger_kit_build_flags_updated_at"
    BEFORE UPDATE ON "public"."kit_build_flags"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."update_kit_build_flags_updated_at"();

-- Migrate existing single flags to the new table (if any exist)
-- Using INSERT ... WHERE NOT EXISTS to avoid conflicts with partial unique index
INSERT INTO "public"."kit_build_flags" (kit_po_number, flag_type, is_active, set_by_user, set_date_time, cleared_by_user, cleared_date_time)
SELECT DISTINCT 
    kit_po_number,
    kit_flag_type,
    true,
    kit_flag_set_by_user,
    kit_flag_set_date_time,
    kit_flag_cleared_by_user,
    kit_flag_cleared_date_time
FROM "public"."RR_Kitting_DATA"
WHERE kit_flag_type IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "public"."kit_build_flags" kbf 
    WHERE kbf.kit_po_number = "RR_Kitting_DATA".kit_po_number 
      AND kbf.flag_type = "RR_Kitting_DATA".kit_flag_type 
      AND kbf.is_active = true
  );
