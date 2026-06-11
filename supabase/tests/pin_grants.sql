-- Phase 10.3 — verify_supervisor_pin GRANT audit (mig 259).
-- Plan §10.3 — same mistake mig 253 caught on assign_next_cycle_count.
\set ON_ERROR_STOP on

DO $$
DECLARE
  has_anon boolean;
  has_public boolean;
  has_authenticated boolean;
  has_search_path boolean;
BEGIN
  -- No anon / PUBLIC EXECUTE.
  SELECT EXISTS(
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema='public' AND routine_name='verify_supervisor_pin'
      AND grantee='anon'
  ) INTO has_anon;
  IF has_anon THEN RAISE EXCEPTION 'verify_supervisor_pin granted to anon'; END IF;

  SELECT EXISTS(
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema='public' AND routine_name='verify_supervisor_pin'
      AND grantee='PUBLIC'
  ) INTO has_public;
  IF has_public THEN RAISE EXCEPTION 'verify_supervisor_pin granted to PUBLIC'; END IF;

  -- authenticated has EXECUTE.
  SELECT EXISTS(
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema='public' AND routine_name='verify_supervisor_pin'
      AND grantee='authenticated' AND privilege_type='EXECUTE'
  ) INTO has_authenticated;
  IF NOT has_authenticated THEN RAISE EXCEPTION 'verify_supervisor_pin not EXECUTABLE by authenticated'; END IF;

  -- SECURITY DEFINER has explicit search_path = public, pg_temp.
  SELECT EXISTS(
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='verify_supervisor_pin'
       AND 'search_path=public, pg_temp' = ANY(p.proconfig)
  ) INTO has_search_path;
  IF NOT has_search_path THEN
    RAISE EXCEPTION 'verify_supervisor_pin missing SET search_path = public, pg_temp';
  END IF;
END $$;
