-- Migration: Create per-organization kitting workflow settings table
-- Date: 2026-05-17
-- Description: Org-scoped boolean settings for kitting workflow (kit_inspection_required and future siblings).
--   - One row per organization (UPSERT by organization_id PK).
--   - Default `kit_inspection_required = TRUE` preserves the legacy behaviour for every existing org.
--   - Future siblings (require_build_sheet_print, require_photo_on_completion, etc.) get added as
--     additional boolean columns on this same table — no new table per flag.

CREATE TABLE IF NOT EXISTS "public"."kitting_workflow_settings" (
  "organization_id" UUID PRIMARY KEY REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "kit_inspection_required" BOOLEAN NOT NULL DEFAULT true,
  "updated_by" UUID REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE "public"."kitting_workflow_settings"
  IS 'Per-organization workflow settings for the Kitting Apps surface. One row per org; UPSERT by organization_id.';

COMMENT ON COLUMN "public"."kitting_workflow_settings"."kit_inspection_required"
  IS 'When false, the Inspection stage of the kit lifecycle is bypassed: completeKitBuild jumps straight to kit_inspected + kit_ready_on_dock_*, the Quality Check kanban column and the RF Inspect Kit tile are hidden, and the production tracker timeline omits the Inspection stage. Default true preserves legacy behaviour.';

ALTER TABLE "public"."kitting_workflow_settings" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kitting_workflow_settings'
      AND policyname = 'kitting_workflow_settings_select_org'
  ) THEN
    CREATE POLICY "kitting_workflow_settings_select_org"
      ON "public"."kitting_workflow_settings"
      FOR SELECT
      USING (
        organization_id IN (
          SELECT organization_id
          FROM "public"."user_profiles"
          WHERE id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kitting_workflow_settings'
      AND policyname = 'kitting_workflow_settings_insert_org'
  ) THEN
    CREATE POLICY "kitting_workflow_settings_insert_org"
      ON "public"."kitting_workflow_settings"
      FOR INSERT
      WITH CHECK (
        organization_id IN (
          SELECT organization_id
          FROM "public"."user_profiles"
          WHERE id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kitting_workflow_settings'
      AND policyname = 'kitting_workflow_settings_update_org'
  ) THEN
    CREATE POLICY "kitting_workflow_settings_update_org"
      ON "public"."kitting_workflow_settings"
      FOR UPDATE
      USING (
        organization_id IN (
          SELECT organization_id
          FROM "public"."user_profiles"
          WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION "public"."update_kitting_workflow_settings_updated_at"()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "kitting_workflow_settings_updated_at"
  ON "public"."kitting_workflow_settings";
CREATE TRIGGER "kitting_workflow_settings_updated_at"
  BEFORE UPDATE ON "public"."kitting_workflow_settings"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."update_kitting_workflow_settings_updated_at"();
