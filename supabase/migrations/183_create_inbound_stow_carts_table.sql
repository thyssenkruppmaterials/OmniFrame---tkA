-- ============================================================================
-- Migration 183: Create Inbound Stow Carts Table
-- Description: Cart master data for physical inbound cart assets. Each row
--              represents a physical cart used to stage T.O.s before putaway.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inbound_stow_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cart_number TEXT NOT NULL,
  warehouse TEXT,
  warehouse_zone TEXT,
  max_capacity INT NOT NULL DEFAULT 10 CHECK (max_capacity > 0),
  status TEXT NOT NULL DEFAULT 'Empty'
    CHECK (status IN ('Empty', 'Loading', 'Full', 'InPutaway', 'Cleared')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES user_profiles(id),
  updated_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT inbound_stow_carts_org_cart_number_unique UNIQUE (organization_id, cart_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_inbound_stow_carts_org
  ON public.inbound_stow_carts (organization_id);
CREATE INDEX IF NOT EXISTS idx_inbound_stow_carts_org_cart_number
  ON public.inbound_stow_carts (organization_id, cart_number);
CREATE INDEX IF NOT EXISTS idx_inbound_stow_carts_status
  ON public.inbound_stow_carts (status);
CREATE INDEX IF NOT EXISTS idx_inbound_stow_carts_warehouse_zone
  ON public.inbound_stow_carts (warehouse_zone);
CREATE INDEX IF NOT EXISTS idx_inbound_stow_carts_active
  ON public.inbound_stow_carts (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_inbound_stow_carts_org_active
  ON public.inbound_stow_carts (organization_id, is_active) WHERE is_active = true;

-- RLS
ALTER TABLE public.inbound_stow_carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view inbound carts in their organization"
  ON public.inbound_stow_carts FOR SELECT
  USING (
    organization_id IN (
      SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()
    )
  );

CREATE POLICY "Users can create inbound carts in their organization"
  ON public.inbound_stow_carts FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()
    )
    AND created_by = auth.uid()
  );

CREATE POLICY "Users can update inbound carts in their organization"
  ON public.inbound_stow_carts FOR UPDATE
  USING (
    organization_id IN (
      SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()
    )
  );

CREATE POLICY "Users can delete inbound carts in their organization"
  ON public.inbound_stow_carts FOR DELETE
  USING (
    organization_id IN (
      SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()
    )
  );

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_inbound_stow_carts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_inbound_stow_carts_updated_at
  BEFORE UPDATE ON public.inbound_stow_carts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_inbound_stow_carts_updated_at();

-- Audit trigger
CREATE OR REPLACE FUNCTION public.audit_inbound_stow_carts()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (
      user_id, organization_id, action, resource_type, resource_id, changes
    ) VALUES (
      NEW.created_by, NEW.organization_id, 'create'::audit_action,
      'inbound_stow_cart', NEW.id, to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (
      user_id, organization_id, action, resource_type, resource_id, changes
    ) VALUES (
      COALESCE(NEW.updated_by, NEW.created_by), NEW.organization_id, 'update'::audit_action,
      'inbound_stow_cart', NEW.id,
      jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW))
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER audit_inbound_stow_carts_trigger
  AFTER INSERT OR UPDATE ON public.inbound_stow_carts
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_inbound_stow_carts();

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbound_stow_carts TO authenticated;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.inbound_stow_carts;

-- Comments
COMMENT ON TABLE public.inbound_stow_carts IS 'Physical inbound cart assets used to stage T.O.s before putaway. Each cart has a scannable cart_number, configurable capacity, and tracks its current lifecycle status.';
COMMENT ON COLUMN public.inbound_stow_carts.cart_number IS 'Unique scannable identifier for the physical cart (unique per organization)';
COMMENT ON COLUMN public.inbound_stow_carts.warehouse IS 'Warehouse code where the cart operates (e.g., IPDC)';
COMMENT ON COLUMN public.inbound_stow_carts.warehouse_zone IS 'Assigned warehouse zone (e.g., Zone A, Dock 3)';
COMMENT ON COLUMN public.inbound_stow_carts.max_capacity IS 'Maximum number of T.O.s this cart can hold (configurable per cart)';
COMMENT ON COLUMN public.inbound_stow_carts.status IS 'Cart lifecycle status: Empty, Loading, Full, InPutaway, Cleared';
COMMENT ON COLUMN public.inbound_stow_carts.is_active IS 'Soft-delete flag for cart lifecycle management';
