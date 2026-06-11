---
tags: [type/component, status/active, domain/backend, domain/realtime, domain/agent, domain/auth, domain/infra]
created: 2026-05-07
---

# Component: rust-work-service

Rust-based agent control plane. Replaces the OmniFrame on-prem agent's pre-Phase-0 dependency on direct Supabase Realtime + direct PostgREST RPC for queue + trigger + identity operations. Authoritative end-of-Phase-11 (v2.0.0 architecture-change boundary) overview.

## Purpose / Context

rust-work-service is the centralised agent orchestrator. It owns:

- **Per-org WebSocket fan-out** of row-event deltas sourced from Postgres `LISTEN/NOTIFY` triggers.
- **Agent queue control plane** — claim / complete / fail / heartbeat for `sap_agent_jobs` rows.
- **Server-side trigger DSL evaluator** — INSERTs `sap_agent_jobs` on row events that match admin-managed `agent_triggers` rules.
- **Agent identity** — service-key registration / exchange / revocation. Issues short-lived (15 min) `kind: "agent"` JWTs the agent uses for its own credentials.
- **Material Master mutations** — per-material Redis lock + RFC dispatch + audit append for SAP MM02-style writes.
- **Live console relay** — mirrors agent stdout to the SAP Console card via `WsEvent::SapAgentConsoleLine`.
- **Consolidated dashboard read API** — single endpoint backing the SAP Testing tab so the FE doesn't N+1 against PostgREST.

It does NOT own:

- Auth (delegates JWT validation to `rust-core-service` for user JWTs; verifies `kind:agent` JWTs locally).
- Domain mutations (the agent still writes `rf_putaway_operations`, `work_tasks`, `sap_audit_log`, `sap_agents` directly via Supabase PostgREST — those are domain-table writes, not control-plane). *2026-05-07 hot-fix:* `sap_audit_log` was previously listed as `sap_transaction_logs`; the agent had been POSTing to a retired table since migration 246 landed. Detail in [[Sessions/2026-05-07]] EOD cleanup Workstream A item 3.
- SAP COM (the agent does that on its Citrix box).
- Frontend rendering (TanStack Router + React 19 + shadcn/ui in the OmniFrame web app).

## Source of truth

- Repo path: `rust-work-service/` (NOT a Cargo workspace root — each Rust service has its own `Cargo.toml`).
- Build: `cargo build` in the service directory.
- Test: `cargo test --lib` (146 passing as of Phase 11; `cargo test --all-targets` will skip integration tests gated on a live PG/Redis).
- Clippy: `cargo clippy --lib --all-targets`.
- Deploy: independent Railway service (project `fac8472c-199b-41ec-8806-a869ee96e783`).

## Topology (post-Phase 11, updated v0.1.34 dual-pool)

```
                                  Browser
                                    |
                              HTTPS REST + WSS
                                    v
                          [rust-work-service]
                          /                  \
          PgListener (per channel)            bb8 sqlx pools (TWO pools)
          ├─ settings/listener                  ├─ db_pool (general purpose)
          ├─ sap_agents_listener                │   ├─ application_name="rust-work-service"
          ├─ sap_jobs_listener                  │   ├─ HTTP routes + scheduler + WS handler
          ├─ rf_putaway_listener                │   └─ Routes via WORK_SERVICE_DATABASE_POOLER_URL
          ├─ sap_import_runs_listener           │      (Supavisor :6543) when set, else direct
          ├─ cycle_count_listener               │
          ├─ lx03_listener                      └─ listener_db_pool (LISTEN/NOTIFY-safe)
          ├─ notifications_listener                 ├─ application_name="rust-work-service-listener"
          ├─ triggers/loader                        ├─ ALWAYS direct DATABASE_URL :5432
          └─ triggers/evaluator (per-table)         └─ Sized 30 to absorb all 13 listeners + INSERTs
              |                                       (LISTEN incompatible with txn pooling)
              v                                  |
         broadcast_event() helper —      bb8 Redis pool (max_size=50, min_idle=5)
         increments per-variant            ├─ presence, entity-focus
         counter, then tx.send             ├─ material locks (Phase 5)
              |                            ├─ trigger depth (Phase 9)
              v                            └─ revocation cache (Phase 10)
         per-client WSS rx
              |
              v
      Browser / omni_agent
```

### sqlx pool routing (Items 4 + 5, v0.1.34)

| Pool | URL source | Sized | `application_name` | Used by |
|---|---|---:|---|---|
| `db_pool` | `WORK_SERVICE_DATABASE_POOLER_URL` if set, else `DATABASE_URL` | 20 | `rust-work-service` | HTTP routes (`api::routes::*`), scheduler, WS handler, `AppState` |
| `listener_db_pool` | `DATABASE_URL` (always direct) | 30 | `rust-work-service-listener` | Every `*_listener.rs` consumer + `settings::listener` + `triggers::loader` + `triggers::evaluator` |

`listener_db_pool` MUST stay direct: `LISTEN/NOTIFY` requires a long-lived dedicated TCP backend that transaction-mode pooling multiplexes to death (sqlx `PgListener` against a transaction-pooled URL fails to receive frames at all). See [[Implementations/Implement-Rust-Work-Service-PgBouncer-Pooler]] for the rollout plan and expected database-connection-count delta.

`pg_stat_activity` audit query:

```sql
SELECT application_name, COUNT(*)
  FROM pg_stat_activity
 WHERE application_name LIKE 'rust-work-service%'
 GROUP BY 1;
```

## REST routes

Mounted in `src/main.rs` via `axum::Router::nest`. Public routes (no auth) are mounted on a separate router from protected routes (`require_auth` middleware).

### Public (no auth)

| Method | Path | Source | Purpose |
|---|---|---|---|
| GET | `/healthz` | `api/routes/health.rs` | Liveness + DB + Redis checks |
| POST | `/api/v1/agent-identity/exchange` | `api/routes/agent_identity.rs` | Trade plaintext service-key for 15-min `kind:agent` JWT |

### Protected (`require_auth`)

| Method | Path | Source | Purpose |
|---|---|---|---|
| GET | `/api/v1/work/tasks` | `api/routes/work.rs` | Work queue read |
| POST | `/api/v1/work/dispatch` | `api/routes/dispatch.rs` | WorkType dispatcher |
| GET | `/api/v1/workers` | `api/routes/workers.rs` | Active worker fleet |
| POST | `/api/v1/work/ws-token` | `api/routes/work.rs` | Mint 5-min HMAC subscribe-token (Phase 4) |
| GET | `/api/v1/presence` | `api/routes/presence.rs` | Per-org presence snapshot |
| GET / POST | `/api/v1/entity-focus` | `api/routes/entity_focus.rs` | Active-on-entity tracking |
| GET / POST | `/api/v1/notifications` | `api/routes/notifications.rs` | User notification feed |
| GET / POST | `/api/v1/sap-agents/jobs/{claim, complete, fail, heartbeat}` | `api/routes/sap_agents.rs` | Phase 7 — agent control plane |
| POST | `/api/v1/sap-agents/backfill-pending-confirms` | `api/routes/sap_agents.rs` | v0.1.35 — on-demand executor for the migration-289 putaway-confirm backfill SQL function. Pairs with the data-plane recovery loop in [[Implement-Putaway-Confirm-Backfill-Loop]] (the pg_cron path) — the route is the manual escape hatch admins click when they don't want to wait for the next 5-min tick. |
| POST | `/api/v1/sap-mutations/material-master/{bin,storage-types}` | `api/routes/sap_mutations.rs` | Phase 5 — Material Master writes (per-material lock) |
| POST | `/api/v1/sap-console/lines` | `api/routes/sap_console.rs` | Phase 6 — console relay sink |
| GET | `/api/v1/sap-testing/dashboard` | `api/routes/sap_testing.rs` | Phase 8 — consolidated read API; surfaces `service_capabilities` |
| GET / POST / PATCH / DELETE | `/api/v1/triggers` (+ `/preview`, `/allowlists`) | `api/routes/triggers.rs` | Phase 9 — admin trigger CRUD + dry-run + grammar surface |
| POST | `/api/v1/agent-identity/{register, revoke, list}` | `api/routes/agent_identity.rs` | Phase 10 — admin-only |

## WebSocket events

Defined in `src/websocket/mod.rs::WsEvent`. Each variant carries `organization_id` enforced by deny-by-default subscribe filter (Phase 2 hardening). Every production broadcast routes through the `crate::websocket::broadcast_event(tx, event)` helper which records `work_ws_messages_sent_total{variant=...}` BEFORE delegating to `tx.send` (Item 7a, v0.1.34) \u2014 the counter advances even when there are zero subscribers, which matches the operator mental model "did we publish anything?". `WsEvent::variant_name(&self) -> &'static str` is the source of truth for the `variant` label and is enforced exhaustive by the compiler. Adding a `WsEvent` variant without extending `metrics::KNOWN_WS_EVENT_VARIANTS` fails the `ws_event_variant_names_match_known_set` test.

| Variant | Source | Phase | Purpose |
|---|---|---|---|
| `SapAgentChanged` | `sap_agents_listener` (NOTIFY `sap_agent_changed`) | Phase 1 | Fleet card row updates |
| `SapJobStatusChanged` | `sap_jobs_listener` (NOTIFY `sap_agent_job_changed`, migration 271) | Phase 4 / Tier 1 | Job poller wake-up + per-job status fan-out |
| `RfPutawayChanged` | `rf_putaway_listener` (NOTIFY `rf_putaway_operation_changed`, migration 276) | Phase 4 | Trigger evaluator wake-up + browser RF putaway log refresh |
| `SapImportRunChanged` | `sap_import_runs_listener` | Pre-plan | LT22 import run progress |
| `CycleCountChanged` | `cycle_count_listener` | Pre-plan | Cycle count workflow |
| `Lx03Changed` | `lx03_listener` | Pre-plan | LX03 import progress |
| `NotificationCreated` | `notifications_listener` | Pre-plan | User notification fan-out |
| `SettingsChanged` | `settings/listener` | Pre-plan | WorkType settings hot-reload |
| `PresenceChanged` | `presence/evictor` | Pre-plan | Per-org presence evictor outcomes |
| `EntityFocusChanged` | `entity_focus/evictor` | Pre-plan | Active-on-entity TTL eviction outcomes |
| `SapAgentConsoleLine` | `api/routes/sap_console.rs` | Phase 6 | Live agent stdout fan-out |
| `TriggerFired` | `triggers/evaluator.rs` | Phase 9 | Admin live ticker for trigger fires (metadata only) |

## PgListeners

Each listener task is a single `tokio::spawn` block in `main.rs`. **As of 2026-05-07** all listeners route through [`crate::pglistener::run`] — a resilient wrapper around `sqlx::PgListener` with a per-channel keepalive watchdog (see [[Implementations/Implement-Resilient-PgListener]]).

The wrapper:

1. Connects via `sqlx::postgres::PgListener::connect_with(...)` AND `LISTEN <channel>` AND `LISTEN rust_work_service_keepalive`.
2. Forward loop: `select! { recv() | keepalive_tick }`. On every received frame (real or keepalive echo) refreshes an internal `last_message: Instant`.
3. Every 30 s emits `pg_notify('rust_work_service_keepalive', '<channel>')` via the main `PgPool` (separate connection, NOT the dedicated PgListener socket). Receiving the echo on the dedicated socket is the proof-of-life signal.
4. If `last_message.elapsed() > 90 s` at the next keepalive tick, treats the listener as wedged and force-reconnects with exponential backoff (1 s → 2 s → 4 s → … → 30 s capped).
5. Real notifications flow to a user-supplied `Fn(NotifyFrame) -> Future` callback. Bad payloads log `tracing::warn!` / `error!` and skip — listener task NEVER dies on a parse error.

The wrapper is BELT-AND-BRACES on top of sqlx's documented `PgListener::recv` auto-reconnect — it catches the case where sqlx's transparent reconnect itself silently fails (the original wedge mode that motivated this work). Per-channel observability surfaces on `/metrics`:

- `work_pglistener_status{channel}` (1 = subscribed, 0 = reconnecting)
- `work_pglistener_reconnects_total{channel}` (counter)
- `work_pglistener_last_message_age_seconds{channel}` (gauge — refreshed on each keepalive tick)
- `work_pglistener_keepalive_sent_total{channel}` (counter)
- `work_pglistener_keepalive_received_total{channel}` (counter)

As of v0.1.34 (Item 7b) the `_total` counters above are zero-initialised at boot via `observability::metrics::init_zero_value_series()` so the `/metrics` endpoint exposes the per-channel labels from the moment the service comes up — operational dashboards no longer wait for the first reconnect / keepalive to bring the series into existence. The known-channel array (`metrics::KNOWN_PGLISTENER_CHANNELS`) MUST stay aligned with the `tokio::spawn` blocks in `main.rs`; adding a new listener without extending the array means its series only materialise on the first reconnect.

Files: `pglistener.rs` (wrapper), `sap_agents_listener.rs`, `sap_jobs_listener.rs`, `rf_putaway_listener.rs`, `sap_import_runs_listener.rs`, `cycle_count_listener.rs`, `lx03_listener.rs`, `notifications_listener.rs`, `settings/listener.rs`, `triggers/loader.rs`, `triggers/evaluator.rs` (per-table sub-listeners).

Boot inventory — 13 resilient PgListener tasks at start (8 dedicated + 1 trigger_loader + 4 trigger_evaluator per-table). All `LISTEN` on their real channel + the shared keepalive channel; pg_stat_activity post-boot shows 13 backends each holding two `LISTEN` registrations.

### Listener resilience vs data-plane resilience

The listener-keepalive watchdog above is the **transport-layer** guarantee — it ensures NOTIFYs that DID get sent get DELIVERED to the trigger evaluator. It does NOT cover the case where the evaluator successfully INSERTed a `sap_agent_jobs` row but the agent's claim → SAP dispatch path failed transiently (e.g. SAP GUI logged out, control-not-found, watchdog timeout) and the job was left in terminal `status='failed'`. That gap is closed by the **data-plane** complement [[Implement-Putaway-Confirm-Backfill-Loop]] — a 5-minute pg_cron loop (migration 289) that requeues stale `failed` putaway-confirm jobs and replays NOTIFYs for true orphans, plus the `POST /api/v1/sap-agents/backfill-pending-confirms` route (v0.1.35) for on-demand draining. The two layers compose: the listener keeps the pipe open; the backfill keeps the work flowing through it.

## Middleware

`src/middleware.rs` — the auth backbone:

### `require_auth`

Auth precedence (Phase 10):

1. `X-Service-Key` header → `AuthIdentity::User { ..., role: "service" }` (machine-to-machine).
2. Bearer JWT where unverified `kind` claim is `"agent"` → verified locally via `agent_jwt::verify`, then revocation-checked via Redis cache (`agent-identity:revoked:<key_id>`) + DB fallback. → `AuthIdentity::Agent { agent_id, org_id, key_id }`.
3. Bearer JWT (any other shape) → validated via `rust-core-service` (legacy path) → `AuthIdentity::User { user_id, org_id, role }`.

For `AuthIdentity::Agent` the middleware ALSO synthesises an `AuthenticatedUser { user_id: agent_id, role: "agent", organization_id }` so legacy `Extension<AuthenticatedUser>` extractors keep working unchanged.

### `require_admin`

Helper that gates a route on `role IN ('admin', 'superadmin')` OR `service`. Rejects `AuthIdentity::Agent` and non-admin users with 403.

### Revocation cache (Phase 10)

`agent_key_is_revoked(state, key_id)`:

- Redis fast-path: `GET agent-identity:revoked:<key_id>` → `"1"` (revoked) or `"0"` (active).
- DB fallback on miss: `SELECT revoked_at FROM agent_service_keys WHERE id = $1`. Missing row → treat as revoked.
- Fail-closed: if both Redis AND Postgres are unreachable → `AuthError::ServiceUnavailable`.
- Best-effort cache write after every DB hit (60 s TTL).

### HTTP metrics (`observability/http_metrics.rs`)

Per-route Prometheus `http_request_duration_seconds_bucket{route="...", status="..."}` + `http_requests_total{route="...", status="..."}` + `http_response_size_bytes_sum{route="..."}`. Surfaced on `/metrics`.

## Modules outside `api/`

| Module | File | Purpose |
|---|---|---|
| `agent_jwt` | `src/agent_jwt.rs` | Phase 10 — issue + verify `kind:agent` JWT (HS256, `WORK_SERVICE_AGENT_JWT_SECRET`, 15-min TTL, `kind`-claim discriminator + signature verify) |
| `auth` | `src/auth.rs` | Auth client wrapping rust-core-service (validates user JWTs) + `validate_service_key` for `X-Service-Key` |
| `config` | `src/config/mod.rs` | Pydantic-style env-var settings with validation |
| `db` | `src/db/{mod,queries,models,pool_setup}.rs` | sqlx PgPool + prepared queries + sqlx model derives |
| `entity_focus` | `src/entity_focus/{mod,redis,evictor}.rs` | "Who's looking at entity X right now" tracker (TTL-driven) |
| `middleware` | `src/middleware.rs` | (covered above) |
| `observability` | `src/observability/{mod,metrics,http_metrics,middleware}.rs` | Prometheus metrics + HTTP middleware + replay-cache (idempotency, currently unused) |
| `presence` | `src/presence/{mod,redis,evictor}.rs` | Per-org presence + evictor (handles client disconnect cleanup) |
| `scheduler` | `src/scheduler/mod.rs` | sap_agent_schedules tick (fires queued jobs from cron expressions) |
| `settings` | `src/settings/{mod,listener,cache}.rs` | WorkType settings hot-reload (Item 12) |
| `strategies` | `src/strategies/{mod,pick,cycle_count,zone_audit}.rs` | DispatchStrategyRegistry (Item 12) |
| `triggers` | `src/triggers/{mod,config,dsl,loader,evaluator}.rs` | Phase 9 — server-side trigger DSL evaluator |
| `websocket` | `src/websocket/mod.rs` | WsEvent enum + per-org broadcast channel + subscribe-token verify + lagged-event recovery |
| `ws_token` | `src/ws_token.rs` | Phase 2 — HMAC subscribe-token mint + verify (5-min TTL) |
| `sap_agents_listener` / `sap_jobs_listener` / `rf_putaway_listener` / etc. | (top-level) | PgListeners, see above |

## Redis key namespace

- `presence:org:<org>` — hash, per-user fields. Phase 0 era.
- `presence:org:<org>:expires` — sorted set of TTL expiries. Driven by the evictor.
- `entity-focus:org:<org>` — same shape as presence, scoped per entity-id.
- `entity-focus:org:<org>:expires` — sorted set of TTL expiries.
- `material_lock:{org}:{material}` — SET-NX-EX (50-500 ms TTL during RFC). Phase 5.
- `trigger:depth:{org}:{row_id}` — INCR/EXPIRE counter, 60 s TTL, MAX_DEPTH=3. Phase 9.
- `agent-identity:revoked:<key_id>` — `"0"` or `"1"`, 60 s TTL. Phase 10.
- `ratelimit:agent-identity-exchange:<agent_id>` — sliding-window failure counter, 1 h TTL, 5-failure-per-hour budget. Phase 10.
- `ratelimit:sap-console:<agent_id>` — per-agent console-relay rate limit. Phase 6.

bb8 pool (Phase 11): `max_size=50`, `min_idle=5` — see [[Implement-Rust-Work-Service-Phase11#11.6 Rust — Redis pool sizing bump]] for the reasoning.

## Capabilities advertised

`api/routes/sap_testing.rs::DashboardResponse.service_capabilities`:

- `agent-identity-v2` (Phase 10) — service supports the v2 service-key identity model.

This is a service-level capability (not per-agent). Frontend can gate admin UIs on `service_capabilities.includes("agent-identity-v2")` for forward-compatibility.

## Known gaps

- **`work_tasks_changed` NOTIFY trigger** isn't installed (Phase 9 deferred). The triggers evaluator's allowlist already includes `work_tasks` but the listener attempt logs and skips. Once a future migration adds the NOTIFY trigger, work_tasks-sourced rules start firing without a Rust release.
- **`/healthz` doesn't aggregate per-listener task health.** A listener task that died silently (which shouldn't happen — they're defensive against parse errors — but defence-in-depth) would not surface in `/healthz`. Consider adding per-listener heartbeat sentinels.
- **No idempotency-key enforcement on Phase 5 / Phase 7 mutation routes.** Today the agent sends `Idempotency-Key` on `_apply_trigger_post_patch` and a few other paths, but rust-work-service doesn't store or enforce them yet — the `observability::middleware` replay-cache is built but unused (`cargo clippy` warns about the unused functions; left in-tree as forward-compat scaffolding).
- **Per-trigger Prometheus metrics on `/metrics`** are not yet promoted from the structured-log stream. Phase 9 deferred.
- **Trigger fires don't have a dedicated audit table** (`trigger_fire_log`). Today the audit trail IS the `sap_agent_jobs` row that the trigger INSERTs. Phase 9 deferred a retrospective-analysis-friendly shape.

## Related

- [[Implementations/Implement-Rust-Work-Service-Phase0-Phase1]] through [[Implementations/Implement-Rust-Work-Service-Phase11]] — phase notes.
- [[Implementations/Implement-Rust-Work-Service-Full-Integration-Summary]] — cross-phase arc.
- [[Decisions/ADR-Trigger-DSL-Evaluator-Phase9]] — trigger DSL grammar + security model.
- [[Decisions/ADR-Agent-Identity-V2-Phase10]] — service-key identity model.
- [[Decisions/ADR-Agent-2.0.0-Release]] — v2.0.0 release decision.
- [[Decisions/ADR-Rust-Work-Service-Availability-SLO]] — service availability target.
- [[Components/Omni-Agent - Headless SAP Agent]] — the agent that consumes this service.
