-- Migration: Fix UPDATE policy for time_adjustment_requests
-- Date: March 5, 2026
-- Purpose: The old policy only allowed UPDATE when status='pending' and
--          required new status to be approved/denied. This blocked notes-only
--          edits on already-reviewed requests. The new policy allows managers
--          to update any request in their org.

DROP POLICY IF EXISTS "authenticated_update_time_adjustment_requests" ON time_adjustment_requests;

CREATE POLICY "authenticated_update_time_adjustment_requests"
  ON time_adjustment_requests
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid()
        AND up.organization_id = time_adjustment_requests.organization_id
        AND r.name IN ('superadmin', 'admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid()
        AND up.organization_id = time_adjustment_requests.organization_id
        AND r.name IN ('superadmin', 'admin', 'manager')
    )
  );

DO $$
BEGIN
  RAISE NOTICE 'Fixed UPDATE policy to allow notes edits on any status';
END $$;
