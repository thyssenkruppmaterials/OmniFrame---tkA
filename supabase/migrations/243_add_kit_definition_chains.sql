-- Migration: Add Kit Definition Chains
-- Date: 2026-04-28
-- Description: Allows kit definitions to be linked or chained together when they
--   are meant to be built in order or shipped together. A chain is an
--   organization-scoped collection of kit definitions ordered by sequence.
--   Each kit definition can belong to at most one chain.

-- 1. Chain master table
CREATE TABLE IF NOT EXISTS "public"."kit_definition_chains" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "chain_name" VARCHAR(255) NOT NULL,
  "chain_description" TEXT,
  "link_type" TEXT NOT NULL DEFAULT 'build_order' CHECK (
    "link_type" IN ('build_order', 'ship_together', 'custom')
  ),
  "status" TEXT NOT NULL DEFAULT 'active' CHECK (
    "status" IN ('active', 'archived')
  ),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by" UUID REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_by" UUID REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL,
  CONSTRAINT "kit_definition_chains_org_name_key" UNIQUE ("organization_id", "chain_name")
);

COMMENT ON TABLE "public"."kit_definition_chains"
  IS 'Groupings of kit definitions linked because they are built in order or shipped together.';

COMMENT ON COLUMN "public"."kit_definition_chains"."link_type"
  IS 'Reason kits in this chain are linked: build_order | ship_together | custom.';

CREATE INDEX IF NOT EXISTS "idx_kit_definition_chains_org"
  ON "public"."kit_definition_chains" ("organization_id");

CREATE INDEX IF NOT EXISTS "idx_kit_definition_chains_status"
  ON "public"."kit_definition_chains" ("organization_id", "status");

ALTER TABLE "public"."kit_definition_chains" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kit_definition_chains'
      AND policyname = 'kit_definition_chains_select_org'
  ) THEN
    CREATE POLICY "kit_definition_chains_select_org"
      ON "public"."kit_definition_chains"
      FOR SELECT
      USING (
        organization_id IN (
          SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kit_definition_chains'
      AND policyname = 'kit_definition_chains_insert_org'
  ) THEN
    CREATE POLICY "kit_definition_chains_insert_org"
      ON "public"."kit_definition_chains"
      FOR INSERT
      WITH CHECK (
        organization_id IN (
          SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kit_definition_chains'
      AND policyname = 'kit_definition_chains_update_org'
  ) THEN
    CREATE POLICY "kit_definition_chains_update_org"
      ON "public"."kit_definition_chains"
      FOR UPDATE
      USING (
        organization_id IN (
          SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kit_definition_chains'
      AND policyname = 'kit_definition_chains_delete_org'
  ) THEN
    CREATE POLICY "kit_definition_chains_delete_org"
      ON "public"."kit_definition_chains"
      FOR DELETE
      USING (
        organization_id IN (
          SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

-- Reuse update_kit_kanban_updated_at() helper added in migration 064/210.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'kit_definition_chains_updated_at'
  ) THEN
    CREATE TRIGGER "kit_definition_chains_updated_at"
      BEFORE UPDATE ON "public"."kit_definition_chains"
      FOR EACH ROW
      EXECUTE FUNCTION "public"."update_kit_kanban_updated_at"();
  END IF;
END $$;

-- 2. Chain membership columns on kit_definitions
ALTER TABLE "public"."kit_definitions"
  ADD COLUMN IF NOT EXISTS "chain_id" UUID
    REFERENCES "public"."kit_definition_chains"("id") ON DELETE SET NULL;

ALTER TABLE "public"."kit_definitions"
  ADD COLUMN IF NOT EXISTS "chain_sequence_order" INTEGER;

COMMENT ON COLUMN "public"."kit_definitions"."chain_id"
  IS 'Optional chain this kit definition belongs to (e.g. build order, ship together).';

COMMENT ON COLUMN "public"."kit_definitions"."chain_sequence_order"
  IS 'Position of this kit definition within its chain (lowest first).';

CREATE INDEX IF NOT EXISTS "idx_kit_definitions_chain"
  ON "public"."kit_definitions" ("chain_id", "chain_sequence_order");
