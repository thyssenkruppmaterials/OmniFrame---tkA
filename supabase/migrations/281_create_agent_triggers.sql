-- Phase 9 of `.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md` —
-- canonical `agent_triggers` table. Replaces:
--   * the hardcoded `_HARDCODED_TRIGGERS` list at line ~5031 of
--     `omni_agent/agent.py` (3 entries: builtin-rf-putaway-completed,
--     builtin-shipment-queue, builtin-pick-completed)
--   * the browser-side `use-agent-trigger-runtime.ts` (~700 LOC) — Phase 9
--     deletes that hook entirely; the FE tab becomes pure CRUD.
--
-- Architectural shift: trigger evaluation moves SERVER-SIDE into
-- `rust-work-service`. The Rust evaluator (`src/triggers/`) subscribes to
-- the existing per-table NOTIFY channels (rf_putaway_operation_changed,
-- sap_agent_job_changed, work_tasks_changed [future], …), parses each
-- row against the rules in this table, and INSERTs `sap_agent_jobs` rows
-- — the EXACT same path the agent's job poller already drains. Any
-- agent in the fleet can claim the resulting job; agents are pure
-- consumers post-Phase 9.
--
-- Security mitigations (see `ADR-Trigger-DSL-Evaluator-Phase9.md`):
--   * `source_table` is allowlisted server-side in
--     `rust-work-service/src/triggers/config.rs::ALLOWED_SOURCE_TABLES`.
--     Adding a new table requires a Rust release.
--   * `target_endpoint` is allowlisted server-side in the same const.
--     Phase 9 ships with: `/sap/confirm-to`, `/sap/process-shipment`,
--     `/sap/lt12`, `/sap/import-lt22`, `/sap/material-master-bin`,
--     `/sap/material-master-storage-types`. NOT `/sap/connect` or other
--     agent-control endpoints.
--   * `match_filter` is parsed by the whitelisted DSL grammar in
--     `rust-work-service/src/triggers/dsl.rs`. No function calls, no
--     subqueries, no column refs outside the source row.
--   * Loop detection: per-row depth counter via Redis
--     (`trigger:depth:{org}:{row_id}`, TTL 60s). At >3, abort with audit
--     log entry `{ kind: 'trigger.loop_detected', … }`.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.agent_triggers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled             BOOLEAN NOT NULL DEFAULT true,
  name                TEXT NOT NULL,
  description         TEXT,
  source_table        TEXT NOT NULL,
  source_events       TEXT[] NOT NULL,
  match_filter        JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_endpoint     TEXT NOT NULL,
  payload_template    JSONB NOT NULL DEFAULT '{}'::jsonb,
  post_success_patch  JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  CONSTRAINT agent_triggers_source_events_nonempty CHECK (cardinality(source_events) > 0)
);

CREATE INDEX IF NOT EXISTS idx_agent_triggers_org_enabled
  ON public.agent_triggers (organization_id, enabled)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_agent_triggers_source_table
  ON public.agent_triggers (source_table)
  WHERE enabled = true;

ALTER TABLE public.agent_triggers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_triggers org read" ON public.agent_triggers;
CREATE POLICY "agent_triggers org read" ON public.agent_triggers
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "agent_triggers admin write" ON public.agent_triggers;
CREATE POLICY "agent_triggers admin write" ON public.agent_triggers
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );

CREATE OR REPLACE FUNCTION public.agent_triggers_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_triggers_updated_at ON public.agent_triggers;
CREATE TRIGGER agent_triggers_updated_at
  BEFORE UPDATE ON public.agent_triggers
  FOR EACH ROW EXECUTE FUNCTION public.agent_triggers_updated_at();

-- NOTIFY on INSERT/UPDATE/DELETE so `rust-work-service`'s evaluator
-- can hot-reload its in-memory rule set without restart. Mirrors the
-- `sap_agent_changed` / `rf_putaway_operation_changed` /
-- `cycle_count_data_changed` listener pattern from Phases 3–4.
CREATE OR REPLACE FUNCTION public.notify_agent_triggers_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_notify('agent_triggers_changed', json_build_object(
    'op', TG_OP,
    'organization_id', COALESCE(NEW.organization_id, OLD.organization_id),
    'trigger_id', COALESCE(NEW.id, OLD.id)
  )::text);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS agent_triggers_notify_changed ON public.agent_triggers;
CREATE TRIGGER agent_triggers_notify_changed
  AFTER INSERT OR UPDATE OR DELETE ON public.agent_triggers
  FOR EACH ROW EXECUTE FUNCTION public.notify_agent_triggers_changed();
