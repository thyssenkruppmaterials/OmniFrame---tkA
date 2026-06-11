CREATE TABLE IF NOT EXISTS public.ll01_activity_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  snapshot_run_id UUID NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  agent_id TEXT,
  plant TEXT NOT NULL,
  category TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  CONSTRAINT ll01_activity_snapshots_unique UNIQUE (organization_id, snapshot_run_id, plant, category)
);

CREATE INDEX idx_ll01_snapshots_org_ran_at ON public.ll01_activity_snapshots (organization_id, ran_at DESC);
CREATE INDEX idx_ll01_snapshots_org_category_plant_ran_at ON public.ll01_activity_snapshots (organization_id, category, plant, ran_at DESC);

ALTER TABLE public.ll01_activity_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ll01_snapshots org read"
ON public.ll01_activity_snapshots FOR SELECT
USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "ll01_snapshots org insert"
ON public.ll01_activity_snapshots FOR INSERT
WITH CHECK (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
