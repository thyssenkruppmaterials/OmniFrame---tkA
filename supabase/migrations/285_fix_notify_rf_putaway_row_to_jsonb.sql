-- ============================================================================
-- Migration 285 — Fix notify_rf_putaway_changed: row_to_jsonb -> to_jsonb
-- ============================================================================
--
-- Symptom (production, 2026-05-07):
--   ❌ RF Putaway Service: Database error: {
--     code: '42883',
--     message: 'function row_to_jsonb(rf_putaway_operations) does not exist',
--     hint:  'No function matches the given name and argument types...'
--   }
--   Operators couldn't submit putaways because the
--   `complete_putaway_and_clear_cart` RPC's INSERT into
--   `rf_putaway_operations` fired the AFTER trigger
--   `rf_putaway_notify_changed`, which executes
--   `public.notify_rf_putaway_changed()`. That function called the
--   non-existent built-in `row_to_jsonb(record)`, raising 42883 inside
--   the trigger and rolling back the entire transaction.
--
-- Root cause:
--   `row_to_jsonb` is NOT a Postgres built-in. The actual built-ins are:
--     * `pg_catalog.row_to_json(record) -> json`     (json, not jsonb)
--     * `pg_catalog.to_jsonb(anyelement) -> jsonb`   (jsonb, takes records too)
--   Migration 276 (`276_notify_rf_putaway_changed.sql`, applied
--   2026-05-07 03:25 UTC as part of rust-work-service Phase 4) was
--   created with the typo `row_to_jsonb(NEW)`. The function definition
--   itself parsed and stored fine — the resolution failure only fires
--   when the trigger executes against an actual row insert/update,
--   which is what made it past CI and into production. Verified via
--   `SELECT FROM pg_catalog.pg_proc WHERE proname = 'row_to_jsonb'` —
--   zero rows in any schema.
--
--   This is *not* a `search_path` bug. The function's
--   `SET search_path = public, pg_temp` is fine — `pg_catalog` is
--   always implicitly searched first by Postgres regardless of
--   `search_path`, and the other built-ins in the same body
--   (`pg_notify`, `json_build_object`) resolved correctly.
--
-- Fix:
--   `to_jsonb(NEW)` is semantically identical to the intent of the
--   buggy `row_to_jsonb(NEW)` — both produce a `jsonb` object with
--   column names as keys. The Rust listener
--   (`rust-work-service/src/rf_putaway_listener.rs`) deserializes
--   `new` as a loose `serde_json::Value`, so the wire-format change
--   is exactly zero (jsonb -> text round-trip via pg_notify is
--   identical for both functions on a composite row).
--
-- Scope:
--   * Only the body of `notify_rf_putaway_changed()` changes.
--   * Function attributes preserved verbatim: SECURITY DEFINER,
--     search_path = public, pg_temp, language plpgsql, returns trigger.
--   * Trigger `rf_putaway_notify_changed` is NOT touched (still binds
--     to this function by name).
--   * Idempotent — `CREATE OR REPLACE`.
--
-- Rollback (restore the broken behaviour — DO NOT RUN):
--   CREATE OR REPLACE FUNCTION public.notify_rf_putaway_changed()
--   RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
--   SET search_path = public, pg_temp
--   AS $$
--   BEGIN
--     PERFORM pg_notify('rf_putaway_operation_changed', json_build_object(
--       'row_id',           NEW.id,
--       'organization_id',  NEW.organization_id,
--       'op',               TG_OP,
--       'new',              row_to_jsonb(NEW)
--     )::text);
--     RETURN NEW;
--   END;
--   $$;
-- ============================================================================

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
    'new',              to_jsonb(NEW)
  )::text);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_rf_putaway_changed() IS
  'NOTIFY trigger emitted on rf_putaway_operations row change. Consumed '
  'by rust-work-service via sqlx PgListener; broadcast as '
  'WsEvent::RfPutawayChanged to org-scoped WS subscribers. Replaces the '
  'omni_agent direct Supabase Realtime listener. Body uses to_jsonb(NEW) '
  '(NOT the non-existent row_to_jsonb) — see migration 285 for the '
  'production incident that motivated this clarification.';
