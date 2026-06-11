---
tags: [type/debug, status/resolved, domain/frontend, domain/backend, domain/database, kitting]
created: 2026-06-06
---

# Fix Kitting Grid + Stats 1000-Row Cap

## Symptom

The Kit Build Plans grid and the Kit Status stat cards weren't showing all
data — capped at Supabase's default **1000-row** limit. RR_Kitting_DATA has
one row per TO line (part), so a large queue blows past 1000 rows and both
the grid (missing kits) and the stats (under/incorrect counts) were
truncated.

## Root cause

`RRKittingDataService.getKitGridData` (`select('*')`) and `getStatistics`
(`select('kit_serial_number, kit_build_status')` after the prior kits-not-parts
fix) each issued a **single** unscoped select, which PostgREST/Supabase caps
at 1000 rows.

## Fix

Applied the same **range-pagination loop** the inbound-scan
(`inbound-scan.service.ts`) and putaway-log (`putaway-log.service.ts`)
services use to pull a full dataset: fetch 1000-row pages via
`.range(from, to)` until a short page (`hasMore = batch.length === PAGE_SIZE`).

- `getKitGridData`: paginates `select('*')`, secondary sort
  `.order('id', { ascending: true })` after `kit_added_create_date_time` so
  pages stay stable when many rows share the same timestamp. Moved the
  `RawKitRecord` type above the loop.
- `getStatistics`: paginates `select('kit_serial_number, kit_build_status')`
  ordered by the unique `id`.
- Error handling: page-0 error returns the empty/zero result (as before); a
  later-page error breaks and computes from what was already paged in
  (best-effort rather than discarding).

## Verification

`tsc -b` clean; ESLint clean. Service-only change, no schema change. Both the
grid and the stat counts now reflect the full table.

## Related
- `inbound-scan.service.ts` / `putaway-log.service.ts` — the fetch-all pattern reused
- [[Fix-Kit-Status-Stats-Counting-Parts-Not-Kits]] — the immediately-prior stats fix
