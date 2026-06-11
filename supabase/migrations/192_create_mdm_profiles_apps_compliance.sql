-- ============================================================================
-- Migration 192: MDM Profiles, Apps, and Compliance
-- Description: Configuration profile management, app catalog, installed apps,
--              compliance policies, snapshots, and violations.
-- ============================================================================

-- =====================================================
-- 1. mdm_profiles
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  profile_type TEXT NOT NULL,
  identifier TEXT NOT NULL,
  payload_plist TEXT,
  scope TEXT DEFAULT 'device' CHECK (scope IN ('device', 'user')),
  version INT NOT NULL DEFAULT 1,
  is_encrypted BOOLEAN DEFAULT false,
  removal_allowed BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.user_profiles(id),

  CONSTRAINT mdm_profiles_org_identifier UNIQUE (organization_id, identifier)
);

CREATE INDEX IF NOT EXISTS idx_mdm_profiles_org ON public.mdm_profiles (organization_id);

-- =====================================================
-- 2. mdm_profile_assignments
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_profile_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.mdm_profiles(id) ON DELETE CASCADE,
  device_id UUID REFERENCES public.mdm_devices(id) ON DELETE CASCADE,
  group_id UUID REFERENCES public.mdm_device_groups(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Installed', 'Failed', 'Removed')),
  installed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT mdm_profile_assignments_check CHECK (
    (device_id IS NOT NULL AND group_id IS NULL) OR
    (device_id IS NULL AND group_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_mdm_profile_assignments_profile ON public.mdm_profile_assignments (profile_id);
CREATE INDEX IF NOT EXISTS idx_mdm_profile_assignments_device ON public.mdm_profile_assignments (device_id) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mdm_profile_assignments_group ON public.mdm_profile_assignments (group_id) WHERE group_id IS NOT NULL;

-- =====================================================
-- 3. mdm_apps
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bundle_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT,
  icon_url TEXT,
  managed BOOLEAN DEFAULT true,
  vpp_license_count INT,
  vpp_licenses_used INT DEFAULT 0,
  blacklisted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT mdm_apps_org_bundle UNIQUE (organization_id, bundle_id)
);

CREATE INDEX IF NOT EXISTS idx_mdm_apps_org ON public.mdm_apps (organization_id);

-- =====================================================
-- 4. mdm_installed_apps
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_installed_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.mdm_devices(id) ON DELETE CASCADE,
  app_id UUID REFERENCES public.mdm_apps(id) ON DELETE SET NULL,
  bundle_id TEXT NOT NULL,
  name TEXT,
  version TEXT,
  app_size_bytes BIGINT,
  is_managed BOOLEAN DEFAULT false,
  installed_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT mdm_installed_apps_device_bundle UNIQUE (device_id, bundle_id)
);

CREATE INDEX IF NOT EXISTS idx_mdm_installed_apps_device ON public.mdm_installed_apps (device_id);
CREATE INDEX IF NOT EXISTS idx_mdm_installed_apps_app ON public.mdm_installed_apps (app_id) WHERE app_id IS NOT NULL;

-- =====================================================
-- 5. mdm_compliance_policies
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_compliance_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  rules JSONB NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  remediation_action TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.user_profiles(id),

  CONSTRAINT mdm_compliance_policies_org_name UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_mdm_compliance_policies_org ON public.mdm_compliance_policies (organization_id);
CREATE INDEX IF NOT EXISTS idx_mdm_compliance_policies_enabled ON public.mdm_compliance_policies (organization_id, enabled) WHERE enabled = true;

-- =====================================================
-- 6. mdm_compliance_snapshots
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_compliance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.mdm_devices(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES public.mdm_compliance_policies(id) ON DELETE CASCADE,
  compliant BOOLEAN NOT NULL,
  violations JSONB,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdm_compliance_snapshots_device
  ON public.mdm_compliance_snapshots (device_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mdm_compliance_snapshots_org_policy
  ON public.mdm_compliance_snapshots (organization_id, policy_id, evaluated_at DESC);

-- =====================================================
-- 7. mdm_compliance_violations
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_compliance_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.mdm_devices(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES public.mdm_compliance_policies(id) ON DELETE CASCADE,
  violation_details JSONB NOT NULL,
  severity TEXT NOT NULL,
  remediation_status TEXT NOT NULL DEFAULT 'Open'
    CHECK (remediation_status IN ('Open', 'InProgress', 'Remediated', 'Waived', 'Ignored')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdm_violations_org
  ON public.mdm_compliance_violations (organization_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_mdm_violations_device
  ON public.mdm_compliance_violations (device_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_mdm_violations_status
  ON public.mdm_compliance_violations (organization_id, remediation_status)
  WHERE remediation_status IN ('Open', 'InProgress');

-- =====================================================
-- 8. RLS for all tables
-- =====================================================

ALTER TABLE public.mdm_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_profile_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_installed_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_compliance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_compliance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_compliance_violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view profiles in their org" ON public.mdm_profiles FOR SELECT TO authenticated USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "Admins can manage profiles" ON public.mdm_profiles FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.user_profiles up JOIN public.roles r ON up.role_id = r.id WHERE up.id = auth.uid() AND r.name IN ('superadmin','admin') AND up.organization_id = mdm_profiles.organization_id));

CREATE POLICY "Users can view profile assignments" ON public.mdm_profile_assignments FOR SELECT TO authenticated USING (profile_id IN (SELECT id FROM public.mdm_profiles WHERE organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())));

CREATE POLICY "Users can view apps in their org" ON public.mdm_apps FOR SELECT TO authenticated USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "Admins can manage apps" ON public.mdm_apps FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.user_profiles up JOIN public.roles r ON up.role_id = r.id WHERE up.id = auth.uid() AND r.name IN ('superadmin','admin') AND up.organization_id = mdm_apps.organization_id));

CREATE POLICY "Users can view installed apps" ON public.mdm_installed_apps FOR SELECT TO authenticated USING (device_id IN (SELECT id FROM public.mdm_devices WHERE organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())));

CREATE POLICY "Users can view compliance policies" ON public.mdm_compliance_policies FOR SELECT TO authenticated USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "Admins can manage compliance policies" ON public.mdm_compliance_policies FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.user_profiles up JOIN public.roles r ON up.role_id = r.id WHERE up.id = auth.uid() AND r.name IN ('superadmin','admin') AND up.organization_id = mdm_compliance_policies.organization_id));

CREATE POLICY "Users can view compliance snapshots" ON public.mdm_compliance_snapshots FOR SELECT TO authenticated USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "Users can view violations" ON public.mdm_compliance_violations FOR SELECT TO authenticated USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

-- Service role full access
CREATE POLICY "svc profiles" ON public.mdm_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc profile assignments" ON public.mdm_profile_assignments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc apps" ON public.mdm_apps FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc installed apps" ON public.mdm_installed_apps FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc compliance policies" ON public.mdm_compliance_policies FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc compliance snapshots" ON public.mdm_compliance_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc compliance violations" ON public.mdm_compliance_violations FOR ALL TO service_role USING (true) WITH CHECK (true);
