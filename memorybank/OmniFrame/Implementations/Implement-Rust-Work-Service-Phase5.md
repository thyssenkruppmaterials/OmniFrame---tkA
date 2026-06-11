---
tags: [type/implementation, status/active, domain/backend, domain/frontend, domain/database, domain/realtime, domain/agent]
created: 2026-05-06
---

# Implement Rust Work Service — Phase 5

Phase 5 of the comprehensive [[plans/rust_work_service_full_integration_5b88165d.plan]] (Phases 0+1 in [[Implement-Rust-Work-Service-Phase0-Phase1]], Phase 2 telemetry in [[Implement-Rust-Work-Service-Phase2]], Phase 3 fleet snapshot in [[Implement-Rust-Work-Service-Phase3]], Phase 4 agent-on-Rust-WS in [[Implement-Rust-Work-Service-Phase4]]). Ships **server-side defence-in-depth** on the highest-risk SAP Testing surface: Material Master mutations.

## Purpose / Context

Before Phase 5, Material Master mutations (MM02 storage-bin / storage-types updates) flowed:

```
browser → agentFetch('http://localhost:8765/sap/material-master-bin') → SAP GUI
```

Directly. The browser was also the only place the audit row was written (`logSapAudit(...)` after the agent returned). Failure modes that motivated Phase 5:

1. **No server-side role gate** — a stolen JWT for a non-admin user could call the agent's HTTP endpoints today (the agent only checks the user's `X-Agent-Token`, not the role).
2. **No concurrency guard** — two admins clicking "update bin for material X" within the same minute could fire two MM02 transactions in SAP that race each other.
3. **No rate limit** — a runaway batch loop could fire thousands of MM02 requests in seconds.
4. **Audit row could be skipped** — the FE's `logSapAudit(...)` is best-effort fire-and-forget; if the browser crashes between the agent response and the supabase insert, the mutation happened but no audit trail exists.
5. **Audit row writes ANYTHING the FE wants** — the writer is the same JWT the user holds, so a malicious browser could log whatever it wants on its own audit row.

Phase 5 fixes all five at the server boundary by introducing a dedicated rust-work-service route that the FE now calls instead of the agent directly. The agent itself doesn't change at all — the new route simply INSERTs the same `sap_agent_jobs` row the queue-mode path already creates, and the agent claims it the same way.

## Scope shipped

### A. Migration 277 — `sap_audit_log` lifecycle states

[supabase/migrations/277_phase5_audit_log_lifecycle.sql](../../../supabase/migrations/277_phase5_audit_log_lifecycle.sql) — applied via Supabase MCP `apply_migration`.

```sql
ALTER TABLE public.sap_audit_log
  DROP CONSTRAINT IF EXISTS sap_audit_log_status_check;

ALTER TABLE public.sap_audit_log
  ADD CONSTRAINT sap_audit_log_status_check
  CHECK (status = ANY (ARRAY[
    'success'::text, 'error'::text, 'warning'::text,
    'pending'::text, 'completed'::text, 'failed'::text, 'canceled'::text
  ]));
```

The legacy `success` / `error` / `warning` triplet stays accepted so the existing FE `logSapAudit(...)` callsites in `recorder-panel.tsx` / `agent-health-card.tsx` / `reversal-panel.tsx` / `use-job-queue.ts` don't have to migrate in lock-step. The new `pending` / `completed` / `failed` / `canceled` states are used by the Phase 5 route + the `sap_jobs_listener` patch.

**Why `canceled` not `cancelled`** — `sap_agent_jobs.status` already uses the single-l spelling (per its own `_status_check` constraint). Mirroring it keeps the listener's `WHERE status = $1` filter trivially correct. The plan's `cancelled` was informal description.

Also added `idx_sap_audit_log_job_id` (partial index `WHERE job_id IS NOT NULL`) so the listener-side `WHERE job_id = $1 AND status = 'pending'` patch is O(log N) at fleet scale.

### B. Rust route — `POST /api/v1/sap-mutations/material-master`

[rust-work-service/src/api/routes/sap_mutations.rs](../../../rust-work-service/src/api/routes/sap_mutations.rs) — NEW file. ~600 LOC including the test module.

Five-step defence-in-depth pipeline:

1. **Role gate** — caller must hold `admin` / `superadmin` / `super_admin` / `sap_mutator` (or be a service-key caller). Service-key callers bypass the gate so internal orchestrators can proxy on behalf of a verified user. The `sap_mutator` literal is reserved for a future fine-grained role; today's RBAC seed only carries `admin` + `superadmin`.
2. **Per-material concurrency lock** — `presence:lock:material:{org_id}:{material_id}` SET NX EX 300. A second admin clicking "update" on the same material within 5 minutes gets HTTP 409.
3. **Per-org rate limit** — `ratelimit:sap-mutations:{org_id}` Redis counter. INCR on every request; first INCR sets EXPIRE 60s. > 10 in 60s window ⇒ HTTP 429 with `Retry-After` header (uses the remaining counter TTL when available, falls back to the window length).
4. **Pre-flight `sap_audit_log` row** — INSERTed with `status='pending'` and the `payload` blob captured BEFORE the job is enqueued. Captures: `organization_id`, `user_id`, `transaction_code`, `action`, `payload` (material/plant/warehouse/storage_type/fields/endpoint/assigned_agent_id), `prev_state` (if dry-run forwarded one).
5. **`sap_agent_jobs` INSERT + audit row link** — same DB transaction. Job payload carries `_audit_log_id` so the listener can resolve the audit row. The audit row's `job_id` column is also set in the same transaction so a `WHERE job_id = $1` filter on the listener side can find the audit row even when the payload's `_audit_log_id` is missing.

Wire response shape:

```json
{ "ok": true, "job_id": "<uuid>", "audit_log_id": "<uuid>" }
```

Body validation:

- `material` non-empty, ≤ 64 chars.
- `endpoint` (when supplied) must be one of `ALLOWED_MUTATION_ENDPOINTS`: `/sap/material-master-bin`, `/sap/material-master-storage-types`. Defaults to `/sap/material-master-bin`.
- `fields` is `BTreeMap<String, Option<String>>` so `null` means "clear this MM02 column" (e.g. blanking a storage bin).

Idempotency-Key header is forwarded into `sap_agent_jobs.idempotency_key` so a network retry by the FE never enqueues the same mutation twice.

**Lock release semantics** — the lock is released on early-exit error paths (rate-limit overflow ⇒ release before returning 429 so the caller can legitimately retry in 60s without the 5-minute lock blocking them). On success, the lock is left in place to expire naturally so a second admin can't immediately fire another MM02 on the same material — that's the intended defence-in-depth behaviour.

### C. Router wiring

[rust-work-service/src/api/routes/mod.rs](../../../rust-work-service/src/api/routes/mod.rs) — added `pub mod sap_mutations;` + `pub use sap_mutations::sap_mutations_routes;` (alphabetical placement between `sap_agents` and `work`).

[rust-work-service/src/main.rs](../../../rust-work-service/src/main.rs) — added the route group AFTER the Phase 3 `/api/v1/sap-agents` nest in the protected-routes router:

```rust
let protected_routes = Router::new()
    .nest("/api/v1/work", work_routes())
    .nest("/api/v1/workers", workers_routes())
    .nest("/api/v1/presence", presence_routes())
    .nest("/api/v1/sap-agents", sap_agents_routes())
    .nest("/api/v1/sap-mutations", sap_mutations_routes())  // ← Phase 5
    .nest("/api/v1/entity-focus", entity_focus_routes())
    .nest("/api/v1/notifications", notifications_routes())
    .nest("/api/v1/dispatch", dispatch_routes())
    .layer(axum::middleware::from_fn_with_state(state.clone(), middleware::require_auth));
```

The crate-level doc-block in `main.rs` lists the new `POST /api/v1/sap-mutations/material-master` endpoint under "Protected".

### D. `ApiError::TooManyRequests` variant

[rust-work-service/src/api/error.rs](../../../rust-work-service/src/api/error.rs) — added a structured 429 variant that carries the `Retry-After` value and emits the matching HTTP header:

```rust
ApiError::TooManyRequests {
    message: String,
    retry_after_secs: Option<u64>,
}
```

The `IntoResponse` impl injects `Retry-After: <secs>` so well-behaved FE clients can show "try again in N seconds" UX automatically.

### E. `sap_jobs_listener` audit-row patch

[rust-work-service/src/sap_jobs_listener.rs](../../../rust-work-service/src/sap_jobs_listener.rs) — added a `patch_audit_row_on_terminal()` side-effect that runs INSIDE the existing `LISTEN sap_agent_job_changed` consumer loop, BEFORE the WS broadcast.

Filter: `op == 'UPDATE'` AND `status ∈ {completed, failed, canceled}`. SQL:

```sql
UPDATE public.sap_audit_log
   SET status = $1
 WHERE job_id = $2
   AND status = 'pending'
```

The `AND status = 'pending'` predicate scopes the patch to Phase 5 audit rows specifically — legacy rows that landed at `success` / `error` / `warning` via `logSapAudit(...)` are untouched. Errors are logged at `warn!` and swallowed: failing the patch must NEVER kill the listener task. Subsequent agent heartbeats / terminal status updates retry the patch idempotently because the constraint accepts the same terminal values.

The patch awaits before the WS broadcast so a single listener tick is serial and the FE never sees a `SapJobStatusChanged` event before the audit row is settled.

### F. FE client — `sap-mutations-client.ts`

[src/lib/work-service/sap-mutations-client.ts](../../../src/lib/work-service/sap-mutations-client.ts) — NEW file. Mirrors the auth-header shape used by the sibling `sap-agents-client.ts` (Phase 3): JWT in `Authorization: Bearer ...`, optional `X-Organization-ID`, `Idempotency-Key` for the Phase 5 specific replay-protection.

Exports:

- `setSapMutationsOrganization(orgId)` — wires the org context.
- `postMaterialMasterMutation(body, idempotencyKey)` — the canonical entry point.
- `MaterialMasterMutation` / `MutationResult` typescript interfaces.
- `SapMutationError` — custom error class carrying `status`, `code`, `retryAfterSecs`, `details` so callers can branch on `err.status === 429` etc. without re-parsing the response.

Auth-header construction is local to the file (mirrors the sibling-file pattern Phase 3 used) — keeps each client self-contained without depending on `client.ts`'s internal `fetchWithAuth`.

### G. FE swap — `inventory-management-tab.tsx`

[src/features/admin/sap-testing/components/inventory-management-tab.tsx](../../../src/features/admin/sap-testing/components/inventory-management-tab.tsx) — both the single-mutation flow (`runMutation`) and the batch flow now route Material Master endpoints through the new Phase 5 path.

New helpers (above `mutationOneLineSummary`):

- `PHASE5_MATERIAL_MASTER_ENDPOINTS` — set of `/sap/material-master-bin` + `/sap/material-master-storage-types`.
- `isPhase5MaterialMasterEndpoint(endpoint)` — predicate.
- `buildPhase5MaterialMasterBody(...)` — constructs the request body from the FE's flat `inputs` map. Splits structural fields (`material`, `plant`, `warehouse`, `storage_type`) from the column overrides; treats blank string as `null` for the `fields` map (MM02 "clear this column" semantics).

**Single-mutation flow** — when `selectedQuery.mutationEndpoint` matches the predicate, the handler calls `postMaterialMasterMutation(...)` first, then awaits the job's terminal status via `jobQueue.waitForJob(job_id)` (new method, see below). The FE-side `logSapAudit(...)` insert is suppressed for the Material Master path because the server-side pre-flight audit row is now the authoritative record.

**Batch flow** — Material Master batch rows route through Phase 5 *regardless of `queueMode`*. The server-side pre-flight (role gate / lock / rate limit / audit) ALWAYS applies on this surface — there's no in-browser bypass. Other endpoints retain their existing queue-mode vs in-browser branching.

**429 / 409 handling** — `SapMutationError` is caught at both flows; a 429 surfaces as `"Per-org budget exceeded — Retry in Ns"` toast, a 409 surfaces as `"Material '...' is already being edited"`. Both are logged to the SAP Console at `warning` (not `error`) level since they're recoverable.

### H. `useJobQueue.waitForJob(jobId, opts?)`

[src/features/admin/sap-testing/hooks/use-job-queue.ts](../../../src/features/admin/sap-testing/hooks/use-job-queue.ts) — added a third method to the hook so a job INSERTed by *another* path (the rust-work-service Phase 5 endpoint) can be observed without going through `submit(...)`.

Reuses the same WS singleton subscription + 5-min safety-net poll path as `submitAndWait`, so concurrent Phase 5 + queue-mode + direct-fire jobs all share one subscription. Bootstrap fetch of the job row gives the caller the row's current state and short-circuits when the agent already finished mid-handshake.

## Files

### Created
- [supabase/migrations/277_phase5_audit_log_lifecycle.sql](../../../supabase/migrations/277_phase5_audit_log_lifecycle.sql)
- [rust-work-service/src/api/routes/sap_mutations.rs](../../../rust-work-service/src/api/routes/sap_mutations.rs)
- [src/lib/work-service/sap-mutations-client.ts](../../../src/lib/work-service/sap-mutations-client.ts)
- `memorybank/OmniFrame/Implementations/Implement-Rust-Work-Service-Phase5.md` (this note)

### Modified
- [rust-work-service/src/api/error.rs](../../../rust-work-service/src/api/error.rs) — `ApiError::TooManyRequests { message, retry_after_secs }` variant + matching `IntoResponse` impl with `Retry-After` header.
- [rust-work-service/src/api/routes/mod.rs](../../../rust-work-service/src/api/routes/mod.rs) — `pub mod sap_mutations;` + `pub use sap_mutations::sap_mutations_routes;`.
- [rust-work-service/src/main.rs](../../../rust-work-service/src/main.rs) — import + `.nest("/api/v1/sap-mutations", sap_mutations_routes())`, doc-block updated.
- [rust-work-service/src/sap_jobs_listener.rs](../../../rust-work-service/src/sap_jobs_listener.rs) — `patch_audit_row_on_terminal()` side-effect + `is_terminal_status()` helper + 2 unit tests.
- [src/features/admin/sap-testing/components/inventory-management-tab.tsx](../../../src/features/admin/sap-testing/components/inventory-management-tab.tsx) — Phase 5 route swap on `runMutation` + batch flow + Phase 5 helpers + import for the new client.
- [src/features/admin/sap-testing/hooks/use-job-queue.ts](../../../src/features/admin/sap-testing/hooks/use-job-queue.ts) — `waitForJob(jobId, opts?)` exposed on the hook.

## Quality gates

| Gate | Result |
| --- | --- |
| Migration 277 applied via Supabase MCP `apply_migration` | ✅ |
| `cargo build` (rust-work-service) | ✅ clean. Only pre-existing warnings (sqlx 0.7 future-incompat, observability/middleware unused fns). |
| `cargo test --lib` (rust-work-service) | ✅ 51/51 passed (+20 new — 18 in sap_mutations, 2 in sap_jobs_listener; pre-existing was 31). |
| `cargo clippy --all-targets` | ✅ no NEW warnings on the touched modules (sap_mutations, sap_jobs_listener, api/error.rs). All pre-existing. |
| `pnpm tsc -b --noEmit` | ✅ clean (~18s). |
| `pnpm build` | ✅ clean. `feature-admin-sap` chunk: 419.21 → 423.41 KB (+4 KB), well under 500 KB budget. |
| `npx eslint` on touched FE files | ✅ 0 errors, 1 pre-existing warning on line 954 of inventory-management-tab.tsx (unrelated to Phase 5). |
| `node scripts/lint-ratchet.mjs` | ⚠️ pre-existing baseline drift (94 warnings vs 16 baseline; 168 suppressions vs 127). Verified by stashing my changes — the drift exists at HEAD before Phase 5 (94/167). My delta: 0 warnings + 1 suppression (necessary for the supabase typed-overload bypass in `useJobQueue.waitForJob`). NOT introduced by Phase 5. |

## New unit-test inventory

18 new tests in `rust-work-service/src/api/routes/sap_mutations.rs::tests`:

- Lock + rate-limit key formatters (3): `material_lock_key_is_namespaced`, `rate_limit_key_is_namespaced`, `material_lock_key_is_unique_per_org_and_material`.
- Role gate (5): accepts admin / superadmin / sap_mutator / service; rejects viewer + missing role.
- Endpoint whitelist (2): accepts known paths, rejects arbitrary paths.
- Material-id validation (2): empty / oversized vs normal IDs.
- Rate-limit threshold semantics (2): at-budget not exceeded; above-budget exceeded.
- Body parsing (3): default-fill, full shape, null field value.

2 new tests in `rust-work-service/src/sap_jobs_listener.rs::tests`:

- `terminal_filter_accepts_canonical_terminal_states` — completed / failed / canceled.
- `terminal_filter_rejects_non_terminal_states` — queued / running / cancelled (typo defence) / Capitalized / empty.

**Why pure-logic only**: existing `rust-work-service/src/...` tests are all pure-logic (no live Redis or Postgres); adding an integration harness for Phase 5 alone wasn't scoped. The covered surface — key formatters, role gate, endpoint whitelist, threshold predicates, terminal-filter semantics — is exactly the security-critical logic the route hinges on. Live Redis/Postgres behaviour is exercised by the existing `tests/integration/**` Vitest suite via the FE callsite.

## FE mutation buttons rerouted

Two Material Master mutations on the **Inventory Management** tab:

| Query id | Endpoint | Rerouted? |
| --- | --- | --- |
| `mm02-material-master-bin` | `/sap/material-master-bin` | ✅ Phase 5 |
| `mm02-material-master-storage-types` | `/sap/material-master-storage-types` | ✅ Phase 5 |

Other Inventory Management mutations (`/sap/transfer-inventory`, `/sap/bin-blocks`, `/sap/create-storage-bin`, `/sap/confirm-to`, `/sap/process-shipment`) keep the existing `agentFetch(...)` / queue-mode flow unchanged — Phase 5 is intentionally narrow to the Material Master surface (highest blast radius, lowest UX impact from the lock/rate-limit guard). A future phase can extend the same defensive pipeline to those endpoints by adding to `ALLOWED_MUTATION_ENDPOINTS` + adding a sibling FE wrapper.

## Endpoint contract

```
POST /api/v1/sap-mutations/material-master
Authorization: Bearer <jwt>
Idempotency-Key: <uuid>
Content-Type: application/json

{
  "material": "AS16446",
  "plant": "PL08",
  "warehouse": "WH8",                  // optional
  "storage_type": "826",               // optional
  "fields": {                           // null = clear (MM02 semantics)
    "storage_bin": "SX-29-EN"
  },
  "endpoint": "/sap/material-master-bin",       // optional, defaults
  "transaction_code": "MM02",                   // optional, defaults
  "action": "material_master_bin",              // optional, defaults
  "prev_state": { "storage_bin": "OLD-BIN" },   // optional dry-run snapshot
  "assigned_agent_id": "<uuid|null>"            // optional pin
}

200 OK { "ok": true, "job_id": "<uuid>", "audit_log_id": "<uuid>" }
400 BadRequest          — material empty / >64 chars / endpoint not in whitelist
403 Forbidden           — role gate (not admin / superadmin / sap_mutator / service)
409 Conflict            — material lock already held in this org
429 TooManyRequests     — per-org budget exceeded; Retry-After header set
500 Internal            — DB error (audit row INSERT or job INSERT failed)
503 ServiceUnavailable  — Redis pool unavailable (lock / rate-limit step)
```

## Operations

### Inspect lock state

```bash
redis-cli KEYS 'presence:lock:material:*'
redis-cli GET 'presence:lock:material:<org_id>:<material_id>'      # returns user_id holding the lock
redis-cli TTL 'presence:lock:material:<org_id>:<material_id>'      # remaining seconds
redis-cli DEL 'presence:lock:material:<org_id>:<material_id>'      # emergency release
```

### Inspect rate-limit state

```bash
redis-cli KEYS 'ratelimit:sap-mutations:*'
redis-cli GET  'ratelimit:sap-mutations:<org_id>'                  # current count in window
redis-cli TTL  'ratelimit:sap-mutations:<org_id>'                  # remaining seconds
```

### Audit row lifecycle (canonical SQL)

```sql
-- See what's in flight from Phase 5 right now:
SELECT id, action, status, created_at, job_id
  FROM public.sap_audit_log
 WHERE status = 'pending'
   AND organization_id = '<org_id>'
 ORDER BY created_at DESC;

-- Verify the listener's terminal-state patch landed:
SELECT a.id AS audit_id, a.status AS audit_status,
       j.id AS job_id, j.status AS job_status, j.completed_at
  FROM public.sap_audit_log a
  LEFT JOIN public.sap_agent_jobs j ON j.id = a.job_id
 WHERE a.action = 'material-master-update'
   AND a.organization_id = '<org_id>'
 ORDER BY a.created_at DESC
 LIMIT 50;
```

The audit `status` should track the job `status` 1:1 within milliseconds of the listener tick.

## Open follow-ups

- **Extend whitelist** — add `/sap/transfer-inventory` + `/sap/bin-blocks` to `ALLOWED_MUTATION_ENDPOINTS` once the agent surface stabilises. Same defensive pipeline, just more endpoints. New tests + a new sibling FE wrapper.
- **`sap_mutator` role** — seed it in `public.roles` if/when fine-grained RBAC lands; the route already accepts the literal.
- **Lock duration tuning** — 5min is a conservative ceiling. If real-world MM02 mutations consistently complete in <60s, tighten `MATERIAL_LOCK_TTL_SECONDS` to 90s so legitimate retries aren't blocked.
- **Audit display** — the Phase 3 Recent Jobs card already surfaces job lifecycle; a future iteration could add a per-mutation "audit row id" column so admins can copy-paste the audit_log_id into the SQL above for forensic trace.
- **Unify FE audit logging** — once Phase 5 is the dominant write path, the legacy FE `logSapAudit(...)` callsites in `recorder-panel.tsx` / `agent-health-card.tsx` / `reversal-panel.tsx` could route through a sibling rust-work-service endpoint so `sap_audit_log` writes are server-attested universally. Out of scope for Phase 5.

## Related

- [[plans/rust_work_service_full_integration_5b88165d.plan]] — comprehensive plan
- [[Implement-Rust-Work-Service-Phase0-Phase1]] — pre-flight diagnostics + free-wins
- [[Implement-Rust-Work-Service-Phase2]] — telemetry foundation
- [[Implement-Rust-Work-Service-Phase3]] — fleet snapshot + Recent Jobs card (Phase 5 reuses the same `useJobQueue` plumbing)
- [[Implement-Rust-Work-Service-Phase4]] — agent on Rust WS (`SapJobStatusChanged` push that drives `useJobQueue.waitForJob`)
- [[ADR-Rust-Work-Service-Availability-SLO]] — the SLO this defence-in-depth pipeline helps meet
- [[Roadmap-Rust-WS-Unlocks]] — the seed planning doc
- [[Server-Side-Presence-Redis-HSET]] — sibling pattern for the `presence:lock:material:*` namespace
- [[Components/Omni-Agent - Headless SAP Agent]] — agent component note
