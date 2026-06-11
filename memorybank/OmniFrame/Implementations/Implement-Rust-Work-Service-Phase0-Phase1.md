---
tags: [type/implementation, status/active, domain/infra, domain/realtime, domain/agent]
created: 2026-05-06
---

# Implement Rust Work Service Integration — Phase 0 + Phase 1

Phases 0 (pre-flight diagnostics) and 1 (free wins + presence flip) of the comprehensive [[plans/rust_work_service_full_integration_5b88165d.plan]]. Implements Opportunities 9 + Quick wins 6, 7. Establishes the production baseline for telemetry deltas in Phase 2.

## Phase 0 — Pre-flight diagnostics (read-only baseline)

### rust-work-service production health

Confirmed `https://rust-work-service-production.up.railway.app/` is the correct production URL per user direction (the `.env.local` `VITE_RUST_CORE_URL=https://rust-core-service-production.up.railway.app` is the SEPARATE core service):

```
$ curl -sS -m 10 https://rust-work-service-production.up.railway.app/health
{"status":"healthy","version":"0.1.31","service":"rust-work-service"}    HTTP 200

$ curl -sS -m 10 https://rust-work-service-production.up.railway.app/metrics
HTTP 200, 955 bytes
```

### Production /metrics baseline (2026-05-06 ~22:50 UTC)

Saved to `/tmp/work_metrics_full.txt` during the audit. Highlights:

```
work_entity_focus_total{op="track"} 1
work_entity_focus_total{op="untrack"} 1
work_notifications_total{op="enqueue"} 1
work_websocket_subscribers{org_hash="c997",task_type="all"} 0
work_websocket_subscribers{org_hash="unbound",task_type="all"} 0
```

`work_ws_lagged_events_total` was NOT visible in the first 80 lines of /metrics output, meaning the counter is at 0 (no lagged events have ever fired in production) OR the metric is registered but only emitted after the first lag event. Either way: **baseline is clean — zero current saturation pressure**. Resolves Open Question Q6.

`work_websocket_subscribers` = 0 because the agent (the only known WS consumer at this time) was stopped by the user during the earlier app-load outage triage.

### Database state

```sql
-- agent_triggers table
SELECT to_regclass('public.agent_triggers')::text;
-- → null (table does NOT exist; Phase 9 will create via migration 277)

-- supabase_realtime publication
SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime';
-- → 24 tables: drone_scans, inbound_cart_assignments, inbound_stow_carts,
--   rf_putaway_operations, rr_cyclecount_data, rr_drop_off_*, rr_hot_part_alerts,
--   rr_inbound_part_transfers, sap_agent_jobs, sap_agent_schedules, sap_agents,
--   sap_outbound_to_import_runs, shift_assignments, task_artifacts,
--   warehouse_aisle_*, warehouse_asset_position_latest, warehouse_assets,
--   warehouse_auto_map_runs, warehouse_location_*, work_events, work_tasks

-- replica identity for tables on the migration list
SELECT relname, CASE relreplident WHEN 'd' THEN 'DEFAULT' WHEN 'f' THEN 'FULL'
  WHEN 'i' THEN 'INDEX' WHEN 'n' THEN 'NOTHING' END
FROM pg_class WHERE relname IN ('rf_putaway_operations','sap_agents',
  'sap_agent_jobs','sap_agent_schedules','sap_outbound_to_import_runs',
  'rr_lx03_data','rr_cyclecount_data','work_tasks');
-- → rf_putaway_operations    FULL    (kept FULL intentionally; flipped to DEFAULT in Phase 11)
--   sap_agents               DEFAULT (migration 255)
--   sap_agent_jobs           DEFAULT (migration 255)
--   sap_agent_schedules      DEFAULT (migration 255)
--   sap_outbound_to_import_runs  DEFAULT (migration 255)
--   rr_lx03_data             DEFAULT
--   rr_cyclecount_data       FULL    (migration 257; revisit Phase 11)
--   work_tasks               FULL    (migration 257; revisit Phase 11)
```

Resolves Open Question Q4: `rf_putaway_operations` is currently `REPLICA IDENTITY FULL` per [255_optimize_replica_identity.sql](../../../supabase/migrations/255_optimize_replica_identity.sql) (specifically because v1.6.4 Realtime needed OLD image). The agent's `_on_rf_putaway_change` evaluator at [omni_agent/agent.py](../../../omni_agent/agent.py) line 5591 only inspects fields present in `NEW` (`to_status`, `is_mca_workflow`, `confirmed_source`, `to_number`, `warehouse`). **Phase 4 NOTIFY trigger ships `row_to_jsonb(NEW)` only**; Phase 11 then flips the table to `DEFAULT`.

### Agent inventory — Supabase Realtime channels still active

`grep -n` on [omni_agent/agent.py](../../../omni_agent/agent.py) v1.8.4:

- Line 116: `AGENT_VERSION = "1.8.4"` plus the long banner documenting v1.7.1 → v1.8.4 Realtime work that Phase 4 is going to retire.
- Line 1992 / 2906 / 2996: `_start_realtime_subscription()` re-arm sites (login, session restore, post-config reload).
- Line 4406: the main `_start_realtime_subscription` definition — the entry point that opens 3 channels (`sap_agent_jobs`, `rf_putaway_operations`, `work_tasks` — `shipment_queue` was removed in v1.8.1 because the table doesn't exist).
- Line 4387: `from realtime import AsyncRealtimeClient` import.
- Line 4686 / 4692: `AsyncRealtimeClient(url, token=...)` constructions (with and without `hb_interval=10` kwarg per v1.8.0 fallback).
- Line 5014: doc reference to channel #2 (rf_putaway_operations).
- Line 5031 onwards: `_HARDCODED_TRIGGERS` definition — Phase 9 deletes this.
- Line 5591: `_on_rf_putaway_change` Realtime callback — Phase 4 replaces with WS event handler.
- Line 6246: `_start_realtime_subscription()` post-startup activation.

These are the call sites Phase 4 retires. Net deletion target ~400 LOC after the new WS client is in place and parallel-run telemetry confirms parity.

### Outstanding operational state

- 0 sap_agents currently online (user stopped the agent during earlier outage triage)
- Agent v1.8.4 is the latest deployed build (per Supabase Storage upload at `2026-05-06 22:50:39 GMT`)

## Phase 1 — Free wins + presence flip

### 1.1 `VITE_PRESENCE_MODE=rust` (Opportunity 9 — the FREE fix)

**Action required by the user, not in code:** set `VITE_PRESENCE_MODE=rust` in the Railway production env vars for the `onebox-ai-logistics` service. This is the cure for the Customer Portal Presence GenServer overload that triggered the agent v1.7.1→v1.8.4 storm — the implementation has been live since [c2e4ed3](../Sessions/2026-05-06.md) (server-side presence on rust-work-service); only the env var has not been flipped to consume it.

[.env.example](../../../.env.example) updated with prominent recommendation language under the existing `VITE_PRESENCE_MODE=rust` block:

```
# v1.8.5 (Phase 1 of rust-work-service integration plan, 2026-05-06):
# RECOMMENDED SETTING IN RAILWAY PRODUCTION ENV: 'rust' — the Customer
# Portal Presence GenServer overload that triggered the agent v1.7.1→v1.8.4
# storm is fixed by routing presence through rust-work-service. Cure has
# shipped (commit c2e4ed3); enable in production by setting:
#   VITE_PRESENCE_MODE=rust
# in the Railway service env vars (NOT this file).
```

After flipping, monitor `work_presence_active_users{org_hash}` via the rust-work-service `/metrics` endpoint for 24h. Customer Portal Presence GenServer crashes should drop to zero.

### 1.2 Document the rust-work-service production URL (Quick win 3)

[.env.example](../../../.env.example) updated with comment block above `VITE_WORK_SERVICE_URL`:

```
# rust-work-service (Axum + Tokio + sqlx + bb8-redis). Owns the work queue,
# org-scoped pub/sub WebSocket bus, presence, entity-focus, notifications.
# Production deploy lives at https://rust-work-service-production.up.railway.app
# (separate Railway service from rust-core-service; they're coupled — work-service
# delegates JWT validation to core-service via POST {core}/api/v1/auth/validate-with-profile).
# For local dev override to localhost:8030 below.
```

Also added commented production values (`https://...up.railway.app` / `wss://...up.railway.app/ws`) so future engineers see the production form alongside the localhost defaults.

### 1.3 Delete dead device-manager subscriptions (Quick win 6)

[src/lib/supabase/device-manager.service.ts](../../../src/lib/supabase/device-manager.service.ts) — removed three static methods that had no live consumers:

- `subscribeToDeviceChanges` (was at line 379) — `mdm-devices-changes` channel, unfiltered postgres_changes on `mdm_devices`
- `subscribeToCommandChanges` (was at line 390) — `mdm-commands-changes` channel, unfiltered postgres_changes on `mdm_commands`
- `subscribeToLocationChanges` (was at line 401) — `mdm-locations-changes` channel, unfiltered INSERT-only postgres_changes on `mdm_device_locations`

Verified non-existence of consumers by grep before deletion: zero matches in `src/`. The methods would have leaked cross-tenant events if ever wired up because they had no `organization_id=eq.X` filter — the `realtime-policy workspace rule` rule that landed 2026-05-06 forbids that exact shape, so the dead code couldn't have been adopted as-is anyway.

Replaced the deleted block with a comment block citing the removal date and the rationale, plus a backlink to [[Migrate-Tier1-Deferred-Channels-To-Rust-WS]] which had flagged this dead code for cleanup.

### 1.4 `OMNIFRAME_AGENT_USE_RUST_WS=0` env-var stub (Quick win 7)

[omni_agent/agent.py](../../../omni_agent/agent.py) — new module-level constant `_USE_RUST_WS` after the existing `_SSL_VERIFY` block:

```python
_USE_RUST_WS: bool = os.environ.get("OMNIFRAME_AGENT_USE_RUST_WS", "0") == "1"
if _USE_RUST_WS:
    print("[boot] OMNIFRAME_AGENT_USE_RUST_WS=1 detected — Phase 4 client not yet wired in this build (v1.8.4); flag has no effect. Will activate when Phase 4 of the rust-work-service integration plan ships (target v1.9.0).")
```

NO-OP today — the flag is read at module load and the boot print fires if set, but the agent's `_start_realtime_subscription` is still the only event path. Phase 4 ships:

1. New `omni_agent/work_service_ws.py` (the actual WS client mirroring `rust-work-service /ws` semantics).
2. Branching in `_on_startup` / `_start_realtime_subscription` to consult `_USE_RUST_WS` and choose between the two paths.
3. Parallel-run telemetry comparing event delivery rates.
4. Default flip to `1` after the telemetry window.

NO `AGENT_VERSION` bump in this Phase — the flag is purely scaffold. Phase 4 will bump to `1.9.0` when the new client is wired.

## Phase 0 + Phase 1 quality gates

- `/health` 200 OK on production rust-work-service ✓
- `/metrics` 200 OK on production rust-work-service ✓
- `agent_triggers` table absence confirmed (Phase 9 dependency) ✓
- pg_publication_tables snapshot captured ✓
- REPLICA IDENTITY state captured per table ✓
- agent.py Realtime channel inventory captured ✓
- Three dead device-manager subscription methods deleted ✓
- `OMNIFRAME_AGENT_USE_RUST_WS=0` stub added to agent.py ✓
- `.env.example` documents production rust-work-service URL ✓
- `.env.example` documents `VITE_PRESENCE_MODE=rust` recommendation ✓

`pnpm tsc -b` and `pnpm build` not run yet — Phase 1 changes are limited to a deletion (no API-shape change since methods had zero consumers) and an env-var read in Python. Will be exercised during Phase 2 (the next Rust + TS code path that ships).

## Open question status

| Q | Status | Resolution |
|---|---|---|
| Q1 | RESOLVED | URL: `https://rust-work-service-production.up.railway.app/` per user. Documented in [.env.example](../../../.env.example). |
| Q2 | DEFERRED | Phase 2 ships the foundation; SLO ADR drafted after first 2 weeks of metrics. |
| Q3 | RESOLVED | Opportunity 8 (Phase 10) is in scope per user — JWT path is interim for Phase 4. |
| Q4 | RESOLVED | rf_putaway_operations is REPLICA IDENTITY FULL today; agent uses NEW only; tighten contract in Phase 4 trigger; flip table to DEFAULT in Phase 11. |
| Q5 | RESOLVED | Single-org agents per user. |
| Q6 | RESOLVED | `work_ws_lagged_events_total` baseline = 0 (not visible in /metrics output → counter at 0). |
| Q7 | DEFERRED | Phase 11 task. |
| Q8 | RESOLVED | `WORK_WS_REQUIRE_TOKEN` defaults to `false`. Plan: flip to `true` in Phase 4 step 4.6 after FE token issuance proven. |

## Related

- [[plans/rust_work_service_full_integration_5b88165d.plan]] — the comprehensive plan
- [[Roadmap-Rust-WS-Unlocks]] — the seed planning doc
- [[Implement-Presence-On-Rust-Option-2]] — the v1.8 Tier 2 work that Phase 1 turns on in production
- [[Migrate-Tier1-Deferred-Channels-To-Rust-WS]] — the Tier 1 channel migration that Phase 4 mirrors for the agent
- [[Components/Omni-Agent - Headless SAP Agent]] — agent component note
