-- Migration: SAP Agent Job Queue (Phase A1)
-- Date: 2026-04-29
-- Description:
--   Persistent, org-scoped job queue that decouples the browser from the
--   on-prem SAP agent. The browser (or Agent Triggers runtime) enqueues
--   a row, the agent claims and runs it on its single SAP session, and
--   the result is streamed back to the browser via Supabase Realtime.
--
--   Why this exists:
--     - Lets a batch survive a page reload (mass MM02 updates can run
--       for tens of minutes).
--     - Provides a serialization point for SAP (the agent claims one
--       row at a time — SAP scripting is single-threaded per session).
--     - Enables per-org observability and future multi-agent fan-out.
--
--   The agent claim path uses a single atomic UPDATE with a
--   `RETURNING` clause inside `claim_sap_agent_job(...)` so two agents
--   running against the same org never race onto the same row.

CREATE TABLE IF NOT EXISTS "public"."sap_agent_jobs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "requested_by" UUID REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL,
  "endpoint" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" TEXT NOT NULL DEFAULT 'queued' CHECK (
    "status" IN ('queued', 'running', 'completed', 'failed', 'canceled')
  ),
  "claimed_by" TEXT,
  "claimed_at" TIMESTAMPTZ,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 1,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "result" JSONB,
  "error" TEXT,
  "step" TEXT,
  "idempotency_key" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "heartbeat_at" TIMESTAMPTZ,
  CONSTRAINT "sap_agent_jobs_idem_unique" UNIQUE ("organization_id", "idempotency_key")
);

COMMENT ON TABLE "public"."sap_agent_jobs" IS
  'Org-scoped job queue feeding the on-prem OmniFrame SAP agent. Agent polls /jobs/claim, atomically claims one row at a time (SAP is single-threaded), runs the matching local endpoint, then PATCHes status to completed/failed.';
COMMENT ON COLUMN "public"."sap_agent_jobs"."endpoint" IS
  'Local agent path to dispatch (e.g. /sap/material-master-bin, /sap/confirm-to).';
COMMENT ON COLUMN "public"."sap_agent_jobs"."priority" IS
  'Lower numbers run first. Default 100 is "normal"; set < 100 for triggers.';
COMMENT ON COLUMN "public"."sap_agent_jobs"."idempotency_key" IS
  'Optional client-supplied dedupe token. UNIQUE per org so a retried submission becomes a no-op instead of a double commit.';

CREATE INDEX IF NOT EXISTS "idx_sap_agent_jobs_queue"
  ON "public"."sap_agent_jobs" ("organization_id", "status", "priority", "created_at")
  WHERE "status" IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS "idx_sap_agent_jobs_org_status"
  ON "public"."sap_agent_jobs" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "idx_sap_agent_jobs_requested_by"
  ON "public"."sap_agent_jobs" ("requested_by");

ALTER TABLE "public"."sap_agent_jobs" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sap_agent_jobs'
      AND policyname = 'sap_agent_jobs_select_org'
  ) THEN
    CREATE POLICY "sap_agent_jobs_select_org"
      ON "public"."sap_agent_jobs"
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
      AND tablename = 'sap_agent_jobs'
      AND policyname = 'sap_agent_jobs_insert_org'
  ) THEN
    CREATE POLICY "sap_agent_jobs_insert_org"
      ON "public"."sap_agent_jobs"
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
      AND tablename = 'sap_agent_jobs'
      AND policyname = 'sap_agent_jobs_update_org'
  ) THEN
    CREATE POLICY "sap_agent_jobs_update_org"
      ON "public"."sap_agent_jobs"
      FOR UPDATE
      USING (
        organization_id IN (
          SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sap_agent_jobs'
      AND policyname = 'sap_agent_jobs_delete_org'
  ) THEN
    CREATE POLICY "sap_agent_jobs_delete_org"
      ON "public"."sap_agent_jobs"
      FOR DELETE
      USING (
        organization_id IN (
          SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

-- Realtime + REPLICA IDENTITY FULL so the browser can subscribe
-- to the row it just enqueued and watch it transition through
-- queued → running → completed / failed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sap_agent_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sap_agent_jobs;
  END IF;
END $$;

ALTER TABLE "public"."sap_agent_jobs" REPLICA IDENTITY FULL;

-- Atomic claim function — picks the highest-priority queued row for the
-- caller's org, marks it 'running', and returns it. Returns NULL when
-- the queue is empty. Bypasses RLS by being SECURITY DEFINER and
-- explicitly filtering on (organization_id, status='queued').
CREATE OR REPLACE FUNCTION "public"."claim_sap_agent_job"(
  p_organization_id UUID,
  p_claimed_by      TEXT
) RETURNS "public"."sap_agent_jobs"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed "public"."sap_agent_jobs"%ROWTYPE;
BEGIN
  UPDATE "public"."sap_agent_jobs"
     SET status        = 'running',
         claimed_by    = p_claimed_by,
         claimed_at    = now(),
         started_at    = COALESCE(started_at, now()),
         heartbeat_at  = now(),
         attempts      = attempts + 1
   WHERE id = (
           SELECT id
             FROM "public"."sap_agent_jobs"
            WHERE organization_id = p_organization_id
              AND status = 'queued'
            ORDER BY priority ASC, created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
   RETURNING * INTO claimed;

  RETURN claimed;
END;
$$;

GRANT EXECUTE ON FUNCTION "public"."claim_sap_agent_job"(UUID, TEXT)
  TO authenticated, anon, service_role;

COMMENT ON FUNCTION "public"."claim_sap_agent_job"(UUID, TEXT) IS
  'Atomically claims the next queued sap_agent_jobs row for an org. Uses FOR UPDATE SKIP LOCKED so multiple agent pollers can race safely.';
