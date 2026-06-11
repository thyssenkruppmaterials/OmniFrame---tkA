---
tags: [type/debug, status/active, domain/backend, domain/database, domain/infra]
created: 2026-05-09
---
# Fix — LT10 Phantom Re-Claims (sap_agent_jobs runaway)

## Symptom

User tested the new fleet-routing toggle (`useExecutionMode`) on **SAP Testing → Inventory Management** by clicking Run on an LT10 query with `{material:'*', warehouse:'WH5', storage_type:'*'}` (every bin × every material in WH5). They observed **the agent execute LT10 in SAP multiple times "without me initiating it"** over the next ~45 minutes.

DB evidence at the moment of investigation (org `c9d89a74…`, job `badbc9fe-ba7f-41f3-91b8-a72e71634808`):

| col | value |
|---|---|
| `endpoint` | `/sap/query` |
| `payload.handler` | `lt10` |
| `status` | `running` |
| `max_attempts` | **1** |
| `attempts` | **18** |
| `claim_count` | **18** |
| `created_at` | 18:18:23 |
| last `claimed_at` | 19:02:18 (44 min later) |
| `claim_lease_until` | 19:04:21 (90s lease, rolling) |

One user click → one DB row → **18 SAP-side executions**.

## Hypothesis ranking (per the investigation playbook)

| # | Hypothesis | Verdict |
|---|---|---|
| 1 | FE useEffect re-fires `dispatch()` on every render | **REJECTED** — exactly one row in the DB; only `claim_count` cycled. |
| 2 | Misconfigured `agent_triggers` rule for LT10 | **REJECTED** — only two enabled rules exist on the org (`/sap/lt12` for picks, `/sap/confirm-to` for putaways). No LT10 trigger. |
| 3 | Migration 289 backfill loop accidentally requeueing LT10 | **REJECTED** — function joins through `agent_triggers.source_table = 'rf_putaway_operations'` AND keys idempotency by `'trig:<trigger_id>:<row_id>:%'`. The LT10 row's idempotency key was a plain UUID, can't match. |
| 4 | **Stuck-job watchdog re-claim cycle** | **CONFIRMED — root cause.** |
| 5 | Idempotency-key collision masking re-INSERTs | **REJECTED** — only one row exists; FE generates fresh `crypto.randomUUID()` per dispatch. |
| 6 | Tab-focus polling (TanStack Query / health probes) re-firing | **REJECTED** — would have produced multiple rows. |

## Root cause

**`public.claim_sap_agent_job(...)` (migration 247) had no `attempts < max_attempts` guard on its lease-expiry branch.** The original predicate was:

```sql
WHERE status = 'queued'
   OR (status = 'running'
       AND COALESCE(claim_lease_until, claimed_at + interval '5 minutes') < now())
```

So `max_attempts` was advisory — any `running` row whose lease lapsed was eligible for re-claim no matter how many attempts had already burned.

Proximate trigger: the agent's `POST /api/v1/sap-agents/jobs/claim` call requests a **90s lease** by default (`DEFAULT_LEASE_SECONDS = 90` in `rust-work-service/src/api/routes/sap_agents.rs`). `handler_lt10` against a fully-stocked WH5 with `material='*'` takes many minutes — the SAP COM call blocks the heartbeat thread, the lease lapses, the agent's own 5s claim poller picks the SAME row up again, and SAP fires LT10 again. Repeat forever.

One-line statement: **the lease watchdog enabled re-claim of running rows whose `attempts >= max_attempts`, so `max_attempts=1` plus a long-running handler produced a runaway `(claim → SAP → lease expiry → re-claim)` cycle on a single user click**.

## Fix — migration 291

`supabase/migrations/291_claim_sap_agent_job_enforces_max_attempts.sql` patches `claim_sap_agent_job` (same signature, same return type) so:

1. **Pass 1 (zombie sweep)**: every claim call first auto-fails any `running` row in the caller's org whose lease has lapsed AND whose `attempts >= max_attempts`, with `step='watchdog_max_attempts'` and a descriptive error breadcrumb.
2. **Pass 2 (claim)**: the eligibility predicate now additionally gates the running-branch on `COALESCE(attempts, 0) < COALESCE(max_attempts, 1)` so over-attempted rows can never be re-picked.
3. **One-time migration cleanup**: terminates any rows already in the runaway state at apply time so the user gets immediate relief without waiting for the next claim cycle.

Verified post-deploy:
- `badbc9fe…`: `status='failed', step='watchdog_max_attempts', completed_at=19:10:13`, error breadcrumb landed.
- New LT10 the user fired during deploy (`d80b3652…`): also failed cleanly after 1 attempt with the same breadcrumb.
- Globally: zero `status='running' AND lease expired AND attempts >= max_attempts` rows.

## Files modified

- `supabase/migrations/291_claim_sap_agent_job_enforces_max_attempts.sql` (new)

Nothing else. The bug was purely in the SQL claim function. The agent (no version change), `rust-work-service` (no route change), and the FE (`useExecutionMode().dispatch()` is correct: single INSERT, fresh idempotency key, valid params) are all unchanged.

## Open follow-ups

These all surface as a SEPARATE bug now that the root cause is fixed — the user's primary complaint is resolved, but legitimate big queries still fail instantly because the **90s lease + `max_attempts=1` default is too tight for any handler that legitimately takes >90s of SAP wall-clock**:

1. **Per-handler lease budgeting**. The agent (or `useExecutionMode().dispatch()`) should pass a `lease_seconds` proportional to the handler's expected duration. LT10 with `*` filters: 600s. ZMM60 lookups: 60s. Mutations (LT01, MM02, LS02N): 120s. Today everything uses the same 90s default.
2. **Heartbeat-during-COM**. `omni_agent.handler_lt10` runs the SAP COM call on the main thread, blocking the heartbeat thread (Python GIL + COM single-threaded apartment). Refactor either (a) heartbeat fires from a `bump_sap_agent_job_lease` worker that runs a small SQL query on a separate thread independent of COM, or (b) the SAP call is wrapped in a yielding pattern that lets the heartbeat slot in.
3. **`max_attempts` per-dispatch override**. `useExecutionMode().dispatch()` could accept a `maxAttempts` option that flows through `useJobQueue.submitAndWait` → `submit` → `sap_agent_jobs.max_attempts`. Today everything defaults to 1 (see `use-job-queue.ts:295`). Bumping reads to 2-3 would let a transient SAP hiccup self-recover without surfacing as failed.
4. **FE UX on watchdog-failed**. Surface `step='watchdog_max_attempts'` distinctly from generic `status='failed'` in `inventory-management-tab.tsx` — the right CTA for this case is "the agent is healthy but the query was too big for the current lease budget; try narrowing the filter or open a follow-up to extend the lease".

The same root cause shape applies to **every** `/sap/query` handler (MB52, MMBE, LT24) and every long-running mutation. Priority for the follow-up is the lease-budgeting one — it's the upstream cause of the secondary failure mode.

## Related

- [[Components/Rust-Work-Service]]
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Implementations/Implement-Inventory-Management-Fleet-Routing]]
- [[Decisions/ADR-Trigger-DSL-Evaluator-Phase9]]
- [[Sessions/2026-05-09]]
