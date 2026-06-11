---
tags: [type/decision, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-05-09
---

# ADR — Supervisor Task-Queue Reorder Persistence

## Context

[[Implement-Operator-Cycle-Count-Queue-Tab]] (2026-05-09) shipped a new "Up Next" tab on `<LiveOperatorStatus>` that lets a supervisor pick a cycle-count operator from a dropdown and see the next 10–15 tasks for that operator, **drag-to-reorder**.

The drag-to-reorder is implemented today as a **supervisor-side scratchpad** persisted to `localStorage` (key shape `omniframe.operator-task-queue-order.v1.<operatorId>`). It survives a page refresh on the same browser but it does **NOT** propagate to:

- Other supervisors viewing the same operator's queue.
- The operator's own RF claim-next call (which still consumes the canonical SQL `ORDER BY` from `rust-work-service::db::queries::get_worker_tasks`).
- A supervisor on a different machine.

The canonical ordering is `priority → pushed_at → resolved_zone/aisle/sequence → location → assigned_at` (see `rust-work-service/src/db/queries.rs:1260+`).

## Decision

**Ship the local-only scratchpad now; defer server-side persistence until a real workflow signal demands it.**

Reasoning:

1. The user's ask was visual / planning-tool flavoured ("see the next 10–15 tasks", "rearrangeable"), not enforcement ("reorder what the operator gets next"). A local view is sufficient to answer "in what order will I have these done?" without making the priority engine subordinate to a UI gesture.
2. Making the reorder authoritative interacts with the priority engine, the zone exclusivity engine, and the per-operator defer system in non-obvious ways. See [[Per-Operator-vs-Global-Defer-Scope]] for the kind of subtlety that surfaces when a per-supervisor write meets a per-operator data model.
3. The local-only path ships today with no migration, no Rust release, no new WS variant.
4. If the local path turns out to be the right product (no one asks for cross-supervisor sync), we save the migration + Rust + WS variant work entirely.

## Future work (only if the user asks for it)

If cross-supervisor sync or operator-RF authority becomes a requirement, the path is well-trodden — mirror the [[Implement-Rust-Work-Service-Phase4]] / [[Migrate-Tier1-Deferred-Channels-To-Rust-WS]] shape:

### Phase A — schema

- Migration `2NN_task_assignment_order.sql`: add `task_assignment_order INTEGER NULL` to `rr_cyclecount_data`. Composite index `(assigned_to, organization_id, task_assignment_order ASC NULLS LAST)` so the existing `get_worker_tasks` query can ORDER BY the new column when set.
- Update the SQL in `rust-work-service::db::queries::get_worker_tasks` to put `task_assignment_order ASC NULLS LAST` ahead of the priority chain (or after, depending on whether reorder overrides priority — product call).
- Update `claim_next_cycle_count` analogously — same trade-off (does the supervisor reorder also re-rank what the operator's RF gets?).

### Phase B — Rust route

- New endpoint `PUT /api/v1/workers/:id/tasks/reorder` taking `{ task_ids: string[] }`. Server-side authz: caller must be a supervisor (`view inventory_apps` + a write-leaning permission like `manage cycle_counts`). Server-side validation: every `task_id` belongs to `worker_id` AND `organization_id`. Server-side write: bulk UPDATE setting `task_assignment_order = i` for each `(worker_id, task_id)`.
- Pair with a NOTIFY trigger + listener on `rr_cyclecount_data.task_assignment_order` so other supervisors viewing the same operator's queue see the reorder live.

### Phase C — WS variant

- Add `WsEvent::TaskOrderChanged { worker_id, organization_id }` to `rust-work-service/src/websocket/mod.rs` + the matching FE-side `WsEventType` extension in `src/lib/work-service/types.ts`.
- Wire `useWorkerTasks` to invalidate on `TaskOrderChanged` (the existing `enableRealtime` machinery handles the rest).

### Phase D — FE migration

- Replace `useOperatorTaskQueueOrder`'s localStorage persistence with a TanStack mutation calling the new Rust route.
- Keep the pure `mergeOrder` helper — it's still useful as the optimistic-update merge during the round trip.
- Migration story for existing localStorage entries: the keys are versioned (`v1`); a one-shot migration on first mount can POST every saved order to the new endpoint and `removeItem(key)`. After one release, the `v1` keys can be deleted entirely.

## Consequences

- **Today**: supervisor sees a personal view of the operator's queue. Drag affects only that supervisor's browser. The operator's RF still claims tasks in canonical priority order. Cheap to ship; cheap to revert.
- **Tomorrow** (if Phase A–D land): drag becomes authoritative. Every supervisor sees the same order; the operator's RF respects it. New attack surface: a supervisor can starve a critical count by dragging it to position 12.
- **Risk if we never ship Phase A–D**: supervisors may be confused that the order they set doesn't "take". Mitigated today by the explicit "Custom order" pill + tooltip + the explanatory caption beneath the list ("Reorders are saved per operator on this device — the operator's RF queue still claims tasks in the canonical priority order until a server-side reorder endpoint ships.").

## Alternatives considered

- **Persist to a Zustand store**. Rejected — Zustand stores in this codebase are session-scoped (lost on page reload). The ask implies the reorder should survive a refresh.
- **Persist to Supabase realtime broadcast** (broadcast-only, no row write). Rejected — violates [[realtime-policy]]; even if it didn't, the broadcast would be lost on tab close, which doesn't help cross-supervisor sync.
- **Server-side reorder via a side-table (`task_assignment_overrides`)** instead of a column on `rr_cyclecount_data`. Worth considering when Phase A lands — the side-table avoids touching the canonical row at the cost of an extra LEFT JOIN in `get_worker_tasks`. Captured here as a sub-decision for the future ADR that opens Phase A.

## Related

- [[Implement-Operator-Cycle-Count-Queue-Tab]] — the implementation this ADR explains.
- [[Per-Operator-vs-Global-Defer-Scope]] — the kind of per-supervisor / per-operator scoping subtlety Phase A would have to navigate.
- [[realtime-policy]] — the rule the local-only path honours.
- [[Roadmap-Rust-WS-Unlocks]] — the precedent for adding a new `WsEvent` variant + listener (Tier 1 migrations).
