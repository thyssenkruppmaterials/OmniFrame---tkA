-- Phase 11+ cleanup item 2 (post-audit 2026-05-07): retired control-plane
-- tables remained in supabase_realtime publication after Phase 4/5/11
-- migrated their FE consumers to rust-work-service WS. Decoding logical
-- replication for these tables consumed CPU for nobody. Drop them from
-- the publication; rust-work-service NOTIFY/LISTEN path is unaffected
-- (NOTIFY is independent of logical replication).
--
-- Re-verified 2026-05-07 by grepping src/ for postgres_changes
-- subscribers per candidate:
--   sap_agent_jobs            -> retired (use-job-queue.ts uses Rust WS).
--   sap_agents                -> retired (use-agent-detection.ts uses Rust WS).
--   sap_outbound_to_import_runs -> retired (import-lt22-dialog.tsx uses Rust WS).
--   rf_putaway_operations     -> KEEP (use-putaway-operations.ts:149 still subscribes).
--
-- ALTER PUBLICATION ... DROP TABLE does not accept IF EXISTS on the table list,
-- so wrap each drop in a presence check to keep the migration idempotent.
DO $$
DECLARE
  candidate TEXT;
BEGIN
  FOREACH candidate IN ARRAY ARRAY['sap_agent_jobs','sap_agents','sap_outbound_to_import_runs']
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = candidate
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', candidate);
    END IF;
  END LOOP;
END $$;
-- NOTE: rf_putaway_operations stays -- operator log UI (use-putaway-operations.ts:149)
-- still subscribes via Realtime for cache-invalidation. Remove only when that
-- channel migrates to a rust-work-service WsEvent.

DO $$
DECLARE missing TEXT[];
BEGIN
  SELECT array_agg(t::text) INTO missing
  FROM unnest(ARRAY['sap_agent_jobs','sap_agents','sap_outbound_to_import_runs']::text[]) AS t
  WHERE EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Tables still in supabase_realtime publication: %', missing;
  END IF;
END $$;
