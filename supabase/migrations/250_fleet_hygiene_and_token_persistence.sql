-- Migration: Fleet hygiene + token persistence (v1.6.5)
-- Date: 2026-04-30
-- Description:
--   The OmniFrame on-prem agent gained a per-machine `agent_token` in
--   v1.4.0 but the model was broken in three subtle ways that surfaced
--   as "the SAP Agent has gotten much clunkier" in production:
--
--     1. The PID was part of `_agent_self_id()`, so every EXE rebuild
--        produced a NEW row in `sap_agents` while the old rows just
--        sat there marked `online` until the 90s reaper finally caught
--        up — and the user was rebuilding faster than the reap window.
--        Fleet card showed 6 rows, only 1 actually online.
--
--     2. The reaper was never invoked on a schedule. v1.4.0 added the
--        function but only called it opportunistically from /agents
--        and the agent's own heartbeat. If no one was looking at the
--        fleet card AND no agent was running, dead rows persisted
--        marked `online` until something poked the function.
--
--     3. The agent_token rotated on every /supabase/login, kicking the
--        browser out of every authenticated call after every rebuild.
--        That broke the UX layer; this migration covers the SCHEMA
--        layer required by the agent-side fix (a per-process
--        `process_started_at` column so we can keep the agent_id
--        stable while still surfacing per-process debug info).
--
--   This migration is idempotent and safe to re-run.

-- ───────────────────────────────────────────────────────────────────────
-- 1. sap_agents.process_started_at — per-process fingerprint
-- ───────────────────────────────────────────────────────────────────────
-- v1.6.5 dropped the PID from `id` so heartbeats merge into one stable
-- row. We still want ops to see "this row was last heartbeat'd by a
-- process that started at HH:MM" so a boot-loop or zombie process is
-- visible. Stored on the agent's heartbeat upsert; the v1.6.5 agent
-- code is tolerant of the column being absent (so an out-of-order
-- migration vs rebuild doesn't break the fleet card; see
-- `_REGISTRY_DROP_PROCESS_STARTED_AT` in agent.py).
ALTER TABLE "public"."sap_agents"
  ADD COLUMN IF NOT EXISTS "process_started_at" TIMESTAMPTZ;

COMMENT ON COLUMN "public"."sap_agents"."process_started_at" IS
  'When the agent OS process most recently started (UTC). Updated on every heartbeat. Diverges from registered_at after the first restart. v1.6.5+: replaces the now-removed PID suffix in `id` for per-process debug visibility.';


-- ───────────────────────────────────────────────────────────────────────
-- 2. mark_stale_sap_agents_offline() — aggressive 2-min reaper
-- ───────────────────────────────────────────────────────────────────────
-- The original `reap_stale_sap_agents(p_grace_seconds=90)` is preserved
-- and still callable. The new wrapper hard-codes a 2-minute grace and
-- carries the documentation that it's the one pg_cron drives every
-- minute. Idempotent: if no rows are stale it returns 0.
--
-- 2 minutes = 4 missed 30s heartbeats. Anything tighter (e.g. 90s) is
-- borderline flap-prone on a busy Citrix host where the heartbeat
-- thread occasionally lags. Anything looser (e.g. 5min) leaves dead
-- rows lingering long enough to confuse the user during multi-rebuild
-- iteration.
CREATE OR REPLACE FUNCTION "public"."mark_stale_sap_agents_offline"()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH updated AS (
    UPDATE "public"."sap_agents"
       SET status = 'offline'
     WHERE status <> 'offline'
       AND last_seen_at < now() - interval '2 minutes'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM updated;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION "public"."mark_stale_sap_agents_offline"()
  TO authenticated, anon, service_role;

COMMENT ON FUNCTION "public"."mark_stale_sap_agents_offline"() IS
  'v1.6.5 — flips sap_agents rows to offline when last_seen_at is older than 2 minutes. Wrapped by pg_cron job omniframe-reap-stale-sap-agents (every minute). Idempotent; returns the number of rows flipped.';


-- ───────────────────────────────────────────────────────────────────────
-- 3. purge_old_offline_sap_agents() — week-old offline cleanup
-- ───────────────────────────────────────────────────────────────────────
-- DELETE (not just mark offline) any sap_agents row that has been
-- offline for >7 days. Backstop for the case where the user's machine
-- name changed permanently (new Citrix VDA pool, hardware refresh) so
-- the old id will never come back. Wired up to a separate weekly
-- pg_cron job.
CREATE OR REPLACE FUNCTION "public"."purge_old_offline_sap_agents"(
  p_max_age_days INTEGER DEFAULT 7
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM "public"."sap_agents"
     WHERE status = 'offline'
       AND last_seen_at < now() - make_interval(days => p_max_age_days)
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM deleted;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION "public"."purge_old_offline_sap_agents"(INTEGER)
  TO authenticated, anon, service_role;

COMMENT ON FUNCTION "public"."purge_old_offline_sap_agents"(INTEGER) IS
  'v1.6.5 — DELETE sap_agents rows that have been offline for >p_max_age_days. Default 7. Idempotent; returns the count.';


-- ───────────────────────────────────────────────────────────────────────
-- 4. pg_cron registration (idempotent, gracefully no-ops if absent)
-- ───────────────────────────────────────────────────────────────────────
-- Same opt-in pattern as migration 248 (sap_agent_schedules). pg_cron
-- is enabled on the OmniFrame Supabase project so this clause runs;
-- on local dev / branches without pg_cron, the table changes still
-- apply and the agent's existing 30s heartbeat triggers `reap_stale_sap_agents`
-- opportunistically. Adds two jobs:
--   - omniframe-reap-stale-sap-agents (every minute, 2-min cutoff)
--   - omniframe-purge-old-offline-sap-agents (weekly, 7-day cutoff)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
      FROM cron.job
     WHERE jobname IN (
       'omniframe-reap-stale-sap-agents',
       'omniframe-purge-old-offline-sap-agents'
     );

    PERFORM cron.schedule(
      'omniframe-reap-stale-sap-agents',
      '* * * * *',
      $cron$ SELECT public.mark_stale_sap_agents_offline(); $cron$
    );
    RAISE NOTICE 'pg_cron job omniframe-reap-stale-sap-agents scheduled (every minute).';

    -- Sundays at 03:30 UTC. Off-hours for the typical NA warehouse
    -- shift; well after the schedules sweep so we don't fight for the
    -- same row locks on the rare hot row.
    PERFORM cron.schedule(
      'omniframe-purge-old-offline-sap-agents',
      '30 3 * * 0',
      $cron$ SELECT public.purge_old_offline_sap_agents(7); $cron$
    );
    RAISE NOTICE 'pg_cron job omniframe-purge-old-offline-sap-agents scheduled (weekly Sun 03:30 UTC).';
  ELSE
    RAISE NOTICE 'pg_cron extension not enabled — sap_agents reaping will only run when an agent calls reap_stale_sap_agents() opportunistically. Enable in Supabase Dashboard → Database → Extensions and re-run this DO block.';
  END IF;
END $$;
