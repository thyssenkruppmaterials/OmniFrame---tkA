-- Migration: Persistent chat thread for the Kit Build Audit Trail dialog
-- Date: 2026-05-18
-- Description: Backs the "Kit Notes" thread inside the Kit Build Audit Trail (Quick View) with a
--   real table so messages are saved, tied to a specific kit by serial number, and stamped with
--   the user who sent them. Replaces the hard-coded `useState<ChatMessage[]>([...])` baseline that
--   was wiping on every dialog close.
--
--   Append-only / immutable audit trail — no UPDATE / DELETE policy (operators cannot edit or
--   redact a typed message). The same table holds both user-typed messages and system messages
--   stamped from in-dialog events (flag added/removed, ship-short authorized, etc.) — sender_type
--   distinguishes them.
--
--   Per-org scoped via the resolved organization_id of the writing user; matches the access
--   pattern used by kitting_workflow_settings (308) and kit_build_flags (303).
--
--   No new Supabase Realtime channel — frontend reads via TanStack Query and invalidates on its
--   own mutations. Polling can be added later as a `refetchInterval` if cross-user real-time
--   becomes a requirement, per the project's [[Master Rule]] § Realtime Policy.

CREATE TABLE IF NOT EXISTS "public"."kit_notes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "kit_serial_number" TEXT NOT NULL,
  "organization_id" UUID NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "sender_type" TEXT NOT NULL CHECK ("sender_type" IN ('user', 'system')),
  "sender_user_id" UUID REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL,
  "sender_name" TEXT,
  "body" TEXT NOT NULL CHECK (char_length("body") > 0 AND char_length("body") <= 4000),
  "event_kind" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE "public"."kit_notes"
  IS 'Audit-trail chat thread for the Kit Build Audit Trail (Quick View). One row per typed user message OR in-dialog system event. Append-only.';

COMMENT ON COLUMN "public"."kit_notes"."kit_serial_number"
  IS 'Foreign-link to RR_Kitting_DATA.kit_serial_number — not a hard FK because that column is not unique (snapshot-replicated across every TO row of a kit).';
COMMENT ON COLUMN "public"."kit_notes"."sender_type"
  IS 'user = typed by an operator from the dialog input. system = auto-stamped by a dialog action (flag add/remove, ship-short authorized, kit deleted, etc.).';
COMMENT ON COLUMN "public"."kit_notes"."sender_user_id"
  IS 'auth.users.id snapshot of the sender. NULL for system messages.';
COMMENT ON COLUMN "public"."kit_notes"."sender_name"
  IS 'Snapshot of the sender display name at write time. Snapshotted so the chat reads correctly even after a user is renamed or deactivated.';
COMMENT ON COLUMN "public"."kit_notes"."event_kind"
  IS 'Optional categorization for system messages (e.g. flag_added, flag_cleared, ship_short_authorized, black_hat_panel_authorized). Free-form text for forward compatibility.';

CREATE INDEX IF NOT EXISTS "idx_kit_notes_kit_serial_created"
  ON "public"."kit_notes" ("kit_serial_number", "created_at");

CREATE INDEX IF NOT EXISTS "idx_kit_notes_org"
  ON "public"."kit_notes" ("organization_id");

ALTER TABLE "public"."kit_notes" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- SELECT: any member of the writing user's org can read every note attached to a kit
  --   in that org. (Org scoping mirrors kitting_workflow_settings + kit_build_flags.)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kit_notes'
      AND policyname = 'kit_notes_select_org'
  ) THEN
    CREATE POLICY "kit_notes_select_org"
      ON "public"."kit_notes"
      FOR SELECT
      USING (
        organization_id IN (
          SELECT organization_id
          FROM "public"."user_profiles"
          WHERE id = auth.uid()
        )
      );
  END IF;

  -- INSERT: any member of the same org may append. The service resolves organization_id from
  --   the caller's user_profile so the WITH CHECK is the only enforcement needed.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kit_notes'
      AND policyname = 'kit_notes_insert_org'
  ) THEN
    CREATE POLICY "kit_notes_insert_org"
      ON "public"."kit_notes"
      FOR INSERT
      WITH CHECK (
        organization_id IN (
          SELECT organization_id
          FROM "public"."user_profiles"
          WHERE id = auth.uid()
        )
      );
  END IF;

  -- NO UPDATE / DELETE policy: notes are immutable. A typed message cannot be edited away
  --   (audit-trail invariant). If a kit is later deleted the existing CASCADE on organization
  --   doesn't reach this table by row — operators who want a hard delete should use a future
  --   admin-only redaction tool wired by a separate migration.
END $$;
