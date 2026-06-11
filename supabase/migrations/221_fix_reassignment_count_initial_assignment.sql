-- ============================================================================
-- Migration 221: Don't count the initial assignment as a "reassignment"
--
-- Bug: `track_assignment_changes()` (migration 216) incremented
-- `reassignment_count` on every `assigned_to` change, including the first
-- assignment to a user (when OLD.assigned_to was NULL). As a result the
-- dashboard showed "Reassigned" on counts that had only ever been assigned
-- once. The history-insert block above it was correctly guarded; only the
-- counter increment was too permissive.
--
-- Fix:
--   1. Rewrite the trigger to increment only when a real reassignment
--      happened (OLD.assigned_to IS NOT NULL).
--   2. Backfill `reassignment_count` on every existing row from the number
--      of `cycle_count_assignment_history` rows for that count — which is
--      the source of truth (each history row is a real reassignment event).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION track_assignment_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID;
  new_name TEXT;
BEGIN
  -- Only act on assignment changes where the NEW row has a real assignee.
  IF NEW.assigned_to IS NOT NULL
     AND OLD.assigned_to IS DISTINCT FROM NEW.assigned_to
  THEN

    -- Resolve the acting user from Supabase JWT context.
    BEGIN
      actor_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;
    EXCEPTION WHEN OTHERS THEN
      actor_id := NULL;
    END;

    -- Resolve the new counter name.
    new_name := COALESCE(
      NEW.counter_name,
      (SELECT full_name FROM user_profiles WHERE id = NEW.assigned_to),
      'Unknown'
    );

    -- History + counter bump both require there to have been a PREVIOUS
    -- assignment (or a previously-counted quantity with no assignee — rare
    -- edge case). Initial assignments (OLD.assigned_to IS NULL AND
    -- OLD.counted_quantity IS NULL) are NOT reassignments.
    IF OLD.assigned_to IS NOT NULL OR OLD.counted_quantity IS NOT NULL THEN
      INSERT INTO cycle_count_assignment_history (
        count_id,
        previous_counter_id,
        previous_counter_name,
        previous_counted_quantity,
        previous_status,
        new_counter_id,
        new_counter_name,
        reassigned_by,
        organization_id
      ) VALUES (
        OLD.id,
        OLD.assigned_to,
        OLD.counter_name,
        OLD.counted_quantity,
        OLD.status::text,
        NEW.assigned_to,
        new_name,
        COALESCE(actor_id, OLD.assigned_to),
        OLD.organization_id
      );

      -- Zero out the previous count so the new counter starts fresh.
      IF OLD.counted_quantity IS NOT NULL THEN
        NEW.counted_quantity := NULL;
        NEW.variance_quantity := NULL;
        NEW.variance_percentage := NULL;
        NEW.requires_recount := false;
        NEW.completed_at := NULL;
        NEW.count_date := NULL;
        NEW.count_time := NULL;

        IF OLD.status IN ('completed', 'variance_review', 'approved') THEN
          NEW.status := 'in_progress';
        END IF;
      END IF;

      -- Only now do we consider this a true reassignment.
      NEW.reassignment_count := COALESCE(OLD.reassignment_count, 0) + 1;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION track_assignment_changes() IS
  'Records assignment history, zeros out counted_quantity, and increments reassignment_count when a cycle count is reassigned from one user to another. Initial assignments (null -> user) are NOT counted as reassignments.';

-- =========================================================================
-- PART 2: Backfill reassignment_count from the history table
-- =========================================================================

UPDATE rr_cyclecount_data cc
SET reassignment_count = COALESCE(h.cnt, 0)
FROM (
  SELECT count_id, COUNT(*)::INTEGER AS cnt
  FROM cycle_count_assignment_history
  GROUP BY count_id
) h
WHERE cc.id = h.count_id
  AND COALESCE(cc.reassignment_count, 0) <> h.cnt;

-- Zero out rows that have no history entries but whose counter is > 0 (the
-- bug inflated them during initial assignment).
UPDATE rr_cyclecount_data cc
SET reassignment_count = 0
WHERE COALESCE(cc.reassignment_count, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM cycle_count_assignment_history h
    WHERE h.count_id = cc.id
  );

COMMIT;
