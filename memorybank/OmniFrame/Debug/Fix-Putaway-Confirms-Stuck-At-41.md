---
tags: [type/debug, status/active, domain/backend, domain/database, domain/agent]
created: 2026-05-20
---
# Fix: Putaway Confirms Stuck At 41 (Auto-Recovery Dead-End + Silent Patch Skip)

## Purpose / Context

User flagged the FE Pending Confirms card showing **41 stuck (oldest 1371 min)
— auto-recovery runs every 5 min** on the Putaway Log Search panel for org
`c9d89a74-7179-4033-93ea-56267cf42a17`. The auto-recovery loop from
[[Implement-Putaway-Confirm-Backfill-Loop]] (migration 289) was running
every 5 minutes per cron but every cycle returned `(0, 0, 1374)` — zero
failed-job requeues, zero orphan replays — while the queue stayed visibly
stuck. Three independent bugs compounded; this note captures the full chain
and the fixes (migrations 321 + 322).

## Diagnosis

### Bug 1 — Backfill claim_count cumulative dead-end

Migration 289's `backfill_pending_putaway_confirms(...)` resets
`attempts = 0` on each requeue cycle so the next claim has a fresh retry
budget, but does **not** reset `claim_count`. Migration 291's
`claim_sap_agent_job(...)` increments BOTH `attempts` and `claim_count`
together on every claim. So `attempts` cycles 0→1→0→1… across backfills,
while `claim_count` accumulates 1→2→3… monotonically.

The backfill's protective WHERE clause is
`COALESCE(j.claim_count, 0) < p_max_claim_count` (default 8). After 7
backfill cycles (≈35 minutes of continuous SAP outage) the row hits the
cap and the backfill silently skips it FOREVER. ~35 min is plenty of time
for an operator's SAPGUI session to be logged out, so this fired in
production the moment the operator's session lapsed for a non-trivial
window.

**Evidence on 2026-05-19/20:** all 41 stuck rows had `sap_agent_jobs.status='failed'`
with `attempts=1, max_attempts=3, claim_count=8`. 40/41 had error
`"No active SAP GUI session found..."` (operator's SAPGUI was off between
15:35–17:06 UTC). 1/41 had a real data error
(`"Entry DC-   does not exist in T300"`). Manual call of
`SELECT public.backfill_pending_putaway_confirms()` returned
`(0, 0, 1374)` — the function was running but doing nothing.

### Bug 2 — Backfill leaves rows pinned to offline agents

After migration 321's first apply rescued the 41 rows back to
`status='queued', claim_count=0`, all 40 of the rescued rows STILL didn't
get claimed. They sat in `assigned_agent_id='USINDPR-CXA103V-Console-U8206556'`
— an agent that went offline at 06:23 UTC (≈8h before the rescue).

`claim_sap_agent_job(...)`'s claim-set predicate is
```sql
(assigned_agent_id IS NULL OR assigned_agent_id = p_agent_id)
```
so the online agent `CXA102V` could not pick the rows up — they were
pinned to a now-offline peer. Migration 289's reset never cleared
`assigned_agent_id`, so the affinity persisted across the bug-1 dead-end
too. Migration 321 was extended to clear `assigned_agent_id = NULL` on
requeue, and the one-shot rescue widened to also unpin currently-queued
rows pinned to an offline agent.

### Bug 3 — Agent silently skips the source-row patch when token is missing

After the unpin landed, the agent (`CXA102V`) drained 40/40 rescued jobs
in minutes — every one returned `"Transfer order 0003684XXX confirmed"`
from SAP. The `sap_agent_jobs` rows transitioned to `status='completed'`
cleanly. But the FE Pending Confirms card was still showing 21 stuck.

Root cause: 21 of the 40 successfully-confirmed-in-SAP rows had
`rf_putaway_operations.confirmed_source IS NULL`. The agent confirmed in
SAP, called rust-work-service `POST /jobs/:id/complete` (which uses
service-key auth and works regardless of operator state), then silently
failed to PATCH back to `rf_putaway_operations` because
`state.supabase_token` was empty — the operator's Supabase session had
expired. Both agent-side patch paths short-circuit on this:

- `omni_agent/agent.py:6827` (`_apply_trigger_post_patch`): `if not state.supabase_token: return` (no log).
- `omni_agent/agent.py:7349` (`_update_putaway_status`): logs a WARN to stdout, returns.

The net effect: TOs genuinely confirmed in SAP, FE showing them as
stuck — a confusing operator experience because the SAP side is fine
and the OmniFrame side never reflects it.

## Fix

### Migration 321 — Backfill resets claim_count + unpins assigned_agent_id

`supabase/migrations/321_backfill_resets_claim_count.sql` — CREATE OR
REPLACE of `public.backfill_pending_putaway_confirms` plus a one-time
rescue. Diff vs migration 289's function body (one CTE, the
`reset_failed` UPDATE):

- **Add** `claim_count = 0` so the cap stops firing as a cumulative
  across-cycles death sentence. The cap stays in place as a per-cycle
  guard.
- **Add** `assigned_agent_id = NULL` so a row pinned to a now-offline
  agent gets re-routed to whichever agent claims next. Safe because
  `claim_sap_agent_job(...)` re-pins via
  `assigned_agent_id = COALESCE(assigned_agent_id, p_agent_id)`.
- **One-time rescue** (DO block at the bottom) processes every failed
  job + every queued job pinned to an offline agent for a still-pending
  putaway candidate row, regardless of cap.

Function signature unchanged. Same returns. The on-demand
`POST /api/v1/sap-agents/backfill-pending-confirms` route in
rust-work-service v0.1.35 keeps working.

### Migration 322 — Server-side post_success_patch trigger + reconcile

`supabase/migrations/322_server_side_trigger_post_success_patch.sql` —
`AFTER UPDATE OF status ON sap_agent_jobs WHEN (NEW.status = 'completed')`
trigger that reads `payload.__omni_trigger_meta.post_success_patch` and
applies the patch directly in SQL with a column allowlist matching
the agent's at `omni_agent/agent.py:6884` (`confirmed_source`,
`confirmed_by_label`, `confirmed_by_agent_id`). Also flips
`to_status='Completed' → 'TO Confirmed'` and sets `confirmed_at = now()`
so the FE filter (`to_status='Completed' AND confirmed_source IS NULL`)
stops matching the row.

Idempotent (gated on `confirmed_source IS NULL`). Failure-suppressing
(`EXCEPTION WHEN OTHERS THEN RAISE WARNING ... RETURN NEW`) so the
job-state machine never blocks on patch trouble. One-time reconciliation
DO block at the bottom processes the existing 21-row backlog of
`status='completed'` jobs whose source row's patch was silently skipped.

Lifts the dependency on the agent's expiring user token entirely — the
agent can keep doing what it's doing (and its patches will silently
no-op when `state.supabase_token` is fresh too, because the trigger ran
first and `confirmed_source IS NOT NULL`). No agent-code change needed.

## End-to-end verification (live, 2026-05-20 14:30–15:30 UTC)

| Step | Action | Result |
|------|--------|--------|
| 1 | Initial state | 41 stuck (oldest 1371 min). Manual backfill returned `(0,0,1374)`. |
| 2 | Apply migration 321 (initial) | 41 jobs flipped `failed → queued`, `claim_count=0`. |
| 3 | Wait 60s. Check state. | 40 still queued, all pinned to offline `CXA103V`. Bug 2 surfaces. |
| 4 | Apply migration 321 (extended with unpin) | 40 jobs unpinned (`assigned_agent_id = NULL`). |
| 5 | Wait 5 min. Agent drains. | 40/40 rescued jobs reach `status='completed'` in SAP. |
| 6 | Check FE filter | Still showing 21 “stuck.” Bug 3 surfaces. |
| 7 | Apply migration 322 | 21 source rows reconciled. New trigger live for future jobs. |
| 8 | Final state | **1 row stuck — the genuine “Entry DC-   does not exist in T300” data error.** |

Net drain: 41 → 1 within ≈30 minutes. The remaining 1 is a real
SAP data error (invalid destination storage location code `DC-   `
with trailing spaces); auto-recovery cannot fix this and an operator
must review.

## Constraints honoured

- AGENT_VERSION held at 2.0.0 (no agent code changed).
- rust-work-service v0.1.35 unchanged (no Rust code changed).
- Function signatures preserved — no FE / Rust client breakage.
- All changes are SQL-only and idempotent.
- Lookback windows (24h on the function) preserved.
- Lint ratchet untouched (no FE files changed).
- Failure-suppressing trigger so the job-state machine is never
  blocked by reconciliation trouble.

## Open follow-ups

- **Agent telemetry for missing supabase_token:** today the agent
  silently no-ops `_apply_trigger_post_patch` when the token is empty
  (line 6827) and prints a stdout WARN in `_update_putaway_status`
  (line 7350). With migration 322 the system is functionally fine,
  but a structured metric (e.g.
  `agent_post_patch_skipped_no_token_total`) would surface this on
  Grafana so we know when an operator's token has lapsed before users
  start asking about it.
- **Per-attempt idempotency keys:** today's `<unix-day>` suffix
  forces the backfill to use the failed-job reset path (because a
  fresh INSERT would key-collide). A per-attempt UUID suffix on the
  trigger evaluator's idempotency key would let the orphan-NOTIFY
  path serve both branches uniformly. Future workstream.
- **MCA workflow has its own equivalent gap?** Both migration 321
  and 322 intentionally restrict to non-MCA rows. If MCA confirms
  start sticking, sibling functions following the same pattern
  should follow.
- **Failure classification on the agent:** the agent's `error`
  string is unstructured today (raw COM tuples, vendor-localised SAP
  messages, etc.). A future `failure_class` field on `sap_agent_jobs`
  (`infra` | `auth` | `data` | `unknown`) would let the backfill
  give up earlier on `data`-class failures instead of retrying every
  5 min for 24h.

## Related

- [[Implement-Putaway-Confirm-Backfill-Loop]] — migration 289 (the
  upstream backfill this fix patches).
- [[Decisions/ADR-Trigger-DSL-Evaluator-Phase9]] — trigger
  evaluator that produces `sap_agent_jobs` rows.
- [[Components/Omni-Agent - Headless SAP Agent]] — agent
  claim/complete/fail/heartbeat protocol.
- [[Patterns/Agent-Self-Attribution]] — the overlay-pattern this
  fix preserves.
- [[Fix-Agent-Dual-Patcher-Race]] — earlier history of the agent
  patcher.
- [[Fix-Putaway-Status-UTC-Midnight]] — v1.8.3 row-id-targeted
  PATCH that solved an earlier patch-no-op flavor.
