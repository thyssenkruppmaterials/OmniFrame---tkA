-- ============================================================================
-- Migration 190: MDM Commands, Command Events, and Device Secrets
-- Description: Durable command queue with append-only event ledger,
--              approval trail, and service-role-only device secrets.
-- ============================================================================

-- =====================================================
-- 1. mdm_device_secrets (service-role only)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_device_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.mdm_devices(id) ON DELETE CASCADE,
  push_magic TEXT,
  push_token TEXT,
  unlock_token TEXT,
  topic TEXT,
  enrollment_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT mdm_device_secrets_device_unique UNIQUE (device_id)
);

ALTER TABLE public.mdm_device_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only for device secrets"
  ON public.mdm_device_secrets FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =====================================================
-- 2. mdm_commands (mutable state)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.mdm_devices(id) ON DELETE CASCADE,
  command_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  command_type TEXT NOT NULL,
  payload JSONB,
  payload_hash TEXT,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'Queued'
    CHECK (status IN ('Queued', 'PendingApproval', 'Approved', 'Sent', 'Acknowledged', 'NotNow', 'Completed', 'Failed', 'Cancelled', 'Expired', 'DeadLetter')),
  priority INT NOT NULL DEFAULT 5,
  scheduled_at TIMESTAMPTZ,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 3,
  error_code TEXT,
  error_message TEXT,
  response_payload JSONB,
  pipeline_id UUID,
  pipeline_step INT,
  initiated_by UUID REFERENCES public.user_profiles(id),
  correlation_id UUID DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT mdm_commands_command_uuid_unique UNIQUE (command_uuid)
);

CREATE INDEX IF NOT EXISTS idx_mdm_commands_org ON public.mdm_commands (organization_id);
CREATE INDEX IF NOT EXISTS idx_mdm_commands_device ON public.mdm_commands (device_id);
CREATE INDEX IF NOT EXISTS idx_mdm_commands_device_status ON public.mdm_commands (device_id, status);
CREATE INDEX IF NOT EXISTS idx_mdm_commands_org_status ON public.mdm_commands (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mdm_commands_org_type_status ON public.mdm_commands (organization_id, command_type, status);
CREATE INDEX IF NOT EXISTS idx_mdm_commands_pipeline ON public.mdm_commands (pipeline_id) WHERE pipeline_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mdm_commands_queued ON public.mdm_commands (status, priority DESC, queued_at ASC)
  WHERE status IN ('Queued', 'Approved', 'NotNow');
CREATE INDEX IF NOT EXISTS idx_mdm_commands_idempotency ON public.mdm_commands (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- =====================================================
-- 3. mdm_command_events (append-only ledger)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_command_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID NOT NULL REFERENCES public.mdm_commands(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  payload JSONB,
  actor_id UUID REFERENCES public.user_profiles(id),
  actor_type TEXT DEFAULT 'system' CHECK (actor_type IN ('user', 'system', 'device', 'automation')),
  ip_address INET,
  user_agent TEXT,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdm_command_events_command ON public.mdm_command_events (command_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_mdm_command_events_correlation ON public.mdm_command_events (correlation_id) WHERE correlation_id IS NOT NULL;

-- =====================================================
-- 4. mdm_command_approvals
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_command_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID NOT NULL REFERENCES public.mdm_commands(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES public.user_profiles(id),
  approved_by UUID REFERENCES public.user_profiles(id),
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Expired')),
  reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,

  CONSTRAINT mdm_command_approvals_command_unique UNIQUE (command_id)
);

CREATE INDEX IF NOT EXISTS idx_mdm_command_approvals_status ON public.mdm_command_approvals (status) WHERE status = 'Pending';

-- =====================================================
-- 5. mdm_remote_action_audit (immutable)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_remote_action_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.mdm_devices(id) ON DELETE CASCADE,
  command_id UUID REFERENCES public.mdm_commands(id),
  action_type TEXT NOT NULL,
  actor_id UUID REFERENCES public.user_profiles(id),
  payload_hash TEXT,
  ip_address INET,
  user_agent TEXT,
  correlation_id UUID,
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdm_audit_org ON public.mdm_remote_action_audit (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mdm_audit_device ON public.mdm_remote_action_audit (device_id, created_at DESC);

-- =====================================================
-- 6. mdm_command_templates
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_command_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  steps JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.user_profiles(id),

  CONSTRAINT mdm_command_templates_org_name UNIQUE (organization_id, name)
);

-- =====================================================
-- 7. RLS
-- =====================================================

ALTER TABLE public.mdm_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_command_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_command_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_remote_action_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_command_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view commands in their org"
  ON public.mdm_commands FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage commands"
  ON public.mdm_commands FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles up JOIN public.roles r ON up.role_id = r.id
    WHERE up.id = auth.uid() AND r.name IN ('superadmin', 'admin')
    AND up.organization_id = mdm_commands.organization_id
  ));

CREATE POLICY "Users can view command events for their org commands"
  ON public.mdm_command_events FOR SELECT TO authenticated
  USING (command_id IN (
    SELECT id FROM public.mdm_commands WHERE organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  ));

CREATE POLICY "Users can view approvals for their org"
  ON public.mdm_command_approvals FOR SELECT TO authenticated
  USING (command_id IN (
    SELECT id FROM public.mdm_commands WHERE organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  ));

CREATE POLICY "Users can view audit in their org"
  ON public.mdm_remote_action_audit FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can view templates in their org"
  ON public.mdm_command_templates FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage templates"
  ON public.mdm_command_templates FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles up JOIN public.roles r ON up.role_id = r.id
    WHERE up.id = auth.uid() AND r.name IN ('superadmin', 'admin')
    AND up.organization_id = mdm_command_templates.organization_id
  ));

-- Service role full access
CREATE POLICY "Service role full access commands" ON public.mdm_commands FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access command events" ON public.mdm_command_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access approvals" ON public.mdm_command_approvals FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access audit" ON public.mdm_remote_action_audit FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access templates" ON public.mdm_command_templates FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.mdm_commands IS 'Durable MDM command queue with status tracking, retries, expiry, and dead-letter support.';
COMMENT ON TABLE public.mdm_command_events IS 'Append-only command lifecycle ledger. Never updated or deleted.';
COMMENT ON TABLE public.mdm_command_approvals IS 'Approval trail for destructive or high-risk MDM commands.';
COMMENT ON TABLE public.mdm_remote_action_audit IS 'Immutable audit log for all remote device actions.';
COMMENT ON TABLE public.mdm_device_secrets IS 'Service-role-only storage for APNs tokens, push magic, and unlock tokens.';
