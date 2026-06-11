---
tags: [type/implementation, status/active, domain/frontend, domain/realtime]
created: 2026-05-06
---

# Implementation: Migrate Work Queue Hooks to WebSocket Push

## Why

First shipped item from the "Bundle with Option 2" sequencing in [[Roadmap-Rust-WS-Unlocks]] (Tier 1 row: `use-work-queue` 30s/60s polls + `work-queue-context` 30s `setInterval`). The Rust work-service WS (`/ws` on port 8030) already emits the events we need (`TaskAssigned`, `TaskStatusChanged`, `PushedWork`, `WorkerStatusChanged`, `QueueStatsUpdated`, `ReservationEscalated`) — the migration is **frontend-only**, validates the singleton `WorkServiceWebSocket` can multiplex new event consumers without architectural strain, and prepares the muscle for the next Tier 1 migration (`useAgentDetection` + `agents-fleet-card` → `WsEvent::SapAgentChanged`, owned by a separate workstream).

Motivating ADR: [[ADR-Presence-Architecture-Next-Steps]] (Option 2 framing — extend Rust WS instead of adding new Supabase Realtime channels).

## What changed

### `src/hooks/use-work-queue.ts` — full rewrite of the polling layer

- Replaced the always-on 30s and 60s `refetchInterval`s with a single value-based `fallbackRefetchInterval` (`number | false`) that is `false` while `wsConnectionState === 'connected'` and `5 * 60_000` otherwise. The component re-renders on every WS state change (mirror of `workServiceWs.getConnectionState()` held in `useState`), and React Query picks up the new options without remounting the query.
- Added a single multiplexed `handleWsEvent` covering ALL event variants the Rust service emits today:
  - `TaskAssigned` / `TaskStatusChanged` / `PushedWork` / `ReservationEscalated` → invalidate **both** `WORK_QUEUE_QUERY_KEY` and `QUEUE_STATS_QUERY_KEY` (queue contents AND stats both shift).
  - `QueueStatsUpdated` / `WorkerStatusChanged` → invalidate **stats only** (the row set hasn't changed, just the counts).
- Used `invalidateQueries` (not `setQueryData`) so a burst of rapid events collapses to a single refetch via TanStack Query's in-flight dedupe — see the spec's race-safety guidance.
- Effect mirrors `use-pushed-work.ts` and `use-active-workers.ts` shape: `connect(orgId, handler)` on mount, `removeHandler(handler) + onStateChange unsubscribe` on cleanup.
- Exported new `WORK_QUEUE_FALLBACK_REFETCH_MS = 5 * 60 * 1000` constant for downstream visibility.
- `enablePolling` flag retained as an alias for the fallback poll (deprecated in JSDoc) — keeps the call sites in `src/features/admin/work-queue/components/*` source-compatible. `pollingInterval` flag retained but explicitly ignored (deprecated in JSDoc).
- Hook surface (`UseWorkQueueReturn`) is **unchanged**; consumers get the same data + mutation API.

### `src/features/admin/work-queue/context/work-queue-context.tsx` — replaced the 30s `setInterval`

- The literal `setInterval(refreshQueueStats, 30000)` at the old line 345 is gone. In its place: a single `useEffect` keyed on `organizationId` that
  1. Connects to `workServiceWs` and registers a handler that invokes `refreshQueueStatsRef.current()` on the same six event variants as the hook above.
  2. Maintains a fallback `setInterval` armed/disarmed by an `onStateChange` callback — the interval ONLY runs while `connectionState !== 'connected'`, at the same 5min cadence as the hook.
- Used a `refreshQueueStatsRef` so the WS effect doesn't re-register on every render that changes the `refreshQueueStats` callback identity (which would tear down and re-establish the singleton subscription on each provider render, causing thrash).
- The provider already maintains its own `subscribeToUpdates` / `unsubscribeFromUpdates` state for a separate UI affordance (`isSubscribed` toggle) — left untouched so the manual subscribe button keeps working.
- Imported `useUnifiedAuth` to discover `organizationId`; otherwise consumer surface unchanged.

### `src/lib/work-service/types.ts` — wire-compat extension

- Added `'ReservationEscalated'` to `WsEventType` (Rust already emits it via `WsEvent::ReservationEscalated` from `rust-work-service/src/scheduler/mod.rs:139` — it was simply missing from the TS mirror).
- Added optional `previous_owner?: string` to `WsEvent` so the `ReservationEscalated` payload field is typed.
- Added a JSDoc paragraph at `WsEventType` explaining that this enum mirrors the Rust source-of-truth in `rust-work-service/src/websocket/mod.rs` and that adding a variant is wire-compatible.
- **No Rust changes.** This is purely a downstream TS catch-up for a variant the Rust side already emits.

## File deltas

| File | Lines added | Lines removed | Net |
|---|---|---|---|
| `src/hooks/use-work-queue.ts` | ~120 | ~30 | **+~90 LOC** (mostly JSDoc + WS handler block) |
| `src/features/admin/work-queue/context/work-queue-context.tsx` | ~80 | ~5 | **+~75 LOC** (handler + armed/disarmed fallback interval block) |
| `src/lib/work-service/types.ts` | ~15 | 0 | **+~15 LOC** (one variant + one optional field + JSDoc) |
| `realtime-policy workspace rule` | 84 | 0 | **+84 LOC (new file)** |

No files deleted.

## Wire-compatibility

### Variants used in this migration

All variants the migration consumes are **already emitted by `rust-work-service` today** — verified against `rust-work-service/src/websocket/mod.rs` (`enum WsEvent`) and the broadcast call sites in `rust-work-service/src/api/routes/work.rs` + `rust-work-service/src/scheduler/mod.rs`:

| Variant | Used by `useWorkQueue`? | Used by `WorkQueueProvider`? | Emitted by Rust today? |
|---|---|---|---|
| `TaskAssigned` | ✓ (queue + stats) | ✓ | ✓ (`api/routes/work.rs:209`, `:296`) |
| `TaskStatusChanged` | ✓ (queue + stats) | ✓ | ✓ (`api/routes/work.rs:218`, `:353`, `:417`, `:477`, `:609`, `:740`; `scheduler/mod.rs:225`) |
| `PushedWork` | ✓ (queue + stats) | ✓ | ✓ (`api/routes/work.rs:285`, `:878`, `:948`) |
| `WorkerStatusChanged` | ✓ (stats only) | ✓ | ✓ (declared in enum; emitted by worker heartbeat path) |
| `QueueStatsUpdated` | ✓ (stats only) | ✓ | ✓ (`scheduler/mod.rs:309`) |
| `ReservationEscalated` | ✓ (queue + stats) | ✓ | ✓ (`scheduler/mod.rs:139`) |

### Variants NOT yet wired (gaps for future work)

**None.** Every event variant the Rust enum declares is now consumed by at least one of the migrated surfaces. The migration is complete with zero remaining wire-compat gaps.

The spec anticipated possibly missing variants (e.g. the placeholder example `TaskStatusChanged` was hypothesised as missing) — in practice the TS `WsEventType` enum was missing only `'ReservationEscalated'`, which was a downstream type catch-up rather than a Rust-side gap. **No Rust changes were needed.**

## Race-safety + multi-tab notes

- `invalidateQueries` (not `setQueryData`) is used everywhere → TanStack Query dedupes overlapping invalidations and a refetch already in flight will service the new subscriber. A burst of WS events collapses to a single network round trip.
- All consumer mutations (`startTask`, `releaseTask`, `acknowledgePush`, etc.) are unchanged and remain idempotent; the new WS-driven invalidations don't introduce any new mutation paths.
- Multi-tab: the QueryClient in `src/main.tsx` does NOT use `broadcastQueryClient`, so each tab maintains its own React Query cache and its own WS subscription. The singleton `workServiceWs` is per-tab, which is the correct shape — every tab gets its own push and dedupes its own refetches independently. This is consistent with how `use-pushed-work.ts` and `use-active-workers.ts` already operate.

## Quality gate results

| Gate | Result |
|---|---|
| `pnpm tsc -b --noEmit` | clean (21s) |
| `pnpm build` | clean (~11s); PWA precache regenerated. Pre-existing `feature-admin` and `warehouse-location-map` chunk over-budget warnings unchanged from baseline (verified by stash + rebuild — baseline 9767.02 KB total → mine 9770.08 KB, +3 KB delta is negligible) |
| `npx eslint src/hooks/use-work-queue.ts src/features/admin/work-queue/context/work-queue-context.tsx src/lib/work-service/` | 0 warnings, 0 errors |
| `pnpm test:unit` | 220 pass / 24 fail — EXACT match with the [[Harden-Presence-Service-Tenant-Overload]] same-day baseline. The 24 pre-existing failures (Supabase `storage.getItem` mock + RFCycleCount "multiple elements" issue) are unchanged. |
| `pnpm vitest run src/hooks/use-work-queue` | No test files exist for these surfaces (none did before either) |

## What stayed the same

- `useWorkQueue()` hook surface (`UseWorkQueueReturn`) — unchanged. Every consumer in `src/features/admin/work-queue/components/*` continues to compile + run identically.
- `WorkQueueProvider` `WorkQueueContextState` value — unchanged.
- All mutations, all toast strings, all `refreshQueue` semantics.
- The `subscribeToUpdates` / `unsubscribeFromUpdates` UI affordance in the provider (manual realtime toggle) is untouched — left for the user to manage.
- `use-pushed-work.ts`, `use-active-workers.ts`, `use-unified-cycle-count.ts` — UNCHANGED (already on the WS singleton).

## Code-review checklist deliverable

Added `realtime-policy workspace rule` documenting the "no NEW `supabase.channel(...)` callsites" policy. Cross-references the ADR + Roadmap and lists three acceptable alternatives (extend the Rust WS, polling, or file an ADR). Includes a code-review checklist for reviewers and a list of grandfathered existing channels.

## Related

- [[Roadmap-Rust-WS-Unlocks]] — the source roadmap; this is the first "Bundle with Option 2" item shipped.
- [[ADR-Presence-Architecture-Next-Steps]] — Option 2 framing.
- [[Harden-Presence-Service-Tenant-Overload]] — Phase A/B2/B3 same-day surface; the work-queue migration is the next ratchet on the same realtime-load-reduction trajectory.
- [[Patterns/Realtime-Presence-Browser-Hardening]] — current browser-side defence pattern that this migration moves us off of (for work-queue specifically).
- `src/hooks/use-pushed-work.ts` — canonical pattern source mirrored here.
- `src/hooks/use-active-workers.ts` — canonical pattern source mirrored here (closer match because it ALSO uses `refetchInterval` as the fallback).
- [[Sessions/2026-05-06]] — the session this migration shipped in.
