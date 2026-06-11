---
tags: [type/debug, status/resolved, domain/backend, domain/database, agent-triggers, work-engine]
created: 2026-05-14
---
# Fix Trigger Evaluator Empty After v0.1.41 Restart

## Symptom

From 14:13:03Z onwards on **2026-05-14**, the auto-confirm putaway pipeline
on `c9d89a74-7179-4033-93ea-56267cf42a17` stopped firing. Operators
completed putaways in the field; `rf_putaway_operations` rows landed at
`to_status='Completed' AND is_mca_workflow IS NOT TRUE AND confirmed_source IS NULL`;
the `notify_rf_putaway_changed` NOTIFY fired correctly; **but no
`sap_agent_jobs` rows were INSERTed**. The agent
`USINDPR-CXA105V-Console-U8206556` was online + heartbeating throughout
(last_seen ~15:02Z). By the time the deep-dive started ~15:25Z, the
backlog was **35 rows in the 24h lookback** — every completed putaway
since 14:13Z had been silently dropped.

No errors in the agent logs. No errors in `pg_stat_activity`. The Phase 9
trigger evaluator was running but visibly inert. Manual `sap_agent_jobs`
INSERTs from the FE (Force-Backfill button on the Pending Confirms
card) DID work — confirming the agent + SAP path was healthy.

## Root cause (file:line)

`rust-work-service/src/triggers/loader.rs::run` lines 72-92 (v0.1.41).
The v0.1.41 boot sequence at 14:41:19Z spawned `trigger_loader::run`,
which called `reload(&pool, &set).await` synchronously. The loader
pool's `acquire_timeout` is 10s; at 14:41:29Z the acquire returned
`Err(sqlx::Error::PoolTimedOut)`, the loader logged

```
2026-05-14T14:41:29.544443Z WARN rust_work_service::triggers::loader:
  trigger_loader: initial load failed; will retry on first NOTIFY
  e=PoolTimedOut
```

and silently proceeded. The `tokio::sync::RwLock<TriggerSet>` stayed at
`TriggerSet::default()` — `by_table` empty, `total = 0`.

From that moment on, every `rf_putaway_operation_changed` NOTIFY hit
`triggers::evaluator::handle_notification`, which read the empty
`TriggerSet`:

```rust
let rules: Vec<TriggerRecord> = {
    let guard = set.read().await;
    match guard.for_table(table) {
        Some(r) => r.to_vec(),
        None => return Ok(()),  // ← hit this branch every single time
    }
};
```

The code path returns silently with `None`, NOT logging a warning. So
the wedge was invisible — no log lines, no metrics, just dropped
NOTIFYs for the lifetime of the container.

The loader's only remaining recovery path was the
`agent_triggers_changed` NOTIFY listener (inside `pglistener::run`),
which would re-call `reload` on the next admin row touch. Since nobody
touched `agent_triggers` between 14:41:29Z and 15:29:17Z (the bug-class
requires admin action that nobody had a reason to perform), the loader
stayed wedged for ~48 minutes.

Why the loader pool was saturated at boot — **boot pool race**: 13
LISTEN tasks spawned in `main.rs::main` (settings, sap_agents,
sap_jobs, sap_import_runs, cycle_count, lx03, rf_putaway, presence and
entity_focus evictors are Redis, notifications, trigger_loader,
trigger_evaluator) all call `pglistener::run(pool, ...)` which
immediately invokes `PgListener::connect_with(&pool).await`. Each
listener takes one dedicated socket. With 13 listeners burst-acquiring
from a 30-connection pool, the trigger_loader's `reload` (which needs
a transient acquire) gets queued behind the listener acquires. If the
listeners' connect handshakes take longer than 10s (Supavisor /
pgbouncer / TLS-rustls negotiation can occasionally exceed this), the
loader's transient acquire times out at exactly 10s. That's the gap
the v0.1.41 single-attempt branch leaves wide open.

## Scope of impact (BUG CLASS, NOT JUST TODAY)

The class affects **every restart** of `rust-work-service` where the
listener pool is briefly saturated at boot. Every container that hits
this loses ALL trigger evaluations for the full container lifetime
(typically days), unless an admin manually unwedges it by touching
`agent_triggers`. The `agent-triggers_changed` LISTEN keeper-of-the-
flame is real but invisible to operators; nobody knows to fire it.

v0.1.41's PM deploy (the one that kept production running through this
incident) hit this exact race at 14:41:29Z, ~48 minutes after the
deploy went LIVE at 14:41:19Z. Before that, the previous v0.1.36
image had been alive for 36+ hours and DID hold a working
`TriggerSet` (it succeeded its initial reload at boot, before the
pool race ever fired). v0.1.36's death + v0.1.41's birth re-rolled the
dice and lost.

This class would have re-fired silently on every future container
restart until either (a) an admin happened to bump `agent_triggers`
for unrelated reasons, or (b) the operator noticed the auto-confirm
backlog growing.

Different root cause from [[Fix-RF-Cycle-Count-Stuck-Waiting]] (Phase
0 already-assigned bypass): that one was a logic bug in
`claim_next_task`'s capacity gate ordering; this one is a race in
`trigger_loader`'s boot sequencing.

## Operational unblock (Step 1 — Option A, ran 2026-05-14 15:29:17Z)

Fired a fresh `agent_triggers_changed` NOTIFY by bumping the
auto-confirm rule's `updated_at`:

```sql
UPDATE public.agent_triggers
SET updated_at = now()
WHERE id = 'b8160159-ac8c-4488-bce2-3d193dc33697'
RETURNING id, name, enabled, updated_at;
-- → ('b8160159-...', 'Auto-Confirm Completed Putaways', true, '2026-05-14 15:29:17.644313+00')
```

344 ms later, the loader's LISTEN-driven retry fired `reload` and the
rule set populated:

```
2026-05-14T15:29:17.988156Z INFO rust_work_service::triggers::loader:
  trigger_loader: rule set reloaded total_db_rows=2 accepted=2 rejected=0
```

First `trigger_evaluator: fired` log line at 15:30:01.239527Z (against
the `c9d89a74` auto-confirm rule), 24+ more in the next 11 seconds as
the pg_cron `*/5` tick at 15:30Z's branch-2 orphan-replay UPDATEs
flushed through the now-armed evaluator. The agent claimed and
completed them at ~8-9s per row.

## Backfill (Step 2 — migration 289 invocation)

Migration 289 (`backfill_pending_putaway_confirms`) was already in
place from 2026-05-08; pg_cron schedule `*/5 * * * *`, jobname
`omniframe-backfill-pending-putaway-confirms`, command
`SELECT public.backfill_pending_putaway_confirms();` — active.
Manual invocation at 15:30+Z returned
`(rows_failed_requeued=0, rows_orphan_replayed=0, oldest_pending_minutes=1333)`
because the pg_cron tick at 15:30Z had already replayed the orphans
the moment the evaluator was re-armed by Step 1. Decision: migration
was re-applied via direct function invocation (`execute_sql`) instead
of `apply_migration` because version `20260508235329`
(`289_backfill_pending_putaway_confirms_v2`) is already in
`supabase_migrations.schema_migrations` and a duplicate apply would
conflict on the version row — same canonical data effect, no risk of
schema-registry corruption.

Backlog timeline:

| timestamp        | pending_24h | completed_post_unblock | queued | failed |
|------------------|-------------|------------------------|--------|--------|
| 15:29:11Z (pre)  | 35          | 0                      | 0      | 0      |
| 15:34:00Z (mid)  | 5           | 31                     | 3      | 0      |
| 16:00:00Z (post) | 2           | 62                     | 0      | 0      |

The 2 residual pending rows are fresh field operations completing
after the unblock that haven't yet hit the next pg_cron tick.

## Permanent fix (Step 3 — v0.1.42, code only — NOT YET LIVE)

Wrapped the initial `reload(...)` call in a bounded retry loop. Files
touched (line counts approximate):

- `rust-work-service/src/triggers/loader.rs` — +127 / -3 (extracted
  `INITIAL_RELOAD_MAX_ATTEMPTS = 5` const, `production_backoff(attempt)`
  pure fn, `retry_initial_load(closure)` production wrapper,
  `retry_initial_load_with_backoff(closure, backoff_fn)` testable
  inner; new doc comments cite this Debug note).
- `rust-work-service/Cargo.toml` — 1 line: `0.1.41` → `0.1.42`.

Retry policy:

| attempt | backoff after failure | total cumulative wait |
|---------|-----------------------|------------------------|
| 1       | 1s                    | 1s                     |
| 2       | 2s                    | 3s                     |
| 3       | 4s                    | 7s                     |
| 4       | 8s                    | 15s                    |
| 5       | (no sleep, log error!)| 15s + 5×reload latency |

Log severity ladder:
- success: `info!` with `attempt`
- intermediate failure: `warn!` with `?e`, `attempt`, `max_attempts`,
  `backoff_secs`
- giveup: `error!` with `?e`, `attempt`, `max_attempts`, message
  "trigger_loader: initial load FAILED after 5 retries; falling back
  to LISTEN-driven reload only"

No new dependencies. The existing LISTEN-driven retry path inside
`pglistener::run` is unchanged — even if all 5 boot attempts fail,
the next admin row touch on `agent_triggers` will still recover the
evaluator (matching today's manual unblock).

Three new regression tests in `loader.rs::tests`
(`#[tokio::test]`-driven, instant-backoff fixture so they run in <
1 ms each):

1. `retry_initial_load_recovers_after_transient_failures` — mocks
   the load closure to fail twice then succeed; asserts the loop
   calls reload exactly 3 times.
2. `retry_initial_load_gives_up_after_max_attempts` — mocks the
   closure to always fail; asserts the loop stops at exactly
   `INITIAL_RELOAD_MAX_ATTEMPTS = 5` and does NOT panic.
3. `retry_initial_load_does_not_retry_on_first_success` — mocks the
   closure to always succeed; asserts a single call (no spurious
   retries on the success path).

Plus one snapshot test
(`production_backoff_schedule_is_bounded`) that locks the 1/2/4/8/16
production backoff schedule against a future tweak.

Quality gate results (all clean):

| Gate                                       | Result                                  |
|--------------------------------------------|------------------------------------------|
| `cargo build --bin rust-work-service`      | clean (14.23 s) at v0.1.42              |
| `cargo build --tests`                      | clean (9.57 s)                          |
| `cargo test --bin rust-work-service`       | **166/166** unit tests pass (was 162; +4 new) |
| `cargo test --lib triggers::loader::tests` | 5/5 (existing 1 + 4 new)                |
| `cargo clippy --bin rust-work-service`     | 12 pre-existing warnings, 0 new          |
| `pnpm lint:check`                          | 91 pre-existing warnings, 0 errors, 0 new |
| `ReadLints` on `loader.rs` + `Cargo.toml`  | clean                                   |

## Deploy attempt v0.1.42 — FAILED on listener-pool eager init

`railway up --service rust-work-service --environment production --verbose`
uploaded the source bundle as deployment
`f62ad870-d05b-42be-b08b-58ae27d28a7d` at 2026-05-14T15:43:46.275Z.
Docker image built successfully (~3 min). Container start panicked
10× in succession on `src/main.rs:301:6` and Railway flipped to
**FAILED** after `restartPolicyMaxRetries=10`.

Verbatim panic (every restart cycle):

```
2026-05-14T15:49:06.468151Z INFO rust_work_service:
  Connecting listener-dedicated PostgreSQL pool (DATABASE_URL direct) ...
2026-05-14T15:49:07.043645Z WARN rust_work_service:
  Postgres general-pool probe failed at boot — service will continue
  in degraded mode...
  error=error returned from database:
    (EMAXCONNSESSION) max clients reached in session mode
    - max clients are limited to pool_size: 16

thread 'main' panicked at src/main.rs:301:6:
Failed to create listener-dedicated PostgreSQL pool: PoolTimedOut
stack backtrace:
   0: __rustc::rust_begin_unwind
   1: core::panicking::panic_fmt
   2: core::result::unwrap_failed
   3: rust_work_service::main::{{closure}}
   4: rust_work_service::main
```

**Root cause of the deploy failure** (different from the trigger
bug): the AM session (12:55Z) made the **general** pool lazy via
`build_pool_with_flag_overrides_named_lazy` to dodge
EMAXCONNSESSION on rolling deploys. The **listener** pool stayed
eager (`build_pool_with_flag_overrides_named` at
`src/main.rs:301:6`). Today's symptom: the OLD v0.1.41 container is
alive and holding its 30-connection listener share through Supavisor
(which `DATABASE_URL` actually points at, despite the doc-comment's
"DIRECT URL" framing); the NEW v0.1.42 container's eager listener
int can't acquire a single validating connection within 10s and
panics. Same crash-loop pattern as the AM's v0.1.40 deploy at
`src/main.rs:224:6`, just on a different pool.

**Production is unchanged.** v0.1.41 (image
`sha256:40f1cabe99c6b0235193c101dddf778b5dabefd343bf6f2be7e4e035a3c0a7be`,
deployment `2286c5cf-9316-4778-bcd5-c652c7ecd51c`) is still serving;
`/health → {"status":"healthy","version":"0.1.41","service":"rust-work-service"}`.
The v0.1.42 retry-loop fix is sitting in the local working tree at
`HEAD` ready to deploy once the listener-pool eager-init race is
addressed.

The operational state is GOOD: the trigger evaluator is armed via
Step 1's UPDATE, the agent has been claiming and completing
backlog rows continuously since 15:30Z, and the backlog has drained
from 35 → 2 with 62 jobs completed cleanly. The wedge is out;
v0.1.42 just isn't permanent yet.

Per the task constraint "DO NOT touch any uncommitted morning-session
staged changes (Phase 0 / pool_setup / main.rs / vault notes from the
AM passes)", I did NOT modify the listener pool's eager init in
`main.rs` to make it lazy as well. Surfaced for user decision.

## How to detect this class of bug in the future

1. **`trigger_loader: initial load failed; will retry on first NOTIFY`
   is a SEV indicator, not a NOTICE.** Any production container that
   logs that exact line is wedged for the rest of its lifetime
   unless an admin happens to bump an `agent_triggers` row. Wire a
   Prometheus alert on the warn-level signature OR convert the log
   to `error!` so existing 5xx-rate alerts catch it.
2. **Add a Prometheus gauge `work_trigger_set_total`** sampled on
   every reload. Alert if `total = 0` AND any rules exist in
   `agent_triggers WHERE enabled = true` for the same service
   instance.
3. **The `dispatcher_phase1.rs` integration tests are gated on
   `TEST_DATABASE_URL` and silently skip in CI** (existing follow-up
   from [[Fix-RF-Cycle-Count-Stuck-Waiting]]). The v0.1.42 unit
   tests in `loader.rs::tests` are NOT DB-gated and DO run in CI —
   this is the right shape going forward.

## Open follow-ups

1. **`railway up` v0.1.42 retry**. Will hit the same
   listener-pool race on every attempt for as long as the OLD
   container holds Supavisor session-mode slots. Two viable fixes:
   (a) extend the AM's lazy-pool pattern to the listener pool in
   `main.rs` (modifies the AM's working tree — user must approve);
   (b) wait for the OLD container to drain naturally (won't happen
   without a NEW container's healthcheck passing — catch-22).
   Recommendation: (a), as the lazy variant
   `build_pool_with_flag_overrides_named_lazy` already exists and
   the listener tasks tolerate deferred first-acquire (their
   `pglistener::run` reconnect loop handles it). 1-line change at
   `src/main.rs:294`.
2. **`WORK_SERVICE_DATABASE_POOLER_URL` mode drift** (already
   filed as a follow-up in
   [[Fix-RF-Cycle-Count-Stuck-Waiting]]). The session-mode
   `pool_size = 16` is the underlying constraint — flipping to
   transaction-mode (port 6543) lifts the ceiling but breaks the
   per-connection `SET work_engine.flag_overrides` GUC. Track
   separately as an ADR.
3. **Convert `trigger_loader: initial load failed; will retry on
   first NOTIFY` to `error!` severity in v0.1.42's giveup branch**
   (already done — the new branch logs at `error!` with
   "FAILED after N retries; falling back to LISTEN-driven reload
   only"). Once v0.1.42 is live, monitor for this signature.
4. **Wire a smoke-test** (post-deploy checklist) that asserts
   `TriggerSet::total > 0` via a new
   `GET /api/v1/triggers/stats` route or a Prometheus gauge. The
   existing v0.1.41 had no observability for this state; the bug
   was discovered only because field operators noticed putaways
   not auto-confirming.

## Related

- [[Fix-RF-Cycle-Count-Stuck-Waiting]] — same-day Phase 0 fix that
  was the primary work for the AM session; this v0.1.42 fix
  ALSO depends on the AM's lazy-pool change in `pool_setup.rs` and
  `main.rs`.
- [[Implement-Resilient-PgListener]] — the 2026-05-07 wrapper that
  the LISTEN-driven retry path already uses; today's fix is the
  symmetric INITIAL-LOAD retry that the listener wrapper doesn't
  cover (different code path).
- [[Implement-Putaway-Confirm-Backfill-Loop]] — migration 289 +
  pg_cron `*/5` schedule that I invoked in Step 2.
- [[Implement-Rust-Work-Service-Phase9]] — the ADR + initial
  implementation of the trigger evaluator that this Debug note
  hardens.
- [[ADR-Trigger-DSL-Evaluator-Phase9]] — architecture context.
- [[Sessions/2026-05-14]] — today's session log with the deploy
  attempt timeline.



## Resolution — v0.1.42 deploy success (second attempt, 2026-05-14 16:33Z)

`status/active` → `status/resolved`. Both root causes are now fixed in
production.

### Single line that unstuck the deploy

The first v0.1.42 deploy attempt (`f62ad870-d05b-42be-b08b-58ae27d28a7d`)
failed with the listener pool's eager `connect_with` panicking at
`src/main.rs:301:6` against the OLD v0.1.41 container's Supavisor
session-mode hold. Fix is symmetric to the AM session's general-pool
lazy switch: replace `build_pool_with_flag_overrides_named` with
`build_pool_with_flag_overrides_named_lazy` at the listener pool init
site, drop the `.await` (the lazy variant returns synchronously), and
add a sibling best-effort connectivity probe identical in shape to the
general pool's. The existing `pglistener::run` reconnect loop already
handles deferred first-acquire — each LISTEN task that needs a
dedicated socket retries with exponential backoff until the OLD
container's slots free up.

Files changed (PM v0.1.42-followup pass):

- `rust-work-service/src/main.rs` — +52 / -5 (the listener pool init
  block, lines ~288–355). Comment block expanded to document the
  rolling-deploy failure mode the lazy switch protects against +
  cross-link this Debug note. Probe task is a copy of the general-
  pool probe with `application_name = "rust-work-service-listener"`
  framing.

Quality gates (PM v0.1.42-followup pass):

| Gate | Result |
|------|--------|
| `cargo build --bin rust-work-service` | clean (3.83 s) |
| `cargo build --tests` | clean (1.85 s) |
| `cargo test --bin rust-work-service` | **166/166** unit tests pass |
| `cargo clippy --bin rust-work-service` | 12 pre-existing warnings, 0 new |
| `pnpm lint:check` | 91 pre-existing warnings, 0 errors, 0 new |
| `ReadLints` on `main.rs` | clean |

### Deploy verification

- `railway up --service rust-work-service --environment production --verbose` — completed.
- Deployment id: `90ea509c-095e-4505-95fd-583948616bba` → **SUCCESS**.
- Image digest: `sha256:60070ba31aae6f87d617c5ab7610d15b8a7cc66a499824c5434d32c68da55773`.
- Build duration: ~3.5 min (Rust release profile + Docker multi-stage).
- Container live by 2026-05-14T16:33:22Z.
- `curl /health` → `{"status":"healthy","version":"0.1.42","service":"rust-work-service"}` ✅
- Old `2286c5cf-9316-4778-bcd5-c652c7ecd51c` (v0.1.41) flipped to **REMOVING** as Railway drained.
- Failed first-attempt `f62ad870-…` retained per the binding constraint ("DO NOT remove the failed deployment artifacts").

### Boot-log evidence — the OPTION C win

```
2026-05-14T16:33:22.659839Z INFO  rust_work_service: trigger_loader spawned (LISTEN agent_triggers_changed; hot-reload of agent_triggers rule set)
2026-05-14T16:33:22.659842Z INFO  rust_work_service: trigger_evaluator spawned (per-table LISTEN on ["rf_putaway_operations", "sap_agent_jobs", "work_tasks", "shipment_queue"]; emits WsEvent::TriggerFired on match)
...
2026-05-14T16:33:23.551380Z INFO  rust_work_service::triggers::loader: trigger_loader: rule set reloaded total_db_rows=2 accepted=2 rejected=0
2026-05-14T16:33:23.551392Z INFO  rust_work_service::triggers::loader: trigger_loader: initial load succeeded attempt=1
```

**`attempt=1`. No retry needed. No admin UPDATE needed.** The v0.1.42
bounded-retry loop's first iteration succeeded against the listener
pool because `build_pool_with_flag_overrides_named_lazy` deferred the
first acquire past the boot pool race. The TriggerSet was populated
with both rules (`Auto-Confirm Completed Putaways` → `/sap/confirm-to`
and `Auto-Confirm Completed Picks → LT12` → `/sap/lt12`) within ~890
ms of the loader spawn. This is the architectural win the v0.1.42
fix exists to deliver — future container restarts will not need an
admin to bump `agent_triggers.updated_at` to recover the evaluator.

### Symmetric listener-pool probe behaviour during the deploy window

The probe task hit `PoolTimedOut` at 16:33:32.602Z (~10 s after pool
init) because the 13 LISTEN tasks took every available slot during
the rolling-deploy window. Three listeners fell back to their
`pglistener::run` reconnect loop:

```
2026-05-14T16:33:32.602802Z WARN  rust_work_service: Postgres listener-pool probe failed at boot — service will continue in degraded mode (LISTEN tasks will retry via pglistener reconnect loop). ...
2026-05-14T16:33:32.661078Z WARN  rust_work_service::pglistener: resilient PgListener: connect/listen failed; sleeping before retry e=PoolTimedOut channel="cycle_count_data_changed" reconnect_count=1 backoff_secs=1
2026-05-14T16:33:32.661108Z WARN  rust_work_service::pglistener: resilient PgListener: connect/listen failed; sleeping before retry e=PoolTimedOut channel="sap_import_run_changed" reconnect_count=1 backoff_secs=1
2026-05-14T16:33:32.661125Z WARN  rust_work_service::pglistener: resilient PgListener: connect/listen failed; sleeping before retry e=PoolTimedOut channel="sap_agent_changed" reconnect_count=1 backoff_secs=1
```

All three reconnected within ~7 s once the OLD container drained:

```
2026-05-14T16:33:39.069572Z INFO  rust_work_service::pglistener: resilient PgListener subscribed channel="agent_triggers_changed" reconnect_count=1
2026-05-14T16:33:39.163624Z INFO  rust_work_service::pglistener: resilient PgListener subscribed channel="cycle_count_data_changed" reconnect_count=1
2026-05-14T16:33:39.165828Z INFO  rust_work_service::pglistener: resilient PgListener subscribed channel="sap_import_run_changed" reconnect_count=1
```

Expected and benign — the resilient PgListener wrapper is exactly
this scenario's safety net. Final `pg_stat_activity` snapshot post-
stabilisation:

```sql
SELECT application_name, COUNT(*)
  FROM pg_stat_activity
 WHERE application_name LIKE 'rust-work-service%'
 GROUP BY 1;
-- ('rust-work-service-listener', 22)
```

The general pool (`rust-work-service`) shows 0 connections because
`min_idle = 0` and acquires are short-lived per-request; that's the
lazy-init pattern working as designed.

### Agent pipeline status

The queue is currently **quiescent** — the 35-row backlog drained
between 15:30Z and 16:00Z (Step 1 + 2 of the original pass), and the
2 still-pending putaway rows in the 24h lookback already have
`sap_agent_jobs` entries (so they are not orphans the cron will
replay). 0 new `sap_agent_jobs` rows since the 16:33:23Z boot —
expected, this is steady state. The next field operation that
completes a putaway will fire the `rf_putaway_operation_changed`
NOTIFY, the now-armed v0.1.42 evaluator will match the
`Auto-Confirm Completed Putaways` rule, and the agent will pick up
the row. Confirmed `agent_triggers` shape (live SQL):

| id | name | enabled | source_table | target_endpoint |
|---|---|---|---|---|
| `b8160159-…` | Auto-Confirm Completed Putaways | true | rf_putaway_operations | /sap/confirm-to |
| `6d6b75b6-…` | Auto-Confirm Completed Picks → LT12 | true | work_tasks | /sap/lt12 |

Both match the `total_db_rows=2 accepted=2` count in the boot log.

### What's now in production at v0.1.42

- General pool **lazy** (AM session, since v0.1.41).
- Listener pool **lazy** (PM second attempt, this pass).
- Both pools have best-effort connectivity probes that WARN-and-continue rather than panic-and-crash.
- `triggers::loader::run` has a bounded retry loop (`INITIAL_RELOAD_MAX_ATTEMPTS = 5`, exponential backoff 1s/2s/4s/8s) with the LISTEN-driven retry path as a safety net of last resort.
- 4 new unit tests exercise the retry policy without 15s of real-time sleep (injected `instant_backoff` fixture).

The whole class of "rolling deploy + Supavisor session-mode pool saturation → NEW container can't start" is now closed for both pools. The whole class of "trigger_loader silently leaves an empty TriggerSet for the lifetime of the container" is now closed via the retry loop.

### Updated open follow-ups

1. ✅ **Listener-pool eager-init crash-loop on rolling deploy** — resolved this pass. v0.1.42 first attempt failed; second attempt with the lazy switch shipped clean.
2. 🟡 **`WORK_SERVICE_DATABASE_POOLER_URL` mode drift / `pool_size = 16` ceiling** — still open. Both pools are now lazy, so the ceiling no longer crashes deploys, but Supavisor session-mode with 16 slots is still tight when both pools + the OLD container all need slots simultaneously. Track separately as an ADR (transaction-mode flip + `set_config(..., true)` per-tx GUC pattern).
3. ✅ **Convert `trigger_loader: initial load failed; will retry on first NOTIFY` to error severity at giveup** — done by the retry loop's giveup branch.
4. 🟡 **`work_trigger_set_total` Prometheus gauge for empty-set detection** — still open as a defence-in-depth ask. The v0.1.42 retry plus the `info!` success log at attempt completion give us observability today, but a periodic gauge would catch a hypothetical future variant of this bug class without log inspection.
5. 🟡 **`dispatcher_phase1.rs` integration tests in CI** — still open from [[Fix-RF-Cycle-Count-Stuck-Waiting]]. The new `triggers::loader::tests::*` retry tests are NOT DB-gated and DO run in CI — this is the right shape going forward.

### Anomalies (PM v0.1.42-followup pass)

- The first v0.1.42 deploy `f62ad870-…` is retained as FAILED in Railway's deployment list per the binding constraint ("DO NOT remove the failed `f62ad870-…` or `8850b07d-…` deployment artifacts"). Both are useful as historical evidence of what the eager-pool crash-loop looks like.
- HTTP routes returned **5xx for ~7 s** during the deploy window (16:33:27Z–16:33:35Z) as the new container's general pool tried to acquire its first connection while the OLD container still held Supavisor's session-mode slots. Cleared organically as the OLD container drained. Same shape as the morning's v0.1.41 5xx blip; expected and bounded — the lazy-pool pattern's documented trade-off.
- Redis connectivity probe also timed out at boot (`timeout_secs=5`). Pre-existing; the AM session note documents the lazy-Redis pattern's WARN-and-continue behaviour. Unrelated.
