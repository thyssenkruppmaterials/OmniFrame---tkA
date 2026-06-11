-- ============================================================================
-- Migration 186: Create complete_putaway_and_clear_cart() RPC
-- Description: Transactional RPC that atomically handles RF putaway completion
--              and cart assignment clearing. Prevents partial failures where
--              putaway inserts but cart clear fails (or vice versa).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_putaway_and_clear_cart(
  p_putaway_data JSONB,
  p_raw_to_number TEXT,
  p_material_number TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_putaway_id UUID;
  v_putaway_record RECORD;
  v_assignment RECORD;
  v_active_count INT;
  v_cart_number TEXT;
BEGIN
  -- Get caller identity
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get caller's organization
  SELECT organization_id INTO v_org_id
  FROM user_profiles
  WHERE id = v_user_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'User does not belong to any organization';
  END IF;

  -- Validate org matches the putaway data
  IF (p_putaway_data->>'organization_id')::UUID != v_org_id THEN
    RAISE EXCEPTION 'Access denied: organization mismatch';
  END IF;

  -- Step 1: Insert the putaway operation
  INSERT INTO rf_putaway_operations (
    id,
    organization_id,
    material_number,
    to_location,
    to_number,
    raw_to_number,
    warehouse,
    shelf_location,
    scanned_shelf_location,
    putaway_driver,
    to_status,
    is_mca_workflow,
    mca_reason,
    mca_reason_code,
    mca_drop_location,
    putaway_date,
    putaway_time,
    scanner_type,
    session_id,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    COALESCE((p_putaway_data->>'id')::UUID, gen_random_uuid()),
    (p_putaway_data->>'organization_id')::UUID,
    p_putaway_data->>'material_number',
    p_putaway_data->>'to_location',
    p_putaway_data->>'to_number',
    p_putaway_data->>'raw_to_number',
    p_putaway_data->>'warehouse',
    p_putaway_data->>'shelf_location',
    p_putaway_data->>'scanned_shelf_location',
    p_putaway_data->>'putaway_driver',
    COALESCE(p_putaway_data->>'to_status', 'Completed'),
    COALESCE((p_putaway_data->>'is_mca_workflow')::BOOLEAN, false),
    p_putaway_data->>'mca_reason',
    p_putaway_data->>'mca_reason_code',
    p_putaway_data->>'mca_drop_location',
    (p_putaway_data->>'putaway_date')::DATE,
    (p_putaway_data->>'putaway_time')::TIME,
    COALESCE(p_putaway_data->>'scanner_type', 'RF Terminal'),
    p_putaway_data->>'session_id',
    (p_putaway_data->>'created_by')::UUID,
    COALESCE((p_putaway_data->>'created_at')::TIMESTAMPTZ, now()),
    COALESCE((p_putaway_data->>'updated_at')::TIMESTAMPTZ, now())
  )
  RETURNING * INTO v_putaway_record;

  v_putaway_id := v_putaway_record.id;

  -- Step 2: Look for active cart assignment (with row lock)
  SELECT ca.*, sc.cart_number
  INTO v_assignment
  FROM inbound_cart_assignments ca
  JOIN inbound_stow_carts sc ON sc.id = ca.cart_id
  WHERE ca.organization_id = v_org_id
    AND ca.raw_to_number = p_raw_to_number
    AND ca.material_number = UPPER(TRIM(p_material_number))
    AND ca.status = 'on_cart'
  FOR UPDATE OF ca
  LIMIT 1;

  -- Step 3: If cart assignment found, clear it
  IF v_assignment.id IS NOT NULL THEN
    v_cart_number := v_assignment.cart_number;

    -- Clear the assignment
    UPDATE inbound_cart_assignments
    SET status = 'cleared',
        cleared_by = v_user_id,
        cleared_at = now(),
        clear_reason = 'putaway_completed',
        cleared_putaway_operation_id = v_putaway_id
    WHERE id = v_assignment.id;

    -- Update the putaway row with cart snapshot
    UPDATE rf_putaway_operations
    SET cart_stow_assignment_id = v_assignment.id,
        stow_cart_number = v_cart_number,
        stow_cart_cleared_at = now()
    WHERE id = v_putaway_id;

    -- Derive active count and update cart status
    SELECT COUNT(*) INTO v_active_count
    FROM inbound_cart_assignments
    WHERE cart_id = v_assignment.cart_id
      AND status = 'on_cart';

    IF v_active_count = 0 THEN
      UPDATE inbound_stow_carts
      SET status = 'Empty',
          updated_by = v_user_id
      WHERE id = v_assignment.cart_id;
    END IF;
  END IF;

  -- Return the created putaway record
  RETURN to_jsonb(v_putaway_record);
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_putaway_and_clear_cart(JSONB, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.complete_putaway_and_clear_cart IS
'Atomically inserts an RF putaway operation and clears the matching active cart assignment if one exists. Uses FOR UPDATE row locking to prevent concurrent clears. The entire operation is one transaction — any failure rolls back everything.';
