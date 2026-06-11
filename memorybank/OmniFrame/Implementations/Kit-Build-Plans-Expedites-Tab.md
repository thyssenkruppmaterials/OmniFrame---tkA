---
tags: [type/implementation, status/active, domain/frontend, domain/backend, kitting]
created: 2026-06-06
---

# Kit Build Plans — Expedites Tab + Tab Renames

## Request

On the Kit Build Plans grid (`KittingDataManager`): rename **Open Work** →
**Open Work Kits**, **Completed** → **Completed Kits**, and add a new tab for
the **stand-alone single-part expedites**.

## How stand-alone expedites are identified

`RRKittingDataService.addExpediteToKit` has two modes. Mode 2 (no matching
Kit PO) creates a self-contained `RR_Kitting_DATA` row stamped
`engine_program = 'EXPEDITE'` (`deliver_to_plant = 'Expedite Queue'`,
`kit_po_number = 'EXP-<serial>'`, `kit_number = <part number>`). Mode 1
(append to an existing kit) inherits that kit's `engine_program`, so it is
**not** a stand-alone expedite and correctly stays with its kit. Therefore
`engine_program === 'EXPEDITE'` precisely identifies stand-alone expedites.

These rows already appeared in the grid (one row per serial) — previously
mixed into the Open Work tab. Now they're segregated.

## Changes

`rr-kitting-data.service.ts`: threaded `engine_program` through
`KitGridRecord` + `RawKitRecord` + the `getKitGridData` row mapping
(`engine_program: record.engine_program ?? null`).

`kitting-data-grid.tsx`: added `engine_program: string | null` to
`KittingGridRow`.

`kitting-data-manager.tsx`:
- Tab union widened to `'open' | 'completed' | 'expedites'`.
- Module-scope predicates `isExpediteRow` (engine_program = EXPEDITE) and
  `isCompletedRow` (status = completed). Three memos: `expediteData` (all
  expedites, any status), `openWorkData` (not expedite, not completed),
  `completedData` (not expedite, completed).
- Renamed triggers to **Open Work Kits** / **Completed Kits**; added an
  **Expedites** trigger + read-only grid (`reorderable={false}`, like
  Completed) with its own empty-state copy.
- **Priority-merge fix:** `handlePriorityChange` now merges the reordered
  open-work subset back with all other rows **by id** (was: keep only
  `completed` rows) — otherwise reordering Open Work would have dropped the
  expedite rows from local state until the next fetch.

## Notes / scope

- Expedites tab is read-only — stand-alone expedites are prioritized by their
  delivery-time (critical/24h/2day), and a read-only queue avoids
  cross-tab `kit_priority` renumbering. Easy to make reorderable later.
- Reused the same grid columns (the part number lands in the Kit Number
  column, `EXP-…` in Kit PO). No expedite-specific column layout — out of
  scope for this request.
- The top statistics cards + CSV export still count/export all rows
  including expedites (unchanged — not part of the ask).

## Verification

`tsc -b` clean; ESLint clean. FE + service only, no schema change (the
`engine_program` column already exists). Ships with the next frontend deploy.

## Related
- [[Kit-Build-Plan-Completed-Tab]] — the original tab split
- [[Kit-Build-Plans-Grid-Reorder-ShipShort-Unread]] — the column/grid pass
- [[Kit-BOM-Chains-Expedites-And-INCORA-Component]] — expedite data model
