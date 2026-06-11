---
tags: [type/decision, status/active, domain/frontend, domain/realtime]
created: 2026-05-10
---

# ADR — Dispatcher Shell-Level WS Handler vs Per-Lane Realtime

## Context

[[Implement-Work-Queue-Management-Tab]] (2026-05-10) ships a multi-operator dispatcher view: one column per active operator, each column showing that operator's NOW + NEXT queue. The pre-existing `useWorkerTasks(workerId, { enableRealtime: true })` hook (used by the per-operator dialog from [[Implement-Operator-Cycle-Count-Queue-Tab]]) wires up the queue refresh by:

1. `useQuery` on `[WORKER_TASKS_QUERY_KEY, workerId]`
2. `workServiceWs.connect(organizationId, handleWsEvent)` — ONE handler per hook instance

For the dialog, that's perfect: one operator open at a time, one handler. For the dispatcher, the supervisor sees up to ~6 active operators side by side. Naively reusing `useWorkerTasks(...)` per lane would mount **6 redundant WS handlers** all listening to the same `workServiceWs` singleton. Every TaskAssigned / TaskStatusChanged / PushedWork event dispatches across all 6 handlers; each handler fires a `queryClient.invalidateQueries`. The work is duplicated by N× even when only one lane could possibly care.

The singleton WS already de-duplicates the WIRE-level subscribe (one socket, one Subscribe message), but the per-handler invalidation work is genuinely 6×. Worse, when a supervisor tabs through different organisations or kills a tab, removing 6 handlers in non-deterministic order makes the singleton WS lifecycle (which auto-disconnects when handler count drops to 0) more error-prone than necessary.

## Decision

**Subscribe to `workServiceWs` ONCE at the dispatcher shell level.** Use `useQueries` for the per-operator HTTP fetches (sharing the `WORKER_TASKS_QUERY_KEY` cache with the dialog) but pass the per-operator hook a way to skip its own WS handler:

- For the dispatcher: `useMultiOperatorTasks({ workers })` issues `useQueries` directly and registers ONE `workServiceWs.connect` handler for the whole grid. The handler dispatches invalidations to the affected lane(s) based on event semantics:
  - `TaskAssigned` / `PushedWork` → invalidate the recipient lane (or fan out to all if `user_id` is missing)
  - `TaskStatusChanged` → invalidate the holder lane (or fan out)
  - `ReservationEscalated` → invalidate `previous_owner` and the new holder
  - `WorkerStatusChanged` → ignored at the dispatcher level (the active workers list is owned by `useActiveWorkers`, which has its own handler)
- For the dialog: keep using `useWorkerTasks(operatorId, { enableRealtime: true })` exactly as today — one operator, one handler, no change.

Both paths share the SAME `WORKER_TASKS_QUERY_KEY`. A supervisor opening the per-operator dialog while the dispatcher tab is also visible (e.g. on a second monitor) sees a coherent cache between the two surfaces.

## Consequences

### Positive

- **Strictly less work** for the WS singleton: one handler total (plus the existing `useActiveWorkers` handler) instead of one per visible lane. Per-event work doesn't fan out N×.
- **Cleaner unmount semantics.** When the supervisor switches tabs, the dispatcher's effect cleanup removes a single handler. The previous "unmount 6 handlers in arbitrary order" footgun is gone.
- **Cache shared with the dialog** — reorders, optimistic updates, and refresh-on-tab-focus all flow through one cache by `workerId`.
- **`useQueries` parallelism** — TanStack issues all per-operator HTTP fetches in parallel. First-paint latency is bounded by the slowest single fetch, not the sum.

### Negative

- **Duplicated event semantics** between `useWorkerTasks` (single-operator) and `useMultiOperatorTasks` (multi). If we add a new `WsEvent` variant later that affects task lists, both must be updated. Mitigated by both using the SAME `WORKER_TASKS_QUERY_KEY` so a third future caller can add its own variant handling without breaking the others.
- **Burst detection lives in the dispatcher hook only.** The dialog doesn't currently surface burst-style stagger (one operator at a time, bursts are rare). If a future single-operator surface wants burst behaviour, refactor `markBurst` into a shared helper.
- **`useQueries` enabled gating** is per-element. We pass `enabled: !!organizationId && !!worker.user_id` per query. If a worker payload arrives partial, that query is skipped; once the next render has the full id, the query enables. Standard TanStack pattern — documented but not unusual.

## Alternatives considered

### Alt 1: Reuse `useWorkerTasks(…, { enableRealtime: true })` per lane.

**Rejected.** N redundant handlers all listening to the same singleton. Per-event work fans out N× in handler dispatch + invalidation calls. Singleton WS lifecycle becomes harder to reason about.

### Alt 2: One `useWorkerTasks(…, { enableRealtime: false })` per lane + a separate dispatcher-scoped WS handler.

**Equivalent to the chosen design**, just with an extra layer of indirection. We picked the explicit `useQueries` path because it makes the parallel-fetch shape obvious in the call site and avoids running `useWorkerTasks` (which has both a query AND an effect) just for its query.

### Alt 3: Add a `WsEvent::TasksInvalidated { worker_ids: string[] }` server-side broadcast.

**Rejected for now.** The dispatcher works fine off the existing variants. Adding a new server event for one client surface is the kind of premature abstraction that bites later. If a future use case shows up that genuinely needs per-batch invalidation, we revisit and file a follow-on ADR. Documented in [[Roadmap-Rust-WS-Unlocks]] as a candidate.

### Alt 4: Polling fallback per lane.

**Rejected.** Polling each visible lane every 30s gives 6× the network traffic of a single WS subscription with no realtime improvement. We honour the WS push for freshness; the 30s `staleTime` covers the brief window between mount and the first WS frame.

## Implementation notes

- The shell handler in `use-multi-operator-tasks.ts` is intentionally permissive about `user_id` filtering. Some events (e.g. `TaskStatusChanged` on a release) don't carry a user id; in those cases we fan out to all visible lanes. Cheap to invalidate, expensive to be wrong.
- Burst detection (multiple `TaskAssigned` / `PushedWork` events for the same lane within `TASK_ENTER_STAGGER_BURST_MS = 100ms`) sets a `staggerEnter` flag on the affected lane. The lane's `<AnimatePresence>` then applies a child stagger to its enter animation. Single arrivals skip the stagger so they animate immediately rather than waiting for a 40ms `delayChildren`.

## Related

- [[Implement-Work-Queue-Management-Tab]] — the implementation this ADR explains.
- [[Implement-Operator-Cycle-Count-Queue-Tab]] — the per-operator dialog the dispatcher complements; uses `useWorkerTasks(…, enableRealtime)` directly and remains unchanged.
- [[ADR-Supervisor-Task-Queue-Reorder-Persistence]] — the reorder-persistence ADR (unchanged; the persistence decision is independent of the dispatcher surface).
- [[Roadmap-Rust-WS-Unlocks]] — the catalogue of future Rust WS variants if we ever decide to file a TasksInvalidated event.
- [[realtime-policy]] — the rule honoured by this design (zero new `supabase.channel(...)` callsites).
- [[Components/Rust-Work-Service]] — the WS-as-fanout backbone the dispatcher reuses.
