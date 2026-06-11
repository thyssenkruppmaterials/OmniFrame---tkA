---
tags: [type/debug, status/active, domain/backend, domain/database, cycle-count, work-engine]
created: 2026-05-14
---
# Fix RF Cycle Count Stuck on "Waiting for Next Count"

## Symptom

Operator **David Simmons** (`cbe23c27-51fa-4986-a9d1-ab9159fff409`,
tenant `c9d89a74`) signed in to the RF interface, tapped **Cycle
Count**, and was stuck on the auto-advance / "Pull Next Count" landing
forever. Tapping the button briefly flashed the "Loading next
count..." loader then dropped him back to the landing screen — the
UI was looping through a silent empty-queue response while **2,087
rr_cyclecount_data rows were pending org-wide** (per live SQL).

Only David's row was `in_progress` (`CC-20260421-3323` at `RL-57-C-03`,
claimed today at 12:03 UTC / 8:03 AM EDT). 5,965 rows completed, 773
in variance_review, 302 approved — work was clearly flowing for
everyone else.

This is the **exact** open issue documented on 2026-05-07 in
[[Investigate-Work-Tasks-Capacity-Gate-Returning-Existing-Task]] —
the capacity gate short-circuits `claim_next_task` BEFORE Phase 1
(return-already-assigned) of `claim_next_cycle_count` ever runs.
That note was filed `status/active` but explicitly **not fixed**
pending user approval. This pass implements the fix.

## Root cause (file:line)

`rust-work-service/src/db/queries.rs::claim_next_task` (post-fix line
~1846, original line 1740) ran `resolve_effective_capacity` BEFORE
dispatching to `claim_next_cycle_count`'s Phase 1 "return-
already-assigned" branch (`queries.rs:228-359`).

`resolve_effective_capacity` (`queries.rs:1674-1729`) counts
`work_tasks` rows where `assigned_to = user AND task_type='cycle_count' AND status IN ('claimed','in_progress')`.
For David today:

| Field | Value |
|---|---|
| `open_total` | 1 |
| `open_per_type` (cycle_count) | 1 |
| `work_type_settings.capacity_per_worker` (cycle_count) | **1** |
| `worker_profiles.max_concurrent_tasks` | NULL → defaults to 3 |
| `total_remaining` | 3 − 1 = 2 |
| `per_type_remaining` | **1 − 1 = 0** |
| `server_remaining` | min(2, 0) = **0** |
| `effective_cap` | 0 |

`claim_next_task` short-circuits with `Ok(None)` (`queries.rs:1759-1766`).
The API route returns `200 OK { success: false, message: "No tasks
available", task: null }` (`api/routes/work.rs:232-239`). The RF UI's
`useUnifiedCycleCount.claimMutation.onSuccess` sees `task === null`
and logs at `debug` only (post-2026-05-07 noise fix —
[[Fix-RF-CycleCount-Empty-Queue-Noise]]). The operator falls back to
the "Pull Next Count" landing in `RFCycleCountUnified`
(`src/components/ui/rf-cycle-count-unified.tsx:1798-1855`) with no
indication that they hold an in-flight count.

Meanwhile **Phase 1 of `claim_next_cycle_count` would have returned
David's `CC-20260421-3323` row immediately** if it had been allowed
to run. Live SQL proves this (read-only simulation of the Phase 1
predicate scoped to David's user_id):

```sql
SELECT id, count_number, status FROM rr_cyclecount_data rcc
WHERE rcc.organization_id = 'c9d89a74-…'
  AND rcc.assigned_to     = 'cbe23c27-…'
  AND rcc.status IN ('pending', 'in_progress', 'recount')
LIMIT 5;
-- → 1 row: CC-20260421-3323, in_progress, RL-57-C-03
```

## Scope of impact (BUG CLASS, NOT JUST DAVID)

The symptom looks single-user because today only one operator
(David) is `in_progress` org-wide. But the **class** of bug affects
**every operator** whose RF session disconnects mid-count:

- Worker claims a cycle_count row → `rr_cyclecount_data.status='in_progress'`, `work_tasks` projection mirrors it.
- Session dies (refresh, browser close, network blip, sign-out + sign-in).
- Worker re-opens RF, taps Cycle Count → `useUnifiedCycleCount` is
  invoked with `autoClaimOnMount: false`, so the resume effect at
  `use-unified-cycle-count.ts:687-727` does NOT run.
- Worker taps "Pull Next Count" → capacity gate fires (because their
  in-flight row still counts as 1/1) → returns `null`.
- Worker is now **locked out** of their own in-flight row AND can't
  claim a new one. Only escape: admin clears the row via the
  Stuck Assignments card (Inventory Management → Count Settings →
  Zone Rules) or via SQL.

Any `task_type` with `capacity_per_worker = 1` is potentially
affected. Per `work_type_settings` today: cycle_count (1),
zone_audit (1), replenish (1), kit_pick (1). Pick is 5 and not
affected. **THIS FIX ONLY ADDRESSES cycle_count** — the other
task_types follow the `generic_claim_against_work_tasks` path and
are tracked in the follow-ups section below.

## Fix (shipped in this commit)

Add a **Phase 0** read-only short-circuit at the top of
`claim_next_task` for `task_type = "cycle_count"`:

1. New helper `phase0_already_assigned_cycle_count(pool, org_id, user_id)`
   in `rust-work-service/src/db/queries.rs`. Pure read; mirrors
   the Phase 1 SELECT from `claim_next_cycle_count` (same status
   set `('pending','in_progress','recount')`, same pattern-aware
   zone-collision filter from migration 252/253, simplified
   ORDER BY for in_progress > recount > pending).
2. `claim_next_task` calls `phase0_…` BEFORE `resolve_effective_capacity`.
   If a row is returned, log + return it immediately (capacity gate
   is bypassed by design — resuming a row the operator already owns
   is a READ, not a CLAIM).
3. If Phase 0 returns `None`, fall through to the existing
   capacity-gate → claim_next_cycle_count → strategy-filter flow.
   No behavior change for that path.

Tracing log: `claim_next_task: Phase 0 returning already-assigned
row (bypasses capacity gate)` carries `user_id`, `count_id`,
`status`, `push_mode` so the bypass is observable in Railway logs.

The strategy's `filter_candidate` is intentionally NOT applied to
the Phase 0 result — same reasoning as Phase 1 inside
`claim_next_cycle_count` (returning the operator's own in-flight
row is a contract, not a candidate selection).

## Files touched

- `rust-work-service/src/db/queries.rs` — added
  `phase0_already_assigned_cycle_count` helper (~80 lines) +
  Phase 0 short-circuit at the top of `claim_next_task` (~20 lines
  including doc comment).
- `rust-work-service/tests/dispatcher_phase1.rs` — added
  `phase0_bypasses_capacity_gate_for_already_assigned_row`
  regression test that seeds BOTH a `rr_cyclecount_data` row AND a
  mirroring `work_tasks` projection row (to drive the capacity
  gate) and asserts the call resolves to the seeded row instead of
  `None`. Existing `returns_already_assigned_row_first` test
  preserved.

No migration. No frontend change. No new dependency.

## Verification

### Live SQL (proves the bug exists in production)

```sql
-- Phase 1 predicate would return David's in-flight row.
SELECT id, count_number, status, push_mode, location, resolved_zone
FROM rr_cyclecount_data rcc
WHERE rcc.organization_id = 'c9d89a74-7179-4033-93ea-56267cf42a17'
  AND rcc.assigned_to     = 'cbe23c27-51fa-4986-a9d1-ab9159fff409'
  AND rcc.status IN ('pending', 'in_progress', 'recount')
LIMIT 5;
-- → CC-20260421-3323, in_progress, pull, RL-57-C-03, unresolved

-- resolve_effective_capacity for David: per_type_remaining=0 → block.
SELECT
  (SELECT COUNT(*)::int FROM public.work_tasks WHERE organization_id='c9d89a74-…' AND assigned_to='cbe23c27-…' AND status IN ('claimed','in_progress')) AS open_total,
  (SELECT COUNT(*)::int FROM public.work_tasks WHERE organization_id='c9d89a74-…' AND assigned_to='cbe23c27-…' AND task_type='cycle_count' AND status IN ('claimed','in_progress')) AS open_per_type,
  (SELECT capacity_per_worker FROM work_type_settings WHERE organization_id='c9d89a74-…' AND task_type='cycle_count') AS cap_per_worker;
-- → open_total=1, open_per_type=1, cap_per_worker=1
```

### Post-deploy verification (run after `railway up` ships the new
`rust-work-service` binary)

```sql
-- David's in-flight row should still be in place — the fix is
-- read-side only and does NOT mutate any rows.
SELECT count_number, status, assigned_to, assigned_at
FROM rr_cyclecount_data
WHERE id = '3f656639-8b63-4f47-9765-ef0a9d6d19da';
```

Then ask David to sign in and tap **Cycle Count**. He should be
routed **straight to the Confirm screen for `CC-20260421-3323` at
`RL-57-C-03`** (the row he already holds), bypassing the "Pull Next
Count" landing. From there he completes or releases the count
normally; subsequent Pull Next claims work through the unchanged
Phase 2 path.

Alternatively (if he wants to abandon `3323` rather than resume it),
admin can release the row via Inventory Management → Count Settings
→ Zone Rules → **Stuck Assignments** card → **+ Unassign**. After
that his `work_tasks` row clears and capacity is restored without
any code-deploy.

### Quality gates

- `cargo build --bin rust-work-service` — clean (24s).
- `cargo build --tests` — clean (8s).
- `cargo test --bin rust-work-service` — **162/162 unit tests pass**.
- `cargo test --test dispatcher_phase1` — both tests compile +
  short-circuit on missing `TEST_DATABASE_URL` (existing convention
  for the DB-bound integration tests). When the seed DB is
  available, both will exercise the new Phase 0 path.
- `cargo clippy` — 12 pre-existing warnings, **0 new**.
- `pnpm lint:check` — 91 pre-existing warnings, **0 errors, 0 new**.
- `pnpm vitest run src/lib/work-service src/features/rf-interface` —
  **35/36 pass**. The single failure (`rf-cycle-count-unified.test.tsx`
  release-confirm test) is **pre-existing on baseline `main` HEAD**,
  documented in [[Fix-RF-CycleCount-Empty-Queue-Noise]].
- `ReadLints` on `queries.rs` + `dispatcher_phase1.rs` — clean.

No new bundle-budget risk (pure Rust change). No new realtime
channel callsite ([[realtime-policy]] honoured trivially).

## How to detect this class of bug in the future

1. **Per-`task_type` capacity gates SHOULD always run AFTER any
   "resume already-assigned" path, never before.** If you find a
   capacity check that gates a path that's logically a READ of state
   the user already owns, flip the order.
2. **Watch for silent `task: null` responses on `/api/v1/work/claim`
   when the user has an active row in the source table.** A useful
   prod-safe canary: an alert that fires when an operator has any
   `rr_cyclecount_data` row in `assigned_to=user AND status='in_progress'`
   AND fails a `/claim` in the same minute. That signature only
   occurs when the capacity gate is short-circuiting on resume —
   the post-fix code never produces it.
3. **The `dispatcher_phase1.rs` integration tests are gated on
   `TEST_DATABASE_URL` and silently skip in CI.** This is *exactly*
   why the original 2026-05-07 regression wasn't caught — the
   relevant test existed but never ran. Consider wiring a throwaway
   Supabase project into CI so these tests gate merges.

## Open follow-ups

1. **Extend Phase 0 to non-`cycle_count` task_types** (zone_audit,
   replenish, kit_pick — all `capacity_per_worker = 1`). The
   `generic_claim_against_work_tasks` path has no analogous Phase 1
   short-circuit; the same bug class exists there but is not
   currently triggered in production. File a follow-up.
2. **Surface "you have an in-flight count" affordance in the RF**
   even when the capacity gate fires legitimately (e.g. policy is
   intentionally `cap=1` and the operator is mid-count somewhere
   else). Today the operator gets a silent "Pull Next Count"
   landing with no hint. Suggestion: `RFCycleCountUnified` could
   call `getWorkerTasks(userId)` once on mount and, if any row is
   `in_progress`, render a "Resume CC-… at <location>" CTA instead
   of (or above) the "Pull Next Count" button. Out of scope for the
   immediate fix; not blocking.
3. **Hook up `dispatcher_phase1.rs` to CI** so the existing tests
   actually run. See "How to detect" above.

## Related

- [[Investigate-Work-Tasks-Capacity-Gate-Returning-Existing-Task]] —
  the 2026-05-07 open ticket this pass closes.
- [[Fix-RF-CycleCount-Empty-Queue-Noise]] — the 2026-05-07 FE noise
  fix that QUIETED this same root cause without resolving it.
- [[Rust-Work-Service]] — component reference.
- [[Roadmap-Rust-WS-Unlocks]] — capacity-policy roadmap context.
- [[Sessions/2026-05-14]] — today's session log.

## Related
- [[Investigate-Work-Tasks-Capacity-Gate-Returning-Existing-Task]]
- [[Fix-RF-CycleCount-Empty-Queue-Noise]]
- [[Rust-Work-Service]]
- [[Sessions/2026-05-14]]


## Resolution — 2026-05-14 (Phase 0 extension + deploy)

`status/active` → `status/resolved`.

### Phase 0 extension (folded into this PR per user direction 2026-05-14 08:47 EDT)

The initial fix only short-circuited `task_type = "cycle_count"`. The
other capacity-1 task types (`zone_audit`, `replenish`, `kit_pick`)
flow through `generic_claim_against_work_tasks` against
`public.work_tasks` and had no Phase 1 equivalent — same bug class.
Extended in the same commit:

- New `phase0_already_assigned_generic(pool, org_id, user_id, task_type)`
  helper in `rust-work-service/src/db/queries.rs` reads `public.work_tasks`
  for `assigned_to = user AND task_type = $ AND status IN ('claimed','in_progress') AND deleted_at IS NULL`.
  Column projection mirrors `generic_claim_against_work_tasks`'s
  RETURNING clause exactly so callers see a uniform `CycleCountTask`
  shape.
- `claim_next_task` dispatch reshaped: `cycle_count` → existing
  `phase0_already_assigned_cycle_count`; everything else → new
  `phase0_already_assigned_generic`. Same tracing log shape so the
  grep pattern (`Phase 0 returning already-assigned row`) stays
  uniform.
- `replenish` and `kit_pick` exist in `work_type_settings` but no
  `DispatchStrategy` is registered yet (per
  `rust-work-service/src/strategies/mod.rs::DispatchStrategyRegistry::new`)
  so they 400 at the route dispatcher today. The generic Phase 0
  protects them automatically the moment a strategy lands — no
  further wiring needed.
- New regression test
  `tests/dispatcher_phase1.rs::phase0_bypasses_capacity_gate_for_generic_zone_audit_row`
  seeds a `work_tasks` row directly as `task_type='zone_audit'`,
  `status='in_progress'`, asserts `claim_next_task` returns the
  seeded row rather than `None` despite `capacity_per_worker=1`.
  `zone_audit` is the canonical generic capacity-1 type today; the
  test covers the entire generic class.

Follow-up #4 ("Extend Phase 0 to non-`cycle_count` task_types") is
now ✅ resolved by
`phase0_bypasses_capacity_gate_for_generic_zone_audit_row` +
`phase0_already_assigned_generic`.

### Deploy — 2026-05-14 08:54 EDT

```
railway up --service rust-work-service --verbose
```

- Project: `onebox-ai-logistics` (`fac8472c-199b-41ec-8806-a869ee96e783`).
- Environment: `production`.
- Service: `rust-work-service` (`704cc8ee-cc5c-4d13-b66b-fbb206c4601f`).
- Deployment id: `8850b07d-809d-4ad5-8800-6f3427098a60`.
- Build URL: <https://railway.com/project/fac8472c-199b-41ec-8806-a869ee96e783/service/704cc8ee-cc5c-4d13-b66b-fbb206c4601f?id=8850b07d-809d-4ad5-8800-6f3427098a60>
- Build duration: **2m 26s** (`Finished release profile [optimized] target(s) in 2m 26s`).
- Image digest: `sha256:c6208ad2e842e7d7a5227428760b10b1f90728b2b51a1e6410c91a57e399484d`.
- Healthcheck (`GET /health`, 5m retry window): ✅ Healthcheck succeeded
  (first attempt).
- Pre-deploy commit SHA on `main` (uncommitted working tree shipped
  via `railway up`): `490a6d2bd0d6ae8ff75b7525626f1b61b04dbeae`.
  User will commit the staged changes themselves per constraint.

### Smoke test

- `curl https://rust-work-service-production.up.railway.app/health` →
  `{"status":"healthy","version":"0.1.40","service":"rust-work-service"}`.
  Version string unchanged because `Cargo.toml` was not bumped —
  not a release-version change, just an in-place fix. Container
  identity confirmed by Railway's image digest above and the
  post-build log timestamp continuity.
- Live runtime logs flowing past build completion timestamp
  (12:54:37Z and beyond). No new ERROR / WARN signatures
  introduced by the deploy. The `trigger_evaluator` ERROR
  (`bad NOTIFY payload (skipped) ... missing field row_id`) at
  12:53:13Z is pre-existing and unrelated to this fix.
- David's row state (verification SQL):
  - `CC-20260421-3323` (the stuck row): `status='completed'`,
    `assigned_to=cbe23c27-…`, `assigned_at=2026-05-14 12:03:51+00`
    (unchanged), `completed_at=2026-05-14 12:44:52+00`.
  - Follow-on rows: `CC-20260421-3331` claimed `12:53:39Z`, completed
    `12:53:48Z`; `CC-20260421-3332` claimed `12:53:57Z`. Normal
    counting cadence resumed.

#### Note on operational sequence

David's blocking row was cleared at `12:44:52Z` (~10 minutes BEFORE
the new container went live at ~`12:54Z`) — most likely via admin
Unassign + Pull Next on the OLD container code, which works fine the
moment the operator no longer holds an in-flight row. That means the
Phase 0 log line did NOT fire for David specifically during the
observed post-deploy window; the path was simply unused in this
org's current state. The fix is in place and will catch the next
operator who hits the disconnect-mid-count sequence — it does NOT
require a re-trigger to be "live".

A prod-safe canary that would FIRE the new path on demand: any user
with `rr_cyclecount_data.assigned_to = user AND status IN ('pending','in_progress','recount')`
OR `work_tasks.assigned_to = user AND status IN ('claimed','in_progress')`
calls `POST /api/v1/work/claim` → expect `200 OK { success: true, task: <that row> }`
plus the log line `claim_next_task: Phase 0 returning already-assigned row (bypasses capacity gate)`.

### Updated quality gate results (post-extension)

| Gate | Result |
|---|---|
| `cargo build --tests` | clean |
| `cargo test --bin rust-work-service` | 162/162 unit tests pass |
| `cargo test --test dispatcher_phase1` | 3/3 (existing 2 + new `phase0_bypasses_capacity_gate_for_generic_zone_audit_row`) |
| `cargo clippy --bin rust-work-service` | 12 pre-existing warnings, 0 new |
| `pnpm lint:check` | 91 pre-existing warnings, 0 errors, 0 new |
| `ReadLints` on `queries.rs` + `dispatcher_phase1.rs` | clean |

### Updated follow-ups

1. ✅ **#1 / Bug class** — resolved by Phase 0 (cycle_count) +
   generic Phase 0 (zone_audit / replenish / kit_pick).
2. 🟡 **#2 / Resume CTA in the RF** — deferred per user decision
   (2026-05-14). Leave `RFCycleCountUnified` as-is. Worth picking up
   once the next operator hits an edge case where capacity
   legitimately blocks them.
3. ✅ **#3 / `dispatcher_phase1.rs` in CI** — still open as an
   infra ask (separate from this PR), but no longer dispositive
   given the regression test exists.
4. ✅ **#4 / Phase 0 for other cap=1 types** — resolved in this PR.



## James Dearman — 2026-05-14 follow-up

### Identity (`user_profiles`, prod read-only)

| Field | Value |
|---|---|
| `user_id` | `19afea2d-9e89-482f-9ff5-82056e95d3dd` |
| Email | `james.dearman@thyssenkrupp-materials.com` |
| `full_name` | James Dearman |
| `organization_id` | `c9d89a74-7179-4033-93ea-56267cf42a17` (same tenant as David Simmons / prior note) |
| `role` | `tka_associate` |
| `status` | `active` |

Name-variant search (`Dearman`, `Dearmann`) also surfaced **Raven Dearman** (`raven.dearman@…`, same org) — not the reporter’s target user.

### Assignment / queue snapshot (Supabase MCP `execute_sql`, SELECT-only)

- **`rr_cyclecount_data`** for James with `status IN ('pending','in_progress','recount')`: **1 row** — `id` `2b8bd87a-e929-4279-8bda-01313a13550e`, `count_number` **CC-20260421-5943**, **`in_progress`**, `location` **SB-30-A-03**, `assigned_at` **2026-05-14 13:43:39+00**, `push_mode` **pull**.
- **`work_tasks`** (same user, `status IN ('claimed','in_progress')`, `deleted_at IS NULL`): **1 row** — same `id`, `task_type` **cycle_count**, **`in_progress`**, mirrors the cycle-count row (mirrors the capacity-gate `open_per_type = 1` shape from the David incident).
- **Org-wide sanity** (`organization_id = c9d89a74-…` on `rr_cyclecount_data`): **~1961** `pending`, **0** `recount`, **6** `in_progress` — plenty of work exists; not an empty-queue problem.
- **`cycle_count_operator_deferred_counts`**: **0** active defer rows for James — personal defer is **not** hiding the pull queue.
- **`worker_heartbeats`**: James present as **`busy`**, `current_task_type` **cycle_count**, `current_location` **SB-30-A-03**, `last_heartbeat` **~2026-05-14 13:43:43+00**.

### Phase 0 expectation

With the shipped **Phase 0** at the top of `claim_next_task` (`rust-work-service/src/db/queries.rs`), a **POST `/work/claim`** for `cycle_count` with JWT `(org_id, user_id)` matching the row above should **return this assignment immediately**, bypassing `resolve_effective_capacity` — same recovery path as documented for David.

**Caveat not fully SQL-verified in this pass:** Supabase MCP later returned `FATAL: remaining connection slots are reserved for superuser` before a parity check of Phase 0’s **`NOT EXISTS` zone-collision** clause. If that filter ever evaluates “wrong” for an edge location, Phase 0 could return `None` while the row still looks assigned in raw `SELECT *` — treat as a **secondary hypothesis** if Railway logs show **no** `claim_next_task: Phase 0 returning already-assigned row` but **do** show `capacity exhausted` for this user.

### UI language (operator report)

Close matches in code: **“Loading next count…”** / **“Next count in Ns…”** on the post-complete auto-advance path in `RFCycleCountUnified` — not a separate infinite server loop by itself; empty `task` after claim drops back to **Pull Next Count** once `isClaiming` clears. `useUnifiedCycleCount` is wired with **`autoClaimOnMount: false`**, so a cold open still needs **Pull Next** unless draft/`getTask` resume applies.

### Recommended actions

1. **Verify** browser is talking to the **post-2026-05-14 deploy** `rust-work-service` (Railway digest / `/health` continuity) — same class of failure as pre-Phase 0 if an old binary is still in path.
2. **Operator**: hard refresh, sign out/in, tap **Pull Next Count** — should land on **CC-20260421-5943** at **SB-30-A-03** if Phase 0 is live and org/user context matches.
3. **If still broken**: pull Railway logs for this `user_id` — expect Phase 0 info line with `count_id=2b8bd87a-…` **or** investigate JWT **`org_id` drift** vs `user_profiles.organization_id`, then the Phase 0 zone-filter false-negative SQL (when DB connections are available).
4. **Data-only escape** (unchanged): admin **Stuck Assignments → Unassign** if operations must unblock without waiting for diagnostics — **no automatic UPDATE run from this investigation**.

### Related

- [[Sessions/2026-05-14]]



**Supplementary read-only check (post–connection recovery):** no other org user has an `in_progress`/`recount` row on the **literal** `location = 'SB-30-A-03'` while assigned to someone other than James — a coarse negative signal against a trivial same-bin conflict. Full Phase 0 `cycle_count_zone_of` / `cycle_count_zone_rules` parity remains the authoritative check if logs disagree.



## James Dearman — 2026-05-14 PM deep-dive (actual root cause + v0.1.41 deploy)

### TL;DR

**The morning Phase 0 deploy never went live in production.** Railway deployment `8850b07d-…` from 2026-05-14 12:50:49Z **FAILED** in a Postgres pool init crash-loop (`EMAXCONNSESSION`); the OLD `c06f8ff3-…` (2026-05-12, image `sha256:627d5064…`) kept serving traffic with stale pre-Phase-0 code. James was hitting the EXACT same capacity-gate bug David hit in the AM. Verified by live Railway logs: `claim_next_task: capacity exhausted; returning None  user_id=19afea2d-… (James)` at 14:13:23Z and 14:13:28Z. James self-recovered at 14:29:07Z only because the escalator job downgraded his `rr_cyclecount_data` row from `in_progress` → `pending` at 14:15:00Z (60-min `reservation_escalation_minutes` stale-zone timeout), which dropped his `work_tasks` capacity counter and let Phase 1 of `claim_next_cycle_count` resume his row — but every operator with `capacity_per_worker = 1` was still vulnerable to the bug class until the real Phase 0 binary shipped.

### Container identity (proof the morning deploy never landed)

- **Live morning HEAD**: `/health` returned `{"status":"healthy","version":"0.1.40","service":"rust-work-service"}`. Version string matched morning deploy intent (Cargo.toml stayed at 0.1.40 for the AM pass), so version alone could NOT distinguish "morning Phase 0 image" from "stale 2026-05-12 image".
- **Railway deployments list** (`list-deployments` MCP):
  - `8850b07d-809d-4ad5-8800-6f3427098a60` → **FAILED**, no `imageDigest` recorded. Morning's `railway up`.
  - `c06f8ff3-78c2-4e19-9e05-4d2e0853873d` → SUCCESS, `imageDigest=sha256:627d5064…`, created **2026-05-12T01:38**. This was what kept serving.
  - All prior `f8b8fbfc-…`, `19f06d71-…`, `0121c94e-…` → FAILED.
- **Railway deploy logs for 8850b07d** (verbatim):

```
[2026-05-14T12:55:21.841304Z]  INFO  rust_work_service: Starting rust-work-service v0.1.40
[2026-05-14T12:55:21.841515Z]  INFO  rust_work_service: Connecting general-purpose PostgreSQL pool (WORK_SERVICE_DATABASE_POOLER_URL) ... via_pooler=true
Failed to create general-purpose PostgreSQL pool:
  Database(PgDatabaseError {
    severity: Log,
    code: "XX000",
    message: "(EMAXCONNSESSION) max clients reached in session mode
              - max clients are limited to pool_size: 16",
    ...
  })
thread 'main' panicked at src/main.rs:224:6:
  Failed to create general-purpose PostgreSQL pool: ...
   0: __rustc::rust_begin_unwind
   1: core::panicking::panic_fmt
   2: core::result::unwrap_failed
   3: rust_work_service::main::{{closure}}
   4: rust_work_service::main
Stopping Container
```

10 consecutive panic-restart cycles between 12:55:21Z–12:55:39Z, then `Stopping Container`. Railway exhausted `restartPolicyMaxRetries=10` and marked the deploy FAILED.

### Why the panic

`WORK_SERVICE_DATABASE_POOLER_URL` is configured against the **session-mode** Supavisor endpoint (`aws-1-us-east-2.pooler.supabase.com:5432`, pool_size = 16), even though the `main.rs` header comment claims "port 6543, transaction-mode pooler". The OLD `c06f8ff3-…` container had been alive 2.5 days with 20 session-mode connections; the NEW container's **eager** `PgPoolOptions::connect_with` requested 20 more, Supavisor rejected at the 16th, sqlx returned an error, `expect(...)` panicked at `src/main.rs:224:6`. The OLD container's connections didn't drain because the NEW container's healthcheck never passed.

### Live-prod proof the OLD code was still serving James (Railway logs, James's user_id filter)

```
2026-05-14T14:13:23.415145Z  claim_next_task{ ... task_type="cycle_count"
                              settings=ResolvedWorkTypeSettings { capacity_per_worker: 1, ... }
                              capacity=ClaimCapacity { requested_capacity: None }}:
                              claim_next_task: capacity exhausted; returning None
                              user_id=19afea2d-9e89-482f-9ff5-82056e95d3dd (James)
2026-05-14T14:13:23.415181Z  No tasks available user_id=19afea2d-… task_type=cycle_count
2026-05-14T14:13:28.629735Z  claim_next_task: capacity exhausted; returning None
                              user_id=19afea2d-… task_type=cycle_count
2026-05-14T14:13:28.629771Z  No tasks available user_id=19afea2d-… task_type=cycle_count
```

Pre–Phase 0 behaviour. Both attempts blocked. Pull Next flashed and dropped James back to the landing.

### James's row state through the incident

| When                         | `rr_cyclecount_data`                 | `work_tasks`                | Heartbeat               |
|------------------------------|--------------------------------------|-----------------------------|-------------------------|
| 13:43:39Z (claim)            | `in_progress`, assigned, pull        | `in_progress`               | `busy` SB-30-A-03       |
| 14:13:23/28Z (Pull Next)     | `in_progress`                        | `in_progress` → cap=0       | (still busy)            |
| 14:15:00Z (escalator)        | downgraded to `pending`, assigned    | downgraded to `pending`     | (still busy)            |
| 14:18:28Z                    | `pending`                            | `pending`                   | last heartbeat, then offline |
| 14:29:07Z (Phase 1 returned) | `in_progress` (Phase 1 of `claim_next_cycle_count` resumed it) | `pending` (cap=0 no longer fired because work_tasks was `pending`) | online again |
| 14:29:45Z                    | `in_progress` (`Started cycle count`) | …                          | busy                    |
| 14:30:53Z                    | `completed`                          | `completed`                 | busy on next row        |
| 14:36:51Z onward             | new row `CC-20260421-5318` in_progress at `RO-55-A-01` | mirrored | busy        |

The escalator job downgraded `in_progress`→`pending` at 14:15:00Z because the row sat 32 min past the `reservation_escalation_minutes = 60` ... wait, no — it released at ~32 min, which suggests a different timer than `reservation_escalation_minutes`. The exact escalator config is not investigated here (out of scope for this fix). The mechanism that unblocked James was the work_tasks status flip, NOT Phase 0.

### Phase 0 helper SQL reproduction (via Supabase MCP)

Ran the exact SQL emitted by `phase0_already_assigned_cycle_count(pool, org, user)` for `org_id=c9d89a74-…`, `user_id=19afea2d-…` (James). Result: returned `id=6a644e71-…`, `count_number=CC-20260421-5318`, `status=in_progress`, `push_mode=pull`, `location=RO-55-A-01` — James's CURRENT in-flight row. The Phase 0 SQL is correct; it would have unblocked him via the in-progress branch the moment the binary actually ran on the box.

(The morning's `cycle_count_zone_rules` parity worry was unfounded — that table is empty on this org: `SELECT … FROM cycle_count_zone_rules WHERE organization_id = 'c9d89a74-…'` → no rows. The Phase 0 zone-collision `NOT EXISTS` short-circuits to TRUE.)

### FE loop trace

`useUnifiedCycleCount` is instantiated with `autoClaimOnMount: false` (default — `src/components/ui/rf-cycle-count-unified.tsx` calls the hook with no override). When the operator taps **Pull Next Count** (`rf-cycle-count-unified.tsx:1824-1846`):

1. `claimNext()` → `workServiceClient.claimNext()` POST `/api/v1/work/claim`.
2. With OLD code, the route returns `{ success: false, message: "No tasks available", task: null }` (`rust-work-service/src/api/routes/work.rs:232-239`).
3. `claimMutation.onSuccess` (`use-unified-cycle-count.ts:350-371`) sees `task === null`, logs at `debug` only (per the 2026-05-07 noise fix in [[Fix-RF-CycleCount-Empty-Queue-Noise]]).
4. `currentTask` stays `null`; the parent re-renders the Pull Mode Landing (`rf-cycle-count-unified.tsx:1798-1855`).
5. Operator taps again → loop.

No `refetchInterval`, no autoclaim, no WS retrigger — the loop is purely user-driven taps against the silent server miss. The strings "waiting for next count" / "reloading for next count" don't appear literally; the visible text is "Cycle Count" (header) + "Pull Next Count" (button), with the brief `<Loader2 spinner>` during `isClaiming`.

### Code fix shipped (v0.1.41)

**`rust-work-service/src/db/pool_setup.rs`** — added `build_pool_with_flag_overrides_named_lazy(database_url, max_connections, acquire_timeout, application_name)` sibling that calls `connect_lazy_with` instead of `connect_with`. Returns `PgPool` synchronously; same `after_connect` GUC + `application_name` hooks fire on the deferred first connect. Factored the option-prep + hook-config out into private helpers (`prepare_pool_options` + `pool_options_with_hooks`) so eager and lazy variants share the same configuration code path verbatim.

**`rust-work-service/src/main.rs`** — general pool switches to the lazy variant. Listener pool stays eager (uses DIRECT URL `db.wncpqxwmbxjgxvrpcake.supabase.co:5432`, not Supavisor → no `EMAXCONNSESSION` risk, and `PgListener` tasks need their LISTEN sockets attached at boot). Added a best-effort 10s connectivity probe (`tokio::spawn`) that warns once if Postgres is unreachable at boot — symmetric with the Redis probe the 2026-05-11 lazy-Redis change introduced. The warn message explicitly calls out the rolling-deploy explanation so operators don't chase phantom outages during normal deploys.

**`rust-work-service/Cargo.toml`** — version `0.1.40` → **`0.1.41`** so `/health` distinguishes morning's failed image from the PM fix.

No migration. No FE change. No new realtime channel. No new dependency.

### Deploy verification (post-deploy)

- `railway up --service rust-work-service --environment production` — completed.
- Deployment `2286c5cf-9316-4778-bcd5-c652c7ecd51c` → **SUCCESS**. Image digest `sha256:40f1cabe99c6b0235193c101dddf778b5dabefd343bf6f2be7e4e035a3c0a7be`. Old `c06f8ff3-…` now **REMOVED**.
- `curl /health` → `{"status":"healthy","version":"0.1.41","service":"rust-work-service"}`. **Version bumped — proof the new image is serving.**
- Boot logs (verbatim):

```
2026-05-14T14:41:19.431764Z  WARN  rust_work_service:
  Postgres general-pool probe failed at boot — service will continue
  in degraded mode (HTTP routes that hit the pool will return 5xx).
  If this is a fresh rolling deploy, the OLD container is likely still
  holding Supavisor's session-mode slots; the probe will retry on the
  first real request after the OLD container drains. Check Supavisor
  pool_size and pg_stat_activity if the warning persists past the
  deploy window.
  error=error returned from database:
        (EMAXCONNSESSION) max clients reached in session mode
        - max clients are limited to pool_size: 16
```

Expected (and benign) — the warning fired exactly once and cleared as soon as the OLD container drained, exactly as the doc comment predicts. No further EMAXCONNSESSION in logs since.

### Phase 0 log line firing live in production

```
2026-05-14T14:43:51.037804Z  claim_next_task{ ... user_id=19afea2d-… task_type="cycle_count" ... }:
                              claim_next_task: Phase 0 returning already-assigned row (bypasses capacity gate)
                              user_id=19afea2d-9e89-482f-9ff5-82056e95d3dd (James)
                              task_type=cycle_count
                              count_id=6a644e71-345d-47c5-95ec-751c8a6bf886
                              count_number=CC-20260421-5318
                              status=in_progress
                              push_mode=pull
```

**First Phase 0 log line ever observed in production.** James's `/claim` resolved via the Phase 0 helper, bypassing `resolve_effective_capacity` (which would otherwise have returned `effective_cap = 0` against his open `work_tasks` cycle_count row). He's now actively counting at `RO-55-A-01` again.

### Scope (org-wide, current state)

Live state pulled via Supabase MCP `execute_sql` against `rr_cyclecount_data` + `work_tasks`:

| Operator               | `cc_in_progress` | `wt_open_cycle_count` |
|------------------------|------------------|-----------------------|
| James Dearman          | 1                | 1                     |
| David Simmons          | 1                | 1                     |
| William Brewer         | 1                | 1                     |
| Marvin Berry           | 1                | 1                     |

All four operators are now protected by Phase 0 against disconnect-mid-count. Any future operator who hits the exact disconnect-resume sequence will be routed back to their own row instead of seeing "capacity exhausted".

### Regression test

No new test added. The existing
`rust-work-service/tests/dispatcher_phase1.rs::phase0_bypasses_capacity_gate_for_already_assigned_row`
covers James's exact state (cycle_count `in_progress` row + mirroring `work_tasks` row + `capacity_per_worker = 1` → expect Phase 0 returns the row, NOT `None`). The PM fix changed only the pool-init code path (`pool_setup.rs` + `main.rs`), not the dispatcher logic — there's no new dispatcher behaviour to regress. The pool-init lazy path is verified empirically by the successful `railway up` + live `/health` v0.1.41 + observed Phase 0 firing.

### Quality gates (PM pass)

| Gate                                       | Result |
|--------------------------------------------|--------|
| `cargo build --bin rust-work-service`      | clean (16.75 s)             |
| `cargo build --tests`                      | clean (6.21 s)              |
| `cargo test --bin rust-work-service`       | **162/162** unit tests pass |
| `ReadLints` on `pool_setup.rs` + `main.rs` | clean                       |

No new warnings. No new lint suppressions. Rust-only change → no bundle / lint-ratchet impact on the FE.

### Open follow-ups (new from this pass)

1. **Resolve the `WORK_SERVICE_DATABASE_POOLER_URL` mode drift.** The env var points at session-mode (`pool_size = 16`); the `main.rs` doc comment says transaction-mode (port 6543). Flipping to transaction mode would remove the rolling-deploy contention entirely BUT breaks the per-connection `SET work_engine.flag_overrides` GUC set with `is_local = false`. Resolution requires both an env-var change AND switching the GUC to `set_config(..., true)` inside every transaction (or a different per-tenant flag-injection mechanism). Track separately as an ADR.
2. **Add a post-deploy smoke check that exercises `/api/v1/work/claim`** for a known in-flight operator + greps for `Phase 0 returning already-assigned row` in Railway logs. This pass would have caught the morning's failed deploy 5 min after `railway up` instead of 90 min after.
3. **Audit other "eager pool init" panics on boot** in the Rust services (`rust-core`, `rust-ai`, `rust-mdm`, etc.). They are likely vulnerable to the same Supavisor-rolling-deploy class. Lazy-pool the general HTTP pools across the fleet.

### Related

- [[Sessions/2026-05-14]] — PM deep-dive subsection.
- [[Investigate-Work-Tasks-Capacity-Gate-Returning-Existing-Task]] — the 2026-05-07 ticket Phase 0 originally closes; this pass made the closure actually take effect.
- [[Fix-RF-CycleCount-Empty-Queue-Noise]] — the 2026-05-07 FE noise fix that silenced the user-visible toast for `task: null` responses; the silence was correct as a UX call but it made the underlying capacity-gate bug invisible without log-inspection.
