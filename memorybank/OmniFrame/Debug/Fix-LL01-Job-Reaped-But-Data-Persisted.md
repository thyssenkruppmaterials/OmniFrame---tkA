---
tags: [type/debug, status/active, domain/frontend, domain/backend, sap, ll01, fleet]
created: 2026-05-31
---
# Fix: LL01 "data didn't make it back" — job reaped after the data was persisted

## Symptom
Fleet LL01 run shows:
```
Last run didn't complete — watchdog: max_attempts (1) exhausted with lease
expiry; last lease ended at 2026-05-31 15:18:48+00 (now=2026-05-31 15:19:06+00)
```
User: "The job completed in SAP and Citrix, the agent shows complete, but the
data didn't make it back."

## Diagnosis (live DB, org)
`sap_agent_jobs` (latest LL01, id `fa2bdf07…`): `status=failed`,
`step=watchdog_max_attempts`, `attempts=1/max_attempts=1`, `has_result=false`,
`started_at=15:11:15`, last `heartbeat_at=15:17:18` → `claim_lease_until=15:18:48`,
`completed_at=15:19:06` (reaper).

`ll01_activity_runs` (same window): row `d13201a2…` **`ok=true`, 7 categories,
5 plants, duration_ms=350242 (~5.8 min)** — i.e. **the agent finished and
persisted the full run**.

So this is NOT the agent's local 120s stuck-job watchdog (that fix DID deploy —
the 13:39 run failed with the old "exceeded 120s" message; 14:16 + 15:11 failed
with the lease-expiry reaper instead). It's the **server-side zombie reaper** in
`claim_sap_agent_job` (migration 291): on every claim it flips any `running`
row whose lease lapsed AND `attempts >= max_attempts` to `failed`. On a ~6-min
run the 90s lease (bumped by the 30s heartbeat) lapsed right as the agent's
`jobs_complete` landed, so the reaper won and the result never attached to the
job row — even though the data was already in `ll01_activity_runs`.

## Fix — recover the persisted run on the FE (FE-only)
The data is safe; the FE just showed the failed job. Make the FE recover it:
- `inventory-management-tab.tsx` now **mints `snapshot_run_id` on the FE** and
  passes it in the dispatch payload (`LL01WarehouseActivityRequest.snapshot_run_id`
  — the agent already honours it). So the FE knows the exact id the agent
  persisted under.
- New `recoverLl01FromHistory(snapshotRunId)` calls `useLL01History.loadRun(id)`;
  when the run came back failed/empty (or dispatch threw), it loads the persisted
  `ll01_activity_runs` row and shows it instead — with a "recovered the saved run
  despite a queue timeout" toast + console line. Wired into both the failed-result
  branch and the catch (e.g. 15-min `submitAndWait` timeout). Falls through to the
  normal failure UI only when nothing was persisted (genuine failure).
- The run also already appears in the **History date picker** (it's a real
  `ll01_activity_runs` row), so it's recoverable later even if the tab closed.

## Verification
- DB confirmed the persisted run exists with `ok=true` + full payload.
- `pnpm exec tsc -b` clean; ESLint clean; full sap-testing suite (27) green.
- **FE-only — no agent rebuild / rust deploy.**

## Root-cause fix (DONE 2026-05-31, agent-side)
Bumped the heartbeat claim lease per-endpoint so the reaper stops firing on
healthy long runs: `_bump_current_job_lease()` now sends
`_lease_seconds_for(endpoint)` — `_LEASE_SECONDS_BY_ENDPOINT` = LL01 600s /
LX25 600s, default 90s (`max(per-endpoint, 90)`). rust's
`/jobs/{id}/heartbeat` already honours the request's `lease_seconds`, so this is
**agent-only** (no rust deploy). With a 600s lease bumped every 30s, the lease
stays ~10 min ahead through the run AND the post-completion window, so
`jobs_complete` lands before the lease can lapse. Verified live in the VM
(`_lease_seconds_for('/sap/ll01/warehouse-activity')==600`, default 90). Worker
EXE rebuilt — hash `a63ee35ce1402c235c13b05a47721d071f25b58ad31444fd58a2b14fb9716105`
(Master/Connect unchanged). The FE recovery stays as defense-in-depth for any
residual `jobs_complete` failure.

## Lesson
When work is done out-of-band (agent persists data) but the control-plane row
can be terminally failed by a reaper racing the completion, make the consumer
**idempotently recoverable by a client-minted id** rather than trusting the job
row's terminal status. The durable artifact (the persisted run), not the queue
row, is the source of truth for "did the work happen".

## Related
- [[Fix-LL01-Watchdog-120s-Timeout]] (the prior layer — local watchdog budget)
- [[Implement-LL01-Run-History-Date-Picker]] (`ll01_activity_runs`, `loadRun`)
- migration 291 `claim_sap_agent_job` zombie reaper / [[Fix-LT10-Phantom-Re-Claims]]
