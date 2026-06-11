-- Migration 269 — Cycle-count defer history view
-- =============================================================================
-- Purpose
-- -----------------------------------------------------------------------------
--   Surface "who deferred / skipped a cycle count, when, and why" on the
--   Inventory Counts dashboard. The underlying per-operator state is already
--   tracked in `cycle_count_operator_deferred_counts` (current + historical
--   via `is_active` flips with `cleared_at` on inactive rows). This migration
--   exposes that table joined with user identity + count number through a
--   read-only view so the frontend can render audit-quality lists without
--   committing to row-cached columns on `rr_cyclecount_data`.
--
-- Decision
-- -----------------------------------------------------------------------------
--   Option A (view-based) is chosen over Option B (cache columns on the
--   parent row + trigger). Justification:
--     - The defer table is already the source of truth for per-operator
--       skip state; duplicating "last_deferred_by" on the parent row would
--       introduce a write-amplification path through a trigger and a second
--       place that can drift.
--     - The dashboard reads defer history lazily (popover / modal / filter
--       opt-in) so the perf tradeoff is favourable to the view.
--     - RLS / org-scope is already enforced on the underlying table via the
--       "Users can view deferred counts in their org" policy. With
--       `security_invoker = true` on the view, the same policy applies
--       transitively without restating it.
--
-- Surface
-- -----------------------------------------------------------------------------
--   v_cycle_count_defer_history exposes one row per defer event (active or
--   cleared) with:
--     - id, count_id, count_number, organization_id
--     - user_id, user_full_name, user_email, user_username
--     - defer_reason, deferred_at, cleared_at, reactivated_at, is_active
--     - resume_priority, times_deferred, created_at, updated_at
--
-- Backwards-compat
-- -----------------------------------------------------------------------------
--   Pure CREATE VIEW + CREATE INDEX IF NOT EXISTS. No DROP, no destructive
--   DML, no schema changes to existing tables. Reversible via DROP VIEW.
-- =============================================================================

-- 1. View ---------------------------------------------------------------------

CREATE OR REPLACE VIEW v_cycle_count_defer_history
WITH (security_invoker = true)
AS
SELECT
    d.id,
    d.organization_id,
    d.count_id,
    cc.count_number,
    d.user_id,
    up.full_name      AS user_full_name,
    up.email          AS user_email,
    up.username       AS user_username,
    d.defer_reason,
    d.deferred_at,
    d.cleared_at,
    d.reactivated_at,
    d.is_active,
    d.resume_priority,
    d.times_deferred,
    d.created_at,
    d.updated_at
FROM cycle_count_operator_deferred_counts d
LEFT JOIN rr_cyclecount_data cc ON cc.id = d.count_id
LEFT JOIN user_profiles      up ON up.id = d.user_id;

COMMENT ON VIEW v_cycle_count_defer_history IS
  'Per-operator defer history (active + cleared) joined with user identity '
  'and count number. RLS inherits from cycle_count_operator_deferred_counts '
  'via security_invoker. See migration 269.';

GRANT SELECT ON v_cycle_count_defer_history TO authenticated;

-- 2. Indexes ------------------------------------------------------------------
-- Existing partial indexes only cover `is_active = true`; defer-history
-- queries (which include CLEARED defers) need non-partial coverage.

CREATE INDEX IF NOT EXISTS idx_deferred_counts_count_deferred_at_desc
    ON public.cycle_count_operator_deferred_counts (count_id, deferred_at DESC);

CREATE INDEX IF NOT EXISTS idx_deferred_counts_user_deferred_at_desc
    ON public.cycle_count_operator_deferred_counts (user_id, deferred_at DESC);

CREATE INDEX IF NOT EXISTS idx_deferred_counts_org_deferred_at_desc
    ON public.cycle_count_operator_deferred_counts (organization_id, deferred_at DESC);

-- 3. Smoke test (transactional, ROLLED BACK) ---------------------------------
-- Asserts the view joins cleanly and surfaces both active + cleared rows.

DO $$
DECLARE
    v_org_id   uuid;
    v_user_id  uuid;
    v_count_id uuid;
    v_defer_id uuid;
    v_rows     int;
BEGIN
    -- Pick an existing (org, user, count) tuple from production data.
    SELECT cc.organization_id, up.id, cc.id
      INTO v_org_id, v_user_id, v_count_id
      FROM rr_cyclecount_data cc
      JOIN user_profiles up ON up.organization_id = cc.organization_id
     WHERE cc.organization_id IS NOT NULL
     LIMIT 1;

    IF v_org_id IS NULL THEN
        RAISE NOTICE '[269 smoke] No (org, user, count) tuple available — skipping smoke test.';
        RETURN;
    END IF;

    -- Insert a synthetic CLEARED defer row so the view returns it.
    INSERT INTO cycle_count_operator_deferred_counts
        (organization_id, count_id, user_id, defer_reason, deferred_at,
         cleared_at, is_active, resume_priority, times_deferred)
    VALUES
        (v_org_id, v_count_id, v_user_id,
         '__migration_269_smoke__',
         NOW() - INTERVAL '5 minutes',
         NOW(),
         FALSE, 0, 1)
    RETURNING id INTO v_defer_id;

    -- Verify the view exposes the row with the joined fields populated.
    SELECT COUNT(*) INTO v_rows
      FROM v_cycle_count_defer_history h
     WHERE h.id = v_defer_id
       AND h.user_full_name IS NOT NULL
       AND h.count_number   IS NOT NULL
       AND h.is_active = FALSE
       AND h.cleared_at IS NOT NULL;

    IF v_rows <> 1 THEN
        RAISE EXCEPTION
          '[269 smoke] expected 1 joined row from v_cycle_count_defer_history, got %', v_rows;
    END IF;

    RAISE NOTICE '[269 smoke] OK — view returned the synthetic cleared defer with joined user + count_number.';

    -- Always ROLL BACK the synthetic row.
    DELETE FROM cycle_count_operator_deferred_counts WHERE id = v_defer_id;
END$$;
