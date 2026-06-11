ALTER TABLE public.sqcdp_metrics
  ADD COLUMN IF NOT EXISTS show_markers boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sqcdp_metrics.show_markers IS
  'When true, the historical chart renders dot markers at each data point.';
