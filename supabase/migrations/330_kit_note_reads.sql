-- Migration: Per-user read tracking for Kit Notes (Kit Build Audit Trail thread)
-- Date: 2026-06-04
-- Description: Backs the "unread message" indicator on the Kit Build Plans grid.
--   `kit_notes` (313) is an append-only, org-scoped thread but had no notion of
--   who has *read* a kit's messages. This adds a per-user, per-kit read
--   watermark (`kit_note_reads`) plus a SECURITY INVOKER helper RPC that returns
--   the kit serials carrying operator notes the calling user hasn't seen yet.
--
--   A kit is "unread" for a user when another operator (sender_type = 'user',
--   sender_user_id <> the reader) posted a note after the reader's last_read_at
--   (or the reader has never opened that kit). System event stamps and the
--   reader's own notes never count as unread.
--
--   No new Supabase Realtime channel — the frontend polls via TanStack Query,
--   per the project's Realtime Policy.

CREATE TABLE IF NOT EXISTS "public"."kit_note_reads" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE,
  "kit_serial_number" TEXT NOT NULL,
  "organization_id" UUID NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "last_read_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "kit_note_reads_user_kit_unique" UNIQUE ("user_id", "kit_serial_number")
);

COMMENT ON TABLE "public"."kit_note_reads"
  IS 'Per-user, per-kit read watermark for the kit_notes audit-trail thread. Drives the unread-message indicator on the Kit Build Plans grid.';

CREATE INDEX IF NOT EXISTS "idx_kit_note_reads_user"
  ON "public"."kit_note_reads" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_kit_note_reads_org"
  ON "public"."kit_note_reads" ("organization_id");

ALTER TABLE "public"."kit_note_reads" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- A user can only read their OWN read watermarks.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'kit_note_reads'
      AND policyname = 'kit_note_reads_select_own'
  ) THEN
    CREATE POLICY "kit_note_reads_select_own"
      ON "public"."kit_note_reads" FOR SELECT
      USING ("user_id" = auth.uid());
  END IF;

  -- A user may create their own watermark; org must match their profile.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'kit_note_reads'
      AND policyname = 'kit_note_reads_insert_own'
  ) THEN
    CREATE POLICY "kit_note_reads_insert_own"
      ON "public"."kit_note_reads" FOR INSERT
      WITH CHECK (
        "user_id" = auth.uid()
        AND "organization_id" IN (
          SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()
        )
      );
  END IF;

  -- A user may advance their own watermark (the upsert's UPDATE branch).
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'kit_note_reads'
      AND policyname = 'kit_note_reads_update_own'
  ) THEN
    CREATE POLICY "kit_note_reads_update_own"
      ON "public"."kit_note_reads" FOR UPDATE
      USING ("user_id" = auth.uid())
      WITH CHECK ("user_id" = auth.uid());
  END IF;
END $$;

-- Returns the kit serial numbers that have an UNREAD operator note for the
-- calling user. SECURITY INVOKER so kit_notes' org-scoped SELECT RLS and
-- kit_note_reads' own-row RLS both apply to the caller.
CREATE OR REPLACE FUNCTION "public"."kit_notes_unread_serials"()
RETURNS TABLE ("kit_serial_number" TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT DISTINCT n."kit_serial_number"
  FROM "public"."kit_notes" n
  LEFT JOIN "public"."kit_note_reads" r
    ON r."kit_serial_number" = n."kit_serial_number"
   AND r."user_id" = auth.uid()
  WHERE n."sender_type" = 'user'
    AND n."sender_user_id" IS DISTINCT FROM auth.uid()
    AND (r."last_read_at" IS NULL OR n."created_at" > r."last_read_at");
$$;

COMMENT ON FUNCTION "public"."kit_notes_unread_serials"()
  IS 'Kit serials with an operator note (sender_type=user, authored by another user) newer than the caller''s read watermark. SECURITY INVOKER — relies on kit_notes + kit_note_reads RLS.';

GRANT EXECUTE ON FUNCTION "public"."kit_notes_unread_serials"() TO "authenticated";
