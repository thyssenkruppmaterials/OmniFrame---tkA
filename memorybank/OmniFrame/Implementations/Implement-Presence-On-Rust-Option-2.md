---
tags: [type/implementation, status/active, domain/backend, domain/frontend, domain/realtime, domain/infra]
created: 2026-05-06
---

# Implementation: Server-Side Presence on `rust-work-service` (Option 2)

Headline implementation of [[ADR-Presence-Architecture-Next-Steps]] **Option 2** — server-side presence in `rust-work-service`. Replaces the org-wide Supabase Realtime Presence channel (`presence-org-{org_id}`) with a Redis-backed per-org HSET that `rust-work-service` owns end-to-end. Browsers heartbeat to a new REST endpoint; deltas land via the existing `WorkServiceWebSocket` singleton through three new `WsEvent` variants. Phase A / B2 / B3 surface remains intact under the `'supabase'` mode (default); the new `'rust'` mode is selected at build time via `VITE_PRESENCE_MODE=rust`.

## Why

Quoting the ADR's Step 2 (recommendation when do-nothing watching reveals a regression OR the org grows past ~80 concurrent tabs):

> **Option 2 — server-side presence in `rust-work-service`.** Removes the ENTIRE Supabase Realtime presence dependency for the app, not just shaves off a slice. `Presence_shard112` load from this app drops to zero — there's no shard to wedge. Reuses ~80% of existing infrastructure (auth, org-isolation, broadcast fan-out, `WorkServiceWebSocket`).

The motivating incident (tenant `c9d89a74` `Presence_shard112` GenServer wedging on 2026-05-06) is mitigated by Phase A / B2 / B3 in the short term ([[Harden-Presence-Service-Tenant-Overload]]); Option 2 retires the underlying dependency entirely. This note ships the full server-side replacement so the FE can be flipped to `'rust'` mode per fleet (or per org, once the rollout flag lands).

## End-to-end

```
FE PresenceServiceRust
        │
        ⯈ POST /api/v1/presence/heartbeat   (every 30s foreground / 5min hidden)
        │
        ⯈ presence::redis::track_presence  ─→  HSET presence:org:{org}
        │                                  ─→  ZADD presence:org:{org}:expirations  score=now+90s
        │                                  ─→  SADD presence:orgs {org}
        │
        ⯈ HEXISTS-before-HSET → TrackOutcome::{Joined, Updated}
        │
        ⯈ broadcast::Sender<WsEvent>::send(
        │      WsEvent::PresenceJoined  { user_id, organization_id, payload }
        │   OR WsEvent::PresenceUpdated { user_id, organization_id, payload }
        │   )
        │
        ⯈ per-socket WS recv loop  →  org-filter (deny-by-default)  →  client
        │
        ⯈ FE: PresenceServiceRust.applyPresenceUpsert(event)  →  onPresenceSync(users)
```

And the eviction path:

```
presence::evictor   (30s tick)
        │
        ⯈ list_known_orgs(SMEMBERS presence:orgs)
        │
        ⯈ for each org → evict_expired(ZRANGEBYSCORE … -inf {now})
        │     for each user_id → HDEL + ZREM
        │
        ⯈ broadcast::Sender::send(WsEvent::PresenceLeft { user_id, organization_id })
        │
        ⯈ count_org_presence → WORK_PRESENCE_ACTIVE_USERS gauge
        │
        ⯈ if HSET empty → forget_org (SREM presence:orgs)
```

And the explicit untrack ("Appear Offline" / sign-out):

```
DELETE /api/v1/presence  →  presence::redis::untrack_presence  →  HDEL + ZREM
                       ─→  broadcast::Sender::send(WsEvent::PresenceLeft …)
```

## Architecture decisions

### Redis schema — three keys per org

- `presence:org:{org_id}`  — HSET, field=`user_id`, value=`PresencePayload` JSON. Source of truth.
- `presence:org:{org_id}:expirations`  — ZSET, member=`user_id`, score=`last_seen_ts + 90s`. Cheap O(log N) eviction via `ZRANGEBYSCORE`.
- `presence:orgs`  — SET of org_ids that have at least one row. The evictor iterates this set instead of `KEYS presence:org:*` (banned in the OmniFrame ops playbook).

**Why three keys instead of one fancier structure:** each primitive is O(log N) at worst with well-understood ops characteristics. A `MULTI/EXEC` wrapper around all three writes was considered and rejected — it would prevent partial writes but serialise every track call through one Redis cluster node. For an ephemeral state store where 90s of stale data on one user is acceptable, the cost isn't worth it.

### Evictor cadence — 30s tick, 90s TTL

- 90s TTL = 3× foreground heartbeat (30s). One missed beat (network blip / JWT refresh) doesn't evict the user.
- 30s evictor cadence means a user closing their last tab is evicted within 90–120s (TTL + at most one tick). Inside the "awareness UX" budget for a logistics warehouse "who's around?" panel.
- Tighter cadence (e.g. 10s) costs more `ZRANGEBYSCORE` ops without buying a noticeable awareness boost.

### "First-vs-subsequent" (Joined vs. Updated) detection

`HEXISTS presence:org:{org_id} {user_id}` BEFORE the `HSET`. If `false` → broadcast `PresenceJoined`; if `true` → broadcast `PresenceUpdated`. Race window is harmless: if two tabs in the same session both land their HSET between our HEXISTS and HSET, we'll broadcast two `PresenceUpdated` events instead of one `Joined` + one `Updated`, which the FE handler unifies anyway.

### Loose `payload: serde_json::Value` instead of typed `PresencePayload`

The Rust side never inspects the payload's interior. Keeping it loose means a new field on the FE-side `PresencePayload` (custom emoji status, etc.) doesn't require a Rust release.

### `organization_id: Uuid` is REQUIRED on all three new variants (not `Option`-wrapped)

Matches the convention added by `WsEvent::SapAgentChanged`. The deny-by-default org-filter in `handle_socket`'s send loop covers them for free; making it `None` would silently bypass the filter. FE callers add a defence-in-depth org check anyway.

## File deltas

| File | Change |
|---|---|
| `rust-work-service/src/presence/mod.rs` | NEW — module re-exports (~25 LOC). |
| `rust-work-service/src/presence/redis.rs` | NEW — HSET/ZSET/SET helpers (track, untrack, get_org_presence, evict_expired, count, list_known_orgs, forget_org) (~250 LOC). |
| `rust-work-service/src/presence/evictor.rs` | NEW — 30s tokio task that sweeps, broadcasts `PresenceLeft`, and gauges (~120 LOC). |
| `rust-work-service/src/api/routes/presence.rs` | NEW — three REST endpoints under `/api/v1/presence` (heartbeat, online, untrack) (~250 LOC). |
| `rust-work-service/src/api/routes/mod.rs` | +5 LOC — `pub mod presence;` + `pub use presence::presence_routes;`. |
| `rust-work-service/src/lib.rs` | +1 LOC — `pub mod presence;`. |
| `rust-work-service/src/main.rs` | +14 LOC — `mod presence;` + `tokio::spawn(presence::evictor::run …)` + `nest("/api/v1/presence", presence_routes())`. |
| `rust-work-service/src/websocket/mod.rs` | +50 LOC — three new `WsEvent` variants (`PresenceJoined`, `PresenceUpdated`, `PresenceLeft`) + matcher arms for `organization_id()`. |
| `rust-work-service/src/observability/metrics.rs` | +50 LOC — three new metrics (`work_presence_active_users` gauge, `work_presence_track_total` counter, `work_presence_redis_errors_total` counter). |
| `src/lib/work-service/types.ts` | +25 LOC — three new `WsEventType` variants + `payload?: Record<string, unknown>` field. |
| `src/lib/presence/constants.ts` | +35 LOC — new `PRESENCE_MODE` const ('supabase' / 'rust' / 'disabled'). |
| `src/lib/presence/presence.service.rust.ts` | NEW — `PresenceServiceRust` class with the same surface as `PresenceService` (~620 LOC). |
| `src/lib/presence/index.ts` | rewrite — module facade selecting between Supabase + Rust impls at module load (~50 LOC). |
| `src/hooks/use-presence-tracker.ts` | -2 / +2 LOC — import `presenceService` from `@/lib/presence` (the facade) instead of `@/lib/presence/presence.service` (the literal Supabase impl). |
| `.env.example` | +20 LOC — `VITE_PRESENCE_MODE` documentation block. |

## Migration path

1. **Today (this PR):** ship Option 2 with default `PRESENCE_MODE='supabase'`. Behaviour is unchanged for all existing deployments.
2. **Internal smoke test:** run a local build with `VITE_PRESENCE_MODE=rust pnpm dev` against a `rust-work-service` running locally + a Redis instance. Verify the procedure in "Manual smoke test" below.
3. **Per-org rollout:** flip one small org first via build-time env. Soak 48h. Then a medium org. Then fleet. Phase A circuit-breaker stays active for the `'supabase'` path; the `'rust'` path has its own breaker.
4. **Per-org flag flow (future work):** the spec defers the per-org flag plumbing. Today's `VITE_PRESENCE_MODE` is build-time fleet-wide; an enhancement would read a per-org override from the `useUnifiedAuth` profile at module load before falling back to the env-var default. Tracked as a future enhancement; the facade in `src/lib/presence/index.ts` is the right place to plug it in.
5. **Once all orgs are on `'rust'`:** mark `'supabase'` deprecated. Remove in a follow-up after a quarter.

No DB migrations required for Option 2 — Redis is the state store. The `user_profiles.last_seen` heartbeat is preserved untouched by the Supabase implementation; the Rust implementation does not write `last_seen` (the affordance is handled in-memory + via the Rust HSET, which the analytics dashboard reads through a separate path if needed).

## Quality gate results

- `cargo build` — clean (only pre-existing warnings on `observability/middleware.rs` — Phase 12.6 reserved code).
- `cargo test` — all green on a clean run. Single intermittent flake (`negative_case_tampered_token_rejected_before_subscribe` — the same documented base64-no-pad reserved-bits flakiness as `tampered_signature_rejected`) reproduces on a re-run as a clean pass; documented in [[Migrate-SapAgentChanged-To-Rust-WS]].
- `cargo clippy --all-targets` — zero warnings introduced by my files.
- `pnpm tsc -b --noEmit` — clean (~22s).
- `pnpm build` — clean in 10.43s. Total JS 9779.54 KB; baseline (post `Migrate-Work-Queue-To-WS`) was 9770.08 KB; +9 KB delta accounts for the ~620 LOC `PresenceServiceRust` class. Pre-existing over-budget chunks unchanged.
- `npx eslint src/lib/presence/ src/lib/work-service/ src/hooks/use-presence-tracker.ts` — zero warnings on touched files.

## Manual smoke-test procedure

1. `cd rust-work-service && cargo run` — confirm boot logs show `presence evictor spawned (30s tick, 90s TTL)` alongside the existing settings + sap_agents listeners.
2. `VITE_PRESENCE_MODE=rust pnpm build && pnpm preview` — sign in to a tenant with `presence:view` permission.
3. Open DevTools → Network → WS frames. Confirm:
   - Subscribe message goes out (`{"type":"Subscribe","organization_id":"…"}`).
   - Within ~1.5s, a `POST /api/v1/presence/heartbeat` lands; response `{"broadcast":"PresenceJoined"}` (first time).
   - A `{"type":"PresenceJoined","user_id":"…","organization_id":"…","payload":{…}}` frame lands on the WS.
4. Open a second tab as a different user. Confirm tab 2's Online Users panel populates immediately (bootstrap snapshot path: `GET /api/v1/presence/online`); tab 1 sees a `PresenceJoined` frame for tab 2's user_id.
5. Tab 2 changes status to Busy. Confirm tab 1 receives a `PresenceUpdated` frame within ~1.5s (debounced).
6. Tab 2 picks Appear Offline. Confirm tab 1 receives a `PresenceLeft` frame within ~1.5s without waiting the 30s evictor.
7. Force-close tab 2 (Cmd-W). Wait 90–120s. Confirm tab 1 receives a `PresenceLeft` frame from the evictor.
8. With `redis-cli`: `HGETALL presence:org:{org_id}` shows the inspectable JSON payload per online user. `ZRANGE presence:org:{org_id}:expirations 0 -1 WITHSCORES` shows expirations sorted by deadline.
9. Visit `http://localhost:8030/metrics` — confirm `work_presence_active_users{org_hash="…"}`, `work_presence_track_total{op="track"|"untrack"|"evict"}` increment as expected.

## Future Tier 2 unlocks this enables

Per [[Roadmap-Rust-WS-Unlocks]] §4 — three product surfaces become genuinely cheap because Option 2 shipped:

- **4.1 Live "X is editing this row" soft-locking on DataTables** — natural extension of the presence Redis HSET. Same schema shape; sibling key `presence:focus:{org}:{entity_kind}:{entity_id}` HSET. Worker 3 is implementing this on top of the schema documented in [[Server-Side-Presence-Redis-HSET]].
- **4.2 Server-pushed notifications panel** — Rust holds a per-user Redis sorted-set; pushes deltas via `WsEvent::Notification`. Inherits this implementation's auth + org-filter machinery for free.
- **4.3 Richer dispatch broadcasts** — `WsEvent::PushedWork` extension for zone / role / explicit-user lists. The WS singleton is a known-stable surface for additions like this now.

## Coordination notes for Worker 3

Worker 3 is building entity soft-locking on top of this Redis pattern. Things to know about the schema:

- The `presence:orgs` SET is a generic "orgs we should iterate during eviction". Worker 3 SHOULD NOT pollute it with focus-only entries — pick a sibling set name (e.g. `presence:focus:orgs`) so the two evictors don't trip over each other.
- `org_hash_label()` (in `observability::metrics`) is the bounded label helper. Reuse it for any new metrics so prometheus storage stays finite.
- The evictor's `tokio::time::interval` with `MissedTickBehavior::Delay` is the right shape for any sibling sweep loop — see `evictor.rs` for the cadence + reconnect pattern.
- The `redis::TrackOutcome` enum + `HEXISTS-before-HSET` pattern is the canonical "first-vs-subsequent broadcast" recipe — copy it for entity-focus enter/leave.

## Constraints honoured

- Phase A / B2 / B3 surface intact — `presence.service.ts` is untouched. Default mode (`PRESENCE_MODE='supabase'`) is byte-for-byte the same behaviour.
- Hook surface unchanged — `usePresence`, `usePresenceOptional`, `usePresenceVisibility`, `useIsPresenceCandidate` keep the same contract.
- Org-filter security at every code path — Rust send loop deny-by-default + REST endpoint JWT claim resolution + FE defence-in-depth org check on incoming events.
- No new dependencies — reused existing `bb8-redis`, `axum`, `tokio`, `tracing`, `prometheus`, `chrono`, `serde`, `uuid`. FE reused the existing `WorkServiceWebSocket` + `fetch`.
- Migration is additive — default behaviour for any existing deployment is unchanged.
- No DB migrations applied — Option 2 has no DB schema changes (Redis is the state store).
- No new bundle-budget regressions — the +9 KB total JS delta is well under chunk thresholds.
- Did not touch sibling worker variants/files — `SapJobStatusChanged` / `ImportRunStatusChanged` etc. are Worker 2; `EntityFocus` / `Notification` / `PushedWork` extensions are Worker 3.

## Related

- [[ADR-Presence-Architecture-Next-Steps]] — Option 2 framing; this implementation realises it.
- [[Roadmap-Rust-WS-Unlocks]] — the broader migration plan; this is the headline foundational item.
- [[Harden-Presence-Service-Tenant-Overload]] — Phase A / B2 / B3 baseline preserved by this implementation.
- [[Migrate-SapAgentChanged-To-Rust-WS]] — sibling Tier 1 migration; same shape but with Postgres LISTEN/NOTIFY instead of Redis.
- [[Migrate-Work-Queue-To-WS]] — first "Bundle with Option 2" item (FE-only).
- [[Add-WsEvent-Lagged-Metric]] — observability sibling shipped same-day; the Lagged metric is what we'll watch as Option 2 multiplies event volume.
- [[Server-Side-Presence-Redis-HSET]] — the distilled Redis pattern this implementation establishes (companion Pattern note).
- [[Realtime-Presence-Browser-Hardening]] — the six-layer defence pattern this implementation extends with a seventh (server-side dedicated WS) layer.
- [[Components/PresenceUI - Status Indicators]] — the affected UI surface (rendering unchanged).
- [[Sessions/2026-05-06]] — session log.
