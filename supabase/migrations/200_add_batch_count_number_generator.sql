-- Add batch count number generator that reserves N sequential numbers atomically.
-- The advisory lock is held for the entire function so no other caller can
-- generate overlapping numbers between the MAX read and the caller's INSERT.

CREATE OR REPLACE FUNCTION generate_count_numbers(
  p_organization_id UUID,
  p_count INTEGER DEFAULT 1
)
RETURNS TEXT[]
LANGUAGE plpgsql
AS $$
DECLARE
  v_org_id UUID;
  v_count_date TEXT;
  v_start_seq INTEGER;
  v_lock_key BIGINT;
  v_result TEXT[];
BEGIN
  v_org_id := p_organization_id;
  IF v_org_id IS NULL THEN
    SELECT organization_id INTO v_org_id
    FROM user_profiles
    WHERE id = auth.uid();
  END IF;

  v_count_date := to_char(CURRENT_DATE, 'YYYYMMDD');

  -- Same advisory lock key as generate_count_number so they serialise against each other
  v_lock_key := abs(hashtext(COALESCE(v_org_id::text, '') || v_count_date));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT COALESCE(
    MAX(
      CAST(
        SUBSTRING(count_number FROM 'CC-' || v_count_date || '-(.+)')
        AS INTEGER
      )
    ), 0
  ) + 1
  INTO v_start_seq
  FROM rr_cyclecount_data
  WHERE count_number LIKE 'CC-' || v_count_date || '-%'
    AND (v_org_id IS NULL OR organization_id = v_org_id);

  -- Build array of reserved count numbers
  SELECT array_agg('CC-' || v_count_date || '-' || LPAD((v_start_seq + i)::TEXT, 4, '0'))
  INTO v_result
  FROM generate_series(0, p_count - 1) AS i;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION generate_count_numbers(UUID, INTEGER) IS
  'Atomically reserve N sequential CC-YYYYMMDD-XXXX count numbers for an organization.';
