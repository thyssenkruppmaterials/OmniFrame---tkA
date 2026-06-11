-- Migration: NOTIFY trigger on `rr_lx03_data` for the Rust WS migration
-- Date: 2026-05-06
-- Description:
--   Companion to the `WsEvent::Lx03DataChanged` migration. Replaces
--   the unfiltered `supabase.channel('lx03-data-changes')` callsite in
--   `src/hooks/use-lx03-data.ts`. The pre-existing channel had NO org
--   filter (its only filter was `event:'*', schema:'public', table:
--   'rr_lx03_data'`); this migration preserves that observed behaviour
--   while pushing the fan-out through the typed Rust WS infra.
--
-- IMPORTANT (org_id nullability):
--   `rr_lx03_data.organization_id` is NULLABLE in the schema. For rows
--   with NULL org_id, the trigger emits `organization_id: null` in the
--   payload — the Rust send-loop treats events with no org_id as
--   "system-wide" and broadcasts to every connected client, which
--   matches the existing pre-migration behaviour of the unfiltered
--   Supabase channel. The frontend handler defends-in-depth by
--   ignoring events whose `organization_id` doesn't match the user's
--   org — see the migration note for the rationale.
--
-- Mirrors mig 270 / 271 / 272 / 273 shape:
--   * SECURITY DEFINER + `search_path = public, pg_temp`.
--   * `OR REPLACE` / `IF NOT EXISTS` so re-runnable.
--   * AFTER INSERT OR UPDATE OR DELETE.
--
-- Payload shape (consumed by `rust-work-service::lx03_listener`):
--   {
--     "row_id":          uuid,        -- rr_lx03_data.id
--     "organization_id": uuid|null,   -- NULLABLE — see note above
--     "op":              text         -- 'INSERT' | 'UPDATE' | 'DELETE'
--   }
--
-- Channel name: `lx03_data_changed`.

-- ───────────────────────────────────────────────────────────────────────
-- 1. Notifier function
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_lx03_data_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payload jsonb;
  v_row     public.rr_lx03_data;
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

  PERFORM pg_notify('lx03_data_changed', v_payload::text);
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION public.notify_lx03_data_changed() IS
  'NOTIFY trigger emitted on rr_lx03_data row change. Consumed by '
  'rust-work-service via sqlx PgListener; broadcast as '
  'WsEvent::Lx03DataChanged to WS subscribers (org-scoped when '
  'organization_id is non-NULL). Replaces the unfiltered '
  'supabase.channel(`lx03-data-changes`) in src/hooks/use-lx03-data.ts.';

-- ───────────────────────────────────────────────────────────────────────
-- 2. Trigger
-- ───────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS rr_lx03_data_notify_changed ON public.rr_lx03_data;

CREATE TRIGGER rr_lx03_data_notify_changed
  AFTER INSERT OR UPDATE OR DELETE
  ON public.rr_lx03_data
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_lx03_data_changed();

COMMENT ON TRIGGER rr_lx03_data_notify_changed
  ON public.rr_lx03_data IS
  'Per-row pg_notify on rr_lx03_data change → channel lx03_data_changed. '
  'See notify_lx03_data_changed() for payload shape.';
