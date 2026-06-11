-- Migration 216: Track cycle count reassignments
--
-- When a count is reassigned to a different user, automatically:
--   1. Record who previously counted and what they counted
--   2. Zero out counted_quantity so the new counter starts fresh
--   3. Increment reassignment_count for quick UI indicators
--
-- Uses a BEFORE trigger so all assignment paths (RPC, Rust push/claim) are covered.

BEGIN;

-- =========================================================================
-- PART 1: Assignment history table
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.cycle_count_assignment_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  count_id UUID NOT NULL REFERENCES public.rr_cyclecount_data(id) ON DELETE CASCADE,

  previous_counter_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  previous_counter_name VARCHAR(100),
  previous_counted_quantity NUMERIC(10,3),
  previous_status TEXT,

  new_counter_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  new_counter_name VARCHAR(100),

  reassigned_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  reassigned_at TIMESTAMPTZ DEFAULT now() NOT NULL,

  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_assignment_history_count_id ON public.cycle_count_assignment_history(count_id);
CREATE INDEX idx_assignment_history_org ON public.cycle_count_assignment_history(organization_id);
CREATE INDEX idx_assignment_history_reassigned_at ON public.cycle_count_assignment_history(reassigned_at DESC);

ALTER TABLE cycle_count_assignment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view assignment history from their organization"
  ON cycle_count_assignment_history FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

-- Trigger inserts rows via SECURITY DEFINER context, so allow service-role inserts
CREATE POLICY "Service role can insert assignment history"
  ON cycle_count_assignment_history FOR INSERT
  WITH CHECK (true);

-- =========================================================================
-- PART 2: Add reassignment_count to main table
-- =========================================================================

ALTER TABLE rr_cyclecount_data
  ADD COLUMN IF NOT EXISTS reassignment_count INTEGER DEFAULT 0;

-- =========================================================================
-- PART 3: Trigger to track assignment changes and zero out for new counter
-- =========================================================================

CREATE OR REPLACE FUNCTION track_assignment_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  actor_id UUID;
  new_name TEXT;
BEGIN
  -- Only act on reassignments: assigned_to changes to a new non-null value
  IF NEW.assigned_to IS NOT NULL
     AND OLD.assigned_to IS DISTINCT FROM NEW.assigned_to
  THEN

    -- Resolve the acting user from Supabase JWT context
    BEGIN
      actor_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;
    EXCEPTION WHEN OTHERS THEN
      actor_id := NULL;
    END;

    -- Resolve new counter name (may already be set by the calling UPDATE)
    new_name := COALESCE(
      NEW.counter_name,
      (SELECT full_name FROM user_profiles WHERE id = NEW.assigned_to),
      'Unknown'
    );

    -- Record history when there was a previous assignee OR a previous count
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
    END IF;

    -- Zero out previous count for the new counter
    IF OLD.counted_quantity IS NOT NULL THEN
      NEW.counted_quantity := NULL;
      NEW.variance_quantity := NULL;
      NEW.variance_percentage := NULL;
      NEW.requires_recount := false;
      NEW.completed_at := NULL;
      NEW.count_date := NULL;
      NEW.count_time := NULL;

      -- Reset status: if it was completed/variance_review/approved, go to in_progress
      IF OLD.status IN ('completed', 'variance_review', 'approved') THEN
        NEW.status := 'in_progress';
      END IF;
    END IF;

    -- Increment reassignment counter
    NEW.reassignment_count := COALESCE(OLD.reassignment_count, 0) + 1;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_track_assignment_changes
  BEFORE UPDATE OF assigned_to ON rr_cyclecount_data
  FOR EACH ROW
  EXECUTE FUNCTION track_assignment_changes();

COMMENT ON FUNCTION track_assignment_changes() IS
  'Records assignment history and zeros out counted_quantity when a cycle count is reassigned to a different user.';

COMMENT ON TABLE cycle_count_assignment_history IS
  'Audit trail for cycle count reassignments: who previously counted, what they counted, and who reassigned.';

COMMIT;
