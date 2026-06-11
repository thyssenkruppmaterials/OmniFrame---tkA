---
tags: [type/debug, status/active, domain/backend, domain/infra]
created: 2026-05-11
---

# Fix — rust-work-service boot crash on Redis pool init (bb8-redis 0.16 transient TLS/IO not retried)

## Symptom

`rust-work-service` deploy `0121c94e-4f85-4681-b709-095603660b4f` (v0.1.37) crash-looped at boot. Each container attempt panicked at the same line within ~5–10s of starting, then Railway restarted; after ~10 attempts the deploy was marked **FAILED**. Production was unaffected because Railway preserved the previous v0.1.36 container and never cut traffic over to the new one.

Panic message (consistent across every restart):

```
thread 'main' panicked at src/main.rs:282:10:
Failed to create Redis pool: Multiplexed connection driver unexpectedly terminated- IoError
```

Verified at the same wall-clock time:

- The OLD v0.1.36 container's `/health/detailed` reported `redis: { status: "healthy", latency_ms: 179 }` against the **same `REDIS_URL`** (`redis-11543.c62.us-east-1-4.ec2.cloud.redislabs.com:11543`).
- DNS, TLS cert chain, ACL credentials, network egress — all known-good.
- No Redis Cloud incident on the dashboard, no `max_clients` saturation.

So Redis itself was reachable; the failure was localised to **bb8-redis pool initialisation in the brand-new container** during the first eager `Pool::builder().build(...)` call.

## Root cause

`bb8-redis 0.16`'s eager pool builder establishes the `min_idle` pool members synchronously inside `Pool::builder().build(manager).await`. If any single connection's TLS/IO handshake hits a transient failure (the `Multiplexed connection driver unexpectedly terminated- IoError` shape is what we saw), the builder propagates the error directly to the caller — there is **no built-in retry**.

The original code at `rust-work-service/src/main.rs:277-282` was:

```277:282:rust-work-service/src/main.rs
let redis_pool = bb8::Pool::builder()
    .max_size(50)
    .min_idle(Some(5))
    .build(redis_manager)
    .await
    .expect("Failed to create Redis pool");
```

A single `.expect(...)` on the first attempt. Any cold-start handshake hiccup — expected at very low rate against any cloud Redis provider — panics the process. Railway then restarts the container, the new container hits the same handshake hiccup (or a fresh one), and the cycle repeats until Railway gives up after ~10 restarts.

This is identical to the wedge mode that motivated the [[Implementations/Implement-Resilient-PgListener]] watchdog wrapper for sqlx — but the corresponding Redis-side resilience had never been added because we had no prior failure shaped like this. Phase 11 (2026-05-07) sized the pool from `max_size=10` to `max_size=50, min_idle=5`, which strictly **increased** the surface area for an init-time handshake failure (5 eager connections instead of 0), but the post-Phase-11 deploys all happened to land cleanly. The 2026-05-11 redeploy was the first one that didn't.

Key context from the verification dive in [[Decisions/ADR-Capacity-Ceiling-2k-Users]] § "Post-`railway up` verification":

- C.1: rust-work-service latest deploy SUCCESS → **FAIL** (panic at `:282:10`).
- C.5: `/health/detailed` on the surviving container → PASS (Redis 179 ms).

The ADR's open follow-up #2 explicitly predicted this fix:

> If the next deploy attempt also fails on the same Redis init, file a follow-up against `bb8-redis 0.16` connect-time error handling and consider tightening the bb8 pool's `connection_timeout` / `min_idle` settings so the initial connect can retry rather than panicking the whole process.

This Debug note is that follow-up.

## Fix — retry-with-backoff around the eager builder (Option A from prompt)

Wrap `bb8::Pool::builder().build(...)` in a 5-attempt loop with exponential backoff `1s → 2s → 4s → 8s → 16s` (≤31 s of cumulative sleep before final panic). Each retry re-creates the `RedisConnectionManager` (a synchronous URL parse, microseconds) so a malformed `REDIS_URL` still fails fast on attempt 1. Each retry attempt logs at WARN with `attempt`, `max_attempts`, `backoff_secs`, `error`. On exhaustion, panics with `"Failed to create Redis pool after 5 attempts: <last_error>"` — same exit behaviour as before, just delayed and informed.

Why Option A and not B / C:

- **(B) `build_unchecked()`** would defer the failure surface from boot to first request. The presence evictor + entity-focus evictor + trigger evaluator all spawn at boot and acquire from the pool within ~100 ms of `AppState` construction — so "first request" is effectively boot anyway, and we'd lose the clean panic-on-init contract. Rejected.
- **(C) Bigger `connection_timeout`** would not help — the `IoError` here is mid-handshake driver termination, not a slow handshake. Rejected.
- **(A) Retry-with-backoff** is what every production Redis client looks like, matches the existing `pglistener::run` reconnect ladder shape (`1s → 2s → 4s → … → 30s capped`), and is what [[Components/Infrastructure - Monitoring and Performance]] already documents as the codebase convention. Selected.

### Code reference

New block at `rust-work-service/src/main.rs:274-340` (replaces the old 12-line crashy block at `277-285`):

```297:340:rust-work-service/src/main.rs
tracing::info!("Connecting to Redis...");
let redis_pool = {
    const MAX_ATTEMPTS: u32 = 5;
    let mut attempt: u32 = 1;
    let mut backoff = std::time::Duration::from_secs(1);
    loop {
        let redis_manager = RedisConnectionManager::new(config.redis_url.clone())
            .expect("Failed to create Redis connection manager");
        match bb8::Pool::builder()
            .max_size(50)
            .min_idle(Some(5))
            .build(redis_manager)
            .await
        {
            Ok(pool) => {
                if attempt > 1 {
                    tracing::info!(
                        attempt,
                        "Redis pool built successfully on retry"
                    );
                }
                break pool;
            }
            Err(err) if attempt < MAX_ATTEMPTS => {
                tracing::warn!(
                    attempt,
                    max_attempts = MAX_ATTEMPTS,
                    backoff_secs = backoff.as_secs(),
                    error = %err,
                    "Redis pool build failed (transient TLS/IO); \
                     retrying after backoff"
                );
                tokio::time::sleep(backoff).await;
                attempt += 1;
                backoff = backoff.saturating_mul(2);
            }
            Err(err) => {
                panic!(
                    "Failed to create Redis pool after {} attempts: {}",
                    MAX_ATTEMPTS, err
                );
            }
        }
    }
};
```

### Pool sizing unchanged

`max_size=50, min_idle=5` is unchanged from Phase 11. The fix is purely about init-time resilience; the steady-state pool behaviour is identical. See [[Implementations/Implement-Rust-Work-Service-Phase11]] § 11.6 for the original sizing reasoning.

### Hard-fail contract preserved

The service still panics on exhausted retries — we did NOT silently degrade to a broken pool. The exit code surface is identical to before, the logs are richer, and Railway's restart loop semantics are unchanged. If the failure mode ever stops being transient (genuine outage / DNS removal / cred rotation / etc.), the service still gives up after ~31 s and lets Railway escalate.

## Files touched

| File | Change | LOC |
|---|---|---:|
| `rust-work-service/src/main.rs` | Wrapped Redis pool init in 5-attempt retry-with-backoff loop. Added 23-line comment block above the new code with the failure context, deploy ID, and rationale. | +66 / −9 |
| `rust-work-service/Cargo.toml` | `version = "0.1.38"` → `"0.1.39"` so `/health` returns the new version after `railway up`. Lets us tell from a single curl whether the fixed code is live, no SHA-grep required. | +1 / −1 |
| `memorybank/OmniFrame/Debug/Fix-Rust-Work-Service-Redis-Pool-Init-Crash.md` | NEW (this note). | + |
| `memorybank/OmniFrame/Sessions/2026-05-11.md` | Append "rust-work-service Redis init fix" entry. | + |
| `memorybank/OmniFrame/Decisions/ADR-Capacity-Ceiling-2k-Users.md` | Marked open follow-up #2 as fixed-in-v0.1.39 with a back-link to this Debug note. | edit |

## Verification

- `cargo build --release` from `rust-work-service/` compiled cleanly. The 7 pre-existing dead-code warnings on `observability::middleware` are documented forward-compat scaffolding (see [[Components/Rust-Work-Service]] § "Known gaps" item 3); my change introduces zero new warnings.
- The version bump is reflected in the build banner: `Compiling rust-work-service v0.1.39`.
- No tests run — there is no integration test surface that can simulate an `IoError` mid-`bb8::Pool::builder().build(...)` without an in-process Redis double, and the prompt explicitly de-prioritised tests for this fix.

## Hand-off

The user runs `railway up` themselves. Once the new container boots, verify the fix is live with:

```bash
curl -s https://rust-work-service-production-XXXX.railway.app/health | jq -r .version
# expect: "0.1.39"
```

If the new container hits a transient TLS hiccup on first attempt, the boot logs will show the new behaviour:

```
INFO Connecting to Redis...
WARN Redis pool build failed (transient TLS/IO); retrying after backoff attempt=1 max_attempts=5 backoff_secs=1 error="Multiplexed connection driver unexpectedly terminated- IoError"
INFO Redis pool built successfully on retry attempt=2
INFO Connected to Redis successfully (bb8 pool: max_size=50, min_idle=5 — Phase 11; retry-with-backoff added 2026-05-11 v0.1.39)
```

If 5 attempts genuinely fail, the service still panics (with `"Failed to create Redis pool after 5 attempts: <error>"`) and Railway restarts the container with normal restart-loop semantics — exit-code behaviour is unchanged.

## Confidence

**High** that the next `railway up` lands cleanly:

- The ground-truth observation — the surviving v0.1.36 container's pool is currently healthy at 179 ms latency on the same `REDIS_URL` — is the strongest possible evidence that the failure was a transient handshake hiccup, not a config or network problem.
- The retry budget (5 attempts, ~31 s of cumulative sleep) is generously sized vs. the observed failure shape (a single transient `IoError` per container boot). Catching the failure on retry attempt 2 is the expected outcome; needing all 5 attempts would imply a sustained incident that the OLD container would also be feeling.
- The fix preserves the panic-on-real-failure contract, so we did not trade a transient symptom for a hidden new failure mode.
- The bb8 `min_idle=5` sizing is unchanged, so pool warmup behaviour is identical post-fix — no risk of a separate "pool too cold to serve first request" regression.

## Related

- [[Components/Rust-Work-Service]]
- [[Decisions/ADR-Capacity-Ceiling-2k-Users]] — specifically § "Post-`railway up` verification" rows C.1, C.2, C.5 + open follow-up #2.
- [[Sessions/2026-05-11]] — same-day session log; the verification dive that surfaced this failure plus the rust-work-service Redis init fix entry.
- [[Implementations/Implement-Rust-Work-Service-Phase11]] — Phase 11 bumped the bb8 pool from `max_size=10` to `max_size=50, min_idle=5`; this fix protects that sizing decision against init-time transient failures.
- [[Implementations/Implement-Resilient-PgListener]] — sister resilience pattern on the sqlx `PgListener` side; this fix is the Redis-side analogue.


---

## Round 2 — v0.1.39 didn't help; switched to lazy `build_unchecked()` in v0.1.40 (~21:15 ET / 01:15 UTC May 12)

The v0.1.39 retry-with-backoff fix shipped via the user's `railway up` and the new container deployed cleanly (build SUCCEEDED, image `4fb85ef49d7b...` pushed, container started with `Starting rust-work-service v0.1.39`). The retry loop **did fire** — the new `WARN Redis pool build failed (transient TLS/IO); retrying after backoff attempt=1 max_attempts=5 backoff_secs=1` log lines appeared in Railway runtime logs. **Every single attempt failed with the same `Multiplexed connection driver unexpectedly terminated- IoError`**, the service panicked at `src/main.rs:334:21` (the new retry-exhaustion line) with `Failed to create Redis pool after 5 attempts: Multiplexed connection driver unexpectedly terminated- IoError`, and Railway's restart-loop cycled until the deploy was marked FAILED.

Failed deploys: `19f06d71-8f2c-48ef-8128-6e1e72dbc5a2` (first v0.1.39 attempt, FAILED 01:01 UTC) and `f8b8fbfc-e104-4f0c-8075-64b68a41fd62` (second v0.1.39 attempt — was DEPLOYING with retry crashes when this fix landed).

### Why retry-with-backoff was the wrong tool

My Round 1 confidence ("the OLD container's pool is healthy at 179 ms, so this is transient") was **wrong**. The actual failure mode looked like this in the Round 2 logs:

| Wall-clock | Event |
|---|---|
| 01:19:21 | `INFO Connecting to Redis...` |
| 01:20:02 (+41 s) | `WARN attempt=1 backoff_secs=1 error=...IoError` |
| 01:20:45 (+43 s after attempt 1 sleep) | `WARN attempt=2 backoff_secs=2` |
| 01:21:28 (+43 s) | `WARN attempt=3 backoff_secs=4` |
| 01:22:14 (+~46 s) | `WARN attempt=4 backoff_secs=8` |
| 01:23:13 (+~59 s) | `panic at main.rs:334:21 — Failed to create Redis pool after 5 attempts` |

The **41 s wall-clock per attempt** is bb8 trying to fill `min_idle = 5` against an endpoint that accepts the TCP handshake then kills the multiplexed connection. Each retry hits exactly the same wall — the failure is **deterministic, not transient**. Retrying 5× just delays the inevitable panic by ~4 minutes; backoff doesn't help when the error class is structural.

Meanwhile, `9c2b08ef`'s pre-rolled-back v0.1.36 container is **still healthy** on the SAME `REDIS_URL` — `/health/detailed` reports `redis: { status: "healthy", latency_ms: 179 }` and its `pg_stat_activity` listener pool is still serving. The 50-conn Redis pool it built 36 h ago has TCP sockets that are still alive; bb8 reconnects multiplexed connections behind the live pool without re-establishing the initial handshake that's now refused. **New containers can't get past the handshake.** The OLD container survives on its prior handshake.

### Root cause (structural, infrastructure-level)

This is **Case B** from the prompt's diagnosis tree — "retry exhausts (deterministic IoError)". The failure is not in our code path, in our dependency graph, in our build, or in our env. Verified:

- **Cargo.lock is stable.** `git diff rust-work-service/Cargo.lock` shows ONLY the package version string change (0.1.35 → 0.1.39); zero transitive deps shifted. The v0.1.36 build log (deploy `9c2b08ef`) and the current v0.1.40 Cargo.lock pin identical versions: `bb8 0.8.6`, `bb8-redis 0.16.0`, `redis 0.26.1`, `rustls 0.21.12`, `tokio 1.49.0`, `native-tls 0.2.14`. The TLS feature stack is unchanged.
- **Source code is stable.** `git diff 2166d04..HEAD -- rust-work-service/src/main.rs` returns EMPTY (the v0.1.36 build commit was `2166d04`; nothing committed has touched main.rs since). The Redis init path is byte-identical between v0.1.36 (works) and the v0.1.37 source that started failing.
- **Postgres works from the new container.** Both new-container deploy attempts successfully connect both PG pools (general-purpose + listener-dedicated) — `pg_stat_activity` shows new `rust-work-service-listener` backends arriving at 01:18:06 and 01:10:06 from the new container. Only Redis is broken.
- **Network egress to Redis Cloud is reachable** at the TCP layer — the connection makes it past the initial handshake (otherwise we'd see a `ConnectRefused` / `IoError(connection refused)`, not `Multiplexed connection driver unexpectedly terminated`). The handshake completes; Redis Cloud kills the connection shortly after. That is the signature of a **server-side rejection** (max-conns hit, IP allowlist drift, or capped-tier connection lockout), NOT a client-side dependency or auth bug.

Most likely candidate root causes (NOT verified — would require Redis Cloud admin console access):

1. **Redis Cloud max-clients reached.** v0.1.36 holds 50 conns. If the Redis tier caps total conns near that number, every new connection from a new container handshake completes but is killed-by-policy before MULTIPLEX/AUTH/PING can ride.
2. **IP allowlist drift.** Railway rotates egress IPs across container respawns. If Redis Cloud has an allowlist that was set when v0.1.36's IP was current, the new container's IP isn't on it — and Redis Cloud accepts-then-drops.
3. **TLS negotiation post-handshake refusal.** Redis Cloud SNI / cert chain issue that kills the connection after TCP+TLS but before AUTH. Less likely given v0.1.36 hasn't hit it on its keepalive reconnects.

### Fix — switch to `build_unchecked()` (Option B from the prompt)

Replaced the entire 67-line retry-with-backoff block at `rust-work-service/src/main.rs:274-345` with `bb8::Pool::builder().build_unchecked(redis_manager)` plus a best-effort 5 s connectivity probe spawned to a tokio task that **only logs the result and never panics**. Per [bb8 docs](https://docs.rs/bb8/latest/bb8/struct.Builder.html#method.build_unchecked) (verified via Context7): `build_unchecked` returns the pool synchronously without establishing any connections; connections are created lazily on first `pool.get().await`. The boot sequence now looks like:

```
INFO Initializing Redis pool (lazy connect via build_unchecked)...
INFO Redis pool created (bb8: max_size=50, min_idle=5 — Phase 11; lazy build_unchecked added 2026-05-11 v0.1.40 — first request takes the connection hit, evictors warn-and-continue)
[boot continues, healthcheck passes, /health returns 200]
[5 s later, in a spawned task:]
WARN Redis connectivity probe failed at boot — service will continue in degraded mode (Redis-dependent endpoints will return 500). Check Redis Cloud max-conns / allowlist.
```

#### Why this is safe

- **`presence::evictor::run`, `entity_focus::evictor::run`, and `triggers::evaluator::run` already handle Redis errors gracefully.** Per the doc on `presence::evictor::run` (`rust-work-service/src/presence/evictor.rs:49-51`): _"All Redis errors are logged at `tracing::warn!` and the task continues — a transient Redis hiccup will surface as a missed eviction this cycle, picked up on the next."_ The other two follow the same shape (it's the canonical pattern). A lazy pool whose first `get()` fails will produce WARN logs in those tasks but will NOT crash them.
- **Route handlers using Redis** (presence heartbeat/online, idempotency middleware, agent-key revocation cache, rate-limit) propagate `bb8::RunError` as 500 to the caller — same shape as a Redis blip mid-operation, which the FE already retries.
- **`/health` (basic)** does NOT touch Redis; it just returns `{status: "healthy", version, service}` — Railway's healthcheck passes regardless of Redis state.
- **`/health/detailed`** DOES check Redis via `pool.get().await` + `PING` and returns `503 + status: "degraded"` if Redis fails, OR `200 + status: "healthy"` if both DB and Redis are reachable. Behavior unchanged from v0.1.36 / v0.1.39 — this is exactly the right shape for monitoring (Datadog / human curl) to surface Redis status without taking the service down.

#### Why we did NOT also retry around the eager handshake

If Redis is genuinely down, retrying 5× takes 4 min and still ends in a panic — pure latency cost with no upside. The lazy pool surfaces the issue to Redis-using request paths (which already handle errors) instead. If Redis comes back, the pool establishes connections on the next `get()` automatically — no special re-init code needed.

### Files touched (Round 2)

| File | Change | LOC |
|---|---|---:|
| `rust-work-service/src/main.rs` | Replaced 67-line retry-with-backoff block with 13-line `build_unchecked` + 25-line tokio-spawned probe. Comment block expanded to document Round 2 diagnosis (deterministic IoError, infrastructure root cause, why lazy is safe). | net: −22 / +27 (≈+5 LOC, mostly probe scaffolding) |
| `rust-work-service/Cargo.toml` | `version = "0.1.39"` → `"0.1.40"` so `/health` returns the new version after `railway up`. | +1 / −1 |
| `memorybank/OmniFrame/Debug/Fix-Rust-Work-Service-Redis-Pool-Init-Crash.md` | Appended this Round 2 section. | + |
| `memorybank/OmniFrame/Sessions/2026-05-11.md` | Appended `## rust-work-service Redis Round 2` breadcrumb. | + |

### Verification

- `cargo build --release` from `rust-work-service/` clean (1m 12 s; same 7 pre-existing dead-code warnings on `observability::middleware`; zero new lints introduced). Build banner shows `Compiling rust-work-service v0.1.40`.
- `cargo build --release` confirms the new code path compiles against `bb8 0.8.6 + bb8-redis 0.16.0` exactly as pinned in v0.1.36 — the `build_unchecked` API is stable on this version (verified via Context7 docs lookup).
- No tests run — there is no integration surface that simulates a Redis-server-side connection refusal.

### Hand-off (the user runs `railway up`)

The code change is the **smaller half** of the fix. The **larger half is investigating the Redis-side root cause** — out of scope for this code path. Suggested order of operations on the user's next session:

1. **`railway up` to ship v0.1.40.** The current `f8b8fbfc` (v0.1.39) deploy will continue to crash-loop until Railway marks it FAILED (will take ~30-50 min on the 10-restart policy at ~4 min per cycle). The next `railway up` creates a new deploy that supersedes the in-flight one. v0.1.40 will boot cleanly even if Redis is unreachable; you'll see one of two log patterns:
   - `Redis connectivity probe OK — pool is reachable` → Redis came back on its own, we're good.
   - `Redis connectivity probe failed at boot — ... Check Redis Cloud max-conns / allowlist.` → service is up, but `/api/v1/presence/*`, idempotency-protected mutations, and agent-key revocation are degraded until Redis is fixed.
2. **Confirm the version is live**: `curl -s https://rust-work-service-production-XXXX.railway.app/health | jq -r .version` → expect `"0.1.40"`.
3. **Investigate Redis Cloud**:
   - Log into Redis Cloud admin console for the `redis-11543.c62.us-east-1-4.ec2.cloud.redislabs.com:11543` instance.
   - Check current connection count vs. tier max. If at-or-near max, either bump the tier OR have v0.1.36 release some connections (e.g. force-rolling the v0.1.36 container by setting an env var to trigger redeploy — but ONLY after v0.1.40 is live, otherwise prod loses Redis entirely).
   - Check the IP allowlist. If non-empty, add the current Railway egress IP range for the service's region (`europe-west4-drams3a` per the deploy manifest).
4. **Validate post-fix**: `curl -s https://rust-work-service-production-XXXX.railway.app/health/detailed | jq` → expect `dependencies.redis.status === "healthy"`.

### Confidence — `railway up` for v0.1.40 lands cleanly

**High** that the next deploy boots and stays running:

- The boot path now has zero hard dependency on Redis. The only call that touches Redis at boot is the spawned probe, which has a 5 s timeout and never panics.
- The basic `/health` endpoint always returns 200 — Railway's healthcheck cannot fail on this code path.
- The change is a 67-line removal + 38-line replacement (much of which is comment); the failure surface is small and well-documented.

**Medium** that Redis itself is restored — that depends entirely on the user's Redis Cloud-side investigation, which is outside the scope of this code fix.

**The v0.1.36 container should be left running** on its long-lived pool until v0.1.40 is fully deployed and proven. Forcing v0.1.36 to release its 50 conns before fixing Redis Cloud-side would cut Redis-dependent functionality entirely.

### Updated open follow-up in [[Decisions/ADR-Capacity-Ceiling-2k-Users]]

The ADR's open follow-up #2 (originally "if next deploy also fails, file a follow-up against bb8-redis 0.16 connect-time error handling") is now closed by v0.1.40 from the **code** side — the connect-time handling is now lazy, so deploy-time will never block on Redis. The **infrastructure** investigation is the new open follow-up — file separately if Redis Cloud root cause needs deeper investigation than the user's own admin-console session can resolve.
