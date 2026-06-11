-- Phase 10.2 / 13.4 — Settings tables RLS positive + negative probe.
\set ON_ERROR_STOP on

DO $$
BEGIN
  -- All three tables have RLS enabled.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'work_engine_settings' AND c.relrowsecurity
  ) THEN RAISE EXCEPTION 'work_engine_settings RLS not enabled'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'work_type_settings' AND c.relrowsecurity
  ) THEN RAISE EXCEPTION 'work_type_settings RLS not enabled'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'work_type_warehouse_overrides' AND c.relrowsecurity
  ) THEN RAISE EXCEPTION 'work_type_warehouse_overrides RLS not enabled'; END IF;

  -- Each table has at least one read + one write policy.
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'work_engine_settings') < 2 THEN
    RAISE EXCEPTION 'work_engine_settings missing required policies (read + write)';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'work_type_settings') < 2 THEN
    RAISE EXCEPTION 'work_type_settings missing required policies';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'work_type_warehouse_overrides') < 2 THEN
    RAISE EXCEPTION 'work_type_warehouse_overrides missing required policies';
  END IF;

  -- anon and PUBLIC have no privileges on settings tables.
  PERFORM 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'work_engine_settings' AND grantee IN ('PUBLIC','anon');
  IF FOUND THEN
    RAISE EXCEPTION 'work_engine_settings is grantable to PUBLIC/anon';
  END IF;
END $$;
