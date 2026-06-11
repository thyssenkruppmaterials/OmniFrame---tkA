-- Migration: Add anon RLS policies for overtime kiosk
-- Date: February 26, 2026
-- Purpose: The kiosk PWA runs unauthenticated (anon role). The existing
--          overtime_requests and overtime_signups policies all use auth.uid()
--          scoping, which returns null for anon — so the kiosk sees zero
--          positions and can't create signups.

-- ============================================================================
-- FIX 1: overtime_requests — anon can browse approved positions
-- ============================================================================
CREATE POLICY "Anon can read approved overtime for kiosk"
  ON overtime_requests
  FOR SELECT
  TO anon
  USING (status = 'approved');

-- ============================================================================
-- FIX 2: overtime_signups — anon can create signups from kiosk
-- ============================================================================
CREATE POLICY "Anon can create overtime signups from kiosk"
  ON overtime_signups
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Anon needs SELECT for the RETURNING clause after INSERT
CREATE POLICY "Anon can read overtime signups from kiosk"
  ON overtime_signups
  FOR SELECT
  TO anon
  USING (true);

-- ============================================================================
-- Log
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Added kiosk overtime RLS policies:';
  RAISE NOTICE '  - overtime_requests: anon SELECT (approved only)';
  RAISE NOTICE '  - overtime_signups: anon INSERT + SELECT';
END $$;
