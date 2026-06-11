-- Migration: Add Unique Constraint to rr_all_deliveries for Upsert Support
-- Date: 2025-11-05
-- Description: Add unique constraint on (delivery, organization_id) to support upsert operations
--              This allows import functionality to update existing records instead of creating duplicates
--              and preserves manually-set disposition data during imports

-- Step 1: Clean up any existing duplicates (keep most recent)
-- This ensures the unique constraint can be added successfully
WITH duplicate_groups AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY delivery, organization_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC, id DESC
    ) as row_num
  FROM rr_all_deliveries
  WHERE delivery IS NOT NULL
)
DELETE FROM rr_all_deliveries
WHERE id IN (
  SELECT id FROM duplicate_groups WHERE row_num > 1
);

-- Step 2: Create unique constraint on (delivery, organization_id)
-- This enables upsert operations: UPDATE existing records or INSERT new ones
-- Dispositions and other manually-set data are preserved during updates
ALTER TABLE rr_all_deliveries
ADD CONSTRAINT rr_all_deliveries_delivery_org_unique 
UNIQUE (delivery, organization_id);

-- Step 3: Add index for performance (if not already exists from previous migrations)
-- This index supports both the unique constraint and common query patterns
CREATE INDEX IF NOT EXISTS idx_rr_all_deliveries_delivery_lookup
ON rr_all_deliveries(delivery, organization_id);

-- Step 4: Add comment explaining the constraint
COMMENT ON CONSTRAINT rr_all_deliveries_delivery_org_unique ON rr_all_deliveries IS 
'Ensures no duplicate delivery records per organization. Enables upsert operations during data imports to update existing records while preserving manually-set fields like dispositions.';

-- Step 5: Verify no duplicates remain
DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT delivery, organization_id, COUNT(*) as cnt
    FROM rr_all_deliveries
    WHERE delivery IS NOT NULL
    GROUP BY delivery, organization_id
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF duplicate_count > 0 THEN
    RAISE WARNING 'Found % duplicate delivery groups after cleanup. Manual review recommended.', duplicate_count;
  ELSE
    RAISE NOTICE 'No duplicates found. Unique constraint successfully applied.';
  END IF;
END $$;

