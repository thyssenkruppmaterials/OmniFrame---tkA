-- Migration: Fix RLS policies for TimeClock kiosk (anon role)
-- Date: February 26, 2026
-- Purpose: The kiosk PWA runs unauthenticated (anon role). Several policies
--          were preventing clock-in/out and time-adjustment requests from
--          succeeding.

-- ============================================================================
-- FIX 1: time_clock_entries — anon UPDATE for clock-out
-- ============================================================================
-- The existing policy "Anon can update time clock entries for clock out" has
-- USING (status = 'active') but NO explicit WITH CHECK. PostgreSQL defaults
-- WITH CHECK to the USING expression, so the NEW row must also satisfy
-- status = 'active'. Clock-out sets status = 'completed', which fails.
-- Solution: recreate the policy with an explicit WITH CHECK (true).

DROP POLICY IF EXISTS "Anon can update time clock entries for clock out"
  ON time_clock_entries;

CREATE POLICY "Anon can update time clock entries for clock out"
  ON time_clock_entries
  FOR UPDATE
  TO anon
  USING (status = 'active'::clock_entry_status)
  WITH CHECK (true);

-- ============================================================================
-- FIX 2: time_adjustment_requests — anon SELECT for RETURNING clause
-- ============================================================================
-- The kiosk inserts a time_adjustment_request with .insert().select().single()
-- which generates INSERT ... RETURNING *. The RETURNING clause requires
-- SELECT permission, but no anon SELECT policy existed.

CREATE POLICY "anon_select_own_time_adjustment_requests"
  ON time_adjustment_requests
  FOR SELECT
  TO anon
  USING (true);

-- ============================================================================
-- FIX 3: working_areas — anon SELECT for department picker
-- ============================================================================
-- The time-adjustment wizard loads working_areas to let the kiosk user pick
-- their department. Existing policies only target public/authenticated roles
-- with org-scoped checks that return null for anon.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'working_areas'
      AND policyname = 'Anon can read working areas for kiosk'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Anon can read working areas for kiosk"
        ON working_areas
        FOR SELECT
        TO anon
        USING (is_active = true)
    $policy$;
  END IF;
END $$;

-- ============================================================================
-- Log
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Fixed kiosk RLS policies:';
  RAISE NOTICE '  - time_clock_entries: anon UPDATE now has WITH CHECK (true)';
  RAISE NOTICE '  - time_adjustment_requests: added anon SELECT policy';
  RAISE NOTICE '  - working_areas: added anon SELECT policy (active only)';
END $$;
