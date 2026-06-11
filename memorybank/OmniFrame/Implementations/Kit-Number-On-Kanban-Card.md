---
tags: [type/implementation, status/active, domain/frontend, domain/backend, kitting]
created: 2026-06-01
---

# Kit Number On Kanban Card

## Purpose / Context

On the **Kit Assembly Board** (`KitKanbanBoard`) each card showed the
kit serial + PO in the title and the **build number** ("Kit: {build #}"),
but never the human-readable **kit number** — the descriptive identity
operators actually use (e.g. `424 Inlet #1`, `414 Rotor 2`, `T-56 TL-A`).
Request: surface the kit number on every card, rendered as
`Kit {kit_number}` (the user's "Kit 10 - Inlet" example — the
`kit_number` value already embeds the descriptor like "Inlet").

## Key constraint — kit_number is not on kit_kanban_tasks

The live `kit_kanban_tasks` table has **no** `kit_number` column (verified
via Supabase MCP — only `kit_serial_number`, `kit_po_number`,
`kit_build_number`, progress counters, etc.). `kit_number` lives only on
`RR_Kitting_DATA`. So the board must **enrich** kanban tasks from
`RR_Kitting_DATA`, keyed by `kit_serial_number` per [[Kit-Serial-Scoping]]
(no PO fallback — POs can host multiple kits with different kit numbers).

The `KitKanbanTask` / `KitTask` types already carried an (unused)
`kitNumber?` field, so no type plumbing was needed end-to-end.

## Changes

`src/lib/supabase/kit-kanban.service.ts`:

- `getTasksByColumn()` — batch-fetches `kit_number` from `RR_Kitting_DATA`
  for all card serials into a `Map<serial, kit_number>` (mirrors the
  existing Black-Hat batch fetch), then stamps `uiTask.kitNumber` in the
  transform loop. Covers initial load, `silentRefresh`, and sync refresh.
- New `getKitNumberBySerial(serial)` — single-serial lookup used by the
  realtime INSERT handler (the realtime payload can't carry `kit_number`).

`src/components/kitting/kit-kanban-board.tsx`:

- Card renders a `Kit {task.kitNumber}` line under the title/priority
  header (new `Boxes` lucide icon, `shrink-0` not `flex-shrink-0` to keep
  the lint ratchet flat).
- `DraggableTask` memo comparator now compares `task.kitNumber`.
- **Realtime preservation:** `kit_number` doesn't change over a kit's
  lifecycle but isn't in the `kit_kanban_tasks` realtime payload, so:
  - `handleTaskUpdate` carries forward the enriched `kitNumber` from the
    card already in state (`merged` task) so progress/lane updates don't
    blank it.
  - `handleTaskInsert` calls `getKitNumberBySerial` and patches the new
    card once the value resolves.

## Verification

- `tsc -b` clean; ESLint clean (only pre-existing `flex-shrink-0`
  warnings, none added).
- `kit-serial-scoping.test.ts`: 25 pass. The 1 failing test
  (`createKitBuildPlan … stamps kanban_task_id by kit_serial_number`) is
  **pre-existing and date-dependent** — `generateKitSerialNumber` resets
  the daily counter, so on any day ≠ the mocked `2026-05-12` it returns
  today's `KIT-YYYYMMDD-001`. Confirmed identical failure with my changes
  stashed. Out of scope.

## Deploy

FE + service-layer only (no schema change, no migration) — ships with the
next frontend deploy.

## Related
- [[Components/Kitting System - Feature Module]]
- [[Kit-Serial-Scoping]]
- [[Kit-Kanban-Inspection-Aware-Progress-And-Dock-Completion]]
