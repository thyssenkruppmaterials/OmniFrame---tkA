---
tags: [type/implementation, status/active, domain/frontend, domain/backend, kitting]
created: 2026-06-07
---

# Kit Grid — Derived Stage Status

## Problem

The Kit Build Plans grid Status column showed the coarse stored
`kit_build_status`, which sits on **"In Progress"** through the entire
picking + kitting span. A kit with picking 30/30 done and kitting not started
still read "In Progress" instead of the actual stage ("Picking Complete").

## Fix

`getKitGridData` now derives a granular **current stage** per kit from the
same per-line progress the audit trail uses, and surfaces it as a new
display-only field `kit_stage_status`.

- While grouping rows by `kit_serial_number`, aggregate per kit:
  `total` (non-cancelled lines), `picked`
  (`kit_to_line_picked_date_time`), `kitted`
  (`kit_to_line_kitted_date_time`), `inspected`
  (`kit_inspection_completion_date_time`), `onDock`
  (`kit_ready_on_dock_date_time`). Added those columns to the local
  `RawKitRecord`.
- `deriveStage(agg, rawStatus)` precedence: on-dock/`completed` → `completed`;
  inspected → `kit_inspected`; all kitted → `kit_built`; some kitted →
  `kitting`; all picked → `picking_complete`; some picked → `picking`; else
  fall back to the raw status (`pending` / `printed`).
- New `kit_stage_status` on `KitGridRecord` + `KittingGridRow`. The raw
  `kit_build_status` is left untouched so the Open/Completed tab split and
  search/sort logic keep working (on-dock ⇔ raw `completed` ⇔ derived
  `completed`, so they stay consistent).

Grid:
- `StatusBadge` gained `picking` (blue), `picking_complete` (sky), `kitting`
  (teal) entries.
- Status column renders `kit_stage_status ?? kit_build_status`.
- Manager search now also matches `kit_stage_status`; CSV export Status
  column uses the derived stage.

## Notes

- Display-only: no schema/data change. The dialog header badge still shows
  raw status but already renders the full Planning/Picking/Kitting/On-Dock
  progress bar beneath it.
- Expedites (single-part, no picking) fall back to their raw status.

## Verification

`tsc -b` clean; ESLint clean. Dev server HMR-applied.

## Related
- [[Kit-Build-Plans-Grid-Reorder-ShipShort-Unread]]
- [[Kit-Kanban-Inspection-Aware-Progress-And-Dock-Completion]] — sibling stage math
