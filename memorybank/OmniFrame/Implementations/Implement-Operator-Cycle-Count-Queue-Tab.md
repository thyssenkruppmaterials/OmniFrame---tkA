---
tags: [type/implementation, status/active, domain/frontend, domain/realtime]
created: 2026-05-09
updated: 2026-05-09
---

# Implement Operator Cycle-Count Queue (`<OperatorTaskQueueDialog>`)

> **Surface change — 2026-05-09 PM.** This feature originally
> shipped as a third "Up Next" peer tab on `<LiveOperatorStatus>`.
> Same-day refactor swapped the surface to a **click-to-open
> dialog** scoped to a single operator (the operator card on Tab 1
> "On Counts" is now clickable). The behaviour underneath — drag-
> to-reorder list of the next 12 cycle-count tasks, real-time
> invalidation via `workServiceWs`, per-operator `localStorage`
> persistence — is **unchanged**. The persistence ADR
> ([[ADR-Supervisor-Task-Queue-Reorder-Persistence]]) does not need
> to change either; the decision is independent of the surface.
> The note is kept at its original filename so existing backlinks
> (`[[Implement-Operator-Cycle-Count-Queue-Tab]]`) keep resolving.

## Purpose / Context

Supervisor view of one operator's next ~12 cycle-count tasks,
opened by clicking the operator's card on the **Active Operators**
panel inside the Inventory Counts surface. Same-day evolution of
[[Implement-LiveOperatorStatus-InBuilding-Tab]] (Tab 2 — "In
Building") and [[Re-Enable-CurrentPage-In-ActiveOperators]] (Tab 1
— "On Counts"). Adds a **per-operator task-queue dialog** so a
supervisor can drill into a specific operator's queue with one
click, drag-to-reorder, and close — without losing their seat in
the panel layout.

User ask (verbatim, refactor pass):

> instead of having an up next tab, let's go ahead and do this.
> When looking at the on counts tab, clicking on Nikki Mason
> should pop up a dynamic, fluid dialogue that allows you to do
> all that functionality in the up next tab into that pop-up
> dialog. Please make this extremely fluid and dynamic, with a
> nice transition opening and closing.

## UX shape

```
  ┌─ On Counts (3) · In Building (5) ────────────────────────────┐
  │                                                              │
  │  ┌────────────────────────┐ ┌────────────────────────┐       │
  │  │ NM   Nikki Mason  ●   │ │ JR   Joe Ramirez  ●   │  ←   │
  │  │     K3-73-B2-1 cycle  │ │     RL-46-F-01 cycle  │  cards│
  │  │     on Cycle Count     │ │     on Cycle Count     │  click│
  │  └────────────────────────┘ └────────────────────────┘  to    │
  │  ┌────────────────────────┐                              open │
  │  │ MS   Mike Smith   ●   │                              dialog│
  │  │     idle               │                                    │
  │  └────────────────────────┘                                    │
  └──────────────────────────────────────────────────────────────┘
                              │  click
                              ▼
  ┌─ Nikki Mason ───────────────────────────────────────────  ✕ ┐
  │  Up next — drag to reorder this supervisor view of the      │
  │  operator's pending and in-progress cycle counts.           │
  ├─────────────────────────────────────────────────────────────┤
  │  Showing 12 of 38 tasks · +26 more in backlog · ⧗ Updating… │
  │                                       [✨ Custom order] [↻] │
  ├─────────────────────────────────────────────────────────────┤
  │  ⠇ [01]  CC-20260509-0001 · ● Critical                     │
  │           K1-60-02-2 · K1 · 60                              │
  │           ◼ 10025438 · ROCKER ARM ASSY                12 EA│
  │  ⠇ [02]  CC-20260509-0014 · ● Hot · [Recount]              │
  │           M2-22-04-1 · M2 · 22                              │
  │           ◼ 10027120 · BEARING THRUST                  1 EA│
  │  ⠇ … (up to 12 rows total)                                  │
  └─────────────────────────────────────────────────────────────┘
```

### Operator card affordance (Tab 1 "On Counts")

Each `<OperatorCard>` is now a `role="button"` element with
`tabIndex={0}`, an `aria-label="Open queue for {name}"`, a keyboard
handler that mirrors native button activation (Enter / Space, with
`preventDefault` on Space so the page doesn't scroll), and a hover
treatment (`hover:-translate-y-0.5 hover:shadow-md`). On focus it
gets a visible `focus-visible:ring-2 ring-ring/60` so keyboard
navigators see the affordance. Tab 2 ("In Building") cards are
**deliberately NOT clickable** — those users aren't on counts so
their queue would always be empty; opening a dialog on them would
just frustrate the click affordance.

### Dialog content

- **Header**: operator full name + a sub-title ("Up next — drag
  to reorder this supervisor view…"). Uses shadcn's `<DialogTitle>`
  + `<DialogDescription>` so screen readers announce both.
- **Status row**: "Showing N of M tasks · +K more in backlog ·
  ⧗ Updating…" — same shape as the original tab body.
- **Reorder controls**: `[✨ Custom order]` pill (only when a
  custom order is active) + `[↻ Reset]` ghost button. The pill
  has the same explanatory tooltip as before.
- **Sortable task list**: up to 12 cards (`OPERATOR_TASK_QUEUE_LIMIT`).
  Each card carries: drag handle, position chip, count number,
  priority badge (red/orange/blue/slate), `In Progress` / `Recount`
  / `Pushed` status chips, location + zone·aisle, material +
  description, system qty + UoM. Same primitives as before;
  swapped from `<ul>` to a framer-motion `<motion.ul>` with
  `staggerChildren: 0.025` + `delayChildren: 0.05` so the cards
  fade-in (opacity 0 → 1, y 6 → 0, ~180ms each). Total reveal
  time for 12 cards: ~0.5s.
- **Footer caption**: identical to the prior tab — explains the
  reorder is supervisor-side only (the operator's RF still claims
  in canonical priority order).
- **Empty / loading / error states**: same affordances as the
  prior tab (3 skeleton cards, dashed-border empty row, amber
  alert with Retry).

### Decision: dialog vs side panel vs inline expand

**Dialog won.** The supervisor's mental model the user described —
"clicking on Nikki Mason should pop up... that operator's queue" —
matches the modal mental model: take a focused look at one thing,
then dismiss. A side panel would:

- Compete with the existing card grid for horizontal space.
- Force the supervisor to choose between seeing the operator list
  AND the queue (panel collapses one column to fit) or seeing
  just one (panel takes full width). The dialog overlays cleanly.

Inline-expand (a row that grows beneath the clicked card) would:

- Reflow the card grid every time, breaking the supervisor's
  spatial memory of where each operator is.
- Constrain the queue width to one card's column.

### Decision: drop the in-dialog operator selector

The pre-refactor tab body had a `<Select>` dropdown at the top of
the panel because the tab was always mounted; the supervisor had to
pick an operator. With click-to-open, the operator is **implied**
by which card was clicked — keeping the dropdown would conflict
with the implicit-operator mental model and add visual clutter to
an already focused dialog. The trade-off vs. "keep it as a switch-
operator picker" is small (one extra click — close, click another
card) but the simpler model wins. The dialog title shows the
operator name so there's no "which operator am I looking at?"
ambiguity.

## Animation choices

**Library — Framer Motion**. Already a dep (`framer-motion@12.23.12`),
used in 60+ files in this codebase including `rf-empty-location-
material-dialog.tsx` which sets the canonical pattern of "shadcn
`<Dialog>` outer wrapper + framer-motion `<motion.div>` /
`<AnimatePresence>` for inner content". `framer-motion` is
explicitly NOT safe to split into a vendor chunk (see
`Context/Build-Configuration.md`) — the inventory chunk already
includes it via other sibling components, so the bundle delta is
effectively zero (verified — see Quality Gates below).

**Dialog mount/unmount**: shadcn's `<DialogContent>` ships with
`data-[state=open]:animate-in data-[state=closed]:animate-out
fade-in-0 zoom-in-95 fade-out-0 zoom-out-95 duration-200` baked
in — fade + scale 0.96 → 1.0 on open over 200ms, reverse on close.
This matches the user's spec ("slight scale-in + fade on open,
scale-out + fade on close") so we **didn't** override the wrapper's
animation. Radix's `Presence` defers the unmount until the exit
animation finishes, so the body's WS subscription cleanup happens
at the right moment.

**Inner list stagger (the polish)**: the task list reveals item-
by-item via framer-motion's `staggerChildren` + `delayChildren`.
`<motion.ul>` `variants` declares a parent transition that staggers
each `<motion.li>` by 25ms with a 50ms initial delay. Each item
animates `opacity 0 → 1, y 6 → 0` over 180ms with `easeOut`. Total
reveal time for 12 items: ~0.5s — feels like a polished sweep
rather than a flash. Honours `prefers-reduced-motion` via
`useReducedMotion()` (zero stagger / zero delay / zero translate
for reduced-motion users; the visual outcome is identical, just
instant). After the initial reveal, items don't re-animate on
drag — `@dnd-kit/sortable` owns the per-item transform/transition
during drag, so the framer-motion variants stay at `visible`
throughout.

**Origin-from-card animation — skipped**. The shadcn primitive
uses absolute center positioning (`fixed top-[50%] left-[50%]
translate-x-[-50%] translate-y-[-50%]`); pinning the dialog's
transform-origin to the clicked card's bounding rect means
overriding the absolute centring AND threading the rect through
from the card to the dialog AND keeping it in sync on resize.
Cost > value vs. the already-pleasant Radix center scale. Captured
as a follow-up — easy to add later by wrapping the dialog content
in a `<motion.div>` with a measured `originX`/`originY` if a UX
study ever asks for it.

**Card hover treatment**: the operator card gets
`hover:-translate-y-0.5 hover:shadow-md` on hover and
`active:translate-y-0` on click for a subtle press feedback. Pure
Tailwind (no JS) — costs nothing. The translate is small enough
(2px) that it doesn't disturb the grid layout.

## Data source — real backend, no stub (unchanged)

The Rust route already exists. No new endpoint, no migration:

| Route | Owner | Returns |
|---|---|---|
| `GET /api/v1/workers/:id/tasks` | `rust-work-service::api::routes::workers::get_worker_tasks` | `Vec<CycleCountTask>` for `assigned_to = $worker AND organization_id = $org AND status IN ('pending', 'in_progress', 'recount')` |

ORDER BY clause (canonical priority, see
`rust-work-service/src/db/queries.rs:1260+`):

1. `priority` (`critical=1, hot=2, normal=3, low=4`)
2. `pushed_at DESC NULLS LAST`
3. `resolution_source IS NULL/'unresolved' last`
4. `resolved_zone, resolved_aisle, resolved_sequence ASC`
5. `location ASC`, `assigned_at ASC`

Authorisation: route allows the worker to view their own tasks OR
a supervisor with `*` / `*manage*` / `*supervisor*` permission.
Inventory Counts already RBAC-gates this surface via
`view inventory_apps`, so the supervisor caller hits the supervisor
branch.

The FE consumer is `useWorkerTasks(workerId, { enableRealtime: true })`
(extended in this pass — same shape as before).

## Realtime strategy — scoped to dialog open lifetime

**Honours [[realtime-policy]]** — no new `supabase.channel(...)`
callsite. The existing singleton `WorkServiceWebSocket`
(`src/lib/work-service/websocket.ts`) carries every variant we
need:

- `TaskAssigned` — a task was assigned to a worker.
- `TaskStatusChanged` — status flipped (`pending` ↔ `in_progress`
  ↔ `completed`).
- `PushedWork` — supervisor pushed a task.
- `ReservationEscalated` — stale reservation hard-released.
- `WorkerStatusChanged` — worker went offline/online.

The key refinement on the refactor pass: the `<OperatorTaskQueueBody>`
(which calls `useWorkerTasks(workerId, { enableRealtime: true })`)
mounts only while the dialog is open. The hook's `useEffect`
cleanup removes the singleton handler on unmount, so closing the
dialog tears down the subscription automatically. The pre-refactor
tab body was always mounted (just hidden behind `<TabsContent>`'s
`display: none`) — the hook stayed subscribed even when the
supervisor was looking at the other tabs. The new shape is
**strictly less work** for the WS singleton: a subscription only
exists while a dialog is actually visible.

No polling fallback. The 30s `staleTime` covers the brief window
between mount and the first WS handshake; the singleton WS already
has its own reconnect ladder from earlier rounds (see
[[Implement-Resilient-PgListener]]).

## Drag-to-reorder — supervisor scratchpad, persisted locally (unchanged)

**Library**: `@dnd-kit/core` + `@dnd-kit/sortable` (already a dep).
No new dependency.

Sensors: `PointerSensor` (5 px activation distance so a click on a
card body doesn't get hijacked as a drag) + `KeyboardSensor`
(sortable-keyboard-coordinates, accessible).

**Persistence shape** — unchanged from the original ship:

| Layer | Where |
|---|---|
| Per-render order | `useOperatorTaskQueueOrder` hook |
| Cross-session | `localStorage` key `omniframe.operator-task-queue-order.v1.<operatorId>` |
| Server-side | **None today** — see [[ADR-Supervisor-Task-Queue-Reorder-Persistence]] |

The ADR is **untouched** — the persistence decision is independent
of the surface (tab vs. dialog). The merge contract
(`mergeOrder(savedIds, items)`) and the 12 unit tests are
untouched.

## Files added / modified (refactor pass)

### Modified

| File | Change |
|---|---|
| `src/components/operator-task-queue.tsx` | **Refactored.** Dropped the operator dropdown (operator is implicit from the clicked card). Renamed default export concept: now exports `OperatorTaskQueueDialog` (click-to-open shadcn dialog) + `OperatorTaskQueueBody` (the inner reorderable list, exported in case a future surface wants a non-modal embedding). Added framer-motion `<motion.ul>` / `<motion.li>` for the list stagger reveal. Honours `prefers-reduced-motion`. `OPERATOR_TASK_QUEUE_LIMIT` export preserved. ~430 LOC (down from ~470). |
| `src/components/live-operator-status.tsx` | Removed the third `<TabsTrigger value='up-next'>` + `<TabsContent value='up-next'>`. Tab state union narrowed from `'on-counts' \| 'in-building' \| 'up-next'` back to `'on-counts' \| 'in-building'`. `<OperatorCard>` extended with an `onSelect: () => void` prop and `role="button" tabIndex={0}` keyboard handler + hover treatment. New `openOperatorId` state + `<OperatorTaskQueueDialog>` mounted once at the bottom of the panel; opens when an operator card is clicked, closes on backdrop / ESC / X. The dialog auto-closes if the open operator drops out of the live workers list (offline + prune). |

### Unchanged

| File | Why |
|---|---|
| `src/hooks/use-operator-task-queue-order.ts` | Public surface (`useOperatorTaskQueueOrder`, pure `mergeOrder`) is identical. The persistence contract didn't change. |
| `src/hooks/__tests__/use-operator-task-queue-order.test.ts` | All 12 tests still pass. Verified — `pnpm vitest run` 12/12 in 11ms. |
| `src/hooks/use-active-workers.ts` | `useWorkerTasks(workerId, { enableRealtime })` still has the same signature. The dialog passes `enableRealtime: true` exactly the same way the prior tab did, but only during dialog-open lifetime. |
| `Decisions/ADR-Supervisor-Task-Queue-Reorder-Persistence.md` | Persistence decision is independent of surface. Confirmed in this implementation note. |

## Realtime / policy compliance

- ✅ No new `supabase.channel(...)` callsite.
- ✅ Reuses the existing `workServiceWs` singleton.
- ✅ Uses already-installed deps (`@dnd-kit/*`, `framer-motion`,
  `lucide-react`, `date-fns`, shadcn primitives).
- ✅ No new schema, no migration, no agent rebuild, no
  `LATEST_AGENT_VERSION` bump.
- ✅ No new `eslint-disable` directives.
- ✅ No `manualChunks` change in `vite.config.ts` (framer-motion
  was already in the inventory chunk).

## Quality gates (refactor pass)

- `pnpm lint:check` — clean. Repo-wide warning count unchanged
  (93 ≡ 93). Pre-existing baseline drift (16 vs 93 warnings,
  127 vs 166 suppressions) is unchanged. Both touched files have
  zero `eslint-disable` directives.
- `ReadLints` on every touched file — zero diagnostics.
- `pnpm vitest run src/hooks/__tests__/use-operator-task-queue-order.test.ts`
  — 12/12 passing (679 ms).
- `pnpm vitest run src/components/__tests__ src/lib/work-service/__tests__`
  — 23/24 passing. The lone failure (`work-distribution-panel.test.tsx`
  — supabase auth-js / jsdom storage-stub problem) is pre-existing
  and was already documented on the original ship.
- `pnpm build` — clean in 11.42s. **`inventory` chunk delta:
  −0.79 KB raw / +0.09 KB gzip** (218.14 → 217.35 KB raw,
  50.99 → 51.08 KB gzip). The drop is from removing the
  `<Select>` primitive imports (operator dropdown was the heavier
  piece); framer-motion was already in the chunk via other
  siblings so the wrapping `<motion.ul>` / `<motion.li>` adds
  trivial weight. No new per-chunk over-budget chunks.

## Behavioural delta (tab → dialog)

For the user's mental model, a quick "what changed":

| Before (tab) | After (dialog) |
|---|---|
| Three peer tabs ("On Counts", "In Building", "Up Next"). | Two peer tabs ("On Counts", "In Building"). |
| Operator picked via `<Select>` dropdown inside the tab. | Operator picked by clicking their card on Tab 1. |
| Tab body always mounted (hidden via CSS when not active). WS subscription always alive. | Body mounts only while dialog is open. WS subscription scoped to dialog lifetime. |
| Switching operators: open `<Select>`, scroll, click. | Switching operators: close dialog (X / ESC / backdrop), click another card. |
| Tab is a fixed slot in the panel layout. | Dialog overlays the panel — supervisor doesn't lose their seat in the operator grid. |

Net realtime load: **strictly less** (one WS handler is registered
only while a dialog is actually visible vs. the prior always-on
behaviour while any tab was active).

## Open follow-ups

Unchanged from the original ship:

1. **Server-side persistence of the reorder**. See
   [[ADR-Supervisor-Task-Queue-Reorder-Persistence]].
2. **Bulk supervisor controls**. Per-card action menu (Push to
   operator / Release / Mark recount) would land naturally on the
   dialog surface — the FE clients (`workServiceClient.pushToUser`,
   `releaseTask`) already exist.
3. **Pinning a task**. Supervisor-marked critical task that
   survives reorders.

New follow-ups from the refactor pass:

4. **Origin-from-card transform-origin**. Cheap polish if the
   dialog wrapper is forked. Today's center-anchored scale is
   already pleasant.
5. **Click-to-open from Tab 2 ("In Building")**. Currently those
   cards don't open the dialog because presence-only users have
   no work-engine task queue. If a future use case wants to surface
   *any* user's most-recent activity, the dialog could grow a
   different inner content type for non-operator users.
6. **Click-through inside the dialog to the operator's RF
   activity** (jump to the live RF tab in the supervisor's view).
   Cheap follow-up — the dialog already knows the operator.

## Trade-offs considered and rejected (refactor pass)

- **Keep the operator dropdown inside the dialog as a "Switch
  operator" affordance**. Rejected — conflicts with the
  implicit-operator mental model the user described, adds visual
  clutter, and the close-and-click flow is one extra click for a
  rare action (supervisors typically focus on one operator at a
  time when they drill in).
- **Fork `<DialogContent>` to add framer-motion variants on the
  wrapper**. Rejected — the shadcn defaults (`fade-in-0
  zoom-in-95 duration-200`) already match the user's spec for
  the wrapper animation. Forking would change behaviour for every
  other dialog in the app.
- **Origin-from-card transform-origin** (see Animation Choices
  above). Cost > value for this pass.
- **Make Tab 2 ("In Building") cards clickable too**. Rejected for
  this pass — those users aren't on counts so the queue would
  always be empty. Captured as follow-up #5 if a different use
  case ever wants it.

## Related

- [[Implement-LiveOperatorStatus-InBuilding-Tab]] — same panel,
  Tab 2.
- [[Re-Enable-CurrentPage-In-ActiveOperators]] — same panel,
  Tab 1 enrichment.
- [[ADR-Supervisor-Task-Queue-Reorder-Persistence]] — unchanged;
  persistence decision is independent of the surface.
- [[ADR-Scoped-CurrentPage-In-ActiveOperators]] — the privacy
  contract this panel inherits (the dialog inherits the same
  `view inventory_apps` RBAC gate as the underlying panel).
- [[Components/LiveOperatorStatus - Real-Time Panel]] —
  component overview (refreshed on the same day to reflect the
  card-click → dialog framing).
- [[Implement-Rust-Work-Service-Phase4]] — the WS-as-fanout
  backbone the realtime strategy reuses.
- [[realtime-policy]] — .realtime policy rule honoured by this
  implementation.
- [[React-Query-Patterns]] — conventions matched
  (`*_QUERY_KEY` const, multiplexed WS handler, `invalidateQueries`
  over `setQueryData`).
- [[UI-Component-Conventions]] — import order, `cn()`, kebab-
  case filenames, lucide icons.
- [[Sessions/2026-05-09]] — today's session log (Refactor Pt. 2
  section).
