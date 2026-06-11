-- Migration: Add INCORA and Authorized to Ship Short columns
-- Date: 2026-01-10
-- Description: Adds columns to store INCORA items and Authorized to Ship Short items for kit build sheets

-- Add incora_items column (JSONB array to store up to 7 INCORA entries)
-- Each entry can have: { lineNumber: number, value: string }
ALTER TABLE "RR_Kitting_DATA"
ADD COLUMN IF NOT EXISTS incora_items JSONB DEFAULT '[]'::jsonb;

-- Add authorized_ship_short_items column (JSONB array to store up to 7 entries)
-- Each entry can have: { lineNumber: number, partNumber: string, description: string, authorizedBy: string }
ALTER TABLE "RR_Kitting_DATA"
ADD COLUMN IF NOT EXISTS authorized_ship_short_items JSONB DEFAULT '[]'::jsonb;

-- Add shortage_items column for the TO's SHORTAGE section
-- Each entry can have: { lineNumber: number, toNumber: string, shortageDescription: string }
ALTER TABLE "RR_Kitting_DATA"
ADD COLUMN IF NOT EXISTS shortage_items JSONB DEFAULT '[]'::jsonb;

-- Create indexes for JSON querying
CREATE INDEX IF NOT EXISTS idx_rr_kitting_incora_items 
ON "RR_Kitting_DATA" USING GIN (incora_items);

CREATE INDEX IF NOT EXISTS idx_rr_kitting_ship_short_items 
ON "RR_Kitting_DATA" USING GIN (authorized_ship_short_items);

-- Add comment for documentation
COMMENT ON COLUMN "RR_Kitting_DATA".incora_items IS 'JSON array of INCORA items for the kit build sheet. Format: [{lineNumber, value}]';
COMMENT ON COLUMN "RR_Kitting_DATA".authorized_ship_short_items IS 'JSON array of Authorized to Ship Short items. Format: [{lineNumber, partNumber, description, authorizedBy}]';
COMMENT ON COLUMN "RR_Kitting_DATA".shortage_items IS 'JSON array of shortage items for TOs. Format: [{lineNumber, toNumber, shortageDescription}]';

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 101: Added INCORA, Authorized Ship Short, and Shortage columns to RR_Kitting_DATA';
END $$;
