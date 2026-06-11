-- v1.6.6 — Honest agent attribution on rf_putaway_operations.
--
-- When the OmniAgent's hardcoded trigger flow auto-confirms a TO via
-- the agent-direct Realtime subscription (`agent_trigger_direct` source,
-- added in v1.6.4), `confirmed_by` (UUID FK to user_profiles.id, added
-- in migration 016) still holds the JWT-holder's user_id. That keeps
-- RLS working AND keeps the existing productivity rollups happy
-- (085_team_performance_optimization, 156_fix_putaway_double_count,
-- 169_customer_portal_productivity, 188_add_cart_stow_to_productivity, …
-- all join `rf_putaway_operations.confirmed_by` → `user_profiles.id` for
-- per-user counts; flipping it to NULL or to a string would break those
-- reports across the org).
--
-- These two NEW text columns let the putaway log UI display the honest
-- actor ("Omni Agent" with the bot icon) instead of the user's name in
-- the cell, without disturbing any of the existing UUID joins:
--
--   confirmed_by_label     — display string, NULL for human confirms
--                            (UI falls back to user_profiles.full_name).
--   confirmed_by_agent_id  — stable agent identifier (sap_agents.id) for
--                            fleet-side filtering / debugging. NULL for
--                            human confirms.
--
-- Idempotent — safe to re-run via Supabase MCP `apply_migration`.

ALTER TABLE public.rf_putaway_operations
  ADD COLUMN IF NOT EXISTS confirmed_by_label    text,
  ADD COLUMN IF NOT EXISTS confirmed_by_agent_id text;

COMMENT ON COLUMN public.rf_putaway_operations.confirmed_by_label IS
  'Display label for who/what confirmed the TO. Set to "Omni Agent" by '
  'the agent-side trigger flow (v1.6.6+ via _hardcoded_trigger_post_patch). '
  'NULL for manual user confirms — UI falls back to user_profiles.full_name '
  'via the confirmed_by FK. See Patterns/Agent-Self-Attribution in the '
  'omniframe vault.';

COMMENT ON COLUMN public.rf_putaway_operations.confirmed_by_agent_id IS
  'Stable agent identifier (sap_agents.id, format <COMPUTERNAME>-<SESSIONNAME>'
  '-<USERNAME> per v1.6.5 _agent_self_id) for fleet-side filtering of '
  'agent-driven confirmations. NULL for manual user confirms.';

-- Optional helper index for the eventual "show agent-confirmed TOs only"
-- filter the user mentioned in the open-items log. Partial because the
-- column is sparse (most rows will be human confirms with NULL agent id).
CREATE INDEX IF NOT EXISTS idx_rf_putaway_operations_confirmed_by_agent_id
  ON public.rf_putaway_operations (confirmed_by_agent_id)
 WHERE confirmed_by_agent_id IS NOT NULL;
