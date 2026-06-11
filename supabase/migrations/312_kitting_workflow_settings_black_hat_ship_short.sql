-- Migration: Extend kitting_workflow_settings with Black Hat ship-short authorization policy
-- Date: 2026-05-18
-- Description: Adds three boolean policy flags governing how operators may authorize ship-shorts to
--   unblock a Black-Hat-flagged kit:
--     - black_hat_ship_short_authorization_enabled
--         Master switch. When OFF, the new inline Ship-Short authorization panel inside the Kit
--         Build Audit Trail (Quick View) is hidden and only the legacy "Edit Ship Short" power-user
--         button remains. Default TRUE preserves the behaviour shipped on 2026-05-12 in
--         [[Authorized-Ship-Short-Negates-Black-Hat]] / [[Edit-Ship-Short-Post-Creation-Flow]].
--     - black_hat_ship_short_require_justification
--         When TRUE, the per-line description input is mandatory for any authorized line (an empty
--         description blocks the save). When FALSE, justification is optional. Default TRUE because
--         every existing operator workflow uses the description as the audit-trail explanation
--         (e.g. "expedite ETA 2026-05-21", "customer concession #1234").
--     - black_hat_ship_short_require_line_by_line_approval
--         When TRUE, the panel does NOT expose an "Authorize All Missing" bulk action — every
--         missing BOM component must be individually checked + justified by the operator. When
--         FALSE, a single "Authorize All" button can fast-path the full Black Hat list. Default
--         TRUE matches the operator-team intent ("approved line by line for everything that is
--         considered a black hat") captured in the spec.
--
--   All three flags are nullable-with-default so this migration is idempotent and pre-existing
--   rows in the table (orgs that already toggled kit_inspection_required) auto-pick up the
--   defaults without any data migration.
--
--   Sibling to 308_kitting_workflow_settings.sql — same table, same UPSERT-by-organization_id
--   pattern.

ALTER TABLE "public"."kitting_workflow_settings"
  ADD COLUMN IF NOT EXISTS "black_hat_ship_short_authorization_enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "public"."kitting_workflow_settings"
  ADD COLUMN IF NOT EXISTS "black_hat_ship_short_require_justification" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "public"."kitting_workflow_settings"
  ADD COLUMN IF NOT EXISTS "black_hat_ship_short_require_line_by_line_approval" BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN "public"."kitting_workflow_settings"."black_hat_ship_short_authorization_enabled"
  IS 'When false, hides the inline Black-Hat ship-short authorization panel inside the Kit Build Audit Trail. The legacy "Edit Ship Short" button on that dialog still works regardless. Default true.';

COMMENT ON COLUMN "public"."kitting_workflow_settings"."black_hat_ship_short_require_justification"
  IS 'When true, the per-line description input on the Black-Hat ship-short authorization panel is mandatory for any authorized line. When false, justification is optional. Default true.';

COMMENT ON COLUMN "public"."kitting_workflow_settings"."black_hat_ship_short_require_line_by_line_approval"
  IS 'When true, the Black-Hat ship-short authorization panel hides the "Authorize All Missing" bulk button — operators must check + justify each missing BOM line individually. When false, a one-click "Authorize All" path is exposed. Default true.';
