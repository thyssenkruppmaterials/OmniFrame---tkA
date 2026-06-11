---
tags: [type/context, status/active, domain/backend, domain/frontend, domain/infra]
created: 2026-05-21
updated: 2026-05-21
aliases: [omni-agent topology, agent system map, agent integration map]
---
# Omni-Agent System Topology

Cross-cutting synthesis of the omni_agent / omni_bridge / rust-work-service / FastAPI / Supabase agent stack as of v2.0.0 (2026-05-21). Built from a five-worker parallel architectural sweep covering core agent, SAP integration, backend trigger DSL, frontend + DB schema, and deployment/operations.

## Purpose / Context
The user is preparing to improve `omni_agent` and asked for a complete picture of the integration before changes begin. This note is the unified mental model that links the deep-dive worker reports together, identifies the cross-cutting risks that span workers, and maps the improvement surface so future work can be scoped without re-deriving the topology.

## Unified architecture

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Citrix VDA / Windows desktop (operator session) │
│ │
│ ┌────────────────────────────────────┐ ┌────────────────────────────────────┐ │
│ │ OmniFrame_Agent.exe (primary) │ │ OmniFrame_SAP_Bridge.exe (fallback)│ │
│ │ • FastAPI on 127.0.0.1:8765 │ │ • pywebview WebView2 (no HTTP) │ │
│ │ • Job poller + watchdog (~120s) │ │ • js api SAPBridgeAPI.* │ │
│ │ • Heartbeat sap_agents (~30/60s) │ │ • One Click Ship + LT12 only │ │
│ │ • SAP COM (win32com) │ │ • SAP COM (win32com) │ │
│ │ • work_service WS client │ │ • Stale: posts to sap_transaction_ │ │
│ │ • optional console relay → WS │ │ logs (retired in favor of audit) │ │
│ └──────────┬─────────────────────────┘ └────────┬───────────────────────────┘ │
│ │ COM (already-logged-in SAP GUI session, scripting enabled) │ │
│ └────────────────┬─────────────────────────────┘ │
│ ▼ │
│ ┌──────────────────────────────────────┐ │
│ │ SAP GUI (interactive logon — no RFC) │ │
│ └──────────────────────────────────────┘ │
└─────────────────────────────────┬────────────────────────────────────────────────────────┘
 │ HTTPS (browser tab on same VDA)
 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Browser SPA (OmniFrame) │
│ │
│ • Trigger CRUD + DSL preview → rust-work-service /api/v1/triggers (NOT FastAPI) │
│ • Recent fires/jobs/fleet/console → workServiceWs /ws (singleton) │
│ • Job submit (Inventory tab) → direct Supabase PostgREST INSERT (legacy `as any`) │
│ • Local agent probe → http://127.0.0.1:8765/health|/metrics (X-Agent-Token) │
│ • Phase 9 removed `useAgentTriggerRuntime` — browser is pure CRUD + observability now │
└────────┬────────────────┬───────────────────────────────────────────┬─────────────────────┘
 │ │ │
 ▼ ▼ ▼
┌────────────────────────┐ ┌──────────────────────────┐ ┌──────────────────────────┐
│ FastAPI (Railway) │ │ rust-work-service (Rly) │ │ Supabase (Postgres+Auth) │
│ /api/sap/* (RFC) │ │ /api/v1/triggers │ │ • agent_triggers │
│ • pyrfc (NW SDK) │ │ /api/v1/sap-agents/* │ │ • sap_agent_jobs │
│ • admin/RF MIGO only │ │ /api/v1/sap-mutations/* │ │ • sap_agents │
│ • NOT on agent path │ │ /ws (WS fan-out) │ │ • rf_putaway_operations │
│ • rust-core JWT validn│ │ /api/v1/agent-identity │ │ • agent_service_keys │
│ │ │ (service-key exchange) │ │ • storage downloads/ │
└────────────────────────┘ └──────┬───────────────────┘ └──────────┬───────────────┘
 │ ▲
 │ NOTIFY / LISTEN / RPC │ Realtime (legacy fallback)
 ▼ │
 ┌──────────────────────────┐ │
 │ trigger evaluator │◄────────┘
 │ (PgListener, DSL match, │
 │ INSERT sap_agent_jobs, │
 │ broadcast TriggerFired) │
 └──────────────────────────┘
```

## Today's reality in 10 facts
1. **Three SAP automation paths exist; only two run in production.** `omni_agent` (Citrix COM, primary), `omni_bridge` (Citrix COM, fallback exe), and FastAPI `api/routers/sap.py` (Railway pyrfc, **admin testing + RF MIGO only — not on the agent or trigger path**).
2. **Control plane fully migrated to rust-work-service in v2.0.0.** Agent claims/completes/fails/heartbeats jobs through REST; subscribes to `/ws` for `SapJobStatusChanged` + `RfPutawayChanged`. Phase 11 deleted the legacy direct-PostgREST claim path.
3. **Trigger evaluation is fully server-side (Phase 9).** Browser `useAgentTriggerRuntime` is deleted (0 files). `rust-work-service::triggers::evaluator` listens on `pg_notify` per allowlisted source table, matches DSL against `row_to_jsonb(NEW)`, INSERTs `sap_agent_jobs` with `idempotency_key = trig:{rule}:{row}:{day}` and broadcasts `TriggerFired`.
4. **VBS scripts in `omni_bridge/sap_scripts/` are reference recordings, not runtime code.** Python COM is the source of truth. Several near-duplicates (`FullTest` vs `FullTestAAAA2` vs `Finaltesting`; `LX03Script` superseded by `LT10xScript`); root-level `.vbs` copies are dead duplicates of `sap_scripts/` entries.
5. **`agent.py` is a ~13.5k LOC monolith** holding handlers, parsers, recording, metrics, legacy Realtime, job queue, and auth. Highest change-risk file in the repo.
6. **Three credential types reach the agent.** Supabase user JWT (browser login), per-machine `agent_token` (localhost API), and Phase 10 `agent_service_key` (`omni_sk_*` exchanged for 15-min agent JWT at rust-work-service). The "split-brain" between work-service JWT and user-JWT-dependent Supabase PATCHes caused the 2026-05-20 stuck-confirms incident; mitigated by server-side post-success patcher (migration 322).
7. **Distribution is manual.** Build on Parallels via `build_exe.bat` → upload `OmniFrame_Agent.zip` to Supabase Storage `downloads/` → operators download per Citrix session. No code signing, no auto-update, no MSI. Stale `install_self_if_needed()` exists but is never called.
8. **Agent execution model is single-thread COM.** Job poller runs on one thread; watchdog (`OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS`, default 120s) frees the DB row but cannot unstick the underlying SAP GUI session. Throughput cap = single SAP session sequentially.
9. **Schema drift surface.** `rf_putaway_operations` base CREATE TABLE is in the live DB (migration `20250827125935`) but absent from local `supabase/migrations/` files. `agent_triggers` is missing from `database.types.ts` (frontend uses Rust-side TS interfaces). Several `as any` Supabase casts in `useJobQueue` and `useAgentDetection`.
10. **Two coexisting observability paths for the same source tables.** `rf_putaway_operations` is in the `supabase_realtime` publication for the operator putaway log AND emits `pg_notify('rf_putaway_operation_changed')` consumed by rust-work-service for trigger eval and WS fan-out. `sap_agent_jobs` was removed from `supabase_realtime` (migration 287); UI uses `SapJobStatusChanged` only.

## Cross-cutting themes (where the worker reports converge)

### A. Auth fragmentation
- Browser → rust-work-service: Supabase user JWT.
- Browser → local agent: `X-Agent-Token` only.
- Agent → rust-work-service: agent JWT (preferred) OR user JWT (legacy fallback).
- Agent → Supabase: still uses `state.supabase_token` (user JWT) for some patches and `sap_agents` upserts; this is the surviving direct-Supabase surface in v2.0.0.
- FastAPI → SAP RFC: env-based SAP creds in `sap_service.py` defaults (`SAP_DEFAULT_USER=STUDENT119`, hardcoded host/router as fallbacks).

### B. Two delivery mechanisms per critical event
| Event | Path 1 | Path 2 |
|---|---|---|
| Job status change | rust-work-service `SapJobStatusChanged` WS | Agent Supabase Realtime fallback (`OMNIFRAME_AGENT_USE_RUST_WS=0`, deprecated, scheduled removal v2.1.0) |
| RF putaway change | rust-work-service `RfPutawayChanged` WS (agent only) | `supabase_realtime` (browser putaway log) |
| Trigger fire | server-side evaluator → DB INSERT + WS | (none — browser runtime deleted in Phase 9) |
| Stuck confirms | NOTIFY-driven evaluator | `backfill_pending_putaway_confirms()` pg_cron + admin REST |

### C. Job-queue contracts are implicit
`endpoint` strings (`/sap/confirm-to`, `/sap/process-shipment`, etc.) are the only contract between evaluator INSERT, browser direct INSERT, scheduled jobs, and agent dispatch. Validation lives in `agent.py::_JOB_ENDPOINT_MODELS` and `triggers/config.rs` allowlist — there is no shared typed schema.

### D. Idempotency is multi-actor
- Trigger jobs: `trig:{rule_id}:{row_id}:{day}` (server, ON CONFLICT DO NOTHING).
- LT22 batch INSERT: `Prefer: resolution=ignore-duplicates` (agent).
- Job complete/fail: `status='running' AND claimed_by=self` guard (rust-work-service).
- Cross-path (browser INSERT vs evaluator INSERT) idempotency keys differ — duplicate work for the same business action is structurally possible.

### E. Feature drift between agent and bridge
| Capability | Agent | Bridge |
|---|---|---|
| Process shipment | yes (`Finaltesting.vbs` lineage) | yes (`FullTestAAAA2.vbs` lineage — different VT01N navigation) |
| LT12 confirm-TO + two-step variant | yes (idempotent + already-confirmed handling) | yes (no two-step, no idempotency) |
| LT01 / LS01N / LS02N / MM02 / LT22 / LT10 / ZMM60 / LX25 | yes | no |
| Job queue / WS | yes | no (no IPC to omni_agent) |
| Audit log | `sap_audit_log` (current) | `sap_transaction_logs` (retired table) |

## Improvement surface map

| Surface | Files / area | Risk of change | Likely improvement axes |
|---|---|---|---|
| Agent core monolith | `omni_agent/agent.py` (~13.5k LOC) | **High** — many threads, COM, FastAPI handlers, parsers all here | Split feature handlers into modules (model exists in `lt22_import.py`/`zmm60_lookup.py`); extract recording subsystem; trim legacy Realtime path |
| Single-thread COM | `agent.py` job poller + watchdog | High | Per-endpoint timeout overrides; SAP-session kill on watchdog; explore second SAP session for read-only queries |
| Auth split-brain | `agent.py` token plumbing + work_service_jwt thread | Med | Drive all server writes through agent JWT; remove user-JWT dependency for `sap_agents` heartbeat and `rf_putaway` patches; complete migration 322 rollout |
| Distribution & versioning | `omni_agent/build_exe.bat`, Supabase Storage `downloads/`, no signing/auto-update | Med (high if `omni_agent_v2` becomes mandatory) | Code-signing pipeline; signed manifest at `updates.omniframe.app`; `omni_agent_v2` Tauri/MSI cutover |
| VBS / bridge cleanup | `omni_bridge/**`, `sap_scripts/**` | Low | Delete dead duplicates (root-level `.vbs`, `LX03Script.vbs`, likely `FullTest.vbs`); document canonical `.vbs` per Python handler; decide whether to retire bridge entirely |
| Schema typing | `database.types.ts`, `as any` in `useJobQueue` / `useAgentDetection` | Low–Med | Regenerate types incl. `agent_triggers`; restore base `rf_putaway_operations` migration to repo |
| Trigger DSL UX | `agent-triggers-tab.tsx`, `CreateOrEditDialog` | Low | Visual DSL builder (deferred to Phase 11); fire→job→outcome trace UI; in-tab WS connection indicator |
| Observability | Console relay only, no Datadog/Sentry, no log files | Low | Structured file logging on `%LOCALAPPDATA%`; backfill `/api/v1/sap-console/lines?since=`; per-fleet Prometheus dashboards |
| Test coverage | `omni_agent/tests/` covers parsers only | Low | Unit-test `_dispatch_job`, claim/complete/fail terminal guards, `WorkServiceWsClient` reconnect; delete stale `test_builtin_pick_completed.py` |

## Decision points before improvements begin
1. **`omni_agent` v1 patch path or `omni_agent_v2` cutover?** v2 (Tauri/MSI/signed manifest in `omni_agent_v2/`) is in the repo but not deployed. Big improvements may belong in v2.
2. **Retire `omni_bridge`?** Agent supersedes it functionally; keeping bridge alive duplicates SAP code paths and blocks consolidation.
3. **Hard-require agent service keys?** Setting `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1` on new installs would let us remove the user-JWT-dependent agent paths.
4. **Per-endpoint watchdog timeouts vs global default?** LT22 / shipment chains can legitimately exceed 120s.
5. **One canonical shipment recording.** Agent (`Finaltesting.vbs`) and bridge (`FullTestAAAA2.vbs`) currently disagree on VT01N navigation.
6. **Browser-side direct Supabase INSERTs** (`useJobQueue.submit`) vs routing through rust-work-service (matches the Phase-5 `sap_mutations` pattern).
7. **Generic job replay UX.** Today only the putaway-specific `backfill_pending_putaway_confirms` exists; generic admin replay is a frequent ask.

## Capabilities currently advertised vs implemented
From `agent.py::AGENT_CAPABILITIES`:
- `agent-2.0-architecture` ✓ implemented
- `agent-side-triggers` — **misleading** since Phase 9; evaluation is server-side; capability remains for version signaling
- `scheduled-jobs` — capability advertised but no schedule consumer found in `omni_agent` scope (Worker A); Scheduled Jobs tab inserts directly via UI/cron
- `zmm60-price-lookup`, `lx25-inventory-completion`, `import-lt22-bulk` ✓ implemented
- `agent-side-rf-confirm-events` — present; FE uses these to gate features

## Open questions (highest-leverage to answer first)
- Production fleet size today (vault cites `USINDPR-CXA103V`, `CXA105V` but no authoritative count).
- Is FSLogix/UPM persisting `%APPDATA%\OmniFrameAgent` and `%USERPROFILE%\.omniframe` across logoffs?
- Are deployed agents actually on v2.0.0 with rust paths enabled, or is there v1.x drift?
- Phase 10 service-key rollout state: how many agents have keys vs are still on user JWT?
- Is `Z_RFC_WM_TO_CONFIRM` deployed in target SAP systems? (FastAPI RFC TO confirm path is unused — intentional or because the FM is missing?)
- Is the NW RFC SDK actually present in the deployed Railway container (logs show `pyrfc not installed`)?

## Related
- [[Omni-Agent - Headless SAP Agent]]
- [[ADR-Trigger-DSL-Evaluator-Phase9]]
- [[ADR-Agent-2.0.0-Release]]
- [[ADR-Presence-Architecture-Next-Steps]]
- [[Roadmap-Rust-WS-Unlocks]]
- [[Implement-Phase10-Service-Key-First-Rollout]]
- [[Fix-Agent-Distribution-Issues]]
- [[Fix-Agent-Throughput-Latency]]
- [[Fix-Realtime-Library-CrashLoop]]
- [[Database-Schema-Overview]]
- [[Migration-History]]
