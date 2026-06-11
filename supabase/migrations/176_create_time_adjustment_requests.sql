-- Migration: Create Time Adjustment Requests
-- Date: February 25, 2026
-- Purpose: Table for associates to request time corrections via kiosk,
--          reviewed by supervisors in Shift Productivity

-- ============================================================================
-- STEP 1: Create the time_adjustment_requests table
-- ============================================================================

CREATE TABLE IF NOT EXISTS time_adjustment_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  requester_user_id uuid NOT NULL REFERENCES auth.users(id),
  requester_name    text NOT NULL,
  requester_badge   text NOT NULL,
  request_date      date NOT NULL,
  correction_type   text NOT NULL CHECK (correction_type IN ('add', 'delete', 'change')),
  clock_code        text NOT NULL CHECK (clock_code IN (
    'clock_in', 'clock_out', 'meal_in', 'meal_out',
    'vacation', 'floating_holiday', 'sick', 'other'
  )),
  reason_code       text NOT NULL,
  reason_other      text,
  hours_requested   numeric(5,2) CHECK (hours_requested IS NULL OR (hours_requested > 0 AND hours_requested <= 24)),
  signature_data_url text NOT NULL,
  department_area    text,
  supervisor_name    text,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  reviewer_user_id  uuid REFERENCES auth.users(id),
  reviewer_notes    text,
  reviewed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reason_other_required CHECK (
    reason_code != 'other' OR reason_other IS NOT NULL
  )
);

-- ============================================================================
-- STEP 2: Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_time_adj_org_status_created
  ON time_adjustment_requests (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_adj_requester_created
  ON time_adjustment_requests (requester_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_adj_org_date
  ON time_adjustment_requests (organization_id, request_date);

-- ============================================================================
-- STEP 3: updated_at trigger (function already exists from migration 031)
-- ============================================================================

CREATE TRIGGER set_time_adjustment_requests_updated_at
  BEFORE UPDATE ON time_adjustment_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 4: RLS policies
-- ============================================================================

ALTER TABLE time_adjustment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_insert_time_adjustment_requests"
  ON time_adjustment_requests
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "authenticated_select_time_adjustment_requests"
  ON time_adjustment_requests
  FOR SELECT
  TO authenticated
  USING (
    requester_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid()
        AND up.organization_id = time_adjustment_requests.organization_id
        AND r.name IN ('superadmin', 'admin', 'manager')
    )
  );

CREATE POLICY "authenticated_update_time_adjustment_requests"
  ON time_adjustment_requests
  FOR UPDATE
  TO authenticated
  USING (
    status = 'pending'
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid()
        AND up.organization_id = time_adjustment_requests.organization_id
        AND r.name IN ('superadmin', 'admin', 'manager')
    )
  )
  WITH CHECK (
    status IN ('approved', 'denied')
  );

-- ============================================================================
-- STEP 5: Tab definition for Shift Productivity
-- ============================================================================

INSERT INTO tab_definitions (page_resource, tab_id, tab_label, description, display_order, is_active)
VALUES (
  'shift_productivity',
  'time-adjustment-approvals',
  'Time Adjustment Approvals',
  'Review and approve/deny associate time adjustment requests',
  5,
  true
)
ON CONFLICT (page_resource, tab_id) DO UPDATE SET
  tab_label = EXCLUDED.tab_label,
  description = EXCLUDED.description,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- ============================================================================
-- STEP 6: Grant tab permissions to system roles
-- ============================================================================

INSERT INTO role_tab_permissions (role_id, tab_definition_id, granted)
SELECT
  r.id,
  td.id,
  true
FROM roles r
CROSS JOIN tab_definitions td
WHERE r.name = 'superadmin'
  AND td.page_resource = 'shift_productivity'
  AND td.tab_id = 'time-adjustment-approvals'
ON CONFLICT (role_id, tab_definition_id) DO UPDATE SET granted = true;

INSERT INTO role_tab_permissions (role_id, tab_definition_id, granted)
SELECT
  r.id,
  td.id,
  true
FROM roles r
CROSS JOIN tab_definitions td
WHERE r.name = 'admin'
  AND td.page_resource = 'shift_productivity'
  AND td.tab_id = 'time-adjustment-approvals'
ON CONFLICT (role_id, tab_definition_id) DO UPDATE SET granted = true;

INSERT INTO role_tab_permissions (role_id, tab_definition_id, granted)
SELECT
  r.id,
  td.id,
  true
FROM roles r
CROSS JOIN tab_definitions td
WHERE r.name = 'manager'
  AND td.page_resource = 'shift_productivity'
  AND td.tab_id = 'time-adjustment-approvals'
ON CONFLICT (role_id, tab_definition_id) DO UPDATE SET granted = true;

-- Grant to roles with shift_productivity navigation access
INSERT INTO role_tab_permissions (role_id, tab_definition_id, granted)
SELECT DISTINCT
  rnp.role_id,
  td.id,
  true
FROM role_navigation_permissions rnp
JOIN navigation_items ni ON ni.id = rnp.navigation_item_id
CROSS JOIN tab_definitions td
WHERE ni.url = '/apps/shift-productivity'
  AND rnp.visible = true
  AND td.page_resource = 'shift_productivity'
  AND td.tab_id = 'time-adjustment-approvals'
ON CONFLICT (role_id, tab_definition_id) DO UPDATE SET granted = true;

-- Log the migration
DO $$
BEGIN
  RAISE NOTICE 'time_adjustment_requests table created with RLS policies';
  RAISE NOTICE 'Tab definition time-adjustment-approvals added to shift_productivity';
  RAISE NOTICE 'Tab permissions granted to superadmin, admin, manager, and roles with navigation access';
END $$;
