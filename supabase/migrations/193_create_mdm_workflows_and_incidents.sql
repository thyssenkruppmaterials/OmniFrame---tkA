-- ============================================================================
-- Migration 193: MDM Automation Workflows, Incidents, and Overrides
-- Description: Automation workflow engine, incident tracking, manual
--              overrides, enrollment events, check-in history, and reports.
-- ============================================================================

-- =====================================================
-- 1. mdm_workflows
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  conditions JSONB,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  graph_data JSONB,
  enabled BOOLEAN NOT NULL DEFAULT false,
  last_triggered_at TIMESTAMPTZ,
  execution_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.user_profiles(id),

  CONSTRAINT mdm_workflows_org_name UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_mdm_workflows_org ON public.mdm_workflows (organization_id);
CREATE INDEX IF NOT EXISTS idx_mdm_workflows_enabled ON public.mdm_workflows (organization_id, enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_mdm_workflows_trigger ON public.mdm_workflows (trigger_type, enabled) WHERE enabled = true;

-- =====================================================
-- 2. mdm_workflow_executions
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.mdm_workflows(id) ON DELETE CASCADE,
  trigger_event JSONB,
  status TEXT NOT NULL DEFAULT 'Running'
    CHECK (status IN ('Running', 'Completed', 'Failed', 'Cancelled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  result JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdm_workflow_executions_workflow
  ON public.mdm_workflow_executions (workflow_id, started_at DESC);

-- =====================================================
-- 3. mdm_incidents
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id UUID REFERENCES public.mdm_devices(id) ON DELETE SET NULL,
  incident_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'Open'
    CHECK (status IN ('Open', 'Investigating', 'Resolved', 'Closed')),
  assigned_to UUID REFERENCES public.user_profiles(id),
  related_command_id UUID REFERENCES public.mdm_commands(id),
  metadata JSONB,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdm_incidents_org ON public.mdm_incidents (organization_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_mdm_incidents_device ON public.mdm_incidents (device_id, opened_at DESC) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mdm_incidents_status ON public.mdm_incidents (organization_id, status) WHERE status IN ('Open', 'Investigating');

-- =====================================================
-- 4. mdm_manual_overrides
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_manual_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  override_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('device', 'command', 'policy', 'workflow')),
  reason TEXT NOT NULL,
  override_data JSONB,
  actor_id UUID NOT NULL REFERENCES public.user_profiles(id),
  ip_address INET,
  is_break_glass BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mdm_overrides_org ON public.mdm_manual_overrides (organization_id, created_at DESC);

-- =====================================================
-- 5. mdm_enrollments
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id UUID REFERENCES public.mdm_devices(id) ON DELETE SET NULL,
  enrollment_type TEXT NOT NULL CHECK (enrollment_type IN ('DEP', 'Manual', 'BYOD', 'UserInitiated')),
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'InProgress', 'Completed', 'Failed', 'Cancelled')),
  enrollment_profile_id UUID,
  initiated_by UUID REFERENCES public.user_profiles(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdm_enrollments_org ON public.mdm_enrollments (organization_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_mdm_enrollments_device ON public.mdm_enrollments (device_id) WHERE device_id IS NOT NULL;

-- =====================================================
-- 6. mdm_checkin_events
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_checkin_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.mdm_devices(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL,
  raw_payload JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdm_checkin_events_device
  ON public.mdm_checkin_events (device_id, created_at DESC);

-- =====================================================
-- 7. mdm_report_schedules
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  report_type TEXT NOT NULL,
  schedule_cron TEXT NOT NULL,
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  filters JSONB,
  format TEXT NOT NULL DEFAULT 'csv' CHECK (format IN ('csv', 'pdf', 'json')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.user_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_mdm_report_schedules_org ON public.mdm_report_schedules (organization_id);

-- =====================================================
-- 8. RLS
-- =====================================================

ALTER TABLE public.mdm_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_manual_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_checkin_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_report_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view workflows in their org" ON public.mdm_workflows FOR SELECT TO authenticated USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "Admins can manage workflows" ON public.mdm_workflows FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.user_profiles up JOIN public.roles r ON up.role_id = r.id WHERE up.id = auth.uid() AND r.name IN ('superadmin','admin') AND up.organization_id = mdm_workflows.organization_id));

CREATE POLICY "Users can view workflow executions" ON public.mdm_workflow_executions FOR SELECT TO authenticated USING (workflow_id IN (SELECT id FROM public.mdm_workflows WHERE organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())));

CREATE POLICY "Users can view incidents in their org" ON public.mdm_incidents FOR SELECT TO authenticated USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "Admins can manage incidents" ON public.mdm_incidents FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.user_profiles up JOIN public.roles r ON up.role_id = r.id WHERE up.id = auth.uid() AND r.name IN ('superadmin','admin') AND up.organization_id = mdm_incidents.organization_id));

CREATE POLICY "Users can view overrides in their org" ON public.mdm_manual_overrides FOR SELECT TO authenticated USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can view enrollments in their org" ON public.mdm_enrollments FOR SELECT TO authenticated USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can view checkin events" ON public.mdm_checkin_events FOR SELECT TO authenticated USING (device_id IN (SELECT id FROM public.mdm_devices WHERE organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())));

CREATE POLICY "Users can view report schedules" ON public.mdm_report_schedules FOR SELECT TO authenticated USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "Admins can manage report schedules" ON public.mdm_report_schedules FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.user_profiles up JOIN public.roles r ON up.role_id = r.id WHERE up.id = auth.uid() AND r.name IN ('superadmin','admin') AND up.organization_id = mdm_report_schedules.organization_id));

-- Service role full access
CREATE POLICY "svc workflows" ON public.mdm_workflows FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc workflow execs" ON public.mdm_workflow_executions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc incidents" ON public.mdm_incidents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc overrides" ON public.mdm_manual_overrides FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc enrollments" ON public.mdm_enrollments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc checkin events" ON public.mdm_checkin_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc report schedules" ON public.mdm_report_schedules FOR ALL TO service_role USING (true) WITH CHECK (true);
