-- ============================================================================
-- Migration 233: Accept drop-offs via user email QR (from lanyard)
-- Description: Tightens rr_drop_off_area_associates so every allow-list entry
--              references a real user_profiles row. The RF workflow now scans
--              an associate's email-encoded lanyard QR instead of a per-area
--              badge code. badge_code and full_name stay as optional display
--              / label columns for teams that also want printed cards.
-- ============================================================================

-- Remove the old (area, badge_code) uniqueness; badge_code is now optional.
ALTER TABLE public.rr_drop_off_area_associates
  DROP CONSTRAINT IF EXISTS rr_drop_off_area_associates_badge_unique;

ALTER TABLE public.rr_drop_off_area_associates
  ALTER COLUMN badge_code DROP NOT NULL,
  ALTER COLUMN full_name  DROP NOT NULL;

-- Swap user_id FK to ON DELETE CASCADE so removing a Supabase user also
-- removes them from any drop-off allow-lists (no orphaned rows).
ALTER TABLE public.rr_drop_off_area_associates
  DROP CONSTRAINT IF EXISTS rr_drop_off_area_associates_user_id_fkey;

ALTER TABLE public.rr_drop_off_area_associates
  ADD CONSTRAINT rr_drop_off_area_associates_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;

-- Ensure every row ties to a user, and one user can only be added once per area.
ALTER TABLE public.rr_drop_off_area_associates
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.rr_drop_off_area_associates
  ADD CONSTRAINT rr_drop_off_area_associates_area_user_unique
  UNIQUE (drop_off_area_id, user_id);

-- Rebuild the latest-transfer view so the UI can read associate identity from
-- user_profiles (authoritative name + email) instead of the cached cols.
-- DROP first because column order changed (PG can't rename/reorder in CREATE OR REPLACE).
DROP VIEW IF EXISTS public.v_latest_inbound_part_transfers;

CREATE VIEW public.v_latest_inbound_part_transfers AS
SELECT DISTINCT ON (t.organization_id, t.tka_batch_number)
  t.id AS transfer_id,
  t.organization_id,
  t.tka_batch_number,
  t.drop_off_area_id,
  a.name AS area_name,
  a.barcode AS area_barcode,
  t.accepted_by_associate_id,
  assoc.user_id AS associate_user_id,
  COALESCE(assoc_user.full_name, assoc.full_name) AS associate_name,
  assoc_user.email AS associate_email,
  assoc.badge_code AS associate_badge_code,
  t.dropped_off_by,
  up.full_name AS dropped_off_by_name,
  up.email AS dropped_off_by_email,
  t.dropped_off_at,
  t.accepted_at,
  t.notes
FROM public.rr_inbound_part_transfers t
LEFT JOIN public.rr_drop_off_areas a ON a.id = t.drop_off_area_id
LEFT JOIN public.rr_drop_off_area_associates assoc ON assoc.id = t.accepted_by_associate_id
LEFT JOIN public.user_profiles assoc_user ON assoc_user.id = assoc.user_id
LEFT JOIN public.user_profiles up ON up.id = t.dropped_off_by
ORDER BY t.organization_id, t.tka_batch_number, t.dropped_off_at DESC;

GRANT SELECT ON public.v_latest_inbound_part_transfers TO authenticated;

COMMENT ON COLUMN public.rr_drop_off_area_associates.user_id IS
  'Required FK to user_profiles. RF scans the associate''s email-encoded QR (lanyard) to authorize acceptance.';
COMMENT ON COLUMN public.rr_drop_off_area_associates.badge_code IS
  'Optional label/printed badge code. Not used for RF acceptance (use the user_profiles email QR instead).';
COMMENT ON COLUMN public.rr_drop_off_area_associates.full_name IS
  'Optional display override. Leave NULL to always show user_profiles.full_name.';
