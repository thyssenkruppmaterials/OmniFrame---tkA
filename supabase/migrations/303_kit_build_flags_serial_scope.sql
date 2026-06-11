-- Migration: Scope kit_build_flags by kit_serial_number
-- Date: May 12, 2026
-- Description:
--   Phase 1 of the multi-kit-per-PO cross-link fix. The kit_build_flags
--   table previously enforced uniqueness of an active flag at the
--   kit_po_number granularity, which silently merged independent kits that
--   share a PO (e.g. C47E/4 Gear Box 1 + Gear Box 2 on PO 2010102615).
--   The kit_serial_number column was added out-of-band; this migration
--   completes the move by backfilling unambiguous rows, rebuilding the
--   unique-active rule to include kit_serial_number, and indexing the
--   composite lookup used by addFlagBySerialNumber /
--   clearFlagByTypeBySerialNumber.

-- 1. Make sure the column exists (idempotent — present in production
--    already, but this keeps fresh environments aligned with the schema).
ALTER TABLE "public"."kit_build_flags"
    ADD COLUMN IF NOT EXISTS "kit_serial_number" VARCHAR(100);

COMMENT ON COLUMN "public"."kit_build_flags"."kit_serial_number" IS
    'Kit serial that owns this flag. NULL only for legacy rows whose PO mapped to multiple serials at backfill time and require manual triage.';

-- 2. Backfill kit_serial_number for any row whose kit_po_number maps to
--    exactly one distinct kit_serial_number in RR_Kitting_DATA. Rows
--    whose PO has multiple serials (today: only PO 2010102615) are left
--    NULL on purpose so SREs can split them per-serial manually.
UPDATE "public"."kit_build_flags" AS f
SET kit_serial_number = sub.kit_serial_number
FROM (
    SELECT kit_po_number, MIN(kit_serial_number) AS kit_serial_number
    FROM "public"."RR_Kitting_DATA"
    WHERE kit_serial_number IS NOT NULL
    GROUP BY kit_po_number
    HAVING COUNT(DISTINCT kit_serial_number) = 1
) AS sub
WHERE sub.kit_po_number = f.kit_po_number
  AND f.kit_serial_number IS NULL;

-- 3. Rebuild the active-flag uniqueness constraint to include
--    kit_serial_number. Drop the PO-only index first; then recreate it
--    keyed on (kit_serial_number, flag_type) when the serial is known,
--    and keep a PO-scoped fallback for the legacy NULL-serial rows so
--    duplicate active flags still cannot be inserted at the PO level
--    when the serial cannot be resolved.
DROP INDEX IF EXISTS "public"."idx_kit_build_flags_unique_active";

CREATE UNIQUE INDEX IF NOT EXISTS "idx_kit_build_flags_unique_active_by_serial"
    ON "public"."kit_build_flags"("kit_serial_number", "flag_type")
    WHERE "is_active" = true AND "kit_serial_number" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_kit_build_flags_unique_active_legacy_po"
    ON "public"."kit_build_flags"("kit_po_number", "flag_type")
    WHERE "is_active" = true AND "kit_serial_number" IS NULL;

-- 4. Composite index to keep the per-serial flag lookups
--    (addFlagBySerialNumber / clearFlagByTypeBySerialNumber) fast.
CREATE INDEX IF NOT EXISTS "idx_kit_build_flags_serial_flag_type"
    ON "public"."kit_build_flags"("kit_serial_number", "flag_type");

-- 5. Composite active-by-serial index for the picking gate
--    (verifyKitForPicking checks for an active black-hat per serial).
CREATE INDEX IF NOT EXISTS "idx_kit_build_flags_active_by_serial"
    ON "public"."kit_build_flags"("kit_serial_number", "is_active")
    WHERE "is_active" = true;
