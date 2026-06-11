---
tags: [type/pattern, status/active, domain/backend, domain/realtime, domain/infra]
created: 2026-05-06
---

# Pattern: Server-Side Presence via Redis HSET + ZSET + tokio Evictor + WS Fan-out

## Purpose / Context

Distilled, reusable pattern for serving a per-org "who is X-ing right now" affordance from a dedicated Rust service instead of a multi-tenant managed-Realtime channel. Established 2026-05-06 in [[Implement-Presence-On-Rust-Option-2]] for the Customer-Portal Presence migration (Option 2 of [[ADR-Presence-Architecture-Next-Steps]]). Worker 3 is building Tier 2 entity soft-locking on top of the same shape; the pattern generalises to any "set of users currently focused on something" affordance (live edit indicators, in-flight job watchers, supervisor-zone heatmaps).

## When to apply

- You need a per-org (or per-entity, or per-channel) ephemeral presence map that says "who is here right now".
- The affordance is push-based with sub-second freshness (heartbeat + delta broadcasts), not poll-based.
- The state must auto-heal when a tab disappears — no explicit "sign-out" RPC required for cleanup.
- You want the state inspectable (`redis-cli HGETALL`) for ops debugging, not opaque.
- You're already running `rust-work-service` (or another Rust service with axum + bb8-redis + tokio + a per-org WS fan-out).

## Pattern — four moving parts

### Part 1: Redis schema — three keys per org

```
presence:org:{org_id}                   HSET   field=user_id  value=JSON-encoded payload
presence:org:{org_id}:expirations       ZSET   member=user_id  score=last_seen_ts + 90s
presence:orgs                           SET    org_ids that have at least one row
```

- HSET is the source of truth. Reads (`HGETALL`) serve `GET /api/v1/presence/online`.
- ZSET is the eviction channel. `ZRANGEBYSCORE … -inf {now}` finds expired user_ids in O(log N).
- SET is the iteration channel for the evictor (avoids `KEYS presence:org:*`, banned in our ops playbook).

Why three keys instead of one fancier structure: each primitive is O(log N) at worst with well-understood ops characteristics. A `MULTI/EXEC` wrapper would prevent partial writes but serialise every track call through one Redis cluster node — not worth it for ephemeral state where 90s of stale data on one user is acceptable.

### Part 2: REST endpoints (three)

| Method | Path                              | Purpose                                                       |
|--------|-----------------------------------|---------------------------------------------------------------|
| POST   | `/api/v1/{thing}/heartbeat`       | Bump the user's row + broadcast Joined/Updated.               |
| GET    | `/api/v1/{thing}/online`          | Snapshot the per-org HSET. Bootstrap call for new tabs.       |
| DELETE | `/api/v1/{thing}`                 | Explicit untrack + immediate Left broadcast.                  |

All three behind `require_auth`. JWT claims resolve `(user_id, org_id)`; the `(user_id, org_id)` pair scopes both the Redis writes AND the broadcast filter. **Never trust a client-supplied org_id** — the Rust handler resolves it from the validated claim.

### Part 3: First-vs-subsequent broadcast detection (Joined vs. Updated)

```rust
let existed: bool = conn.hexists(&hash_key, user_id).await?;
let _: () = conn.hset(&hash_key, user_id, &payload_json).await?;
let _: () = conn.zadd(&exp_key, user_id, expires_at).await?;
let _: () = conn.sadd(ORGS_SET_KEY, org_id.to_string()).await?;

if existed { TrackOutcome::Updated } else { TrackOutcome::Joined }
```

Caller broadcasts `WsEvent::PresenceJoined` on `Joined`, `WsEvent::PresenceUpdated` on `Updated`. The race window between HEXISTS and HSET is harmless — if two tabs land their HSET concurrently, the worst case is two `Updated` events instead of one `Joined` + one `Updated`, which the FE handler unifies anyway.

### Part 4: tokio evictor (30s tick, 90s TTL)

```rust
let mut ticker = tokio::time::interval(Duration::from_secs(30));
ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);

loop {
    ticker.tick().await;
    for org_id in list_known_orgs(&pool).await? {
        let evicted = evict_expired(&pool, org_id).await?;  // ZRANGEBYSCORE then HDEL+ZREM
        for user_id in &evicted {
            ws_tx.send(WsEvent::PresenceLeft { user_id, organization_id: org_id });
        }
        let count = count_org_presence(&pool, org_id).await?;
        WORK_PRESENCE_ACTIVE_USERS.with_label_values(&[&org_hash_label(&org_id)]).set(count);
        if count == 0 { forget_org(&pool, org_id).await?; }   // SREM presence:orgs
    }
}
```

Key choices:
- `MissedTickBehavior::Delay` — if the runtime stalls, don't "make up" a backlog of evictions; just take the next regular tick.
- TTL = 3× foreground heartbeat cadence (90s for a 30s heartbeat). Single missed beat (network blip / JWT refresh) doesn't evict.
- Lazy iteration-set cleanup: drop empty orgs from `presence:orgs` so the evictor doesn't scan empty buckets forever. The next track will SADD the org back.

## Integration with existing WS infrastructure

The pattern leans hard on the per-org `broadcast::Sender<WsEvent>` already in `rust-work-service` (`AppState::ws_broadcast`). Three new variants land additively:

```rust
WsEvent::{Affordance}Joined  { user_id: String, organization_id: Uuid, payload: serde_json::Value }
WsEvent::{Affordance}Updated { user_id: String, organization_id: Uuid, payload: serde_json::Value }
WsEvent::{Affordance}Left    { user_id: String, organization_id: Uuid }
```

Make `organization_id` REQUIRED (`Uuid`, not `Option<Uuid>`) so the deny-by-default org-filter in `handle_socket`'s send loop covers them for free. Loose `serde_json::Value` payloads keep the FE schema fluid without forcing a Rust release per FE field addition.

## Frontend mirror

The consumer side mirrors the existing presence service surface:

1. **Bootstrap call** — `GET /api/v1/{thing}/online` once at init so the panel populates immediately. Don't wait for the first WS frame.
2. **WS handler** — register on the existing `WorkServiceWebSocket` singleton; switch on `event.type` for the three new variants; defence-in-depth `event.organization_id !== orgId` check (the Rust send loop already filters, but a FE check keeps the cross-tenant invariant local to this consumer).
3. **Heartbeat coalescer** — same `TRACK_DEBOUNCE_MS` debouncer that Phase A's `scheduleTrack()` used; coalesces status flip + custom-text + idle re-entry within the same window into one POST.
4. **Failure breaker** — same six-layer pattern from [[Realtime-Presence-Browser-Hardening]]. Failure counters track POST failures + WS-disconnect periods; trip on threshold; cooldown grows exponentially.
5. **Visibility-aware cadence** — 30s foreground / 5min hidden / off when user-explicit "Appear Offline" / "Stop Editing".

## Observability

Three Prometheus metrics suffice:

- `{name}_active_users{org_hash}`  — IntGaugeVec sampled by the evictor each pass.
- `{name}_track_total{op="track"|"untrack"|"evict"}`  — IntCounterVec for ops dashboards.
- `{name}_redis_errors_total`  — IntCounter; non-zero ⇒ affordance is degraded for at least one client.

Bound `org_hash` cardinality through `org_hash_label()` (4 hex chars) so prometheus storage stays finite no matter how many tenants you onboard. Mirror the existing `WORK_WS_LAGGED_EVENTS_TOTAL` pattern.

## Tuning rules of thumb

| Knob                           | Default | Rationale |
|---|---|---|
| Heartbeat foreground cadence   | 30s     | Same as the FE's existing DB heartbeat. Keeps user perceived as "online" without saturating. |
| Heartbeat hidden cadence       | 5min    | Hidden tabs throttle setInterval anyway; explicit backoff documents intent. |
| Heartbeat coalesce window      | 1.5s    | Fast enough that humans don't notice; slow enough that flapping idle / reconnect storms collapse. |
| TTL                            | 90s     | 3× foreground heartbeat. One missed beat doesn't evict. |
| Evictor cadence                | 30s     | Equal to foreground heartbeat. User sees a logged-out colleague within 90–120s. |
| Failure-breaker window         | 60s     | Same as the Phase A circuit breaker. |
| Failure-breaker threshold      | 3       | Same as Phase A. |
| Initial breaker cooldown       | 5min    | Long enough for a transient outage to recover. |
| Breaker cooldown ceiling       | 30min   | Hard cap so a chronically broken backend doesn't lock the user out forever. |

## Anti-patterns to avoid

- **`KEYS presence:org:*` to enumerate orgs.** O(N) scan of the entire keyspace. Use the iteration `presence:orgs` SET.
- **Storing the payload as separate hash fields.** Schema drift between FE and Rust becomes a crisis. Store the JSON blob; let the FE own the schema.
- **Per-event-type label on metrics.** Multiplies cardinality. Label by `org_hash` only — a single org's metric can be derived from logs if you need event-type slicing.
- **`MULTI/EXEC` around HSET + ZADD + SADD.** Trades per-call serialisation for atomic-write semantics that don't matter for ephemeral state.
- **Trusting client-supplied org_id.** Always resolve from the validated JWT claim.
- **Skipping the bootstrap REST call.** New tabs would render an empty panel until the first WS event lands — noticeable UX regression vs. Supabase Presence's automatic state-sync on subscribe.
- **Optional `organization_id`.** Deny-by-default org filter only works on `Some(_)` event orgs. `None` would silently bypass cross-tenant isolation.
- **`while let Ok(…) = rx.recv().await` on the broadcast receiver.** Swallows `RecvError::Lagged(n)` silently. Match explicitly and increment `work_ws_lagged_events_total{org_hash}` per tick — see [[Add-WsEvent-Lagged-Metric]].

## Reference implementation

- `rust-work-service/src/presence/redis.rs` — HSET / ZSET / SET helpers (`track_presence`, `untrack_presence`, `get_org_presence`, `evict_expired`, `count_org_presence`, `list_known_orgs`, `forget_org`).
- `rust-work-service/src/presence/evictor.rs` — the 30s tokio task.
- `rust-work-service/src/api/routes/presence.rs` — the three REST endpoints (heartbeat, online, untrack).
- `rust-work-service/src/websocket/mod.rs` — the three new `WsEvent` variants + `organization_id()` matcher arms.
- `src/lib/presence/presence.service.rust.ts` — the FE `PresenceServiceRust` class mirroring the Phase A surface.
- `src/lib/presence/index.ts` — the module facade selecting between Supabase + Rust impls at module load.

## Related

- [[Implement-Presence-On-Rust-Option-2]] — the implementation note that establishes this pattern.
- [[ADR-Presence-Architecture-Next-Steps]] — the option-space review that picked Option 2.
- [[Realtime-Presence-Browser-Hardening]] — the six-layer browser-side defence pattern; this Pattern is the seventh (server-side dedicated WS) layer.
- [[Roadmap-Rust-WS-Unlocks]] — the Tier 2 affordances (entity soft-locking, notifications panel, richer dispatch) that build on this pattern.
- [[Add-WsEvent-Lagged-Metric]] — observability sibling that catches the silent-loss hazard as event volume grows.
- [[Migrate-SapAgentChanged-To-Rust-WS]] — sibling shape with Postgres LISTEN/NOTIFY instead of Redis HSET.
- [[Async-Library-Circuit-Breaker]] — the breaker pattern reused on both sides of the wire.
- [[Sessions/2026-05-06]] — session log.
