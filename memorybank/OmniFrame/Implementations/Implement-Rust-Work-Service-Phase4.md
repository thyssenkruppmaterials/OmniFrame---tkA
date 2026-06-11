---
tags: [type/implementation, status/active, domain/agent, domain/realtime, domain/backend, domain/infra, domain/database]
created: 2026-05-06
---

# Implement Rust Work Service — Phase 4 (THE HEADLINE)

Phase 4 of the comprehensive [[plans/rust_work_service_full_integration_5b88165d.plan]] (Phases 0+1 captured in [[Implement-Rust-Work-Service-Phase0-Phase1]], Phase 2 telemetry foundation in [[Implement-Rust-Work-Service-Phase2]], Phase 3 fleet snapshot in [[Implement-Rust-Work-Service-Phase3]]). Retires the OmniFrame on-prem agent's direct Supabase Realtime dependency and replaces it with the `rust-work-service /ws` bus. Net deletion target after parallel-run: ~400 LOC from `omni_agent/agent.py`.

## Purpose / Context

The largest single piece of work in the plan (~3-4 days). The on-prem agent (`omni_agent/agent.py`) is the most aggressive Supabase Realtime client in the system: `_start_realtime_subscription` opens 3 long-lived channels (`sap_agent_jobs`, `rf_putaway_operations`, `work_tasks`) plus the v1.7.1→v1.8.4 `_RealtimeCleanCloseTracker` / `_RealtimeCircuitBreaker` / exponential cooldown ladder layered on top after the 2026-05-06 `Presence_shard112` GenServer overload incident. With the work-service-broadcast `WsEvent::SapAgentChanged`, `SapJobStatusChanged`, `RfPutawayChanged`, and the WS auth-token mint already shipped, the agent can drop all three Realtime channels in favour of a single `/ws` connection.

Phase 4 ships the migration **behind a feature flag** (`OMNIFRAME_AGENT_USE_RUST_WS`, default `0`). Both paths coexist; only one runs per agent process. After ~3 days of parallel-run telemetry showing event-rate parity, the operator flips the default to `1` and v1.10 deletes the legacy ~400 LOC.

## Scope shipped

### 4.1 New `RfPutawayChanged` infrastructure (Rust + DB)

#### Migration 276 — `notify_rf_putaway_changed`

[supabase/migrations/276_notify_rf_putaway_changed.sql](../../../supabase/migrations/276_notify_rf_putaway_changed.sql) — applied via Supabase MCP `apply_migration`. `AFTER INSERT OR UPDATE` trigger on `public.rf_putaway_operations` ships `row_to_jsonb(NEW)` only:

```sql
PERFORM pg_notify('rf_putaway_operation_changed', json_build_object(
  'row_id',           NEW.id,
  'organization_id',  NEW.organization_id,
  'op',               TG_OP,
  'new',              row_to_jsonb(NEW)
)::text);
```

`organization_id` is `NOT NULL` on the table (verified pre-deploy via `information_schema.columns`). `row_to_jsonb(NEW)` matches the agent's `_on_rf_putaway_change` evaluator surface 1:1 — the evaluator only inspects `to_status`, `is_mca_workflow`, `confirmed_source`, `to_number`, `warehouse`, all in `NEW`. Idempotent — safe to re-run.

**Deferred to Phase 11:** `REPLICA IDENTITY FULL → DEFAULT` flip on `rf_putaway_operations`. Audit step gates that change once direct FE Realtime consumers are gone.

#### `WsEvent::RfPutawayChanged` variant

[rust-work-service/src/websocket/mod.rs](../../../rust-work-service/src/websocket/mod.rs) — added the variant + matched arm in `WsEvent::organization_id()`. `organization_id` is REQUIRED (non-`Option`) — the deny-by-default org-scope filter in `handle_socket`'s send loop covers it for free. `new` is `serde_json::Value` (loose-typed) so the Rust crate doesn't have to mirror the on-disk schema.

```rust
RfPutawayChanged {
    row_id: Uuid,
    organization_id: Uuid,
    op: String,                 // 'INSERT' | 'UPDATE'
    new: serde_json::Value,     // row_to_jsonb(NEW)
}
```

#### `rf_putaway_listener.rs`

[rust-work-service/src/rf_putaway_listener.rs](../../../rust-work-service/src/rf_putaway_listener.rs) — NEW. Mirrors [sap_agents_listener.rs](../../../rust-work-service/src/sap_agents_listener.rs) 1:1. `PgListener` subscribed to `rf_putaway_operation_changed`, parses payload → builds `WsEvent::RfPutawayChanged` → broadcasts via the existing `broadcast::Sender<WsEvent>`. Bad payloads log `tracing::error!` and skip — listener task NEVER dies on a parse error. Reconnect with exponential backoff on connection-level errors (1s → 60s cap, same shape as the other listeners).

Wired into [rust-work-service/src/main.rs](../../../rust-work-service/src/main.rs) + [lib.rs](../../../rust-work-service/src/lib.rs) next to the other listener spawns. Boot log: `rf_putaway listener spawned (LISTEN rf_putaway_operation_changed)`.

#### TypeScript types

[src/lib/work-service/types.ts](../../../src/lib/work-service/types.ts) — added `'RfPutawayChanged'` to `WsEventType` plus a `new?: Record<string, unknown>` field on the flat `WsEvent` shape (`row_id`, `op`, `organization_id` already existed from prior migrations). **Frontend code does NOT subscribe to this variant** — it's agent-only.

### 4.2 Agent WS client — `omni_agent/work_service_ws.py` (NEW)

[omni_agent/work_service_ws.py](../../../omni_agent/work_service_ws.py) — single-connection asyncio WS client. ~280 LOC.

Key design decisions:

1. **Single thread, asyncio loop on it** — mirrors v1.7.0 / v1.8.0 Realtime singleton. One dedicated `omni-work-service-ws` daemon thread runs the asyncio loop. Event handlers (`on_event`) dispatch on the same thread.
2. **Token mint via plain HTTPS** — `POST /api/v1/work/ws-token` with the user JWT in the `Authorization: Bearer …` header returns a 5-min HMAC-signed `WS-Subscribe-Token`. The token is appended as `?token=…` on the upgrade URL (canonical channel — see [Roadmap-Rust-WS-Unlocks](../Decisions/Roadmap-Rust-WS-Unlocks.md) Phase 2.0 v1 decision). Clean 401 on stale JWT instead of an opaque `apikey=` handshake.
3. **Reconnect ladder** — 5s initial, additive +5s per attempt, 60s cap. Resets to 5s only after a 60s+ stable run. Same semantics as v1.8.4 Realtime ladder but **no local circuit breaker** — the work service's own breaker (Phase 2 telemetry: `work_ws_broadcast_buffer_pct`, `work_service_ws_lagged_events_total`) is the authoritative reliability signal. Operators investigate `rust-work-service /metrics` rather than tweaking agent thresholds.
4. **Soft import for `websockets`** — mirrors `_HAVE_REALTIME` in `agent.py`. Missing dep ⇒ WS client transparently unavailable, agent stays on Supabase Realtime path.
5. **Constructor takes zero-arg providers** — `token_provider` / `org_provider` callables are re-invoked on every reconnect so a refreshed JWT is picked up automatically.

```python
client = WorkServiceWsClient(
    token_provider=lambda: state.supabase_token or '',
    org_provider=lambda: state.org_id or '',
    on_event=_on_work_ws_event,
)
client.start()
```

### 4.3 Feature-flag wiring in `agent.py`

[omni_agent/agent.py](../../../omni_agent/agent.py) — three surgical changes:

1. **`_USE_RUST_WS` flag's no-op stub replaced** with the actual print message describing what the new path does.
2. **`_start_realtime_subscription()` branches at the top.** When `_USE_RUST_WS` is True, the function calls `_start_work_service_ws_client()` and returns BEFORE spawning the legacy Supabase asyncio thread. So the two paths NEVER both connect at once — parallel-run is across machines (one cohort with the env var set, one without), not in-process.
3. **`_stop_realtime_subscription()` also stops the work-ws client** so logout / shutdown tears down BOTH paths cleanly.

New helpers:

- `_start_work_service_ws_client()` — singleton-guarded spawn. Imports `WorkServiceWsClient` lazily; falls back to the Supabase path on import failure.
- `_stop_work_service_ws_client()` — best-effort shutdown.
- `_on_work_ws_event(event_dict)` — dispatcher:
  - `event_dict['type'] == 'SapJobStatusChanged'` → `_kick_job_poller('rust-ws-sap-job')` (same wake-up path the legacy `_on_jobs_insert` callback used).
  - `event_dict['type'] == 'RfPutawayChanged'` → synthesizes a Realtime-shaped `{'data': {'record': <new>}, 'new': <new>}` envelope and forwards to `_on_hardcoded_table_change('rf_putaway_operations', op, envelope)` (the existing v1.6.4 evaluator stays unchanged).
  - Every event stamps `state.last_realtime_event_at` so the v1.7.8 backfill skip logic still works ("Realtime is healthy and recently active" → skip the 60s PostgREST scan).

### 4.4 Parallel-run instrumentation

Two new accumulators expose per-type event rates so the operator can compare paths over the 3-day window:

```python
_work_ws_event_counts: dict[str, int] = {
    'SapJobStatusChanged': 0,
    'RfPutawayChanged': 0,
    'Other': 0,
}
_legacy_realtime_event_counts: dict[str, int] = {
    'SapJobStatusChanged': 0,
    'RfPutawayChanged': 0,
}
```

The legacy `_on_jobs_insert` and `_on_rf_putaway_change` callbacks bump `_legacy_realtime_event_counts`; the new `_on_work_ws_event` bumps `_work_ws_event_counts`. Each delivery also prints a one-line audit log:

```
[work-ws] event delivered: type=SapJobStatusChanged job_id=<uuid> status=running op=UPDATE
[work-ws] event delivered: type=RfPutawayChanged row_id=<uuid> op=INSERT
```

**Parity check:** the legacy callback only fires on `sap_agent_jobs` INSERT (single subscription) so the WS counter is expected to be HIGHER (it sees both INSERT + UPDATE). The parity check is on INSERT-shaped events specifically (look for `op=INSERT` in `[work-ws] event delivered:` log lines).

### 4.5 Boot prints + capability advertisement

New `[boot]` line surfaces which path is active. With `OMNIFRAME_AGENT_USE_RUST_WS=1`:

```
[boot]   Event source: rust-work-service /ws (Phase 4 — OMNIFRAME_AGENT_USE_RUST_WS=1).
         Connecting to https://rust-work-service-production.up.railway.app.
         Subscribed events: WsEvent::SapJobStatusChanged + WsEvent::RfPutawayChanged.
         Legacy Supabase Realtime path is INACTIVE for this run. Unset the env var to revert.
```

With the flag OFF (default):

```
[boot]   Event source: Supabase Realtime (default). Phase 4 client is BUILT-IN but inactive —
         set OMNIFRAME_AGENT_USE_RUST_WS=1 to switch to rust-work-service /ws
         (target work-service URL: https://rust-work-service-production.up.railway.app).
```

New capability `rust-ws-client` advertised in `/health.capabilities` (informational; no frontend gating).

### 4.6 Frontend constant bumps

[src/features/admin/sap-testing/lib/agent-fetch.ts](../../../src/features/admin/sap-testing/lib/agent-fetch.ts) — `LATEST_AGENT_VERSION = '1.9.0'`. New jsdoc banner under the existing v1.8.4 entry summarises Phase 4. Banner upgrades read "v1.9.0 available".

### 4.7 Trigger backfill poller stays unchanged

The 60s safety-net `_start_trigger_backfill_poller` (line ~5654) is unchanged. It's already guarded on `state.last_realtime_event_at < 120`. Both paths stamp the same field on every event, so backfill correctly recognises "Realtime is healthy" regardless of which path is active.

### 4.8 Documentation + env

[.env.example](../../../.env.example) — added a documented `OMNIFRAME_AGENT_USE_RUST_WS` + `OMNIFRAME_WORK_SERVICE_URL` block under "OmniFrame on-prem agent".

[omni_agent/requirements.txt](../../../omni_agent/requirements.txt) — added an explicit `websockets>=11.0` line (transitive via `realtime>=2.29.0` today; explicit pin protects against a future `realtime` upgrade dropping the websockets requirement).

## Deferred items (NOT done in this PR)

### 4.5 Legacy Supabase Realtime code deletion (target: v1.10)

The v1.7.1 → v1.8.4 layered defenses stay alive in this PR — they're still active behind the flag. After the operator flips the default to `1`, v1.10 deletes:

- `_RealtimeCleanCloseTracker` (v1.8.0)
- `_RealtimeCircuitBreaker` (v1.7.1)
- `_realtime_cooldown_ladder` / `_REALTIME_CIRCUIT_*` constants (v1.8.4)
- `OMNIFRAME_DISABLE_REALTIME` env gate + the v1.8.4 escape-hatch boot prints
- `_supabase_request` retry layer (only retained because the legacy Realtime path's reconnect storms could 5xx-fail Supabase REST writes)
- `_start_realtime_subscription`'s asyncio body (everything from `if not _HAVE_REALTIME:` onwards)
- `_stop_realtime_subscription`'s `_realtime_state` plumbing
- `_realtime_circuit_reset_loop`
- `_AsyncRealtimeClient` import block

**Grep targets for the cleanup commit:** `_RealtimeCleanCloseTracker`, `_RealtimeCircuitBreaker`, `OMNIFRAME_DISABLE_REALTIME`, `_realtime_started`, `AsyncRealtimeClient`, `realtime>=2.29.0` (drop from requirements.txt — the new explicit `websockets>=11.0` already covers what the WS client needs).

### 4.8 Strict-mode `WORK_WS_REQUIRE_TOKEN=true` flip in production

The plan calls for setting `WORK_WS_REQUIRE_TOKEN=true` on the `rust-work-service` Railway env after 1 week of stability. **Not done in this PR.** Documented as a follow-up; the plan's runbook ([Roadmap-Rust-WS-Unlocks](../Decisions/Roadmap-Rust-WS-Unlocks.md)) gates that change.

## Quality gates

- ✓ Migration 276 applied via Supabase MCP `apply_migration`. Verified via `information_schema.triggers`:
  ```
  trigger_name              | event_manipulation | event_object_table   | action_timing
  --------------------------+--------------------+----------------------+--------------
  rf_putaway_notify_changed | INSERT             | rf_putaway_operations| AFTER
  rf_putaway_notify_changed | UPDATE             | rf_putaway_operations| AFTER
  ```
- ✓ `cargo build` clean (warnings pre-existing in `observability/middleware.rs`, untouched)
- ✓ `cargo test --lib` 27/27 passed
- ✓ `cargo clippy --all-targets` no NEW warnings on `rf_putaway_listener.rs`, `websocket/mod.rs`, `main.rs`, `lib.rs`
- ✓ `python3 -c "import ast; ast.parse(open('omni_agent/agent.py').read())"` clean
- ✓ `python3 -c "import ast; ast.parse(open('omni_agent/work_service_ws.py').read())"` clean
- ✓ `pnpm tsc -b --noEmit` clean
- ✓ `pnpm build` clean
- ✓ Copied `agent.py` + `work_service_ws.py` + `requirements.txt` to `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/`

## Files

### Created
- [supabase/migrations/276_notify_rf_putaway_changed.sql](../../../supabase/migrations/276_notify_rf_putaway_changed.sql)
- [rust-work-service/src/rf_putaway_listener.rs](../../../rust-work-service/src/rf_putaway_listener.rs)
- [omni_agent/work_service_ws.py](../../../omni_agent/work_service_ws.py)

### Modified
- [rust-work-service/src/websocket/mod.rs](../../../rust-work-service/src/websocket/mod.rs) — added `WsEvent::RfPutawayChanged` variant + organization_id arm
- [rust-work-service/src/lib.rs](../../../rust-work-service/src/lib.rs) — `pub mod rf_putaway_listener;`
- [rust-work-service/src/main.rs](../../../rust-work-service/src/main.rs) — listener spawn next to other LISTEN consumers
- [src/lib/work-service/types.ts](../../../src/lib/work-service/types.ts) — `'RfPutawayChanged'` + `new?` field
- [omni_agent/agent.py](../../../omni_agent/agent.py) — Phase 4 wiring (boot stub print, `_USE_RUST_WS` branch, `_on_work_ws_event` + `_start/stop_work_service_ws_client`, parallel-run counters, `rust-ws-client` capability, AGENT_VERSION → 1.9.0, boot path-disclosure print)
- [omni_agent/requirements.txt](../../../omni_agent/requirements.txt) — explicit `websockets>=11.0`
- [src/features/admin/sap-testing/lib/agent-fetch.ts](../../../src/features/admin/sap-testing/lib/agent-fetch.ts) — `LATEST_AGENT_VERSION = '1.9.0'` + v1.9.0 jsdoc banner
- [.env.example](../../../.env.example) — `OMNIFRAME_AGENT_USE_RUST_WS` + `OMNIFRAME_WORK_SERVICE_URL` documentation block

## Operations

### How to enable parallel-run on a single agent

```
setx OMNIFRAME_AGENT_USE_RUST_WS 1
```

Restart the agent. The boot log will read:

```
[boot] OMNIFRAME_AGENT_USE_RUST_WS=1 — Phase 4 path active. ...
[boot]   Event source: rust-work-service /ws (Phase 4 — OMNIFRAME_AGENT_USE_RUST_WS=1). ...
[work-ws] client started (Phase 4 — rust-work-service /ws). Subscribed to ...
[work-ws] connected to https://rust-work-service-production.up.railway.app (org <uuid>)
```

Followed by per-event lines:

```
[work-ws] event delivered: type=SapJobStatusChanged job_id=<uuid> status=running op=UPDATE
[work-ws] event delivered: type=RfPutawayChanged row_id=<uuid> op=UPDATE
```

### How to compare event rates

For each agent in the cohort, grep the agent log for `[work-ws] event delivered:` (new path) vs the legacy v1.7.8 `[realtime] last_event_at` lines + the existing `[backfill] poll` summaries. Over a 24h window the SAP-job INSERT rate (filter `op=INSERT`) should match within ±5%; the rf_putaway INSERT+UPDATE total should also match within ±5%.

### How to flip the default (after parity confirmed)

Edit `omni_agent/agent.py` line ~135:

```python
_USE_RUST_WS: bool = os.environ.get('OMNIFRAME_AGENT_USE_RUST_WS', '1') == '1'
```

Then v1.10 follows up with the deletion commit (see Deferred 4.5 above).

## Related

- [[Implement-Rust-Work-Service-Phase0-Phase1]] — feature-flag stub + diagnostic baseline
- [[Implement-Rust-Work-Service-Phase2]] — telemetry foundation (`work_ws_broadcast_buffer_pct`)
- [[Implement-Rust-Work-Service-Phase3]] — fleet snapshot endpoints
- [[ADR-Rust-Work-Service-Availability-SLO]] — the SLO this migration helps meet
- [[Roadmap-Rust-WS-Unlocks]] — Tier 1 / Tier 2 channel migrations table
- [[Migrate-Tier1-Deferred-Channels-To-Rust-WS]] — sibling pattern (FE-side WsEvent migrations)
- [[Omni-Agent - Headless SAP Agent]] — agent component note
- [[Async-Library-Circuit-Breaker]] — v1.7.1 pattern that the legacy path retains for now
- [[ADR-Presence-Architecture-Next-Steps]] — Option 2 framing (presence) — same architectural pattern
