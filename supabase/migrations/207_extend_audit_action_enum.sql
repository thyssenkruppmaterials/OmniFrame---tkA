-- ============================================================================
-- Migration 207: Extend audit_action enum with missing values
-- Date: 2026-03-30
-- Description: The audit_action enum was created with only 6 values:
--   create, update, delete, view, login, logout
-- But multiple triggers across the codebase cast additional values to this
-- enum (complete, assign, cleanup). This causes runtime errors such as:
--   "invalid input value for enum audit_action: 'complete'"
-- which surfaces when the complete_putaway_and_clear_cart RPC fires the
-- audit_inbound_cart_assignments trigger on cart assignment clearing.
--
-- Affected triggers / migrations:
--   - 184: audit_inbound_cart_assignments  → 'complete'::audit_action
--   - 040: cycle_count audit trigger       → 'complete'::audit_action
--   - 036/037/090: cycle_count triggers    → 'assign'::audit_action
--   - 037: abandonment cleanup             → 'cleanup'::audit_action
-- ============================================================================

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'complete';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'assign';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'cleanup';
