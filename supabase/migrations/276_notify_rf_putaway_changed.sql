-- v1.9.0 — agent-on-Rust-WS migration (Phase 4 of
-- `.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md`).
-- Replaces the agent's direct Supabase Realtime subscription on
-- `rf_putaway_operations` with a rust-work-service-broadcast
-- `WsEvent::RfPutawayChanged` event. The trigger ships
-- `row_to_jsonb(NEW)` only — the agent's `_on_rf_putaway_change`
-- evaluator only inspects fields present in NEW (`to_status`,
-- `is_mca_workflow`, `confirmed_source`, `to_number`, `warehouse`).
-- Phase 11 of the integration plan flips the table from
-- REPLICA IDENTITY FULL → DEFAULT once direct FE Realtime consumers
-- are gone (audit step gates that flip).
--
-- Idempotent — safe to re-run.

CREATE OR REPLACE FUNCTION public.notify_rf_putaway_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_notify('rf_putaway_operation_changed', json_build_object(
    'row_id',           NEW.id,
    'organization_id',  NEW.organization_id,
    'op',               TG_OP,
    'new',              row_to_jsonb(NEW)
  )::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rf_putaway_notify_changed ON public.rf_putaway_operations;
CREATE TRIGGER rf_putaway_notify_changed
  AFTER INSERT OR UPDATE ON public.rf_putaway_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_rf_putaway_changed();
