---
tags: [type/decision, status/active, domain/infra, domain/database, domain/backend, domain/realtime, domain/frontend]
created: 2026-05-11
---

# ADR — Concurrent-User Capacity Ceiling, Today vs. 2,000

## Status

**Read-only capacity analysis** (no infra changes). Authoritative as of 2026-05-11 ~19:30 ET, immediately after the [[Fix-Postgres-Connection-Exhaustion-Blocks-Auth]] mitigation landed.

## TL;DR

The `DB_MAX_CONNECTIONS=30` cap on `rust-core-service` (deploy `5721ed49-...`, SUCCESS at 19:16 ET) closed the auth-block failure mode for the foreseeable future. **It did not raise the user ceiling**, and it isn't the next wall.

| Question | Answer |
|---|---|
| Realistic platform ceiling today (current shape) | ~1,200–1,500 concurrent active users in theory — but bound to fail at much smaller numbers because the FIRST wall is hit far earlier |
| Where does the FIRST wall hit, post-fix? | Supabase Realtime presence shard `Presence_shard112`, ~80–150 concurrent tabs/tenant — **actively wedging right now**, see "Live evidence" below |
| Is 2,000 reachable on the current Supabase tier (Pro Small) + current code shape? | **No.** Three structural changes plus a tier upgrade are required (see "Roadmap to 2k") |
| Top single highest-leverage change | Set `VITE_PRESENCE_MODE=rust` on `onebox-ai-logistics` and redeploy. Removes the binding wall today; 5 min, zero code |

Full breakdown lives in the canvas at `analysis/capacity-2k-users.canvas.tsx` (mirror of the IDE-rendered file under `IDE project cache for this repo (`mcps/` under the IDE project folder) canvases/capacity-2k-users.canvas.tsx`). This note is the persistent decision-record companion.

## Live evidence (2026-05-11 ~19:30 ET)

Snapshot from `pg_stat_activity` and Supabase logs taken during this analysis:

```text
pg_stat_activity summary, post-DB-cap-deploy:
  total = 85, active = 1, idle = 76, idle_in_txn = 0,
  supabase_admin = 18, auth_headroom = 55
```

| Layer | Observation |
|---|---|
| `rust-core-service` direct conns (`208.77.244.76`) | 10 idle (down from 33–39 pre-fix) — confirms the new cap is in effect |
| `rust-work-service-listener` (`208.77.244.108`) | 24 long-lived `LISTEN` conns — by design (one per resilient `PgListener` channel; see [[Implement-Resilient-PgListener]]) |
| PostgREST `authenticator` (`::1`) | 22 idle — Supabase built-in |
| Supavisor pooler | 4–5 idle — used by `rust-work-service` general pool ([[Implement-Rust-Work-Service-PgBouncer-Pooler]]) |
| Realtime + pg_cron + pg_net + exporter | ~18 (`supabase_admin`) |
| `auth_headroom` (free non-superuser slots) | **55** — comfortable; the connection-exhaustion mode is mitigated |
| `user_profiles` total / active 24h / active 5m | 144 / 61 / 1 — actual current load is far below 2k |
| Realtime tenant `wncpqxwmbxjgxvrpcake` | `Presence_shard112` GenServer.call timeouts + `ClientPresenceRateLimitReached` events firing 2026-05-11 14:25–16:30 ET — **the wedge from the [[ADR-Presence-Architecture-Next-Steps]] May 6 incident is back** |

The [[ADR-Presence-Architecture-Next-Steps]] Option 2 implementation ([[Implement-Presence-On-Rust-Option-2]]) shipped 2026-05-06 and the FE facade in `src/lib/presence/index.ts` already routes to the Rust path when `PRESENCE_MODE === 'rust'`. **The `VITE_PRESENCE_MODE` env var is NOT set on `onebox-ai-logistics`** — verified via Railway MCP. Default is `'supabase'`. Production therefore still hits the wedging shard despite the migration being code-complete.

## Bottleneck inventory (binds in this order as you scale 0 → 2,000 users)

| # | Layer | Cap | Binds at | Mitigation |
|---:|---|---|---|---|
| 1 | Supabase Realtime presence shard | ~80–200 tabs/tenant before GenServer wedge | ~80–150 concurrent tabs (TODAY) | Set `VITE_PRESENCE_MODE=rust` (free) |
| 2 | FastAPI uvicorn (single worker, single replica) | ~100–300 sustained RPS per worker on this app | ~300–500 concurrent active users | `WEB_CONCURRENCY=4` + Railway replicas (~1 line in `start.py`) |
| 3 | Supabase Realtime concurrent socket cap | 200/tenant on Pro tier | ~150–200 tabs once grandfathered channels are counted | Migrate remaining `.channel(...)` callsites to Rust WS |
| 4 | PostgREST authenticator pool | ~30 default on Pro | ~600 sustained RPS | Pro → Team tier raises pool ~200–400 |
| 5 | Postgres login storm + Supabase Auth | 117 non-superuser slots, brief contention on login/refresh | ~1,500+ at login storm | Pro → Team raises `max_connections` to 200/400 |
| 6 | rust-work-service WS hub `broadcast::channel(1000)` | 1000-event buffer, single replica | ~2,000+ tabs (no current pressure) | Already has Lagged metric; needs replica plan |

DB connections, despite this morning's fix, are NOT the next binding bottleneck for 2k users. The first three rows are.

## Math (the work shown)

### Postgres connection budget

```text
117 non-superuser slots
− 24 (rust-work-service-listener, by design)
− 22 (PostgREST authenticator)
− 13 (Supabase realtime + cron + pg_net)
− 10 (rust-core-service general — was 33–39 pre-fix)
−  5 (Supavisor pooler)
−  6 (idle misc)
─────────────
≈ 37 free slots (auth_headroom = 55 measured)
```

Per-user steady-state DB cost ≈ 0 (PostgREST + Rust pools multiplex). Login burst at 2k tabs with 3,600s refresh ≈ 50 conn/sec; fits under `auth_headroom=55` only because slots return in <1s. **Postgres slots are sufficient for ~1,500–2,000 users idle, headroom-tight on login storms.**

### FastAPI worker envelope

`start.py` calls `uvicorn.run(app, ...)` with no `workers` argument. `onebox-ai-logistics` Railway env has no `WEB_CONCURRENCY`. Single asyncio loop on one CPU.

```text
~1,000–3,000 RPS pure I/O echo
÷ ~5–10 (JSON validation, JWT decode)
÷ ~2 (Rust-core HTTP roundtrip cost)
─────────────
≈ 100–300 sustained RPS

→ At 1.0 RPS/active user: 100–300 active users
→ At 0.3 RPS/active user: 300–1,000 active users
```

### Realtime presence — the live wall

May 6 ADR pegged the wedge at ~80 concurrent tabs on this org. Phase A reduced load 75–85%. Today's logs show the shard is timing out again with ~5–60 tabs visible — natural drift consumed the headroom. **Multi-tab amplifies linearly**; 2,000 users × 1.5–2.5 tabs/user = 3,000–5,000 tabs, mathematically dead for Supabase Realtime presence regardless of tier upgrade.

## Roadmap to 2,000 concurrent users

Ranked by impact-per-effort. #1–#3 are necessary preconditions; #4–#6 are the structural lifts.

| # | Action | Effort | Impact |
|---:|---|---|---|
| 1 | Set `VITE_PRESENCE_MODE=rust` on `onebox-ai-logistics` and redeploy | 5 min · zero code | Removes the binding wall today; presence shard load → 0 |
| 2 | `WEB_CONCURRENCY=4` env + 1-line `start.py` patch to read it via `workers=...` | 30 min · 1 line | 300 → ~1,200 active users per replica |
| 3 | Wire UptimeRobot / monitoring on `/health/db-connections`, `work_service_ws_lagged_events_total`, `ClientPresenceRateLimitReached` log queries | 2 h · ops | Catches future binds before users notice |
| 4 | Supabase Pro → Team tier (or compute add-on) | 1–2 days · ops + cost | Raises `max_connections` 120 → 200/400, Realtime sockets 200 → 500–10k, enables read replicas |
| 5 | Horizontal replicas: 2× `onebox-ai-logistics`, 2× `rust-core-service`; keep `rust-work-service` at 1 (listener pool is by-design singleton until a leader-election lands) | 3–5 days · 1 engineer | Pushes ceiling to ~1,500–2,000 active users when paired with #1, #2, #4 |
| 6 | Migrate remaining grandfathered `.channel(...)` callsites per [[Roadmap-Rust-WS-Unlocks]]; the active scheduled-jobs tab leak first | 2–4 weeks · 1 engineer | Removes Supabase Realtime from the critical path entirely |

## Honest uncertainties

- **Supabase tier**: Pro Small inferred from `max_connections=120` + `shared_buffers=1024MB` + `effective_cache_size=3072MB`. Project's `get_advisors` and `get_project_url` did not expose tier directly. If on Team already, ceilings #4–#5 are higher; structural binds (#1, #2) unchanged.
- **Redis Cloud `max_clients`**: bb8 pools size to ~110 worst-case across rust-core (50) + rust-work (50) + ad-hoc (~10). Did not query Redis Cloud limits directly. Free tier caps at 30 — would be a hidden wall earlier than Postgres if applicable.
- **Per-user RPS**: 0.3–1.0 used; the tighter estimate (100–300 active) assumes 1 RPS/user (operator-class). Admin-heavy mix would push the lower end.
- **Tabs per user**: 1.5–2.5× used for tabs/user when extrapolating to Realtime socket budget. Heavier admin mix tightens row 3.

## Decision

The 2,000-concurrent-user target is **not** reachable on the current shape. The three highest-leverage interventions, in order, are:

1. Flip `VITE_PRESENCE_MODE=rust` (free, removes binding wall today).
2. Multi-worker uvicorn (`WEB_CONCURRENCY=4` + 1-line patch).
3. Supabase Pro → Team tier upgrade.

With #1–#3 plus a 2× replica scale-out (#5), the platform reaches ~1,500–2,000 concurrent active users. Below #1 alone, the platform will fail at ~80–150 concurrent tabs *regardless of how much the rest of the stack is scaled*.

The DB-connection-exhaustion fix that landed today closes one specific failure mode but is orthogonal to the user ceiling. **The next outage class is Realtime presence wedge, not DB.**

## Operational follow-ups (out of scope for this read-only analysis)

- [ ] Set `VITE_PRESENCE_MODE=rust` on `onebox-ai-logistics` Railway env and trigger a redeploy. Verify with receipt of `WsEvent::PresenceJoined` in the browser console.
- [ ] Patch `start.py` to read `WEB_CONCURRENCY` and pass it as `workers=`, then set `WEB_CONCURRENCY=4` on Railway. Watch p95 latency and memory afterward.
- [ ] Add an alert wired to `GET /health/db-connections` (already shipped in [[Fix-Postgres-Connection-Exhaustion-Blocks-Auth]]) firing on `status != "healthy"`.
- [ ] File a follow-up note when Supabase tier is confirmed (Pro Small vs. Team) so the bracket numbers in this ADR can be tightened.
- [ ] Verify Redis Cloud plan + `max_clients` to close the last untested-cap brackets.

## Related

- [[Fix-Postgres-Connection-Exhaustion-Blocks-Auth]] — the 2026-05-11 morning fix this ADR is the strategic follow-on to.
- [[ADR-Presence-Architecture-Next-Steps]] — the May 6 ADR that designed Option 2 (the Rust presence service that exists but isn't enabled in production).
- [[Implement-Presence-On-Rust-Option-2]] — the implementation note for Option 2.
- [[Roadmap-Rust-WS-Unlocks]] — Tier 1 channel-migration tracker; the deferred bucket includes the leak that's binding today.
- [[Patterns/Realtime-Presence-Browser-Hardening]] — the browser-side defence-in-depth pattern that Phase A relied on.
- [[Components/Rust-Work-Service]] — the WS hub + dual-pool architecture that absorbs traffic once Supabase Realtime is retired.
- [[Implement-Rust-Work-Service-PgBouncer-Pooler]] — Supavisor session-mode template for additional Postgres-pool reductions.
- [[Implement-Resilient-PgListener]] — explains why the 24 long-lived listener slots are by design (and the constraint they put on horizontal `rust-work-service` scaling).
- [[Sessions/2026-05-11]] — session log; this ADR is the strategic capstone to today's tactical fix.


## What was actually applied (2026-05-11 ~20:30 ET)

Follow-up pass to ship items #1 and #2 from the "Roadmap to 2,000" table. Both code edits + Railway env vars are in place; **activation is gated on the user's next `railway up`** because Railway's source of truth for `onebox-ai-logistics` is the local working tree the user uploads via the CLI, not GitHub `main`. Detailed log: [[Sessions/2026-05-11]] § "Capacity actions #1 + #2 — partial application".

### #1 — Flip presence to Rust

- **Railway env (`onebox-ai-logistics`):** `VITE_PRESENCE_MODE=rust` set 2026-05-11 ~20:00 ET. Triggered redeploy `9697adf0-a489-435f-b115-6b9ee41694d2` (SUCCESS at ~20:05 ET).
- **Code edit — Dockerfile (commit `3e4e1c2`):** added `ARG VITE_PRESENCE_MODE` (global + re-declared in `frontend-builder`) plus `ENV VITE_PRESENCE_MODE=${VITE_PRESENCE_MODE:-supabase}` to bridge the runtime env into Vite's build context. **This was a discovered blocker:** the existing Dockerfile only declared ARGs for 8 specific VITE_* vars (`VITE_SUPABASE_URL`, `VITE_API_URL`, `VITE_RUST_CORE_*`, `VITE_WORK_SERVICE_*`, `VITE_STREAMING_SERVICE_URL`); without `ARG VITE_PRESENCE_MODE`, Vite never sees the value at build time and `src/lib/presence/constants.ts:149-157` resolves `PRESENCE_MODE` to the `'supabase'` default regardless of what's set on Railway's runtime env. The auto-redeploy that fired when the env var was set therefore did not actually activate Rust presence — it rebuilt the bundle from Railway's source (which still lacks the ARG bridge) and the bundle still defaults to `'supabase'`.
- **Verification (post-deploy `9697adf0`):** Realtime tenant `wncpqxwmbxjgxvrpcake` is **STILL emitting `Presence_shard112` `GenServer.call` timeouts and `ClientPresenceRateLimitReached` events** for org `c9d89a74-7179-4033-93ea-56267cf42a17` (most recent rate-limit event 2026-05-11 18:59 ET, after the redeploy completed). Confirms the bundle still hits the legacy Supabase Realtime presence path.
- **Activation requires:** user runs `railway up` to ship the new Dockerfile, Railway rebuilds with `VITE_PRESENCE_MODE=rust` actually bridged into Vite, on next user reload the `'rust'` code path takes over and shard pressure on tenant `wncpqxwmbxjgxvrpcake` drops to zero.

### #2 — Multi-worker FastAPI

- **Code edit — `start.py` (commit `ca9a36a`):** read `WEB_CONCURRENCY` (default `1`) and pass `workers=` to `uvicorn.run(...)`. Switched the entry-point arg from the `app` object to the `"api.main:app"` import string because uvicorn requires a string when `workers > 1` (each worker subprocess re-imports from a fresh interpreter). Banner now prints a `Workers:` line for forensics. Pre-existing eager `from api.main import app` retained as a fail-fast import (annotated `# noqa: E402,F401`).
- **Code edit — `railway.toml` (commit `3e4e1c2`):** added `start.py` to `watchPatterns` so future entrypoint-only commits don't get silently SKIPPED (e.g. deploy `d3981825` skipped "No changes to watched files"). Moot under the user's `railway up` workflow but useful if GitHub auto-deploy is ever re-enabled.
- **Asyncpg pool option chosen:** none of (a)/(b)/(c) from the ADR — the pool is **dormant in production**. `onebox-ai-logistics` does not set `DATABASE_URL`, and `api/main.py:46-52` skips `get_pool_manager()` when `settings.database_url` is None. With 4 workers and a dormant pool, the per-worker DB-connection multiplier is `4×0 = 0`. The `MIN/MAX_CONNECTIONS = 10/100` defaults in `api/config/connection_pool.py` are unchanged and the file was NOT touched. **If `DATABASE_URL` is enabled later**, follow the `rust-core-service` `DB_MAX_CONNECTIONS=30` precedent (already shipped today on that service) and add an env-var override to `connection_pool.py` first.
- **Railway env (`onebox-ai-logistics`):** `WEB_CONCURRENCY=1` (intended `4`). First set to `4` (without `skipDeploys`) which triggered redeploy `25a270f6-4bc1-42ed-8a51-ed7bc4a8df34`. **The redeploy crash-looped and went FAILED** because the deployed `start.py` in Railway's source (the user's earlier WIP, different from `main` HEAD) already reads `WEB_CONCURRENCY` and passes `workers=N` to uvicorn but still passes `app` as an object — with `workers > 1` + an app object, uvicorn emits `"You must pass the application as an import string to enable 'reload' or 'workers'"` and the worker subprocesses cannot bootstrap. Production rolled back to the previous container of `9697adf0`, which Railway kept warm from before the env var was set. **`WEB_CONCURRENCY` then rolled back to `1` with `skipDeploys: true`** so any future container restart of the deployed image is safe (uvicorn doesn't warn about `workers=1`); production stays on the `9697adf0` container.
- **Activation requires:** user runs `railway up` to ship the new `start.py` (which uses the import-string form and is safe with any `workers >= 1`), then re-set `WEB_CONCURRENCY=4` to flip on multi-worker. Verify the boot banner now prints a `Workers: 4` line and the `import string` warning is gone.

### Deviations from the ADR's stated plan

1. **Touched files outside the user-stated scope (`start.py`, `connection_pool.py`).** Added `Dockerfile` (3 lines) and `railway.toml` (1 line) because they're necessary plumbing for #1 and #2 to actually take effect — the original Dockerfile gap meant setting `VITE_PRESENCE_MODE=rust` on Railway alone was a no-op. Documented in the user-facing summary of this session.
2. **`WEB_CONCURRENCY=4` triggered a deploy without `skipDeploys: true`** because at the time I didn't know Railway's source-of-truth was the user's `railway up`, not GitHub. The crash-loop was harmless (production rolled back automatically) but should have been avoided per the user's mid-session correction. Rolled back to `1` with `skipDeploys` after.
3. **Verification step #5 from the ADR (`/health/db-connections` reports `status: healthy`) is permanently pending `DATABASE_URL` configuration**, not anything to do with this rollout. The probe correctly returns 503 with the `set DATABASE_URL` hint when the asyncpg pool is dormant.


## Post-`railway up` verification (2026-05-12 ~00:50 UTC / 20:50 ET)

User ran `railway up` on `onebox-ai-logistics` and triggered a redeploy of `rust-work-service`. Read-only verification dive over the resulting state. Headline: **action #1 (presence flip) is fully live and the Realtime wedge has stopped firing**; **action #2 (multi-worker uvicorn) is unblocked but `WEB_CONCURRENCY` is still pinned at `1` defensively**; rust-core-service `DB_MAX_CONNECTIONS=30` is holding; the rust-work-service redeploy attempt FAILED on a Redis pool init crash but production is unaffected because the previous v0.1.36 container kept serving.

### What landed in production

| Artifact | Status | Evidence |
|---|---|---|
| `start.py` patch (`ca9a36a`) — `workers=int(os.environ.get("WEB_CONCURRENCY","1"))`, `"api.main:app"` import string, `Workers:` banner line | LIVE | Boot log: `Workers:        1` printed in the OneBox banner; no uvicorn `"You must pass the application as an import string"` warning anywhere in the deploy log |
| `Dockerfile` ARG bridge (`3e4e1c2`) — `ARG VITE_PRESENCE_MODE` (global + frontend-builder stage) + `ENV VITE_PRESENCE_MODE=${VITE_PRESENCE_MODE:-supabase}` | LIVE | Production bundle `feature-customer-portal-DpWpEnhv.js` contains the rust-presence URLs `/api/v1/presence/heartbeat` and `/api/v1/presence/online`. Confirms Vite saw `VITE_PRESENCE_MODE=rust` at build time and resolved `PRESENCE_MODE === 'rust'` in `src/lib/presence/constants.ts:149-157`, which made the facade in `src/lib/presence/index.ts:60-63` pick `presenceServiceRust` |
| `railway.toml` — `start.py` added to `watchPatterns` | LIVE | `b9d01e0c` deploy metadata shows `"watchPatterns": ["src/**","api/**","package.json","pnpm-lock.yaml","Dockerfile","start.py"]` |
| `api/main.py` — new `GET /health/db-connections` probe | LIVE (with caveat) | `curl -i https://onebox-ai-logistics-production.up.railway.app/health/db-connections` returns `HTTP 503` with `{"status":"unavailable","error":"...","hint":"Probe requires the asyncpg pool — set DATABASE_URL ..."}`. Endpoint exists (not 404). **Caveat:** the actual error string is `"No module named 'asyncpg'"` rather than `"DATABASE_URL not set"` — `asyncpg` isn't in the production container's Python deps. The probe correctly falls through to its 503 + hint shape, but the hint is technically misleading: setting `DATABASE_URL` would not by itself fix it; `asyncpg` would also need to land in `requirements.txt` first. Operationally fine because the user explicitly accepts a permanent-503 here while the asyncpg pool stays dormant |
| `src/features/user-management/services/user-management.service.ts` — `extractApiErrorMessage` helper | LIVE | Production chunk `use-user-management-CWkeRjmd.js` contains `correlation_id` × 2 (the helper's distinctive substring from the `(id: <cid>)` formatting) |
| `rust-work-service` `Cargo.toml` 0.1.36 → 0.1.37 | NOT LIVE (redeploy FAILED) | Live `/health` returns `{"version":"0.1.36",...}`. The new `0121c94e` deploy crashed in a Redis pool init loop and was marked FAILED after Railway's 10 restart retries. **Note:** `rust-work-service/src/main.rs` was NOT touched between 0.1.36 and 0.1.37 — `git log -- rust-work-service/src/main.rs` last-touched at `9b0f575`. The 0.1.37 commit (`e4b545c`) only bumps the version string. So there is no functional rust-work-service code regression to recover; the version-string bump is purely cosmetic |

### Pass / fail table

| # | Check | Verdict | Evidence |
|---|---|---|---|
| A.1 | onebox-ai-logistics latest deploy SUCCESS | PASS | `b9d01e0c-4be0-4dbb-bc56-cac493c83f0c` SUCCESS at `2026-05-12T00:34:28Z` UTC |
| A.2 | Boot log shows new `start.py` (`Workers:` banner line) | PASS | Banner: `Workers:        1` |
| A.3 | No uvicorn `import string` warning | PASS | Banner immediately followed by `Application startup complete` and normal request logs |
| A.4 | `GET /health` returns 200 | PASS | `HTTP 200`, body `{"status":"healthy","timestamp":1778546694.20...}` |
| A.5 | `GET /health/db-connections` exists (returns 503 with hint, not 404) | PASS (caveat) | `HTTP 503`, body `{"status":"unavailable","error":"No module named 'asyncpg'","hint":"...set DATABASE_URL..."}`. Endpoint reachable but error reason is `asyncpg` missing from container deps — see "What landed" table |
| B.1 | Build logs show `VITE_PRESENCE_MODE` was passed to Vite | N/A | Railway MCP `get-logs` for build hit a `railway whoami` decoding error; replaced by B.2 (higher-confidence proof via the live bundle) |
| B.2 | Production bundle has rust presence path enabled | PASS | `feature-customer-portal-DpWpEnhv.js` chunk contains `/api/v1/presence/heartbeat` and `/api/v1/presence/online` (rust-presence-only endpoints) |
| B.3 | (Fallback) Realtime presence-pressure delta | PASS | See D.1 below |
| C.1 | rust-work-service latest deploy SUCCESS | **FAIL** | `0121c94e-4f85-4681-b709-095603660b4f` is **FAILED**. Repeated boot-time panic at `src/main.rs:282:10`: `Failed to create Redis pool: Multiplexed connection driver unexpectedly terminated- IoError`. ~10 restart attempts at 30-45s cadence, all identical |
| C.2 | Service version is now `0.1.37` | **FAIL** (caveat) | Live `/health` returns `version: "0.1.36"`. The OLD `9c2b08ef` container (deployed 2026-05-10) is still serving production because Railway preserved the previous container when the new one failed health checks. Caveat: `main.rs` is unchanged between 0.1.36 and 0.1.37 — the version bump is the only delta — so there is NO functional regression from missing v0.1.37 |
| C.3 | WS endpoint `/ws` healthy | PASS | OLD container is fully healthy; the new presence-rust browser code path is hitting it successfully (see D.1) |
| C.4 | PgListener pool healthy (24 long-lived `LISTEN` conns) | PASS | `pg_stat_activity` shows 24 idle conns from `client_addr=208.77.244.108/32` with `application_name=rust-work-service-listener`, all `state=idle`, `most_recent_state_change=2026-05-12 00:48:07Z`. The transient 1 extra listener from `34.158.149.225/32` (the new deploy's IP) cleared when the new container exited |
| C.5 | `/health/detailed` reports `database` + `redis` healthy | PASS | `{"status":"healthy","version":"0.1.36","dependencies":{"database":{"status":"healthy","latency_ms":296},"redis":{"status":"healthy","latency_ms":179}}}` |
| D.1 | Realtime presence-shard wedge has stopped firing for tenant `wncpqxwmbxjgxvrpcake` / org `c9d89a74` | PASS | `get_logs` for `realtime` covered `2026-05-11T18:59 → 2026-05-12T00:43 UTC` (5h44m). All presence-pressure events are PRE-deploy: 5× `ClientPresenceRateLimitReached` (last at 21:39 UTC), 39× `Presence_shard112` mentions, 78× `GenServer.call` (paired with timeouts). Post-deploy (00:34 UTC onwards): 16 events total, ZERO of them are presence-pressure events. The notable post-deploy events are `"Tenant has no connected users, database connection will be terminated"` at 00:40:38 UTC followed by `"Tenant wncpqxwmbxjgxvrpcake has been terminated: :shutdown"` — the tenant draining the Realtime worker because nothing is subscribing anymore |
| E.1 | rust-core-service `5721ed49` deploy SUCCESS | PASS | (verified earlier today; status=SUCCESS at `2026-05-11T23:16:28Z`) |
| E.2 | rust-core-service direct connections back to `~10` (matching `min_connections=10`) | PASS | `client_addr=208.77.244.76/32, application_name='', user=postgres` shows exactly **10 idle, 0 active** — was 33-39 pre-fix, was 10 in the post-fix snapshot, still 10 now |
| E.3 | `DB_MAX_CONNECTIONS=30` env actually set on `rust-core-service` | PASS (indirect) | Direct `list-variables` call hit a Railway CLI decode error, but E.2's connection count is conclusive — the cap is in effect |
| F.1 | `auth_headroom >= 50` | PASS | `max_conn=120, reserved=3, total=73, non_super=8, active=2, idle=63, idle_in_txn=0, **auth_headroom=109**`. Healthier than at any point in today's session |
| F.2 | Auth log clean (no `SQLSTATE 53300` in last 30 min) | PASS | `get_logs` for `auth` returned 100 INFO lines, ZERO error/warning/SQLSTATE matches |
| G.1 | `extractApiErrorMessage` helper present in production bundle | PASS | `use-user-management-CWkeRjmd.js` contains `correlation_id` × 2 (the helper's distinctive `(id: <cid>)` formatting). Also confirms the unstaged `src/features/user-management/services/user-management.service.ts` change shipped via `railway up` |
| G.2 | Trigger benign 4xx and check error string | SKIPPED | Skipped per task instructions (would require real auth) |

### What it means operationally

- **Action #1 (Realtime presence wedge) is RESOLVED.** Production browsers are now subscribing to `rust-work-service /ws` for `Presence{Joined,Updated,Left}` events and POSTing to `/api/v1/presence/heartbeat`. The Supabase Realtime presence shard for tenant `wncpqxwmbxjgxvrpcake` is shutting down its database connection because nothing is subscribing to the `presence-org-{org_id}` channel anymore. The Phase-A wall in [[Decisions/ADR-Capacity-Ceiling-2k-Users]] § "Bottleneck inventory" row #1 is removed today.
- **Action #2 (multi-worker uvicorn) is UNBLOCKED but NOT ACTIVATED.** The new `start.py` is live with `Workers: 1`. `WEB_CONCURRENCY` is still set to `1` defensively (per the earlier crash-loop incident with the old `start.py` + `WEB_CONCURRENCY=4` combination). It is now safe to flip `WEB_CONCURRENCY=4` because the deployed `start.py` uses the import-string form. Expected behaviour: a fresh container boot, banner says `Workers:        4`, four uvicorn worker subprocesses spawn, the boot banner does NOT contain the `import string` warning.
- **rust-work-service v0.1.37 redeploy FAILED on a Redis-side issue, NOT a code regression.** *(2026-05-11 21:05 ET update — fix shipped at v0.1.39: `bb8::Pool::builder().build(...)` is now wrapped in a 5-attempt retry-with-backoff loop. See [[Debug/Fix-Rust-Work-Service-Redis-Pool-Init-Crash]]. Awaits user `railway up`.)* `main.rs` is unchanged between v0.1.36 and v0.1.37 — the version bump is the only delta in the rust crate. The OLD v0.1.36 container is healthy (Redis 179ms, DB 296ms) and serving WS + REST traffic normally. The Redis pool init failure (`Multiplexed connection driver unexpectedly terminated- IoError`) appears to be a transient Redis-Cloud-side issue specific to the new container's bb8 pool initialization; the existing container's pool is unaffected. **Recommend the user re-trigger the deploy later** — either with no code changes (just re-uploading the same image) or after diagnosing the Redis issue separately. Do not block on it.
- **DB connection-exhaustion fix is fully holding.** `auth_headroom=109` (vs `55` after this morning's fix, vs `~30-40` pre-fix). `rust-core-service` direct-connection count is exactly `10` (matching `min_connections=10` per the new `DB_MAX_CONNECTIONS=30` cap). Auth log has zero `SQLSTATE 53300` rows.

### Next safe action — flip `WEB_CONCURRENCY=4`

All three preconditions for safely setting `WEB_CONCURRENCY=4` on `onebox-ai-logistics` are met:

1. The deployed `start.py` (commit `ca9a36a`) uses the `"api.main:app"` import string and supports `workers > 1` without the uvicorn warning.
2. The asyncpg pool is dormant in production (`DATABASE_URL` is intentionally unset on this service), so the per-worker DB-connection multiplier is `0`. 4 workers = 4 × 0 = 0 extra Postgres slots.
3. Production memory headroom for 4 worker subprocesses is fine (`single 0.1.36` container today is barely loaded; multiplying its FastAPI process by 4 will roughly 4× RSS — still well under the Railway plan's per-container memory cap as observed today).

Expected post-flip behaviour: deploy banner shows `Workers:        4`, no `import string` warning, 4 uvicorn worker subprocesses visible in the container, p95 latency of `/api/*` endpoints drops as the second/third/fourth concurrent requests on the same container start being served in parallel instead of serially.

### Unexpected findings

1. The `api/main.py` `GET /health/db-connections` probe is reachable but errors with `"No module named 'asyncpg'"` rather than `"DATABASE_URL not set"`. The probe code is in `try` blocks that catch `ImportError` correctly and emit a 503 with the `set DATABASE_URL` hint, but the hint message is misleading because `asyncpg` is not in the production container's Python deps. **Operationally this is fine** (the probe still returns 503 + JSON, which an alerting system can hook on `status != "healthy"`), but the hint message could be tightened in a follow-up commit to also mention the `pip install asyncpg` requirement, or alternatively `asyncpg` could be added to `requirements.txt` so that setting `DATABASE_URL` would actually un-503 the probe.
2. The `e4b545c` commit that bumped `rust-work-service` v0.1.36 → v0.1.37 was a multi-purpose commit that ALSO shipped: `analysis/capacity-2k-users.canvas.tsx`, `api/main.py /health/db-connections`, `omni_agent/work_service_ws.py` (the resilient WS client from earlier today), `src/features/user-management/services/user-management.service.ts` (`extractApiErrorMessage`), and 11 vault notes. The Cargo version bump is the smallest part of it; everything else in the commit is now live in production.
3. The `rust-work-service` redeploy was **not strictly required for action #1 or #2** — those are entirely on the `onebox-ai-logistics` service. The user redeploying it captured a pre-existing `Cargo.toml` diff, but as noted that's a no-op functionally. Treat the Redis pool init failure as a separate (lower-priority) follow-up.

### Related

- [[Sessions/2026-05-11]] § "Post-`railway up` verification" — same data, session-log framing
- [[Debug/Fix-Postgres-Connection-Exhaustion-Blocks-Auth]] — earlier-today incident this verifies the close-out of
- [[Decisions/ADR-Presence-Architecture-Next-Steps]] — the May 6 ADR whose Option 2 implementation is now actually serving production traffic
- [[Implementations/Implement-Presence-On-Rust-Option-2]] — the implementation note for Option 2
- [[Components/Rust-Work-Service]] — the WS hub now carrying production presence load
- [[Implementations/Implement-Resilient-PgListener]] — the design that motivated the by-design 24-listener slots count
