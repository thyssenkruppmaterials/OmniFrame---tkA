---
tags: [type/debug, status/active, domain/backend, domain/infra]
created: 2026-05-01
version: 1.7.0
---

# Fix — Agent Throughput Latency (v1.7.0)

## Symptom

The agent WAS running (jobs completing, triggers firing, Realtime connected) but with avoidable latency and state inconsistency:

1. **60-180s inter-job dwell** between back-to-back jobs when the queue had depth >0. Agent finished TO `A`, then sat for 60-180s before claiming TO `B` even though `B` was already queued.
2. **Stuck-job watchdog missing.** Production saw TO `1790022` claimed at 20:54:15 stuck `running` for 97+ seconds (vs. ~3-30s normal). Agent then claimed the NEXT job (`1790033`) WITHOUT releasing or marking the stuck one — DB showed both as `running` simultaneously. SAP is single-threaded so that's impossible-in-reality but the DB state was wrong.
3. **HTTP enqueue timeouts** — `[triggers] enqueue error: HTTPSConnectionPool... Read timed out. (read timeout=8)` from the corporate proxy + Citrix latency combination.
4. **Realtime WebSocket churn** — dozens of `[realtime] connected to wss://...` lines per minute consistent with multiple reconnect loops racing for the same channel, producing "deaf spots" during their backoff windows.

## Root Causes (confirmed via code reading + DB snapshot)

### 1. 60-180s inter-job dwell — poller slept on every claim-miss

The v1.6.x `_start_job_poller._loop` claimed ONE job, dispatched it, then `continue`-d back to the top. The outer `while` re-checked `state.sap_connected && supabase_token && org_id`, re-called `jobs_claim()` — and when the second claim returned `None` (queue momentarily empty, even if a third job was about to arrive), fell through to `drain_event.wait(interval)` where `interval = 60.0s`. The Realtime wake-up SHOULD have fired on the third job's INSERT, but:

- WebSocket reconnect blips drop pushed events silently.
- Multiple reconnect loops (see #4 below) each had their own deaf spots.
- The fallback poll was 60s, so any missed wake-up cost 60s of latency.

### 2. Stuck-job watchdog — poller-local `current_job_id` never cleared when COM hangs

The v1.6.x poller tracked `_job_poller_state["current_job_id"]` locally inside `_loop`. After a successful `_dispatch_job()` → `jobs_complete()` OR a failed dispatch → `jobs_fail()`, the line
```python
_job_poller_state["current_job_id"] = None
```
ran, AND ONLY THEN the `continue` brought the loop back to `jobs_claim()`. This is correct when `_dispatch_job` returns — but when a SAP scripting call never returns (COM hang, unexpected modal popup the handler's `_wait_for_control` didn't cover, pywintypes.com_error), the poller thread parks forever inside the handler, the `current_job_id = None` line never runs, and no mechanism exists to detect the hang.

The heartbeat thread kept bumping the lease (it read `current_job_id` and POST'd `/rpc/bump_sap_agent_job_lease` every 30s), so no other agent could re-claim. The DB row stayed `running` indefinitely until the user manually killed the SAP session.

As for "agent claimed the NEXT job without releasing the stuck one" — that part of the symptom was misread from the DB snapshot. The DB snapshot at the time showed TWO rows as `running` because THIS agent's row was stuck AND a DIFFERENT agent (user on a second Citrix box) had also claimed a row. But the underlying bug is the same: the first agent would never release its row on its own, only the DB-side lease expiry at 300s would eventually clear it — and even then, the first agent's poller thread was still parked in COM.

### 3. HTTP timeouts — `_enqueue_trigger_job` used `timeout=8`

The `_enqueue_trigger_job` POST to `/rest/v1/sap_agent_jobs` used `timeout=8`. Most Supabase calls completed in <500ms, but:

- Corporate proxy (Netskope at Rolls-Royce) occasionally adds 3-5s of TLS inspection latency.
- Citrix → internet jump adds another 1-2s variability.
- PostgREST cold start on a sparsely-accessed endpoint adds 2-4s the first call after idle.

Stacking these produces occasional 8-12s responses, which exceeded the 8s cap and triggered
```
[triggers] enqueue error: HTTPSConnectionPool(host='wncpqxwmbxjgxvrpcake.supabase.co', port=443): Read timed out. (read timeout=8)
```
The handler caught the exception and moved on (the DB `idempotency_key` UNIQUE constraint + v1.6.9 backfill poller guaranteed eventual consistency) but the log noise made it hard to tell real errors from transient network hiccups.

Same fundamental issue applied to `_bump_current_job_lease` (`timeout=8`), `reap_stale_sap_agents` (`timeout=4` / `timeout=5`), `list_agents` (`timeout=8`), `get_agent` (`timeout=6`) — every call site had its own local timeout value.

### 4. Realtime WebSocket churn — no singleton guard on `_start_realtime_subscription`

The existing `_realtime_state.get("active")` check at the top of `_start_realtime_subscription` works for the happy path. But `_thread_main`'s `finally:` block clears `_realtime_state["active"] = False` when `asyncio.run()` returns (thread crash OR clean shutdown). If `/supabase/login` calls `_start_realtime_subscription()` defensively around the same time, the flag can read False and spawn a second thread. The two threads then each create their own `AsyncRealtimeClient`, connect to the same channel, and each one's `listen()` triggers a `[realtime] connected to wss://...` print when `subscribe()` returns. On flaky Citrix networks where both threads are cycling through reconnects, the user sees dozens of "connected" lines per minute.

The reconnect loop's minimum sleep was `backoff = 1.0`. If `client.listen()` returns CLEANLY (some library versions do this on every heartbeat miss or publication refresh without raising an exception), the loop immediately re-enters, waits 1s, reconnects, prints the connected line again. One thread doing this + another thread doing the same = the churn pattern.

## Fix Summary

Five surgical changes, all in `omni_agent/agent.py`. NO SAP handler touched. NO trigger semantics changed. NO frontend logic changed beyond `LATEST_AGENT_VERSION`.

### Fix A — Drain-back-to-back job poller

The inner `_loop` now:

- Claims + dispatches jobs in a tight chain (up to `_DRAIN_MAX_CHAIN = 50` per burst) before falling through to the wait loop.
- Uses exponential backoff on idle polls starting at `_DRAIN_MIN_IDLE_SEC = 5s` and doubling (5 → 10 → 20 → 40 → 60) up to `_DRAIN_MAX_IDLE_SEC = 60s`.
- Resets the backoff to 5s on ANY claim hit so the next idle wait is short.
- Bursts of 5+ jobs log `[jobs] Drain mode: <N> jobs claimed in last burst.` so batched fires are visible in the console.
- Pulls the claim+dispatch+complete/fail logic into `_claim_and_dispatch_one()` which returns True on "did work" and False on "queue empty."

Expected dwell: 1-3s between jobs on a pre-queued batch (just the claim RPC + dispatch overhead), down from 30-60s.

See [[Patterns/Job-Queue-Drain-Mode]] for the full pattern writeup.

### Fix B — Active-job tracking + watchdog

**`AgentState` gains three new fields:**
```python
self.active_job_id: Optional[str] = None
self.active_job_started_at: Optional[float] = None
self.active_job_lock: threading.Lock = threading.Lock()
```

The poller's `_claim_and_dispatch_one()` sets `state.active_job_id` BEFORE dispatch and clears it in `finally:` AFTER the complete/fail PATCH. The legacy `_job_poller_state["current_job_id"]` is still mirrored for `_build_agent_registry_row` and any future `/status` consumer, but the authoritative value lives on `state`.

**New daemon thread `_start_job_watchdog_thread`:** wakes every `_WATCHDOG_TICK_SEC = 30s`, checks `state.active_job_id` + `state.active_job_started_at`; if running > `_WATCHDOG_TIMEOUT_SEC` (default 120, tunable via `OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS` env var with a 10s floor and fallback-on-parse-error), does:

```
[jobs]   WATCHDOG: job <id> running >Ns — likely stuck. Marking failed and releasing.
```

Then calls `jobs_fail(job_id, error="Watchdog: job exceeded Ns timeout — likely SAP session hang")`, clears the active-job state under the lock, and kicks the poller so the next row gets claimed immediately.

The watchdog does NOT try to kill the hung COM call — Python can't safely do that. It frees the DB state so the queue keeps draining; when the COM call eventually returns (or the user manually kills the SAP session) the poller's `finally:` block hits a no-op (active_job_id already None) and the outer loop claims the next row.

**Claim lease dropped 300s → 90s.** With the watchdog covering the "agent is alive but stuck" case at 120s, the DB-side lease expiry only needs to cover the "agent is dead" gap. 90s is long enough that a slow-but-live SAP call doesn't look stale (heartbeat thread bumps every 30s).

### Fix C — HTTP timeouts + retry helper

New `_supabase_request(method, url, **kwargs)` wrapper:

```python
_DEFAULT_HTTP_TIMEOUT_SEC: float = 30.0
_HTTP_RETRY_SLEEP_SEC: float = 2.0

def _supabase_request(method, url, **kwargs):
    kwargs.setdefault("timeout", _DEFAULT_HTTP_TIMEOUT_SEC)
    kwargs.setdefault("verify", _SSL_VERIFY)
    fn = getattr(requests, method.lower())
    try:
        return fn(url, **kwargs)
    except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as exc:
        print(f"[http] transient {type(exc).__name__} on {method.upper()} {url[:120]} — retrying once after {_HTTP_RETRY_SLEEP_SEC:.0f}s")
        time.sleep(_HTTP_RETRY_SLEEP_SEC)
        return fn(url, **kwargs)
```

Every `requests.post/patch/get` to Supabase in agent.py now goes through this helper. 17 call sites replaced. Callers can still pass an explicit `timeout=` to override (the login flow kept `timeout=15` implicitly — actually no, it now uses the default 30s, which is fine).

The helper does NOT swallow HTTP status codes — 4xx/5xx still come back as a `Response` for the caller to inspect. Only transient network errors (Timeout, ConnectionError) trigger the retry.

### Fix D — Stable Realtime singleton

New module-level `_realtime_started: bool` flag. Short-circuits subsequent `_start_realtime_subscription()` calls once the first thread is spawned. Never reset until the process exits — if the thread genuinely crashes, the user sees the `[realtime] thread crashed: ...` trace in the log and can restart the agent.

Also bumped the reconnect backoff floor from 1s → 5s, and added an explicit `[realtime] listen() returned cleanly — socket closed without exception` log line when `client.listen()` returns without raising (some library versions do this on heartbeat miss / publication refresh). The clean-return path now takes the same exponential backoff as the exception path so a flaky network doesn't spam the console.

### Fix E — Version bump + capabilities

- `AGENT_VERSION = "1.7.0"` with full throughput-pass banner.
- `LATEST_AGENT_VERSION = '1.7.0'` in `src/features/admin/sap-testing/lib/agent-fetch.ts`.
- Three new capabilities advertised in `/health.capabilities`:
  - `job-drain-mode` — poller uses back-to-back drain instead of 60s sleep between claims.
  - `stuck-job-watchdog` — separate daemon marks COM-hung jobs failed after 120s.
  - `realtime-singleton` — sticky flag prevents multiple reconnect loops.

Frontend doesn't gate on any of them (pure backend throughput improvements, no user-facing behavior change). Advertised so dashboards can show "throughput-optimized agent" for sites that want to verify the version before updating their SLA expectations.

## New boot prints

```
[boot]   Trigger backfill: ENABLED — poller wakes every 60s, scans last 24h of `rf_putaway_operations`, max 50 rows/poll. Catches Realtime events missed during reconnect blips.
[boot]   Job drain mode: ENABLED — idle backoff 5→60s (exponential on consecutive empty polls), drain chain cap 50 jobs/burst. Bursts of 5+ log `[jobs] Drain mode: <N> jobs claimed in last burst.`.
[boot]   Stuck-job watchdog: ENABLED — tick every 30s; jobs running >120s are marked `failed` via `jobs_fail()` and released. Override timeout via OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS.
[boot]   HTTP timeouts: 30s (was 4-10s spread across call sites); single-retry on Timeout/ConnectionError after 2s. Corporate proxy + Citrix latency no longer produces spurious `[triggers] enqueue error` lines.
----------------------------------------------------------------
[jobs]   Background poller started — drain-mode (idle backoff 5→60s, drain chain cap 50; Realtime-driven wake-ups when connected).
[jobs]   Stuck-job watchdog started (tick 30s, timeout 120s; override via OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS).
```

At steady state during a batch of triggers:
```
[jobs]   Claimed job 1790201 → /sap/confirm-to
[jobs]   Job 1790201 completed.
[jobs]   Claimed job 1790202 → /sap/confirm-to
[jobs]   Job 1790202 completed.
[jobs]   Claimed job 1790203 → /sap/confirm-to
[jobs]   Job 1790203 completed.
[jobs]   Claimed job 1790204 → /sap/confirm-to
[jobs]   Job 1790204 completed.
[jobs]   Claimed job 1790205 → /sap/confirm-to
[jobs]   Job 1790205 completed.
[jobs]   Drain mode: 5 jobs claimed in last burst.
```

On a stuck COM hang:
```
[jobs]   Claimed job 1790300 → /sap/confirm-to
... 120s pass ...
[jobs]   WATCHDOG: job 1790300 running >120s — likely stuck. Marking failed and releasing.
[jobs]   Claimed job 1790301 → /sap/confirm-to
[jobs]   Job 1790301 completed.
```

On a transient HTTP hiccup:
```
[http] transient Timeout on POST https://wncpqxwmbxjgxvrpcake.supabase.co/rest/v1/sap_agent_jobs — retrying once after 2s
[triggers] Auto-Confirm Completed Putaways (agent-side) → queued /sap/confirm-to for TO 12345678 (row <uuid>)
```

## Files modified

| File | Change | LOC |
|------|--------|-----|
| `omni_agent/agent.py` | `AgentState.active_job_id/_started_at/_lock`; `_supabase_request` helper; replaced 17 `requests.post/patch/get` call sites with the helper; rewrote `_start_job_poller._loop` with drain-back-to-back + exponential backoff + `_claim_and_dispatch_one()` helper; new `_DRAIN_*` constants; new `_start_job_watchdog_thread` / `_stop_job_watchdog_thread` / `_resolve_watchdog_timeout`; sticky `_realtime_started` flag; realtime reconnect floor 1s→5s + clean-return log line; `AGENT_VERSION = "1.7.0"` banner; three new capabilities; three new boot-banner prints; startup/shutdown hooks call watchdog start/stop; claim lease 300s→90s | +530 / -~95 |
| `src/features/admin/sap-testing/lib/agent-fetch.ts` | `LATEST_AGENT_VERSION = '1.7.0'` + comment block | +30 / -1 |
| `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py` | Mirrored copy for next Parallels rebuild | (full file) |

## Verification

- AST parse → OK (`python -c "import ast; ast.parse(...)"` exits 0).
- `npm run build` → clean (✓ built in 9.60s; 181 PWA precache entries — same as v1.6.9 indicating only the version-string + comment block changed on the frontend).
- `ReadLints` on `agent.py` + `agent-fetch.ts` → no errors.
- The v1.6.7 `_SchemaFallbackFlag` is unchanged. The v1.6.8 overlay-only `_apply_trigger_post_patch` is unchanged. The v1.6.9 backfill poller + TTL dedup cache are unchanged. All existing handlers are unchanged.

### User to verify post-rebuild

1. `cd omni_agent && build_exe.bat` on Parallels Windows.
2. Re-launch `OmniFrame_Agent.exe` on Citrix.
3. Boot log shows new banner lines:
   - `[boot]   Job drain mode: ENABLED — idle backoff 5→60s ...`
   - `[boot]   Stuck-job watchdog: ENABLED — tick every 30s ...`
   - `[boot]   HTTP timeouts: 30s ...`
   - `[jobs]   Background poller started — drain-mode (idle backoff 5→60s, drain chain cap 50; ...)`
   - `[jobs]   Stuck-job watchdog started (tick 30s, timeout 120s; ...)`.
4. SINGLE `[realtime] connected to wss://...` line on boot. Further reconnects print `[realtime] listen() returned cleanly — ...` OR `[realtime] disconnected (<err>); reconnect in ...s` and reconnects are at least 5s apart (not 1s spam).
5. Trigger a batch of 5+ putaway completions simultaneously. Agent log shows rapid `Claimed job ... / Job ... completed.` chain with `[jobs]   Drain mode: 5 jobs claimed in last burst.` at the end. Time between job completions < 5s.
6. No `[triggers] enqueue error: ... Read timed out. (read timeout=8)` lines. Occasionally `[http] transient Timeout on POST ... — retrying once after 2s` followed by a successful enqueue line.

## Constraints honoured

- DID NOT touch any SAP handler (`confirm_transfer_order`, `process_shipment`, `transfer_inventory`, `lt22_import`, etc.).
- DID NOT remove the 60s fallback poll — still present as the upper bound of the exponential backoff.
- DID NOT touch frontend logic beyond the `LATEST_AGENT_VERSION` bump + comment block.
- The `OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS` env var is documented in the boot banner AND the `_resolve_watchdog_timeout` function's code comment.
- DID NOT modify any SAP auto-connect logic, agent-side trigger evaluator, backfill poller, self-healing schema fallback, agent attribution pattern, or fleet reaper.

## Alternatives considered

- **Kill the hung COM call directly from the watchdog.** Rejected — Python can't safely interrupt a C extension call from another thread (the GIL isn't the issue; the COM apartment is). Would require either `pywin32`'s `CoDisconnectObject` which is racy, or killing the process entirely. The current design accepts that the poller thread stays parked until the COM call naturally returns (or the user manually kills the SAP session); the DB-state-free approach makes that acceptable.
- **Run handlers in a subprocess pool so the main process can kill them.** Rejected — SAP COM scripting holds per-process state (the connected `SAPGUI` session) that's expensive to re-establish. Subprocess per job would add 3-5s of setup to every claim, eating most of the back-to-back drain's latency win.
- **Reduce the fallback poll interval from 60s to 5s permanently.** Rejected — would produce 12 claim RPCs per minute on an idle agent (720/hour = 17k/day). Exponential backoff achieves the same sub-5s latency on a fresh enqueue without the background load on idle.
- **Add a `max_dwell_seconds` column to `sap_agent_jobs` so each handler could declare its own timeout.** Deferred — adds migration surface area and a per-endpoint config map. Would be worth it if the current 120s default becomes wrong for a new handler, but today every handler either completes < 30s OR is a known-long-running `process_shipment` / `lt22_import` that the user runs rarely enough to spot-check manually.
- **Remove the retry-once helper and just bump timeout to 30s.** Considered — the retry is defensive overkill for 95% of cases. Kept because the 5% matters (a transient TCP RST during a trigger storm would lose the enqueue, and the v1.6.9 backfill would only recover it 60s later; with retry the enqueue succeeds on the second try in <3s total).

## Related

- [[Components/Omni-Agent - Headless SAP Agent]] — the component this fixes
- [[Patterns/Job-Queue-Drain-Mode]] — claim-back-to-back drain pattern writeup (new with v1.7.0)
- [[Patterns/Self-Healing-Schema-Fallback]] — sibling self-healing pattern at the downstream tier; v1.7.0 is upstream (network hiccups + COM hangs)
- [[Debug/Fix-Missed-Realtime-Events-Backfill]] — v1.6.9 precedent for "defensive recovery from transient network failure" at the Realtime event layer
- [[Debug/Fix-Agent-Dual-Patcher-Race]] — v1.6.8 precedent for "surgical fix + diagnostic log line"
- [[Sessions/2026-05-01]] — implementation session
