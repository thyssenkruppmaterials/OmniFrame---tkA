-- Add `source` column to `sqcdp_metric_history`.
--
-- Why: the v10 SQCDP history editor writes `source = 'manual'` on per-row
-- inserts and `source = 'sample'` on the bulk "Generate sample data" path,
-- and reads `source` back on every poll. Migration 295 created the table
-- without the column, so every history poll 400s with
--   "column sqcdp_metric_history.source does not exist"
-- and the bulk insert from the editor's sample-data button is dead.
--
-- Shape: free-form text (not enum) so future provenance labels
-- (`imported`, `csv`, `auto`, ...) don't require another migration.
-- Nullable because existing rows have no source, and the FE tolerates null.

ALTER TABLE public.sqcdp_metric_history
  ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN public.sqcdp_metric_history.source IS
  'Provenance label for the data point: ''manual'' | ''auto'' (auto-recorded on metric value change) | ''sample'' (generated via the editor''s Generate sample data button) | other free-form labels.';

-- Refresh PostgREST schema cache so the FE can read the new column without
-- waiting for the next periodic schema reload.
NOTIFY pgrst, 'reload schema';
