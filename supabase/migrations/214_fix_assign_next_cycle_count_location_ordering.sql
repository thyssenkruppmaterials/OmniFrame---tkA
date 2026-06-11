-- ============================================================================
-- Migration 214: Fix assign_next_cycle_count location ordering
-- Description: Updates the legacy assign_next_cycle_count RPC to order by
--              resolved location path (zone → aisle → sequence) instead of
--              created_at, ensuring RF operators receive counts in efficient
--              warehouse traversal order.
-- ============================================================================

CREATE OR REPLACE FUNCTION assign_next_cycle_count(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  assigned_count rr_cyclecount_data%ROWTYPE;
  user_org_id uuid;
BEGIN
  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = p_user_id;

  IF user_org_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'message', 'User not found or missing organization',
      'data', NULL
    );
  END IF;

  SELECT * INTO assigned_count
  FROM rr_cyclecount_data
  WHERE organization_id = user_org_id
    AND status IN ('pending', 'recount')
    AND (assigned_to IS NULL OR assigned_to = p_user_id)
  ORDER BY
    CASE priority
      WHEN 'critical' THEN 1
      WHEN 'hot' THEN 2
      WHEN 'normal' THEN 3
      WHEN 'low' THEN 4
      ELSE 5
    END ASC,
    CASE WHEN resolution_source = 'unresolved' OR resolution_source IS NULL THEN 1 ELSE 0 END ASC,
    resolved_zone ASC NULLS LAST,
    resolved_aisle ASC NULLS LAST,
    resolved_sequence ASC NULLS LAST,
    location ASC,
    created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF assigned_count IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'message', 'No pending cycle counts available',
      'data', NULL
    );
  END IF;

  UPDATE rr_cyclecount_data
  SET
    assigned_to = p_user_id,
    assigned_at = NOW(),
    status = 'in_progress',
    updated_at = NOW()
  WHERE id = assigned_count.id;

  RETURN json_build_object(
    'success', true,
    'message', 'Cycle count assigned successfully',
    'data', json_build_object(
      'id', assigned_count.id,
      'count_number', assigned_count.count_number,
      'material_number', assigned_count.material_number,
      'material_description', assigned_count.material_description,
      'location', assigned_count.location,
      'warehouse', assigned_count.warehouse,
      'system_quantity', assigned_count.system_quantity,
      'unit_of_measure', assigned_count.unit_of_measure,
      'count_type', assigned_count.count_type,
      'status', 'in_progress',
      'assigned_to', p_user_id,
      'assigned_at', NOW(),
      'counted_quantity', assigned_count.counted_quantity,
      'requires_recount', assigned_count.requires_recount,
      'recount_completed', assigned_count.recount_completed
    )
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('error', 'Failed to assign cycle count: ' || SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION assign_next_cycle_count(uuid) TO authenticated;
