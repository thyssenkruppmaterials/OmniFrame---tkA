---
tags: [type/component, status/active, domain/frontend, domain/backend]
created: 2026-04-29
---
# Agents Fleet Manager (Phase D #13)

## Purpose / Context
Manages and surfaces the fleet of OmniFrame on-prem agents (one per Citrix session per warehouse) so the dashboard shows who's online, what they're working on, and which agent picks up which job.

Without this, multiple agents on different Citrix boxes could all claim from the same org queue, but ops had no visibility into who got which job, and there was no way to pin a job to a specific agent (e.g. "this LT12 sweep must run on the Reno box because that's the only one connected to the Reno SAP system").

## Architecture

```
┌─────────────────┐      heartbeat 30s        ┌──────────────────────┐
│  on-prem agent  │ ─────upsert────▶          │  public.sap_agents   │
│  (Citrix #N)    │                            │  (online registry)   │
└────────┬────────┘                            └──────┬───────────────┘
         │                                            │
         │  bump_sap_agent_job_lease                  │  Realtime UPDATE
         │  (every 30s for current job)               │
         ▼                                            ▼
┌─────────────────┐    pin: assigned_agent_id  ┌──────────────────────┐
│ sap_agent_jobs  │ ◀─────────────────────────▶│  AgentsFleetCard     │
│  (queue)        │                            │  (browser, top of    │
└─────────────────┘                            │   Inventory tab)     │
                                               └──────────────────────┘
```

## Pieces

### Database (`supabase/migrations/247_extend_sap_agents_and_jobs.sql`)
- `public.sap_agents` — heartbeat registry (id TEXT PK = `<COMPUTERNAME>-<SESSIONNAME>-<PID>`).
- `claim_sap_agent_job(p_organization_id, p_agent_id, p_lease_seconds)` — pin-aware + lease-aware claim RPC.
- `bump_sap_agent_job_lease(p_job_id, p_agent_id, p_lease_seconds)` — heartbeat-side lease extension.
- `reap_stale_sap_agents(p_grace_seconds)` — background reaper called opportunistically.
- New columns on `sap_agent_jobs`: `assigned_agent_id`, `claim_lease_until`, `claim_count`.

### Agent (`omni_agent/agent.py`)
- `_agent_self_id()` — stable id from hostname + Citrix session + PID.
- `_start_heartbeat_thread()` — 30s loop: upsert sap_agents row + bump current job lease + reap stragglers.
- `GET /agents`, `GET /agents/{id}` — read-only proxies onto `sap_agents` (token-exempt).
- Job poller tracks `_job_poller_state["current_job_id"]` so heartbeat knows what to bump.
- Shutdown handler upserts `status='offline'` for immediate dashboard reflection.

### Frontend
- `src/features/admin/sap-testing/components/agents-fleet-card.tsx`
  - `<AgentsFleetCard />` — collapsible card. Lists agents with status pill, hostname, Citrix session, version, SAP system/client/user, current_action, transactions/hour, last-seen relative, capability count. Realtime-subscribed.
  - `useOnlineSapAgents()` hook — returns `status='online'` rows for the BatchModePanel pin picker.
- `src/features/admin/sap-testing/components/inventory-management-tab.tsx` — mounts the card, manages `pinnedAgentId` state, threads it into BatchModePanel + queue-mode submit.
- `src/features/admin/sap-testing/hooks/use-job-queue.ts` — `SubmitJobInput.assignedAgentId` field.

## Operational notes
- **Stuck-job detector**: any `sap_agent_jobs` row with `claim_count > 1` was re-claimed after a lease expiry — surface this in dashboards as "previously stuck, recovered". (Not yet wired into the UI; trivial follow-up.)
- **Pinned with no online target**: row stays queued; the polling fallback on the right agent picks it up when it comes online.
- **Two agents same SAP user**: still safe (`FOR UPDATE SKIP LOCKED`), but the dashboard shows both — operators should consolidate.
- **id format change**: pre-Phase D #13 agents wrote `claimed_by = COMPUTERNAME-PID`; post-Phase D #13 use `COMPUTERNAME-SESSIONNAME-PID`. Old rows still get reaped/cleaned naturally as they complete.

## Capabilities published
- `agents-fleet`
- `job-claim-lease`

## Related
- [[Implementations/Implement-Multi-Agent-Coordination]]
- [[Implementations/Implement-Agent-Direct-Realtime]]
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Components/Inventory-Management - SAP Query Framework]]
