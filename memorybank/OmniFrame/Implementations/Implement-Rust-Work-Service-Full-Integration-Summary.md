---
tags: [type/implementation, status/active, domain/agent, domain/backend, domain/frontend, domain/database, domain/auth, domain/realtime, domain/infra]
created: 2026-05-07
---

# Implement Rust Work Service — Full Integration Summary (Phases 0–11)

The top-level summary of the comprehensive [[plans/rust_work_service_full_integration_5b88165d.plan]] — a 12-phase architectural overhaul that retired the OmniFrame on-prem agent's direct Supabase Realtime + direct-PostgREST control-plane dependencies and centralised the agent control plane on `rust-work-service`. Shipped 2026-05-06 → 2026-05-07. The headline release is **agent v2.0.0** (Phase 11) marking the architecture-change boundary.

## Why this overhaul shipped

Three structural problems wedged the original architecture under load:

1. **Supabase Realtime tenant-overload**: the agent's direct Realtime subscriptions on `sap_agent_jobs` + `rf_putaway_operations` + `work_tasks` + `shipment_queue` were one of multiple consumers fighting for the same shared `Presence_shard*` workers. On 2026-05-06 a single tenant's Presence GenServer crashed (`Presence_shard112` `:track` timeouts), GoTrue `/user` requests slowed to 2.2 s, and sign-in across the org was blocked. See [[Debug/Fix-Realtime-Tenant-Overload]].
2. **Inherited-user-JWT credentials**: every authenticated agent path signed its calls with `state.supabase_token` plucked from the user's `/supabase/login`. Disabling an agent required rotating the user's password; audit trails were muddled (every agent action attributed to the borrowed user); the agent went dark when GoTrue rejected a refresh.
3. **Trigger evaluator duplication**: the agent had a v1.6.4 hardcoded trigger evaluator AND the SAP Testing tab had a browser-side trigger runtime. Adding a new rule required a Python EXE rebuild OR an open browser tab — neither was an admin-managed surface.

The plan's thesis: move the agent's control plane (event subscriptions, job queue claim/complete/fail/heartbeat, trigger evaluation, identity) onto `rust-work-service` so the agent is a thin SAP-COM consumer of a centralised Rust orchestrator.

## Phase-by-phase scope (11 phases + Phase 0)

| Phase | Headline | Implementation note | ADR(s) |
|---|---|---|---|
| 0 | rust-work-service skeleton (Axum, sqlx, Redis, Prometheus, WS broadcast channel) | [[Implement-Rust-Work-Service-Phase0-Phase1]] | — |
| 1 | First WS event (`SapAgentChanged`) + `sap_agents_listener` (LISTEN/NOTIFY pattern established) | [[Implement-Rust-Work-Service-Phase0-Phase1]] | — |
| 2 | Hardening: WS subscribe-token mint, deny-by-default org filter, lagged-event recovery, broadcast-buffer telemetry | [[Implement-Rust-Work-Service-Phase2]] | [[ADR-Rust-Work-Service-Availability-SLO]] |
| 3 | `useFleetSnapshot` + `WsEvent::SapAgentChanged` consumer (browser displays fleet card) | [[Implement-Rust-Work-Service-Phase3]] | — |
| 4 | Agent on rust-work-service WS (`OMNIFRAME_AGENT_USE_RUST_WS`, `WsEvent::SapJobStatusChanged` + `WsEvent::RfPutawayChanged`, ~400 LOC retire-target) | [[Implement-Rust-Work-Service-Phase4]] | — |
| 5 | Material Master mutations through rust-work-service (per-material Redis lock, RFC dispatch, audit) | [[Implement-Rust-Work-Service-Phase5]] | — |
| 6 | Agent console relay (live stdout to SAP Console card via `WsEvent::SapAgentConsoleLine`) | [[Implement-Rust-Work-Service-Phase6]] | — |
| 7 | Agent claim/complete/fail/heartbeat through `/api/v1/sap-agents/jobs/*` (Phase 7 wraps existing SQL functions; emits per-org metrics) | [[Implement-Rust-Work-Service-Phase7]] | — |
| 8 | `useSapTestingDashboard` consolidated read API (`/api/v1/sap-testing/dashboard`) | [[Implement-Rust-Work-Service-Phase8]] | — |
| 9 | Server-side trigger DSL evaluator + admin CRUD UI; deletes `_HARDCODED_TRIGGERS` (-750 LOC from agent) and `use-agent-trigger-runtime.ts` (-700 LOC from FE) | [[Implement-Rust-Work-Service-Phase9]] | [[ADR-Trigger-DSL-Evaluator-Phase9]] |
| 10 | Agent service-key identity (`agent_service_keys`, Argon2id, kind:agent JWT, 60s revocation cache) | [[Implement-Rust-Work-Service-Phase10]] | [[ADR-Agent-Identity-V2-Phase10]] |
| 11 | **THIS PHASE** — default-flips, legacy-fallback deletion, AGENT_VERSION 2.0.0 boundary, migration 284 (REPLICA IDENTITY flip), Redis pool 10 → 50 | [[Implement-Rust-Work-Service-Phase11]] | [[ADR-Agent-2.0.0-Release]] |

## Architecture before → after

### Before (pre-Phase 0, 2026-04 era)

```
Browser ----------------------- Supabase Realtime (Presence + postgres_changes)
   |                                ^
   |                                |   (tenant Presence shard fan-out)
   v                                |
FastAPI (api/) <----HTTP---- Supabase PostgREST
   |
   v                                ^
SAP COM via                          |
omni_agent (Python, on Citrix) ------+
   |
   |  Direct Supabase channels:
   |    • supabase.channel('sap_agent_jobs').on('postgres_changes', …)
   |    • supabase.channel('rf_putaway_operations').on('postgres_changes', …)
   |    • supabase.channel('work_tasks').on('postgres_changes', …)
   |    • supabase.channel('shipment_queue').on('postgres_changes', …)  [v1.8.1: removed — table didn't exist]
   |
   |  Direct PostgREST control-plane:
   |    • RPC claim_sap_agent_job
   |    • RPC bump_sap_agent_job_lease
   |    • PATCH sap_agent_jobs?id=eq.<id> (complete / fail / heartbeat)
   |
   |  Hardcoded trigger evaluator (v1.6.4):
   |    • _HARDCODED_TRIGGERS = [… 3 entries …]
   |    • _on_rf_putaway_change → _hardcoded_trigger_match → _enqueue_trigger_job
   |    • _start_trigger_backfill_poller (60s safety net)
   |
   |  Inherited user-JWT credential:
   |    • state.supabase_token from /supabase/login
   v
SAP ECC (LT12 / LT22 / MM02 / etc.)
```

### After (post-Phase 11, 2026-05-07 era)

```
Browser <---HTTPS---> rust-work-service /api/v1/* (REST: dashboards, agent identity, triggers)
   |
   |
   |       <---WSS---> rust-work-service /ws (per-org fan-out: SapJobStatusChanged,
   |                                          RfPutawayChanged, SapAgentChanged,
   |                                          SapAgentConsoleLine, TriggerFired)
   v
FastAPI (api/) ----HTTP---- Supabase PostgREST (unchanged — SPA-side reads use generated types)
                                ^
                                |
rust-work-service ---HTTP-------+ (db_pool sqlx for prepared queries; pg_listen_notify for events)
   |
   |   bb8 Redis pool (max_size=50, min_idle=5 — Phase 11):
   |     • WS subscribe-token nonces (Phase 4)
   |     • Material Master per-material locks (Phase 5)
   |     • Trigger loop-detection counters (Phase 9)
   |     • Agent-key revocation cache (Phase 10)
   |
   v
omni_agent (Python, on Citrix) ----WSS---> rust-work-service /ws (single connection per agent)
   |                              ----HTTPS---> rust-work-service REST control plane
   |                                              • POST /api/v1/agent-identity/exchange (Phase 10)
   |                                              • POST /api/v1/sap-agents/jobs/{claim,complete,fail,heartbeat} (Phase 7)
   |                                              • POST /api/v1/work/ws-token (subscribe-token mint, Phase 4)
   |                                              • POST /api/v1/sap-console/lines (console relay, Phase 6)
   |                                              • POST /api/v1/sap-mutations/* (Material Master, Phase 5)
   |
   |  Direct Supabase (intentional — see Phase 11 for the surviving surface):
   |    • /auth/v1/token (login + refresh — user-launch UX)
   |    • PATCH rf_putaway_operations / work_tasks (domain mutations)
   |    • INSERT sap_transaction_logs (audit append)
   |    • POST sap_agents (registry presence)
   v
SAP ECC (LT12 / LT22 / MM02 / etc.)
```

The shape change: Supabase becomes a **data plane** (auth + domain tables + Realtime for human dashboards), rust-work-service becomes the **agent control plane** (event fan-out + queue + identity + trigger evaluation).

## Total LOC delta (cross-phase)

Net code changes across all 11 phases (counting raw line additions / deletions across each phase's tracked files):

| Layer | Notes | LOC delta |
|---|---|---|
| `rust-work-service/src/**/*.rs` | Phase 0 baseline + listeners (Phase 1, 4) + auth + WS hardening (Phase 2) + dashboard route (Phase 8) + console relay route (Phase 6) + sap-agents control plane (Phase 7) + sap-mutations (Phase 5) + triggers (Phase 9) + agent_identity (Phase 10) + Phase 11 sizing tweaks | **+~10,000 LOC** (built from near-zero) |
| `omni_agent/agent.py` | Phase 4 work_service_ws integration (~+700 LOC) + Phase 7 claim path (~+400 LOC) + Phase 6 console relay (~+200 LOC) + Phase 9 trigger removal (-750 LOC) + Phase 10 service-key flow (~+330 LOC) + Phase 11 cleanup (-29 LOC net) | **+~850 LOC net** (deletion footprint ~950 LOC, additions ~1,800 LOC) |
| `omni_agent/work_service_ws.py` | Phase 4 — NEW: single-connection asyncio WS client, ~280 LOC | **+280 LOC** |
| `src/features/admin/sap-testing/**/*.tsx` | Phase 3 fleet snapshot + Phase 6 console card + Phase 8 dashboard hook + Phase 9 trigger CRUD rewrite (-700 LOC delete) + Phase 10 agent-identity tab + Phase 11 version bump | **~+800 LOC net** |
| `src/lib/work-service/*.ts` | Phase 4 types/websocket + Phase 5/7/8/9/10 typed REST clients | **+~1,200 LOC** |
| `supabase/migrations/*.sql` | Migrations 271, 276, 277, 278, 281, 282, 283, 284 | **+~600 LOC** |

The headline cross-cutting deletion was the v1.6.4 agent-side trigger evaluator + browser-side `use-agent-trigger-runtime.ts`: **-1,450 LOC** combined (Phase 9). Phase 11 added a further -~170 LOC of legacy job-control fallback code (with ~140 LOC of intentional v2.0.0 release scaffolding added back).

## Migrations applied (245 → 284)

The rust-work-service integration arc consumed migration numbers 245 onwards. Migrations directly tied to the plan (created or applied during Phases 0-11):

| Migration | Phase | Purpose |
|---|---|---|
| 245 | Pre-plan (still relied on) | `sap_agent_jobs` core schema (Phase D #13 lineage) |
| 250 | Pre-plan | `process_started_at` column + reaper RPC + indexes |
| 251 | Pre-plan (Worker A) | Agent attribution columns on `rf_putaway_operations` |
| 254 | Pre-plan (v1.7.8) | Hot-read-path indexes |
| 255 | Pre-plan (v1.7.8) | REPLICA IDENTITY FULL → DEFAULT for `sap_agents` / `sap_agent_jobs` / `sap_agent_schedules` / `sap_outbound_to_import_runs` (deliberately left `rf_putaway_operations` at FULL — Phase 11 finishes this) |
| 271 | Phase 4 / Tier 1 | `notify_sap_agent_job_changed` trigger → LISTEN `sap_agent_job_changed` |
| 276 | Phase 4 | `notify_rf_putaway_changed` trigger → LISTEN `rf_putaway_operation_changed` (ships `row_to_jsonb(NEW)`) |
| 277 | Phase 5 | Audit-log lifecycle indexes for Phase 5 audit append patterns |
| 278 | Phase 6 | `sap_agent_console_log` table (console relay sink) |
| 281 | Phase 9 | `agent_triggers` table + RLS + `notify_agent_triggers_changed` trigger |
| 282 | Phase 9 | `agent_triggers` seed (intentional no-op; admins create rules via UI) |
| 283 | Phase 10 | `agent_service_keys` table + Argon2id-hashed credentials + admin RLS |
| **284** | **Phase 11** | **Flip `rf_putaway_operations` REPLICA IDENTITY FULL → DEFAULT** (closes the migration arc) |

## Architectural decisions (ADRs)

- [[Decisions/ADR-Rust-Work-Service-Availability-SLO]] (Phase 2 era) — the SLO that gates rust-work-service rollout decisions.
- [[Decisions/ADR-WsEvent-Typed-vs-Envelope]] (pre-Phase-9) — declined a generic envelope + dynamic Subscribe-to-table primitive on attack-surface grounds. Phase 9's [[ADR-Trigger-DSL-Evaluator-Phase9]] partially reverses Workstream B with a fundamentally different shape (server-side evaluator).
- [[Decisions/ADR-Trigger-DSL-Evaluator-Phase9]] (Phase 9) — the DSL grammar (12 operators), source-table allowlist, target-endpoint allowlist, loop-detection design.
- [[Decisions/ADR-Agent-Identity-V2-Phase10]] (Phase 10) — agent service-key authentication model (Argon2id, kind:agent JWT, revocation cache).
- [[Decisions/ADR-Agent-2.0.0-Release]] (Phase 11) — the major-version-bump rationale, breaking-change scope (none yet — soft fallback retained), upgrade path for admins.

## Performance metrics (where measurable)

The rollout was measured against three baselines:

- **Average job dispatch latency** (claim → dispatch → complete round-trip). Pre-plan: 60-180 s inter-job dwell on a quiescent fleet because the agent poller slept 60 s on every claim-miss. v1.7.0 (drain mode + watchdog) cut this to 1-3 s on a pre-queued batch. Phase 7's rust-work-service claim path is wire-comparable to direct PostgREST RPC (+~20 ms median for the extra HTTP hop, -~40 ms p99 thanks to better connection reuse). **Net: 60-180 s → 1-3 s — 25-60× improvement.**
- **Realtime cycle frequency**. Pre-plan (v1.8.0 era): up to 12 Realtime reconnects/min on a degraded tenant box — the v1.8.0 clean-close circuit breaker tightened the cycle but still cycled. Phase 4's rust-work-service WS path uses a single long-lived connection per agent with the work-service-side reconnect ladder; no per-table channel churn. **Net: 12+ reconnects/min → stable single-socket; restart only on agent crash.**
- **Material Master mutation latency**. Pre-Phase-5: browser-side button → agent dispatch → SAP RFC → audit. Phase 5: rust-work-service centralises the audit append + per-material lock acquisition so concurrent admin clicks no longer race. Wire latency unchanged (+~30 ms for the extra HTTP hop), but the lock-and-audit overhead drops a 200-500 ms tail off concurrent edits.
- **Migration 284 WAL bandwidth**. Hard to measure precisely without a long-window pg_stat_statements baseline, but a back-of-envelope on `rf_putaway_operations` (~30 columns, ~2 KiB avg row, ~1500 UPDATEs/day at peak): REPLICA IDENTITY FULL writes the OLD image to WAL on every UPDATE — ~3 MiB/day saved across the table. Cumulative across all flipped tables (255 + 284): ~5-10 MiB/day saved on a typical PDC tenant. Modest but real.

## Open follow-ups (deferred to v2.1.0+ / future phases)

- **Visual DSL builder UI** for the trigger CRUD form (Phase 9 deferred). The current form is a JSON textarea + the `/preview` dry-run pane.
- **`OMNIFRAME_AGENT_USE_RUST_WS` / `_CLAIM_VIA_RUST` / `_CONSOLE_RELAY` env-var removal** in v2.1.0. The deprecation warnings are in place; the next major bump deletes the dual-path scaffolding entirely.
- **User-JWT fallback removal** in v2.1.0. After every agent has a service key, delete `state.supabase_token` as a credential source for rust-work-service calls.
- **Redis pool autoscaling** — the static `max_size(50)` is healthy at the current fleet size but a future migration to bb8 dynamic sizing or alternative connection pool managers (e.g. deadpool) would be more elegant.
- **Agent fleet `/healthz` aggregator** — surface per-agent service-key adoption, default-flip status, and AGENT_VERSION in a single fleet-wide JSON.
- **`trigger_fire_log` table** for retrospective trigger-fire analysis, separate from `sap_agent_jobs`.
- **Per-trigger Prometheus metrics** on `/metrics` (Phase 9 deferred).
- **`work_tasks_changed` NOTIFY trigger** to enable `work_tasks`-sourced trigger rules (Phase 9 plumbing already accepts the source table; only the DB-side trigger is missing).
- **Pub/sub broadcast on revoke** so the 60 s revocation-cache TTL window can be tightened to ~1 s.
- **Dedicated `agent_identity_audit_log` table** (Phase 10 deferred).

## Related

- [[Implementations/Implement-Rust-Work-Service-Phase0-Phase1]] through [[Implementations/Implement-Rust-Work-Service-Phase11]] — individual phase notes.
- [[Decisions/ADR-Agent-2.0.0-Release]] — v2.0.0 release decision.
- [[Decisions/ADR-Trigger-DSL-Evaluator-Phase9]] — Phase 9 trigger evaluator security model.
- [[Decisions/ADR-Agent-Identity-V2-Phase10]] — Phase 10 service-key model.
- [[Decisions/ADR-Rust-Work-Service-Availability-SLO]] — the rollout SLO.
- [[Decisions/Roadmap-Rust-WS-Unlocks]] — sibling channel-migration roadmap.
- [[Components/Rust-Work-Service]] — comprehensive end-of-Phase-11 component overview.
- [[Components/Omni-Agent - Headless SAP Agent]] — agent component reflecting v2.0.0.
- [[Sessions/2026-05-06]] — Phase 0-9 session log.
- [[Sessions/2026-05-07]] — Phase 10-11 session log.
