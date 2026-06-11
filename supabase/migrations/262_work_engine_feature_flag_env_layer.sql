-- ============================================================================
-- Migration 262 — Env override layer for `work_engine_feature_flag`
--
-- Plan §0a.3 evaluation order is:
--   1. env override (highest precedence — operator emergency switch)
--   2. per-org `work_engine_settings.feature_flags` row
--   3. hardcoded default
--
-- Migration 256 only implemented (2) + (3). This migration extends the
-- helper with (1), reading a session GUC `work_engine.flag_overrides` that
-- the Rust work-service is responsible for setting on each pool connection
-- acquisition. The GUC value is a JSON object mapping flag name → boolean,
-- e.g. `{"work_tasks_shadow_write": false, "work_engine_enabled": true}`.
-- A NULL or `null` value for a key means "no override; fall through".
--
-- Operator follow-up (NOT implemented in this migration):
--   - Rust side reads `WORK_ENGINE_FLAG_OVERRIDES` env var (JSON) at boot.
--   - On every pool connection acquisition, run
--     `SELECT set_config('work_engine.flag_overrides', $1, false)` with the
--     JSON payload.
--   - Bare `psql` sessions can opt in by running the same `set_config(...)`
--     before invoking work-engine RPCs. Without it the GUC is empty and
--     evaluation falls through to the per-org/default layers (back-compat).
--
-- This migration is idempotent (`CREATE OR REPLACE FUNCTION`) and adds no
-- new tables, RLS, or grants — the function inherits the GRANTs migration
-- 256 already issued for `work_engine_feature_flag(uuid, text)`.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.work_engine_feature_flag(p_org uuid, p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_overrides_raw text;
  v_overrides jsonb;
  v_env_value jsonb;
BEGIN
  -- Layer 1: env override via session GUC. `current_setting(..., true)`
  -- returns NULL (not error) when the GUC is unset.
  v_overrides_raw := current_setting('work_engine.flag_overrides', true);
  IF v_overrides_raw IS NOT NULL AND length(v_overrides_raw) > 0 THEN
    BEGIN
      v_overrides := v_overrides_raw::jsonb;
    EXCEPTION WHEN others THEN
      -- Malformed JSON → ignore, fall through to per-org/default. We never
      -- raise here so a bad operator override can never wedge the engine.
      v_overrides := NULL;
    END;

    IF v_overrides IS NOT NULL THEN
      v_env_value := v_overrides -> p_key;
      IF v_env_value IS NOT NULL AND v_env_value <> 'null'::jsonb THEN
        RETURN (v_env_value)::boolean;
      END IF;
    END IF;
  END IF;

  -- Layer 2 + 3: per-org row, then hardcoded default. Identical semantics
  -- to migration 256 — preserved verbatim so behaviour is unchanged when
  -- no env override is in effect.
  RETURN COALESCE(
    (SELECT (feature_flags ->> p_key)::boolean
       FROM public.work_engine_settings
      WHERE organization_id = p_org),
    CASE p_key
      WHEN 'work_engine_enabled'           THEN false
      WHEN 'work_tasks_shadow_write'       THEN false
      WHEN 'work_tasks_read_shadow'        THEN false
      WHEN 'work_tasks_read_primary'       THEN false
      WHEN 'work_tasks_rollback_to_legacy' THEN false
      WHEN 'push_preflight_zone_check'     THEN true
      WHEN 'worker_capability_required'    THEN false
      WHEN 'signed_url_photos'             THEN false
      ELSE false
    END
  );
END $$;

-- Re-affirm grants (idempotent — REVOKE/GRANT pair so accidental looser
-- grants don't survive a re-deploy of the helper).
REVOKE ALL ON FUNCTION public.work_engine_feature_flag(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.work_engine_feature_flag(uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.work_engine_feature_flag(uuid, text) IS
  'Plan §0a.3 evaluation: env GUC `work_engine.flag_overrides` (JSON) > per-org settings row > hardcoded default. The Rust service sets the GUC per-connection from `WORK_ENGINE_FLAG_OVERRIDES` env. Malformed GUC payloads are ignored.';

COMMIT;
