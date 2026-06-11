-- ============================================================================
-- Migration 264 — close the advisor findings introduced by 256.
--
-- Three security advisor findings to clean up:
--
-- (a) priority_text_to_int / priority_int_to_text — pure SQL IMMUTABLE
--     helpers should declare an empty search_path per Supabase advisor
--     `function_search_path_mutable`. Their bodies don't reference any
--     unqualified relations, so locking down search_path is risk-free
--     and matches the baseline expected by the advisor.
--
-- (b) worker_capabilities — was created as a default (security_definer)
--     view in mig 256. Should be `security_invoker = true` so RLS on the
--     underlying tables (worker_profiles, user_profiles) is enforced
--     from the caller's perspective, not the view owner's. Plan §10.5
--     anticipated this finding.
--
-- Apply order matters only minimally — the ALTER FUNCTION / CREATE OR
-- REPLACE VIEW are independent. Wrapped in a single transaction so the
-- migration is atomic.
-- ============================================================================

BEGIN;

ALTER FUNCTION public.priority_text_to_int(text) SET search_path = '';
ALTER FUNCTION public.priority_int_to_text(int)  SET search_path = '';

CREATE OR REPLACE VIEW public.worker_capabilities
WITH (security_invoker = true) AS
SELECT
  up.organization_id,
  up.id AS user_id,
  COALESCE(
    (SELECT array_agg(DISTINCT lower(t::text))
       FROM jsonb_array_elements_text(
         COALESCE(wp.preferred_task_types, '[]'::jsonb)
       ) AS t),
    ARRAY[]::text[]
  ) AS work_types,
  COALESCE(
    (SELECT array_agg(DISTINCT lower(t::text))
       FROM jsonb_array_elements_text(
         COALESCE(wp.blocked_task_types, '[]'::jsonb)
       ) AS t),
    ARRAY[]::text[]
  ) AS blocked_work_types,
  COALESCE(
    (SELECT array_agg(DISTINCT z::text)
       FROM jsonb_array_elements_text(
         COALESCE(wp.preferred_zones, '[]'::jsonb)
       ) AS z),
    ARRAY[]::text[]
  ) AS zones
FROM public.user_profiles up
LEFT JOIN public.worker_profiles wp ON wp.user_id = up.id;

COMMIT;
