-- LL01 Warehouse Activity Monitor — full-fidelity run store (2026-05-31).
--
-- `ll01_activity_snapshots` (migration 326) keeps COUNTS only (one row per
-- plant × category per run) and powers the Trend tab. It cannot reconstruct
-- the Heatmap drill-down slide-over or the Aging tab, both of which need the
-- per-row payload (`categories[].rows`).
--
-- This table persists the ENTIRE run result — one JSONB row per run = the
-- exact `LL01RunResult` the agent returns — so any past run can be reloaded
-- at full fidelity via the Inventory Management date picker. Runs are kept
-- indefinitely (no retention prune); the agent upserts on re-run via the
-- (organization_id, snapshot_run_id) unique constraint.

CREATE TABLE IF NOT EXISTS public.ll01_activity_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  snapshot_run_id UUID NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  agent_id TEXT,
  ok BOOLEAN NOT NULL DEFAULT true,
  payload_version INTEGER,
  duration_ms INTEGER,
  -- Full `LL01RunResult` payload. `categories` carries `counts_by_plant`,
  -- `total`, AND the per-row `rows[]` detail that the drill-down + Aging
  -- tabs derive their aggregates from client-side.
  plants JSONB NOT NULL DEFAULT '[]'::jsonb,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT ll01_activity_runs_unique UNIQUE (organization_id, snapshot_run_id)
);

-- Date-picker index reads runs newest-first per org.
CREATE INDEX IF NOT EXISTS idx_ll01_runs_org_ran_at
  ON public.ll01_activity_runs (organization_id, ran_at DESC);

ALTER TABLE public.ll01_activity_runs ENABLE ROW LEVEL SECURITY;

-- RLS mirrors ll01_activity_snapshots: org members read + insert their own.
CREATE POLICY "ll01_runs org read"
ON public.ll01_activity_runs FOR SELECT
USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "ll01_runs org insert"
ON public.ll01_activity_runs FOR INSERT
WITH CHECK (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
