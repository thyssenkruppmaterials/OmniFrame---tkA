-- ============================================================================
-- Migration 323: Fix Cycle-Count Location Resolution Trigger
-- ----------------------------------------------------------------------------
-- The BEFORE INSERT/UPDATE trigger `auto_resolve_cycle_count_location` (added
-- in migration 204) used the wrong "did the SELECT find a row?" check.
--
--     SELECT * INTO v_result FROM resolve_cycle_count_location(...);
--     IF v_result IS NOT NULL THEN  <-- BUG
--
-- In PL/pgSQL `<record> IS NOT NULL` returns TRUE only when *every* column of
-- the composite is non-NULL. `resolve_cycle_count_location` legitimately
-- returns `mapping_id = NULL` whenever a row resolves through a regex rule
-- (no `warehouse_location_mappings` hit). That single NULL flipped the
-- composite test to FALSE, so the trigger fell into the ELSE branch and
-- stamped `resolved_zone = 'unresolved'` on every rule-resolved cycle count
-- for ~weeks.
--
-- Live impact (2026-05-20): 17,202 of 18,112 rows in `rr_cyclecount_data`
-- (95%) had `resolution_source = 'unresolved'`, including 8,586 pending
-- rows. That silently disabled `serpentine_zone` ordering on the
-- pull-claim queue because the path engine orders by
-- `resolved_zone`/`resolved_aisle`/`resolved_sequence`. Workers were
-- getting counts in insertion-order fallback; veterans paper over it by
-- walking the floor in serpentine by habit, new counters look chaotic.
--
-- This migration:
--   1. Replaces the trigger function so the IF FOUND idiom is used.
--   2. Backfills every poisoned row by recomputing the resolved_* columns
--      from `resolve_cycle_count_location()` directly. Only the resolved_*
--      columns are touched, so the BEFORE UPDATE OF (location, warehouse)
--      trigger does NOT refire on the backfill. `app.skip_sync` is set to
--      'true' so `sync_cycle_count_to_work_task` short-circuits (the
--      resolved_* columns aren't propagated to `work_tasks` anyway), and
--      `app.cycle_count_zone_lock_bypass` is set to 'on' so the
--      zone-exclusivity trigger doesn't re-validate assignments for what
--      is purely a metadata catch-up.
--
-- Diagnosis trace:
--   - Direct `SELECT * FROM resolve_cycle_count_location(...)` returns
--     `zone='Racks', aisle='RM', source='rule', mapping_id=NULL` -- correct.
--   - Same call inside the trigger: `FOUND=true`, every column readable,
--     but `v_result IS NOT NULL` evaluates to `FALSE` because mapping_id
--     was NULL (composite-NULL semantics).
--   - Patched function tested in BEGIN/ROLLBACK with four sample
--     locations (RM-69-B-02, RO-65-D-01, RJ-78-C-01, NONSENSE-LOC).
--     First three resolved to `zone=Racks` with the right aisle and
--     sequence; the unmatched one fell through to `unresolved` correctly.
--
-- See Debug/Investigate-Cycle-Count-Paths-2026-05-20.md and
--     Debug/Fix-Cycle-Count-Resolve-FOUND-Check-2026-05-20.md.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Part 1 -- fix the trigger function.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auto_resolve_cycle_count_location()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_result RECORD;
BEGIN
  SELECT * INTO v_result
  FROM public.resolve_cycle_count_location(NEW.organization_id, NEW.warehouse, NEW.location)
  LIMIT 1;

  -- IF FOUND is the canonical "previous SELECT INTO returned a row" test.
  -- The previous IF v_result IS NOT NULL check broke for rule-resolved rows
  -- because mapping_id is legitimately NULL for those, which flipped the
  -- composite-NULL test to FALSE and dropped the row into the unresolved
  -- fallback. See migration header for full root-cause analysis.
  IF FOUND THEN
    NEW.resolved_location_key         := v_result.resolved_key;
    NEW.resolved_zone                 := v_result.resolved_zone;
    NEW.resolved_aisle                := v_result.resolved_aisle;
    NEW.resolved_sequence             := v_result.resolved_seq;
    NEW.resolution_source             := v_result.source;
    NEW.warehouse_location_mapping_id := v_result.mapping_id;
  ELSE
    NEW.resolved_location_key         := TRIM(NEW.location);
    NEW.resolved_zone                 := 'unresolved';
    NEW.resolved_aisle                := 'unresolved';
    NEW.resolved_sequence             := 0;
    NEW.resolution_source             := 'unresolved';
    NEW.warehouse_location_mapping_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- Part 2 -- backfill rows poisoned by the original bug.
--
-- Only the resolved_* columns are updated. Because the BEFORE trigger is
-- scoped to `OF location, warehouse`, it does not re-fire and we don't
-- recompute anything unnecessarily.
--
-- skip_sync = 'true'                       -> sync_cycle_count_to_work_task
--                                            short-circuits (resolved_* are
--                                            not part of the work_tasks
--                                            projection anyway).
-- cycle_count_zone_lock_bypass = 'on'      -> zone-exclusivity trigger
--                                            doesn't re-validate; the
--                                            backfill never changes
--                                            assigned_to / status.
-- ----------------------------------------------------------------------------

DO $backfill$
DECLARE
  v_count BIGINT;
BEGIN
  PERFORM set_config('app.skip_sync', 'true', true);
  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);

  WITH targets AS (
    SELECT id, organization_id, warehouse, location
    FROM public.rr_cyclecount_data
    WHERE resolution_source = 'unresolved'
      AND location IS NOT NULL
      AND location <> ''
  ),
  resolved AS (
    SELECT t.id, r.resolved_key, r.resolved_zone, r.resolved_aisle,
           r.resolved_seq, r.source, r.mapping_id
    FROM targets t,
         LATERAL public.resolve_cycle_count_location(t.organization_id,
                                                     t.warehouse,
                                                     t.location) r
  )
  UPDATE public.rr_cyclecount_data row
  SET resolved_location_key         = res.resolved_key,
      resolved_zone                 = res.resolved_zone,
      resolved_aisle                = res.resolved_aisle,
      resolved_sequence             = res.resolved_seq,
      resolution_source             = res.source,
      warehouse_location_mapping_id = res.mapping_id
  FROM resolved res
  WHERE row.id = res.id
    AND (
      row.resolved_zone     IS DISTINCT FROM res.resolved_zone OR
      row.resolved_aisle    IS DISTINCT FROM res.resolved_aisle OR
      row.resolved_sequence IS DISTINCT FROM res.resolved_seq OR
      row.resolution_source IS DISTINCT FROM res.source
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Backfilled % rr_cyclecount_data rows', v_count;
END
$backfill$;

COMMIT;
