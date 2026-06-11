-- Migration: Create kitting dropdown options
-- Date: 2026-03-31
-- Description: Adds an organization-scoped dropdown options table for kitting so
-- engine programs, kit types, kit container types, BOM line container types,
-- and charge codes can be managed in-app instead of being hardcoded.

CREATE TABLE IF NOT EXISTS "public"."kitting_dropdown_options" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "option_group" TEXT NOT NULL CHECK (
    "option_group" IN (
      'engine_program',
      'kit_type',
      'kit_container_type',
      'bom_line_container_type',
      'charge_code'
    )
  ),
  "option_value" TEXT NOT NULL,
  "option_label" TEXT NOT NULL,
  "description" TEXT,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "kitting_dropdown_options_org_group_value_key"
    UNIQUE ("organization_id", "option_group", "option_value")
);

COMMENT ON TABLE "public"."kitting_dropdown_options"
  IS 'Organization-scoped dropdown values used by Kit BOM settings, build plans, and build sheets.';

CREATE INDEX IF NOT EXISTS "idx_kitting_dropdown_options_org_group"
  ON "public"."kitting_dropdown_options" ("organization_id", "option_group");

CREATE INDEX IF NOT EXISTS "idx_kitting_dropdown_options_active"
  ON "public"."kitting_dropdown_options" ("organization_id", "option_group", "is_active");

ALTER TABLE "public"."kitting_dropdown_options" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kitting_dropdown_options'
      AND policyname = 'kitting_dropdown_options_select_org'
  ) THEN
    CREATE POLICY "kitting_dropdown_options_select_org"
      ON "public"."kitting_dropdown_options"
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
      AND tablename = 'kitting_dropdown_options'
      AND policyname = 'kitting_dropdown_options_insert_org'
  ) THEN
    CREATE POLICY "kitting_dropdown_options_insert_org"
      ON "public"."kitting_dropdown_options"
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
      AND tablename = 'kitting_dropdown_options'
      AND policyname = 'kitting_dropdown_options_update_org'
  ) THEN
    CREATE POLICY "kitting_dropdown_options_update_org"
      ON "public"."kitting_dropdown_options"
      FOR UPDATE
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
      AND tablename = 'kitting_dropdown_options'
      AND policyname = 'kitting_dropdown_options_delete_org'
  ) THEN
    CREATE POLICY "kitting_dropdown_options_delete_org"
      ON "public"."kitting_dropdown_options"
      FOR DELETE
      USING (
        organization_id IN (
          SELECT organization_id
          FROM "public"."user_profiles"
          WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION "public"."update_kitting_dropdown_options_updated_at"()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "kitting_dropdown_options_updated_at" ON "public"."kitting_dropdown_options";
CREATE TRIGGER "kitting_dropdown_options_updated_at"
  BEFORE UPDATE ON "public"."kitting_dropdown_options"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."update_kitting_dropdown_options_updated_at"();

CREATE OR REPLACE FUNCTION "public"."seed_kitting_dropdown_options"(p_organization_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "public"."kitting_dropdown_options"
    WHERE organization_id = p_organization_id
      AND option_group = 'engine_program'
  ) THEN
    INSERT INTO "public"."kitting_dropdown_options" (
      organization_id,
      option_group,
      option_value,
      option_label,
      display_order
    )
    VALUES
      (p_organization_id, 'engine_program', '1107C', '1107C', 1),
      (p_organization_id, 'engine_program', '2100D2A', '2100D2A', 2),
      (p_organization_id, 'engine_program', '2100D3 (40/50)', '2100D3 (40/50)', 3),
      (p_organization_id, 'engine_program', '2100D3 (40/50 WGB)', '2100D3 (40/50 WGB)', 4),
      (p_organization_id, 'engine_program', '2100D3 (60/90)', '2100D3 (60/90)', 5),
      (p_organization_id, 'engine_program', '2100D3 (60/90 WGB)', '2100D3 (60/90 WGB)', 6),
      (p_organization_id, 'engine_program', '3007H', '3007H', 7),
      (p_organization_id, 'engine_program', '3007N', '3007N', 8),
      (p_organization_id, 'engine_program', 'A427', 'A427', 9),
      (p_organization_id, 'engine_program', 'B17F', 'B17F', 10),
      (p_organization_id, 'engine_program', 'C20W', 'C20W', 11),
      (p_organization_id, 'engine_program', 'C30HU', 'C30HU', 12),
      (p_organization_id, 'engine_program', 'C47E', 'C47E', 13),
      (p_organization_id, 'engine_program', 'KS4', 'KS4', 14),
      (p_organization_id, 'engine_program', 'Liftfan', 'Liftfan', 15),
      (p_organization_id, 'engine_program', 'Liftworks', 'Liftworks', 16),
      (p_organization_id, 'engine_program', 'MT5S HE+', 'MT5S HE+', 17),
      (p_organization_id, 'engine_program', 'MT7', 'MT7', 18),
      (p_organization_id, 'engine_program', 'RR300', 'RR300', 19);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "public"."kitting_dropdown_options"
    WHERE organization_id = p_organization_id
      AND option_group = 'kit_type'
  ) THEN
    INSERT INTO "public"."kitting_dropdown_options" (
      organization_id,
      option_group,
      option_value,
      option_label,
      display_order
    )
    VALUES
      (p_organization_id, 'kit_type', 'standard', 'Standard', 1),
      (p_organization_id, 'kit_type', 'custom', 'Custom', 2),
      (p_organization_id, 'kit_type', 'promotional', 'Promotional', 3),
      (p_organization_id, 'kit_type', 'emergency', 'Emergency', 4),
      (p_organization_id, 'kit_type', 'sample', 'Sample', 5);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "public"."kitting_dropdown_options"
    WHERE organization_id = p_organization_id
      AND option_group = 'kit_container_type'
  ) THEN
    INSERT INTO "public"."kitting_dropdown_options" (
      organization_id,
      option_group,
      option_value,
      option_label,
      display_order
    )
    VALUES
      (p_organization_id, 'kit_container_type', 'kit_cart', 'Kit Cart', 1),
      (p_organization_id, 'kit_container_type', 'pallet', 'Pallet', 2),
      (p_organization_id, 'kit_container_type', 'flight_case', 'Flight Case', 3);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "public"."kitting_dropdown_options"
    WHERE organization_id = p_organization_id
      AND option_group = 'bom_line_container_type'
  ) THEN
    INSERT INTO "public"."kitting_dropdown_options" (
      organization_id,
      option_group,
      option_value,
      option_label,
      display_order
    )
    VALUES
      (p_organization_id, 'bom_line_container_type', 'in_kit', 'In Kit', 1),
      (p_organization_id, 'bom_line_container_type', 'top_box', 'Top Cardboard Box', 2);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION "public"."seed_kitting_dropdown_options"(UUID) TO authenticated;

DO $$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM "public"."organizations" LOOP
    PERFORM "public"."seed_kitting_dropdown_options"(org_record.id);
  END LOOP;
END $$;
