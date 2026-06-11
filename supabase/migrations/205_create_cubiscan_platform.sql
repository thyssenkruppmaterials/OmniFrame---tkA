-- ============================================================================
-- Migration 205: CubiScan Platform
-- Description: Full schema for the CubiScan dimensional scanning integration.
--              Tables for devices, sessions, ingest events, measurements,
--              reconciliation actions, tab/permission seeding, and RLS.
-- ============================================================================

-- =========================================================================
-- PART 1: Tables
-- =========================================================================

-- 1a. cubiscan_devices — registered CubiScan stations
CREATE TABLE IF NOT EXISTS public.cubiscan_devices (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id             TEXT NOT NULL,
  device_name           TEXT NOT NULL,
  model                 TEXT NOT NULL DEFAULT '',
  firmware_version      TEXT NOT NULL DEFAULT '',
  connection_method     TEXT NOT NULL DEFAULT 'serial'
    CHECK (connection_method IN ('serial', 'usb', 'tcp', 'ethernet')),
  endpoint_config       TEXT NOT NULL DEFAULT '',
  calibration_metadata  JSONB,
  health_score          NUMERIC(5,2),
  last_heartbeat_at     TIMESTAMPTZ,
  connection_state      TEXT NOT NULL DEFAULT 'offline'
    CHECK (connection_state IN ('online', 'offline', 'measuring', 'error', 'calibrating', 'stale')),
  station_id            TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cubiscan_devices_org_device UNIQUE (organization_id, device_id)
);

-- 1b. cubiscan_device_sessions — operator sessions per device
CREATE TABLE IF NOT EXISTS public.cubiscan_device_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id             UUID NOT NULL REFERENCES public.cubiscan_devices(id) ON DELETE CASCADE,
  organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  operator_id           UUID REFERENCES public.user_profiles(id),
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at     TIMESTAMPTZ,
  ended_at              TIMESTAMPTZ,
  status                TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'stale', 'ended')),
  measurements_count    INTEGER NOT NULL DEFAULT 0,
  errors_count          INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1c. cubiscan_ingest_events — append-only raw event ledger
CREATE TABLE IF NOT EXISTS public.cubiscan_ingest_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id             UUID NOT NULL REFERENCES public.cubiscan_devices(id) ON DELETE CASCADE,
  event_type            TEXT NOT NULL
    CHECK (event_type IN ('measurement_received', 'measurement_failed', 'heartbeat', 'device_state_changed', 'bridge_error')),
  raw_payload           JSONB NOT NULL DEFAULT '{}',
  parsed_payload        JSONB,
  payload_hash          TEXT,
  idempotency_key       TEXT,
  correlation_id        UUID DEFAULT gen_random_uuid(),
  retry_count           INTEGER NOT NULL DEFAULT 0,
  error_code            TEXT,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1d. cubiscan_measurements — normalized dimensional records
CREATE TABLE IF NOT EXISTS public.cubiscan_measurements (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id                 UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id                       UUID NOT NULL REFERENCES public.cubiscan_devices(id) ON DELETE CASCADE,
  session_id                      UUID REFERENCES public.cubiscan_device_sessions(id),
  ingest_event_id                 UUID REFERENCES public.cubiscan_ingest_events(id),
  measured_at                     TIMESTAMPTZ NOT NULL,
  barcode_raw                     TEXT NOT NULL,
  barcode_normalized              TEXT,
  material_number                 TEXT,
  material_description            TEXT,
  reference_type                  TEXT,
  reference_id                    TEXT,
  length                          NUMERIC(12,4) NOT NULL CHECK (length > 0),
  width                           NUMERIC(12,4) NOT NULL CHECK (width > 0),
  height                          NUMERIC(12,4) NOT NULL CHECK (height > 0),
  weight                          NUMERIC(12,4) NOT NULL CHECK (weight > 0),
  dimensional_weight              NUMERIC(12,4) GENERATED ALWAYS AS (length * width * height / dim_factor) STORED,
  volume                          NUMERIC(16,4) GENERATED ALWAYS AS (length * width * height) STORED,
  dimension_unit                  TEXT NOT NULL DEFAULT 'cm' CHECK (dimension_unit IN ('cm', 'in')),
  weight_unit                     TEXT NOT NULL DEFAULT 'kg' CHECK (weight_unit IN ('kg', 'lb')),
  dim_factor                      NUMERIC(10,2) NOT NULL DEFAULT 5000,
  stability_score                 NUMERIC(5,4),
  measurement_status              TEXT NOT NULL DEFAULT 'received'
    CHECK (measurement_status IN ('received', 'parsed', 'parse_failed', 'validated', 'mismatch', 'superseded')),
  reconciliation_status           TEXT NOT NULL DEFAULT 'pending'
    CHECK (reconciliation_status IN ('pending', 'approved', 'applied', 'rejected', 'quarantined', 'overridden')),
  superseded_by_measurement_id    UUID REFERENCES public.cubiscan_measurements(id),
  operator_id                     UUID REFERENCES public.user_profiles(id),
  notes                           TEXT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1e. cubiscan_reconciliation_actions — audit trail for approvals/overrides
CREATE TABLE IF NOT EXISTS public.cubiscan_reconciliation_actions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id        UUID NOT NULL REFERENCES public.cubiscan_measurements(id) ON DELETE CASCADE,
  action_type           TEXT NOT NULL
    CHECK (action_type IN ('approve', 'reject', 'apply', 'quarantine', 'override', 'reprocess')),
  previous_status       TEXT NOT NULL,
  new_status            TEXT NOT NULL,
  target_table          TEXT,
  target_id             TEXT,
  payload               JSONB,
  actor_id              UUID NOT NULL REFERENCES public.user_profiles(id),
  actor_name            TEXT,
  reason                TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================================
-- PART 2: Indexes
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_cubiscan_devices_org
  ON public.cubiscan_devices (organization_id);
CREATE INDEX IF NOT EXISTS idx_cubiscan_devices_org_state
  ON public.cubiscan_devices (organization_id, connection_state);
CREATE INDEX IF NOT EXISTS idx_cubiscan_devices_heartbeat
  ON public.cubiscan_devices (organization_id, last_heartbeat_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_cubiscan_sessions_device
  ON public.cubiscan_device_sessions (device_id, status);
CREATE INDEX IF NOT EXISTS idx_cubiscan_sessions_org
  ON public.cubiscan_device_sessions (organization_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_cubiscan_ingest_org_ts
  ON public.cubiscan_ingest_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cubiscan_ingest_device_ts
  ON public.cubiscan_ingest_events (device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cubiscan_ingest_idempotency
  ON public.cubiscan_ingest_events (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cubiscan_meas_org_ts
  ON public.cubiscan_measurements (organization_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_cubiscan_meas_org_device_ts
  ON public.cubiscan_measurements (organization_id, device_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_cubiscan_meas_org_status
  ON public.cubiscan_measurements (organization_id, measurement_status, reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_cubiscan_meas_barcode
  ON public.cubiscan_measurements (organization_id, barcode_raw);
CREATE INDEX IF NOT EXISTS idx_cubiscan_meas_material
  ON public.cubiscan_measurements (organization_id, material_number) WHERE material_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cubiscan_meas_pending_review
  ON public.cubiscan_measurements (organization_id, created_at DESC)
  WHERE reconciliation_status IN ('pending', 'quarantined');

CREATE INDEX IF NOT EXISTS idx_cubiscan_recon_measurement
  ON public.cubiscan_reconciliation_actions (measurement_id, created_at ASC);

-- =========================================================================
-- PART 3: RLS
-- =========================================================================

ALTER TABLE public.cubiscan_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cubiscan_device_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cubiscan_ingest_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cubiscan_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cubiscan_reconciliation_actions ENABLE ROW LEVEL SECURITY;

-- Org-scoped SELECT for authenticated users
CREATE POLICY "Users can view CubiScan devices in their org"
  ON public.cubiscan_devices FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can view CubiScan sessions in their org"
  ON public.cubiscan_device_sessions FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can view CubiScan ingest events in their org"
  ON public.cubiscan_ingest_events FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can view CubiScan measurements in their org"
  ON public.cubiscan_measurements FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can view CubiScan reconciliation actions"
  ON public.cubiscan_reconciliation_actions FOR SELECT TO authenticated
  USING (measurement_id IN (
    SELECT m.id FROM public.cubiscan_measurements m
    WHERE m.organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  ));

-- Admin INSERT/UPDATE for authenticated users
CREATE POLICY "Admins can manage CubiScan devices"
  ON public.cubiscan_devices FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles up
    JOIN public.roles r ON up.role_id = r.id
    WHERE up.id = auth.uid() AND r.name IN ('superadmin', 'admin')
    AND up.organization_id = cubiscan_devices.organization_id
  ));

CREATE POLICY "Authenticated users can insert CubiScan reconciliation actions"
  ON public.cubiscan_reconciliation_actions FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());

-- Service role: full access for bridge ingest
CREATE POLICY "Service role full access cubiscan_devices"
  ON public.cubiscan_devices FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access cubiscan_device_sessions"
  ON public.cubiscan_device_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access cubiscan_ingest_events"
  ON public.cubiscan_ingest_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access cubiscan_measurements"
  ON public.cubiscan_measurements FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access cubiscan_reconciliation_actions"
  ON public.cubiscan_reconciliation_actions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =========================================================================
-- PART 4: Updated_at trigger
-- =========================================================================

CREATE OR REPLACE FUNCTION public.cubiscan_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cubiscan_devices_updated_at
  BEFORE UPDATE ON public.cubiscan_devices
  FOR EACH ROW EXECUTE FUNCTION public.cubiscan_set_updated_at();

CREATE TRIGGER trg_cubiscan_measurements_updated_at
  BEFORE UPDATE ON public.cubiscan_measurements
  FOR EACH ROW EXECUTE FUNCTION public.cubiscan_set_updated_at();

-- =========================================================================
-- PART 5: Tab definition
-- =========================================================================

INSERT INTO tab_definitions (page_resource, tab_id, tab_label, description, display_order, is_active)
VALUES ('inventory_apps', 'cubiscan', 'CubiScan', 'CubiScan dimensional scanning and weighing integration', 5, true)
ON CONFLICT (page_resource, tab_id) DO NOTHING;

-- Shift existing tabs that were at display_order >= 5
UPDATE tab_definitions
SET display_order = display_order + 1
WHERE page_resource = 'inventory_apps'
  AND tab_id != 'cubiscan'
  AND display_order >= 5;

-- =========================================================================
-- PART 6: Seed role_tab_permissions (sibling-copy from existing inventory tabs)
-- =========================================================================

INSERT INTO role_tab_permissions (role_id, tab_definition_id, granted)
SELECT DISTINCT rtp.role_id, td.id, true
FROM role_tab_permissions rtp
JOIN tab_definitions td_existing ON rtp.tab_definition_id = td_existing.id
CROSS JOIN tab_definitions td
WHERE td_existing.page_resource = 'inventory_apps'
  AND rtp.granted = true
  AND td.page_resource = 'inventory_apps'
  AND td.tab_id = 'cubiscan'
ON CONFLICT (role_id, tab_definition_id) DO NOTHING;

-- =========================================================================
-- PART 7: Dedicated resource permissions for CubiScan actions
-- =========================================================================

DO $$
DECLARE
  v_cat_id UUID;
BEGIN
  INSERT INTO permission_categories (name, display_name, description, display_order)
  VALUES ('cubiscan_management', 'CubiScan Management', 'CubiScan dimensional scanning permissions', 50)
  ON CONFLICT (name) DO NOTHING;

  SELECT id INTO v_cat_id FROM permission_categories WHERE name = 'cubiscan_management';

  INSERT INTO permissions (name, resource, action, description, category_id, scope, risk_level)
  VALUES
    ('cubiscan.view',     'cubiscan', 'read',     'View CubiScan measurements and devices',     v_cat_id, 'organization', 'low'),
    ('cubiscan.scan',     'cubiscan', 'scan',     'Receive and process CubiScan measurements',  v_cat_id, 'organization', 'medium'),
    ('cubiscan.create',   'cubiscan', 'create',   'Create manual CubiScan measurements',        v_cat_id, 'organization', 'medium'),
    ('cubiscan.approve',  'cubiscan', 'approve',  'Approve CubiScan measurements',              v_cat_id, 'organization', 'high'),
    ('cubiscan.override', 'cubiscan', 'override', 'Override CubiScan measurement reconciliation', v_cat_id, 'organization', 'critical')
  ON CONFLICT (name) DO NOTHING;

  -- superadmin + admin: all permissions
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  CROSS JOIN permissions p
  WHERE r.name IN ('superadmin', 'admin')
    AND p.resource = 'cubiscan'
  ON CONFLICT DO NOTHING;

  -- manager: view + scan + create + approve
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  CROSS JOIN permissions p
  WHERE r.name = 'manager'
    AND p.resource = 'cubiscan'
    AND p.action IN ('read', 'scan', 'create', 'approve')
  ON CONFLICT DO NOTHING;

  -- Other roles with inventory navigation: view only
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT DISTINCT rnp.role_id, p.id
  FROM role_navigation_permissions rnp
  JOIN navigation_items ni ON ni.id = rnp.navigation_item_id
  CROSS JOIN permissions p
  WHERE ni.url = '/apps/inventory'
    AND rnp.visible = true
    AND p.name = 'cubiscan.view'
    AND rnp.role_id NOT IN (SELECT id FROM roles WHERE name IN ('superadmin', 'admin', 'manager'))
  ON CONFLICT DO NOTHING;
END $$;
