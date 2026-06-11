---
tags: [type/debug, status/active, domain/backend, domain/infra, domain/realtime]
created: 2026-05-06
---

# Fix: Realtime Tenant Overload — OmniFrame Agent Compounding Supabase Presence Crash (v1.8.4)

## Symptom

Users reported the OmniFrame web app was failing to load — getting stuck at the sign-in screen for the entire org (`organization_id = c9d89a74-7179-4033-93ea-56267cf42a17`). Empirically: **closing the running OmniFrame Agent on any active user's machine immediately restored web-app loading for the rest of the org.**

## Diagnosis (chained evidence)

1. **Supabase Realtime Presence GenServer crashing for tenant `c9d89a74`.** Presence_shard112 timeouts on `:track` calls coming in from the Customer Portal session. The shard had wedged.

2. **GoTrue (Auth) `/user` requests at ~2.2 seconds** (healthy is <100ms). Users were stuck mid-sign-in because the auth layer was contending with the Realtime layer for the same Postgres pool / network egress.

3. **OmniFrame Agent v1.8.2** subscribes to four Realtime channels (`sap_agent_jobs`, `rf_putaway_operations`, `work_tasks`) on a 10-second heartbeat. On the agent side we observed a **clean-close reconnect cycle every ~5 seconds** (12+ reconnects/min). Each reconnect = WebSocket teardown + 3-channel re-subscribe burst against the same overloaded tenant.

4. **The v1.8.0 clean-close circuit breaker was too lenient.** Thresholds: 5 closes in 60s = trip, then a fixed 5-min auto-retry. On a chronically degraded tenant the agent ended up cycling forever: trip after ~25s of cycling, wait 5min, re-trip after 25s of cycling, wait 5min, … forever. Net effect: the agent contributed 25s of Realtime load every 5 minutes, indefinitely. With multiple agents in the org, this compounded.

5. **The reconnect math made it worse.** v1.7.0 reset the reconnect delay to 5s on every successful subscribe and DOUBLED it on close (5 → 10 → 20 → 40 → 60). On a flaky tenant where each subscribe succeeds but listen() returns within seconds, the cycle was 5s, 10s, 20s, then back to 5s on the next "success" — an aggressive ladder that compounded tenant load.

## Why the agent matters here

The agent is just one of many Realtime clients. But it's the one we can change. The customer-portal session was the actual source of the Presence GenServer crash; reducing the agent's Realtime footprint reduces the pressure on the same underlying tenant resources (Realtime workers, Postgres replication slot, network egress) that the customer portal needs to recover.

## Fix — v1.8.4: Aggressive degradation when Realtime is unhealthy

### New circuit-breaker thresholds

| Setting | v1.8.0 | v1.8.4 | Rationale |
|---|---|---|---|
| `_REALTIME_SPURIOUS_CLOSE_WINDOW_SECONDS` | 60s | **30s** | Halve the observation window so a flapping tenant trips faster. |
| `_REALTIME_SPURIOUS_CLOSE_THRESHOLD` | 5 | **2** | Trip after just 2 spurious closes — a single transient blip is fine, two in 30s is a clear pattern. |
| `_REALTIME_SPURIOUS_MIN_CONNECT_AGE_SEC` | 30s | **15s** | Any close inside 15s of subscribe counts as spurious (was 30s — too generous on a tenant that idle-closes in 5s). |
| Initial cooldown after trip | 5min | **30min** | Stop hammering a degraded tenant. |
| Cooldown growth | none (fixed) | **doubles** (60min, 120min, 240min, **6h cap**) | A chronically broken tenant gets a long break, not 12 retries/hour. |
| Reset of `consecutive_trips` | n/a | only after `connect_age >= 60s` | One stable connection clears the ladder; one trip-trip-trip pattern climbs it. |

### Slower reconnect ladder (even when Realtime is allowed)

| Setting | v1.7.0 | v1.8.4 |
|---|---|---|
| `_REALTIME_RECONNECT_INITIAL_DELAY_SEC` | 5s | **15s** |
| `_REALTIME_RECONNECT_MAX_DELAY_SEC` | 60s | 60s (unchanged) |
| Per-attempt growth | × 2 (multiplicative) | **+ 5s (additive)** |
| When does it reset to initial? | every successful subscribe | only after `connect_age >= 60s` |

Additive +5s growth means the ladder is now 15 → 20 → 25 → 30 → 35 → 40 → 45 → 50 → 55 → 60. A flapping tenant that lasts 5s per subscribe never gets the reconnect floor back down to 5s, so the agent generates dramatically less Realtime load even when Realtime mostly works.

### `OMNIFRAME_DISABLE_REALTIME=1` escape hatch

The nuclear option for environments where Realtime is reliably unstable. Set the env var, restart the agent, and:

- `_start_realtime_subscription()` returns immediately at boot.
- `state.realtime_disabled = True` is set so the job poller picks up the tightened 5→15s idle ceiling.
- Boot prints `[boot]   Realtime: DISABLED via OMNIFRAME_DISABLE_REALTIME=1 — using polling-only mode (job poller 5-15s, backfill poller 60s).`
- The reset loop is NOT spawned (no point — Realtime is intentionally off).

Polling-only mode is well-tested:
- Job poller (`_start_job_poller`) drains `sap_agent_jobs` with a 5-15s idle ceiling.
- Trigger backfill poller (`_start_trigger_backfill_poller`) wakes every 60s and scans `rf_putaway_operations` for missed events.
- Heartbeat thread keeps `sap_agents.last_seen_at` fresh at 30s/60s adaptive cadence (v1.7.8).

The ONLY thing the agent loses is sub-second Realtime push wakes. For most workflows (TO confirmation, bulk imports, fleet routing), the 5-60s polling latency is invisible to the user.

### Extended `/realtime/status` payload

Three new stable-contract fields plus one boolean:

```json
{
  ...existing fields...,
  "consecutive_trips": 3,
  "next_retry_seconds": 6420,
  "recommended_action": "Circuit has tripped 3 times in a row without a stable connection. Realtime is likely chronically broken (Supabase tenant overload, dead JWT, broken DNS). Set OMNIFRAME_DISABLE_REALTIME=1 and restart the agent to fully disable Realtime — polling-only mode is well-tested and won't lose any work, only sub-second push wakes.",
  "realtime_disabled_via_env": false
}
```

`recommended_action` switches between four states based on context:
- `OMNIFRAME_DISABLE_REALTIME=1` set → "Realtime is OFF via env var — restart with the var unset to re-enable."
- `consecutive_trips >= 3` → "Likely chronically broken — set OMNIFRAME_DISABLE_REALTIME=1 to disable."
- `circuit_tripped` (any consecutive count) → "Auto-retry in ~Xmin. If this keeps tripping, set OMNIFRAME_DISABLE_REALTIME=1."
- Healthy → "Realtime is healthy. No action needed."

## What v1.8.4 keeps unchanged

- v1.8.0 `_RealtimeCleanCloseTracker` class structure and disable-path wiring.
- v1.8.0 `hb_interval=10` WebSocket heartbeat.
- v1.7.1 `_RealtimeCircuitBreaker` (exception path) — runs in parallel.
- v1.7.1 `_REALTIME_FALLBACK_POLL_MAX_IDLE_SEC = 15` job poller fallback.
- v1.6.9 `_start_trigger_backfill_poller` 60s backfill cadence.
- All SAP handlers, all triggers, all migrations.

## Files Modified

| File | LOC delta | Notes |
|---|---|---|
| `omni_agent/agent.py` | +~190 LOC | New cooldown helper, env-disable check, reset-loop rewrite, /realtime/status extension, version banner. |
| `src/features/admin/sap-testing/lib/agent-fetch.ts` | +~70 LOC | v1.8.4 banner block + `LATEST_AGENT_VERSION = '1.8.4'`. |
| `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py` | mirror | Distribution copy for the next Windows EXE rebuild. |

## Quality

- AST parse on `agent.py` — clean (verified after every edit).
- `npm run build` — clean in 10.03s; no new bundle-budget violations.
- `ReadLints` on `agent.py` + `agent-fetch.ts` — clean.

## Constraints honoured

- **Surgical change.** Only the Realtime subsystem touched.
- **Polling-only mode preserved.** Already well-tested since v1.6.9 / v1.7.1 — agent stays fully functional with Realtime disabled.
- **v1.8.0 / v1.8.1 fixes preserved.** Clean-close detection still triggers, just with tighter thresholds; `shipment_queue` skip stays.
- **No Supabase Storage touched.** No migrations. No RLS changes.

## What to do RIGHT NOW (no rebuild needed for the env var)

The `OMNIFRAME_DISABLE_REALTIME=1` escape hatch is in v1.8.4. If users are still on v1.8.2 (the EXE shipped before this fix), they CANNOT use the env var directly because the v1.8.2 code doesn't read it. The rebuild becomes the recovery path:

```cmd
cd C:\Path\To\OmniFrame-Agent
build_exe.bat
```

Then distribute the new `OmniFrame_Agent.exe`. Once on v1.8.4, users can set `OMNIFRAME_DISABLE_REALTIME=1` in their environment (System → Environment Variables, or a launcher batch script) and restart the agent — the `[boot]   Realtime: DISABLED via OMNIFRAME_DISABLE_REALTIME=1` line confirms the agent is in polling-only mode.

## Open items / next session

- Once v1.8.4 is deployed across the fleet, monitor `/realtime/status` payload across agents to validate the exponential cooldown is correctly extending the time-between-retries when the tenant is degraded.
- Consider a frontend status pill in the SAP Testing tabs / Inventory Management Mission Control that consumes the extended `/realtime/status` payload and shows "Realtime: cooling down 27min — recommended: set OMNIFRAME_DISABLE_REALTIME=1" instead of the binary "agent connected" signal.
- Investigate root cause of the Presence GenServer crash on tenant `c9d89a74` from the customer-portal side — the agent fix reduces our contribution but doesn't fix the underlying Realtime workload.

## Related

- [[Debug/Fix-Realtime-CleanClose-Cycle]] — v1.8.0 clean-close tracker that v1.8.4 tightens.
- [[Debug/Fix-Realtime-Library-CrashLoop]] — v1.7.1 exception circuit breaker (runs in parallel).
- [[Patterns/Async-Library-Circuit-Breaker]] — the broader pattern.
- [[Components/Omni-Agent - Headless SAP Agent]] — component note.
- [[Sessions/2026-05-06]] — this session.
