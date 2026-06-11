-- ============================================================================
-- Migration 263 — `record_settings_change_event` audit RPC.
--
-- The Configurability Surface (Phase 0a) writes mutations to
-- `work_engine_settings`, `work_type_settings`, and
-- `work_type_warehouse_overrides`. Plan §0a + the audit story require every
-- mutation to leave a `work_events('settings_changed')` row with a
-- before/after diff so admins can see "who changed what when".
--
-- The frontend service `work-engine-settings.service.ts` documented the
-- contract in its file header but never called the RPC. This migration
-- creates the missing SECURITY DEFINER RPC. The service is patched in the
-- same change-set to invoke it after each `update*` / `upsert*` mutation.
--
-- The RPC is permissive about the table name (free-form text) so future
-- per-org settings tables can use the same audit shim without a follow-on
-- migration. Manager+ role is enforced inside — RLS on `work_events`
-- already restricts SELECT to same-org users.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.record_settings_change_event(
  p_org    uuid,
  p_table  text,
  p_key    text,
  p_before jsonb,
  p_after  jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_event_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'p_org required' USING ERRCODE = '22023';
  END IF;
  IF p_table IS NULL OR length(p_table) = 0 THEN
    RAISE EXCEPTION 'p_table required' USING ERRCODE = '22023';
  END IF;

  -- Require manager+ in the target org. Same predicate the
  -- `work_engine_settings` RLS update policy applies; we re-check here
  -- because this RPC is SECURITY DEFINER and would otherwise bypass RLS.
  IF NOT public.work_engine_is_manager_or_above_in_org(p_org) THEN
    RAISE EXCEPTION 'permission denied: manager+ role required'
      USING ERRCODE = '42501';
  END IF;

  -- task_id is intentionally NULL for settings events — the composite FK
  -- `work_events_task_org_fk(organization_id, task_id)` permits NULL
  -- task_id because the row matching predicate is skipped when any FK
  -- column is NULL (SQL standard MATCH SIMPLE behaviour).
  INSERT INTO public.work_events (
    organization_id, task_id, event_type, actor_id, payload
  ) VALUES (
    p_org,
    NULL,
    'settings_changed',
    v_caller,
    jsonb_build_object(
      'table',  p_table,
      'key',    p_key,
      'before', COALESCE(p_before, 'null'::jsonb),
      'after',  COALESCE(p_after,  'null'::jsonb)
    )
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END $$;

REVOKE ALL ON FUNCTION public.record_settings_change_event(uuid, text, text, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_settings_change_event(uuid, text, text, jsonb, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.record_settings_change_event(uuid, text, text, jsonb, jsonb) IS
  'Phase 0a audit shim. Records a `settings_changed` work_event with a before/after diff. Caller (frontend service) supplies p_table (e.g. "work_engine_settings"), p_key (the row key), and the jsonb payloads. Enforces manager+ role same-org. Returns the new work_events.id.';

COMMIT;
