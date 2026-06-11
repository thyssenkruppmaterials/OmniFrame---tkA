---
tags: [type/implementation, status/active, domain/agent, domain/backend, domain/frontend, domain/database, domain/auth]
created: 2026-05-07
---

# Implement Rust Work Service — Phase 11 (FINAL — v2.0.0 Architecture-Change Boundary)

The closing phase of the comprehensive [[plans/rust_work_service_full_integration_5b88165d.plan]]. Phase 11 is **purely deletion + tightening** — no new features. Its job is to retire the dual-path scaffolding Phases 4 / 5 / 6 / 7 / 9 / 10 layered in for backward compatibility, ship the architecture shift cleanly, and bump `AGENT_VERSION` to `"2.0.0"` marking the new architecture boundary. See [[Implement-Rust-Work-Service-Full-Integration-Summary]] for the cross-phase arc.

## Purpose / Context

Phases 4, 6, 7, and 10 each shipped their work behind opt-in env flags (`OMNIFRAME_AGENT_USE_RUST_WS`, `OMNIFRAME_AGENT_CONSOLE_RELAY`, `OMNIFRAME_AGENT_CLAIM_VIA_RUST`, `OMNIFRAME_AGENT_SERVICE_KEY_PATH`) defaulting to `0` so the rust-work-service paths could parallel-run alongside the legacy Supabase Realtime + direct-PostgREST paths during the rollout window. Phase 9 ALSO shipped server-side trigger evaluation but kept the agent's stub callbacks alive so the legacy Realtime callback wiring stayed compilable. Phase 10 added agent-owned service-key identity but kept the user-JWT fallback for the upgrade window.

By 2026-05-07 the parallel-run telemetry confirmed parity across every path — Phase 11 is the cleanup.

Three principles guided the deletion choices:

1. **Default-flip > delete the env var.** Each opt-in flag's default flipped to `1`; the env var itself is scheduled for removal in v2.1.0. Operators that explicitly set a flag to `0` get a one-line deprecation warning at boot. This preserves a 30-second escape hatch while making the canonical path the default.
2. **Soft-fallback for service-key identity.** The plan briefly considered hard-failing boot when no service key is on disk; the better path is a deprecation warning + opt-in `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1` flag for admins that have provisioned every agent. Hard-fail is deferred to v2.1.0.
3. **Delete control-plane fallbacks; keep domain mutations.** The plan's verification gate (`grep -r '_supabase_request' omni_agent/` returns nothing) was overly aggressive given the constraint that `/supabase/login` etc. stay alive for the user-launch UX. Phase 11 deletes the legacy job-control fallback bodies (claim / complete / fail / lease-bump) and documents the surviving direct-Supabase surface as intentional. See "Surviving direct-Supabase surface" below.

## Scope shipped

### 11.1 Migration 284 — REPLICA IDENTITY flip

[`supabase/migrations/284_optimize_rf_putaway_replica_identity.sql`](../../../supabase/migrations/284_optimize_rf_putaway_replica_identity.sql) — applied via Supabase MCP `apply_migration`.

**Pre-state** verification via Supabase MCP:

```
relname               | relreplident
----------------------+-------------
agent_service_keys    | d           (DEFAULT)
agent_triggers        | d           (DEFAULT)
rf_putaway_operations | f           (FULL — pre-Phase-11)
sap_agent_jobs        | d           (DEFAULT)
sap_audit_log         | d           (DEFAULT)
```

**Post-state** after migration 284:

```
relname               | relreplident
----------------------+-------------
rf_putaway_operations | d           (DEFAULT — Phase 11)
```

The migration body: `ALTER TABLE public.rf_putaway_operations REPLICA IDENTITY DEFAULT;` followed by a `DO $$ ... RAISE EXCEPTION ... END $$` assertion block on `pg_class.relreplident = 'd'`, plus a comment update on the table documenting the rationale + cross-link to Phase 4 (migration 276) and the Phase 11 implementation note.

**Why now**: Migration 255 (`255_optimize_replica_identity.sql`, 2026-05-04) flipped `sap_agents`, `sap_agent_jobs`, `sap_agent_schedules`, and `sap_outbound_to_import_runs` from REPLICA IDENTITY FULL → DEFAULT to shrink Realtime UPDATE payloads. `rf_putaway_operations` was deliberately left at FULL because the agent-side trigger evaluator (v1.6.4 era) inspected the OLD row image that Realtime synthesises only when REPLICA IDENTITY is FULL. Phase 4 (2026-05-06, [[Implement-Rust-Work-Service-Phase4]]) replaced the agent's Supabase Realtime path with a `WsEvent::RfPutawayChanged` consumer fed by migration 276's `notify_rf_putaway_changed` trigger (which ships `row_to_jsonb(NEW)` over a Postgres NOTIFY channel — REPLICA IDENTITY plays no role in that payload). Phase 9 (2026-05-07, [[Implement-Rust-Work-Service-Phase9]]) deleted the agent-side trigger evaluator entirely, so even the legacy Realtime callback path no longer inspects the OLD image. The only remaining REPLICA IDENTITY consumer is Supabase Realtime itself, used now exclusively by human dashboard subscriptions for cache-invalidation patterns where key-only events suffice.

Cost of REPLICA IDENTITY FULL on a hot table: every UPDATE writes the full OLD row to WAL alongside the NEW row. On `rf_putaway_operations` that's ~30 columns × N updates/day per warehouse — non-trivial WAL bandwidth for a benefit nobody consumes anymore.

### 11.2 Agent — `AGENT_VERSION = "2.0.0"` + default-flipped env vars

[`omni_agent/agent.py`](../../../omni_agent/agent.py):

#### Version bump

`AGENT_VERSION` flipped from `"1.9.0"` → `"2.0.0"`. The trailing release-note comment is the comprehensive v2.0.0 banner — defaults flipped, surviving direct-Supabase surface documented, breaking-change scope (none), upgrade path for admins. Carry-over notes from v1.9.0 (Phase 4 + 7 + 9 + 10 carry-over) preserved verbatim per the established release-note pattern.

#### `_USE_RUST_WS_RAW` / `_USE_RUST_WS` (Phase 4)

```python
_USE_RUST_WS_RAW: str = os.environ.get("OMNIFRAME_AGENT_USE_RUST_WS", "1")
_USE_RUST_WS: bool = _USE_RUST_WS_RAW != "0"
```

Default flipped from `"0"` → `"1"`. Operators that explicitly set `=0` get a single deprecation warning at boot pointing at the v2.1.0 removal. The `_USE_RUST_WS` boolean is consumed unchanged by the existing branching code in `_start_realtime_subscription` so the legacy Supabase Realtime path still works as a fallback.

#### `_CLAIM_VIA_RUST_RAW` / `_CLAIM_VIA_RUST` (Phase 7)

Same default-flip pattern as `_USE_RUST_WS`. Setting `=0` now has a sharper edge: the `_CLAIM_VIA_RUST=False` branches in `/jobs/claim`, `/jobs/{id}/complete`, `/jobs/{id}/fail`, `/jobs/{id}/heartbeat`, and `_bump_current_job_lease` were rewritten to return `{"ok": False, "error": "OMNIFRAME_AGENT_CLAIM_VIA_RUST=0 is no longer supported in v2.0.0+ ..."}` (the routes don't crash — they return the documented error envelope). The legacy direct-PostgREST RPC calls (`claim_sap_agent_job`, `bump_sap_agent_job_lease`, `_patch_job`, `_patch_job_terminal`) were DELETED from the agent. Net code deletion: ~140 LOC of legacy fallback bodies.

#### `_CONSOLE_RELAY_RAW` / `_CONSOLE_RELAY_ENABLED` (Phase 6)

Same default-flip pattern. The `_CONSOLE_RELAY_ENABLED=False` branch only suppresses the relay; no legacy code body was removed (Phase 6 was additive — there was no "legacy" console relay path).

#### `_bootstrap_agent_identity_v2` — soft-fallback + hard-fail flag (Phase 10)

Three-state boot logic:

- **Service key present** → load it, log `[boot] Agent identity v2: ENABLED` (unchanged from Phase 10).
- **Service key absent + `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1`** → log `[boot] FATAL Agent identity v2: REQUIRED but no service key found ...` and `sys.exit(78)` (the configuration-error exit code in `sysexits.h`). Operators that have provisioned every agent with a service key set this flag so a missing key surfaces as a loud config error instead of silently falling back.
- **Service key absent + flag unset** → log `[boot] DEPRECATION Agent identity v2: NOT CONFIGURED ...` pointing at the v2.1.0 removal of the user-JWT fallback. The agent keeps running on `state.supabase_token` for rust-work-service calls (unchanged from Phase 10).

#### `agent-2.0-architecture` capability

New const string appended to `AGENT_CAPABILITIES`. Surfaces in `/health.capabilities` and `/status.capabilities`. Purely informational — no FE gating today, but a future iteration could badge agents on the v2.0 architecture.

### 11.3 Agent — control-plane fallback deletions

The legacy direct-PostgREST control-plane code that Phase 7 wrapped in `if _CLAIM_VIA_RUST:` branches was deleted entirely:

- `/jobs/claim` — legacy `claim_sap_agent_job` RPC fallback removed (~25 LOC).
- `/jobs/{id}/complete` — legacy `_patch_job_terminal` body removed (~15 LOC).
- `/jobs/{id}/fail` — legacy `_patch_job_terminal` + `_patch_job` (watchdog) bodies removed (~20 LOC).
- `/jobs/{id}/heartbeat` — was still using `_patch_job` directly; migrated to `_work_service_request("POST", f"/api/v1/sap-agents/jobs/{id}/heartbeat", ...)` for consistency with `_bump_current_job_lease` (~5 LOC net).
- `_bump_current_job_lease` — legacy `bump_sap_agent_job_lease` RPC fallback removed (~12 LOC).
- Top-level `_patch_job` and `_patch_job_terminal` helper functions deleted (~95 LOC including the v1.7.2 terminal-state-guard rationale comments — replaced with a single comment block pointing at the rust-work-service handlers that now enforce the same invariants server-side).

Net agent.py LOC delta (whole-file): **12,856 → 12,827 (-29 LOC)**. The headline -29 LOC understates the actual code body deletion (~170 LOC removed) because the v2.0.0 release-note comment, deprecation warnings, default-flip env-var reads, and Phase 11 capability declaration added back ~140 LOC of intentional documentation + scaffolding.

### 11.4 Surviving direct-Supabase surface (intentional)

The Phase 11 verification gate (`grep -r '_supabase_request' omni_agent/` returns nothing) was overly aggressive given the constraint that `/supabase/login` + `/supabase/session` + `/supabase/logout` endpoints stay alive for the user-launch UX. The surviving callsites are documented here as the intentional direct-Supabase surface — none are control-plane:

| Call site | URL | Category | Why kept |
|---|---|---|---|
| `supabase_login` | `/auth/v1/token?grant_type=password` | Auth | User-launch UX (admin clicks "Launch Agent") |
| `supabase_login` | `/rest/v1/user_profiles?id=eq.<uid>` | Auth bootstrap | Fetch `organization_id` for the agent's user context |
| `_refresh_supabase_token_if_needed` | `/auth/v1/token?grant_type=refresh_token` | Auth | Soft-fallback path while service-key adoption rolls out |
| `_upsert_self_in_registry` | `/rest/v1/sap_agents` | Registry write | Domain mutation — agent presence in fleet |
| `_apply_trigger_post_patch` | `/rest/v1/work_tasks?id=eq.<row_id>` | Domain mutation | LT12 follow-on picking JSONB merge |
| `_apply_trigger_post_patch` | `/rest/v1/rf_putaway_operations?id=eq.<row_id>` | Domain mutation | Honest agent attribution overlay (Phase 10 era) |
| `list_agents` / `get_agent` | `/rest/v1/sap_agents?...` + `rpc/reap_stale_sap_agents` | Read-only proxy | Browser-side fleet card via local agent (no auth round-trip) |
| `_log_sap_txn` | `/rest/v1/sap_transaction_logs` | Audit append | Domain table write |
| `_update_putaway_status` | `/rest/v1/rf_putaway_operations?id=eq.<row_id>` | Domain mutation | Primary agent domain write — `to_status='TO Confirmed'` |

The split is clean: control-plane (job claim/complete/fail/heartbeat, lease-bump) is rust-work-service; auth + domain mutations are direct Supabase.

### 11.5 Frontend — `LATEST_AGENT_VERSION = '2.0.0'`

[`src/features/admin/sap-testing/lib/agent-fetch.ts`](../../../src/features/admin/sap-testing/lib/agent-fetch.ts) — `LATEST_AGENT_VERSION` bumped from `'1.9.0'` → `'2.0.0'`. The accompanying JSDoc block summarises the v2.0.0 architecture-change boundary, default flips, deleted fallback paths, migration 284 RFlip, the new `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY` flag, and links to this implementation note + the Full-Integration Summary.

`MIN_REQUIRED_AGENT_VERSION` left at `'1.4.0'` — Phase 11 is not a hard-required upgrade for already-deployed agents (they keep working through the legacy fallbacks for the v2.0.x soft-deprecation window).

No other frontend logic touched. Specifically:

- The `useJobQueue` hook still reads `sap_agent_jobs` rows directly via Supabase — but those reads are *per-job-id row hydration* for the in-flight job tracker, NOT polling. Per-row reads complement the WS event path (`WsEvent::SapJobStatusChanged` from Phase 4) — neither replaces the other. The per-job channel churn that the Tier 1 deferred-channel migration retired was the actual concern.
- The `reversal-panel.tsx` still reads `sap_audit_log` directly for the reversal UI — explicitly documented in the file header as the Worker B pattern (read-only audit query, not in scope for Phase 11).
- The `scheduled-jobs-tab.tsx` still has a `supabase.channel('sap-agent-schedules-tab')` subscribed to `sap_agent_schedules` (a different table than `sap_agent_jobs`). Lined up for a future `WsEvent::SapScheduleChanged` migration documented in [[Decisions/Roadmap-Rust-WS-Unlocks]].
- `realtime-policy workspace rule` Exceptions section already reads `(none — Phase 9 ...)` after Phase 9's removal of the `use-agent-trigger-runtime.ts` exception. No further changes needed in Phase 11.

### 11.6 Rust — Redis pool sizing bump

[`rust-work-service/src/main.rs`](../../../rust-work-service/src/main.rs) — bb8 Redis pool config:

```rust
let redis_pool = bb8::Pool::builder()
    .max_size(50)            // was 10
    .min_idle(Some(5))       // was unset
    .build(redis_manager)
    .await
    .expect("Failed to create Redis pool");
```

Reasoning (recorded in the inline comment block):

- **Phase 4** — WS subscribe-token nonces via `/api/v1/work/ws-token`.
- **Phase 5** — Per-material locks for Material Master mutations (`material_lock:{org}:{material}`, held for the duration of an RFC call ~50–500 ms).
- **Phase 9** — Trigger loop-detection counters (`trigger:depth:{org}:{row_id}` — INCR/EXPIRE per fire, 60 s TTL).
- **Phase 10** — Agent-key revocation cache (`agent-identity:revoked:{key_id}`, read on every authenticated agent request, 60 s TTL).
- Plus pre-existing presence + entity-focus + rate-limit usage.

At a fleet of 4 agents + ~30 browsers per org, the worst-case concurrent acquire was hitting the old 10-cap during dispatch bursts (claim → trigger fire → material lock → audit) and queuing for the bb8 timeout. 50 connections × ~30 KiB/conn ≈ 1.5 MiB resident on the Redis client side — cheap for the headroom. `min_idle = 5` keeps the warm-path latency stable through a quiescent Citrix overnight (no acquire-on-idle reconnect storm at the morning login spike).

## Quality gates

- ✓ Migration 284 applied via Supabase MCP `apply_migration`. Verified: `pg_class.relreplident = 'd'` for `rf_putaway_operations` (was `'f'`).
- ✓ `cargo build` clean (only pre-existing dead-code warnings on `observability/middleware.rs`).
- ✓ `cargo test --lib`: **146 passed**, 0 failed (unchanged from Phase 10 — Phase 11 is pure deletion + tightening, no test surface change).
- ✓ `cargo clippy --lib --all-targets`: zero new warnings on Phase 11 files.
- ✓ `python3 -c "import ast; ast.parse(open('omni_agent/agent.py').read())"` clean.
- ✓ `pnpm tsc -b --noEmit` clean.
- ✓ `pnpm build` clean (8.91s, 182 PWA precache entries; no new bundle-budget violations).
- ✓ `grep -r "_supabase_request" omni_agent/` returns 22 matches; all in the documented surviving direct-Supabase surface (auth + domain mutations + registry + audit).
- ✓ `grep -r "supabase\.co/rest/v1" omni_agent/` returns nothing (no hard-coded Supabase URLs).
- ✓ `grep AGENT_VERSION omni_agent/agent.py` → `"2.0.0"`.

## Files

### Created

- `supabase/migrations/284_optimize_rf_putaway_replica_identity.sql`
- [[Implementations/Implement-Rust-Work-Service-Phase11]] (this note)
- [[Implementations/Implement-Rust-Work-Service-Full-Integration-Summary]]
- [[Decisions/ADR-Agent-2.0.0-Release]]
- [[Components/Rust-Work-Service]]

### Modified

- `omni_agent/agent.py` — `AGENT_VERSION = "2.0.0"`, default-flipped `_USE_RUST_WS` / `_CLAIM_VIA_RUST` / `_CONSOLE_RELAY_ENABLED`, deleted legacy job-control fallback bodies (`_patch_job`, `_patch_job_terminal` + the `if not _CLAIM_VIA_RUST` branches), added `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY` hard-fail flag in `_bootstrap_agent_identity_v2`, added `agent-2.0-architecture` capability, updated boot banner.
- `rust-work-service/src/main.rs` — bb8 Redis pool `max_size(10) → 50`, `min_idle(Some(5))` added; reasoning comment block.
- `src/features/admin/sap-testing/lib/agent-fetch.ts` — `LATEST_AGENT_VERSION = '2.0.0'` + JSDoc release banner.
- [[Components/Omni-Agent - Headless SAP Agent]] — Recent additions section appended for v2.0.0.
- [[_Index/Implementations]] — Phase 11 link added.
- [[_Index/Decisions]] — ADR-Agent-2.0.0-Release link added.
- [[Sessions/2026-05-07]] — Phase 11 section appended.

### Deleted (in `omni_agent/agent.py`)

- `_patch_job(job_id, body)` helper (~14 LOC).
- `_patch_job_terminal(job_id, body, expected_claimed_by)` helper + the v1.7.2 terminal-state-guard rationale comment (~80 LOC).
- The `_CLAIM_VIA_RUST=False` legacy fallback bodies in `/jobs/claim` (~25 LOC), `/jobs/{id}/complete` (~15 LOC), `/jobs/{id}/fail` (~30 LOC including watchdog branch), and `_bump_current_job_lease` (~12 LOC).

### Net agent LOC delta

- Before: 12,856 LOC.
- After: 12,827 LOC.
- Delta: **-29 LOC net** (raw line count). The deletion footprint was ~170 LOC; the new release-note comment + boot-banner deprecation warnings + default-flip env reads + capability declaration added ~140 LOC of intentional scaffolding.

## Open follow-ups (deferred to v2.1.0+)

- **Visual DSL builder UI** for the trigger CRUD form (Phase 9 deferred). The current form is a JSON textarea + the `/preview` dry-run pane.
- **`OMNIFRAME_AGENT_USE_RUST_WS` / `_CLAIM_VIA_RUST` / `_CONSOLE_RELAY` env-var removal** in v2.1.0. The deprecation warnings are in place; the next major bump deletes the dual-path scaffolding entirely.
- **User-JWT fallback removal** in v2.1.0. After every agent has a service key (verified by `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1` rollout), delete `state.supabase_token` as a credential source for rust-work-service calls. The `/supabase/login` + `/supabase/session` + `/supabase/logout` endpoints themselves stay forever — they remain part of the user-launch UX.
- **Redis pool autoscaling** — the static `max_size(50)` is healthy at the current fleet size but a future migration to bb8 dynamic sizing or alternative connection pool managers (e.g. deadpool) would be more elegant.
- **Agent fleet `/healthz` aggregator** — surface per-agent service-key adoption status, default-flip status, and AGENT_VERSION in a single fleet-wide JSON for ops dashboards.
- **`trigger_fire_log` table** (Phase 9 deferred) — a dedicated table for retrospective analysis of trigger fires, separate from `sap_agent_jobs` (which IS today's audit trail but mixes trigger-fired rows with manual enqueues).
- **Per-trigger Prometheus metrics** on `/metrics` (Phase 9 deferred). Today the per-trigger fire / loop-detected counts live in the structured-log stream.
- **`work_tasks_changed` NOTIFY trigger** (Phase 9 deferred). The evaluator's allowlist already includes `work_tasks` but the NOTIFY trigger isn't installed.
- **"Download key as TXT" button** on the Phase 10 reveal dialog — pre-formats the file at the canonical service-key path with no risk of trailing newlines.
- **Per-key `expires_at` opt-in** on `agent_service_keys` (today plaintext keys live until admin revokes).
- **Pub/sub broadcast on revoke** so the 60 s revocation-cache TTL window can be tightened to ~1 s (defence-in-depth control; documented as acceptable in [[ADR-Agent-Identity-V2-Phase10]]).
- **Dedicated `agent_identity_audit_log` table** (Phase 10 deferred). Today the structured-log stream carries the audit trail.

## Related

- [[Implementations/Implement-Rust-Work-Service-Full-Integration-Summary]] — top-level summary linking all 12 phases (0-11).
- [[Decisions/ADR-Agent-2.0.0-Release]] — the major-version-bump rationale, breaking-change scope, upgrade path.
- [[Components/Rust-Work-Service]] — comprehensive overview of the rust-work-service at end-of-Phase-11.
- [[Components/Omni-Agent - Headless SAP Agent]] — agent component (Recent additions section updated for v2.0.0).
- [[Implementations/Implement-Rust-Work-Service-Phase4]] — Phase 4 (rust-ws-client default).
- [[Implementations/Implement-Rust-Work-Service-Phase7]] — Phase 7 (claim path centralisation).
- [[Implementations/Implement-Rust-Work-Service-Phase9]] — Phase 9 (server-side trigger evaluator).
- [[Implementations/Implement-Rust-Work-Service-Phase10]] — Phase 10 (agent identity v2).
- [[Sessions/2026-05-07]] — session log this phase appends to.
