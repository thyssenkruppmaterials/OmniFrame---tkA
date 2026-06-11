---
tags: [type/context, domain/agent, domain/database, status/active]
created: 2026-05-28
---

# Incident-Signature Baseline — 2026-05-28 (7-day window)

Before-state for the Phase 10 rescore success criteria (zero phantom re-executions,
zero permanently-stuck rows during the post-deploy soak).

Query window: `now() - interval '7 days'` on `sap_agent_jobs`.

| Signature | Count | Notes |
|-----------|-------|-------|
| Phantom re-execution (`claim_count > 1`) | **0** | No double-claims in the last 7d (mig 291 holding). |
| Stuck rows (`queued`/`running` > 30 min) | **1** | One currently-stuck row — investigate as OA-18 reaper candidate. |
| Latched on offline agent (`assigned_agent_id` → `sap_agents.status='offline'`) | **0** | OA-02 release path has nothing to reclaim right now. |

## 7-day status distribution

- `completed`: 741
- `failed`: 40
- (failure rate ≈ 5.1%)

## Railway service_metrics (rust-work-service + onebox-ai-logistics, 24h)

TODO — capture via `mcp__railway-mcp-server__service_metrics` when the orchestrator
proceeds to the production-affecting phases (deferred with the rest of the soak/metric work).
