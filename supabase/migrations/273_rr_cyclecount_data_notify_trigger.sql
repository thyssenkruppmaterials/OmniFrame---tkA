-- Migration: NOTIFY trigger on `rr_cyclecount_data` for the Rust WS
-- migration
-- Date: 2026-05-06
-- Description:
--   Companion to the `WsEvent::CycleCountOperationChanged` migration.
--   Replaces the org-filtered `supabase.channel('cycle-count-changes-
--   {orgId}')` callsite in `src/hooks/use-cycle-count-operations.ts`.
--   Frontend handler invalidates the
--   `[CYCLE_COUNT_OPERATIONS_QUERY_KEY]` and
--   `[CYCLE_COUNT_STATISTICS_QUERY_KEY]` TanStack queries on every
--   change, so the WS payload only needs to carry enough to identify
--   the row + the operation type. The bulk of `rr_cyclecount_data`
--   columns are NOT included in the payload — TanStack Query refetches
--   the data via the existing service.
--
-- High-frequency table: this trigger fires per cycle-count UPDATE
-- (every claim, every status flip, every variance recalc). The
-- broadcast volume is bounded by the org's count throughput. The 1000-
-- slot `broadcast::channel` buffer + the new `work_ws_lagged_events_total`
-- counter (see Add-WsEvent-Lagged-Metric.md) cover the worst case.
--
-- Mirrors mig 270 / 271 / 272 shape:
--   * SECURITY DEFINER + `search_path = public, pg_temp`.
--   * `OR REPLACE` / `IF NOT EXISTS` so re-runnable.
--   * AFTER INSERT OR UPDATE OR DELETE.
--
-- Payload shape (consumed by `rust-work-service::cycle_count_listener`):
--   {
--     "row_id":          uuid,        -- rr_cyclecount_data.id
--     "organization_id": uuid,        -- NOT NULL
--     "op":              text         -- 'INSERT' | 'UPDATE' | 'DELETE'
--   }
--
-- Channel name: `cycle_count_data_changed`.

-- ───────────────────────────────────────────────────────────────────────
-- 1. Notifier function
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_cycle_count_data_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payload jsonb;
  v_row     public.rr_cyclecount_data;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;

  v_payload := jsonb_build_object(
    'row_id',          v_row.id,
    'organization_id', v_row.organization_id,
    'op',              TG_OP
  );

  PERFORM pg_notify('cycle_count_data_changed', v_payload::text);
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION public.notify_cycle_count_data_changed() IS
  'NOTIFY trigger emitted on rr_cyclecount_data row change. Consumed by '
  'rust-work-service via sqlx PgListener; broadcast as '
  'WsEvent::CycleCountOperationChanged to org-scoped WS subscribers. '
  'Replaces the org-filtered supabase.channel(`cycle-count-changes-{orgId}`) '
  'in src/hooks/use-cycle-count-operations.ts.';

-- ───────────────────────────────────────────────────────────────────────
-- 2. Trigger
-- ───────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS rr_cyclecount_data_notify_changed
  ON public.rr_cyclecount_data;

CREATE TRIGGER rr_cyclecount_data_notify_changed
  AFTER INSERT OR UPDATE OR DELETE
  ON public.rr_cyclecount_data
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_cycle_count_data_changed();

COMMENT ON TRIGGER rr_cyclecount_data_notify_changed
  ON public.rr_cyclecount_data IS
  'Per-row pg_notify on rr_cyclecount_data change → channel '
  'cycle_count_data_changed. See notify_cycle_count_data_changed() '
  'for payload shape.';
