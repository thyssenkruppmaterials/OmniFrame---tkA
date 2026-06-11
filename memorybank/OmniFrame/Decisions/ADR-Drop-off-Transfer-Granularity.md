---
tags: [type/decision, status/active, domain/database, domain/frontend]
created: 2026-04-22
---
# ADR: Drop-off Transfer Granularity and Associate Identification

## Purpose / Context
Inbound Part Transfer needed two design calls before implementation: how many transfers per TKA batch, and how the accepting associate is identified on the RF.

## Details

### Decision 1 — One transfer per TKA Batch Number (latest wins)
A single TKA batch can back multiple `rr_inbound_scans` rows (several items in one delivery). Rather than forcing operators to transfer every row, we record **one transfer per batch** and surface the latest on the desktop via `v_latest_inbound_part_transfers` (`DISTINCT ON (organization_id, tka_batch_number) ORDER BY dropped_off_at DESC`). Re-transferring a batch inserts a new row — history is preserved and auditable without extra columns, and the three display columns always show the most recent move.

Alternative considered: one transfer per scan row. Rejected — forces the RF to scan each unique row ID (which isn't printed on existing inbound labels) and explodes write volume for large batches without a business driver.

### Decision 2 — Scan associate badge code per area
Associates are configured in the same dialog as the drop-off area they accept for, each with a `badge_code` (unique within the area). The RF requires the associate to scan that badge on step 3, which validates via `findAssociateByBadge(areaId, badge)` against `rr_drop_off_area_associates` with `is_active = true`.

Alternatives considered:
1. Tap-to-pick from a list — rejected because it's easily spoofed by someone just dropping off and tapping anyone's name.
2. Auto-record the current logged-in RF user — rejected because dropped_off_by and accepted_by would be the same user, defeating the "receiving department confirms acceptance" requirement.
3. Pull associate identity from `user_profiles` directly — blocked: `user_profiles` has no badge / employee_id column today, and adding one is out of scope for this feature.

### Consequences
- `rr_drop_off_area_associates` intentionally has an optional `user_id` FK so we can backfill a Supabase-user link later without migration pain, but it's not required and unused by the lookup path.
- Admins must provide the badge code printed on the associate's physical badge; we don't validate against anything else.
- History is preserved forever in `rr_inbound_part_transfers`; a future "transfer history" tab can surface it without schema changes.

### Update (2026-04-22): scan login email QR instead of badge code
After initial review, the user revised decision 2 — associates already carry a lanyard with a QR code containing their login email, so we use that as the authorization token instead of a separately-configured badge code. Migration 233 makes `user_id` required on `rr_drop_off_area_associates`, replaces the `(area, badge_code)` uniqueness with `(area, user_id)`, and rebuilds the latest-transfer view to pull name/email from `user_profiles`. The admin dialog now picks an existing user via a searchable list; the RF scans email at step 3 and validates against the allow-list. `badge_code` / `full_name` remain as optional display fields for teams that also want printed badges.

## Related
- [[Implement-Inbound-Part-Transfer]]