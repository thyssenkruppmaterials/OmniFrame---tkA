-- Migration: SAP Audit Log (Phase A3)
-- Date: 2026-04-29
-- Description:
--   Append-only audit trail of every SAP automation outcome (LT12, LT01,
--   LS02N, MM02 storage bin, MM02 storage types, LS01N, ZV26, VL02N,
--   VT01N, etc).
--
--   Rows are written from the *authenticated browser* after every
--   mutation completes (centralised in `logSapAudit()`), so we don't
--   need to hand the agent a Supabase token to enable auditing.
--
--   The existing `sap_transaction_logs` table is per-delivery and
--   shipment-specific. This new table captures every action regardless
--   of whether it's tied to a delivery, normalises the shape across all
--   transactions, and is the source of truth for Phase D #15
--   (reversal / rollback engine).

CREATE TABLE IF NOT EXISTS "public"."sap_audit_log" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "user_id" UUID REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL,
  "transaction_code" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "payload" JSONB,
  "result" JSONB,
  "status" TEXT NOT NULL CHECK (
    "status" IN ('success', 'error', 'warning')
  ),
  "step" TEXT,
  "sap_message" TEXT,
  "sap_message_type" TEXT,
  "agent_version" TEXT,
  "duration_ms" INTEGER,
  "job_id" UUID REFERENCES "public"."sap_agent_jobs"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE "public"."sap_audit_log" IS
  'Append-only audit trail of every SAP automation outcome. Written from the authenticated browser after each mutation. Source of truth for the Phase D rollback engine.';
COMMENT ON COLUMN "public"."sap_audit_log"."transaction_code" IS
  'SAP transaction code (e.g. LT12, LT01, LS02N, MM02, LS01N, VL02N).';
COMMENT ON COLUMN "public"."sap_audit_log"."action" IS
  'High-level handler name (e.g. confirm_transfer_order, material_master_bin, set_bin_blocks).';
COMMENT ON COLUMN "public"."sap_audit_log"."status" IS
  'success | error | warning. Warnings = SAP returned ambiguous status bar.';
COMMENT ON COLUMN "public"."sap_audit_log"."step" IS
  'Step name for partial failures (e.g. "org_levels_popup", "save").';
COMMENT ON COLUMN "public"."sap_audit_log"."job_id" IS
  'Optional link back to sap_agent_jobs.id for queue-driven runs.';

CREATE INDEX IF NOT EXISTS "idx_sap_audit_log_org_created"
  ON "public"."sap_audit_log" ("organization_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_sap_audit_log_org_action"
  ON "public"."sap_audit_log" ("organization_id", "action", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_sap_audit_log_org_status"
  ON "public"."sap_audit_log" ("organization_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_sap_audit_log_user"
  ON "public"."sap_audit_log" ("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_sap_audit_log_job"
  ON "public"."sap_audit_log" ("job_id");

ALTER TABLE "public"."sap_audit_log" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sap_audit_log'
      AND policyname = 'sap_audit_log_select_org'
  ) THEN
    CREATE POLICY "sap_audit_log_select_org"
      ON "public"."sap_audit_log"
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
      AND tablename = 'sap_audit_log'
      AND policyname = 'sap_audit_log_insert_org'
  ) THEN
    CREATE POLICY "sap_audit_log_insert_org"
      ON "public"."sap_audit_log"
      FOR INSERT
      WITH CHECK (
        organization_id IN (
          SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()
        )
      );
  END IF;

  -- Audit log is append-only — no UPDATE / DELETE policies on purpose.
END $$;
