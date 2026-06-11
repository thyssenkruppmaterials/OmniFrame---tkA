-- Add rf_putaway_operations to the supabase_realtime publication so the
-- Agent Triggers runtime can subscribe to INSERT/UPDATE events on it.
--
-- Without this, the trigger silently never fires because Postgres never
-- emits change events for the table to the Realtime engine.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'rf_putaway_operations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rf_putaway_operations;
  END IF;
END $$;

-- Set REPLICA IDENTITY to FULL so UPDATE events deliver the full
-- previous-row payload too (helps when filtering on what changed).
-- The new row is already full regardless; this only affects `old`.
ALTER TABLE public.rf_putaway_operations REPLICA IDENTITY FULL;
