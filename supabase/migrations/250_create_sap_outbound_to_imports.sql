-- Migration: SAP Outbound Transfer-Order Imports (LT22)
-- Date: 2026-04-29
-- Description:
--   Append-only history of LT22 transfer-order imports executed via the
--   on-prem OmniFrame SAP agent. Each row in `sap_outbound_to_imports`
--   represents one open / waiting TO line pulled from SAP, tagged with
--   the import batch + run that produced it. `sap_outbound_to_import_runs`
--   is the per-job ledger used to drive the status pill in the
--   ImportLt22Dialog (queued → running → completed/failed) via Realtime.
--
--   RLS:
--     RLS uses the project's standard `user_profiles.organization_id`
--     lookup against `auth.uid()` (matching `sap_agent_jobs`,
--     `sap_audit_log`, `sap_agents`). The agent itself authenticates
--     with the user's JWT so its INSERT/PATCH calls satisfy the same
--     policy.

-- ───────────────────────────────────────────────────────────────────────
-- 1. sap_outbound_to_imports — append-only TO snapshot rows
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."sap_outbound_to_imports" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,

  "to_number" TEXT NOT NULL,
  "warehouse" TEXT NOT NULL,
  "storage_type" TEXT,
  "status" TEXT,
  "status_code" TEXT,
  "movement_type" TEXT,
  "source_storage_type" TEXT,
  "source_storage_bin" TEXT,
  "dest_storage_type" TEXT,
  "dest_storage_bin" TEXT,
  "material" TEXT,
  "quantity" NUMERIC,
  "unit_of_measure" TEXT,
  "delivery" TEXT,
  "reference_doc" TEXT,
  "created_in_sap" TIMESTAMPTZ,
  "confirmed_in_sap" TIMESTAMPTZ,
  "confirmed_by_sap" TEXT,

  "raw_row" JSONB,
  "import_batch_id" UUID NOT NULL,
  "import_run_id" UUID,
  "imported_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "sap_outbound_to_imports_unique_per_batch"
    UNIQUE ("organization_id", "to_number", "import_batch_id")
);

COMMENT ON TABLE "public"."sap_outbound_to_imports" IS
  'Append-only snapshot of LT22 open / waiting transfer orders pulled from SAP via the on-prem agent. Each batch is one execution of the import; the same TO can appear across multiple batches with the latest snapshot of its state.';

CREATE INDEX IF NOT EXISTS "idx_sap_outbound_to_imports_org_to"
  ON "public"."sap_outbound_to_imports" ("organization_id", "to_number");

CREATE INDEX IF NOT EXISTS "idx_sap_outbound_to_imports_org_warehouse_status"
  ON "public"."sap_outbound_to_imports" ("organization_id", "warehouse", "status");

CREATE INDEX IF NOT EXISTS "idx_sap_outbound_to_imports_org_imported_at"
  ON "public"."sap_outbound_to_imports" ("organization_id", "imported_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_sap_outbound_to_imports_org_batch"
  ON "public"."sap_outbound_to_imports" ("organization_id", "import_batch_id");

ALTER TABLE "public"."sap_outbound_to_imports" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sap_outbound_to_imports'
      AND policyname = 'sap_outbound_to_imports_select_org'
  ) THEN
    CREATE POLICY "sap_outbound_to_imports_select_org"
      ON "public"."sap_outbound_to_imports"
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
      AND tablename = 'sap_outbound_to_imports'
      AND policyname = 'sap_outbound_to_imports_insert_org'
  ) THEN
    CREATE POLICY "sap_outbound_to_imports_insert_org"
      ON "public"."sap_outbound_to_imports"
      FOR INSERT
      WITH CHECK (
        organization_id IN (
          SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()
        )
      );
  END IF;
END $$;


-- ───────────────────────────────────────────────────────────────────────
-- 2. sap_outbound_to_import_runs — per-job ledger
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."sap_outbound_to_import_runs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "triggered_by" UUID REFERENCES auth.users(id),

  "warehouse" TEXT NOT NULL,
  "storage_type" TEXT,
  "show_open_only" BOOLEAN DEFAULT TRUE,
  "show_verified" BOOLEAN DEFAULT FALSE,
  "layout_variant" TEXT,
  "date_from" DATE,
  "date_to" DATE,

  "status" TEXT NOT NULL DEFAULT 'queued'
    CHECK ("status" IN ('queued', 'running', 'completed', 'failed', 'partial', 'canceled')),
  "rows_imported" INTEGER DEFAULT 0,
  "duration_ms" INTEGER,
  "error" TEXT,

  "agent_id" TEXT,
  "job_id" UUID,

  "started_at" TIMESTAMPTZ DEFAULT now(),
  "completed_at" TIMESTAMPTZ
);

COMMENT ON TABLE "public"."sap_outbound_to_import_runs" IS
  'Ledger of LT22 import jobs. UI INSERTs status=queued, the agent PATCHes status=running on claim and completed/failed on finish. Realtime subscription on this table drives the status pill in ImportLt22Dialog.';

CREATE INDEX IF NOT EXISTS "idx_sap_outbound_to_import_runs_org_started"
  ON "public"."sap_outbound_to_import_runs" ("organization_id", "started_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_sap_outbound_to_import_runs_org_warehouse_status"
  ON "public"."sap_outbound_to_import_runs" ("organization_id", "warehouse", "status");

ALTER TABLE "public"."sap_outbound_to_import_runs" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sap_outbound_to_import_runs'
      AND policyname = 'sap_outbound_to_import_runs_all_org'
  ) THEN
    CREATE POLICY "sap_outbound_to_import_runs_all_org"
      ON "public"."sap_outbound_to_import_runs"
      FOR ALL
      USING (
        organization_id IN (
          SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()
        )
      )
      WITH CHECK (
        organization_id IN (
          SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()
        )
      );
  END IF;
END $$;


-- ───────────────────────────────────────────────────────────────────────
-- 3. Realtime publication + REPLICA IDENTITY for run-status streaming
-- ───────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sap_outbound_to_import_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sap_outbound_to_import_runs;
  END IF;
END $$;

ALTER TABLE "public"."sap_outbound_to_import_runs" REPLICA IDENTITY FULL;
