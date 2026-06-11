-- Migration: Per-line cancellation on RR_Kitting_DATA
-- Date: 2026-05-21
-- Description: Lets operators cancel an individual Transfer Order line on a kit (e.g. when the
--   line was sent in error, the material was substituted upstream, or the part is being supplied
--   from a different source) without rolling the whole kit back. A cancelled line:
--
--     1. Is rendered in the Kit Build Audit Trail TO Lines table with a muted / line-through
--        treatment and a "Cancelled" pill that surfaces the operator-supplied reason.
--     2. Is excluded from the stage-gating math (`totalLines`, `pickedCount`, `kittedCount`) in
--        both `RRKittingDataService.getKitBuildPlanDetailsBy*` and
--        `KitKanbanService.computeKitProgress`, so the kit can transition Picking → Kitting → On
--        Dock as normal once the remaining live lines complete.
--     3. Is excluded from the `toMaterials` set in `recheckBomCoverageBySerial`, so cancelling
--        the only TO for a required BOM material correctly raises a Black Hat (the material is
--        no longer being delivered to the kit and the operator has to either re-add a TO via
--        [[Add-TO-To-Clear-Black-Hat]] or authorize the line via [[Edit-Ship-Short-Post-Creation-Flow]]).
--     4. Drops a system note in the kit's `kit_notes` audit trail (sender_type = 'system',
--        event_kind = 'to_line_cancelled') capturing who cancelled it, when, and why.
--
--   The four cancellation columns are populated together — a row is either fully cancelled
--   (`cancelled = true` AND the metadata fields are set) or fully not (`cancelled = false`
--   AND the metadata fields are NULL). A CHECK constraint enforces this invariant so a stray
--   service call can't leave the row in a half-cancelled state.

ALTER TABLE "public"."RR_Kitting_DATA"
  ADD COLUMN IF NOT EXISTS "cancelled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "cancelled_by_user" UUID REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "cancelled_reason" TEXT;

-- Enforce all-or-nothing: a cancelled row must carry timestamp + actor + reason; a non-cancelled
-- row must have all three NULL. The reason is required and must be non-empty (operators can't
-- cancel a line without explaining why) — a stripped reason would render as a useless "Cancelled
-- (no reason)" entry in the audit trail.
ALTER TABLE "public"."RR_Kitting_DATA"
  DROP CONSTRAINT IF EXISTS "rr_kitting_data_cancellation_invariants",
  ADD CONSTRAINT "rr_kitting_data_cancellation_invariants" CHECK (
    (
      "cancelled" = TRUE
      AND "cancelled_at" IS NOT NULL
      AND "cancelled_by_user" IS NOT NULL
      AND "cancelled_reason" IS NOT NULL
      AND length(btrim("cancelled_reason")) > 0
    )
    OR (
      "cancelled" = FALSE
      AND "cancelled_at" IS NULL
      AND "cancelled_by_user" IS NULL
      AND "cancelled_reason" IS NULL
    )
  );

-- Partial index for the predominant `WHERE cancelled = false` queries that drive the audit-trail
-- + stage-gating reads. Most rows will be non-cancelled, so a partial index keeps the index small
-- while accelerating the common case.
CREATE INDEX IF NOT EXISTS "rr_kitting_data_active_lines_idx"
  ON "public"."RR_Kitting_DATA" ("kit_serial_number")
  WHERE "cancelled" = FALSE;

COMMENT ON COLUMN "public"."RR_Kitting_DATA"."cancelled" IS
  'TRUE when the operator has cancelled this Transfer Order line. Cancelled lines are excluded from picking/kitting stage progress + BOM coverage but remain visible in the Kit Build Audit Trail TO Lines table for audit history.';
COMMENT ON COLUMN "public"."RR_Kitting_DATA"."cancelled_at" IS
  'Timestamp the line was cancelled. NULL iff cancelled = FALSE (enforced by CHECK constraint).';
COMMENT ON COLUMN "public"."RR_Kitting_DATA"."cancelled_by_user" IS
  'user_profiles.id of the operator who cancelled the line. NULL iff cancelled = FALSE.';
COMMENT ON COLUMN "public"."RR_Kitting_DATA"."cancelled_reason" IS
  'Operator-supplied free-text justification for the cancellation. Required (non-empty) iff cancelled = TRUE. Surfaced as a tooltip on the cancelled-row pill in the Kit Build Audit Trail and stamped into the kit_notes audit-trail thread as a system note (event_kind = to_line_cancelled).';
