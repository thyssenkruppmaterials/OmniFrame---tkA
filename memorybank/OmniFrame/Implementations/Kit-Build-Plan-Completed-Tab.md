---
tags: [type/implementation, status/active, domain/frontend, kitting]
created: 2026-06-04
---

# Kit Build Plan Completed Tab

## Purpose / Context

The **Kit Build Plans** table (`KittingDataManager`, surfaced on the Kitting
Apps page) rendered every kit in one drag-to-reorder grid — including kits
that had already reached the dock (`kit_build_status = 'completed'`). With
210+ completed kits in the example org, the open-work queue operators
prioritize against was badly cluttered. Request: move completed kits into
their own tab inside the same card so the open-work list only shows active
plans.

## Solution

Split the single grid into a shadcn `<Tabs>` with two tabs inside the
existing `Kit Build Plans` card body:

- **Open Work** — every kit whose status is not `completed` (drag-to-reorder
  priority preserved, count badge).
- **Completed** — kits stamped `kit_build_status = 'completed'` (the
  canonical "on dock = done" terminal state from
  [[Kit-Kanban-Inspection-Aware-Progress-And-Dock-Completion]] /
  [[RF-Dock-Staging-Flow]]), rendered **read-only** (count badge).

The completed predicate is `kit_build_status?.toLowerCase() === 'completed'`.
`cancelled` was intentionally left in Open Work — the ask was specifically
about *completed* kits, and `completed` is what the `Completed` stat card
already counts.

## Changes

`src/components/ui/kitting-data-grid.tsx` (reusable grid):

- New optional props: `reorderable?: boolean` (default `true`) and
  `emptyMessage?: string` (default unchanged).
- New `StaticRow` (no `useSortable`) for the read-only path so the grid can
  render **outside** a `DndContext` when `reorderable={false}`.
- Return refactored: shared `gridTable` markup; the drag column header +
  grip cell only render when `reorderable`; when not reorderable the grid
  renders the table + a plain `"{n} completed kit(s)"` footer (no drag hint,
  no `DragOverlay`, no priority save indicator).

`src/components/kitting-data-manager.tsx`:

- `activeKitTab` state (`'open' | 'completed'`), `openWorkData` /
  `completedData` memos derived from the existing `filteredData` (search
  still applies across both tabs; the `Completed` stat card + statistics are
  untouched).
- Card body now renders `<Tabs>` → `Open Work` / `Completed` triggers with
  count `<Badge>`s → a `KittingDataGrid` per tab (Completed passes
  `reorderable={false}`).
- **Merge-safe `handlePriorityChange`** — the open-work grid now hands the
  handler only the open-work subset. The old handler did
  `setGridData(reorderedRows...)`, which would have **dropped completed kits**
  from local state until the next fetch. Fixed to splice the reordered
  open-work rows back together with the untouched completed rows:
  `setGridData(prev => [...reorderedWithPriority, ...prev.filter(completed)])`.
  `updatePrioritiesSimple` still receives the open-work subset and renumbers
  it `1..N` internally.

## Notes / Trade-offs

- Radix `TabsContent` unmounts the inactive tab, so each `KittingDataGrid`
  re-initializes its internal `rows` state from fresh `data` on tab switch —
  no stale cross-tab state.
- `More → Export CSV` still exports all `filteredData` (both tabs) — left
  unchanged to avoid surprising the existing global action.
- Completed kits no longer consume priority slot numbers in the open-work
  view (priority is row-index based), which is a side-benefit of the split.

## Verification

`tsc -b` clean; ESLint clean on both touched files. No dev server was
running for a live browser pass; change is FE-only, no schema/migration, no
new Realtime channels.

## Related
- [[Components/Kitting System - Feature Module]]
- [[Kit-Kanban-Inspection-Aware-Progress-And-Dock-Completion]]
- [[RF-Dock-Staging-Flow]]
- [[Kit-Serial-Scoping]]
