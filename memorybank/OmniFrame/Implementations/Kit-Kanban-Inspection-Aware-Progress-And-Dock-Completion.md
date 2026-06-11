---
tags: [type/implementation, status/active, domain/frontend, domain/backend]
created: 2026-05-17
---

# Kit Kanban — Inspection-Aware Progress And On-Dock Completion

## Purpose / Context

Two related UX-correctness gaps surfaced on the **Kit Assembly Board**
after today's [[Optional-Kit-Inspection-Toggle]] +
[[RF-Dock-Staging-Flow]] ships:

1. **The per-card mini progress bar** still rendered five steps —
   `Plan · Pick · Kit · Insp · Dock` — for every kit, even when the
   org runs `kit_inspection_required = FALSE`. The earlier toggle
   work correctly filtered Inspection out of the **dialog-level**
   `KitProductionTracker` timeline, but the **card-level** mini-bar
   on `kit-kanban-board.tsx` still hardcoded all five segments. For
   inspection-disabled tenants the operator's mental model didn't
   match what the workflow actually does.

2. **Kits never auto-moved to the Completed lane after dock
   staging.** [[RF-Dock-Staging-Flow]] correctly moved the on-dock
   stamp into a dedicated scan-driven flow, but the kanban's
   lane-membership logic was never updated. A kit could land at
   `kit_ready_on_dock_date_time IS NOT NULL` and still sit in
   **In Progress** (or **Quality Check**, for inspection-on orgs)
   indefinitely.

This slice fixes both gaps and unifies the lane-completion rule
around a single canonical invariant: **on dock = done**, regardless
of org settings.

## Card-level mini-progress bar — inspection-aware filtering

`src/components/kitting/kit-kanban-board.tsx`:

- `DraggableTask` now reads the org workflow flag through a new
  `kitInspectionRequired: boolean` prop (threaded down from the
  top-level `KitKanbanBoard` via `DroppableColumn`, both memo
  comparators updated). The same `useKitInspectionRequired()` hook
  the dialog already uses is the single source of truth.
- `visibleSteps` is computed inside `DraggableTask` as
  `kitInspectionRequired ? PRODUCTION_STEPS : PRODUCTION_STEPS.filter(s => s.id !== 'inspection')`.
  Both segment loops (the colored dashes and the short-label row)
  iterate over `visibleSteps` instead of the hardcoded constant.
- `getStepIndex(step, visibleSteps)` was extended with an optional
  `visibleSteps` parameter so the active-step lookup returns an
  index that lines up with what's actually rendered.
- A new `remapStepForVisibility(step, kitInspectionRequired)` helper
  collapses `'inspection'` → `'kitting'` when the flag is off. This
  matters because the data layer still stamps
  `kit_inspection_completion_date_time` on the skip-inspection
  branch in `completeKitBuild` (preserved from
  [[Optional-Kit-Inspection-Toggle]] so the production-tracker stage
  calculator stays coherent if the flag is later flipped back ON),
  which causes `KitKanbanService.computeKitProgress` to return
  `currentStep = 'inspection'` for the "build complete, awaiting
  dock staging" state. With Insp filtered out of the visible bar,
  that step would have no segment to highlight; remapping to
  `'kitting'` keeps Kit as the active segment until
  `stageKitToDock` flips the row to `currentStep = 'on_dock'`.

The larger `KitProductionTracker` dialog already omits Inspection
from its vertical timeline via the same hook (shipped in
[[Optional-Kit-Inspection-Toggle]]). After this slice both surfaces
use the same filter source — there is no other `Insp` /
`Inspection` literal in the kanban UI.

## On-Dock = Completed lane — canonical invariant

`RR_Kitting_DATA.kit_build_status` is `text NOT NULL DEFAULT
'pending'` with no CHECK constraint (verified via Supabase MCP
`pg_constraint` query — only `kit_flag_type` and
`part_expedite_delivery_time` have CHECKs). Existing values in the
live DB: `pending`, `printed`, `kit_built`, `kit_inspected`. We
added a fifth value `'completed'` — written exclusively by
`stageKitToDock` so the column itself encodes the terminal state.

### Service-layer changes

- **`src/lib/supabase/rr-kitting-data.service.ts` — `stageKitToDock`**
  - The serial-scoped UPDATE payload now also writes
    `kit_build_status: 'completed'` alongside the existing on-dock
    columns (`kit_ready_on_dock_by_user`,
    `kit_ready_on_dock_date_time`, `kit_dock_location`,
    `updated_at`). WHERE clause is unchanged — still keys on
    `kit_serial_number` only, preserving the
    [[Fix-Build-Kit-Completion-Multi-Kit-PO]] invariant.
  - After the UPDATE succeeds, the method now `await`s
    `KitKanbanService.syncKitProgressFromSerial(serial)` so the
    kanban card flips to the Completed lane on the same
    operator-action round-trip. The sync call is wrapped in a
    try/catch — non-fatal because
    `KitKanbanService.syncAllInProgressTasks` (called on board
    load) catches up on the next refresh tick.

- **`src/lib/supabase/kit-kanban.service.ts` — `syncKitProgressFromSerial`**
  - When the per-serial computed `currentStep === 'on_dock'` (or
    `'completed'`, future-proofing), the method now resolves the
    `column_name = 'completed'` column id, looks up the next
    `position_in_column` (max+1, matching the existing `startKit`
    and `createTask` patterns), and writes both `column_id` and
    `position_in_column` into the same `kit_kanban_tasks` UPDATE
    payload as the regular line-progress counters.
  - The promotion only runs when the task isn't already in the
    Completed column (`task.column_id !== completedColumnId`), so
    repeated syncs are no-ops.
  - The criterion is purely `kit_ready_on_dock_date_time IS NOT
    NULL` — encoded in the existing `computeKitProgress` helper
    (`if (onDock) currentStep = 'on_dock'`). That criterion holds
    in BOTH inspection-on and inspection-off modes because
    `stageKitToDock` is the single writer for that timestamp
    after [[RF-Dock-Staging-Flow]].

### Why criterion = `kit_ready_on_dock_date_time IS NOT NULL`

- The dock-staging form is the only writer of
  `kit_ready_on_dock_*` after the Optional-Kit-Inspection-Toggle
  follow-up correction landed. A kit that arrives in the Completed
  lane has, by construction, been physically scanned at a dock.
- The `kit_build_status = 'completed'` write is a **secondary
  service-layer projection** of the same fact — useful for
  read-only consumers that don't care about timestamps (e.g. the
  Kitting Data Manager grid status badge), but the kanban
  lane-derivation reads `current_step` (which is itself derived
  from the same on-dock timestamp via `computeKitProgress`).
- Inspection-off orgs still flow through `completeKitBuild`
  (status → `kit_inspected`) before they reach `stageKitToDock`.
  That intermediate state stays in the In Progress lane — the
  operator must scan the dock to flip the lane. This matches the
  task brief's explicit verification.

### Backward compatibility — historical on-dock rows

Kits that landed at `kit_ready_on_dock_date_time IS NOT NULL`
before today's slice (i.e. via the old skip-inspection branch in
`completeKitBuild` that pre-dated [[RF-Dock-Staging-Flow]] — those
rows have `kit_dock_location = NULL`):

- The lane criterion is the **timestamp**, not the location
  column. Those rows render in the Completed lane on the next
  `KitKanbanBoard` mount because `fetchData(true)` triggers
  `KitKanbanService.syncAllInProgressTasks`, which iterates every
  task with `current_step !== 'completed'`, recomputes from
  `RR_Kitting_DATA`, and runs the new column-flip logic when
  `currentStep === 'on_dock'`.
- `kit_build_status` on those historical rows stays at its prior
  value (`kit_inspected` etc.) — we deliberately do NOT backfill
  via migration. The kanban derivation keys off the timestamp,
  not the status column, so the lane move still happens. New
  staging events are the ones that flip the status to
  `'completed'`.
- Re-staging is still rejected by
  `verifyKitForDockStaging` with the existing
  `Kit <serial> is already staged on the dock` error (no location
  appendix when `kit_dock_location` is NULL — preserved from
  [[RF-Dock-Staging-Flow]]).

## Files touched

- `src/components/kitting/kit-kanban-board.tsx` — `DraggableTask`
  + `DroppableColumn` thread `kitInspectionRequired` through;
  `visibleSteps` filter and `effectiveCurrentStep` remap drive
  both the segment dashes and the short-label row; both memo
  comparators include the new prop. `getStepIndex` accepts an
  optional `visibleSteps` arg.
- `src/lib/supabase/rr-kitting-data.service.ts` — `stageKitToDock`
  payload gained `kit_build_status: 'completed'`; method now
  also calls `KitKanbanService.syncKitProgressFromSerial` (try /
  catch wrapped, non-fatal).
- `src/lib/supabase/kit-kanban.service.ts` —
  `syncKitProgressFromSerial` now resolves the Completed column
  id and flips `column_id` + `position_in_column` when
  `currentStep === 'on_dock'`.
- `src/lib/supabase/__tests__/kit-serial-scoping.test.ts` —
  `stageKitToDock` test asserts the new
  `kit_build_status: 'completed'` field on the UPDATE payload;
  new `syncKitProgressFromSerial > promotes the kanban card to
  the completed lane when the kit lands on dock` test exercises
  the column-flip path end-to-end (line fetch → task lookup →
  Completed column lookup → position-in-column max → final
  UPDATE asserting `column_id`, `position_in_column`,
  `current_step`).

No new migration. No new Supabase Realtime channel — the kanban
already subscribes to `postgres_changes` on `kit_kanban_tasks`
(grandfathered before 2026-05-06). The Optional-Kit-Inspection
flag travels through the existing `useKitInspectionRequired`
TanStack Query hook with no new fetches.

## Validation

- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm exec eslint src/components/kitting/kit-kanban-board.tsx
  src/lib/supabase/kit-kanban.service.ts
  src/lib/supabase/rr-kitting-data.service.ts
  src/lib/supabase/__tests__/kit-serial-scoping.test.ts` —
  clean.
- `pnpm vitest run src/lib/supabase/__tests__/kit-serial-scoping.test.ts`
  — **25 of 26 passing**. My 1 new test passes; the updated
  `stageKitToDock` test passes; the 14 pre-existing tests still
  pass. The 1 remaining failure is the same
  `createKitBuildPlan kanban link stamp` **pre-existing
  date-bomb** carried in [[RF-Dock-Staging-Flow]] §
  Validation — hardcoded `KIT-20260512-006` vs today's
  `KIT-20260518-001`. Out-of-scope; independently reproducible
  on `git stash`'d main.
- `pnpm build` — succeeds.
  - `kit-kanban-board` chunk: **42.72 KB → 43.02 KB (+0.30 KB)**.
  - `kit-production-tracker` chunk: 28.19 KB (unchanged — no
    edits to that surface; the dialog's stages array filtering
    was already correct from
    [[Optional-Kit-Inspection-Toggle]]).
  - `feature-rf-interface` chunk: **533.97 KB → 547.48 KB
    (+13.51 KB)**, gzip 124.78 KB. The RF chunk pulls in
    `rr-kitting-data.service.ts` for the build / picking / dock
    forms; the new `stageKitToDock` body and the kanban-sync
    import contribute the delta. Pre-existing oversize bucket
    flagged by the bundle gate is unchanged in nature —
    explicitly out-of-scope per [[RF-Dock-Staging-Flow]] §
    Future work ("Bundle trim").

## Don't break

- Every UPDATE keyed by `kit_serial_number`, never PO-keyed —
  preserved by `stageKitToDock` (regression-tested) and by the
  kanban sync helper (which uses `task.id` after a
  per-serial lookup).
- [[RF-Dock-Staging-Flow]] semantics — the only on-dock-stamp
  writer is still `stageKitToDock`. The `kit_build_status`
  flip is layered on top in the SAME UPDATE; no other code path
  writes `'completed'`.
- No new Supabase Realtime channels.
- `feature-rf-interface` chunk policy (oversize, out-of-scope
  per the brief).

## Future work

- **Status enum hardening.** With `'completed'` now a valid
  `kit_build_status` value, a future migration could add a
  CHECK constraint pinning the column to the known set
  (`pending`, `printed`, `kit_built`, `kit_inspected`,
  `completed`). Out-of-scope for this slice (additive change,
  no new constraint authored).
- **Lane-jump on lane drag.** Today an operator can manually
  drag a card into the Completed lane without triggering the
  on-dock stamp. The kanban drag flow stays unchanged, but a
  follow-up could either (a) reject manual drags into
  Completed unless `kit_ready_on_dock_date_time IS NOT NULL`,
  or (b) prompt the operator to confirm the dock location on
  drop. Out-of-scope.
- **Historical row backfill.** If supervisors find old
  pre-RF-Dock-Staging on-dock rows hanging in In Progress
  with stale `current_step` (because the board was never
  opened to trigger `syncAllInProgressTasks`), a one-shot
  backfill RPC would catch them. Acceptable as-is today
  because `syncAllInProgressTasks` runs on every kanban
  mount.

## Related

- [[Optional-Kit-Inspection-Toggle]] — same workflow flag;
  this slice is the card-level counterpart to that slice's
  dialog-level filter.
- [[RF-Dock-Staging-Flow]] — the slice that moved the
  on-dock stamp out of `completeKitBuild`; this slice
  consumes the resulting invariant
  (`kit_ready_on_dock_date_time IS NOT NULL ⇒ done`).
- [[Fix-Build-Kit-Completion-Multi-Kit-PO]] — the per-serial
  scoping invariant preserved verbatim by `stageKitToDock`.
- [[Kitting System - Feature Module]] — parent module overview.
- [[KittingServices - Supabase Service]] — service-layer
  catalogue; the new `kit_build_status: 'completed'` write +
  the `column_id` flip helper should be added there.
- [[Kit-Serial-Scoping]] — the per-serial convention every
  kit mutation now follows; the new lane-promotion logic is
  one more callsite.
- [[Realtime-Policy]] — no new channels were introduced.
