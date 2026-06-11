-- ============================================================================
-- Migration 232: Drop-off Areas, Area Associates, and Inbound Part Transfers
-- Description: Supports the Inbound Part Transfer RF workflow. Lets operators
--              scan a TKA batch, then a drop-off area barcode, then an accepting
--              associate's badge code. Append-only history is tracked in
--              rr_inbound_part_transfers and surfaced on the Inbound Scan Search
--              via v_latest_inbound_part_transfers.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. rr_drop_off_areas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rr_drop_off_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  barcode TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rr_drop_off_areas_barcode_unique UNIQUE (organization_id, barcode),
  CONSTRAINT rr_drop_off_areas_name_unique UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_rr_drop_off_areas_org ON public.rr_drop_off_areas(organization_id);
CREATE INDEX IF NOT EXISTS idx_rr_drop_off_areas_barcode ON public.rr_drop_off_areas(organization_id, barcode) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_rr_drop_off_areas_active ON public.rr_drop_off_areas(organization_id, is_active);

ALTER TABLE public.rr_drop_off_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view drop-off areas in their organization"
  ON public.rr_drop_off_areas FOR SELECT
  USING (organization_id IN (SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()));

CREATE POLICY "Users can create drop-off areas in their organization"
  ON public.rr_drop_off_areas FOR INSERT
  WITH CHECK (organization_id IN (SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()));

CREATE POLICY "Users can update drop-off areas in their organization"
  ON public.rr_drop_off_areas FOR UPDATE
  USING (organization_id IN (SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()));

CREATE POLICY "Users can delete drop-off areas in their organization"
  ON public.rr_drop_off_areas FOR DELETE
  USING (organization_id IN (SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. rr_drop_off_area_associates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rr_drop_off_area_associates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  drop_off_area_id UUID NOT NULL REFERENCES public.rr_drop_off_areas(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  badge_code TEXT NOT NULL,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rr_drop_off_area_associates_badge_unique UNIQUE (drop_off_area_id, badge_code)
);

CREATE INDEX IF NOT EXISTS idx_rr_drop_off_area_associates_org ON public.rr_drop_off_area_associates(organization_id);
CREATE INDEX IF NOT EXISTS idx_rr_drop_off_area_associates_area ON public.rr_drop_off_area_associates(drop_off_area_id);
CREATE INDEX IF NOT EXISTS idx_rr_drop_off_area_associates_user ON public.rr_drop_off_area_associates(user_id);
CREATE INDEX IF NOT EXISTS idx_rr_drop_off_area_associates_badge_lookup
  ON public.rr_drop_off_area_associates(drop_off_area_id, badge_code) WHERE is_active = true;

ALTER TABLE public.rr_drop_off_area_associates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view drop-off associates in their organization"
  ON public.rr_drop_off_area_associates FOR SELECT
  USING (organization_id IN (SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()));

CREATE POLICY "Users can create drop-off associates in their organization"
  ON public.rr_drop_off_area_associates FOR INSERT
  WITH CHECK (organization_id IN (SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()));

CREATE POLICY "Users can update drop-off associates in their organization"
  ON public.rr_drop_off_area_associates FOR UPDATE
  USING (organization_id IN (SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()));

CREATE POLICY "Users can delete drop-off associates in their organization"
  ON public.rr_drop_off_area_associates FOR DELETE
  USING (organization_id IN (SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. rr_inbound_part_transfers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rr_inbound_part_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tka_batch_number TEXT NOT NULL,
  drop_off_area_id UUID NOT NULL REFERENCES public.rr_drop_off_areas(id) ON DELETE RESTRICT,
  accepted_by_associate_id UUID NOT NULL REFERENCES public.rr_drop_off_area_associates(id) ON DELETE RESTRICT,
  dropped_off_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  dropped_off_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rr_inbound_part_transfers_org ON public.rr_inbound_part_transfers(organization_id);
CREATE INDEX IF NOT EXISTS idx_rr_inbound_part_transfers_batch
  ON public.rr_inbound_part_transfers(organization_id, tka_batch_number, dropped_off_at DESC);
CREATE INDEX IF NOT EXISTS idx_rr_inbound_part_transfers_area ON public.rr_inbound_part_transfers(drop_off_area_id);
CREATE INDEX IF NOT EXISTS idx_rr_inbound_part_transfers_associate ON public.rr_inbound_part_transfers(accepted_by_associate_id);
CREATE INDEX IF NOT EXISTS idx_rr_inbound_part_transfers_dropped_by ON public.rr_inbound_part_transfers(dropped_off_by);

ALTER TABLE public.rr_inbound_part_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view inbound part transfers in their organization"
  ON public.rr_inbound_part_transfers FOR SELECT
  USING (organization_id IN (SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()));

CREATE POLICY "Users can create inbound part transfers in their organization"
  ON public.rr_inbound_part_transfers FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid())
    AND dropped_off_by = auth.uid()
  );

CREATE POLICY "Users can update inbound part transfers in their organization"
  ON public.rr_inbound_part_transfers FOR UPDATE
  USING (organization_id IN (SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Latest-transfer view for joining into Inbound Scan Search
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_latest_inbound_part_transfers AS
SELECT DISTINCT ON (t.organization_id, t.tka_batch_number)
  t.id AS transfer_id,
  t.organization_id,
  t.tka_batch_number,
  t.drop_off_area_id,
  a.name AS area_name,
  a.barcode AS area_barcode,
  t.accepted_by_associate_id,
  assoc.full_name AS associate_name,
  assoc.badge_code AS associate_badge_code,
  t.dropped_off_by,
  up.full_name AS dropped_off_by_name,
  up.email AS dropped_off_by_email,
  t.dropped_off_at,
  t.accepted_at,
  t.notes
FROM public.rr_inbound_part_transfers t
LEFT JOIN public.rr_drop_off_areas a ON a.id = t.drop_off_area_id
LEFT JOIN public.rr_drop_off_area_associates assoc ON assoc.id = t.accepted_by_associate_id
LEFT JOIN public.user_profiles up ON up.id = t.dropped_off_by
ORDER BY t.organization_id, t.tka_batch_number, t.dropped_off_at DESC;

-- ---------------------------------------------------------------------------
-- 5. updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_rr_drop_off_areas_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_rr_drop_off_areas_updated_at_trigger ON public.rr_drop_off_areas;
CREATE TRIGGER update_rr_drop_off_areas_updated_at_trigger
  BEFORE UPDATE ON public.rr_drop_off_areas
  FOR EACH ROW
  EXECUTE FUNCTION public.update_rr_drop_off_areas_updated_at();

DROP TRIGGER IF EXISTS update_rr_drop_off_area_associates_updated_at_trigger ON public.rr_drop_off_area_associates;
CREATE TRIGGER update_rr_drop_off_area_associates_updated_at_trigger
  BEFORE UPDATE ON public.rr_drop_off_area_associates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_rr_drop_off_areas_updated_at();

DROP TRIGGER IF EXISTS update_rr_inbound_part_transfers_updated_at_trigger ON public.rr_inbound_part_transfers;
CREATE TRIGGER update_rr_inbound_part_transfers_updated_at_trigger
  BEFORE UPDATE ON public.rr_inbound_part_transfers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_rr_drop_off_areas_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Grants + realtime publication
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_drop_off_areas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_drop_off_area_associates TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.rr_inbound_part_transfers TO authenticated;
GRANT SELECT ON public.v_latest_inbound_part_transfers TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.rr_drop_off_areas;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.rr_drop_off_area_associates;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.rr_inbound_part_transfers;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END
$$;

COMMENT ON TABLE public.rr_drop_off_areas IS 'Configurable drop-off zones outside of the inbound area. Each has a scannable barcode.';
COMMENT ON TABLE public.rr_drop_off_area_associates IS 'Associates authorized to accept part drop-offs for a given drop-off area. Each has a scannable badge code.';
COMMENT ON TABLE public.rr_inbound_part_transfers IS 'Append-only history of TKA batch transfers from the inbound area to a drop-off zone.';
COMMENT ON VIEW public.v_latest_inbound_part_transfers IS 'Latest transfer per (organization, tka_batch_number) with area + associate names for UI display.';
