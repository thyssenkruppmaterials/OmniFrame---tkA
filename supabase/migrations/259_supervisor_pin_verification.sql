-- ============================================================================
-- Migration 259 — Supervisor PIN verification (Phase 7.1; renumbered 257→259).
--
-- Replaces the asterisked-PIN-in-notes anti-pattern from
-- rf-cycle-count-unified.tsx:1346-1350. Stores PIN hashes via pgcrypto bcrypt;
-- exposes verify + complete-with-pin SECURITY DEFINER RPCs; logs failures with
-- rate limiting.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.supervisor_pins (
  user_id uuid PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now(),
  set_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supervisor_pins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supervisor_pins self read"  ON public.supervisor_pins;
DROP POLICY IF EXISTS "supervisor_pins self write" ON public.supervisor_pins;
-- Self-read is allowed but `pin_hash` MUST never go to clients; the column
-- grant below restricts SELECT to set_at/updated_at only via a view if needed.
CREATE POLICY "supervisor_pins self read" ON public.supervisor_pins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "supervisor_pins self write" ON public.supervisor_pins
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.supervisor_pins FROM PUBLIC, anon, authenticated;
GRANT SELECT (user_id, set_at, updated_at) ON public.supervisor_pins TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supervisor_pins TO service_role;

-- Failed-attempt rate limit table.
CREATE TABLE IF NOT EXISTS public.supervisor_pin_failures (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE,
  attempted_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  task_id uuid,
  failed_at timestamptz NOT NULL DEFAULT now(),
  reason text
);

CREATE INDEX IF NOT EXISTS idx_supervisor_pin_failures_recent
  ON public.supervisor_pin_failures (user_id, failed_at DESC);

ALTER TABLE public.supervisor_pin_failures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pin_failures org read" ON public.supervisor_pin_failures;
CREATE POLICY "pin_failures org read" ON public.supervisor_pin_failures
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
         AND public.work_engine_is_manager_or_above_in_org(organization_id));

REVOKE ALL ON public.supervisor_pin_failures FROM PUBLIC, anon;
GRANT SELECT ON public.supervisor_pin_failures TO authenticated;
GRANT SELECT, INSERT ON public.supervisor_pin_failures TO service_role;

-- ---------------------------------------------------------------------------
-- set / verify RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_supervisor_pin(p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;
  IF length(p_pin) < 4 OR length(p_pin) > 16 THEN
    RAISE EXCEPTION 'pin length must be 4-16' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.supervisor_pins (user_id, pin_hash, set_by)
  VALUES (v_uid, crypt(p_pin, gen_salt('bf', 10)), v_uid)
  ON CONFLICT (user_id) DO UPDATE
    SET pin_hash = EXCLUDED.pin_hash,
        updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.verify_supervisor_pin(
  p_user_id uuid,
  p_pin text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_org uuid;
  v_supervisor_org uuid;
  v_hash text;
  v_recent_failures int;
  v_is_supervisor boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  -- Same-org check.
  SELECT organization_id INTO v_caller_org     FROM user_profiles WHERE id = v_caller;
  SELECT organization_id INTO v_supervisor_org FROM user_profiles WHERE id = p_user_id;
  IF v_caller_org IS NULL OR v_supervisor_org IS NULL OR v_caller_org <> v_supervisor_org THEN
    RETURN false;
  END IF;

  -- Supervisor must hold an eligible role.
  SELECT EXISTS (
    SELECT 1 FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE up.id = p_user_id AND r.name IN ('manager','admin','superadmin','logistics_coordinator')
  ) INTO v_is_supervisor;
  IF NOT v_is_supervisor THEN
    RETURN false;
  END IF;

  -- Rate limit: 5 failures in last 5 minutes.
  SELECT count(*) INTO v_recent_failures
    FROM public.supervisor_pin_failures
   WHERE user_id = p_user_id AND failed_at > now() - interval '5 minutes';
  IF v_recent_failures >= 5 THEN
    INSERT INTO public.supervisor_pin_failures (user_id, attempted_by, organization_id, reason)
    VALUES (p_user_id, v_caller, v_caller_org, 'rate_limited');
    RETURN false;
  END IF;

  SELECT pin_hash INTO v_hash FROM public.supervisor_pins WHERE user_id = p_user_id;
  IF v_hash IS NULL THEN
    INSERT INTO public.supervisor_pin_failures (user_id, attempted_by, organization_id, reason)
    VALUES (p_user_id, v_caller, v_caller_org, 'no_pin_set');
    RETURN false;
  END IF;

  IF crypt(p_pin, v_hash) = v_hash THEN
    RETURN true;
  ELSE
    INSERT INTO public.supervisor_pin_failures (user_id, attempted_by, organization_id, reason)
    VALUES (p_user_id, v_caller, v_caller_org, 'wrong_pin');
    RETURN false;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.set_supervisor_pin(text)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_supervisor_pin(uuid, text)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_supervisor_pin(text)         TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.verify_supervisor_pin(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- complete_task_with_supervisor_pin: atomic complete + audit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_task_with_supervisor_pin(
  p_task_id uuid,
  p_supervisor_user_id uuid,
  p_pin text,
  p_result_payload jsonb,
  p_notes text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_org uuid;
  v_ok boolean;
BEGIN
  SELECT organization_id INTO v_org FROM public.work_tasks WHERE id = p_task_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'task not found' USING ERRCODE = '22023';
  END IF;

  v_ok := public.verify_supervisor_pin(p_supervisor_user_id, p_pin);
  IF NOT v_ok THEN
    INSERT INTO public.work_events (organization_id, task_id, event_type, actor_id,
                                     payload)
    VALUES (v_org, p_task_id, 'pin_failed', v_caller,
            jsonb_build_object('supervisor_user_id', p_supervisor_user_id));
    RETURN jsonb_build_object('success', false, 'reason', 'pin_invalid');
  END IF;

  UPDATE public.work_tasks
     SET status = 'completed',
         result_payload = COALESCE(p_result_payload, result_payload),
         completed_at = now(),
         updated_at = now()
   WHERE id = p_task_id;

  INSERT INTO public.work_events (organization_id, task_id, event_type, actor_id, payload)
  VALUES (v_org, p_task_id, 'pin_verified', v_caller,
          jsonb_build_object('supervisor_user_id', p_supervisor_user_id, 'notes', p_notes));
  INSERT INTO public.work_events (organization_id, task_id, event_type, actor_id, payload)
  VALUES (v_org, p_task_id, 'completed', v_caller,
          jsonb_build_object('result_payload', p_result_payload));

  RETURN jsonb_build_object('success', true);
END $$;

REVOKE ALL ON FUNCTION public.complete_task_with_supervisor_pin(uuid, uuid, text, jsonb, text)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.complete_task_with_supervisor_pin(uuid, uuid, text, jsonb, text)
  TO authenticated, service_role;

-- Atomic photo append RPC (Phase 7.2).
CREATE OR REPLACE FUNCTION public.array_append_evidence_photo(
  p_task_id uuid,
  p_url text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_org uuid;
  v_assigned uuid;
  v_created uuid;
BEGIN
  SELECT organization_id, assigned_to, created_by INTO v_org, v_assigned, v_created
    FROM public.rr_cyclecount_data WHERE id = p_task_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'count not found' USING ERRCODE = '22023';
  END IF;
  IF v_caller IS NULL OR (v_caller <> v_assigned AND v_caller <> v_created
       AND NOT public.work_engine_is_manager_or_above_in_org(v_org)) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  UPDATE public.rr_cyclecount_data
     SET evidence_photo_urls = CASE
           WHEN p_url = ANY(COALESCE(evidence_photo_urls, '{}'::text[]))
             THEN evidence_photo_urls
           ELSE array_append(COALESCE(evidence_photo_urls, '{}'::text[]), p_url)
         END,
         updated_at = now()
   WHERE id = p_task_id AND organization_id = v_org;

  RETURN jsonb_build_object('success', true);
END $$;

REVOKE ALL ON FUNCTION public.array_append_evidence_photo(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.array_append_evidence_photo(uuid, text) TO authenticated, service_role;

COMMIT;
