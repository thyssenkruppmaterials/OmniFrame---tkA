-- Migration: Backfill missing kit_definitions prerequisites
-- Date: 2026-03-31
-- Description: Some environments have RR_Kitting_DATA and kit kanban tables
--   but are missing the kit_definitions table and RR_Kitting_DATA.kit_definition_id.
--   This backfill creates the missing definition table, RLS policies, indexes,
--   and linkage column so newer BOM-definition features can run safely.

CREATE TABLE IF NOT EXISTS "public"."kit_definitions" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "organization_id" UUID NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "kit_number" VARCHAR(100) NOT NULL,
  "kit_name" VARCHAR(255) NOT NULL,
  "kit_description" TEXT,
  "kit_version" VARCHAR(50) DEFAULT '1.0',
  "kit_type" VARCHAR(50),
  "kit_category" VARCHAR(100),
  "engine_program" VARCHAR(100),
  "required_components" JSONB DEFAULT '[]'::jsonb,
  "total_components_count" INTEGER DEFAULT 0,
  "assembly_instructions" TEXT,
  "work_instructions_url" TEXT,
  "estimated_assembly_time_minutes" INTEGER,
  "default_kit_cart_color" TEXT,
  "kit_container_type" VARCHAR(50),
  "status" VARCHAR(50) DEFAULT 'active',
  "effective_date" TIMESTAMPTZ,
  "obsolete_date" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ DEFAULT now(),
  "created_by" UUID REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ DEFAULT now(),
  "updated_by" UUID REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL,
  CONSTRAINT "kit_definitions_org_kit_number_key" UNIQUE ("organization_id", "kit_number"),
  CONSTRAINT "kit_definitions_total_components_count_check" CHECK ("total_components_count" >= 0),
  CONSTRAINT "kit_definitions_status_check" CHECK ("status" IN ('draft', 'active', 'obsolete', 'archived'))
);

COMMENT ON TABLE "public"."kit_definitions"
  IS 'Master kit definitions including bill of materials and assembly instructions';

COMMENT ON COLUMN "public"."kit_definitions"."required_components"
  IS 'JSONB array of component objects with materialNumber/incoraReference, quantity, description, and deviations';

CREATE INDEX IF NOT EXISTS "idx_kit_definitions_organization"
  ON "public"."kit_definitions" ("organization_id");

CREATE INDEX IF NOT EXISTS "idx_kit_definitions_kit_number"
  ON "public"."kit_definitions" ("kit_number");

CREATE INDEX IF NOT EXISTS "idx_kit_definitions_status"
  ON "public"."kit_definitions" ("status");

CREATE INDEX IF NOT EXISTS "idx_kit_definitions_kit_type"
  ON "public"."kit_definitions" ("kit_type");

CREATE INDEX IF NOT EXISTS "idx_kit_definitions_engine_program"
  ON "public"."kit_definitions" ("engine_program");

ALTER TABLE "public"."kit_definitions" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kit_definitions'
      AND policyname = 'Users can view kit definitions from their organization'
  ) THEN
    CREATE POLICY "Users can view kit definitions from their organization"
      ON "public"."kit_definitions"
      FOR SELECT
      USING (
        organization_id = (
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
      AND tablename = 'kit_definitions'
      AND policyname = 'Users can insert kit definitions to their organization'
  ) THEN
    CREATE POLICY "Users can insert kit definitions to their organization"
      ON "public"."kit_definitions"
      FOR INSERT
      WITH CHECK (
        organization_id = (
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
      AND tablename = 'kit_definitions'
      AND policyname = 'Users can update kit definitions in their organization'
  ) THEN
    CREATE POLICY "Users can update kit definitions in their organization"
      ON "public"."kit_definitions"
      FOR UPDATE
      USING (
        organization_id = (
          SELECT organization_id
          FROM "public"."user_profiles"
          WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION "public"."update_kit_kanban_updated_at"()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'kit_definitions_updated_at'
  ) THEN
    CREATE TRIGGER "kit_definitions_updated_at"
      BEFORE UPDATE ON "public"."kit_definitions"
      FOR EACH ROW
      EXECUTE FUNCTION "public"."update_kit_kanban_updated_at"();
  END IF;
END $$;

ALTER TABLE "public"."RR_Kitting_DATA"
  ADD COLUMN IF NOT EXISTS "kit_definition_id" UUID REFERENCES "public"."kit_definitions"("id") ON DELETE SET NULL;

COMMENT ON COLUMN "public"."RR_Kitting_DATA"."kit_definition_id"
  IS 'Optional link to the kit definition whose BOM drives coverage and automation logic';

CREATE INDEX IF NOT EXISTS "idx_rr_kitting_data_kit_definition_id"
  ON "public"."RR_Kitting_DATA" ("kit_definition_id");
