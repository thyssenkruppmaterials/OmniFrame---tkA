---
tags: [type/debug, status/resolved, domain/frontend, domain/backend, kitting]
created: 2026-06-08
---

# Fix: Completed Kit Stuck in Open Work (on-dock, stale status)

## Symptom

`KIT-20260519-001` showed **"Completed"** in the grid Status column but sat in
the **Open Work Kits** tab instead of **Completed Kits**.

## Root cause

The Status column and the tab split used **different completion signals**:

- **Status column** renders the *derived* stage `kit_stage_status`
  ([[Kit-Grid-Derived-Stage-Status]]), which treats **on dock = done** →
  shows "Completed".
- **Tab split** (`isCompletedRow`) keyed off the *raw* `kit_build_status ===
  'completed'`.

DB confirmed the kit is fully on dock (`DOCK-1`), inspected, 3/3 picked +
kitted — but its `kit_build_status` is **`'printed'`**, never flipped to
`'completed'`. (Likely a cover-sheet reprint via `markKitAsPrinted*`
regressed the status after the kit was completed.) So derived = completed,
raw = printed → "Completed" badge but Open Work tab.

Scope: a single kit org-wide is on dock with a non-`completed` status.

## Fix

Make every dashboard surface use the same on-dock-aware completion signal:

- `kitting-data-manager.tsx` — `isCompletedRow` now checks
  `(kit_stage_status ?? kit_build_status) === 'completed'` (mirrors exactly
  what the Status column shows), so any kit displayed as Completed lands in
  the Completed Kits tab.
- `getStatistics` — the **Completed** stat card now counts kits that are on
  dock OR stored `completed` (selects `kit_ready_on_dock_date_time`);
  Pending / In Progress exclude completed kits. Keeps the Completed *card*
  consistent with the Completed *tab*.

## Not done (offered follow-ups)

- **Data backfill** of the 1 stale kit (`'printed'` → `'completed'`) so the
  raw status is correct for non-dashboard consumers (RF, kanban lanes, the
  audit-trail header badge). Not mutated without approval.
- **Guard `markKitAsPrinted*`** so reprinting a cover sheet can't regress an
  on-dock / completed kit's status back to `'printed'` (likely the original
  cause).

## Verification

`tsc -b` clean; ESLint clean. FE + service only, no schema/data change.

## Related
- [[Kit-Grid-Derived-Stage-Status]] — the derived stage shown in the column
- [[Kit-Build-Plan-Completed-Tab]] — the tab split
- [[Kit-Kanban-Inspection-Aware-Progress-And-Dock-Completion]] — "on dock = done"
