-- Migration: Add notes column and note edit history for time adjustment requests
-- Date: March 5, 2026
-- Purpose: Allow supervisors to add/edit notes on time adjustment requests
--          with full edit history tracking.

-- Step 1: Add notes column to time_adjustment_requests
ALTER TABLE time_adjustment_requests
  ADD COLUMN IF NOT EXISTS notes text;

-- Step 2: Create note history table
CREATE TABLE IF NOT EXISTS time_adjustment_note_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid NOT NULL REFERENCES time_adjustment_requests(id) ON DELETE CASCADE,
  note_content     text NOT NULL,
  previous_content text,
  edited_by_user_id uuid NOT NULL REFERENCES auth.users(id),
  edited_by_name   text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ta_note_history_request
  ON time_adjustment_note_history (request_id, created_at DESC);

-- Step 3: RLS on note history
ALTER TABLE time_adjustment_note_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_select_ta_note_history"
  ON time_adjustment_note_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid()
        AND up.organization_id = (
          SELECT organization_id FROM time_adjustment_requests WHERE id = request_id
        )
        AND r.name IN ('superadmin', 'admin', 'manager')
    )
  );

CREATE POLICY "authenticated_insert_ta_note_history"
  ON time_adjustment_note_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid()
        AND up.organization_id = (
          SELECT organization_id FROM time_adjustment_requests WHERE id = request_id
        )
        AND r.name IN ('superadmin', 'admin', 'manager')
    )
  );

DO $$
BEGIN
  RAISE NOTICE 'Added notes column and time_adjustment_note_history table';
END $$;
