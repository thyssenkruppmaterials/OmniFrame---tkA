-- ============================================================================
-- Migration 189: MDM Devices and Device Groups
-- Description: Core device registry and group management for Apple MDM.
--              All tables are organization-scoped from day one.
-- ============================================================================

-- =====================================================
-- 1. mdm_device_groups (must exist before mdm_devices FK)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_device_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  group_type TEXT NOT NULL DEFAULT 'static'
    CHECK (group_type IN ('static', 'smart')),
  smart_filter JSONB,
  parent_group_id UUID REFERENCES public.mdm_device_groups(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.user_profiles(id),

  CONSTRAINT mdm_device_groups_org_name_unique UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_mdm_device_groups_org
  ON public.mdm_device_groups (organization_id);

-- =====================================================
-- 2. mdm_devices
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Apple identifiers
  serial_number TEXT,
  udid TEXT,
  device_name TEXT,
  model TEXT,
  model_identifier TEXT,
  os_version TEXT,
  os_build TEXT,
  product_name TEXT,
  imei TEXT,
  meid TEXT,
  phone_number TEXT,

  -- Network
  wifi_mac TEXT,
  bluetooth_mac TEXT,
  ethernet_mac TEXT,
  ip_address INET,
  carrier TEXT,
  cellular_technology TEXT,
  is_roaming BOOLEAN DEFAULT false,

  -- MDM state
  supervised BOOLEAN DEFAULT false,
  dep_enrolled BOOLEAN DEFAULT false,
  mdm_profile_installed BOOLEAN DEFAULT false,
  activation_lock_enabled BOOLEAN DEFAULT false,
  enrollment_type TEXT CHECK (enrollment_type IN ('DEP', 'Manual', 'BYOD', 'UserInitiated')),
  enrollment_date TIMESTAMPTZ,
  last_checkin_at TIMESTAMPTZ,
  topic TEXT,

  -- Assignment
  assigned_user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  device_group_id UUID REFERENCES public.mdm_device_groups(id) ON DELETE SET NULL,
  tags TEXT[],

  -- Hardware telemetry
  total_storage_bytes BIGINT,
  available_storage_bytes BIGINT,
  battery_level NUMERIC(5,2),
  battery_health TEXT,
  battery_cycle_count INT,

  -- Security
  passcode_compliant BOOLEAN,
  encrypted BOOLEAN,
  firewall_enabled BOOLEAN,

  -- Composite
  health_score NUMERIC(5,2),
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Online', 'Offline', 'Pending', 'Lost', 'Wiped', 'Retired')),
  retired_at TIMESTAMPTZ,
  notes TEXT,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.user_profiles(id),
  updated_by UUID REFERENCES public.user_profiles(id),

  CONSTRAINT mdm_devices_org_serial UNIQUE (organization_id, serial_number),
  CONSTRAINT mdm_devices_udid_unique UNIQUE (udid)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_mdm_devices_org ON public.mdm_devices (organization_id);
CREATE INDEX IF NOT EXISTS idx_mdm_devices_org_status ON public.mdm_devices (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_mdm_devices_org_serial ON public.mdm_devices (organization_id, serial_number);
CREATE INDEX IF NOT EXISTS idx_mdm_devices_org_group ON public.mdm_devices (organization_id, device_group_id);
CREATE INDEX IF NOT EXISTS idx_mdm_devices_status ON public.mdm_devices (status);
CREATE INDEX IF NOT EXISTS idx_mdm_devices_last_checkin ON public.mdm_devices (last_checkin_at DESC);
CREATE INDEX IF NOT EXISTS idx_mdm_devices_assigned_user ON public.mdm_devices (assigned_user_id) WHERE assigned_user_id IS NOT NULL;

-- =====================================================
-- 3. mdm_group_memberships (many-to-many)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_group_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.mdm_devices(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.mdm_device_groups(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by UUID REFERENCES public.user_profiles(id),

  CONSTRAINT mdm_group_memberships_unique UNIQUE (device_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_mdm_group_memberships_device ON public.mdm_group_memberships (device_id);
CREATE INDEX IF NOT EXISTS idx_mdm_group_memberships_group ON public.mdm_group_memberships (group_id);

-- =====================================================
-- 4. RLS
-- =====================================================

ALTER TABLE public.mdm_device_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_group_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view MDM device groups in their org"
  ON public.mdm_device_groups FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Admins can manage MDM device groups"
  ON public.mdm_device_groups FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles up
    JOIN public.roles r ON up.role_id = r.id
    WHERE up.id = auth.uid() AND r.name IN ('superadmin', 'admin')
    AND up.organization_id = mdm_device_groups.organization_id
  ));

CREATE POLICY "Users can view MDM devices in their org"
  ON public.mdm_devices FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Admins can manage MDM devices"
  ON public.mdm_devices FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles up
    JOIN public.roles r ON up.role_id = r.id
    WHERE up.id = auth.uid() AND r.name IN ('superadmin', 'admin')
    AND up.organization_id = mdm_devices.organization_id
  ));

CREATE POLICY "Users can view group memberships for devices in their org"
  ON public.mdm_group_memberships FOR SELECT TO authenticated
  USING (device_id IN (
    SELECT id FROM public.mdm_devices WHERE organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  ));

CREATE POLICY "Service role has full access to MDM device groups"
  ON public.mdm_device_groups FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role has full access to MDM devices"
  ON public.mdm_devices FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role has full access to group memberships"
  ON public.mdm_group_memberships FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.mdm_devices IS 'Core MDM device registry. Organization-scoped. Stores Apple device metadata, MDM state, and operational telemetry.';
COMMENT ON TABLE public.mdm_device_groups IS 'Device groups for organizing MDM-managed devices. Supports static and smart (filter-based) groups.';
COMMENT ON TABLE public.mdm_group_memberships IS 'Many-to-many association between devices and groups.';
