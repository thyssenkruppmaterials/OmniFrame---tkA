-- Migration: Allow authenticated users to INSERT time adjustment requests
-- Date: March 4, 2026
-- Purpose: The kiosk uses the main Supabase client which inherits the current
--          auth session. When a user is logged into the main app and navigates
--          to /timeclockapp/, requests are made as 'authenticated' — not 'anon'.
--          Without this policy those inserts return 403.

CREATE POLICY "authenticated_insert_time_adjustment_requests"
  ON time_adjustment_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DO $$
BEGIN
  RAISE NOTICE 'Added authenticated INSERT policy for time_adjustment_requests';
END $$;
