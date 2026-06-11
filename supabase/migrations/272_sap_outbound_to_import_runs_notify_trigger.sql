-- Migration: NOTIFY trigger on `sap_outbound_to_import_runs` for the
-- Rust WS migration
-- Date: 2026-05-06
-- Description:
--   Companion to the `WsEvent::ImportRunStatusChanged` migration. Replaces
--   the ephemeral `supabase.channel('lt22-import-run-{id}')` callsite in
--   `src/features/outbound/components/import-lt22-dialog.tsx`. Same
--   ephemeral pattern as 271 (one channel per active run, torn down on
--   terminal status); this migration retires the channel churn.
--
-- Mirrors mig 270 / 271 shape:
--   * SECURITY DEFINER + `search_path = public, pg_temp`.
--   * `OR REPLACE` / `IF NOT EXISTS` so re-runnable.
--   * AFTER INSERT OR UPDATE OR DELETE.
--
-- Payload shape (consumed by `rust-work-service::sap_import_runs_listener`):
--   {
--     "run_id":          uuid,
--     "organization_id": uuid,
--     "status":          text,        -- 'queued'|'running'|'completed'|'failed'|'partial'|'canceled'
--     "rows_imported":   bigint|null, -- agent-reported count on completion
--     "op":              text
--   }
--
-- Channel name: `sap_import_run_changed`.

-- ───────────────────────────────────────────────────────────────────────
-- 1. Notifier function
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_sap_import_run_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payload jsonb;
  v_row     public.sap_outbound_to_import_runs;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;

  v_payload := jsonb_build_object(
    'run_id',          v_row.id,
    'organization_id', v_row.organization_id,
    'status',          v_row.status,
    'rows_imported',   v_row.rows_imported,
    'op',              TG_OP
  );

  PERFORM pg_notify('sap_import_run_changed', v_payload::text);
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION public.notify_sap_import_run_changed() IS
  'NOTIFY trigger emitted on sap_outbound_to_import_runs row change. '
  'Consumed by rust-work-service via sqlx PgListener; broadcast as '
  'WsEvent::ImportRunStatusChanged to org-scoped WS subscribers. '
  'Replaces the per-run supabase.channel(`lt22-import-run-{id}`) '
  'ephemeral channels in '
  'src/features/outbound/components/import-lt22-dialog.tsx.';

-- ───────────────────────────────────────────────────────────────────────
-- 2. Trigger
-- ───────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS sap_import_runs_notify_changed
  ON public.sap_outbound_to_import_runs;

CREATE TRIGGER sap_import_runs_notify_changed
  AFTER INSERT OR UPDATE OR DELETE
  ON public.sap_outbound_to_import_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_sap_import_run_changed();

COMMENT ON TRIGGER sap_import_runs_notify_changed
  ON public.sap_outbound_to_import_runs IS
  'Per-row pg_notify on sap_outbound_to_import_runs change → channel '
  'sap_import_run_changed. See notify_sap_import_run_changed() for payload.';
