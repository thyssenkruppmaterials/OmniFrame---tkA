-- Fix cycle count number uniqueness constraint
-- Migration: 199_fix_cycle_count_number_uniqueness.sql
-- Problem: count_number has a global UNIQUE constraint causing collisions across
--   organizations and race conditions during concurrent inserts.
-- Solution: Scope uniqueness to (organization_id, count_number) and add advisory
--   locking to the generator function.

-- Step 1: Drop the global unique constraint on count_number
ALTER TABLE rr_cyclecount_data DROP CONSTRAINT IF EXISTS "rr_CycleCount_Data_Count_Number_Key";
ALTER TABLE rr_cyclecount_data DROP CONSTRAINT IF EXISTS rr_cyclecount_data_count_number_key;

-- Step 2: Add organization-scoped unique constraint
ALTER TABLE rr_cyclecount_data
  ADD CONSTRAINT rr_cyclecount_data_org_count_number_key
  UNIQUE (organization_id, count_number);

-- Step 3: Drop old no-arg function, then create the new org-aware version
DROP FUNCTION IF EXISTS generate_count_number();

CREATE OR REPLACE FUNCTION generate_count_number(p_organization_id UUID DEFAULT NULL)
RETURNS VARCHAR(50)
LANGUAGE plpgsql
AS $$
DECLARE
  v_org_id UUID;
  v_count_date TEXT;
  v_sequence_num INTEGER;
  v_count_number VARCHAR(50);
  v_lock_key BIGINT;
BEGIN
  -- Resolve organization_id: parameter > current user's profile
  v_org_id := p_organization_id;
  IF v_org_id IS NULL THEN
    SELECT organization_id INTO v_org_id
    FROM user_profiles
    WHERE id = auth.uid();
  END IF;

  -- Date prefix
  v_count_date := to_char(CURRENT_DATE, 'YYYYMMDD');

  -- Advisory lock keyed on (org hash XOR date hash) to serialise per-org per-day
  v_lock_key := abs(hashtext(COALESCE(v_org_id::text, '') || v_count_date));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Next sequence within this org + date
  SELECT COALESCE(
    MAX(
      CAST(
        SUBSTRING(count_number FROM 'CC-' || v_count_date || '-(.+)')
        AS INTEGER
      )
    ), 0
  ) + 1
  INTO v_sequence_num
  FROM rr_cyclecount_data
  WHERE count_number LIKE 'CC-' || v_count_date || '-%'
    AND (v_org_id IS NULL OR organization_id = v_org_id);

  v_count_number := 'CC-' || v_count_date || '-' || LPAD(v_sequence_num::TEXT, 4, '0');

  RETURN v_count_number;
END;
$$;

COMMENT ON FUNCTION generate_count_number(UUID) IS
  'Generate a unique CC-YYYYMMDD-XXXX count number, scoped per organization with advisory locking to prevent race conditions.';
