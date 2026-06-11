---
tags: [type/implementation, domain/agent, domain/database, domain/realtime, status/active]
created: 2026-05-28
---

# Omni Agent Remediation — Phase 00 Claim Verification

Verification of the 5 load-bearing claims in the remediation plan
(`omni_agent_latency_robustness_remediation_20260528_b7f2e9c4.plan.md`) against the
**LIVE** Supabase schema (`wncpqxwmbxjgxvrpcake`) and the current `main` code,
performed 2026-05-28. Break-glass tag: `pre-omni-agent-remediation-2026-05-28`
(HEAD `64b6252` "feat(rf-interface): redesign RF interface…").

## Result: all 5 claims CONFIRMED

| # | Claim | Result | Live evidence |
|---|-------|--------|---------------|
| 1 | `claim_sap_agent_job` honors `assigned_agent_id` + auto-pins; deployed body == migration 291 | **CONFIRMED** | `pg_get_functiondef` of the deployed function is byte-equivalent to mig 291: Pass-1 max-attempts zombie sweep (`status='failed', step='watchdog_max_attempts'` where lease expired AND `attempts >= max_attempts`), Pass-2 claim with predicate `(assigned_agent_id IS NULL OR assigned_agent_id = p_agent_id)` and `attempts < max_attempts` running-branch guard, first-claim `assigned_agent_id = COALESCE(assigned_agent_id, p_agent_id)`. |
| 2 | `sap_agents` has no SAP-GUI-session columns | **CONFIRMED** | Live column list: `capabilities, citrix_session, current_action, display_name, hostname, id, last_seen_at, organization_id, process_started_at, registered_at, sap_client, sap_system, sap_user, status, transactions_per_hour, version`. No `conn_idx`/`sess_idx`/`session_index`/`pinned_session`. **Feature 1 needs a NEW table.** |
| 3 | Trigger evaluator enqueues UNPINNED | **CONFIRMED** | `rust-work-service/src/triggers/evaluator.rs:340-351` INSERT column list is `(organization_id, endpoint, payload, priority, status, idempotency_key)` VALUES `($1,$2,$3,50,'queued',$4)`. `assigned_agent_id` is **absent** → Feature 2 must add it + a source. |
| 4 | Browser `/ws` client is token-less | **CONFIRMED** | `src/lib/work-service/websocket.ts`: `connect(organizationId, onEvent)` (no token param); `WS_URL = …/ws` (no token); the `Subscribe` upgrade message sends only `{ type:'Subscribe', organization_id }`. **OA-04 hard ordering constraint stands: browser must mint a ws-token BEFORE the auth flip.** |
| 5 | Hung COM call wedges agent / commit-before-complete double-exec window | **CONFIRMED (sharpened)** | `agent.py:5356` `result = _dispatch_job(job)` runs **inline** on the poller thread (no executor) → a hang freezes queue draining (liveness loss). `jobs_complete`/`jobs_fail` run AFTER dispatch returns; the `finally` (`:5395`) clears `state.active_job_id`. The claim gate keys on the watchdog-clearable `active_job_id`, so the commit→complete window + cross-agent re-claim after watchdog release is the real double-execution risk. |

## anon EXECUTE audit (OA-04c)

`claim_sap_agent_job`, `bump_sap_agent_job_lease`, `reap_stale_sap_agents` all have
`anon` AND `authenticated` EXECUTE = **true**. OA-04c (revoke anon EXECUTE) is valid and required.

## `sap_agent_jobs` columns (OA-02 / OA-05 / F2 prerequisites)

`assigned_agent_id, attempts, claim_count, claim_lease_until, claimed_at, claimed_by,
completed_at, created_at, endpoint, error, heartbeat_at, id, idempotency_key, max_attempts,
organization_id, payload, priority, requested_by, result, started_at, status, step`.

- **No `pin_source` column** → OA-02 must add it (default `'latched'`, backfill before enabling the release branch).
- `step` exists → OA-05 resume-from-step is viable.
- `claimed_by` exists → F2-A reversal attribution via `sap_audit_log.job_id → sap_agent_jobs.claimed_by` is viable.

## Security advisor baseline (2026-05-28)

21 ERROR, 540 WARN. Plan-relevant: `anon_security_definer_function_executable` ×215,
`authenticated_security_definer_function_executable` ×221 (includes the 3 claim/lease/reap RPCs),
`rls_policy_always_true` ×19, `rls_references_user_metadata` ×17 (OA-22 targets).
Full snapshot: `advisors-security-baseline.md` (this folder).

## Conclusion

No plan correction required — every register entry matched the live system. The plan may
proceed as written. Migration 331 (`331_confirm_to_jobs_max_attempts.sql`, the
`set_confirm_to_max_attempts` BEFORE INSERT trigger) is present and untracked on `main`;
per F1-B it must be left intact by any future claim-function `CREATE OR REPLACE`.
