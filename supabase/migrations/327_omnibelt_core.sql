-- ============================================================================
-- Migration 327 — OmniBelt Foundation (P1)
--
-- Authored 2026-05-24 as Phase P1 of the OmniBelt site-wide floating launcher
-- rollout. Creates the three persistent OmniBelt tables, the 24h aggregation
-- materialized view, the pg_notify trigger that drives `rust-work-service`
-- hot-reload of org config, the `pg_cron` job that refreshes the MV every
-- 5 minutes, and the `omnibelt` permission resource (default-granted to
-- `admin` and `superadmin`).
--
-- Spec:        docs/superpowers/specs/2026-05-24-omnibelt-design.md (§4)
-- Implementation log: memorybank/OmniFrame/Implementations/Implement-OmniBelt-MVP.md
-- Pattern:     memorybank/OmniFrame/Patterns/OmniBelt-Floating-Launcher.md
-- Decision:    memorybank/OmniFrame/Decisions/ADR-OmniBelt-Site-Chrome.md
--
-- Conventions reused from prior migrations:
--   * Org-scope idiom (migration 011 / 295 / 307):
--       organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
--   * Permission gate idiom (migration 308):
--       public.has_permission('omnibelt', 'manage')
--     `has_permission` resolves via `role_id` (NOT the legacy `role` enum)
--     and is the canonical RLS gate across the codebase.
--   * Permission seed idiom (migration 295):
--       INSERT INTO permissions (...) ON CONFLICT (name) DO NOTHING;
--       INSERT INTO role_permissions (role_id, permission_id, role)
--       SELECT r.id, p.id, CASE ... END FROM roles r CROSS JOIN permissions p
--       WHERE p.name = '<name>' AND r.name IN ('admin','superadmin')
--       ON CONFLICT (role_id, permission_id) DO NOTHING;
--   * pg_cron idiom (migration 175): wrap `cron.schedule` in a DO block that
--     gates on `pg_extension`, raises a NOTICE if pg_cron is unavailable, and
--     unschedules any previous job of the same name first for idempotency.
--
-- Idempotent: every CREATE uses IF NOT EXISTS, every function uses
-- CREATE OR REPLACE, every trigger is DROPped first, every INSERT uses
-- ON CONFLICT DO NOTHING. Wrapped in a single transaction.
--
-- Note on `permissions.scope`: the design spec uses the word "global" but the
-- existing CHECK constraint (migration 007) restricts scope to
-- `('application','system','organization','user')`. OmniBelt configuration
-- (kill switch, role config) is per-org, so we pick `'organization'` — the
-- closest semantic match and the value used by every recently-seeded
-- resource (warehouse_maps, device_manager, cubiscan, inbound_carts).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. omnibelt_role_config — admin-curated default belt per (org, role)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.omnibelt_role_config (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role_id              UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  default_tool_ids     TEXT[] NOT NULL DEFAULT '{}',
  default_pinned_ids   TEXT[] NOT NULL DEFAULT '{}',
  default_position     JSONB  NOT NULL DEFAULT '{"anchor":"BR","offset":{"x":24,"y":24}}'::jsonb,
  default_skin         TEXT   NOT NULL DEFAULT 'pill'
                              CHECK (default_skin IN ('pill','orb','skystrip')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT omnibelt_role_config_org_role_uniq UNIQUE (organization_id, role_id)
);

COMMENT ON TABLE public.omnibelt_role_config IS
  'Per-(organization, role) default OmniBelt configuration: which tools land in the belt, which are pinned, the default anchor position, and the default skin. Admins edit this via /admin/omnibelt; users override within the role-allowed pool via omnibelt_user_prefs.';

COMMENT ON COLUMN public.omnibelt_role_config.default_tool_ids IS
  'Allow-listed tool IDs for this role. Unknown IDs are dropped client-side so admins can roll new tools out gradually.';

COMMENT ON COLUMN public.omnibelt_role_config.default_pinned_ids IS
  'Subset of default_tool_ids that should appear pinned by default. Users can override via omnibelt_user_prefs.pinned_tool_ids.';

COMMENT ON COLUMN public.omnibelt_role_config.default_position IS
  'Default anchor position: { anchor: TL|TC|TR|ML|MR|BL|BC|BR|FREE|PINNED|NUB_*, offset: { x, y } }.';

CREATE INDEX IF NOT EXISTS idx_omnibelt_role_config_org
  ON public.omnibelt_role_config (organization_id);

-- ----------------------------------------------------------------------------
-- 2. omnibelt_user_prefs — per-user customization within role-allowed pool
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.omnibelt_user_prefs (
  user_id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pinned_tool_ids          TEXT[] NOT NULL DEFAULT '{}',
  hidden_tool_ids          TEXT[] NOT NULL DEFAULT '{}',
  tool_order               TEXT[] NOT NULL DEFAULT '{}',
  position_by_route        JSONB  NOT NULL DEFAULT '{}'::jsonb,
  skin                     TEXT   DEFAULT NULL
                                  CHECK (skin IS NULL OR skin IN ('pill','orb','skystrip')),
  mach3_behavior           TEXT   NOT NULL DEFAULT 'halo_plus_autoexpand'
                                  CHECK (mach3_behavior IN (
                                    'halo_only',
                                    'halo_plus_autoexpand',
                                    'halo_plus_morph',
                                    'halo_plus_tray_pinned'
                                  )),
  auto_hide_after_seconds  INTEGER NOT NULL DEFAULT 15,
  user_hidden              BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.omnibelt_user_prefs IS
  'Per-user OmniBelt customization layered on top of the role default. One row per auth.users.id. Hydrated into the Zustand store on bootstrap; debounced (500 ms) write-through on mutation.';

COMMENT ON COLUMN public.omnibelt_user_prefs.position_by_route IS
  'Per-route-class anchor position map keyed by routeClass(pathname): { admin: {anchor, offset}, operations: {...}, ... }. Bounded set of <=10 keys to prevent unbounded growth from dynamic paths.';

COMMENT ON COLUMN public.omnibelt_user_prefs.skin IS
  'NULL means "inherit role default". Set to a concrete skin to override.';

COMMENT ON COLUMN public.omnibelt_user_prefs.mach3_behavior IS
  'How background-job status (Mach 3) is surfaced: halo_only (rings only), halo_plus_autoexpand (default; tray pops for 4 s on user-started jobs), halo_plus_morph (orb morphs), halo_plus_tray_pinned (tray always visible).';

CREATE INDEX IF NOT EXISTS idx_omnibelt_user_prefs_org
  ON public.omnibelt_user_prefs (organization_id);

CREATE INDEX IF NOT EXISTS idx_omnibelt_user_prefs_updated
  ON public.omnibelt_user_prefs (updated_at DESC);

-- ----------------------------------------------------------------------------
-- 3. omnibelt_tool_events — telemetry feed (v1-rich analytics)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.omnibelt_tool_events (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_id         TEXT NOT NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN (
                    'tool_launch','tool_pin','tool_unpin','tool_hide',
                    'panel_open','panel_close','tray_expand','tray_collapse',
                    'skin_change','position_change','belt_visible','belt_hidden'
                  )),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.omnibelt_tool_events IS
  'Telemetry feed for OmniBelt usage analytics. Inserted in 10s batched POST from the frontend (50 events/user/min hard cap, server-side Redis sliding window backs this up). Aggregated into omnibelt_tool_events_24h_mv every 5 minutes via pg_cron.';

COMMENT ON COLUMN public.omnibelt_tool_events.tool_id IS
  'Tool definition ID (e.g. quick_pick, sap_status). Empty string for non-tool events (panel_open, skin_change, ...).';

CREATE INDEX IF NOT EXISTS idx_omnibelt_events_org_time
  ON public.omnibelt_tool_events (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_omnibelt_events_tool
  ON public.omnibelt_tool_events (tool_id, occurred_at DESC);

-- ----------------------------------------------------------------------------
-- 4. omnibelt_tool_events_24h_mv — 24h aggregation, refreshed every 5 min
-- ----------------------------------------------------------------------------
-- Materialized views do not support `IF NOT EXISTS` for the unique index in
-- all PG versions, so we wrap the create in a DO block. The MV itself uses
-- IF NOT EXISTS (PG 12+).

CREATE MATERIALIZED VIEW IF NOT EXISTS public.omnibelt_tool_events_24h_mv AS
SELECT
  organization_id,
  tool_id,
  event_type,
  date_trunc('hour', occurred_at) AS bucket_hour,
  COUNT(*)::BIGINT                AS event_count,
  COUNT(DISTINCT user_id)::BIGINT AS user_count
FROM public.omnibelt_tool_events
WHERE occurred_at > NOW() - INTERVAL '24 hours'
GROUP BY 1, 2, 3, 4;

COMMENT ON MATERIALIZED VIEW public.omnibelt_tool_events_24h_mv IS
  '24h rolling aggregation of omnibelt_tool_events bucketed to the hour. Refreshed CONCURRENTLY every 5 minutes via pg_cron (see migration 327, step 7). Read by the admin dashboard via supabaseRead.';

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS idx_omnibelt_events_24h_mv_unique
  ON public.omnibelt_tool_events_24h_mv
     (organization_id, tool_id, event_type, bucket_hour);

-- ----------------------------------------------------------------------------
-- 5. RLS policies
-- ----------------------------------------------------------------------------

ALTER TABLE public.omnibelt_role_config  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omnibelt_user_prefs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omnibelt_tool_events  ENABLE ROW LEVEL SECURITY;

-- ---- omnibelt_role_config: read-org / write-admin-or-superadmin ----------

DROP POLICY IF EXISTS "omnibelt_role_config_select" ON public.omnibelt_role_config;
CREATE POLICY "omnibelt_role_config_select" ON public.omnibelt_role_config
  FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "omnibelt_role_config_mutate" ON public.omnibelt_role_config;
CREATE POLICY "omnibelt_role_config_mutate" ON public.omnibelt_role_config
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('omnibelt', 'manage')
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('omnibelt', 'manage')
  );

-- ---- omnibelt_user_prefs: read/write own row only ------------------------

DROP POLICY IF EXISTS "omnibelt_user_prefs_self" ON public.omnibelt_user_prefs;
CREATE POLICY "omnibelt_user_prefs_self" ON public.omnibelt_user_prefs
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---- omnibelt_tool_events: insert-self / read-admin ----------------------

DROP POLICY IF EXISTS "omnibelt_events_insert_self" ON public.omnibelt_tool_events;
CREATE POLICY "omnibelt_events_insert_self" ON public.omnibelt_tool_events
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "omnibelt_events_read_admin" ON public.omnibelt_tool_events;
CREATE POLICY "omnibelt_events_read_admin" ON public.omnibelt_tool_events
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
    AND public.has_permission('omnibelt', 'manage')
  );

-- ----------------------------------------------------------------------------
-- 6. notify_omnibelt_config_change() trigger function + trigger
--
-- pg_notify drives `rust-work-service` PgListener which then broadcasts
-- WsEvent::OmnibeltConfigChanged to all clients in that org and DELs the
-- Redis cache key `omnibelt:bootstrap:{org_id}:*`. See spec §3.2 / §5.3.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_omnibelt_config_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  payload_org UUID;
BEGIN
  payload_org := COALESCE(NEW.organization_id, OLD.organization_id);
  PERFORM pg_notify(
    'omnibelt_config_changed',
    json_build_object('org_id', payload_org)::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.notify_omnibelt_config_change() IS
  'AFTER INSERT/UPDATE/DELETE trigger on omnibelt_role_config. Fires pg_notify on channel "omnibelt_config_changed" with { org_id } payload. rust-work-service PgListener subscribes to this channel and broadcasts WsEvent::OmnibeltConfigChanged to all subscribers in that org.';

DROP TRIGGER IF EXISTS omnibelt_role_config_notify
  ON public.omnibelt_role_config;
CREATE TRIGGER omnibelt_role_config_notify
  AFTER INSERT OR UPDATE OR DELETE ON public.omnibelt_role_config
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_omnibelt_config_change();

-- ----------------------------------------------------------------------------
-- 7. pg_cron: refresh omnibelt_tool_events_24h_mv every 5 minutes
--
-- Mirrors the safety-net pattern from migration 175. Wrapped in a DO block
-- that only runs if pg_cron is installed; otherwise emits a NOTICE.
-- The previous job (if any) is unscheduled first so the migration is
-- re-runnable.
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('omnibelt-mv-refresh');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'omnibelt-mv-refresh',
      '*/5 * * * *',
      'REFRESH MATERIALIZED VIEW CONCURRENTLY public.omnibelt_tool_events_24h_mv;'
    );

    RAISE NOTICE 'pg_cron job scheduled: omnibelt-mv-refresh (every 5 minutes)';
  ELSE
    RAISE NOTICE 'pg_cron extension not available — omnibelt_tool_events_24h_mv will not auto-refresh';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped (not critical): %', SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- 8. Permission seed: omnibelt.manage + role grants for admin/superadmin
--
-- Mirrors the permission-seed idiom from migration 295. The legacy `role`
-- enum column on role_permissions is NOT NULL; both 'admin' and 'superadmin'
-- exist in the user_role enum so a direct cast is safe (no fallback needed).
-- ----------------------------------------------------------------------------

INSERT INTO public.permissions (name, resource, action, description, is_critical, scope, risk_level)
VALUES (
  'omnibelt.manage',
  'omnibelt',
  'manage',
  'Manage OmniBelt: org-wide kill switch, tool allow-list, per-role default belt, and admin dashboard',
  FALSE,
  'organization',
  'low'
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id, role)
SELECT
  r.id,
  p.id,
  r.name::user_role
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.name = 'omnibelt.manage'
  AND r.name IN ('admin', 'superadmin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 9. updated_at touch trigger (mirrors migration 307 idiom)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_omnibelt_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_omnibelt_role_config_updated_at
  ON public.omnibelt_role_config;
CREATE TRIGGER trg_touch_omnibelt_role_config_updated_at
  BEFORE UPDATE ON public.omnibelt_role_config
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_omnibelt_updated_at();

DROP TRIGGER IF EXISTS trg_touch_omnibelt_user_prefs_updated_at
  ON public.omnibelt_user_prefs;
CREATE TRIGGER trg_touch_omnibelt_user_prefs_updated_at
  BEFORE UPDATE ON public.omnibelt_user_prefs
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_omnibelt_updated_at();

-- ----------------------------------------------------------------------------
-- 10. PostgREST schema reload
-- ----------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ----------------------------------------------------------------------------
-- Migration completion notice
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Migration 327: OmniBelt Foundation — COMPLETED';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Tables created/ensured:';
  RAISE NOTICE '  * omnibelt_role_config';
  RAISE NOTICE '  * omnibelt_user_prefs';
  RAISE NOTICE '  * omnibelt_tool_events';
  RAISE NOTICE 'Materialized view: omnibelt_tool_events_24h_mv';
  RAISE NOTICE 'Trigger: omnibelt_role_config_notify -> pg_notify(omnibelt_config_changed)';
  RAISE NOTICE 'pg_cron: omnibelt-mv-refresh (*/5 * * * *)';
  RAISE NOTICE 'Permission: omnibelt.manage (granted to admin, superadmin)';
  RAISE NOTICE '============================================================';
END $$;
