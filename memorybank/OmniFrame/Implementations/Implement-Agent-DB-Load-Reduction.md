---
tags: [type/implementation, status/active, domain/backend, domain/database, domain/infra]
created: 2026-05-02
---
# Implement Agent + DB Load Reduction (v1.7.8)

## Purpose / Context

Tier 4 (agent) + Tier 2/5 (DB) fixes from the OmniFrame agent + Supabase
load investigation report. Production telemetry showed the
on-prem agent + the dashboard fleet card driving high steady-state
request volume against Supabase even when no SAP work was in flight:

- N agents heartbeating every 30s upserting `sap_agents` + bumping job
  leases + each calling `reap_stale_sap_agents()` RPC every tick — 4×
  agents = 16 writes/min on a quiescent fleet.
- The 60s trigger backfill poller running unconditionally even when
  Realtime was happily delivering events to `_on_rf_putaway_change`,
  producing ~60 redundant SELECTs/hour against
  `rf_putaway_operations` per agent.
- Several Realtime-published tables on `REPLICA IDENTITY FULL` so
  every UPDATE shipped both the OLD + NEW row over WebSocket, ~2×
  bandwidth for no current consumer benefit (only the v1.6.4 agent-
  side trigger evaluator on `rf_putaway_operations` reads the OLD
  image).
- Hot read paths (fleet probe, claim path, backfill query) without
  composite indexes that match their predicate + ORDER BY shape, so
  they scanned broader B-trees than necessary.

No handler logic was touched. No trigger semantics changed. The
v1.7.1 circuit breaker, v1.7.0 drain mode + watchdog, and v1.6.9
in-memory dedup cache all keep working unchanged.

Frontend fixes from the same report were implemented in parallel by a
different worker; this note is scoped to the agent + DB only.

## Details

### Agent (omni_agent/agent.py — v1.7.7 → v1.7.8)

**Fix A — Adaptive heartbeat throttling.**
`_start_heartbeat_thread` now resolves a per-tick cadence instead of a
fixed 30s sleep:

- Base 30s while a job is in flight (`state.active_job_id is not None`)
  so lease bumps via `_bump_current_job_lease()` stay snappy.
- Idle 60s when there's been no active job for >5min
  (`time.time() - state.last_job_completed_at > 300`).

New `state.last_job_completed_at: float` initialised to boot time on
`AgentState.__init__` and bumped in the job poller's `finally` block
after every dispatch (success or failure). Mode transitions log
`[heartbeat] Idle mode — cadence 60s. Active mode — 30s. Currently:
<mode>` once per change so ops can correlate console output with the
cadence shift; steady-state ticks stay quiet. Halves
`sap_agents.last_seen_at` UPDATE rate on a quiescent fleet without
affecting fleet-card freshness materially because the pg_cron-driven
`mark_stale_sap_agents_offline` reaper still runs every minute
server-side (migration 250) so a dead agent is still flipped to
`offline` within ~3min worst case.

**Fix B — Dropped per-tick `reap_stale_sap_agents()` RPC call.**
Removed from the heartbeat tick. The pg_cron job
`omniframe-reap-stale-sap-agents` (registered in migration 250) drives
the reaper server-side every minute, so each agent doing its own sweep
was N×2 RPCs/min for nothing. Function definition is unchanged — only
the agent stops calling it. Saves N RPCs/min and the `sap_agents`
UPDATE the function dispatches when a stale row is found.

**Fix C — Realtime-aware backfill poller.**
`_start_trigger_backfill_poller` now gates its periodic PostgREST
query on Realtime health:

```python
if not state.realtime_disabled and time.time() - state.last_realtime_event_at < 120:
    print("[backfill] skipping — Realtime is healthy and recently active")
    continue
```

New `state.last_realtime_event_at: float` initialised to 0.0 (cold
start = always poll once) and stamped at the top of
`_on_rf_putaway_change` so any Realtime callback resets the clock.
The scan still runs unconditionally when Realtime has been silent for
>2min OR `state.realtime_disabled` is True (v1.7.1 circuit breaker
tripped, polling-only fallback mode). The v1.6.9 missed-event
self-healing semantics are fully preserved — this only suppresses the
purely-redundant scan when the primary path is healthy.

**Fix D — Version bump + capabilities.**
- `AGENT_VERSION = "1.7.8"` with full banner.
- `src/features/admin/sap-testing/lib/agent-fetch.ts` →
  `LATEST_AGENT_VERSION = '1.7.8'`.
- New entries in `AGENT_CAPABILITIES`: `adaptive-heartbeat`,
  `realtime-aware-backfill` (purely informational; frontend doesn't
  gate on either).

### DB (supabase/migrations)

**Fix E — `254_index_hot_read_paths.sql`**: composite + partial indexes
for the SELECTs the agent + dashboard run most frequently. Idempotent
(`CREATE INDEX IF NOT EXISTS`):

- `idx_sap_agents_org_status_lastseen` — `(organization_id, status,
  last_seen_at DESC)` covers the fleet card's filter+sort shape.
- `idx_sap_agents_online` — partial on `status = 'online'` for the
  even hotter "currently online" subquery.
- `idx_sap_agent_jobs_claim_path` — partial on `status = 'queued'` for
  the FOR UPDATE SKIP LOCKED scan inside `claim_sap_agent_job`.
- `idx_rf_putaway_ops_backfill_target` — partial on
  `to_status = 'Completed' AND confirmed_at IS NULL` for the trigger
  backfill poller's query.

**Fix F — `255_optimize_replica_identity.sql`**: switches four tables
from `REPLICA IDENTITY FULL` → `DEFAULT` so Realtime UPDATE payloads
ship the PK only:

- `sap_agents` ← was FULL
- `sap_agent_jobs` ← was FULL
- `sap_agent_schedules` ← was FULL
- `sap_outbound_to_import_runs` ← was FULL

`rf_putaway_operations` intentionally STAYS `REPLICA IDENTITY FULL`
because the agent-side trigger evaluator (`_on_hardcoded_table_change`
+ `_hardcoded_trigger_match`) inspects the `record` field which
Supabase Realtime synthesizes from the OLD image when REPLICA IDENTITY
is FULL. Switching to DEFAULT here would silently strip the row
content from the trigger callback and the auto-confirm-TO trigger
would stop firing. Revisit in v1.8 once we audit consumers and migrate
the trigger evaluator to read the `new` row directly.

Both migrations applied via Supabase MCP `apply_migration`. Verified
post-apply:

```sql
SELECT relname,
       CASE relreplident
         WHEN 'd' THEN 'DEFAULT' WHEN 'n' THEN 'NOTHING'
         WHEN 'f' THEN 'FULL'    WHEN 'i' THEN 'INDEX'
       END AS replica_identity
  FROM pg_class
 WHERE relname IN ('sap_agents','sap_agent_jobs','sap_agent_schedules',
                   'sap_outbound_to_import_runs','rf_putaway_operations');
-- → rf_putaway_operations=FULL, all others=DEFAULT ✓
```

All four indexes confirmed present via `pg_indexes`.

## Files modified

- `omni_agent/agent.py` — `AgentState` (+2 fields), `_start_heartbeat_thread`
  (replaced; ~30 net LOC), `_on_rf_putaway_change` (+1 line stamp),
  job poller `finally` block (+3 LOC stamp), backfill poller loop
  (+9 LOC gate), `AGENT_CAPABILITIES` (+2 entries with comment),
  `AGENT_VERSION` banner. ~+100 LOC net (mostly comments).
- `src/features/admin/sap-testing/lib/agent-fetch.ts` — version bump
  + JSDoc block. ~+50 LOC of comments, 1 LOC of code.
- `supabase/migrations/254_index_hot_read_paths.sql` — **new**.
- `supabase/migrations/255_optimize_replica_identity.sql` — **new**.
- `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py` —
  copied from omni_agent/agent.py.

## Expected DB load reduction

- `sap_agents` UPDATEs from heartbeat: roughly halved on a quiescent
  fleet (~30s→60s during idle), plus N RPCs/min eliminated by
  removing the per-agent reaper sweep.
- Trigger backfill SELECTs against `rf_putaway_operations`: ~60/hour
  per agent → near-zero on the steady state where Realtime is
  delivering events. Cold-start, post-circuit-breaker-trip, and
  after-VDA-resume polls still run.
- Realtime UPDATE payload size on the four DEFAULT-now tables:
  roughly halved (NEW row only, no OLD pre-image).
- Fleet card / claim-path / backfill SELECTs: now satisfied by
  composite + partial indexes instead of broader index scans + filter
  predicates. Materially relevant once `sap_agent_jobs` history grows
  past tens of thousands of rows.

## Build + verify

- `python3 -c 'import ast; ast.parse(open("omni_agent/agent.py").read())'` ✓
- `npm run build` ✓ 9.62s
- Migrations 254 + 255 verified via `list_migrations` and direct
  `pg_class.relreplident` + `pg_indexes` queries.

## Rebuild command

```
cd /Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent
pip install -r requirements.txt  # only if dependencies changed (none did)
python -m PyInstaller --onefile --windowed --name OmniFrame_Agent agent.py
```

The resulting `dist/OmniFrame_Agent.exe` should report
`v1.7.8` on `/health` and advertise `adaptive-heartbeat` +
`realtime-aware-backfill` in `/health.capabilities`.

## Related

- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Patterns/Async-Library-Circuit-Breaker]]
- [[Patterns/Job-Queue-Drain-Mode]]
- [[Implementations/Job-Queue-Architecture]]
- [[Implementations/Implement-Multi-Agent-Coordination]]
- [[Debug/Fix-Audit-Closeout-v1.7.2]]
- [[Debug/Fix-Realtime-Library-CrashLoop]]
- [[Debug/Fix-Agent-Throughput-Latency]]
