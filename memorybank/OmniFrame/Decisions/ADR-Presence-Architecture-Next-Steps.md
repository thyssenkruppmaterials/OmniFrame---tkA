---
tags: [type/decision, status/proposed, domain/frontend, domain/backend, domain/realtime, domain/infra]
created: 2026-05-06
---
# ADR: Presence Architecture — Next Step After Phase A + B2 + B3

## Status

**Status: IMPLEMENTED 2026-05-06** — Option 2 shipped end-to-end. See [[Implement-Presence-On-Rust-Option-2]] for the implementation note (Rust presence module + Redis HSET schema + 30s evictor + three new `WsEvent` variants + `PresenceServiceRust` FE class + `VITE_PRESENCE_MODE` build-time selector). The `'supabase'` mode (Phase A + B2 + B3) remains the default; `'rust'` mode flips the whole fleet via env var. Per-org rollout is deferred to a follow-up but the facade in `src/lib/presence/index.ts` is the right place to plug it in.

**Proposed.** Recommendation: do nothing more for 4 weeks (watch the shard); if `Presence_shard112` still flares OR the org grows past ~80 concurrent sessions, ship **Option 2 — Server-side Presence in `rust-work-service`** (extend the existing `/ws` infrastructure with three new `WsEvent` variants + a Redis-backed per-org presence set). Do **not** ship Phase B1 (multi-tab leader election via `BroadcastChannel`); it's improvisational against the wrong layer.

## Context

### What we already shipped (2026-05-06)

Phase A (six surgical fixes inside `src/lib/presence/*`) plus Phase B2 (permission opt-out) plus Phase B3 (drop `current_page` from broadcast) — collectively reduce per-tab `.track()` RPC volume on `presence-org-{org_id}` (which hashes to `Presence_shard112` for tenant `c9d89a74`) by an estimated 75–85%, AND remove RF / time-clock / customer-portal-public routes from the channel entirely. See:

- [[Debug/Fix-CustomerPortal-Presence-Tenant-Overload]]
- [[Implementations/Harden-Presence-Service-Tenant-Overload]]
- [[Patterns/Realtime-Presence-Browser-Hardening]]

### The remaining question

Phase B1 — multi-tab leader election via `BroadcastChannel` — was deferred. The user's instinct is that B1 feels like improvisation. This ADR evaluates the full option space, with specific attention to leveraging the existing Rust services (`rust-core-service`, `rust-work-service`, etc.).

### Architectural facts that constrain the answer

1. **The bottleneck is a single Supabase Realtime shard** (`Presence_shard112`) per tenant. Every authenticated tab in the org joins ONE channel (`presence-org-{org_id}`) keyed by `userId`. Wedging the shard's GenServer wedges presence org-wide — and starves the same Postgres pool/network egress that GoTrue uses, which is why the original symptom was "users stuck at sign-in."
2. **`rust-work-service` already has a full org-scoped WebSocket fan-out.** `src/main.rs` exposes `/ws` on port 8030 with: token-based subscribe (`WS-Subscribe-Token`, HMAC-SHA256, 5-min TTL via `ws_token.rs`), per-org `Subscribe { organization_id }` filter, deny-by-default cross-tenant isolation, `tokio::sync::broadcast` backbone (`broadcast::channel(1000)`), client heartbeat handling, `WsSubscriberGuard` Prometheus metric. `WsEvent` is an open enum — adding three variants is wire-compatible.
3. **`rust-core-service` already has the Redis + Postgres + JWT primitives.** `cache::redis_pool::CacheService` (bb8-redis), `auth::jwt::JwtValidator` (RS256 + JWKS cache + HS256 fallback), `sqlx::PgPool`, `cache::session::SessionService`. A new module would be additive, not foundational.
4. **The frontend already has a singleton WS client to `rust-work-service`.** `src/lib/work-service/websocket.ts` (`WorkServiceWebSocket` class) handles connect, exponential-backoff reconnect, ping interval, subscribe/unsubscribe, organisation routing, error fanout, ConnectionState gauge. Adding a presence handler is one new event-handler registration, not a new client.
5. **`user_profiles.last_seen` is already maintained by the heartbeat.** The "who's online" affordance can be reconstructed from `WHERE last_seen > now() - interval '90 seconds'` cheaply at the SQL layer.
6. **No other channel in the app uses Supabase Presence.** Every other `supabase.channel(...)` call is `postgres_changes`. If we kill the presence channel, we kill the entire `presence` API surface for this org's tenant — no migration headaches for sibling features.

## Options Considered

The dimensions table appears below in the Decision section. Per-option summary:

### 1. B1 — Multi-tab leader election via `BroadcastChannel`

Client-only. One tab per `userId` is elected leader and owns the channel + heartbeat; followers receive state via `BroadcastChannel`. ~600 LOC. Reduces per-user load by ~75% **for users with 3+ tabs**. Genuine new failure modes: split-brain on iframes/profile-isolated contexts, leader-crash gap of 5–10s where the user "appears offline" to the org, `beforeunload` unreliability, Safari < 15.4 polyfill, testing matrix explosion (1-tab / 2-tab / N-tab × foreground / hidden / offline / crash). **Doesn't fix the architecture; just makes us slightly better tenants of the wedged shard.**

### 2. Server-side presence in `rust-work-service` (extend `/ws`)

Browser → existing `WorkServiceWebSocket` → `rust-work-service /ws`. Extend `WsEvent` enum with `PresenceJoined { user_id, org_id, payload }`, `PresenceLeft { user_id, org_id }`, `PresenceUpdated { user_id, org_id, payload }`. Add `POST /api/v1/presence/heartbeat` (HTTP) and a `WsClientMessage::PresenceHeartbeat { status, custom_status_text }` (WS). Server stores per-org presence in Redis as `presence:org:{org_id}` (HSET `user_id → JSON`, TTL 90s). Background tokio task evicts expired entries and broadcasts `PresenceLeft` via the existing `broadcast::Sender<WsEvent>`. Browsers receive deltas via the WS they already have for work-engine. **Removes the org-wide presence channel entirely** — `Presence_shard112` load from this app drops to zero. ~800–1200 Rust LOC, ~400 frontend LOC, ~2 weeks.

### 3. Poll-based aggregation via `rust-core-service`

Drop the `presence` channel entirely. Browser polls `GET /api/v1/presence/online` every 30s (foreground) / 5min (hidden). Rust serves from a Redis cache (`SMEMBERS presence:org:{org_id}`) refreshed by the existing heartbeat path. ~200 Rust + ~300 frontend LOC, ~3–5 days. **100% removal of Realtime presence load.** UX cost: status changes lag up to 30s. For a logistics warehouse "who's around?" panel, this is invisible — the affordance is awareness, not chat.

### 4. Postgres `LISTEN/NOTIFY` relayed via Rust SSE/WS

Add a trigger on `user_profiles` (`AFTER UPDATE OF last_seen`) that emits `NOTIFY presence_changed`. `rust-work-service` consumes via `sqlx::postgres::PgListener` and broadcasts deltas. Removes Realtime presence dependency entirely. ~600 Rust LOC + 1 migration. Higher Postgres load (one notify per heartbeat × N users) — only attractive if we want sub-second freshness without paying the per-tab Supabase Realtime cost. **Probably wrong tradeoff for a warehouse app.**

### 5. Rust BFF fan-in/fan-out from Supabase Presence

`rust-work-service` becomes the SOLE Supabase Realtime client per org (one Phoenix Channels connection per org instead of N). It demuxes presence events to the N browser sockets it already serves. Requires a Phoenix Channels Rust client (`phoenix-channels-client` crate exists, by LiveView Native team — but it's not in our deps and adds a non-trivial integration surface). **Reduces shard load proportional to (N tabs / 1 server connection per org) — roughly 50–100×.** But complex: the server has to maintain a fragile 3rd-party WS to Supabase per org, plus reconnect logic, plus a way to keep Supabase as the source of truth. 1500+ Rust LOC, 3+ weeks. Trades app-side complexity for infra-side complexity. **Not recommended unless we have other reasons to broker Supabase Realtime via Rust.**

### 6. Edge function pre-aggregation

Supabase Edge Function periodically writes a `presence_snapshot` row; browsers subscribe to that table's `postgres_changes`. Trades presence-shard load for postgres-changes-shard load on the same tenant. **Doesn't actually solve the tenant-overload problem; just relocates it.**

### 7. Channel sharding by sub-tenant

`presence-org-{org_id}-{shard_n}` keyed by `hash(user_id) % N`. Cuts membership per shard but every browser must subscribe to ALL shards to compute "who's online", so per-browser load stays the same and new bug surface (cross-shard sync, missed events on shard rebalancing) appears. **Net negative.**

### 8. Hybrid — Phase A + selective Rust

Keep Phase A (it works), and use Rust ONLY for the multi-tab fan-out problem that B1 addresses. Concretely: rust-work-service holds one canonical "user N is online" entry per `(org, user)` pair regardless of tab count. A browser tab reports its presence to Rust; Rust de-dups and either broadcasts to other org members itself (= Option 2) or re-publishes to Supabase Presence as a single tracker (= Option 5 lite). **Mostly subsumed by Option 2.**

### 9. Do nothing more — watch the shard

Phase A + B2 + B3 already delivered ~75–85% reduction. Set up a 4-week monitoring window. If `Presence_shard112` stays healthy, the work is done — building B1 or any new infra is over-engineering. Cost: 0 LOC. Risk: at week 4 we still need a fix and we lost 4 weeks of runway. **Mitigated by the fact that Phase A's circuit-breaker means a regression is graceful, not catastrophic.**

### 10. Switch from `presence` channels to `broadcast` channels

Supabase Presence is built on top of Broadcast plus a server-side participant tracker. Using raw Broadcast (each user pushes status, no auto-departure) would lose the auto-detect-offline behaviour we get for free today. We'd need to re-implement that on top — either via heartbeat timeouts (= Option 3 with extra plumbing) or via `last_seen` polling (= Option 3 directly). **No advantage over Option 3.**

## Decision

### Recommendation matrix

| # | Option | Reduction vs. now | Effort | New failure modes | Ops cost | UX impact | Reversibility |
|---|---|---|---|---|---|---|---|
| 1 | **B1 — leader election** | ~75% per power user only | ~600 LOC FE, 2 wk | split-brain, 5–10s "appears offline" gap, Safari polyfill | none | visible offline blips on tab close | easy |
| 2 | **Rust WS presence (`work-service`)** | 100% (shard load → 0) | ~800–1200 Rust + ~400 FE, ~2 wk | rust-work-service becomes presence SPOF (mitigated by Phase A breaker fallback) | reuse Railway service | zero (sub-second push retained) | medium (per-org feature flag) |
| 3 | **Poll via `rust-core-service`** | 100% (shard load → 0) | ~200 Rust + ~300 FE, ~3–5 d | up to 30s status freshness lag | reuse Railway service | "Sarah's status changed" lags 30s | trivial |
| 4 | LISTEN/NOTIFY relay | 100% | ~600 Rust + 1 mig, ~1.5 wk | trigger amplifies Postgres write load | new trigger | none | medium |
| 5 | Rust BFF subscribes to Supabase | ~50–100× reduction | ~1500 Rust, 3+ wk | server-held WS-to-Supabase per org, reconnect storms move into Rust | new dep (`phoenix-channels-client`) | none | hard |
| 6 | Edge function snapshot | shifts load, doesn't reduce | ~1 wk | postgres_changes shard becomes new bottleneck | edge function ops | none | medium |
| 7 | Sub-shard the channel | net 0 / negative | ~400 LOC FE | cross-shard sync bugs | none | none | medium |
| 8 | Hybrid (subset of 2) | same as Option 2 | same as Option 2 | same as Option 2 | same as Option 2 | none | medium |
| 9 | **Watch and see** | already delivered | 0 LOC | none | none | none | n/a |
| 10 | Broadcast instead of Presence | none, just rebuilds Option 3 | ~400 FE | re-invents auto-departure | none | depends | medium |

### Decision

**Two-step recommendation, in this order:**

**Step 1 (immediate, recommended NOW): Option 9 — do nothing more for 4 weeks.**

Phase A + B2 + B3 has plausibly delivered the load reduction we need. The cheapest "fix" that respects the user's time is recognising the work may already be done. Set up monitoring on:

- `Presence_shard112` health (Supabase support ticket already open — track resolution).
- Per-tab `.track()` RPC count via a simple instrumented counter wired to the existing logger (5 LOC).
- Browser `[Presence] Channel error breaker TRIPPED` log volume across the fleet.

If, after 4 weeks, the shard stays healthy and breaker-trip volume is < 1/day org-wide, declare victory. This is the path the user's instinct ("I feel like B1 is improvisation") is implicitly asking for: validate the existing fix before piling on more.

**Step 2 (if and only if Step 1 doesn't hold OR the org grows past ~80 concurrent authenticated tabs): Option 2 — server-side presence in `rust-work-service`.**

Why Option 2 over Option 3:

- **Option 2 preserves the real-time UX.** Status changes still propagate sub-second to other tabs in the org. No degradation vs. today.
- **Option 2 reuses ~80% of existing infrastructure.** The hardest parts — auth (JWT via rust-core), org isolation (deny-by-default Subscribe), fan-out (`broadcast::channel(1000)`), client reconnect (`WorkServiceWebSocket`) — already exist. The new code is three `WsEvent` variants, one Redis-HSET-backed per-org presence map with a 90s TTL eviction loop, and a presence handler in the frontend's WS subscriber.
- **Option 2 fits the team's stated direction.** The repo has been steadily migrating hot paths into Rust (`rust-core-service` for prepared queries, `rust-work-service` for work queue, `rust-streaming-service` for camera, `rust-mdm-service` for devices). Putting presence in Rust is consistent with that arc.
- **Option 2 removes the ENTIRE Supabase Realtime presence dependency for the app**, not just shaves off a slice. `Presence_shard112` load from this app drops to zero — there's no shard to wedge.

Why NOT B1:

- B1 is the only option in the matrix that **doesn't fix the architecture** — it just makes us a more polite tenant of a fundamentally fragile shard.
- B1 only helps the subset of users who have 3+ tabs. The customer-portal CSR (the original symptom) typically has ONE tab open all day, so B1 buys nothing for the most-affected user class.
- B1 introduces user-visible "appearing offline" gaps on leader handoff. Phase A made the channel more robust without any UX regression. B1 trades away that property.
- B1 costs ~600 LOC of net-new client complexity. Option 2 costs ~1200 LOC across two services, but ~80% of those LOC are pattern-matched against existing code (the WS handler structure is already there in `rust-work-service/src/websocket/mod.rs`; the client is already there in `src/lib/work-service/websocket.ts`).

## Consequences

### If we adopt Step 1 (do nothing for 4 weeks)

- **Positive:** No new code, no new failure modes, no new infrastructure. The ~75–85% reduction we already shipped gets to actually be measured.
- **Positive:** Frees the next sprint's capacity for higher-leverage work (Work Engine roadmap, etc.).
- **Negative:** If the shard re-wedges in week 2, we've lost 2 weeks of recovery runway. Mitigated because the Phase A breaker means a re-wedge is graceful — the channel goes quiet for 5–30 min, then re-tries — rather than catastrophic.

### If we adopt Step 2 (Rust WS presence) later

- **Positive:** `Presence_shard112` load from this app drops to zero. No future Supabase Presence shard outages can touch us.
- **Positive:** Total Realtime tenant load drops measurably (presence is one of the highest-fanout channels in the app).
- **Positive:** The presence model becomes legible — a Redis HSET we can inspect, a tokio task we can profile — instead of an opaque Phoenix GenServer at our cloud provider.
- **Negative:** New SPOF. If `rust-work-service` is down, presence is broken org-wide. Mitigation: keep the Phase A circuit-breaker code path; on rust-work-service unreachable, the breaker fires and the UI shows "presence offline" gracefully (same path as today's Realtime breaker).
- **Negative:** Adds presence to the surface area of `rust-work-service`. Currently it's "work queue + dispatcher" — adding presence widens its responsibility. Mitigated by: presence is just three new `WsEvent` variants on the existing fan-out backbone; the work-service team already owns the WS infrastructure.
- **Negative:** Per-org migration cost — needs a feature flag (`VITE_PRESENCE_MODE='supabase' | 'rust' | 'disabled'`) and a 1-week dual-write phase to validate.
- **Negative:** Introduces a new `WS-Subscribe-Token` issuance for tabs that don't otherwise need work-service WS (e.g. read-only roles). Mitigated by: token issuance is a 5min TTL HMAC, very cheap.

### If we DON'T do either (keep coasting on Phase A indefinitely)

- Risk: org grows past ~80 concurrent tabs and Phase A's debouncer no longer keeps the shard healthy. Phase A bought us a 75–85% reduction; growth proportionally erodes it.
- The Phase A + breaker combo means the failure mode is "presence gracefully degrades" not "users can't sign in" — so this is a livable risk, but it's a ceiling.

## Concrete next-step proposal (for Step 2 when triggered)

**Scope (~2 weeks, 1 engineer):**

Week 1 — Rust:
1. New module `rust-work-service/src/presence/` with `mod.rs`, `redis.rs` (HSET helpers), `evictor.rs` (tokio task evicting entries with `last_seen < now() - 90s`).
2. Three new `WsEvent` variants: `PresenceJoined`, `PresenceUpdated`, `PresenceLeft`. Wire-compatible (existing FE deserialisers tolerate unknown variants via `serde(other)` or skip).
3. New `WsClientMessage::PresenceHeartbeat { status, custom_status_text }`.
4. New `POST /api/v1/presence/heartbeat` (HTTP fallback, same shape as the WS message — for tabs not yet WS-connected).
5. New `GET /api/v1/presence/online` (returns the current Redis HSET as a list — bootstrap call for new tabs before the WS catches up).
6. Tests: integration test against a real Redis verifying join/update/leave/evict with three concurrent simulated tabs.

Week 2 — Frontend + cutover:
1. New `VITE_PRESENCE_MODE` env var: `'supabase'` (current default) | `'rust'` (new) | `'disabled'` (existing kill switch). Fold into `presence.service.ts`'s `PRESENCE_DISABLED_ENV` resolution.
2. New `PresenceServiceRust` class implementing the same surface as `PresenceService` but talking to `rust-work-service` over the existing `WorkServiceWebSocket`. Bootstrap: `GET /api/v1/presence/online` once → set initial state. Subsequent: WS deltas. Heartbeat: WS or HTTP fallback (both routes wired).
3. Service factory in `presence.service.ts` chooses `PresenceService` or `PresenceServiceRust` at module load based on `VITE_PRESENCE_MODE`. Hook surface (`usePresence`, `usePresenceVisibility`, `useIsPresenceCandidate`) is unchanged.
4. Per-org rollout: 1 small org → 1 medium org → all orgs, with a 48h soak between steps. Phase A circuit-breaker stays active for the `'supabase'` path; `'rust'` path inherits the existing `WorkServiceWebSocket` reconnect logic.
5. Once all orgs are on `'rust'`, mark `'supabase'` deprecated; remove in a follow-up after a quarter.

**Owner:** ideally the same engineer who shipped Phase A (deepest context on the affordance). **Reviewers:** rust-work-service maintainer for the Rust delta; auth-platform for the WS token shape.

## What would change this recommendation

- If Supabase ships an upstream fix for the `Presence_shard112` GenServer wedging that Supabase support has already been notified about, Option 9 + monitoring becomes the permanent answer and Option 2 is unnecessary.
- If the org grows to multi-warehouse scale (200+ concurrent tabs per org), Option 5 (Rust BFF subscribes to Supabase Presence) starts to look attractive again because it amortises one Supabase WS across many browser WS — the math gets favourable at scale that we don't have today.
- If the team picks up another use case for server-pushed events that crosses into "real-time chat" UX (e.g. in-app messaging), the calculus shifts toward building richer Rust presence/messaging primitives — at which point Option 2 grows naturally into a "presence service" rather than a tactical fix.

## Follow-on opportunities

If/when Option 2 ships, see [[Roadmap-Rust-WS-Unlocks]] for the Tier 0 / 1 / 2 / 3 catalogue of what the new per-org Rust WS bus enables — including the `useAgentDetection` + `agents-fleet-card` migration (highest-ROI Tier 1 pick) and a one-day validation spike to run BEFORE the Option 2 Rust week starts.

## Related

- [[Debug/Fix-CustomerPortal-Presence-Tenant-Overload]] — the diagnosis + Phase A audit + B2/B3 follow-ups.
- [[Debug/Fix-Realtime-Tenant-Overload]] — agent-side companion fix (v1.8.4); same pattern.
- [[Implementations/Harden-Presence-Service-Tenant-Overload]] — implementation note for the Phase A + B2 + B3 work.
- [[Patterns/Realtime-Presence-Browser-Hardening]] — the browser-side defence pattern this ADR builds on.
- [[Patterns/Async-Library-Circuit-Breaker]] — server-side counterpart pattern, also informs the rust-work-service evictor design.
- [[Components/Omni-Agent - Headless SAP Agent]] — agent component (consumed Realtime; Phase A counterpart).
- [[Components/PresenceUI - Status Indicators]] — the affected UI surface (would be unchanged under Option 2).
- [[ADR-Auth-Architecture]] — JWT validation flow that any Rust-hosted presence inherits.
- [[Sessions/2026-05-06]] — the session this ADR was written in.
