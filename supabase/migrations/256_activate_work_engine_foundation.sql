-- ============================================================================
-- Migration 256 — Activate Work Engine Foundation
--
-- This is the canonical "everything you need before the engine is alive"
-- migration. It bundles Phase 0a (settings), Phase 0b (Operation Control tab
-- seed + reassign_work_zone RPC), Phase 1.1/1.4a/1.4b/1.5/1.6 from the plan
-- (work_tasks + work_events + task_artifacts + advisory-locked zone exclusivity
-- + reservation maintenance + idempotency + audit taxonomy).
--
-- The plan originally called this 254_activate_work_engine_foundation.sql; the
-- file was renumbered to 256 because the unrelated agent + DB load reduction
-- effort had already taken 254/255. See docs/work-engine/README.md for the
-- mapping table.
--
-- This migration is idempotent (every CREATE has IF NOT EXISTS where possible
-- and every ALTER guarded by information_schema or pg_catalog probes). It
-- coexists with the legacy `rr_cyclecount_data` engine — no behavior changes
-- until per-org `work_engine_settings.feature_flags->>'work_tasks_shadow_write'`
-- is flipped to true.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Helper — manager+ role check used by settings-table RLS and RPCs.
--    Mirrors the pattern in migrations 198 / 027 (JOIN roles ON role_id).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.work_engine_is_manager_or_above_in_org(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE up.id = auth.uid()
      AND up.organization_id = p_org
      AND r.name IN ('manager', 'admin', 'superadmin', 'logistics_coordinator')
  );
$$;

REVOKE ALL ON FUNCTION public.work_engine_is_manager_or_above_in_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_engine_is_manager_or_above_in_org(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. task_types compatibility — add `slug` (lowercase WorkTypeId) and the
--    composite uniqueness needed by `work_tasks(organization_id, task_type)`.
--    Plan §1.1 mapping: CYCLE_COUNT->cycle_count, PUTAWAY->putaway,
--    PICKING->pick (not 'picking'); fall back to lower(type_code) otherwise.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'task_types'
  ) THEN
    -- Migration 039 declared task_types but on some envs it may have been
    -- archived. Create a minimal-compatible shape so this migration is
    -- self-sufficient.
    CREATE TABLE public.task_types (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      type_code text NOT NULL,
      display_name text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id, type_code)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_types' AND column_name = 'slug'
  ) THEN
    ALTER TABLE public.task_types ADD COLUMN slug text;
  END IF;
END $$;

UPDATE public.task_types
   SET slug = CASE upper(type_code)
                WHEN 'CYCLE_COUNT' THEN 'cycle_count'
                WHEN 'PICKING'     THEN 'pick'
                WHEN 'PUTAWAY'     THEN 'putaway'
                WHEN 'REPLENISH'   THEN 'replenish'
                WHEN 'KIT_PICK'    THEN 'kit_pick'
                WHEN 'ZONE_AUDIT'  THEN 'zone_audit'
                ELSE lower(type_code)
              END
 WHERE slug IS NULL;

ALTER TABLE public.task_types
  ALTER COLUMN slug SET NOT NULL;

-- Backfill default org rows with a stable id + slug for the six in-scope
-- WorkTypeIds. Idempotent — `(organization_id, slug)` clash is a no-op.
INSERT INTO public.task_types (organization_id, type_code, slug, display_name)
SELECT o.id, upper(s.slug), s.slug, s.display_name
FROM organizations o
CROSS JOIN (VALUES
  ('cycle_count', 'Cycle Count'),
  ('zone_audit',  'Zone Audit'),
  ('pick',        'Pick'),
  ('putaway',     'Putaway'),
  ('replenish',   'Replenish'),
  ('kit_pick',    'Kit Pick')
) AS s(slug, display_name)
ON CONFLICT (organization_id, type_code) DO NOTHING;

-- Composite unique on (organization_id, slug). NULL slug rejected above.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'task_types_org_slug_key'
  ) THEN
    ALTER TABLE public.task_types
      ADD CONSTRAINT task_types_org_slug_key UNIQUE (organization_id, slug);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. worker_capabilities view — projects worker_profiles JSONB into the
--    typed shape the Rust dispatcher expects (Phase 1.1).
--    If worker_profiles isn't populated for an org, the view returns no row
--    for that user, which the dispatcher treats as "unrestricted" when
--    `worker_capability_required = false`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.worker_capabilities AS
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

COMMENT ON VIEW public.worker_capabilities IS
  'Phase 1.1 typed view over worker_profiles JSONB. work_types empty + '
  'blocked empty + worker_capability_required=false ⇒ unrestricted.';

-- ---------------------------------------------------------------------------
-- 3. work_engine_settings — per-org engine row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_engine_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled_work_types text[] NOT NULL DEFAULT ARRAY['cycle_count'],
  default_strategy_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES user_profiles(id),
  updated_by uuid REFERENCES user_profiles(id)
);

CREATE TABLE IF NOT EXISTS public.work_type_settings (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  push_enabled boolean NOT NULL DEFAULT true,
  pull_enabled boolean NOT NULL DEFAULT true,
  batch_push_enabled boolean NOT NULL DEFAULT true,
  capacity_per_worker int NOT NULL DEFAULT 1 CHECK (capacity_per_worker > 0),
  require_capability boolean NOT NULL DEFAULT false,
  require_zone_assignment boolean NOT NULL DEFAULT false,
  abandonment_minutes int NOT NULL DEFAULT 30 CHECK (abandonment_minutes > 0),
  reservation_escalation_minutes int NOT NULL DEFAULT 60 CHECK (reservation_escalation_minutes > 0),
  heartbeat_release_minutes int NOT NULL DEFAULT 10 CHECK (heartbeat_release_minutes > 0),
  bypass_priorities text[] NOT NULL DEFAULT '{}',
  bypass_subtypes text[] NOT NULL DEFAULT '{}',
  default_priority text NOT NULL DEFAULT 'normal'
    CHECK (default_priority IN ('critical','hot','normal','low')),
  payload_schema_version int NOT NULL DEFAULT 1 CHECK (payload_schema_version > 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, task_type),
  FOREIGN KEY (organization_id, task_type)
    REFERENCES public.task_types (organization_id, slug)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.work_type_warehouse_overrides (
  organization_id uuid NOT NULL,
  task_type text NOT NULL,
  warehouse text NOT NULL,
  enabled boolean,
  capacity_per_worker int,
  default_priority text
    CHECK (default_priority IS NULL OR default_priority IN ('critical','hot','normal','low')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, task_type, warehouse),
  FOREIGN KEY (organization_id, task_type)
    REFERENCES public.work_type_settings (organization_id, task_type)
    ON DELETE CASCADE
);

ALTER TABLE public.work_engine_settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_type_settings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_type_warehouse_overrides  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "work_engine_settings org read"      ON public.work_engine_settings;
DROP POLICY IF EXISTS "work_engine_settings manager write" ON public.work_engine_settings;
CREATE POLICY "work_engine_settings org read" ON public.work_engine_settings
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "work_engine_settings manager write" ON public.work_engine_settings
  FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
         AND public.work_engine_is_manager_or_above_in_org(organization_id))
  WITH CHECK (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
              AND public.work_engine_is_manager_or_above_in_org(organization_id));

DROP POLICY IF EXISTS "work_type_settings org read"      ON public.work_type_settings;
DROP POLICY IF EXISTS "work_type_settings manager write" ON public.work_type_settings;
CREATE POLICY "work_type_settings org read" ON public.work_type_settings
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "work_type_settings manager write" ON public.work_type_settings
  FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
         AND public.work_engine_is_manager_or_above_in_org(organization_id))
  WITH CHECK (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
              AND public.work_engine_is_manager_or_above_in_org(organization_id));

DROP POLICY IF EXISTS "work_type_warehouse_overrides org read"      ON public.work_type_warehouse_overrides;
DROP POLICY IF EXISTS "work_type_warehouse_overrides manager write" ON public.work_type_warehouse_overrides;
CREATE POLICY "work_type_warehouse_overrides org read" ON public.work_type_warehouse_overrides
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "work_type_warehouse_overrides manager write" ON public.work_type_warehouse_overrides
  FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
         AND public.work_engine_is_manager_or_above_in_org(organization_id))
  WITH CHECK (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
              AND public.work_engine_is_manager_or_above_in_org(organization_id));

REVOKE ALL ON public.work_engine_settings           FROM PUBLIC, anon;
REVOKE ALL ON public.work_type_settings             FROM PUBLIC, anon;
REVOKE ALL ON public.work_type_warehouse_overrides  FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_engine_settings           TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_type_settings             TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_type_warehouse_overrides  TO authenticated, service_role;

-- Seed one row per org with the Phase 0.1 defaults so missing-row != default.
INSERT INTO public.work_engine_settings (organization_id, feature_flags)
SELECT id,
       jsonb_build_object(
         'work_engine_enabled',           false,
         'work_tasks_shadow_write',       false,
         'work_tasks_read_shadow',        false,
         'work_tasks_read_primary',       false,
         'work_tasks_rollback_to_legacy', false,
         'push_preflight_zone_check',     true,
         'worker_capability_required',    false,
         'signed_url_photos',             false
       )
FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

-- Seed work_type_settings: cycle_count enabled by default, others disabled.
INSERT INTO public.work_type_settings (
  organization_id, task_type, enabled, push_enabled, pull_enabled, batch_push_enabled,
  capacity_per_worker, default_priority
)
SELECT
  tt.organization_id,
  tt.slug,
  CASE WHEN tt.slug = 'cycle_count' THEN true ELSE false END,
  true, true, true,
  CASE WHEN tt.slug IN ('pick','putaway') THEN 5 ELSE 1 END,
  'normal'
FROM public.task_types tt
ON CONFLICT (organization_id, task_type) DO NOTHING;

-- Settings change notifier: emits a single payload that listeners use to
-- invalidate per-org caches (Rust + supervisor desktop).
CREATE OR REPLACE FUNCTION public.work_engine_notify_settings_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
BEGIN
  v_org := COALESCE(NEW.organization_id, OLD.organization_id);
  PERFORM pg_notify(
    'work_engine_settings_changed',
    json_build_object('organization_id', v_org, 'table', TG_TABLE_NAME, 'op', TG_OP)::text
  );
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_work_engine_settings_changed       ON public.work_engine_settings;
DROP TRIGGER IF EXISTS trg_work_type_settings_changed         ON public.work_type_settings;
DROP TRIGGER IF EXISTS trg_work_type_warehouse_overrides_chg  ON public.work_type_warehouse_overrides;

CREATE TRIGGER trg_work_engine_settings_changed
  AFTER INSERT OR UPDATE OR DELETE ON public.work_engine_settings
  FOR EACH ROW EXECUTE FUNCTION public.work_engine_notify_settings_changed();
CREATE TRIGGER trg_work_type_settings_changed
  AFTER INSERT OR UPDATE OR DELETE ON public.work_type_settings
  FOR EACH ROW EXECUTE FUNCTION public.work_engine_notify_settings_changed();
CREATE TRIGGER trg_work_type_warehouse_overrides_chg
  AFTER INSERT OR UPDATE OR DELETE ON public.work_type_warehouse_overrides
  FOR EACH ROW EXECUTE FUNCTION public.work_engine_notify_settings_changed();

-- ---------------------------------------------------------------------------
-- 4. Settings resolution helpers (Phase 0a.3).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.work_setting(
  p_org uuid, p_task_type text, p_warehouse text, p_key text
) RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH wh AS (
    SELECT to_jsonb(o)
      FROM public.work_type_warehouse_overrides o
     WHERE o.organization_id = p_org
       AND o.task_type = p_task_type
       AND o.warehouse = p_warehouse
  ), ts AS (
    SELECT to_jsonb(s)
      FROM public.work_type_settings s
     WHERE s.organization_id = p_org
       AND s.task_type = p_task_type
  ), eng AS (
    SELECT (default_strategy_overrides -> p_task_type) AS o
      FROM public.work_engine_settings
     WHERE organization_id = p_org
  )
  SELECT COALESCE(
    NULLIF((SELECT to_jsonb -> p_key FROM wh), 'null'::jsonb),
    NULLIF((SELECT to_jsonb -> p_key FROM ts), 'null'::jsonb),
    NULLIF((SELECT o -> p_key FROM eng), 'null'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.work_engine_feature_flag(p_org uuid, p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
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
$$;

REVOKE ALL ON FUNCTION public.work_setting(uuid, text, text, text)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.work_engine_feature_flag(uuid, text)        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.work_setting(uuid, text, text, text)    TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.work_engine_feature_flag(uuid, text)    TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. priority bridge (Phase 1.1) — work_queue.priority is INTEGER 0-100;
--    work_tasks.priority is text enum. Helpers for kit Kanban during
--    transition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.priority_text_to_int(p text)
RETURNS int IMMUTABLE LANGUAGE sql AS $$
  SELECT CASE p
           WHEN 'critical' THEN 90
           WHEN 'hot'      THEN 70
           WHEN 'normal'   THEN 50
           WHEN 'low'      THEN 20
           ELSE 50
         END;
$$;

CREATE OR REPLACE FUNCTION public.priority_int_to_text(p int)
RETURNS text IMMUTABLE LANGUAGE sql AS $$
  SELECT CASE
           WHEN p >= 80 THEN 'critical'
           WHEN p >= 60 THEN 'hot'
           WHEN p >= 30 THEN 'normal'
           ELSE 'low'
         END;
$$;

-- ---------------------------------------------------------------------------
-- 6. work_request_idempotency (Phase 1.5) — replay-safe POST middleware
--    backing table used by the Rust idempotency middleware.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_request_idempotency (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  route text NOT NULL,
  request_hash text NOT NULL,
  response_body jsonb,
  status_code int,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_work_request_idempotency_expires
  ON public.work_request_idempotency (expires_at);

ALTER TABLE public.work_request_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "work_request_idempotency org select" ON public.work_request_idempotency;
CREATE POLICY "work_request_idempotency org select" ON public.work_request_idempotency
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

REVOKE ALL ON public.work_request_idempotency FROM PUBLIC, anon;
GRANT SELECT ON public.work_request_idempotency TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_request_idempotency TO service_role;

-- ---------------------------------------------------------------------------
-- 7. work_tasks — canonical polymorphic task table (Phase 1.1).
--    Generated `zone` is the fast path for partial indexes; `dispatch_zone`
--    is the correctness path used by triggers, Operation Control, and the
--    Rust dispatcher predicates.
--
--    TODO(work-engine §1.4a): port the legacy advisory-locked zone
--    exclusivity triggers (mig 225-253 worth of triggers on
--    rr_cyclecount_data + cycle_count_zone_assignments) onto work_tasks.
--    Deferred until `work_tasks_read_primary` cutover — meaningful only
--    once reads switch to this table. Until then, all work_tasks
--    mutations go through SECURITY DEFINER RPCs (reassign_work_zone,
--    complete_task_with_supervisor_pin, the migration 257 projection
--    triggers) that hold legacy invariants by writing through to
--    rr_cyclecount_data. Direct authenticated INSERT/UPDATE is blocked
--    by RLS (service_role only). See docs/work-engine/README.md
--    "Operator follow-up" → "work_tasks advisory-locked zone exclusivity"
--    for the full deferral note.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  task_subtype text,
  task_number text,
  source_table text,
  source_id uuid,
  subject_material text,
  subject_description text,
  primary_location text,
  secondary_location text,
  warehouse text,
  unit_of_measure text,
  zone text GENERATED ALWAYS AS (
    CASE
      WHEN primary_location IS NULL
        OR btrim(primary_location) = ''
        OR primary_location = '<<empty>>'
      THEN NULL
      ELSE split_part(primary_location, '-', 1)
    END
  ) STORED,
  dispatch_zone text,
  resolved_zone text,
  resolved_aisle text,
  resolved_sequence numeric,
  resolution_source text,
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('critical','hot','normal','low')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','claimed','in_progress','paused','completed','cancelled')),
  legacy_status text,
  assigned_to uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  pushed_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  pushed_at timestamptz,
  push_mode text NOT NULL DEFAULT 'pull' CHECK (push_mode IN ('pull','push')),
  push_acknowledged boolean NOT NULL DEFAULT false,
  push_acknowledged_at timestamptz,
  supervisor_assigned_at timestamptz,
  supervisor_assigned_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  reservation_started_at timestamptz,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  due_date timestamptz,
  escalation_level int NOT NULL DEFAULT 0,
  escalation_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  workflow_config_id uuid,
  workflow_config_version int,
  workflow_snapshot jsonb,
  payload_version int NOT NULL DEFAULT 1 CHECK (payload_version > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb,
  idempotency_key text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, task_type)
    REFERENCES public.task_types (organization_id, slug),
  CONSTRAINT work_tasks_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT work_tasks_source_unique UNIQUE (source_table, source_id) DEFERRABLE INITIALLY IMMEDIATE
);

-- Soft-delete-aware unique on task number per org+type.
CREATE UNIQUE INDEX IF NOT EXISTS work_tasks_org_type_number_uniq
  ON public.work_tasks (organization_id, task_type, task_number)
  WHERE deleted_at IS NULL;

-- Idempotency-key uniqueness for SAP/OmniAgent inserts (replay-safe).
CREATE UNIQUE INDEX IF NOT EXISTS work_tasks_idempotency_uniq
  ON public.work_tasks (organization_id, task_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Phase 1.1 indexes (claim ordering, operator open work, SLA scan,
-- pattern-aware zone-owner lookup, reserved-zone, supervisor protection,
-- payload version scan).
CREATE INDEX IF NOT EXISTS idx_work_tasks_claim_order
  ON public.work_tasks (organization_id, task_type, status, priority, primary_location);
CREATE INDEX IF NOT EXISTS idx_work_tasks_operator_open
  ON public.work_tasks (assigned_to, status)
  WHERE status IN ('claimed','in_progress');
CREATE INDEX IF NOT EXISTS idx_work_tasks_sla_scan
  ON public.work_tasks (organization_id, status, due_date)
  WHERE status NOT IN ('completed','cancelled');
CREATE INDEX IF NOT EXISTS idx_work_tasks_active_zone_owner
  ON public.work_tasks (organization_id, task_type, dispatch_zone, assigned_to)
  WHERE assigned_to IS NOT NULL AND status IN ('claimed','in_progress');
CREATE INDEX IF NOT EXISTS idx_work_tasks_reserved_zone
  ON public.work_tasks (organization_id, task_type, dispatch_zone)
  WHERE status = 'pending' AND assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_tasks_supervisor_protected
  ON public.work_tasks (organization_id, supervisor_assigned_by)
  WHERE supervisor_assigned_at IS NOT NULL AND status IN ('pending','claimed','in_progress');
CREATE INDEX IF NOT EXISTS idx_work_tasks_payload_version
  ON public.work_tasks (organization_id, task_type, payload_version);

ALTER TABLE public.work_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "work_tasks org read"  ON public.work_tasks;
DROP POLICY IF EXISTS "work_tasks org write" ON public.work_tasks;
CREATE POLICY "work_tasks org read" ON public.work_tasks
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "work_tasks org write" ON public.work_tasks
  FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

REVOKE ALL ON public.work_tasks FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.work_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_tasks TO service_role;

-- ---------------------------------------------------------------------------
-- 8. work_events — append-only audit log (Phase 1.6).
--    Composite (organization_id, task_id) FK enforces tenant binding at the
--    schema level; RLS alone is insufficient (per plan §risks).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id uuid,
  event_type text NOT NULL CHECK (event_type IN (
    'created','claimed','acknowledged','started','paused','resumed','completed',
    'released','skipped','reassigned','escalated','signed_off','pin_verified',
    'pin_failed','cancelled','deleted','priority_changed','artifact_added',
    'settings_changed','shadow_drift','reconciled','force_break'
  )),
  actor_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  actor_role text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_events_task_org_fk FOREIGN KEY (organization_id, task_id)
    REFERENCES public.work_tasks(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_work_events_task_at
  ON public.work_events (task_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_work_events_org_type_at
  ON public.work_events (organization_id, event_type, at DESC);

ALTER TABLE public.work_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "work_events org read"          ON public.work_events;
DROP POLICY IF EXISTS "work_events service insert"    ON public.work_events;
CREATE POLICY "work_events org read" ON public.work_events
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
-- Direct INSERT only via SECURITY DEFINER paths (RPCs) and service_role.
CREATE POLICY "work_events service insert" ON public.work_events
  FOR INSERT TO service_role
  WITH CHECK (true);
-- UPDATE / DELETE denied by absence of a policy.

REVOKE ALL ON public.work_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.work_events TO authenticated;
GRANT SELECT, INSERT ON public.work_events TO service_role;

-- ---------------------------------------------------------------------------
-- 9. task_artifacts — photos/notes/serials/etc. composite FK as well.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('photo','note','serial','signature','barcode')),
  storage_path text,
  mime text,
  size_bytes int,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_artifacts_task_org_fk FOREIGN KEY (organization_id, task_id)
    REFERENCES public.work_tasks(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_artifacts_task_kind
  ON public.task_artifacts (task_id, kind);
CREATE INDEX IF NOT EXISTS idx_task_artifacts_org_kind_at
  ON public.task_artifacts (organization_id, kind, created_at DESC);

ALTER TABLE public.task_artifacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "task_artifacts org read"           ON public.task_artifacts;
DROP POLICY IF EXISTS "task_artifacts assigned insert"    ON public.task_artifacts;
DROP POLICY IF EXISTS "task_artifacts owner_or_mgr write" ON public.task_artifacts;
CREATE POLICY "task_artifacts org read" ON public.task_artifacts
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "task_artifacts assigned insert" ON public.task_artifacts
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.work_tasks wt
       WHERE wt.id = task_id AND wt.organization_id = task_artifacts.organization_id
         AND (wt.assigned_to = auth.uid()
              OR public.work_engine_is_manager_or_above_in_org(task_artifacts.organization_id))
    )
  );
CREATE POLICY "task_artifacts owner_or_mgr write" ON public.task_artifacts
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
    AND (created_by = auth.uid()
         OR public.work_engine_is_manager_or_above_in_org(organization_id))
  );

REVOKE ALL ON public.task_artifacts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.task_artifacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_artifacts TO service_role;

-- ---------------------------------------------------------------------------
-- 10. dispatch_zone maintenance (Phase 1.4a invariant 1 + 7).
--     Pattern-aware zone-of helper (mirrors cycle_count_zone_of from
--     migration 225). Falls back to first hyphen-segment if pattern is null.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.work_zone_of(p_location text, p_pattern text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match text;
BEGIN
  IF p_location IS NULL OR btrim(p_location) = '' OR p_location = '<<empty>>' THEN
    RETURN NULL;
  END IF;
  IF p_pattern IS NULL OR btrim(p_pattern) = '' THEN
    RETURN split_part(p_location, '-', 1);
  END IF;
  v_match := substring(p_location FROM p_pattern);
  IF v_match IS NULL OR btrim(v_match) = '' THEN
    RETURN split_part(p_location, '-', 1);
  END IF;
  RETURN v_match;
END $$;

-- Maintain dispatch_zone on insert / when primary_location changes.
CREATE OR REPLACE FUNCTION public.work_tasks_maintain_dispatch_zone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pattern text;
BEGIN
  -- BEFORE-trigger NEW.zone is unreadable for STORED generated columns
  -- (per Pull-Next-Claim-Performance gotcha). Compute inline.
  IF TG_OP = 'INSERT' OR NEW.primary_location IS DISTINCT FROM OLD.primary_location THEN
    -- Look up the pattern from cycle_count_zone_rules if present (migration
    -- 225). We swallow undefined-table to keep this trigger usable in
    -- environments that haven't applied migration 225 (test fixtures).
    BEGIN
      SELECT zone_pattern INTO v_pattern
        FROM public.cycle_count_zone_rules
       WHERE organization_id = NEW.organization_id
       LIMIT 1;
    EXCEPTION WHEN undefined_table THEN
      v_pattern := NULL;
    END;
    NEW.dispatch_zone := public.work_zone_of(NEW.primary_location, v_pattern);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_work_tasks_dispatch_zone ON public.work_tasks;
CREATE TRIGGER trg_work_tasks_dispatch_zone
  BEFORE INSERT OR UPDATE OF primary_location ON public.work_tasks
  FOR EACH ROW EXECUTE FUNCTION public.work_tasks_maintain_dispatch_zone();

-- ---------------------------------------------------------------------------
-- 11. reservation_started_at maintenance (Phase 1.4b — port of migration 252).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.maintain_work_task_reservation_started_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  was_reserved boolean := (OLD IS NOT NULL AND OLD.status = 'pending' AND OLD.assigned_to IS NOT NULL);
  is_reserved  boolean := (NEW.status = 'pending' AND NEW.assigned_to IS NOT NULL);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF is_reserved THEN
      NEW.reservation_started_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF NOT was_reserved AND is_reserved THEN
    NEW.reservation_started_at := now();
  ELSIF was_reserved AND is_reserved AND OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
    NEW.reservation_started_at := now();
  ELSIF was_reserved AND NOT is_reserved THEN
    NEW.reservation_started_at := NULL;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_maintain_work_task_reservation ON public.work_tasks;
CREATE TRIGGER trg_maintain_work_task_reservation
  BEFORE INSERT OR UPDATE OF status, assigned_to ON public.work_tasks
  FOR EACH ROW EXECUTE FUNCTION public.maintain_work_task_reservation_started_at();

-- updated_at touch.
CREATE OR REPLACE FUNCTION public.work_tasks_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_work_tasks_updated_at ON public.work_tasks;
CREATE TRIGGER trg_work_tasks_updated_at
  BEFORE UPDATE ON public.work_tasks
  FOR EACH ROW EXECUTE FUNCTION public.work_tasks_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 12. work_zone_assignments compatibility view + work_zone_rules writable
--     view (Phase 1.4a invariant 11 + 4). Underlying tables are unchanged
--     until Phase 11.5 soak completes.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cycle_count_zone_assignments'
  ) THEN
    EXECUTE 'CREATE OR REPLACE VIEW public.work_zone_assignments WITH (security_invoker = true) AS '
            'SELECT organization_id, zone, user_id, notes, created_at, updated_at, '
            'created_by, updated_by FROM public.cycle_count_zone_assignments';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cycle_count_zone_rules'
  ) THEN
    EXECUTE 'CREATE OR REPLACE VIEW public.work_zone_rules WITH (security_invoker = true) AS '
            'SELECT * FROM public.cycle_count_zone_rules';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 13. Operation Control tab seed (Phase 0b.10).
-- ---------------------------------------------------------------------------
INSERT INTO public.tab_definitions
  (page_resource, tab_id, tab_label, description, display_order)
VALUES
  ('inventory_apps', 'operation-control', 'Operation Control',
   'Live command center: zones, operators, queues, and interventions',
   45)
ON CONFLICT (page_resource, tab_id) DO NOTHING;

-- Grant Operation Control tab to manager+ roles.
INSERT INTO public.role_tab_permissions (role_id, tab_definition_id, granted)
SELECT r.id, td.id, true
FROM public.tab_definitions td
JOIN public.roles r ON r.name IN ('admin','manager','superadmin','logistics_coordinator')
WHERE td.page_resource = 'inventory_apps' AND td.tab_id = 'operation-control'
ON CONFLICT (role_id, tab_definition_id) DO UPDATE SET granted = EXCLUDED.granted;

-- ---------------------------------------------------------------------------
-- 14. reassign_work_zone RPC (Phase 0b.7) — single SECURITY DEFINER path
--     used by Operation Control drag-reassignment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reassign_work_zone(
  p_org uuid,
  p_zone text,
  p_from uuid,
  p_to uuid,
  p_mode text,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_lock_key text;
  v_dispatch_zone text;
  v_replay jsonb;
  v_tasks_moved int := 0;
  v_events_written int := 0;
BEGIN
  IF p_mode NOT IN ('soft','hard') THEN
    RAISE EXCEPTION 'invalid mode: %', p_mode USING ERRCODE = '22023';
  END IF;
  IF v_caller IS NOT NULL AND NOT public.work_engine_is_manager_or_above_in_org(p_org) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  -- Idempotency replay short-circuit.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT response_body INTO v_replay
      FROM public.work_request_idempotency
     WHERE organization_id = p_org
       AND idempotency_key = p_idempotency_key
       AND route = 'reassign_work_zone';
    IF v_replay IS NOT NULL THEN
      RETURN v_replay;
    END IF;
  END IF;

  -- Resolve dispatch zone via the same pattern-aware helper used by triggers.
  v_dispatch_zone := public.work_zone_of(p_zone || '-X', NULL);
  -- For an explicit zone code we use the value as-is; the helper above just
  -- guards against unexpected formats.
  v_dispatch_zone := COALESCE(NULLIF(p_zone,''), v_dispatch_zone);

  v_lock_key := 'worktask_zone:' || p_org::text || ':' || COALESCE(v_dispatch_zone,'');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  -- Soft mode: future pending assignments in this zone move to p_to;
  -- in_progress tasks stay with p_from until completion/release.
  -- Hard mode: also reassign claimed/in_progress tasks.
  PERFORM set_config('app.work_zone_lock_bypass', 'on', true);

  IF p_mode = 'hard' THEN
    UPDATE public.work_tasks
       SET assigned_to = p_to,
           pushed_by = v_caller,
           pushed_at = now(),
           push_mode = 'push',
           push_acknowledged = false,
           push_acknowledged_at = NULL,
           supervisor_assigned_at = now(),
           supervisor_assigned_by = v_caller,
           updated_at = now()
     WHERE organization_id = p_org
       AND dispatch_zone = v_dispatch_zone
       AND assigned_to = p_from
       AND status IN ('pending','claimed','in_progress');
    GET DIAGNOSTICS v_tasks_moved = ROW_COUNT;
  ELSE
    UPDATE public.work_tasks
       SET assigned_to = p_to,
           pushed_by = v_caller,
           pushed_at = now(),
           push_mode = 'push',
           push_acknowledged = false,
           supervisor_assigned_at = now(),
           supervisor_assigned_by = v_caller,
           updated_at = now()
     WHERE organization_id = p_org
       AND dispatch_zone = v_dispatch_zone
       AND assigned_to = p_from
       AND status = 'pending';
    GET DIAGNOSTICS v_tasks_moved = ROW_COUNT;
  END IF;

  -- Audit (one row per moved task).
  INSERT INTO public.work_events (organization_id, task_id, event_type, actor_id, payload)
  SELECT p_org, wt.id, 'reassigned', v_caller,
         jsonb_build_object('zone', p_zone, 'dispatch_zone', v_dispatch_zone,
                            'from', p_from, 'to', p_to, 'mode', p_mode)
    FROM public.work_tasks wt
   WHERE wt.organization_id = p_org
     AND wt.dispatch_zone = v_dispatch_zone
     AND wt.assigned_to = p_to
     AND wt.updated_at >= now() - interval '5 seconds';
  GET DIAGNOSTICS v_events_written = ROW_COUNT;

  -- Best-effort update of the zone-assignment pin (legacy table).
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cycle_count_zone_assignments'
  ) THEN
    EXECUTE 'UPDATE public.cycle_count_zone_assignments
                SET user_id = $1, updated_at = now(), updated_by = $2
              WHERE organization_id = $3 AND zone = $4 AND user_id = $5'
      USING p_to, v_caller, p_org, p_zone, p_from;
  END IF;

  v_replay := jsonb_build_object(
    'tasks_moved', v_tasks_moved,
    'events_written', v_events_written,
    'idempotency_key', p_idempotency_key
  );

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.work_request_idempotency
      (organization_id, idempotency_key, route, request_hash, response_body, status_code)
    VALUES
      (p_org, p_idempotency_key, 'reassign_work_zone',
       md5(p_org::text || '|' || p_zone || '|' || p_from::text || '|' || p_to::text || '|' || p_mode),
       v_replay, 200)
    ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  END IF;

  RETURN v_replay;
END $$;

REVOKE ALL ON FUNCTION public.reassign_work_zone(uuid, text, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reassign_work_zone(uuid, text, uuid, uuid, text, text) TO authenticated, service_role;

COMMIT;
