---
tags: [type/pattern, status/active, domain/frontend, domain/backend, domain/realtime]
created: 2026-05-06
---

# Pattern: Entity-Focus Soft-Locking on DataTables

Distilled pattern for adding "X is editing this row" awareness to any DataTable / detail-view in OmniFrame, on top of the [[Implement-Entity-Soft-Locking-Tier2-1]] subsystem.

## When to use

Use this pattern when:

- Multiple users can simultaneously view / edit the same row.
- The conflict is awareness-grade — silent overwrites are confusing but not catastrophic. (For HARD conflicts use optimistic concurrency on the write — out of scope for this pattern.)
- The row is keyed by a stable identifier (UUID, integer row_id, business key like ticket_id).

Do NOT use this pattern when:

- The row is high-fanout (presence / heartbeat / chat) — those use first-class WS variants.
- The selection rate is high (>1Hz row-changes) — the heartbeat cadence assumes the user dwells on a selection.
- The "row" is actually a multi-step workflow — wrap the workflow root, not each step.

## Recipe (FE only — Rust subsystem already in place)

### 1. Pick an entity_kind

A free-form string identifying the entity class. Use lowercase snake-case mirroring the table name where possible:

| Source | Recommended `entity_kind` |
|---|---|
| `support_tickets` | `'ticket'` |
| `work_tasks` | `'work_task'` |
| `rr_lx03_data` | `'lx03_data'` |
| `rr_cyclecount_data` | `'cycle_count'` |
| `sap_agent_jobs` | `'sap_job'` |

The kind is opaque to the server; only consistency across FE callers matters. Document new kinds in this note.

### 2. Wire `useEntityFocus` to the selected row

```tsx
import { useEntityFocus } from '@/hooks/use-entity-focus'

function MyDataTable({ selectedRowId }) {
  const { focusedUsers } = useEntityFocus({
    entityKind: 'work_task',
    entityId: selectedRowId,    // null / undefined disables the hook
  })
  // ...
}
```

The hook handles bootstrap snapshot + 15s heartbeat + WS subscription + `pagehide` cleanup. Pass `null` / `undefined` for `entityId` to disable (e.g. when no row is selected).

### 3. Render `<EntityFocusPill>` on the selected row

```tsx
import { EntityFocusPill } from '@/components/presence/entity-focus-pill'

// inline next to other row affordances
{focusedUsers.length > 0 && (
  <EntityFocusPill users={focusedUsers} compact />
)}
```

Two variants:

- **`compact`** — single avatar + counter, no labels. Use for tight inline placements (e.g. next to a status badge).
- **default** — avatar stack + "X is editing" label + Users icon. Use when there's room for a few words.

### 4. Decide WHERE to render the pill

Two valid placements:

- **On the selected row only** (canonical / cheapest). Other rows omit the pill. Heartbeat fires only for the selection. Pattern used by `TicketListPanel` (canonical reference).
- **On every visible row** (more expensive). Each rendered row spawns its own `useEntityFocus`. ONLY do this if the table is small (<20 rows) AND every row has its own write surface (rare). For large tables this multiplies heartbeat cost N-fold and isn't justified.

## Anti-patterns

- **Don't pre-emptively focus rows that are merely hovered / scrolled past.** Heartbeat starts on actual SELECTION (the user clicked into a detail view / opened the editor), not visibility.
- **Don't store `entity_kind` / `entity_id` derived from URL params alone** without the user actually being on that row. A URL share that lands on a row should NOT register a focus lease until the user interacts.
- **Don't pass user-controlled strings as `entity_kind`.** They're free-form but caller-controlled. Use a string literal in your component.
- **Don't roll your own heartbeat cadence.** The 15s/30s pair is tuned to the server-side TTL. Faster heartbeats waste Redis ops; slower ones cause spurious "leave" / "enter" flapping.

## Server-side guarantees (that you can rely on)

- 30s TTL — a focus lease auto-expires 30s after the last heartbeat.
- 15s heartbeat cadence — half the TTL; one missed heartbeat is recoverable.
- Org-filter on the WS variant — events are delivered only to subscribers of the same org.
- `enter` vs `heartbeat` action — `enter` fires the FIRST heartbeat after the HSET row was absent (or expired). Subsequent heartbeats fire `heartbeat`. The FE handler treats both as "user is currently focused" so the UX is unchanged either way.
- `leave` action — fires on explicit DELETE OR on evictor expiry. Same row removal in either case.

## Server-side schema (reference)

- Redis keys: `presence:focus:{org_id}:{entity_kind}:{entity_id}` HSET, `presence:focus:{org_id}:expirations` ZSET, `presence:focus:orgs` SET.
- REST endpoints: `POST /api/v1/entity-focus/heartbeat`, `DELETE /api/v1/entity-focus`, `GET /api/v1/entity-focus/users?entity_kind=&entity_id=`.
- `WsEvent::EntityFocus { entity_kind, entity_id, user_id, organization_id, action }`.

## Adopting on a new DataTable — checklist

- [ ] Pick `entity_kind` (and document it in this note's table above).
- [ ] Wire `useEntityFocus` to the selected row id.
- [ ] Render `<EntityFocusPill>` on the selected row.
- [ ] Verify heartbeat fires only while a row is selected (DevTools Network tab).
- [ ] Verify `pagehide` triggers a beacon DELETE (DevTools Network → check "Preserve log").
- [ ] Verify the pill drops within ~30s of the other tab closing (TTL + one evictor tick).

## Worked examples

- **Customer portal `TicketListPanel`** (`src/features/customer-portal/components/TicketListPanel.tsx`) — canonical reference. `entity_kind = 'ticket'`. Pill on the selected card only; compact variant.

## Related

- [[Implement-Entity-Soft-Locking-Tier2-1]] — full implementation note (server + FE).
- [[Roadmap-Rust-WS-Unlocks]] — Tier 2 #1 source roadmap.
- [[Components/PresenceUI - Status Indicators]] — the avatar primitive the pill reuses.
- [[Patterns/Realtime-Presence-Browser-Hardening]] — sibling pattern (the presence-channel breaker that PRECEDED this work).
