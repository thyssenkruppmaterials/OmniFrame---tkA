-- Phase 11 (rust-work-service integration plan) — revert REPLICA IDENTITY on
-- `public.rf_putaway_operations` to DEFAULT now that rust-work-service
-- broadcasts row deltas via NOTIFY (migration 276 + Phase 4) instead of
-- Supabase Realtime as the agent's row-event source.
--
-- Rationale
-- ---------
-- Migration 255 (`255_optimize_replica_identity.sql`, 2026-05-04) flipped
-- `sap_agents`, `sap_agent_jobs`, `sap_agent_schedules`, and
-- `sap_outbound_to_import_runs` from REPLICA IDENTITY FULL → DEFAULT to
-- shrink Realtime UPDATE payloads. `rf_putaway_operations` was deliberately
-- left at REPLICA IDENTITY FULL because the agent-side trigger evaluator
-- (v1.6.4 era) inspected the OLD row image that Realtime synthesises only
-- when REPLICA IDENTITY is FULL.
--
-- Phase 4 (2026-05-06, [[Implement-Rust-Work-Service-Phase4]]) replaced the
-- agent's Supabase Realtime path on `rf_putaway_operations` with a
-- `WsEvent::RfPutawayChanged` consumer fed by migration 276's
-- `notify_rf_putaway_changed` trigger (which ships `row_to_jsonb(NEW)` over
-- a Postgres NOTIFY channel — REPLICA IDENTITY plays no role in that
-- payload). Phase 9 (2026-05-07,
-- [[Implement-Rust-Work-Service-Phase9]]) deleted the agent-side trigger
-- evaluator entirely, so even the legacy Realtime callback path no longer
-- inspects the OLD image. The only remaining REPLICA IDENTITY consumer is
-- Supabase Realtime itself, used now exclusively by human dashboard
-- subscriptions for cache-invalidation patterns where key-only events are
-- sufficient.
--
-- Cost of REPLICA IDENTITY FULL on a hot table: every UPDATE writes the
-- full OLD row to WAL alongside the NEW row. On `rf_putaway_operations`
-- that's ~30 columns × N updates/day per warehouse — non-trivial WAL
-- bandwidth for a benefit nobody consumes anymore.
--
-- This migration flips it back to DEFAULT (PRIMARY KEY only in WAL on
-- UPDATE/DELETE) and asserts the change took effect. Phase 11 closes the
-- last loose end from the rust-work-service migration arc.

ALTER TABLE public.rf_putaway_operations REPLICA IDENTITY DEFAULT;

-- Verify the change took effect. relreplident codes:
--   d = DEFAULT (primary key)
--   n = NOTHING
--   f = FULL
--   i = INDEX
DO $$
DECLARE
  rel_replident "char";
BEGIN
  SELECT relreplident INTO rel_replident
  FROM pg_class
  WHERE oid = 'public.rf_putaway_operations'::regclass;

  IF rel_replident <> 'd' THEN
    RAISE EXCEPTION 'REPLICA IDENTITY did not flip to DEFAULT (got %)', rel_replident;
  END IF;
END $$;

COMMENT ON TABLE public.rf_putaway_operations IS
  'RF putaway operations log. REPLICA IDENTITY DEFAULT (Phase 11, '
  'migration 284) — full row payloads now delivered to rust-work-service '
  'via the migration-276 NOTIFY trigger (notify_rf_putaway_changed), not '
  'Supabase Realtime. The OmniFrame agent consumes WsEvent::RfPutawayChanged '
  'from rust-work-service /ws since Phase 4 (2026-05-06). REPLICA IDENTITY '
  'FULL was retired to reduce WAL bandwidth — see '
  '[[Implement-Rust-Work-Service-Phase11]] for the migration arc summary.';
