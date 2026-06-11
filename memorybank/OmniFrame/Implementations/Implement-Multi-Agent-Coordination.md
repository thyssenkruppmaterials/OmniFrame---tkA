---
tags: [type/implementation, status/completed, domain/backend, domain/database, domain/frontend]
created: 2026-04-29
completed: 2026-04-29
---
# Implement: Multi-Agent Coordination (Phase D #13) — COMPLETED

## Purpose / Context
Today one agent per Citrix session runs the show. With several warehouses each on their own session, work is bottlenecked: the Indianapolis user can't help the Reno queue. The job queue (Phase A1) already provides the foundation — multiple agents can call `claim_sap_agent_job` against the same org and `FOR UPDATE SKIP LOCKED` keeps claims atomic.

This note now documents the **shipped** implementation: a fleet registry, lease-aware job pinning, and a fleet card on the Inventory Management page.

## Implementation summary
**Migration `247_extend_sap_agents_and_jobs.sql`** (applied via Supabase MCP to project `wncpqxwmbxjgxvrpcake`):
- Adds `assigned_agent_id TEXT`, `claim_lease_until TIMESTAMPTZ`, `claim_count INTEGER` columns to `sap_agent_jobs`.
- New table `public.sap_agents` (id TEXT PK = `<COMPUTERNAME>-<SESSIONNAME>-<PID>`, organization_id, hostname, citrix_session, version, sap_system/client/user, capabilities JSONB, status enum {online,offline,draining}, current_action JSONB, last_seen_at). RLS scoped to org. REPLICA IDENTITY FULL + supabase_realtime publication so the browser-side fleet card sees state flips immediately.
- Replaced 2-arg `claim_sap_agent_job(org, claimed_by)` with lease-aware 3-arg `claim_sap_agent_job(p_organization_id, p_agent_id, p_lease_seconds DEFAULT 300)` that:
  - Honours `assigned_agent_id` pinning (NULL = any agent in the org may claim).
  - Sets `claim_lease_until = now() + p_lease_seconds`, increments `claim_count`.
  - Recovers stale claims via `(status='running' AND claim_lease_until < now())` so a healthy agent can re-claim a job whose original owner crashed.
- New `bump_sap_agent_job_lease(p_job_id, p_agent_id, p_lease_seconds)` — agent calls this every 30s for the row it's currently running.
- New `reap_stale_sap_agents(p_grace_seconds DEFAULT 90)` — flips agents to status='offline' when their last heartbeat ages past grace.

**Agent (`omni_agent/agent.py`)**:
- Stable `_agent_self_id()` cached at module load: `<COMPUTERNAME>-<SESSIONNAME>-<PID>`.
- `_start_heartbeat_thread()` — 30s loop that:
  - Upserts our `sap_agents` row with version, capabilities, current SAP session info, current_action (current running job_id), and `last_seen_at = now()`.
  - Calls `bump_sap_agent_job_lease(...)` for the currently-running job (if any).
  - Calls `reap_stale_sap_agents(...)` opportunistically.
- `jobs_claim()` updated to call the new 3-arg RPC with `p_agent_id = _agent_self_id()`.
- Job poller now tracks `_job_poller_state["current_job_id"]` so the heartbeat thread knows what to bump.
- New endpoints (token-exempt — read-only):
  - `GET /agents` — proxies to `public.sap_agents` (descending by `last_seen_at`), reaps stragglers first, returns realtime connection state.
  - `GET /agents/{agent_id}` — single-agent detail.
- Shutdown handler upserts `status='offline'` so the dashboard reflects departure immediately.
- Heartbeat (re)started after `/supabase/login` so the user sees the agent online without waiting 30s.

**Frontend**:
- New `src/features/admin/sap-testing/components/agents-fleet-card.tsx`:
  - `<AgentsFleetCard />` — collapsible card mounted under `<AgentHealthCard />` in Inventory Management. Lists every registered agent with hostname pill, status, version, SAP session info, current job, transactions/hour, last-seen relative, capability count. Realtime-subscribed to UPDATEs on `sap_agents`.
  - `useOnlineSapAgents()` hook — returns only `status='online'` rows for the BatchModePanel pin picker.
- `src/features/admin/sap-testing/hooks/use-job-queue.ts` — `SubmitJobInput` extended with `assignedAgentId?: string | null`; `submit()` writes it to the new column.
- `src/features/admin/sap-testing/components/inventory-management-tab.tsx`:
  - New `pinnedAgentId` state (persisted to `sap.testing.pinned-agent-id` localStorage).
  - `BatchModePanel` accepts `pinnedAgentId` + `onPinnedAgentIdChange` + `onlineAgents`; renders a "Pin to agent" `<select>` next to the queue-mode toggle. Hidden unless queue mode is on AND there's at least one online agent.
  - Queue-mode submit now passes `assignedAgentId: pinnedAgentId` so pinned batches only run on the chosen agent.

## Edge cases handled
- **Agent dies mid-job**: lease (5min default) expires → another agent calling `claim_sap_agent_job` re-claims the row. `claim_count > 1` flags it for the dashboard's stuck-job warning.
- **Agent dies without /shutdown**: `last_seen_at` ages past 90s → `reap_stale_sap_agents()` flips status='offline'. Card shows the offline pill.
- **Pinned job with no online target agent**: row stays `queued`; the polling fallback on the right agent picks it up when it comes online.
- **Two agents same SAP user**: still safe via SKIP LOCKED.

## Files
- `supabase/migrations/247_extend_sap_agents_and_jobs.sql`
- `omni_agent/agent.py` (claim RPC call, heartbeat thread, /agents endpoints, current_job_id tracking)
- `src/features/admin/sap-testing/components/agents-fleet-card.tsx` (new)
- `src/features/admin/sap-testing/components/inventory-management-tab.tsx` (mounts card; adds pin picker)
- `src/features/admin/sap-testing/hooks/use-job-queue.ts` (assignedAgentId pass-through)

## Capabilities (handoff to foreground for /health)
- `agents-fleet`
- `job-claim-lease`

## Related
- [[Implementations/Implement-Agent-Direct-Realtime]]
- [[Implementations/Implement-Scheduled-Recurring-Jobs]]
- [[Components/Agents-Fleet-Manager]]
- [[Patterns/Agent-Capability-Negotiation]]
