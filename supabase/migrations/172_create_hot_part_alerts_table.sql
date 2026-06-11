-- ============================================================================
-- Migration 172: Create Hot Part Alerts Table
-- Description: Dynamic validator for hot part alerts in inbound scanning.
--              When a scanned value matches an alert rule (material number,
--              SO/Line, RMA/AFA #, or tracking number), RF operators get an
--              immediate alert to receive and putaway the item.
-- ============================================================================

-- Create the hot_part_alerts table
CREATE TABLE IF NOT EXISTS public.rr_hot_part_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_value TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'any' 
    CHECK (match_type IN ('material_number', 'so_line_rma_afa', 'tracking_number', 'any')),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority TEXT NOT NULL DEFAULT 'high'
    CHECK (priority IN ('normal', 'high', 'critical')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  organization_id UUID NOT NULL,
  UNIQUE(match_value, match_type, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_hot_part_alerts_active ON public.rr_hot_part_alerts(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_hot_part_alerts_match_value ON public.rr_hot_part_alerts(match_value);
CREATE INDEX IF NOT EXISTS idx_hot_part_alerts_match_type ON public.rr_hot_part_alerts(match_type);
CREATE INDEX IF NOT EXISTS idx_hot_part_alerts_org ON public.rr_hot_part_alerts(organization_id);
CREATE INDEX IF NOT EXISTS idx_hot_part_alerts_active_org ON public.rr_hot_part_alerts(organization_id, is_active) WHERE is_active = true;

ALTER TABLE public.rr_hot_part_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view hot part alerts in their organization" ON public.rr_hot_part_alerts FOR SELECT USING (organization_id IN (SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()));
CREATE POLICY "Users can create hot part alerts in their organization" ON public.rr_hot_part_alerts FOR INSERT WITH CHECK (organization_id IN (SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()));
CREATE POLICY "Users can update hot part alerts in their organization" ON public.rr_hot_part_alerts FOR UPDATE USING (organization_id IN (SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()));
CREATE POLICY "Users can delete hot part alerts in their organization" ON public.rr_hot_part_alerts FOR DELETE USING (organization_id IN (SELECT up.organization_id FROM public.user_profiles up WHERE up.id = auth.uid()));

CREATE OR REPLACE FUNCTION public.check_hot_part_alerts(p_material_number TEXT DEFAULT NULL, p_so_line_rma_afa TEXT DEFAULT NULL, p_tracking_number TEXT DEFAULT NULL, p_organization_id UUID DEFAULT NULL)
RETURNS SETOF public.rr_hot_part_alerts LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT * FROM public.rr_hot_part_alerts
  WHERE is_active = true AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    AND (
      (match_type = 'material_number' AND p_material_number IS NOT NULL AND LOWER(p_material_number) LIKE '%' || LOWER(match_value) || '%')
      OR (match_type = 'so_line_rma_afa' AND p_so_line_rma_afa IS NOT NULL AND LOWER(p_so_line_rma_afa) LIKE '%' || LOWER(match_value) || '%')
      OR (match_type = 'tracking_number' AND p_tracking_number IS NOT NULL AND LOWER(p_tracking_number) LIKE '%' || LOWER(match_value) || '%')
      OR (match_type = 'any' AND (
        (p_material_number IS NOT NULL AND LOWER(p_material_number) LIKE '%' || LOWER(match_value) || '%')
        OR (p_so_line_rma_afa IS NOT NULL AND LOWER(p_so_line_rma_afa) LIKE '%' || LOWER(match_value) || '%')
        OR (p_tracking_number IS NOT NULL AND LOWER(p_tracking_number) LIKE '%' || LOWER(match_value) || '%'))
      )
    )
  ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 END;
$$;

CREATE OR REPLACE FUNCTION public.update_hot_part_alerts_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER update_hot_part_alerts_updated_at BEFORE UPDATE ON public.rr_hot_part_alerts FOR EACH ROW EXECUTE FUNCTION public.update_hot_part_alerts_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.rr_hot_part_alerts;
COMMENT ON TABLE public.rr_hot_part_alerts IS 'Hot Part Alert rules for inbound scanning. When scanned values match an active alert rule, RF operators receive immediate priority notifications.';
