---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-04-22
---
# Implement Inbound Part Transfer

## Purpose / Context
Add a dynamic Drop-off Area configuration and a scanner-driven RF workflow so warehouse associates can track where a TKA batch was transferred when it doesn't belong in the inbound area. Also surfaces Drop-off Area / Dropped off by / Accepted by on the desktop Inbound Scan Search without touching the existing CSV export contract.

## Details

### Database (migration 232)
`supabase/migrations/232_create_drop_off_areas_and_transfers.sql` introduces three tables plus one view, all org-scoped with RLS that mirrors existing `rr_*` patterns (`organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())`).

- `rr_drop_off_areas` — id, organization_id, name, barcode (unique per org), description, is_active, display_order, audit cols. Barcode + name uniqueness enforced by constraints.
- `rr_drop_off_area_associates` — id, organization_id, drop_off_area_id FK, full_name, badge_code (unique per area), optional user_id FK → user_profiles, is_active, audit cols.
- `rr_inbound_part_transfers` — append-only history. id, organization_id, tka_batch_number, drop_off_area_id, accepted_by_associate_id, dropped_off_by FK → user_profiles, dropped_off_at, accepted_at, notes. Composite index on (organization_id, tka_batch_number, dropped_off_at DESC).
- `v_latest_inbound_part_transfers` — `DISTINCT ON (organization_id, tka_batch_number)` ordered by `dropped_off_at DESC` with joined area_name, area_barcode, associate_name, associate_badge_code, dropped_off_by_name, dropped_off_by_email.

Realtime is added to `supabase_realtime` publication for all three tables. `updated_at` trigger wired to each. Note: the view is intentionally **not** added to generated `database.types.ts`. Adding it cascaded into ~40 pre-existing `as any` hacks in kit-kanban / kit-definitions / rr-kitting-data services (they rely on the Views section being `[_ in never]: never`). We kept the Views section empty and cast at point of use in the service — this follows the same pattern as `hot-part-alert.service.ts`.

### Services
- `src/lib/supabase/drop-off-area.service.ts` — singleton with `fetchAreasWithAssociates`, CRUD for areas and associates, and the `findAreaByBarcode` / `findAssociateByBadge` lookups used by the RF.
- `src/lib/supabase/inbound-part-transfer.service.ts` — `findScanByBatch` (validate TKA batch exists), `createTransfer` (resolves `auth.uid()` → `organization_id` via user_profiles before insert, mirroring `rfPutawayService.createPutaway`), `fetchLatestTransfersByBatches` (chunked `in(tka_batch_number, ...)` against the view), and `fetchTransfersByBatch` for history.
- `src/lib/supabase/inbound-scan.service.ts` — added `InboundScanWithTransfer = InboundScansWithUser[number] & { latest_transfer?: LatestInboundPartTransfer | null }` plus an `attachLatestTransfers` helper that is applied to `fetchInboundScansPaginated` results on both Supabase and Rust paths. `exportToCSV` and `fetchAllForExport` were left untouched to preserve the existing export contract.

### Hooks
- `src/hooks/use-drop-off-areas.ts` — React Query CRUD + realtime channel on both area tables.
- `src/hooks/use-inbound-part-transfer.ts` — validators (`validateBatch`, `validateAreaBarcode`, `validateAssociateBadge`) and a `submitTransfer` mutation whose `onSuccess` invalidates `inbound-scans-paginated`, `inbound-scans`, and `inbound-statistics` so the desktop table refreshes immediately.
- `src/hooks/use-inbound-scans.ts` — also fixes a pre-existing bug where the realtime handler only invalidated the unused `inbound-scans` key; now it invalidates the paginated key too, and subscribes to `rr_inbound_part_transfers` so transfer-only updates refresh the table.

### UI
- `src/components/inbound-scan-search.tsx` — adds three virtual columns (`drop_off_area`, `dropped_off_by`, `accepted_by`) rendered from the `latest_transfer` field. A `TransferVirtualKey` union + `isTransferVirtualKey` guard keeps the existing sort handler typed correctly. New "Manage Drop-off Areas" item in the More dropdown opens the dialog.
- `src/components/inbound/drop-off-area-manager-dialog.tsx` — two-level CRUD: per-area card with nested associate table, barcode/badge copy-to-clipboard, client-side uniqueness validation, and Switch-based active/inactive.
- `src/features/rf-interface/rf-interface.tsx` — replaces the Drone Control tile (`Gamepad2` icon, `drone-control` view) with an Inbound Part Transfer tile (`ArrowRightLeft` icon, `inbound-part-transfer` view). Drops the `RFDroneControl` import but leaves the component file intact.
- `src/components/ui/rf-inbound-part-transfer-form.tsx` — new RF wizard mirroring `rf-putaway-form.tsx`: 4 steps (TKA Batch → Drop-off Area → Associate Badge → Confirm), 800 ms trailing auto-advance, 1.5 s auto-complete on confirm with Cancel button, focus management, and batch preview (material / tracking / quantity) on the area step.

### Follow-up: accept via user login email QR (migration 233)
The original plan had admins configure a free-text `badge_code` per associate. We replaced that with a stricter model tied to `user_profiles`:

- Migration 233 (`supabase/migrations/233_drop_off_accept_by_user_email.sql`) makes `rr_drop_off_area_associates.user_id` NOT NULL, swaps the FK to `ON DELETE CASCADE`, drops the old `(drop_off_area_id, badge_code)` uniqueness in favor of `(drop_off_area_id, user_id)`, and rebuilds `v_latest_inbound_part_transfers` to pull `associate_name` / `associate_email` from `user_profiles` through the join. `full_name` and `badge_code` are now optional display-only columns.
- `findAssociateByBadge` was replaced by `findAssociateByUserEmail(areaId, email)` in `drop-off-area.service.ts` — it resolves the email via `user_profiles` (org-scoped by RLS) and then checks the allow-list for that area, returning a structured `reason` (`unknown_user` vs `not_authorized`) so the RF can show a useful toast.
- `fetchOrganizationUsers()` was added to the service and is surfaced through `useDropOffAreas().organizationUsers`.
- `DropOffAreaManagerDialog` now shows each authorized associate as `Name + Login Email (QR)` and adds new associates via a shadcn Command-powered user picker over `user_profiles`. Badge code became an optional cosmetic label.
- `rf-inbound-part-transfer-form.tsx` step 3 was updated to scan an email-encoded QR (typed lowercase, `inputMode="email"`). The confirm summary shows the user's full name + email instead of a badge code.
- Inbound Scan Search "Accepted by" column shows the user's name + login email instead of badge code.

## Related
- [[ADR-Drop-off-Transfer-Granularity]]
- [[RF-Putaway-Scanner-Flow]]
- [[Inbound-Scan-Search]]