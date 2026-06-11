-- Fix: superadmin role was missing from the SELECT and UPDATE RLS policies,
-- preventing superadmins from seeing counts assigned to other users.

-- Drop the existing restrictive SELECT policy
DROP POLICY IF EXISTS "Users can view assigned or unassigned cycle counts from their o" ON rr_cyclecount_data;

-- Recreate with superadmin included
CREATE POLICY "Users can view cycle counts in their organization"
  ON rr_cyclecount_data FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND (
      assigned_to IS NULL
      OR assigned_to = auth.uid()
      OR created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM user_profiles up
        WHERE up.id = auth.uid()
          AND up.role = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'superadmin'::user_role])
      )
    )
  );

-- Also fix the UPDATE policy which has the same issue
DROP POLICY IF EXISTS "Users can update cycle count data in their organization" ON rr_cyclecount_data;

CREATE POLICY "Users can update cycle count data in their organization"
  ON rr_cyclecount_data FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND (
      assigned_to = auth.uid()
      OR created_by = auth.uid()
      OR status = 'pending'::cycle_count_status
      OR EXISTS (
        SELECT 1 FROM user_profiles up
        WHERE up.id = auth.uid()
          AND up.role = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'superadmin'::user_role])
      )
    )
  );

-- Also fix the DELETE policy
DROP POLICY IF EXISTS "Users can delete cycle counts in their organization" ON rr_cyclecount_data;

CREATE POLICY "Users can delete cycle counts in their organization"
  ON rr_cyclecount_data FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND (
      created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM user_profiles up
        WHERE up.id = auth.uid()
          AND up.role = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'superadmin'::user_role])
      )
    )
  );
