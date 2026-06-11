-- ============================================================================
-- Migration 261 — Work Engine observability surface
-- (Phase 12.2 of Work Engine Foundation; renumbered from plan's 259).
--
-- Provides:
--   * work_engine_health view — open count + age-of-oldest per (org, type, prio, status)
--   * work_engine_drift view — shadow-mode drift count per (org, task_type)
--   * work_engine_dispatch_fairness view — claims per (task_type, priority) over 60-min window
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- work_engine_health
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.work_engine_health
WITH (security_invoker = true)
AS
SELECT
  organization_id,
  task_type,
  priority,
  status,
  count(*) AS open_count,
  COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at))), 0)::int AS oldest_pending_age_s,
  -- FILTER must attach to the aggregate (`min`), NOT to the surrounding
  -- EXTRACT scalar — that's a SQL standard rule (Postgres 42601 otherwise).
  COALESCE(EXTRACT(EPOCH FROM (now() - min(reservation_started_at)
                                FILTER (WHERE reservation_started_at IS NOT NULL))), 0)::int AS oldest_reservation_age_s,
  COALESCE(EXTRACT(EPOCH FROM (now() - min(started_at)
                                FILTER (WHERE started_at IS NOT NULL))), 0)::int AS oldest_in_progress_age_s
FROM public.work_tasks
WHERE status NOT IN ('completed','cancelled')
  AND deleted_at IS NULL
GROUP BY organization_id, task_type, priority, status;

REVOKE ALL ON public.work_engine_health FROM PUBLIC, anon;
GRANT SELECT ON public.work_engine_health TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- work_engine_drift — counts rows where legacy and shadow disagree on
-- (status, assigned_to, priority). Only meaningful while shadow mode is on.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.work_engine_drift
WITH (security_invoker = true)
AS
SELECT
  rcc.organization_id,
  'cycle_count'::text AS task_type,
  count(*) FILTER (WHERE wt.status IS NULL) AS missing_in_shadow,
  count(*) FILTER (WHERE wt.status IS NOT NULL AND wt.assigned_to IS DISTINCT FROM rcc.assigned_to) AS assignee_drift,
  -- rr_cyclecount_data.priority is the legacy `cycle_count_priority` enum;
  -- work_tasks.priority is text. PostgreSQL has no implicit enum<->text cast,
  -- so we coerce on the legacy side to keep the comparison portable across
  -- environments (some converted status to text via mig 20260419154950, some
  -- may still have the enum). Same defensive cast on rcc.status below.
  count(*) FILTER (WHERE wt.status IS NOT NULL AND wt.priority    IS DISTINCT FROM rcc.priority::text) AS priority_drift,
  count(*) FILTER (WHERE wt.status IS NOT NULL
                         AND CASE wt.status
                               WHEN 'paused'    THEN 'awaiting_supervisor_signoff'
                               WHEN 'completed' THEN COALESCE(wt.legacy_status, 'completed')
                               WHEN 'in_progress' THEN COALESCE(wt.legacy_status, 'in_progress')
                               ELSE wt.status
                             END IS DISTINCT FROM rcc.status::text) AS status_drift,
  max(now()) AS calculated_at
FROM public.rr_cyclecount_data rcc
LEFT JOIN public.work_tasks wt
  ON wt.organization_id = rcc.organization_id
 AND wt.task_type = 'cycle_count'
 AND wt.source_id = rcc.id
GROUP BY rcc.organization_id;

REVOKE ALL ON public.work_engine_drift FROM PUBLIC, anon;
GRANT SELECT ON public.work_engine_drift TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- work_engine_dispatch_fairness — claims per (task_type, priority) in last 60 min
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.work_engine_dispatch_fairness
WITH (security_invoker = true)
AS
SELECT
  organization_id,
  (payload ->> 'task_type') AS task_type,
  (payload ->> 'priority')  AS priority,
  count(*)                  AS claims_60m
FROM public.work_events
WHERE event_type = 'claimed'
  AND at > now() - interval '60 minutes'
GROUP BY organization_id, payload ->> 'task_type', payload ->> 'priority';

REVOKE ALL ON public.work_engine_dispatch_fairness FROM PUBLIC, anon;
GRANT SELECT ON public.work_engine_dispatch_fairness TO authenticated, service_role;

COMMIT;
