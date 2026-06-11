-- Migration: NOTIFY trigger on `sap_agents` for the Rust WS migration
-- Date: 2026-05-06
-- Description:
--   Companion to the `WsEvent::SapAgentChanged` migration documented in
--   memorybank/OmniFrame/Decisions/Roadmap-Rust-WS-Unlocks.md
--   ("Sprint after Option 2"). Replaces the highest-fanout
--   `supabase.channel('postgres_changes')` consumer in the app
--   (`omniframe-agent-detection-fleet` + `sap-agents-fleet`) with an
--   explicit Postgres NOTIFY → `rust-work-service` PgListener →
--   `broadcast::Sender<WsEvent>` → org-scoped subscribers fan-out.
--
-- Mirrors the shape of `work_engine_notify_settings_changed` (mig 256):
--   * SECURITY DEFINER — trigger runs irrespective of caller RLS so the
--     Postgres notification is authoritative regardless of which role
--     (agent JWT, supervisor JWT, service role) caused the row change.
--   * `search_path = public, pg_temp` — paranoia hardening on the
--     SECURITY DEFINER body.
--   * `OR REPLACE` / `IF NOT EXISTS` so the migration is re-runnable.
--   * Trigger fires AFTER INSERT OR UPDATE OR DELETE so the JSON
--     payload always sees a row that has been committed (or is about
--     to be).
--
-- Payload shape (consumed by `rust-work-service::sap_agents_listener`):
--   {
--     "agent_id":        text,        -- sap_agents.id (TEXT, not UUID)
--     "organization_id": uuid,
--     "status":          text,        -- 'online' | 'offline' | 'draining'
--     "last_seen_at":    timestamptz, -- ISO 8601, nullable on DELETE
--     "op":              text         -- 'INSERT' | 'UPDATE' | 'DELETE'
--   }
--
-- Channel name: `sap_agent_changed` (singular event noun, matches the
-- existing `work_engine_settings_changed` naming rhythm).
--
-- The trigger is a NO-OP from the row's POV — it only PERFORMs
-- `pg_notify`, never reads/writes any other table. So no perf impact
-- on the heartbeat write path beyond the cost of one `pg_notify` per
-- UPDATE (microsecond-scale).

-- ───────────────────────────────────────────────────────────────────────
-- 1. Notifier function
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_sap_agent_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payload jsonb;
  v_row     public.sap_agents;
BEGIN
  -- On DELETE, NEW is NULL — read OLD instead so the org_id and id
  -- still make it through to the listener (so connected clients can
  -- evict the row from their UI).
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;

  v_payload := jsonb_build_object(
    'agent_id',        v_row.id,
    'organization_id', v_row.organization_id,
    'status',          v_row.status,
    'last_seen_at',    v_row.last_seen_at,
    'op',              TG_OP
  );

  PERFORM pg_notify('sap_agent_changed', v_payload::text);
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION public.notify_sap_agent_changed() IS
  'NOTIFY trigger emitted on sap_agents row change. Consumed by '
  'rust-work-service via sqlx PgListener; broadcast as '
  'WsEvent::SapAgentChanged to org-scoped WS subscribers. Replaces the '
  'browser-side supabase.channel(postgres_changes) listeners in '
  'use-agent-detection.ts and agents-fleet-card.tsx.';

-- ───────────────────────────────────────────────────────────────────────
-- 2. Trigger
-- ───────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS sap_agents_notify_changed ON public.sap_agents;

CREATE TRIGGER sap_agents_notify_changed
  AFTER INSERT OR UPDATE OR DELETE
  ON public.sap_agents
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_sap_agent_changed();

COMMENT ON TRIGGER sap_agents_notify_changed ON public.sap_agents IS
  'Per-row pg_notify on sap_agents change → channel sap_agent_changed. '
  'See notify_sap_agent_changed() for payload shape.';
