---
tags: [type/implementation, status/active, domain/agent, domain/backend, domain/api, domain/database]
created: 2026-05-06
---

# Implement Rust Work Service — Phase 7

Phase 7 of the comprehensive [[plans/rust_work_service_full_integration_5b88165d.plan]] (Phase 0+1 in [[Implement-Rust-Work-Service-Phase0-Phase1]], Phase 2 telemetry foundation in [[Implement-Rust-Work-Service-Phase2]], Phase 3 fleet snapshot in [[Implement-Rust-Work-Service-Phase3]], Phase 4 agent WS in [[Implement-Rust-Work-Service-Phase4]]). **Centralizes the queue claim path through `rust-work-service`.** Sets up Phase 10 (agent identity v2). Net deletion target after parallel-run: ~80 LOC of direct PostgREST glue from `omni_agent/agent.py` (`jobs_claim`'s RPC POST, `_patch_job_terminal`, `_bump_current_job_lease`'s RPC POST).

## Purpose / Context

Until Phase 7 the agent's hot-path queue writes (`claim` → `complete`/`fail` → `heartbeat`) went **directly** to PostgREST (`<supabase>/rest/v1/rpc/claim_sap_agent_job`, `PATCH <supabase>/rest/v1/sap_agent_jobs`, `<supabase>/rest/v1/rpc/bump_sap_agent_job_lease`). This had two long-running consequences:

1. **Zero observability.** PostgREST emits no per-org metrics; the only signal we had on claim throughput was `pg_stat_statements`. When the c9d89a74 tenant's Supabase Realtime overload (2026-05-06 incident) tipped the agent into polling-only mode, we had no way to know whether the agent was even claiming or just spinning, until users complained.
2. **Phase 10 (agent identity v2) blocked.** The Phase 10 plan calls for a JWT-claim check that maps `auth.uid` → `sap_agents.id` so a hijacked or rogue agent token can't claim jobs that aren't pinned to it. There's nowhere to put that middleware on a direct-PostgREST call.

Phase 7 routes all four lifecycle calls through new `rust-work-service` endpoints under `/api/v1/sap-agents/jobs/...`. The Rust handlers wrap the **same** SQL functions / PATCH semantics — the DB contract is unchanged — but they ALSO emit Prometheus metrics and provide a future seat for Phase 10's identity middleware.

Like Phase 4, the migration ships **behind a feature flag** (`OMNIFRAME_AGENT_CLAIM_VIA_RUST`, default `0`). Both paths coexist; a single agent process picks one. Per-claim parallel-run counters (`_claim_via_rust_total` vs `_claim_via_supabase_total`) are bumped on every claim and printed inline so a 24h `grep '[claim-path]'` confirms parity before the default flips in Phase 11.

## Scope shipped

### 7.1 Four new Rust endpoints

[rust-work-service/src/api/routes/sap_agents.rs](../../../rust-work-service/src/api/routes/sap_agents.rs) — extends Phase 3's `sap_agents_routes()`:

```rust
pub fn sap_agents_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/fleet",                       get(get_fleet))           // Phase 3
        .route("/jobs/recent",                 get(get_recent_jobs))     // Phase 3
        .route("/jobs/claim",                  post(post_claim_job))     // Phase 7
        .route("/jobs/:job_id/complete",       post(post_complete_job))  // Phase 7
        .route("/jobs/:job_id/fail",           post(post_fail_job))      // Phase 7
        .route("/jobs/:job_id/heartbeat",      post(post_heartbeat_job)) // Phase 7
}
```

All four are nested under `/api/v1/sap-agents` by `main.rs` (Phase 3 already added the nest — `mod.rs` was NOT touched, no Phase 5 collision risk). All four are behind the existing `require_auth` middleware. `organization_id` is taken from the JWT — never from the body — so cross-tenant calls are impossible by construction.

#### `POST /jobs/claim`

Wraps `claim_sap_agent_job(p_org, p_agent, p_lease)` (migration 247). Emits `sap_jobs_claim_total{org_hash, outcome=hit|miss}` + `sap_jobs_claim_latency_ms{org_hash}`.

```rust
// Body: { agent_id, lease_seconds = 90 }
// Returns: { job: Option<SapJobRow> }
SELECT ... FROM public.claim_sap_agent_job($1::uuid, $2::text, $3::int)
 WHERE id IS NOT NULL  -- empty-queue case: function returns all-NULL row
```

Lease seconds clamp to `10..=3600` so a buggy/hostile caller can't pin rows down to <10s lease and starve the queue.

#### `POST /jobs/:job_id/complete` and `POST /jobs/:job_id/fail`

Match the v1.7.2 `_patch_job_terminal` semantics — `status='running' AND claimed_by=<agent_id>` filters so a watchdog-killed row can't be silently rewritten. Both routes return `{ ok, rows_affected, skipped_reason? }` so the agent can tell "nothing to do" apart from a transport error.

```sql
UPDATE public.sap_agent_jobs
   SET status='completed', result=$1, completed_at=now(), heartbeat_at=now()
 WHERE id=$2 AND organization_id=$3 AND claimed_by=$4 AND status='running'
```

Error messages on `/fail` are trimmed to 500 chars (mirrors agent v1.7.2 `_patch_job_terminal`).

Metrics: `sap_jobs_complete_total{org_hash, outcome=success|state_mismatch}`, `sap_jobs_fail_total{org_hash, step}`. The `step` label is bounded by the agent's literal step taxonomy (`watchdog`, `dispatch`, `sap-com-hung`, …); `unknown` when the agent omits it.

#### `POST /jobs/:job_id/heartbeat`

Wraps `bump_sap_agent_job_lease(p_job, p_agent, p_lease)`. Returns `{ ok, claim_lease_until }`. `claim_lease_until=null` means the row no longer belongs to this agent (lost claim — the agent should clear `state.active_job_id`).

#### Idempotency-Key header (best-effort)

`/complete` + `/fail` honour `Idempotency-Key` for **counting only** — a replay bumps `work_idempotency_hits_total{route="sap_jobs_complete"|"sap_jobs_fail"}`. The terminal transitions are **naturally** idempotent (the `status='running'` filter rejects re-runs), so we don't burn a row in `work_request_idempotency` for them.

### 7.2 Four new Prometheus metrics

[rust-work-service/src/observability/metrics.rs](../../../rust-work-service/src/observability/metrics.rs) — added under the `Phase 7` block:

| Metric | Type | Labels | Purpose |
|---|---|---|---|
| `sap_jobs_claim_total` | IntCounterVec | `org_hash`, `outcome=hit\|miss` | Per-org claim attempt rate + hit ratio |
| `sap_jobs_claim_latency_ms` | HistogramVec | `org_hash` | Claim RPC P95/P99. Buckets [10, 50, 100, 250, 500, 1000, 2500, 5000] |
| `sap_jobs_complete_total` | IntCounterVec | `org_hash`, `outcome=success\|state_mismatch` | Watchdog race detection |
| `sap_jobs_fail_total` | IntCounterVec | `org_hash`, `step` | Failure cause breakdown (cardinality bounded by agent step taxonomy) |

`org_hash` reuses the existing `org_hash_label()` helper (4 hex chars) so cardinality stays bounded at scale. These complement the Phase 2 `work_*` metrics — same dashboard, different panel.

### 7.3 Agent-side flag + helper

[omni_agent/agent.py](../../../omni_agent/agent.py) — additive only. Legacy `_supabase_request` paths run unchanged when `OMNIFRAME_AGENT_CLAIM_VIA_RUST` is unset.

#### Module-level

```python
_CLAIM_VIA_RUST: bool = os.environ.get("OMNIFRAME_AGENT_CLAIM_VIA_RUST", "0") == "1"

_claim_path_lock = threading.Lock()
_claim_via_rust_total: int = 0
_claim_via_supabase_total: int = 0

def _bump_claim_path_counter(via_rust: bool) -> tuple[int, int]:
    ...  # increments under lock; returns (rust_total, supa_total)
```

#### `state.work_service_url`

New field on `AgentState.__init__` cached from `OMNIFRAME_WORK_SERVICE_URL` (default: production Railway URL). Used by every Phase 7 callsite via `_work_service_url_base()` so a future runtime mutation (e.g. canary-deploy URL swap) is a one-shot setattr.

#### `_work_service_request(method, path, **kwargs)`

Mirror of `_supabase_request` — same 30s timeout + single-retry on transient errors. Headers injected: `Authorization: Bearer <state.supabase_token>`, `X-Agent-Id: <_agent_self_id()>`, `Content-Type: application/json`. The `X-Agent-Id` header is purely informational today; Phase 10 will validate it against the JWT's `sap_agents` claim at the middleware layer.

#### `_work_service_complete(...)`, `_work_service_fail(...)`

Thin POST wrappers that return the same dict shape as `_patch_job_terminal` so callers don't care which path executed: `{ ok, rows_affected, row?, skipped_reason?, error? }`.

### 7.4 Branch points in agent.py

Three existing functions branch at their entry on `_CLAIM_VIA_RUST`:

```python
# jobs_claim() — single-flight + RPC
if _CLAIM_VIA_RUST:
    resp = _work_service_request("POST", "/api/v1/sap-agents/jobs/claim", json={
        "agent_id": _agent_self_id(),
        "lease_seconds": 90,
    })
    ...
    via_rust, via_supa = _bump_claim_path_counter(via_rust=True)
    print(f"[claim-path] via=rust hit={...} totals(rust={via_rust}, supabase={via_supa})")
    ...
else:
    resp = _supabase_request("POST", f"{state.supabase_url}/rest/v1/rpc/claim_sap_agent_job", ...)
    via_rust, via_supa = _bump_claim_path_counter(via_rust=False)
    print(f"[claim-path] via=supabase hit={...} totals(rust={via_rust}, supabase={via_supa})")
    ...

# jobs_complete() — branches on the same flag and calls _work_service_complete()
# jobs_fail()      — branches on the same flag and calls _work_service_fail()
# _bump_current_job_lease() — branches on the same flag and POSTs /heartbeat
```

#### Subtle: watchdog flow

Legacy `jobs_fail` had an escape hatch — `step='watchdog'` calls bypassed the v1.7.2 `_patch_job_terminal` guard and went directly to `_patch_job` so the watchdog could ALWAYS transition `running → failed`. The Phase 7 Rust handler enforces `status='running' AND claimed_by=<self>` even on the watchdog path. **This is a slight tightening** but a correct one: the watchdog only fires on rows this agent is parked on, so the guard SHOULD always pass; if it doesn't (another agent already re-claimed via lease expiry), refusing the overwrite is the right semantic. The `state_mismatch` outcome is logged + counted in `sap_jobs_fail_total{step="watchdog"}`.

### 7.5 Capability advertisement

New capability `agent-claims-via-rust` advertised in `/health.capabilities` UNCONDITIONALLY (build capability, not runtime path) so the FE / dashboards can detect agents on the new path without inspecting env vars. Mirrors the Phase 4 `rust-ws-client` pattern. Purely informational — no FE gating today.

### 7.6 Boot prints

The boot banner now discloses the active claim path so an operator pulling agent logs can tell where writes went without grepping `[claim-path]`:

- `[boot]   Claim path: rust-work-service /api/v1/sap-agents/jobs (Phase 7 — OMNIFRAME_AGENT_CLAIM_VIA_RUST=1). Targeting <url>. ...`
- `[boot]   Claim path: direct PostgREST (default). Phase 7 endpoints are BUILT-IN but inactive — set OMNIFRAME_AGENT_CLAIM_VIA_RUST=1 to switch to rust-work-service /api/v1/sap-agents/jobs/...`

### 7.7 Cross-PR coordination with Phase 5

No collision: Phase 3 already mounted `/api/v1/sap-agents` in `mod.rs`; Phase 7 only EXTENDS the router list inside `sap_agents.rs`. If/when Phase 5 ships `/api/v1/sap-mutations` it'll add a sibling nest. Phase 5's `sap_audit_log` writes are not yet shipped on the Rust side — when they are, the Phase 7 `complete`/`fail` handlers should also write `terminal_status` updates to the audit row. The natural extension point is right after the `UPDATE public.sap_agent_jobs` SQL in each handler (today there's no audit-row dependency to coordinate; just leaving the seam).

## Quality gates

- [x] `cargo build` clean (7 pre-existing dead-code warnings only — no new warnings on changed files).
- [x] `cargo test --lib` 49/49 passed including 4 new Phase 7 tests:
  - `claim_request_deserialises_with_default_lease`
  - `complete_request_carries_arbitrary_result_json`
  - `fail_request_carries_step_and_error_truncates_to_500`
  - `heartbeat_request_clamps_lease_seconds`
- [x] `cargo clippy --lib --tests` no NEW warnings on changed files (12 pre-existing warnings in unrelated files: `IdempotencyError`, `cleanup_expired`, `lookup`, `record`, `canonical_request_hash`, `canonicalize`, `ReplayedResponse`, `ensure_zone_rules_enabled`, `manual_clamp` in `work.rs:929`, `redundant_field_names` in `work.rs:312`, `too_many_arguments` in `db/queries.rs:1346`).
- [x] `python3 -c "import ast; ast.parse(open('omni_agent/agent.py').read())"` — clean.
- [x] `pnpm tsc -b --noEmit` clean.
- [x] `pnpm build` clean (~9s, 182 PWA precache entries; no new bundle-budget violations).
- [x] `agent.py` copied to `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py` for the next Windows EXE rebuild.

## Sample SQL execution

What the new `POST /api/v1/sap-agents/jobs/claim` endpoint runs against the database (parameters bound by sqlx):

```sql
-- Body: { agent_id: "INDPDC1-Console-aclark", lease_seconds: 90 }
-- Org from JWT claim, e.g. 'c997-...' UUID
SELECT
    id, organization_id, endpoint, payload, status, claimed_by,
    assigned_agent_id, claimed_at, started_at, heartbeat_at,
    claim_lease_until, claim_count, priority, attempts, max_attempts,
    idempotency_key, created_at
FROM public.claim_sap_agent_job(
    'c9970000-0000-0000-0000-000000000000'::uuid,  -- $1 org_id (JWT)
    'INDPDC1-Console-aclark'::text,                 -- $2 agent_id (body)
    90::int                                          -- $3 lease_seconds (body)
)
WHERE id IS NOT NULL;
```

The `claim_sap_agent_job` SQL function (migration 247) atomically picks the highest-priority eligible row for `agent_id` in the supplied org, sets `status='running' / claimed_by / claim_lease_until / claim_count++ / attempts++ / heartbeat_at=now()`, and returns the full row. When the queue is empty it returns a row with all-NULL columns; the outer `WHERE id IS NOT NULL` filter converts that to a `fetch_optional → None` (Rust) which serialises as `{ "job": null }`.

## Parallel-run instrumentation

Every `jobs_claim` call prints one line that exposes both per-path counters:

```
[claim-path] via=rust hit=yes totals(rust=42, supabase=0)
[claim-path] via=supabase hit=no totals(rust=0, supabase=137)
```

A 24h `grep '\[claim-path\]' agent.log | wc -l` confirms the agent claimed at least N times; `awk` over `via=rust` vs `via=supabase` confirms parity (one path should be 100% of the volume on a given agent process — both being non-zero indicates a runtime flag flip mid-run, which is unexpected).

The Rust side complements with `sap_jobs_claim_total{org_hash="c997", outcome}` for fleet-wide visibility. After 24-48h of parallel-run with both paths shipped on the agent fleet (some agents on `OMNIFRAME_AGENT_CLAIM_VIA_RUST=1`, others off), per-org claim rates from Prometheus should match the agent log counters within ±5%.

## Files touched

```
~ rust-work-service/src/api/routes/sap_agents.rs                          (+~480 LOC: 4 new handlers + 4 unit tests)
~ rust-work-service/src/observability/metrics.rs                          (+~80 LOC: 4 new metric handles + names)
~ omni_agent/agent.py                                                     (+~210 LOC: flag + state field + helper + 3 branches + capability + boot prints)
```

## Deferred (target Phase 11 / v1.10)

- **Default flip** — `OMNIFRAME_AGENT_CLAIM_VIA_RUST=1` becomes the default after the parallel-run window confirms parity. AGENT_VERSION bumps to v1.10 in the same step (Phase 7 deliberately stays on v1.9.0 — the change is invisible at default).
- **Legacy code deletion** — once the default flips, the `else` branches in `jobs_claim` / `jobs_complete` / `jobs_fail` / `_bump_current_job_lease` plus the entire `_patch_job_terminal` (and its `_patch_job` helper, only called from there + the watchdog escape hatch which itself disappears) can be deleted. Net deletion: ~80 LOC.
- **Phase 10 — agent identity v2** — the Rust handlers' `agent_id` body field becomes the trust boundary. A new middleware step validates `body.agent_id == jwt.claim('sap_agent_id')` so a stolen JWT can't claim arbitrary rows. Today the field is purely informational.
- **Phase 5 audit-log integration** — when `sap_audit_log` writes ship from `rust-work-service`, the Phase 7 `complete` / `fail` handlers should ALSO write `terminal_status` updates to the corresponding audit row. The seam is right after the `UPDATE public.sap_agent_jobs` SQL.

## Related

- [[Implement-Rust-Work-Service-Phase0-Phase1]]
- [[Implement-Rust-Work-Service-Phase2]]
- [[Implement-Rust-Work-Service-Phase3]]
- [[Implement-Rust-Work-Service-Phase4]]
- [[ADR-Rust-Work-Service-Availability-SLO]]
- [[Roadmap-Rust-WS-Unlocks]]
- [[Migrate-Tier1-Deferred-Channels-To-Rust-WS]]
