---
tags:
  - type/component
  - status/active
  - domain/frontend
created: 2026-04-12
updated: 2026-04-12
---
# LiveOperatorStatus — Real-Time Panel

## Purpose
Displays active warehouse operators and their current status in real-time. Used within the Manual Counts tab to give supervisors visibility into who is online, busy, idle, or on break.

## Location
`src/components/live-operator-status.tsx`

## Architecture
- Uses `useActiveWorkers` hook for worker data and WebSocket connection state
- Sorts workers by status priority: busy → online → idle → break → offline
- Filters out offline workers from display
- Shows WebSocket connection indicator (live ping animation vs polling fallback)

## UI Design (as of 2026-04-12 redesign)
- Card with `border-border/50 bg-card/50 backdrop-blur-sm`
- Compact header with icon container + inline count pills
- Empty state: horizontal layout with dashed border, icon + text side-by-side
- Worker rows: avatar circle with status dot overlay (positioned bottom-right)
- Status dot uses `getStatusColor()` with `animate-pulse` for busy workers
- Live indicator: double-element ping animation (absolute + relative spans)
- Refresh button: `h-7 w-7` ghost button

## Worker Row Structure
- Left: Avatar (h-8 w-8 rounded-full bg-muted) with status dot overlay
- Middle: Name + status badge + optional task location/type
- Right: Relative timestamp ("2 minutes ago")

## Dependencies
- `useActiveWorkers` — query + WebSocket subscription
- `date-fns` `formatDistanceToNow` — relative timestamps
- lucide-react icons: Users, User, Wifi, WifiOff, RefreshCw, Clock, MapPin

## Related
- [[ManualCountsSearch - Inventory Tab]]
- [[Redesign-Manual-Counts-Tab-UI]]


## 2026-05-01 — Modern Grid Redesign
Full rewrite. Replaced single-column row list with a two-section layout:

### Header
- Gradient icon tile + title + subtitle (`N active · M total tracked`).
- Live/Polling pill (animated ping when live) + refresh button.
- 5-column **summary tile row** (Busy / Online / Idle / Break / Offline) with colored icons + counts. Tiles light up only when count > 0.

### Operator Cards
- Responsive grid: `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`.
- Each card has avatar with initials + status-colored ring + status-dot overlay (animated ping on busy), name + status pill, location/task line with map pin (or italic placeholder), task-type pill (mono), and last-seen timestamp.
- Status colors centralized in a `STATUS_THEME` map keyed by `WorkerStatusType` so dot/ring/chip/border stay consistent.

### Hook usage
- Now consumes `breakCount` and `offlineCount` from `useActiveWorkers` in addition to the existing busy/online/idle counts (already exposed by the hook).
- See [[Inventory-Counts-Tab-Comprehensive-Redesign]].



## 2026-05-09 PM — Click-to-open per-operator queue dialog

Same-day refactor: the third "Up Next" peer tab that landed in the
AM was reshaped into a **click-to-open dialog**. Each
`<OperatorCard>` on Tab 1 ("On Counts") is now clickable; clicking
it opens a dialog scoped to that operator's queue (drag-to-reorder
list of the next 12 cycle-count tasks). See
[[Implement-Operator-Cycle-Count-Queue-Tab]] for the full
implementation — same filename, refreshed in place.

### Surface shape (after refactor)

- **Tabs**: two peer tabs again — "On Counts" + "In Building".
  Tab state union narrowed back to `'on-counts' \| 'in-building'`.
- **Operator card affordance** (Tab 1): `<OperatorCard>` is now
  `role="button" tabIndex={0}` with `onClick` → open dialog,
  Enter / Space keyboard activation, `aria-label="Open queue for
  {name}"`, and a hover lift
  (`hover:-translate-y-0.5 hover:shadow-md`) plus a visible
  focus ring. Tab 2 ("In Building") cards are **deliberately NOT
  clickable** — those users aren't on counts so the queue would
  always be empty.
- **Dialog** (`<OperatorTaskQueueDialog>` co-located in
  `src/components/operator-task-queue.tsx`): mounted once at the
  bottom of `<LiveOperatorStatus>`. Opens when an operator card is
  clicked, closes on backdrop / ESC / X. Auto-closes if the open
  operator drops out of the live workers list (offline + prune).
  - **Header**: operator full name + sub-title ("Up next — drag to
    reorder…"). shadcn `<DialogTitle>` + `<DialogDescription>`
    for SR announcement.
  - **Status row**: "Showing N of M tasks · +K more in backlog ·
    ⧗ Updating…".
  - **Reorder controls**: "✨ Custom order" pill (only when active)
    + "↻ Reset" ghost button.
  - **Sortable list**: up to 12 cards
    (`OPERATOR_TASK_QUEUE_LIMIT`) for the operator's pending /
    in-progress / recount tasks. Same per-card content as the
    pre-refactor tab body (drag handle, position chip, count
    number, priority badge, status chips, location + zone·aisle,
    material, system qty + UoM).
  - **States**: loading (3 skeleton cards), empty ("No tasks in
    queue for {name}"), error (amber alert with Retry).
- **Operator selector dropped**: the pre-refactor tab body had a
  `<Select>` dropdown to pick the operator. Removed in the
  refactor pass — the operator is now implied by which card was
  clicked. The dialog title shows the operator name so there's no
  ambiguity.

### Animation

- **Wrapper**: shadcn `<DialogContent>` ships with
  `data-[state=open]:animate-in fade-in-0 zoom-in-95 duration-200`
  (matched the user's spec for fade + scale 0.96 → 1.0 over
  ~180ms). Reverse on close. We **didn't** fork the shared
  primitive — the defaults already feel right.
- **Inner list stagger**: framer-motion `<motion.ul>` /
  `<motion.li>` with `staggerChildren: 0.025` + `delayChildren:
  0.05`, each item `opacity 0 → 1, y 6 → 0` over 180ms with
  `easeOut`. Total reveal for 12 items: ~0.5s. Honours
  `prefers-reduced-motion` via `useReducedMotion()` (zero stagger
  / zero translate for reduced-motion users; instant outcome).
- **Origin-from-card** (cheap polish suggested in the brief):
  **skipped**. The shadcn primitive uses absolute center
  positioning; pinning a per-card transform-origin requires
  forking the wrapper AND threading the rect from the card AND
  keeping it in sync on resize. Cost > value vs. the pleasant
  Radix center scale.

### Hooks (unchanged)

- `useWorkerTasks(workerId, { enableRealtime: true })` — same
  signature, same WS variants invalidated. **The realtime
  subscription is now strictly less work** than under the tab
  shape: the body mounts only while the dialog is open, so the
  hook's `useEffect` cleanup tears down the singleton WS handler
  on close. Pre-refactor, the tab body was always mounted (just
  hidden by `<TabsContent>` `display: none`).
- `useOperatorTaskQueueOrder({ operatorId, items })` — surface
  unchanged. The 12 unit tests on the pure `mergeOrder` helper
  were not touched and all still pass.

### Realtime contract

Unchanged. No new `supabase.channel(...)` callsite — still
reuses the singleton `workServiceWs`. Honours [[realtime-policy]].

### Persistence contract

Unchanged. The reorder is still a **supervisor-side scratchpad**
persisted to `localStorage` (key
`omniframe.operator-task-queue-order.v1.<operatorId>`). The
[[ADR-Supervisor-Task-Queue-Reorder-Persistence]] does not need
to change — the persistence decision is independent of the
surface.

### File deltas (refactor pass)

| File | Change |
|---|---|
| `src/components/live-operator-status.tsx` | Removed third `<TabsTrigger>` + `<TabsContent>`. Tab state union narrowed back to `'on-counts' \| 'in-building'`. `<OperatorCard>` extended with `onSelect: () => void` prop and `role="button" tabIndex={0}` keyboard handler + hover treatment. New `openOperatorId` state + `<OperatorTaskQueueDialog>` mounted once at the bottom of the panel. |
| `src/components/operator-task-queue.tsx` | Refactored. Dropped the operator dropdown (`<Select>` import removed). Now exports `OperatorTaskQueueDialog` (click-to-open shadcn dialog) + `OperatorTaskQueueBody` (the inner reorderable list, exported for any future non-modal embedding). Added framer-motion `<motion.ul>` / `<motion.li>` for the list stagger reveal. Honours `prefers-reduced-motion`. ~430 LOC (down from ~470). |
| `src/hooks/use-operator-task-queue-order.ts` | **Unchanged.** Public surface identical. |
| `src/hooks/__tests__/use-operator-task-queue-order.test.ts` | **Unchanged.** 12/12 still pass. |
| `src/hooks/use-active-workers.ts` | **Unchanged.** `useWorkerTasks(workerId, { enableRealtime })` signature preserved. |

### Privacy contract

Unchanged. The dialog inherits the same `view inventory_apps`
RBAC gate as the panel it's mounted in. No new permission key,
no new presence payload field. The grep contract from
[[ADR-Scoped-CurrentPage-In-ActiveOperators]] ("current_page" +
"rf_activity" consumed by exactly one UI surface) is unaffected.
