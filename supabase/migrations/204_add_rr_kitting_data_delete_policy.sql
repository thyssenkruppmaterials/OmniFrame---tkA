-- Migration: Add DELETE RLS policy for RR_Kitting_DATA
-- Date: March 16, 2026
-- Description: The table had SELECT, INSERT, and UPDATE policies but was missing
--              a DELETE policy, causing all client-side deletes to be silently blocked.

DO $$ BEGIN
    CREATE POLICY "Allow authenticated users to delete RR_Kitting_DATA"
        ON "public"."RR_Kitting_DATA"
        FOR DELETE
        USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
