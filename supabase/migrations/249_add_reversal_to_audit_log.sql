-- Migration: Add reversal / rollback columns to sap_audit_log (Phase D #15)
-- Date: 2026-04-29
-- Description:
--   Augments the append-only sap_audit_log (migration 246) with the
--   columns the Phase D #15 reversal engine needs:
--
--     * reverses_audit_id — when this row IS the reversal of a previous
--       mutation, points at the original row. Lets us render a clean
--       "this was reversed by …" trail and prevents double-reversal.
--     * reversal_status   — one of:
--         'original'        — a normal mutation, never reversed
--         'reversal'        — this row is itself a reversal of another row
--         'reversed'        — the original was successfully reversed by another row
--         'cannot_reverse'  — the action is irreversible (e.g. LT12 confirm)
--                             OR no prev_state was captured to compute an inverse.
--     * prev_state         — JSONB snapshot of the relevant fields BEFORE
--       the mutation (e.g. {"storage_bin": "OLD-BIN-A-01"} for
--       material_master_bin). Populated by the dry-run preview when
--       available; otherwise NULL and the reversal engine flags the row
--       as "cannot reverse".
--
--   Index strategy:
--     * idx_sap_audit_log_lookup — fast "latest action for transaction X
--       in this org" scans for the reversal browser UI.
--     * idx_sap_audit_log_reverses_audit_id — partial index for cheap
--       "find the reversal row that points at this original" lookups.
--
--   The audit log remains append-only — we DO NOT add an UPDATE policy.
--   The reversal_status of an *original* row needs to flip from
--   'original' → 'reversed' once the inverse runs. That update is done
--   by a controlled SECURITY DEFINER function rather than a broad
--   policy so users can't tamper with arbitrary historical rows.

ALTER TABLE "public"."sap_audit_log"
  ADD COLUMN IF NOT EXISTS "reverses_audit_id" UUID
    REFERENCES "public"."sap_audit_log"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "reversal_status" TEXT
    CHECK ("reversal_status" IN ('original', 'reversal', 'reversed', 'cannot_reverse')),
  ADD COLUMN IF NOT EXISTS "prev_state" JSONB;

COMMENT ON COLUMN "public"."sap_audit_log"."reverses_audit_id" IS
  'When this row IS a reversal of an earlier mutation, the id of that original row.';
COMMENT ON COLUMN "public"."sap_audit_log"."reversal_status" IS
  'original | reversal | reversed | cannot_reverse. NULL on legacy rows pre-Phase-D-#15.';
COMMENT ON COLUMN "public"."sap_audit_log"."prev_state" IS
  'JSONB snapshot of the fields that the reversal engine needs to invert this action (e.g. {storage_bin: prev_value}).';

-- Lookup index for the reversal browser UI: "give me the most recent
-- material_master_bin actions for this organization in the last 24h".
CREATE INDEX IF NOT EXISTS "idx_sap_audit_log_lookup"
  ON "public"."sap_audit_log"
    ("transaction_code", "organization_id", "created_at" DESC);

-- Partial index — most rows have NULL reverses_audit_id; only index
-- the ones that are reversals so we can find them by their original.
CREATE INDEX IF NOT EXISTS "idx_sap_audit_log_reverses_audit_id"
  ON "public"."sap_audit_log" ("reverses_audit_id")
  WHERE "reverses_audit_id" IS NOT NULL;

-- ── Controlled mutator: mark_audit_row_reversed ────────────────────────
--
-- The reversal engine needs to update the *original* row's
-- reversal_status from 'original' → 'reversed' and stash the inverse
-- row's id. Both of those columns live on the audit log, which is
-- append-only by RLS. Rather than open a permissive UPDATE policy we
-- expose a tightly-scoped SECURITY DEFINER function:
--
--   - Caller must belong to the same organization as both rows.
--   - Original row must currently be 'original' or NULL (no
--     double-reversal).
--   - Reversal row must already exist and be flagged 'reversal' with
--     reverses_audit_id pointing at the original (set by the
--     reversal-batch insertion path).
--
-- Returns true if the update was applied, false if the precondition
-- check failed.
CREATE OR REPLACE FUNCTION public.mark_audit_row_reversed(
  p_original_id UUID,
  p_reversal_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_org UUID;
  v_original_org UUID;
  v_reversal_org UUID;
  v_original_status TEXT;
  v_reversal_status TEXT;
  v_reversal_target UUID;
BEGIN
  SELECT organization_id INTO v_caller_org
    FROM public.user_profiles WHERE id = auth.uid();
  IF v_caller_org IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT organization_id, reversal_status
    INTO v_original_org, v_original_status
    FROM public.sap_audit_log WHERE id = p_original_id;
  SELECT organization_id, reversal_status, reverses_audit_id
    INTO v_reversal_org, v_reversal_status, v_reversal_target
    FROM public.sap_audit_log WHERE id = p_reversal_id;

  IF v_original_org IS NULL OR v_reversal_org IS NULL THEN
    RETURN FALSE;
  END IF;
  IF v_original_org <> v_caller_org OR v_reversal_org <> v_caller_org THEN
    RETURN FALSE;
  END IF;
  IF v_original_status IS NOT NULL AND v_original_status NOT IN ('original') THEN
    RETURN FALSE;
  END IF;
  IF v_reversal_status <> 'reversal' OR v_reversal_target <> p_original_id THEN
    RETURN FALSE;
  END IF;

  UPDATE public.sap_audit_log
    SET reversal_status = 'reversed'
    WHERE id = p_original_id;
  RETURN TRUE;
END
$$;

REVOKE ALL ON FUNCTION public.mark_audit_row_reversed(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_audit_row_reversed(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.mark_audit_row_reversed(UUID, UUID) IS
  'Phase D #15 — flip an original audit row''s reversal_status from ''original'' to ''reversed'' once a reversal row has been written. Org-scoped + state-checked so users cannot tamper with unrelated rows.';
