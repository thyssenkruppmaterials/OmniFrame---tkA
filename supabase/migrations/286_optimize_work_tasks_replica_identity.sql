-- Phase 11+ cleanup item 1 (post-audit 2026-05-07): work_tasks was REPLICA
-- IDENTITY FULL pre-cutover. The grandfathered FE subscriptions
-- (use-work-engine-live.ts, use-work-operations.ts) consume change events
-- as cache-invalidation triggers and don't need OLD-row payloads.
-- rust-work-service consumes via NOTIFY+SELECT, not WAL. Flip back to
-- DEFAULT to halve WAL bandwidth on this hot table.
ALTER TABLE public.work_tasks REPLICA IDENTITY DEFAULT;

DO $$
DECLARE
  rel_replident "char";
BEGIN
  SELECT relreplident INTO rel_replident
  FROM pg_class WHERE oid = 'public.work_tasks'::regclass;
  IF rel_replident <> 'd' THEN
    RAISE EXCEPTION 'REPLICA IDENTITY did not flip to DEFAULT (got %)', rel_replident;
  END IF;
END $$;

COMMENT ON TABLE public.work_tasks IS
  'Work tasks queue. REPLICA IDENTITY DEFAULT (post-audit 2026-05-07) -- '
  'grandfathered FE Realtime subscriptions use change events as cache-invalidation '
  'triggers; rust-work-service consumes via NOTIFY+SELECT (not WAL).';
