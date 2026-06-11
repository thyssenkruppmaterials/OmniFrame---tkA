---
tags: [type/implementation, status/active, domain/backend, domain/infra, domain/database]
created: 2026-05-20
---

# Compress Rust Work Listener Pool (2026-05-20)

Reshaped `rust-work-service`'s LISTEN/NOTIFY plumbing from 13 single-channel `PgListener` tasks into **2 consolidated multi-channel listener tasks**, and dropped the listener pool from `max_connections=30` → `max=8, min=2`. Estimated saving on the Supabase Pro Small 120-conn budget: **~20 connections** (25 → ~5 steady state).

Not deployed (Railway hold), not git-committed — code change only.

## Why

`pg_stat_activity` on the Supabase primary was showing **25 idle backends with `application_name = 'rust-work-service-listener'`**, age 11+ hours. That was one of the largest single contributors to the 120 `max_connections` budget — at ~21% of the cap from a single sub-pool of a single service.

Cause: Postgres `LISTEN/NOTIFY` requires a long-lived dedicated session connection per `PgListener` instance (the socket cannot be returned to a pool or multiplexed). Pre-consolidation, the service spawned **one `PgListener` per channel**:

```
13 listener tasks × 1 dedicated socket each = 13 connections
+ ~12 keepalive-pool slots the bb8 pool grew into and never released
= ~25 long-lived `idle` backends from a `max_connections=30` pool
```

The sizing dated to the pre-Phase-9 fan-out design and was never resized after the rust-work-service migration moved most Realtime channels onto `/ws`.

## What

### Before — 13 single-channel listener tasks

| # | Spawned in main.rs | LISTEN channel | Handler |
|---|---|---|---|
| 1 | `settings::listener::run` | `work_engine_settings_changed` | `SettingsCache::invalidate()` |
| 2 | `sap_agents_listener::run` | `sap_agent_changed` | `WsEvent::SapAgentChanged` broadcast |
| 3 | `sap_jobs_listener::run` | `sap_agent_job_changed` | `WsEvent::SapJobStatusChanged` + audit-row patch |
| 4 | `sap_import_runs_listener::run` | `sap_import_run_changed` | `WsEvent::ImportRunStatusChanged` broadcast |
| 5 | `cycle_count_listener::run` | `cycle_count_data_changed` | `WsEvent::CycleCountOperationChanged` broadcast |
| 6 | `lx03_listener::run` | `lx03_data_changed` | `WsEvent::Lx03DataChanged` broadcast |
| 7 | `rf_putaway_listener::run` | `rf_putaway_operation_changed` | `WsEvent::RfPutawayChanged` broadcast |
| 8 | `notifications_listener::run` | `notification_created` | `WsEvent::Notification` broadcast |
| 9 | `triggers::loader::run` | `agent_triggers_changed` | Hot-reload `agent_triggers` rule set |
| 10 | `triggers::evaluator::run_for_table("rf_putaway_operations")` | `rf_putaway_operation_changed` | DSL eval + INSERT `sap_agent_jobs` |
| 11 | `triggers::evaluator::run_for_table("sap_agent_jobs")` | `sap_agent_job_changed` | DSL eval + INSERT `sap_agent_jobs` |
| 12 | `triggers::evaluator::run_for_table("work_tasks")` | `work_tasks_changed` (no publisher yet) | DSL eval (no-op until migration lands) |
| 13 | `triggers::evaluator::run_for_table("shipment_queue")` | `shipment_queue_changed` (no publisher yet) | DSL eval (no-op until table+migration land) |

Note: channels #10 + #11 are **duplicate subscriptions** of #3 + #7 — the WS broadcast listener and the trigger evaluator both held independent `PgListener` sockets on the same channel name.

### After — 2 consolidated multi-channel listener tasks

| Task | Channels (count) | Dispatcher |
|---|---|---|
| `config` | `work_engine_settings_changed`, `agent_triggers_changed` (2) | `match frame.channel` → `settings::listener::handle()` ↔ `triggers::loader::handle()` |
| `domain` | 7 WS broadcast channels + 2 evaluator-only (`work_tasks_changed`, `shipment_queue_changed`) = 9 | `match frame.channel` → per-module `handle()`; channels with BOTH a WS-broadcast handler AND an evaluator handler call BOTH sequentially |

Each consolidated task holds **ONE** `PgListener` Postgres backend that subscribes to N channels — `listener.listen(name)` for each channel plus `listener.listen(KEEPALIVE_CHANNEL)`. Postgres-side the cost is identical (each `LISTEN` registers interest in the channel registry), but the wire-side cost collapses from 13 dedicated sockets to 2.

Channels with multiple consumers (`rf_putaway_operation_changed`, `sap_agent_job_changed` both broadcast AND evaluator) run BOTH handlers in sequence inside the dispatcher closure — preserving the pre-consolidation fan-out exactly. No event is dropped; nothing is rerouted; the only thing that changed is which TCP socket carried the frame.

## Pool sizing

```
Before: max_connections=30, min_connections=0 (sqlx default)
After:  max_connections=8,  min_connections=2
```

Steady-state shape after consolidation:

- **2 dedicated `PgListener` sockets** (one per consolidated task).
- **2 min-idle pool slots** (matches the listener-task count so a transient pool churn doesn't open/close the same sockets every keepalive tick).
- Headroom for the 30s keepalive `pg_notify` sends (each task fires one, returning the conn to the pool immediately), `trigger_evaluator::fire_trigger`'s INSERT into `sap_agent_jobs`, and `trigger_loader::reload`'s SELECT on `agent_triggers`.

`max=8` leaves ~4× the steady-state floor for those bursts.

## Connection-budget saving (estimated)

| | Before | After | Δ |
|---|---:|---:|---:|
| `application_name='rust-work-service-listener'` backends (observed) | 25 | ~5 (2 dedicated + ~2–3 keepalive churn) | **−20** |
| Listener-pool `max_connections` cap | 30 | 8 | **−22** |
| Share of 120 Supabase Pro Small max_connections budget | ~21 % | ~4 % | **−17 pp** |

## Files changed

1. `rust-work-service/src/pglistener.rs` — added `run_multi()` + `run_multi_with_config()`; reshaped internal `KeepaliveSink` trait around `connect_listener_multi(&[String])`; added unit test `run_multi_forwards_frames_with_original_channel_names`.
2. `rust-work-service/src/db/pool_setup.rs` — added `build_listener_pool_lazy(max, min, …)` so the listener pool can pin `min_connections`.
3. `rust-work-service/src/main.rs` — replaced 13 `tokio::spawn(<channel>_listener::run(...))` calls with TWO `tokio::spawn(pglistener::run_multi(...))` calls + a boot-time `triggers::loader::initial_load()` spawn; bumped pool from `max=30` to `max=8, min=2` via the new `build_listener_pool_lazy` helper; added a startup INFO log per consolidated task naming its channel set (`Listener pool: spawning consolidated <group>-plane PgListener … channels=[…]`).
4. `rust-work-service/src/settings/listener.rs` — exposed `pub const CHANNEL` + `pub async fn handle(&frame, &cache)`; legacy `pub async fn run(...)` kept behind `#[allow(dead_code)]`.
5. `rust-work-service/src/sap_agents_listener.rs` — same shape (`CHANNEL` + `handle`).
6. `rust-work-service/src/sap_jobs_listener.rs` — same shape (`CHANNEL` + `handle`); `handle` takes `&pool` for the audit-row patch.
7. `rust-work-service/src/sap_import_runs_listener.rs` — same shape.
8. `rust-work-service/src/cycle_count_listener.rs` — same shape.
9. `rust-work-service/src/lx03_listener.rs` — same shape.
10. `rust-work-service/src/rf_putaway_listener.rs` — same shape.
11. `rust-work-service/src/notifications_listener.rs` — same shape.
12. `rust-work-service/src/triggers/loader.rs` — extracted `pub async fn initial_load(...)` (boot-time bounded-retry reload) + `pub async fn handle(...)` (per-NOTIFY reload); added `pub const CHANNEL`; legacy `run(...)` kept behind `#[allow(dead_code)]`.
13. `rust-work-service/src/triggers/evaluator.rs` — `channel_for_table` promoted to `pub`; added `pub fn table_for_channel(channel) -> Option<&'static str>` (inverse mapping), `pub fn evaluator_channels()` (boot-time channel list), `pub async fn handle(...)` (per-frame dispatch by channel). Three new unit tests lock the inverse-mapping contract.

All edits stay within `rust-work-service/`.

## Build + test results

```
cargo check                exit 0  (only pre-existing dead_code warnings in observability/middleware.rs)
cargo check --lib --all-targets  exit 0
cargo build --release      exit 0  (73s)
cargo test --lib           exit 0  (170 passed; 0 failed; 0 ignored)
```

New tests added under `cargo test --lib`:
- `pglistener::tests::run_multi_forwards_frames_with_original_channel_names`
- `triggers::evaluator::tests::table_for_channel_is_inverse_of_channel_for_table`
- `triggers::evaluator::tests::table_for_channel_returns_none_for_unknown_channel`
- `triggers::evaluator::tests::evaluator_channels_covers_every_allowlisted_table`

## Post-deploy verification queries

Wait ~5 min after the deploy lands so the keepalive watchdog churn from the old container fully drains, then run against the Supabase primary:

```sql
-- 1. Bucketed by application_name — expect rust-work-service-listener to drop from ~25 to ~5.
SELECT application_name, COUNT(*) AS conns
  FROM pg_stat_activity
 WHERE application_name LIKE 'rust-work-service%'
 GROUP BY 1
 ORDER BY 2 DESC;

-- 2. Detail view — confirms there are exactly 2 long-lived 'idle' backends owned by the listener
--    pool (one per consolidated task) plus a small number of transient keepalive senders.
SELECT pid, state, query_start, state_change, wait_event,
       LEFT(query, 80) AS recent_query
  FROM pg_stat_activity
 WHERE application_name = 'rust-work-service-listener'
 ORDER BY backend_start DESC;

-- 3. Sanity — total max_connections headroom.
SELECT COUNT(*) AS used,
       (SELECT setting::int FROM pg_settings WHERE name='max_connections') AS cap
  FROM pg_stat_activity;
```

## Health-check metrics

The per-channel `work_pglistener_*` Prometheus series (defined in `observability/metrics.rs`) now label by **group** (`config`, `domain`) instead of per-channel for the consolidated paths. The previously-emitted per-channel series will go silent after deploy — dashboards that filtered on `channel="sap_agent_changed"` etc need to be updated to filter on `channel="domain"`. The metric set is otherwise unchanged (`work_pglistener_status`, `work_pglistener_reconnects_total`, `work_pglistener_last_message_age_seconds`, `work_pglistener_keepalive_sent_total`, `work_pglistener_keepalive_received_total`).

Watch for after deploy:
- `work_pglistener_status{channel="config"}` and `…{channel="domain"}` should both pin at 1 within ~10s of boot.
- `work_pglistener_reconnects_total` should stay flat at steady state.
- `work_pglistener_last_message_age_seconds` should stay under 30s (keepalive cadence).

## Constraints honoured

- No new `supabase.channel(...)` callsites — see master rule.
- General `db_pool` and `read_pool` left untouched. Only `listener_db_pool` was resized.
- Not deployed to Railway.
- Not git-committed.
- All event-handling semantics preserved (every NOTIFY still reaches its original handler; `rf_putaway_operation_changed` + `sap_agent_job_changed` still fan out to both their WS-broadcast handler and the trigger evaluator).

## Related

- [[Rust-Work-Service]]
- [[Roadmap-Rust-WS-Unlocks]]
- [[ADR-Scaling-Roadmap-To-100k-Concurrent]]
- [[Apply-Performance-Review-Fixes-2026-05-19]]
- [[Implement-Resilient-PgListener]]
- [[ADR-Trigger-DSL-Evaluator-Phase9]]
- [[Fix-Trigger-Evaluator-Empty-After-v041-Restart]]
