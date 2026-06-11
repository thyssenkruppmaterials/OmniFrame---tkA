---
tags: [type/implementation, status/active, domain/backend, domain/database, domain/frontend]
created: 2026-04-29
---
# SAP Agent Job Queue Architecture

## Purpose / Context
Persistent, org-scoped job queue that decouples the browser from the on-prem SAP agent. Phase A1 of the Tier-1 platform-improvement plan. Lets long batches survive page reloads, serialises SAP work (which is single-threaded per session), and unblocks future multi-agent fan-out.

## Schema (migration 245)
- `public.sap_agent_jobs`
  - `id` UUID, `organization_id` (FK organizations), `requested_by` (FK user_profiles)
  - `endpoint` TEXT (e.g. `/sap/material-master-bin`)
  - `payload` JSONB
  - `status` TEXT CHECK queued/running/completed/failed/canceled
  - `claimed_by`, `claimed_at`, `attempts`, `max_attempts`, `priority`
  - `result` JSONB, `error`, `step`
  - `idempotency_key` UNIQUE per (org, key)
  - `created_at`, `started_at`, `completed_at`, `heartbeat_at`
- RLS: org-scoped via `user_profiles.organization_id = auth.uid()` lookup
- Realtime: added to `supabase_realtime` publication, `REPLICA IDENTITY FULL`
- Atomic claim function: `public.claim_sap_agent_job(p_organization_id, p_claimed_by)` — uses `FOR UPDATE SKIP LOCKED` so multiple agents racing on the same org never claim the same row

## Agent endpoints (omni_agent/agent.py)
- `POST /jobs/claim` — calls the SQL function via RPC; returns `{ok, job}` or `{ok, job: null}`
- `POST /jobs/{id}/complete` — PATCHes status=completed + result
- `POST /jobs/{id}/fail` — PATCHes status=failed + error/step
- `POST /jobs/{id}/heartbeat` — bumps heartbeat_at
- Background poller thread (started in `@app.on_event("startup")`) polls every 5s when `state.sap_connected && supabase_token && org_id`. Dispatches via `app.routes` lookup so we don't have to import each handler symbol.

## Frontend
- `src/features/admin/sap-testing/hooks/use-job-queue.ts` — `useJobQueue()` hook with `submit()` / `submitAndWait()` and per-job Realtime channels.
- `BatchModePanel` "Run via Queue" toggle — persists to `localStorage['omniframe.batch_queue_mode.v1']`. Disabled when the agent doesn't report the `jobs-queue` capability (Phase B8).
- `Agent Triggers` runtime: per-trigger `useQueue` flag routes the realtime fire through `sap_agent_jobs` instead of direct fetch (poll-then-terminal pattern).

## File paths edited
- `omni_agent/agent.py` — endpoints, poller, capability id
- `src/features/admin/sap-testing/hooks/use-job-queue.ts` — new
- `src/features/admin/sap-testing/lib/agent-fetch.ts` — new (X-Agent-Token + capability helpers)
- `src/features/admin/sap-testing/components/inventory-management-tab.tsx` — BatchModePanel queue toggle, runBatch routing
- `src/features/admin/sap-testing/hooks/use-agent-trigger-runtime.ts` — `useQueue` flag propagation
- `supabase/migrations/245_create_sap_agent_jobs.sql`

## Edge cases
- **Two agents same org**: SQL `FOR UPDATE SKIP LOCKED` keeps claim atomic.
- **Idempotency**: clients can pass `idempotency_key` to dedupe retries; UNIQUE constraint enforces.
- **Agent offline**: poller sleeps 5s, retries forever. Queue rows pile up safely.
- **Browser closes during run**: queue row keeps progressing; user's subscription drops but the row reaches terminal state. On revisit, the row's status is visible via `useJobQueue.watchedJobs` if resubscribed.

## Related
- [[Implementations/SAP-Audit-Trail]]
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Patterns/Agent-Capability-Negotiation]]
