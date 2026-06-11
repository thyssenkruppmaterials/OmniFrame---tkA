---
tags: [type/debug, status/resolved, domain/frontend, kitting, priority-ordering]
created: 2026-06-04
---

# Fix Kit Build Audit Trail Priority Mismatch

## Symptom

`KIT-20260518-009` showed **Priority #42** in the Kit Build Audit Trail
dialog (`KitProductionTrackerDialog`) but **#1** on the dashboard grid
(Kit Build Plans → Open Work). Same kit, two different priority numbers.

## Root cause

Two different notions of "priority" were being displayed:

- **Grid + Kanban** show a **position-based** priority: kits are sorted by
  the stored `kit_priority` ascending, then re-labelled `#1, #2, …` by row
  index. `kit-kanban.service.ts` does this deliberately — see its comment
  *"assign sequential position-based priorities ... to ensure consistency
  with the Kitting Data Manager display."*
- **The audit-trail dialog** rendered the **raw stored `kit_priority`**
  (`#{details.priority}`). `kit_priority` is a monotonic sequence assigned
  at creation (`getNextPriority` = `max + 1`) and only renumbered to match
  position when an operator drag-reorders. With completed kits and deletions
  it develops gaps, so the raw value (42) drifts away from the positional
  rank.

The dialog was the **only** surface showing the raw value. Splitting
completed kits into their own tab ([[Kit-Build-Plan-Completed-Tab]])
compressed the Open Work positions (this kit became #1), which made the
pre-existing divergence obvious for this kit.

## Fix

Forward the **already-rendered position** from the surface that opens the
dialog, instead of letting the dialog read the raw column.

- `KitProductionTrackerDialog` gained an optional `displayPriority?: number`
  prop; header now renders `#{displayPriority ?? details.priority}` (falls
  back to the stored value when not supplied).
- `KittingDataGrid.onRowClick` signature widened to
  `(row, displayPriority)` — `SortableRow` / `StaticRow` pass `row.index + 1`
  (the exact `#n` shown in the Priority column).
- `KittingDataManager` tracks `selectedDisplayPriority` from the row click
  and passes it to the dialog.
- Kanban `onQuickView` widened to carry `task.priority` (its position-based
  display value); `KitKanbanBoard` tracks `selectedDisplayPriority` and
  passes it to the dialog.

Result: the dialog mirrors whatever surface opened it (grid Open Work rank,
or kanban global rank), so #1 stays #1.

## Why not renumber the stored column?

Compacting `kit_priority` to be contiguous would be a data migration with
blast radius across RF ordering + kanban + the priority-change audit, and
the positional-display convention already exists app-wide. The display
layer was the correct, low-risk place to reconcile. The raw column is left
as the persisted ordering key.

## Verification

`tsc -b` clean; ESLint clean on touched files (the 5 `flex-shrink-0`
warnings in `kit-kanban-board.tsx` are pre-existing baseline, not added).
Dev server HMR-applied; FE-only, no schema change.

## Related
- [[Kit-Build-Plan-Completed-Tab]] — the tab split that surfaced this
- [[Kit-Number-On-Kanban-Card]] — sibling kanban display-enrichment
- [[Components/Kitting System - Feature Module]]
