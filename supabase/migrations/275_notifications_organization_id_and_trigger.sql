-- Migration: Tier 2 #2 — extend `public.notifications` for the
-- server-pushed notifications panel.
-- Date: 2026-05-06
-- Description:
--   Adds `organization_id`, `kind`, and supporting indexes to the
--   existing `public.notifications` table. Wires a NOTIFY trigger
--   so `rust-work-service::notifications_listener` can fan out a
--   `WsEvent::Notification` to org-subscribed sockets when a row
--   is INSERTed. RLS gets a defence-in-depth `organization_id`
--   match so service-role inserts can't accidentally cross-tenant.
--
--   Companion to:
--     - rust-work-service/src/notifications_listener.rs
--     - rust-work-service/src/api/routes/notifications.rs
--     - rust-work-service/src/websocket/mod.rs (WsEvent::Notification)
--     - src/hooks/use-notifications.ts (FE consumer)
--     - src/components/notifications/notifications-panel.tsx (bell + popover)
--
-- The pre-existing `notifications` table has these columns:
--   id, user_id, type (notification_type enum), title, message,
--   data, read, read_at, action_url, created_at.
--
-- We KEEP all existing columns. We ADD:
--   - organization_id uuid (with FK to organizations.id)
--   - kind text (free-form event-class label, e.g. 'sap_job_complete')
--   - INDEX (user_id, read, created_at DESC) for the bell-icon fetch
--   - INDEX (user_id, organization_id) for the per-tenant scope
--   - AFTER INSERT trigger → pg_notify('notification_created', json)
--   - RLS policy update to also gate on organization_id
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS.

-- ───────────────────────────────────────────────────────────────────────
-- 1. ADD organization_id (NOT NULL after backfill)
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS organization_id uuid;

-- Backfill from user_profiles where the FK link makes one possible.
-- Existing rows that don't resolve are left NULL; the NOT NULL
-- constraint below is conditional on a 0-NULL state being achievable.
UPDATE public.notifications n
   SET organization_id = up.organization_id
  FROM public.user_profiles up
 WHERE n.user_id = up.id
   AND n.organization_id IS NULL;

-- Add the NOT NULL constraint only if ALL rows resolved. If any
-- legacy row is still NULL we leave the column nullable rather than
-- fail the migration; ops can decide whether to delete those rows
-- or backfill them via another path.
DO $$
DECLARE
  null_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO null_count
    FROM public.notifications WHERE organization_id IS NULL;
  IF null_count = 0 THEN
    BEGIN
      ALTER TABLE public.notifications
        ALTER COLUMN organization_id SET NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'notifications.organization_id NOT NULL skipped: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'notifications.organization_id has % NULL rows; '
                 'kept nullable. Backfill before tightening.', null_count;
  END IF;
END$$;

-- FK to organizations.id — separate ALTER so it's re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'notifications_organization_id_fkey'
       AND conrelid = 'public.notifications'::regclass
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
      ON DELETE CASCADE;
  END IF;
END$$;

-- ───────────────────────────────────────────────────────────────────────
-- 2. ADD kind (free-form event-class label)
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS kind text;

COMMENT ON COLUMN public.notifications.kind IS
  'Tier 2 #2 — event-class label (e.g. sap_job_complete, '
  'reservation_escalated, ticket_assigned). Drives FE icon / '
  'click-handler dispatch. Free-form text; no enum so domain '
  'services can add new kinds without a migration.';

-- ───────────────────────────────────────────────────────────────────────
-- 3. Indexes for the bell-icon fetch path
-- ───────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, read, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_org_idx
  ON public.notifications (user_id, organization_id);

-- ───────────────────────────────────────────────────────────────────────
-- 4. NOTIFY trigger
-- ───────────────────────────────────────────────────────────────────────
-- Mirrors the shape of `notify_sap_agent_changed()` (mig 270):
--   * SECURITY DEFINER — trigger fires regardless of caller RLS.
--   * search_path = public, pg_temp — paranoia hardening.
--   * Payload: notification_id, user_id, organization_id, kind,
--     title, body (mapped from `message`), link (mapped from
--     `action_url`), severity (mapped from `type::text`).

CREATE OR REPLACE FUNCTION public.notify_notification_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payload jsonb;
BEGIN
  -- AFTER INSERT only — UPDATEs (e.g. mark-as-read) don't need
  -- to fan out a "new notification" event.
  v_payload := jsonb_build_object(
    'notification_id', NEW.id,
    'user_id',         NEW.user_id,
    'organization_id', NEW.organization_id,
    'kind',            NEW.kind,
    'title',           NEW.title,
    'body',            NEW.message,
    'link',            NEW.action_url,
    'severity',        NEW.type::text
  );

  -- Skip the NOTIFY when the row is missing the org filter. This
  -- shouldn't happen post-backfill but the listener side would
  -- reject the payload anyway.
  IF NEW.organization_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM pg_notify('notification_created', v_payload::text);
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION public.notify_notification_created() IS
  'NOTIFY trigger emitted on notifications INSERT. Consumed by '
  'rust-work-service via sqlx PgListener; broadcast as '
  'WsEvent::Notification to org-scoped WS subscribers. FE filter '
  'on user_id matches current user_id for per-user delivery.';

DROP TRIGGER IF EXISTS notifications_notify_created ON public.notifications;

CREATE TRIGGER notifications_notify_created
  AFTER INSERT
  ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_notification_created();

COMMENT ON TRIGGER notifications_notify_created ON public.notifications IS
  'Per-row pg_notify on notifications INSERT → channel '
  'notification_created. See notify_notification_created() for '
  'payload shape.';

-- ───────────────────────────────────────────────────────────────────────
-- 5. RLS — keep existing user_id check, add a defence-in-depth
--    organization_id match for SELECT.
-- ───────────────────────────────────────────────────────────────────────
-- The existing `Users can view their own notifications` policy already
-- filters on `user_id = auth.uid()`. We tighten it to ALSO match the
-- requesting JWT's organization_id (derived from user_profiles),
-- so a service-role bypass that mints a row with the wrong org is
-- visible only to the user it was directed at, not their old org.

DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;

CREATE POLICY "Users can view their own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND organization_id = (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;

CREATE POLICY "Users can update their own notifications"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- Service-role insert policy — explicit so backend services using
-- the service-role JWT can create notifications without RLS denial.
-- Service role bypasses RLS by default, but we add this for the
-- (rare) case of a non-service-role helper that has been granted
-- INSERT.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'notifications'
       AND policyname = 'Service role can insert notifications'
  ) THEN
    CREATE POLICY "Service role can insert notifications"
      ON public.notifications
      FOR INSERT
      TO service_role
      WITH CHECK (TRUE);
  END IF;
END$$;
