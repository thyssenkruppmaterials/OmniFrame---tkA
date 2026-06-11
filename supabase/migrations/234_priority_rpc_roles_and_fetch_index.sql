-- ============================================================================
-- Migration 234: Priority RPC role parity + fetchCycleCountData supporting index
--
-- Two unrelated reports during 2026-04-25 RF testing:
--
-- 1. "Failed to update priority" toasted in the dashboard. The user's role
--    is `superadmin`, but `public.update_cycle_count_priority` (created
--    in migration 037) only accepts `admin` / `manager`. After 233 added
--    `logistics_coordinator` to the cycle-count RLS, the priority RPC's
--    role list is now also out of sync. Bring it in line:
--    admin / manager / superadmin / logistics_coordinator are all valid
--    callers (plus the row's creator, as before).
--
-- 2. Manual Counts grid timed out: `canceling statement due to statement
--    timeout (57014)` from `fetchCycleCountData`. The chunked fetch sorts
--    on `(created_at DESC, id DESC)` and pages with OFFSET. With ~9k rows
--    in the org, deep offsets fall back to an external-merge sort because
--    no index covers the (organization_id, created_at DESC, id DESC) tuple
--    used by the ORDER BY. Add the supporting index so each chunk is a
--    cheap index range scan.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. update_cycle_count_priority — extended role list + safe search_path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_cycle_count_priority(
  count_id uuid,
  new_priority cycle_count_priority
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  count_org_id        uuid;
  current_user_org_id uuid;
  old_priority        cycle_count_priority;
BEGIN
  SELECT organization_id INTO current_user_org_id
  FROM user_profiles WHERE id = auth.uid();

  IF current_user_org_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Current user not found or not associated with an organization'
    );
  END IF;

  SELECT organization_id, priority INTO count_org_id, old_priority
  FROM rr_cyclecount_data WHERE id = count_id;

  IF count_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Cycle count not found');
  END IF;

  IF count_org_id != current_user_org_id THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot modify count from different organization'
    );
  END IF;

  -- Permission check kept aligned with rr_cyclecount_data RLS (migration 233).
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
      AND (
        up.role IN ('admin', 'manager', 'superadmin', 'logistics_coordinator')
        OR EXISTS (
          SELECT 1 FROM rr_cyclecount_data cc
          WHERE cc.id = count_id AND cc.created_by = auth.uid()
        )
      )
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Insufficient permissions to update cycle count priority'
    );
  END IF;

  UPDATE rr_cyclecount_data
  SET priority = new_priority,
      updated_at = NOW()
  WHERE id = count_id;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cycle count not found or could not be updated'
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'message', 'Cycle count priority updated from '
               || UPPER(old_priority::text)
               || ' to '
               || UPPER(new_priority::text)
  );
END;
$$;

COMMENT ON FUNCTION public.update_cycle_count_priority(uuid, cycle_count_priority) IS
  'Update priority of a single cycle count row. Caller must be the row creator OR have role admin/manager/superadmin/logistics_coordinator (migration 234 brings this in line with cycle-count RLS).';

-- ---------------------------------------------------------------------------
-- 2. Composite index supporting the dashboard chunked fetch
-- ---------------------------------------------------------------------------
-- ORDER BY in cycle-count.service.ts fetchCycleCountData() is
--   ORDER BY created_at DESC, id DESC
-- under WHERE organization_id = $org. The existing
-- idx_rr_cyclecount_data_created_at is global (no org column) and forces
-- a full sort when chunks page deep. This index is laid out exactly to
-- match the page query so each chunk is a tight index range scan.
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_org_created_id_desc
ON rr_cyclecount_data (organization_id, created_at DESC, id DESC);

COMMENT ON INDEX idx_rr_cyclecount_org_created_id_desc IS
  'Supports fetchCycleCountData chunked SELECT with ORDER BY (created_at DESC, id DESC) WHERE organization_id = ? — keeps deep-offset pages out of external-merge sort. Migration 234.';

COMMIT;
