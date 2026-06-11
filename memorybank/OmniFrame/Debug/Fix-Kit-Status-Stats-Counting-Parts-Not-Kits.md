---
tags: [type/debug, status/resolved, domain/frontend, domain/backend, kitting]
created: 2026-06-06
---

# Fix Kit Status Stats Counting Parts Not Kits

## Symptom

The Kitting Apps **Kit Status** stat card (Pending / In Progress) — and the
**Completed** card — showed inflated numbers (e.g. Pending 356, In Progress
114, Completed 406) that were far larger than the actual kit counts in the
grid. They were counting **parts (TO lines), not kits**.

## Root cause

`RRKittingDataService.getStatistics` selected only `kit_build_status` and did
`records.filter(status === X).length`. But `RR_Kitting_DATA` holds **one row
per TO line (part)**, and a kit has many lines — so the filter counted line
items, not kits.

## Fix

Select `kit_serial_number, kit_build_status` and count **distinct
kit_serial_number per status** (`countKitsByStatus`). `kit_build_status` is
snapshot-replicated across every row of a kit (status updates write to all
rows of a serial), so distinct-serial counting is exact. Pending /
In Progress / Completed now report kits.

`totalRecords` was intentionally left as a row count — the "Total kit records"
card reports total line items; the "Kit PO Numbers / Unique kit build plans"
card already shows the kit count (`gridData.length`).

Stand-alone expedites count as 1 kit each (one serial, one part), which is
correct.

## Verification

`tsc -b` clean; ESLint clean. Service-only change, no schema change. Counts
refresh on the existing `getStatistics` fetch / realtime refresh.

## Related
- [[Kit-Build-Plan-Completed-Tab]]
- [[Kit-Build-Plans-Expedites-Tab]]
