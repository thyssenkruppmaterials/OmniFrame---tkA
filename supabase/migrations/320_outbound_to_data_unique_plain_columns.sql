-- Migration: Outbound TO Data — replace expression unique index with a plain-column UNIQUE constraint
-- Date: 2026-05-19
-- Description:
--   Migration 047 added `idx_outbound_to_data_unique_record` as a UNIQUE INDEX
--   over EXPRESSIONS — `(organization_id, COALESCE(delivery, ''), COALESCE(...))`
--   to make NULLs deduplicate as if they were empty strings.
--
--   The Performance Review fix (2026-05-19) flipped the frontend bulk import
--   from `.insert()` + per-row 23505 retries to
--   `.upsert(..., { onConflict: 'organization_id,delivery,transfer_order_number,material,batch,source_storage_bin', ignoreDuplicates: true })`
--   so PostgREST issues `INSERT … ON CONFLICT (cols) DO NOTHING`.
--
--   PostgreSQL's `ON CONFLICT (cols)` only matches a unique constraint or
--   unique index on EXACTLY those plain columns. It does NOT match the
--   COALESCE expression index, so every clipboard import now fails with:
--     "there is no unique or exclusion constraint matching the ON CONFLICT
--      specification"
--   (Outbound Data Manager → "Import from File" path is completely broken.)
--
--   PG 15+ supports `UNIQUE NULLS NOT DISTINCT`, which treats two NULLs as
--   equal for uniqueness purposes. That gives us the same dedupe semantic
--   the original COALESCE-to-empty-string index was emulating, AND lets
--   `ON CONFLICT (cols)` resolve against the new constraint.
--
--   Behavioral note: the previous index treated `NULL` and `''` as the
--   same value (both COALESCE → ''). The new constraint treats `NULL` and
--   `''` as different. In practice the transform layer (`transformRowToDatabase`
--   in `src/lib/supabase/outbound-to-data.service.ts`) already coerces
--   empty strings to NULL before insert, so production data never has
--   `''` in these columns and the dedupe behavior stays equivalent.
--
--   References:
--     - memorybank/OmniFrame/Debug/Fix-Outbound-Import-OnConflict-Constraint.md
--     - memorybank/OmniFrame/Implementations/Apply-Performance-Review-Fixes-2026-05-19.md
--     - supabase/migrations/047_fix_outbound_duplicates.sql (original index)

BEGIN;

-- ─── 1. Safety dedupe ────────────────────────────────────────────────
-- The old expression index already enforces this semantic, so this is
-- a belt-and-braces step. It only deletes if the new NULLS NOT DISTINCT
-- semantic finds duplicates the old COALESCE semantic missed — which
-- can only happen for rows where one row has `''` and another has NULL
-- in the same column (and the app shouldn't be producing those).
WITH dupes AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        organization_id,
        delivery,
        transfer_order_number,
        material,
        batch,
        source_storage_bin
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.outbound_to_data
)
DELETE FROM public.outbound_to_data
WHERE id IN (SELECT id FROM dupes WHERE rn > 1);

-- ─── 2. Drop the old expression index ────────────────────────────────
DROP INDEX IF EXISTS public.idx_outbound_to_data_unique_record;

-- ─── 3. Add the plain-column UNIQUE constraint (NULLS NOT DISTINCT) ──
-- Using ALTER TABLE … ADD CONSTRAINT (instead of CREATE UNIQUE INDEX)
-- so it shows up in pg_constraint and the supportive backing index
-- gets the canonical naming.
ALTER TABLE public.outbound_to_data
  ADD CONSTRAINT outbound_to_data_unique_record
  UNIQUE NULLS NOT DISTINCT (
    organization_id,
    delivery,
    transfer_order_number,
    material,
    batch,
    source_storage_bin
  );

COMMENT ON CONSTRAINT outbound_to_data_unique_record ON public.outbound_to_data IS
  'Plain-column UNIQUE constraint with NULLS NOT DISTINCT semantic. Replaces the COALESCE expression index from migration 047 so the frontend bulk upsert (onConflict on these columns) can resolve to a real constraint. See migration 320.';

COMMIT;
