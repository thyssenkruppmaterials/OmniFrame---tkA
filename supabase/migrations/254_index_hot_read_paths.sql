-- Migration: Index hot read paths (v1.7.8 — Agent + DB load reduction)
-- Date: 2026-05-02
-- Description:
--   Tier 2/5 fix from the OmniFrame agent + Supabase load investigation.
--   The dashboard fleet card, the agent's job-claim RPC, and the trigger
--   backfill poller all run frequent, narrow SELECTs against
--   `sap_agents`, `sap_agent_jobs`, and `rf_putaway_operations`. The
--   v1.5/v1.6 indexes covered them only partially — none had a
--   `last_seen_at DESC` ordering for the fleet probe, and the partial
--   `claim_path` index that the FOR UPDATE SKIP LOCKED scan walks
--   inside `claim_sap_agent_job` did not exist at all (the row had to
--   be located via the broader `idx_sap_agent_jobs_queue` and then
--   re-sorted in memory).
--
--   This migration is purely additive — no existing index is touched
--   and no column is added. Idempotent (`IF NOT EXISTS`). Indexes are
--   composite + partial where the cardinality math demands so we
--   don't bloat the table footprint on tens of thousands of historic
--   `sap_agent_jobs` rows.
--
--   See [[Implementations/Implement-Agent-DB-Load-Reduction]].

-- ───────────────────────────────────────────────────────────────────────
-- 1. sap_agents — fleet card / `useAgentDetection` org+status probe
-- ───────────────────────────────────────────────────────────────────────
-- Filters in production:
--   organization_id = eq.X AND status = eq.online (most common)
-- Order: last_seen_at DESC for the "most recently alive first" UI sort.
-- Composite ASC,ASC,DESC matches the `(filter, filter, ORDER BY)` shape
-- so PostgreSQL can satisfy the query with a single index scan.
CREATE INDEX IF NOT EXISTS idx_sap_agents_org_status_lastseen
  ON public.sap_agents (organization_id, status, last_seen_at DESC);

-- Online-only partial index. Strictly redundant with the composite
-- above for the org+status=online case BUT cheaper for fleet-card
-- "show currently online agents" because the partial index physically
-- excludes offline rows so the planner doesn't need to filter at scan
-- time. Materially helpful on orgs with many cycled-out agents.
CREATE INDEX IF NOT EXISTS idx_sap_agents_online
  ON public.sap_agents (organization_id, last_seen_at DESC)
  WHERE status = 'online';

-- ───────────────────────────────────────────────────────────────────────
-- 2. sap_agent_jobs — `claim_sap_agent_job` FOR UPDATE SKIP LOCKED scan
-- ───────────────────────────────────────────────────────────────────────
-- The lease-aware claim RPC (migration 247) walks queued rows for an
-- org sorted by `priority ASC, created_at ASC`. The existing
-- `idx_sap_agent_jobs_queue` covers (organization_id, status, priority,
-- created_at) for both queued AND running rows — useful for the lease
-- reaper but heavier than the claim path needs. This partial index is
-- queued-only with the explicit `priority DESC` requested by the
-- investigation report's Tier 5 spec; PostgreSQL can scan an index
-- backward to satisfy `priority ASC` so the index is usable in either
-- direction. The point is to give the planner a tiny, hot, queued-only
-- B-tree to walk under the FOR UPDATE SKIP LOCKED lock.
CREATE INDEX IF NOT EXISTS idx_sap_agent_jobs_claim_path
  ON public.sap_agent_jobs (organization_id, status, priority DESC, created_at ASC)
  WHERE status = 'queued';

-- ───────────────────────────────────────────────────────────────────────
-- 3. rf_putaway_operations — trigger backfill poller PostgREST query
-- ───────────────────────────────────────────────────────────────────────
-- The agent's `_start_trigger_backfill_poller` (v1.6.9) fires a query
-- every 60s when Realtime has been silent (v1.7.8 gates this on
-- `state.last_realtime_event_at` so steady-state polls are skipped —
-- but cold-start, post-circuit-breaker-trip, and after-VDA-resume
-- polls still run). Filter:
--     to_status = 'Completed' AND confirmed_at IS NULL
--   plus organization_id and a 24h `created_at` lower bound.
-- Partial index covering exactly that predicate avoids a full table
-- scan on the hot `rf_putaway_operations` table (which has thousands
-- of confirmed rows that should be invisible to the poller).
CREATE INDEX IF NOT EXISTS idx_rf_putaway_ops_backfill_target
  ON public.rf_putaway_operations (organization_id, created_at DESC)
  WHERE to_status = 'Completed' AND confirmed_at IS NULL;

-- Note: index creation is wrapped in NORMAL transactions (no
-- CONCURRENTLY) because Supabase migration apply runs each file in a
-- transaction. On the production project these tables are small enough
-- (<100k rows each) that a brief AccessShareLock during build is
-- acceptable. If we later see lock contention we can split this file
-- and re-issue the indexes with `CREATE INDEX CONCURRENTLY` outside a
-- transaction via the Supabase Dashboard SQL editor.
