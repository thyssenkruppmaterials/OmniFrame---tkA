---
tags: [type/implementation, status/active, domain/database, domain/backend]
created: 2026-05-07
---
# Backfill Final Packed Status — 2026-05-07

## Purpose / Context

Many historical deliveries skipped the [[Outbound Shipping - Feature Module|Final Pack Tool]] step entirely — they went `picked → packed → shipped` and never set `status='final_packed'`, `final_packed_by`, or `final_packed_at`. This left the org's `Final Packed Today` stat understated and broke per-associate productivity attribution for final-pack work.

This note documents the one-time cleanup that ran on 2026-05-07.

## Scope

**Org:** `c9d89a74-7179-4033-93ea-56267cf42a17` (j.AI OneBox)

Two updates ran back-to-back:

### Update 1 — Targeted CSV (`outbound-to-data-2026-05-07.csv`)

- Source: 439 unique deliveries / 442 rows the user provided as a CSV (`Delivery,Status` columns, all rows `shipped`).
- 22 of the 442 already had `status='final_packed'` with `final_packed_by` set → **left untouched** (these were not actually missed).
- **420 rows / 417 distinct deliveries** updated.

### Update 2 — All `shipped` before May 1, 2026 EDT

- Catch-all sweep for everything else: `status='shipped'` AND `shipped_at < '2026-05-01 00:00:00 America/New_York'::timestamptz`.
- **492 rows / 487 distinct deliveries** updated.
- Earliest shipped row swept: 2025-08-21. Latest: 2026-04-28.
- Cutoff intentionally excludes May 1 → 2026-05-07 (124 rows still in `shipped` status — current operations, not missed).

**Combined total:** 912 rows / 904 distinct deliveries / 28 distinct packers credited.

## SQL

Both updates used the same shape, mirroring [[Components/OutboundTODataService - Supabase Service|`OutboundTODataService.completeFinalPacking`]] but substituting `packed_by` for the auth user (since this was a backfill, not an interactive session):

```sql
UPDATE outbound_to_data
SET status = 'final_packed',
    final_packed_by = packed_by,   -- the same person who packed it gets the final-pack credit
    final_packed_at = NOW(),
    updated_at = NOW()
WHERE organization_id = '<org>'
  AND status = 'shipped'
  AND <selector>;
```

`<selector>` was either `delivery IN (...)` (Update 1) or `shipped_at < '2026-05-01 00:00:00 America/New_York'::timestamptz` (Update 2).

## Why `packed_by` as `final_packed_by`?

The outbound lifecycle is `picked → packed → final_packed → shipped`. When the final-pack step gets skipped, the most defensible attribution is the packer — the operation immediately before final pack — because:

1. The packer is the person physically with the box at the moment final-pack would have happened.
2. `OutboundTODataService.updateFinalPackInfo` itself filters `.eq('status', 'packed')` — i.e., the canonical UX runs while the row is in `packed` state, with the packer present.
3. 100% of in-scope rows had `packed_by` populated; we never had to fall back.

If future cleanups hit rows with `packed_by IS NULL`, the next-best attribution would be `shipped_by`, then `picked_by`. None were needed today.

## What this does NOT touch

- `tracking_number`, `requires_8130_3`, `has_8130_3`, `is_8130_3_signed` — left at their existing values (often NULL/false). The interactive Final Pack Tool sets these via `updateFinalPackInfo`, but that path is gated on `status='packed'` and we don't have the data to backfill them anyway.
- Anything `status='shipped'` on/after May 1 — those are current operations, not missed.
- Anything already `status='final_packed'` — including the 22 CSV rows that already had a real `final_packed_by`.

## Triggers / side effects

Only one trigger on `outbound_to_data`: `update_outbound_to_data_updated_at` (BEFORE UPDATE, sets `updated_at`). No status-change triggers, no NOTIFY fanout, no cascade. Safe.

## Verification

Post-run query confirmed:

- 0 rows match `status='shipped' AND shipped_at < 2026-05-01 EDT` → catch-all swept clean.
- 124 rows still in `shipped` status, all with `shipped_at >= 2026-05-01 EDT` → as expected.
- All 904 affected deliveries now show `status='final_packed'` with non-null `final_packed_by` and `final_packed_at`.

## Reproducing this for a future cutoff

The selector pattern works for any cutoff date — bump the `2026-05-01` boundary forward as needed and rerun. All other guardrails (org scope, `status='shipped'`, `packed_by` attribution) stay the same.

## Related

- [[Components/Outbound Shipping - Feature Module]] — describes the canonical Final Pack Tool flow.
- [[Components/OutboundTODataService - Supabase Service]] — the service whose `completeFinalPacking` we mirrored.
- [[Sessions/2026-05-07]] — session log this lands in.
