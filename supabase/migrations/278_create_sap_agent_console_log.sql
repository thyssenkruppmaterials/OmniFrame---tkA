-- Phase 6 (2026-05-07) — fleet-wide live console streaming.
--
-- Persistent audit-trail backing the OmniFrame SAP agent's live console
-- relay. The hot path is the WebSocket fan-out (broadcast in-memory,
-- never touches this table). When the FE explicitly asks the agent
-- relay to persist a batch (`POST /api/v1/sap-console/lines` with
-- `persist=true`), the rust-work-service handler INSERTs each line
-- here so a forensic auditor can replay the agent's output post-hoc
-- without scraping operator screens.
--
-- See `.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md`
-- Phase 6 + `memorybank/OmniFrame/Implementations/Implement-Rust-Work-Service-Phase6.md`.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.sap_agent_console_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- `info | warn | error | debug | trace` — small fixed vocabulary so
  -- dashboards can colour rows without a join. NOT enforced via CHECK
  -- so a future severity (e.g. `notice` / `critical`) is wire-compatible
  -- and doesn't need a constraint flip.
  level           TEXT NOT NULL,
  message         TEXT NOT NULL,
  -- Agent-side wall-clock timestamp of the print, NOT the time the row
  -- was relayed. The lag between `ts` and `created_at` is the
  -- relay-buffer dwell time + network rtt — useful for triage when an
  -- agent reconnects after a long offline period and drains its
  -- buffer in a single batch.
  ts              TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The dominant read pattern is "show me the last N lines for org X
-- newest-first" — `(organization_id, ts DESC)` is the index that backs
-- a future `GET /api/v1/sap-console/lines?since=...` viewer endpoint
-- (deferred to Phase 11). Ordering by `ts` (agent-side) instead of
-- `created_at` keeps the timeline coherent across late-relayed
-- batches.
CREATE INDEX IF NOT EXISTS idx_sap_agent_console_log_org_ts
  ON public.sap_agent_console_log (organization_id, ts DESC);

-- Optional secondary index for per-agent filtering. Cheap (relative to
-- the table cardinality even at 100 lines/min/agent) and saves a
-- bitmap-and on the org-only path when the FE narrows to one box.
CREATE INDEX IF NOT EXISTS idx_sap_agent_console_log_org_agent_ts
  ON public.sap_agent_console_log (organization_id, agent_id, ts DESC);

ALTER TABLE public.sap_agent_console_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sap_agent_console_log org read" ON public.sap_agent_console_log;
CREATE POLICY "sap_agent_console_log org read" ON public.sap_agent_console_log
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

-- INSERTs land via the rust-work-service service role (which uses the
-- shared service-key JWT) — no RLS INSERT policy needed for the
-- agent-side write path; the route itself is org-scoped.

COMMENT ON TABLE public.sap_agent_console_log IS
  'Phase 6 (2026-05-07) — persistent audit log of OmniFrame SAP agent
   stdout/stderr lines, populated by `POST /api/v1/sap-console/lines`
   when the caller passes `persist=true`. The hot path (live console
   stream) is the WebSocket fan-out and never touches this table; this
   row store exists for forensic replay only. Cleanup policy
   (7-day retention via pg_cron) deferred to a future phase.';

COMMENT ON COLUMN public.sap_agent_console_log.ts IS
  'Agent-side wall-clock at the moment the line was printed, NOT the
   relay time. Difference between this and `created_at` reflects the
   relay buffer dwell + network rtt.';
