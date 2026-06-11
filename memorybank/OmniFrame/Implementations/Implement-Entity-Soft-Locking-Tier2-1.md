---
tags: [type/implementation, status/active, domain/backend, domain/frontend, domain/realtime, domain/infra]
created: 2026-05-06
---

# Implementation: Entity Soft-Locking on DataTables (Tier 2 #1)

First Tier 2 product surface from [[Roadmap-Rust-WS-Unlocks]] — adds a "Sarah is editing this row" pill on `<DataTableRow>` so users see when colleagues are touching the same record. Sibling subsystem to Worker 1's [[Implement-Presence-On-Rust-Option-2]] (server-side presence in `rust-work-service`) — uses the SAME Redis pattern but on a separate `presence:focus:*` prefix with a shorter TTL (30s vs presence's 90s) because focus leases are short-lived.

## Why

Quoting [[Roadmap-Rust-WS-Unlocks]] §4.1:

> Customer-portal CSRs editing the same `RR Updates` row over each other (a real source of conflicts today, currently mitigated by Slack pings).

Option 2 made the Redis-HSET-with-TTL + tokio-evictor pattern legible — this work re-applies it to entity focus, getting a soft-locking UX for ~1 week of incremental work on top of the presence subsystem.

## Architecture

```
FE (TicketListPanel selects ticket #N)
        │
        ⯈ POST /api/v1/entity-focus/heartbeat { entity_kind:'ticket', entity_id:'N' }
        │   (every 15s while selected; half of 30s TTL)
        │
        ⯈ entity_focus::redis::track_focus → HSET + ZADD + SADD
        │
        ⯈ broadcast WsEvent::EntityFocus { action:'enter' | 'heartbeat' }
        │
        ⯈ FE peers: useEntityFocus filters on (entity_kind, entity_id)
        │       and renders <EntityFocusPill> (avatar stack + tooltip)
        │
        ⯈ entity_focus::evictor sweeps expired leases every 30s
        │       → broadcast WsEvent::EntityFocus { action:'leave' }
        │
        ⯈ Tab close: navigator.sendBeacon → DELETE /api/v1/entity-focus
```

## Redis schema

Three keys per org (sibling to Worker 1's `presence:org:*`):

- `presence:focus:{org_id}:{entity_kind}:{entity_id}` — HSET, field=`user_id`, value=`{user_id, started_at}` JSON.
- `presence:focus:{org_id}:expirations` — ZSET, member=`{entity_kind}|{entity_id}|{user_id}`, score=`last_seen_unix_ts + 30`. Pipe-delimited because none of the components legitimately contain `|`.
- `presence:focus:orgs` — SET of orgs with at least one active lease (iteration source for the evictor).

**Coordination note for [[Implement-Presence-On-Rust-Option-2]]:** the evictor runs INDEPENDENTLY (separate `tokio::spawn`) to keep failure domains isolated. A Redis hiccup that breaks one doesn't stall the other. Same 30s tick cadence so SREs see one rhythm.

## Rust changes

| File | Change |
|---|---|
| `rust-work-service/src/entity_focus/mod.rs` | NEW. Module-level doc comment + `pub mod redis; pub mod evictor;`. |
| `rust-work-service/src/entity_focus/redis.rs` | NEW (~330 LOC). HSET / ZSET / SET helpers, `track_focus`, `untrack_focus`, `get_focus_users`, `evict_expired`, `count_org_focus`, `list_known_orgs`, `forget_org`. Three unit tests on the expiration-member encoder/decoder. |
| `rust-work-service/src/entity_focus/evictor.rs` | NEW (~170 LOC). Mirror of `presence::evictor::run` shape, 30s tick, broadcasts `EntityFocus { action:'leave' }` for each expired lease. |
| `rust-work-service/src/api/routes/entity_focus.rs` | NEW (~230 LOC). Three endpoints: `POST /heartbeat`, `DELETE /`, `GET /users`. JWT-derived `(user_id, org_id)` only — bodies cannot override. |
| `rust-work-service/src/websocket/mod.rs` | +30 LOC. New `WsEvent::EntityFocus { entity_kind, entity_id, user_id, organization_id, action }` variant + `organization_id()` matcher arm. |
| `rust-work-service/src/observability/metrics.rs` | +3 metrics: `WORK_ENTITY_FOCUS_ACTIVE` (IntGaugeVec), `WORK_ENTITY_FOCUS_TOTAL` (IntCounterVec; op=track\|untrack\|evict), `WORK_ENTITY_FOCUS_REDIS_ERRORS_TOTAL` (IntCounter). |
| `rust-work-service/src/main.rs` + `lib.rs` | +12 LOC. `mod entity_focus;` + `tokio::spawn(entity_focus::evictor::run(...))` immediately after the `presence::evictor::run` spawn. Routes nested at `/api/v1/entity-focus`. |

## Frontend changes

| File | Change |
|---|---|
| `src/lib/work-service/entity-focus.client.ts` | NEW (~120 LOC). REST wrapper around the three endpoints. `untrackFocus(body, { useBeacon: true })` falls back to `navigator.sendBeacon` for `pagehide`. |
| `src/hooks/use-entity-focus.ts` | NEW (~225 LOC). Bootstrap snapshot + 15s heartbeat + WS subscription. Joins focused user_ids against `usePresence()` state for display name + avatar. Falls back to a stub `PresenceUser` when the user isn't in the presence channel. |
| `src/components/presence/entity-focus-pill.tsx` | NEW (~125 LOC). Avatar stack + "+N" + tooltip. Reuses `PresenceAvatar`. Compact variant for tight inline placements. |
| `src/lib/work-service/types.ts` | +25 LOC. New `'EntityFocus'` `WsEventType` arm + new optional fields (`entity_kind`, `entity_id`, `action`) on the flat `WsEvent` shape. |
| `src/features/customer-portal/components/TicketListPanel.tsx` | +15 LOC. Wires `useEntityFocus({ entityKind: 'ticket', entityId: selectedTicketId })` and renders the compact pill on the selected card. Other DataTable owners can adopt incrementally per [[Patterns/Entity-Focus-Soft-Locking]]. |

## Constraints honoured

- **30s TTL for focus leases** (vs presence's 90s).
- **15s heartbeat cadence** (half the TTL — same safety margin as presence's 30s/90s).
- **DELETE on unmount is best-effort.** Regular path uses authenticated fetch; tab-close path falls back to `navigator.sendBeacon` (no Authorization header — relies on the 30s TTL evictor to clean up).
- **Org-filter security at every code path.** Rust route resolves `(user_id, org_id)` from JWT only, NEVER from body. WS variant carries a REQUIRED `organization_id` so the deny-by-default org-scope filter on the send loop covers it for free. FE `useEntityFocus` adds a defence-in-depth org check on every event.
- **Pipe-delimited expiration encoding** is validated; entity_kind/entity_id rejecting `|` keeps the decoder unambiguous.

## Quality gate results

- `cargo build` — clean (only pre-existing dead-code warnings on `observability/middleware.rs`).
- `cargo test --lib` — 23 passed; 0 failed (+3 new tests on the expiration-member encoder).
- `cargo clippy --all-targets` — 0 new warnings (only pre-existing).
- `pnpm tsc -b --noEmit` — clean (~23s).
- `pnpm build` — clean (~10s). Bundle deltas are chunking variance.
- `npx eslint` (touched files) — 0 errors / 0 warnings.
- `pnpm test:unit` — 220 pass / 24 fail (exact match with the baseline noted in [[Migrate-SapAgentChanged-To-Rust-WS]] — same pre-existing Supabase mock failures).

## Roadmap follow-ons

- **Adopt the pattern on more DataTables.** The customer portal `TicketListPanel` ships first per the roadmap; `WorkerMonitor`, `Lx03DataTable`, and `WorkTaskTable` are obvious next targets — each is a 1-day adoption following [[Patterns/Entity-Focus-Soft-Locking]].
- **Editable-row write-blocking.** The current pill is awareness-only — clicking the same row from two tabs DOES still let both tabs edit. A future ratchet would block the second write at the API layer when an active focus lease exists; out of scope for the MVP per the roadmap.
- **Text caret / edit-state in payload.** The `FocusEntry` JSON has room for cursor position / unsaved-edit flag — would let the pill render "Sarah typing…" instead of "Sarah editing". Defer until a real product ask.

## Related

- [[Roadmap-Rust-WS-Unlocks]] — Tier 2 #1 row this implements.
- [[ADR-Presence-Architecture-Next-Steps]] — Option 2 framing this rides on.
- [[Patterns/Entity-Focus-Soft-Locking]] — distilled pattern for adopting the pill on other DataTables.
- [[Components/PresenceUI - Status Indicators]] — the avatar primitive this reuses.
- [[Sessions/2026-05-06]] — session log.
