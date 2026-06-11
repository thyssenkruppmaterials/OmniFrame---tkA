---
tags: [type/implementation, status/active, domain/frontend, domain/realtime]
created: 2026-05-10
updated: 2026-05-10
---

# Implement Work Queue Management Tab — Multi-Operator Dispatcher

## Purpose / Context

New tab on the Inventory Management page (`src/components/inventory-management.tsx`), wedged between **Inventory Counts** (`manual-counts`) and **Operation Control** (`operation-control`). Live multi-operator dispatcher: one column per active operator, each column showing that operator's NOW (current/next task) above their NEXT pipeline.

Follows naturally from the per-operator [[Implement-Operator-Cycle-Count-Queue-Tab]] dialog (2026-05-09) — same task data, same WS variants, same drag library — but generalised to N operators side by side with cross-lane reassignment. The dialog stays mounted on `<LiveOperatorStatus>` for the focused single-operator view; this dispatcher is the broad picture.

User ask (verbatim, 2026-05-10):

> A new tab on the Inventory Management page called "Work Queue Management", sitting between "Inventory Counts" and "Operation Control". It's a live, multi-operator dispatcher view: one column per active operator, each column showing that operator's NOW (current/next task) plus their NEXT pipeline. Tasks animate in when assigned, animate out when completed, can be reordered within a lane via drag, and (where backend supports) reassigned across lanes via drag.

## UX shape

```
  ┌─ tab content (full-bleed, no Card wrapper) ──────────────────────────────┐
  │ Toolbar: search · filter (status) · live status chip · ⟳                │
  ├──────────────────────────────────────────────────────────────────────────┤
  │ NM Nikki M.    │ AF Angela F.   │ JC Jacob C.   │ MS Mike S.    │ ...   │
  │ Busy · 7       │ Idle · 0       │ Busy · 12     │ Online · 3    │       │
  ├──────────────────────────────────────────────────────────────────────────┤
  │ NOW (hero)     │ NOW (empty)    │ NOW (hero)    │ NOW (empty)   │       │
  │ ┌───────────┐  │ ┌───────────┐  │ ┌───────────┐ │ ┌───────────┐ │       │
  │ │ active CC │  │ │ awaiting  │  │ │ active CC │ │ │ Queue     │ │       │
  │ │  emerald  │  │ │ assignmt  │  │ │  emerald  │ │ │ clear     │ │       │
  │ └───────────┘  │ └───────────┘  │ └───────────┘ │ └───────────┘ │       │
  ├──────────────────────────────────────────────────────────────────────────┤
  │ NEXT pipeline  │ NEXT (empty)   │ NEXT pipeline │ NEXT (empty)  │       │
  │ … 5–8 rows     │                │ … virtualised │               │       │
  │ +N more chip   │                │ scrollable    │               │       │
  └──────────────────────────────────────────────────────────────────────────┘
```

Layout uses CSS grid `auto-cols-[minmax(260px,1fr)] grid-flow-col` with `overflow-x-auto`, so wide monitors get every active lane visible at once and laptops scroll horizontally past ~6 lanes. Bumps to `minmax(280px,1fr)` at `sm`.

## Decisions log

### Shell-level WS handler vs per-lane realtime

The existing `useWorkerTasks(workerId, { enableRealtime: true })` (used by the dialog) attaches **one WS handler per visible operator** via `workServiceWs.connect`. Mounting it N times for N lanes would stack N redundant handlers all listening to the same singleton. The dispatcher mounts ONE handler at the shell level via `use-multi-operator-tasks.ts` and uses `useQueries` for the per-operator HTTP fetches with `enableRealtime: false` semantics. The shell handler fans out invalidations to the affected lane(s) per event variant. See [[ADR-Dispatcher-Shell-WS-Handler]] for the full reasoning.

### Cross-lane FLIP: kept (with fallback)

The spec asked for a `layoutId` FLIP on cross-lane drop. Implemented via `<motion.div layout>` on the lane container plus `<AnimatePresence>` on each pipeline list. The lane's existing per-row `<motion.li layout='position'>` interpolates the row from its source slot to its destination slot when the optimistic state flips. We don't use a one-frame shared `layoutId={`task-${countId}`}` because the source/target lanes share the same `<DndContext>` — `AnimatePresence` with `layout='position'` produces the same visual without the brittle one-frame coordination dance. If the FLIP proves janky in practice, the fallback is the spec's spring enter/exit pair on the lane's `<AnimatePresence>` — already in place because the same code path drives a normal arrival and a cross-lane arrival.

### Virtualisation thresholds

`@tanstack/react-virtual` only kicks in when:
- Per-lane: pipeline tasks (`tasks.length - 1` for the NOW slot) exceeds **12**.
- OR globally: total visible tasks across ALL lanes exceeds **110**.

Below either threshold, plain DOM rendering is faster (virtualisation adds ResizeObserver + scroll-measure cost on every paint). Above either threshold, every lane switches to virtual mode for consistency. Tunable via `VIRTUALIZATION_PER_LANE_THRESHOLD` and `VIRTUALIZATION_TOTAL_THRESHOLD` in `constants.ts`.

### Two droppables per lane (`after-now` + `end-of-pipeline`)

The spec called for distinct "Drop after current" and "Drop at end" zones. Implemented as two separate `useDroppable` registrations per lane, encoded in the droppable id (`lane-zone::<workerId>::<after-now|end-of-pipeline>`). The lane shows a dashed emerald hint over whichever zone the supervisor is hovering during a cross-lane drag.

### In-progress tasks: client-side disabled, server-side fallback

In-progress task cards have:
1. Their `useSortable` hook called with `disabled: true` (drag refused at the source).
2. The grip button rendered with `cursor-not-allowed` + dimmed icon + ARIA-labelled "Cannot reassign in-progress task".
3. A defence-in-depth client-side reject in `use-cross-lane-reassign.ts` that surfaces a toast if a programmatic caller bypasses (1) and (2).

We deliberately did NOT auto-release-and-push. The spec called this out as a SHOULD-not-MUST and we agreed: silently releasing a task an operator is mid-execution is a destructive action that needs explicit consent. Release-and-reassign is captured as a follow-up.

### RBAC: migration seed + admin bypass

The `useTabPermissions` hook already grants admin/superadmin every tab via the `isAdminRole` bypass — the new tab works for those roles immediately. Non-admin roles need a `tab_definitions` + `role_tab_permissions` seed. Migration `294_seed_work_queue_management_tab.sql` mirrors migration 256's Operation Control tab seed and grants the new tab to the same supervisor-leaning roles (admin, manager, superadmin, logistics_coordinator). Idempotent via `ON CONFLICT DO UPDATE`. Migration is committed but NOT auto-applied — the user runs it via Supabase MCP when ready.

### Cross-surface localStorage sync (`useOperatorTaskQueueOrder` extension)

The per-operator dialog and the dispatcher lane both render `useOperatorTaskQueueOrder` for the same operator id. A within-lane reorder via the dispatcher's drag context writes to localStorage; the lane's hook needs to re-read so the visual order updates. Added a passive `storage` event listener inside the hook that re-reads when its key changes — also makes multi-tab supervisors stay coherent for free (native cross-tab `storage` events use the same shape). Tiny additive change, low risk.

### `<MotionConfig reducedMotion="user">` at the tab boundary

Wraps the entire tab content. Every spring / transition / glow honours the OS preference automatically without per-component `useReducedMotion` calls. The card-pulse glow is the one place we still gate on `useReducedMotion()` directly — the keyframe array is composed conditionally on the `motion.div` so the loop short-circuits to a static ring instead of animating then snapping.

## File deltas

### Created (under `src/components/work-queue-management/`)

| File | Role |
|---|---|
| `index.tsx` | Page-level component imported by `inventory-management.tsx`. Toolbar, `<MotionConfig>`, `<TooltipProvider>`, `<DispatcherGrid>`, footer help text. |
| `dispatcher-grid.tsx` | Grid shell — owns `useMultiOperatorTasks`, `useCrossLaneReassign`, ghost-lane bookkeeping (`useGhostLaneWorkers`), the WS-disconnect alert banner, and the no-active-operators empty state. |
| `operator-lane.tsx` | Single lane: chrome (operator chip + status + queued count) → NOW hero card → NEXT pipeline (sortable + virtualisable). Owns the two droppables (`after-now`, `end-of-pipeline`). |
| `task-card.tsx` | Pure presentational `<DispatcherTaskCard>` (now / pipeline / overlay variants) + `<DispatcherTaskCardSkeleton>`. |
| `cross-lane-drag-context.tsx` | Single `<DndContext>` for the whole tab. Sensors (PointerSensor 5px, KeyboardSensor), drag overlay with 2deg lift, `aria-live` announce region (700ms throttled), drop resolution branching across `(within-lane vs cross-lane) × (drop-on-task vs drop-on-zone)`. |
| `hooks/use-multi-operator-tasks.ts` | `useQueries` aggregator + shell-level WS handler. Burst-detection ref keyed by worker id. |
| `hooks/use-cross-lane-reassign.ts` | `pushToUser` wrapper with optimistic cache mutation, rollback on error, sonner Undo toast (8s). |
| `constants.ts` | Animation tokens, virtualisation thresholds, undo timeout, re-export of `OPERATOR_TASK_QUEUE_LIMIT`. |
| `types.ts` | Lane state, drag state, encode/decode helpers for sortable + droppable ids. |
| `__tests__/use-multi-operator-tasks.test.tsx` | 4 tests: parallel fetches, one WS handler, targeted invalidation, fan-out for unknown user. |
| `__tests__/use-cross-lane-reassign.test.tsx` | 3 tests: optimistic insert, rollback on error, in-progress refusal. |

### Modified

| File | Change |
|---|---|
| `src/components/inventory-management.tsx` | Added `'work-queue-management'` to `inventoryTabs` (between `manual-counts` and `operation-control`). Added matching `case 'work-queue-management':` in the `useMemo` switch — full-bleed Suspense wrapper, no Card. Added `'work-queue-management'` to the no-wrapper list at line ~165. |
| `src/hooks/use-operator-task-queue-order.ts` | Added a passive `storage` event listener so the hook re-reads when its localStorage key is updated externally (the dispatcher's drag context writes directly + dispatches a synthetic `storage` event). Same listener gives multi-tab supervisors cross-tab sync for free. Existing 12 tests still pass. |

### New SQL migration

| File | Role |
|---|---|
| `supabase/migrations/294_seed_work_queue_management_tab.sql` | Seeds `tab_definitions` + `role_tab_permissions` for `inventory_apps.work-queue-management`. Idempotent. Grants to admin / manager / superadmin / logistics_coordinator. **Not auto-applied** — user runs via Supabase MCP. Until applied, only admin/superadmin see the tab via the role bypass. |

## Animation specs (final)

- **Task arrives in lane** — `framer-motion` spring `{ stiffness: 420, damping: 28, mass: 0.85 }`, `initial: { opacity: 0, x: 12 }`, `animate: { opacity: 1, x: 0 }`. Stagger `0.03 / 0.04` only when `staggerEnter` flag is set on the lane (burst detected within 100ms in the shell-level WS handler).
- **Active / in-progress NOW card** — emerald `ring-1` + animated `boxShadow` glow loop `[0 0 0 0 rgba(16,185,129,0)] → [0 0 0 6px rgba(16,185,129,0.15)] → [0 0 0 0 rgba(16,185,129,0)]` over 2.4s, infinite. Reduced motion: static ring only (gated via `useReducedMotion()`).
- **Task completes / leaves** — `exit: { opacity: 0, y: -8, scale: 0.985 }`, `duration: 0.22s`, ease `[0.4, 0, 0.2, 1]`.
- **Within-lane reorder** — `@dnd-kit/sortable`'s built-in transform/transition. `<motion.li layout='position'>` outer wrapper interpolates position changes. We do NOT also wrap with framer-motion `layout` (full layout) — they fight. Mirrors the `kit-kanban-board.tsx` pattern.
- **Cross-lane reassign** — optimistic cache mutation removes from source lane, appends to target lane. The lane's `<AnimatePresence>` exit + enter combination plays for the source/target rows respectively; the source row fades up, the target row springs in. The grid's parent `<AnimatePresence>` handles lane-level enter/exit for ghost lanes. No explicit `layoutId` shared-element FLIP — see Decisions log.
- **Operator online / offline** — Lane enter `opacity 0→1, y 6→0`, spring `{ stiffness: 320, damping: 30, mass: 1 }`. Offline: stays mounted as a ghost lane (`opacity: 0.35, filter: grayscale(0.5)`) for **6s** before unmounting. Tracked in `useGhostLaneWorkers` (one timer for the soonest-expiring ghost, sweeping setGhosts call).
- **Drag overlay** — `@dnd-kit` `<DragOverlay>` rendering the same `<DispatcherTaskCard variant="overlay">` with `rotate-[2deg] scale-[1.02] shadow-xl`. Source slot dashed-outlined via `outline-2 outline-dashed outline-foreground/30`. Hovered cross-lane target gets `border-emerald-500/40 ring-2 ring-emerald-500/15` (300ms transition).
- **LIVE chip heartbeat** — animated `ping` + emerald palette when WS connected; `WifiOff` icon + amber palette + "Reconnecting…" copy when not.
- **`MotionConfig reducedMotion="user"`** — wraps the entire tab content so descendants honour OS prefer-reduced-motion automatically.

## Data flow

```
           ┌──────────────────────────┐
           │ useActiveWorkers (existing)
           │ — heartbeats poll/WS
           └────────────┬─────────────┘
                        │ workers[]
           ┌────────────▼─────────────┐
           │ <WorkQueueManagementTab>
           │   filter (search/status)
           │   <DispatcherGrid>
           │     useGhostLaneWorkers (offline ghost TTL)
           │     useMultiOperatorTasks
           │       useQueries: per-worker GET /api/v1/workers/:id/tasks
           │       handleWsEvent (one subscription)
           │     useCrossLaneReassign
           │       pushToUser + optimistic cache + Undo toast
           │     <CrossLaneDragContext>
           │       single <DndContext>, shared <DragOverlay>
           │       resolves drop:
           │         within-lane → localStorage write + storage event
           │         cross-lane  → onCrossLaneReassign
           │       <OperatorLane>×N
           │         <SortableContext> per lane
           │         <useDroppable> ×2 per lane
           │         <SortableTaskRow> per task
           │           <DispatcherTaskCard variant='now'|'pipeline'>
           └──────────────────────────┘
```

The `useOperatorTaskQueueOrder` hook is mounted inside `<OperatorLane>` per operator; its `storage` event listener picks up writes from the drag context (same-lane reorders) and from the existing per-operator dialog (cross-surface sync).

## Realtime / policy compliance

- ✅ No new `supabase.channel(...)` callsite in the new feature. Verified via `grep -rn 'supabase\.channel(' src/components/work-queue-management src/hooks/use-operator-task-queue-order.ts` — zero matches outside docstrings.
- ✅ Reuses the existing `workServiceWs` singleton + already-known `WsEvent` variants (`TaskAssigned`, `TaskStatusChanged`, `PushedWork`, `ReservationEscalated`, `WorkerStatusChanged`).
- ✅ Uses already-installed deps (`@dnd-kit/*`, `framer-motion`, `@tanstack/react-virtual`, `lucide-react`, `sonner`, shadcn primitives). **Zero new dependencies.**
- ✅ No `manualChunks` change in `vite.config.ts` (every dep was already pulled in).
- ✅ Honours [[realtime-policy]] in spirit and letter.

## Quality gates (final)

- **`pnpm lint:check`** — clean (0 errors). Repo-wide warning count is 91 (vs 16 baseline) — pre-existing drift, my new files contribute **0** new warnings. Same situation the dialog implementation note documented ("16 vs 93 warnings").
- **`ReadLints`** on every touched/created file — zero diagnostics.
- **`pnpm tsc -b --noEmit`** — clean.
- **`pnpm vitest run src/components/work-queue-management src/hooks/__tests__/use-operator-task-queue-order.test.ts`** — 19/19 passing (12 reorder + 4 multi-operator + 3 cross-lane reassign).
- **`pnpm build`** — clean. `inventory` chunk **218.05 KB raw / 51.25 KB gzip**, well under the 500 KB per-chunk budget. Pre-existing chunks `feature-admin` (998 KB) and `warehouse-location-map` (1523 KB) remain over budget — same pre-existing failures the prior session log documented.
- **`pnpm knip`** — zero unused exports introduced by this feature (after a cleanup pass that demoted internal-only constants and types from `export` to module-private).
- **Lint ratchet** — fails on the same pre-existing drift (91 vs baseline 16) the prior implementation note flagged. Not raised; my changes net warnings DOWN by 2.
- **Realtime policy grep** — clean (0 hits in the new feature directory).

## Open follow-ups

1. ~~**Apply migration `294_seed_work_queue_management_tab.sql`** via Supabase MCP. Until applied, only admin/superadmin see the new tab.~~ ✅ **Applied 2026-05-10 via Supabase MCP** (`apply_migration`, project `wncpqxwmbxjgxvrpcake`). Seeded 1 `tab_definitions` row + 3 `role_tab_permissions` rows (admin / manager / superadmin — `logistics_coordinator` does not exist in `public.roles`, same state as the `operation-control` seed this migration mirrors). No new advisors introduced. See [[Sessions/2026-05-10]] and [[Database-Migration-Workflow]].
2. **In-progress release-and-reassign**. Currently rejected with a toast. Could land as a confirm-modal "Release and reassign" that calls `releaseTask` then `pushToUser`. Captured as SHOULD by the spec.
3. **Bulk supervisor controls**. Per-card action menu (Push to operator / Release / Mark recount) would fit naturally on the dispatcher's lane chrome.
4. **Server-side reorder persistence**. [[ADR-Supervisor-Task-Queue-Reorder-Persistence]] Phase A–D path remains the canonical follow-up — would make the dispatcher's drag-to-reorder authoritative across supervisors and into the operator's RF queue.
5. **Virtualisation threshold tuning**. The 12 / 110 thresholds are educated guesses. If real-world supervisor monitors show the dispatcher above that range often, lower the per-lane threshold so virtualisation kicks in earlier.
6. **Pinning a task**. Supervisor-marked critical task that survives reorders.
7. **Cross-lane FLIP polish**. The current implementation uses `<AnimatePresence>` exit/enter at both source and target. A real shared-element `layoutId` FLIP would interpolate the same DOM node across lanes for a smoother feel. Cost > value for now (the spring enter is already pleasant).
8. **Status filter on the toolbar** — the toolbar has the `<Select>` wired but the dispatcher could also expose zone / work-type filters once those become useful.
9. **Bundle-budget pre-existing failures** (`feature-admin`, `warehouse-location-map`) need their own remediation pass. Not introduced by this feature.

## Manual QA checklist

1. Open Inventory Management → click "Work Queue Management" tab. Should land on the dispatcher with active operators in columns.
2. WS disconnect: kill the rust-work-service or its WS endpoint. The amber "Reconnecting…" alert banner should appear at the top, the LIVE chip should switch to "Reconnecting…", and lanes should keep showing their last-known queue.
3. Reduced motion: enable OS prefer-reduced-motion. The active-card glow should collapse to a static ring; task arrivals/exits should fade only (no slide).
4. Keyboard cross-lane move: focus a draggable card via Tab, press Space to pick up, ArrowLeft/Right to move between lanes, Space to drop. Screen reader should narrate "CC-… moved to <name>".
5. Drop on NOW vs end: drag a card from lane A and hover over lane B's NOW slot — the "Drop after current" hint should appear. Move down to the NEXT pipeline — the "Drop at end" hint should appear.
6. Undo toast: drag a pending task from lane A to lane B, click Undo within 8s. Card should return to lane A (success toast) or surface a failure toast if the second push rejects.
7. In-progress reassign: try to drag an in-progress card. The grip should show `cursor-not-allowed`, the drag should not start, no toast.
8. Ghost lane: have an operator go offline (e.g. close their RF tab). Their lane should fade to ~35% opacity + grayscale, then unmount after 6s.
9. Cross-surface reorder sync: reorder Nikki Mason's queue in the per-operator dialog, then close it and look at the dispatcher — same order should appear. Reorder in the dispatcher, open the dialog — same.
10. Bulk burst: trigger a `push_batch` to one operator. The 2+ tasks should stagger in (~30ms between each); a single push should NOT stagger.

## Internal sub-workers

None — the feature was small enough for a single agent. The data layer (Phase 1) was built first; the lane / drag / dispatcher were built sequentially because they share the `<DndContext>` ownership model and the lane's structure feeds directly into the drag context's drop-zone resolution.

## Related

- [[Implement-Operator-Cycle-Count-Queue-Tab]] — the per-operator dialog this dispatcher complements. Same data, same WS variants, same `useOperatorTaskQueueOrder` hook (now with cross-surface sync).
- [[ADR-Supervisor-Task-Queue-Reorder-Persistence]] — unchanged; the reorder-persistence decision is independent of the surface.
- [[ADR-Dispatcher-Shell-WS-Handler]] — new ADR for the shell-level WS handler vs per-lane decision (this implementation).
- [[Components/LiveOperatorStatus - Real-Time Panel]] — the active operators panel; the dispatcher reuses the same `useActiveWorkers` source and the same priority sort.
- [[realtime-policy]] — honoured by this implementation (zero new `supabase.channel(...)` callsites).
- [[Roadmap-Rust-WS-Unlocks]] — the precedent for adding new `WsEvent` variants if a future feature needs one (we didn't need a new variant — the existing five cover the dispatcher's invalidation needs).
- [[Sessions/2026-05-10]] — today's session log (this implementation appended at the end).
