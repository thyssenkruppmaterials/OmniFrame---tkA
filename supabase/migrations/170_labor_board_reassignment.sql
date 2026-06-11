-- Labor Board Reassignment RPC
-- Created: February 7, 2026
-- Purpose: Atomic associate area reassignment with optimistic locking, capacity validation, and audit logging

-- Enable Realtime for shift_assignments (if not already)
DO $$
BEGIN
  -- Check if shift_assignments is already in the publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'shift_assignments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.shift_assignments;
  END IF;
END $$;

-- RPC: Reassign an associate to a new working area
CREATE OR REPLACE FUNCTION reassign_associate_to_area(
  p_user_id UUID,
  p_organization_id UUID,
  p_new_area_id UUID DEFAULT NULL,
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_reassigned_by UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment RECORD;
  v_area RECORD;
  v_current_count INT;
  v_old_area_name TEXT;
  v_new_area_name TEXT;
BEGIN
  -- 1. Find active primary assignment with row lock
  SELECT sa.*, wa.area_name as current_area_name
  INTO v_assignment
  FROM shift_assignments sa
  LEFT JOIN working_areas wa ON wa.id = sa.working_area_id
  WHERE sa.user_id = p_user_id 
    AND sa.organization_id = p_organization_id
    AND sa.status = 'active' 
    AND sa.is_primary_position = true
  FOR UPDATE OF sa;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'ASSIGNMENT_NOT_FOUND');
  END IF;

  -- 2. Optimistic concurrency check (skip if no expected timestamp provided)
  IF p_expected_updated_at IS NOT NULL AND v_assignment.updated_at != p_expected_updated_at THEN
    RETURN json_build_object('success', false, 'error', 'CONCURRENT_MODIFICATION');
  END IF;

  -- 3. Skip if same area (no-op)
  IF (v_assignment.working_area_id IS NOT DISTINCT FROM p_new_area_id) THEN
    RETURN json_build_object('success', true, 'assignment_id', v_assignment.id, 'noop', true);
  END IF;

  -- 4. Capacity check (if moving to an area, not unassigning)
  IF p_new_area_id IS NOT NULL THEN
    SELECT * INTO v_area 
    FROM working_areas
    WHERE id = p_new_area_id 
      AND organization_id = p_organization_id 
      AND is_active = true;

    IF NOT FOUND THEN
      RETURN json_build_object('success', false, 'error', 'AREA_NOT_FOUND');
    END IF;

    v_new_area_name := v_area.area_name;

    IF v_area.capacity IS NOT NULL THEN
      SELECT COUNT(*) INTO v_current_count 
      FROM shift_assignments
      WHERE working_area_id = p_new_area_id 
        AND organization_id = p_organization_id
        AND status = 'active' 
        AND is_primary_position = true
        AND user_id != p_user_id;  -- Don't count the person being moved

      IF v_current_count >= v_area.capacity THEN
        RETURN json_build_object(
          'success', false, 
          'error', 'AREA_AT_CAPACITY',
          'capacity', v_area.capacity, 
          'current', v_current_count
        );
      END IF;
    END IF;
  ELSE
    v_new_area_name := 'Unassigned';
  END IF;

  -- Store old area name
  v_old_area_name := COALESCE(v_assignment.current_area_name, 'Unassigned');

  -- 5. Perform the update
  UPDATE shift_assignments
  SET working_area_id = p_new_area_id, 
      updated_at = now()
  WHERE id = v_assignment.id;

  -- 6. Audit log
  INSERT INTO audit_logs (user_id, action, resource_type, resource_id, changes, organization_id, created_at)
  VALUES (
    COALESCE(p_reassigned_by, auth.uid()),
    'update'::audit_action,
    'shift_assignment',
    v_assignment.id,
    jsonb_build_object(
      'type', 'reassign_area',
      'associate_user_id', p_user_id,
      'associate_name', (SELECT COALESCE(full_name, email) FROM user_profiles WHERE id = p_user_id),
      'from_area_id', v_assignment.working_area_id,
      'from_area_name', v_old_area_name,
      'to_area_id', p_new_area_id,
      'to_area_name', v_new_area_name,
      'reason', p_reason
    ),
    p_organization_id,
    now()
  );

  RETURN json_build_object(
    'success', true, 
    'assignment_id', v_assignment.id,
    'from_area_id', v_assignment.working_area_id,
    'to_area_id', p_new_area_id
  );
END;
$$;

-- Grant execute to authenticated users (RLS on underlying tables still applies)
-- TODO: Future enhancements for the reassign_associate_to_area function:
-- 1. PERMISSION_DENIED: Add role/permission check (e.g., verify p_reassigned_by has 'shift_assignments:update' permission)
-- 2. CERTIFICATION_REQUIRED: Check working_areas.requires_certification and compare against associate's certifications
-- These error codes are defined in the TypeScript ReassignmentError type but not yet implemented server-side.

GRANT EXECUTE ON FUNCTION reassign_associate_to_area TO authenticated;

-- Add comment
COMMENT ON FUNCTION reassign_associate_to_area IS 'Atomically reassign an associate to a new working area with optimistic locking, capacity validation, and audit logging. Used by the Labor Board feature.';
