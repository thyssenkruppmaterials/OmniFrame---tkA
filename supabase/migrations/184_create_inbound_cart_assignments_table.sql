-- ============================================================================
-- Migration 184: Create Inbound Cart Assignments Table
-- Description: Live and historical record of T.O.-to-cart assignments. One
--              row per stow event. Append-friendly for audit history; the
--              partial unique index enforces one active assignment per T.O.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inbound_cart_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cart_id UUID NOT NULL REFERENCES public.inbound_stow_carts(id) ON DELETE RESTRICT,
  raw_to_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  material_number TEXT NOT NULL,
  to_location TEXT,
  warehouse TEXT,
  status TEXT NOT NULL DEFAULT 'on_cart'
    CHECK (status IN ('on_cart', 'cleared', 'reassigned', 'removed', 'cancelled')),
  stowed_by UUID NOT NULL REFERENCES user_profiles(id),
  stowed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cleared_by UUID REFERENCES user_profiles(id),
  cleared_at TIMESTAMPTZ,
  clear_reason TEXT,
  cleared_putaway_operation_id UUID REFERENCES rf_putaway_operations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial unique index: one active assignment per T.O. line per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_cart_assignments_active_to
  ON public.inbound_cart_assignments (organization_id, raw_to_number, material_number)
  WHERE status = 'on_cart';

-- Unique index: one stow cleared per putaway operation
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_cart_assignments_cleared_putaway
  ON public.inbound_cart_assignments (cleared_putaway_operation_id)
  WHERE cleared_putaway_operation_id IS NOT NULL;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_inbound_cart_assignments_cart_id
  ON public.inbound_cart_assignments (cart_id);
CREATE INDEX IF NOT EXISTS idx_inbound_cart_assignments_org_status
  ON public.inbound_cart_assignments (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_inbound_cart_assignments_to_material
  ON public.inbound_cart_assignments (raw_to_number, material_number);
CREATE INDEX IF NOT EXISTS idx_inbound_cart_assignments_stowed_by_at
  ON public.inbound_cart_assignments (stowed_by, stowed_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_cart_assignments_cart_status
  ON public.inbound_cart_assignments (cart_id, status)
  WHERE status = 'on_cart';

-- RLS
ALTER TABLE public.inbound_cart_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view cart assignments in their organization"
  ON public.inbound_cart_assignments FOR SELECT
  USING (
    organization_id IN (
      SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()
    )
  );

CREATE POLICY "Users can create cart assignments in their organization"
  ON public.inbound_cart_assignments FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()
    )
    AND stowed_by = auth.uid()
  );

CREATE POLICY "Users can update cart assignments in their organization"
  ON public.inbound_cart_assignments FOR UPDATE
  USING (
    organization_id IN (
      SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()
    )
  );

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_inbound_cart_assignments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_inbound_cart_assignments_updated_at
  BEFORE UPDATE ON public.inbound_cart_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_inbound_cart_assignments_updated_at();

-- Audit trigger
CREATE OR REPLACE FUNCTION public.audit_inbound_cart_assignments()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_action audit_action;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (
      user_id, organization_id, action, resource_type, resource_id, changes
    ) VALUES (
      NEW.stowed_by, NEW.organization_id, 'create'::audit_action,
      'inbound_cart_assignment', NEW.id, to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'on_cart' AND NEW.status = 'cleared' THEN
      v_action := 'complete'::audit_action;
    ELSIF OLD.status = 'on_cart' AND NEW.status = 'reassigned' THEN
      v_action := 'update'::audit_action;
    ELSIF OLD.status = 'on_cart' AND NEW.status = 'removed' THEN
      v_action := 'delete'::audit_action;
    ELSE
      v_action := 'update'::audit_action;
    END IF;

    INSERT INTO audit_logs (
      user_id, organization_id, action, resource_type, resource_id, changes
    ) VALUES (
      COALESCE(NEW.cleared_by, NEW.stowed_by), NEW.organization_id, v_action,
      'inbound_cart_assignment', NEW.id,
      jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW))
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER audit_inbound_cart_assignments_trigger
  AFTER INSERT OR UPDATE ON public.inbound_cart_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_inbound_cart_assignments();

-- Grants
GRANT SELECT, INSERT, UPDATE ON public.inbound_cart_assignments TO authenticated;

-- Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'inbound_cart_assignments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inbound_cart_assignments;
  END IF;
END $$;

-- Comments
COMMENT ON TABLE public.inbound_cart_assignments IS 'Live and historical record of T.O.-to-cart assignments. Each row is one stow event. Partial unique index enforces one active on_cart assignment per T.O. line.';
COMMENT ON COLUMN public.inbound_cart_assignments.raw_to_number IS 'Full scanned T.O. barcode value (e.g., 3597367$I0001$IPDC)';
COMMENT ON COLUMN public.inbound_cart_assignments.to_number IS 'Parsed T.O. number extracted from the raw barcode';
COMMENT ON COLUMN public.inbound_cart_assignments.status IS 'Assignment lifecycle: on_cart, cleared, reassigned, removed, cancelled';
COMMENT ON COLUMN public.inbound_cart_assignments.clear_reason IS 'Why the assignment was cleared: putaway_completed, manual_removal, reassigned, cancelled';
COMMENT ON COLUMN public.inbound_cart_assignments.cleared_putaway_operation_id IS 'FK to rf_putaway_operations when cleared by RF putaway completion';
