-- Migration: Multi-Agent Coordination (Phase D #13)
-- Date: 2026-04-29
-- Description:
--   Extends the Phase A1 SAP job queue to support a fleet of agents
--   running on different Citrix sessions/warehouses, with:
--
--     1. Per-agent registry (`sap_agents`) so the dashboard can show
--        who is online, what they're working on, and which capabilities
--        each agent reports.
--
--     2. Job pinning: a job can declare `assigned_agent_id` to make it
--        only claimable by that specific agent (e.g. a Reno-only LT12
--        sweep that should run on the Reno Citrix box).
--
--     3. Lease-based claims with reaper: each claim now sets
--        `claim_lease_until = now() + 5 min`. The agent extends the
--        lease via heartbeat. If the lease expires (agent crashed,
--        Citrix session died, network split), another agent can re-claim
--        the same row. `claim_count` tracks how many times a row has
--        been re-claimed so dashboards can flag stuck jobs.
--
--   The `claim_sap_agent_job` RPC is replaced (drop + recreate to keep
--   a single canonical signature) with a richer version that accepts
--   the agent id and atomically picks the highest-priority job that
--   either has no pin or is pinned to this agent.

-- ───────────────────────────────────────────────────────────────────────
-- 1. Schema additions to sap_agent_jobs
-- ───────────────────────────────────────────────────────────────────────
ALTER TABLE "public"."sap_agent_jobs"
  ADD COLUMN IF NOT EXISTS "assigned_agent_id" TEXT,
  ADD COLUMN IF NOT EXISTS "claim_lease_until" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "claim_count" INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN "public"."sap_agent_jobs"."assigned_agent_id" IS
  'Optional pin — when set, only the agent whose sap_agents.id equals this value may claim the row. NULL means any agent in the org may claim.';
COMMENT ON COLUMN "public"."sap_agent_jobs"."claim_lease_until" IS
  'When the current claim lease expires. Heartbeats from the running agent push this forward by 5 min. If now() > this value, the row is eligible for re-claim by any agent.';
COMMENT ON COLUMN "public"."sap_agent_jobs"."claim_count" IS
  'How many times this row has been claimed. >1 means a previous owner crashed or its lease expired. Surface as a "stuck job" warning in the UI.';

-- Index supporting the lease-expiry reaper / re-claim path.
CREATE INDEX IF NOT EXISTS "idx_sap_agent_jobs_lease"
  ON "public"."sap_agent_jobs" ("status", "claim_lease_until")
  WHERE "status" = 'running';

-- Partial index supporting fast pinned-agent claim queries.
CREATE INDEX IF NOT EXISTS "idx_sap_agent_jobs_assigned"
  ON "public"."sap_agent_jobs" ("organization_id", "assigned_agent_id", "status")
  WHERE "status" IN ('queued', 'running');


-- ───────────────────────────────────────────────────────────────────────
-- 2. sap_agents — fleet registry
-- ───────────────────────────────────────────────────────────────────────
-- id is TEXT (not UUID) so the agent can self-mint a stable identifier
-- from hostname + Citrix session info without round-tripping a UUID.
-- Format used by the agent: "<COMPUTERNAME>-<SESSIONNAME>-<PID>" but
-- the schema does not constrain it.
CREATE TABLE IF NOT EXISTS "public"."sap_agents" (
  "id" TEXT PRIMARY KEY,
  "organization_id" UUID NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "display_name" TEXT,
  "hostname" TEXT,
  "citrix_session" TEXT,
  "version" TEXT,
  "sap_system" TEXT,
  "sap_client" TEXT,
  "sap_user" TEXT,
  "capabilities" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "status" TEXT NOT NULL DEFAULT 'online' CHECK (
    "status" IN ('online', 'offline', 'draining')
  ),
  "current_action" JSONB,
  "transactions_per_hour" NUMERIC,
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "registered_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE "public"."sap_agents" IS
  'Heartbeat registry of every OmniFrame on-prem agent currently or recently online. Upserted every 30s by the agent. Reaped to status=offline by claim_sap_agent_job(...) when last_seen_at < now() - 90s.';

CREATE INDEX IF NOT EXISTS "idx_sap_agents_org_status"
  ON "public"."sap_agents" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "idx_sap_agents_last_seen"
  ON "public"."sap_agents" ("last_seen_at");

ALTER TABLE "public"."sap_agents" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sap_agents'
      AND policyname = 'sap_agents_select_org'
  ) THEN
    CREATE POLICY "sap_agents_select_org"
      ON "public"."sap_agents"
      FOR SELECT
      USING (
        organization_id IN (
          SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sap_agents'
      AND policyname = 'sap_agents_upsert_org'
  ) THEN
    CREATE POLICY "sap_agents_upsert_org"
      ON "public"."sap_agents"
      FOR INSERT
      WITH CHECK (
        organization_id IN (
          SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sap_agents'
      AND policyname = 'sap_agents_update_org'
  ) THEN
    CREATE POLICY "sap_agents_update_org"
      ON "public"."sap_agents"
      FOR UPDATE
      USING (
        organization_id IN (
          SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sap_agents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sap_agents;
  END IF;
END $$;

ALTER TABLE "public"."sap_agents" REPLICA IDENTITY FULL;


-- ───────────────────────────────────────────────────────────────────────
-- 3. claim_sap_agent_job — lease-aware, pin-aware
-- ───────────────────────────────────────────────────────────────────────
-- Drop the original 2-arg signature and replace with a 3-arg one that
-- knows about agent id and lease. The agent always passes its own
-- sap_agents.id as both p_claimed_by and p_agent_id.
DROP FUNCTION IF EXISTS "public"."claim_sap_agent_job"(UUID, TEXT);

CREATE OR REPLACE FUNCTION "public"."claim_sap_agent_job"(
  p_organization_id UUID,
  p_agent_id        TEXT,
  p_lease_seconds   INTEGER DEFAULT 300
) RETURNS "public"."sap_agent_jobs"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed "public"."sap_agent_jobs"%ROWTYPE;
  v_lease_until TIMESTAMPTZ := now() + make_interval(secs => p_lease_seconds);
BEGIN
  -- Pick the next eligible row for this agent. A row is eligible if it is:
  --   (a) queued, OR
  --   (b) running but its lease has expired (previous owner crashed)
  -- AND it is either unpinned or pinned to this agent.
  UPDATE "public"."sap_agent_jobs"
     SET status            = 'running',
         claimed_by        = p_agent_id,
         assigned_agent_id = COALESCE(assigned_agent_id, p_agent_id),
         claimed_at        = now(),
         claim_lease_until = v_lease_until,
         claim_count       = claim_count + 1,
         started_at        = COALESCE(started_at, now()),
         heartbeat_at      = now(),
         attempts          = attempts + 1
   WHERE id = (
           SELECT id
             FROM "public"."sap_agent_jobs"
            WHERE organization_id = p_organization_id
              AND (assigned_agent_id IS NULL OR assigned_agent_id = p_agent_id)
              AND (
                    status = 'queued'
                 OR (status = 'running' AND COALESCE(claim_lease_until, claimed_at + interval '5 minutes') < now())
                  )
            ORDER BY priority ASC, created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
   RETURNING * INTO claimed;

  RETURN claimed;
END;
$$;

GRANT EXECUTE ON FUNCTION "public"."claim_sap_agent_job"(UUID, TEXT, INTEGER)
  TO authenticated, anon, service_role;

COMMENT ON FUNCTION "public"."claim_sap_agent_job"(UUID, TEXT, INTEGER) IS
  'Atomically claims the next sap_agent_jobs row for the supplied agent. Honours assigned_agent_id pinning, sets claim_lease_until = now() + p_lease_seconds, and recovers stale claims whose lease has expired. Multiple agents racing on the same org are serialized by FOR UPDATE SKIP LOCKED.';


-- ───────────────────────────────────────────────────────────────────────
-- 4. bump_sap_agent_job_lease — heartbeat extension
-- ───────────────────────────────────────────────────────────────────────
-- Called by the agent every 30s for the row it currently has running.
-- Pushes the lease forward without touching status/result. Returns
-- the new lease expiry so the caller can detect a lost claim
-- (e.g. row was reaped by another agent and is no longer ours).
CREATE OR REPLACE FUNCTION "public"."bump_sap_agent_job_lease"(
  p_job_id        UUID,
  p_agent_id      TEXT,
  p_lease_seconds INTEGER DEFAULT 300
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_lease TIMESTAMPTZ := now() + make_interval(secs => p_lease_seconds);
  v_actual    TIMESTAMPTZ;
BEGIN
  UPDATE "public"."sap_agent_jobs"
     SET claim_lease_until = v_new_lease,
         heartbeat_at      = now()
   WHERE id = p_job_id
     AND status = 'running'
     AND claimed_by = p_agent_id
   RETURNING claim_lease_until INTO v_actual;

  RETURN v_actual;
END;
$$;

GRANT EXECUTE ON FUNCTION "public"."bump_sap_agent_job_lease"(UUID, TEXT, INTEGER)
  TO authenticated, anon, service_role;

COMMENT ON FUNCTION "public"."bump_sap_agent_job_lease"(UUID, TEXT, INTEGER) IS
  'Extends claim_lease_until on a running job. Returns NULL if the row no longer belongs to p_agent_id (lost claim) so the agent can abort.';


-- ───────────────────────────────────────────────────────────────────────
-- 5. reap_stale_sap_agents — mark missing-heartbeat agents offline
-- ───────────────────────────────────────────────────────────────────────
-- Called opportunistically (e.g. when listing /agents). 90s grace window
-- so a single missed 30s heartbeat doesn't flap an agent offline.
CREATE OR REPLACE FUNCTION "public"."reap_stale_sap_agents"(
  p_grace_seconds INTEGER DEFAULT 90
) RETURNS INTEGER
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
       AND last_seen_at < now() - make_interval(secs => p_grace_seconds)
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM updated;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION "public"."reap_stale_sap_agents"(INTEGER)
  TO authenticated, anon, service_role;
