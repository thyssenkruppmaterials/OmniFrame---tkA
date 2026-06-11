---
tags: [type/debug, status/active, domain/backend, domain/database]
created: 2026-05-07
---
# Investigate-Work-Tasks-Capacity-Gate-Returning-Existing-Task

## Status

**Open** — documented but not fixed. Surfaced during the 2026-05-07
FE noise-fix investigation ([[Fix-RF-CycleCount-Empty-Queue-Noise]]).
Do not fix without explicit user approval — this is a work-engine
concern that needs its own scoped task.

## Symptom

User `8fe94172-0267-4b14-96bd-06f8691bb04c` (tenant `c9d89a74`) calls
`POST /api/v1/work/claim` and gets `200 OK { success: false, message: "No tasks available", task: null }`.

But the same user has:
- 1 `rr_cyclecount_data` row in status `in_progress`, assigned to them
  (`81b713a3` at location `K3-35-08-1`, claimed 11:05 UTC).
- 1 `work_tasks` row mirroring it (status `in_progress`, assigned).

The historical contract of `claim_next_cycle_count` is that **Phase 1**
returns the operator's already-assigned row back to them so the RF UI
can resume mid-count after a refresh. That contract is now silently
broken.

## Root cause

Railway log (verified 2026-05-07 11:30:14Z):

```
claim_next_task{org_id=c9d89a74-… user_id=8fe94172-… task_type="cycle_count"
  settings=ResolvedWorkTypeSettings { capacity_per_worker: 1, … }
  capacity=ClaimCapacity { requested_capacity: None }}:
  claim_next_task: capacity exhausted; returning None
```

`rust-work-service/src/db/queries.rs::resolve_effective_capacity`
(lines 1707-1719) counts `work_tasks` rows where:

```sql
SELECT COUNT(*) FROM work_tasks
 WHERE assigned_to = $user
   AND task_type   = 'cycle_count'
   AND status IN ('claimed','in_progress')
```

With `capacity_per_worker = 1` (the org's default `work_type_settings`),
`per_type_remaining = 0` and `claim_next_task` short-circuits with
`Ok(None)` BEFORE ever calling `claim_next_cycle_count` (line
1759-1766).

`claim_next_cycle_count`'s **Phase 1** — the path that returns an
already-assigned task back to its owner so they can resume — NEVER
RUNS once the operator holds 1 task. From the operator's perspective,
they see "No tasks available" instead of being routed back to their
in-flight count.

## Why it didn't show up before today

1. The capacity gate in `claim_next_task` is part of the
   plan-§2.5 work-engine generic claim path landed in commit `7a64f92`
   ("Integrate Rust Work Service …" — same commit that also redeployed
   the worker pool). It's brand new.
2. Before this commit, `claim_next_cycle_count` was called directly
   without the capacity wrapper, so its Phase 1 (already-assigned
   return) was always reachable.
3. The plan didn't anticipate that Phase 1 is logically a READ, not a
   CLAIM, and so doesn't "consume" capacity. But the gate doesn't
   distinguish.

## Recommended fix scope (NOT IMPLEMENTED)

### Option A — short-circuit on already-assigned BEFORE the capacity gate

In `claim_next_task`, check for an existing assigned-and-active row
FIRST. If one exists, return it (as Phase 1 does). Only run the
capacity gate when looking for a NEW assignment.

This preserves the operator's resume-mid-count UX without changing the
capacity policy semantics. Roughly:

```rust
pub async fn claim_next_task(…) -> Result<Option<CycleCountTask>, _> {
    // Phase 0: return-already-assigned (no capacity check)
    if let Some(existing) = fetch_already_assigned(pool, org_id, user_id, task_type).await? {
        return Ok(Some(existing));
    }
    // Phase 1+: capacity gate then strategy resolve (existing flow)
    let effective_cap = resolve_effective_capacity(…).await?;
    if effective_cap == 0 { return Ok(None); }
    …
}
```

### Option B — raise the per-worker default capacity

If a 1-task-per-worker policy is intentional, accept that operators
can't re-claim and instead change the FE flow to NOT call `/claim`
when the user already has an active task — instead `getQueue()` and
filter to their own assignment. More invasive but aligned with the
stated capacity policy.

### Option C — hybrid: a new endpoint

Add `GET /api/v1/work/my-active` that returns the operator's
already-assigned task without going through `/claim`. The FE calls it
before `/claim` to detect the resume case. Cleanest separation but
adds a new route + FE wiring.

My bias: **Option A** — smallest blast radius, preserves the historic
behaviour that the FE already depends on, no FE changes needed.

## Reproduction

```bash
# As any worker who already has 1 in_progress cycle_count work_task:
curl -X POST $WORK_SERVICE_URL/api/v1/work/claim \
  -H "Authorization: Bearer $JWT" \
  -H "X-Organization-ID: c9d89a74-…"
# Expected: 200 OK { success: true, task: { … the in-flight task … } }
# Actual:   200 OK { success: false, message: "No tasks available", task: null }
```

Clear it by completing or releasing the in-flight `work_tasks` row.

## Side-quests surfaced (own scoped tasks)

1. **Backlog gap**: 3,515 pending `rr_cyclecount_data` rows but only 12
   pending `work_tasks` rows for tenant `c9d89a74`. Either the
   dispatcher's promotion path is selective (priority filter? zone
   filter?), OR a backfill job hasn't run since the new work_tasks
   table came online. Worth a separate investigation to understand
   whether this is intentional throttling or a missing backfill.
2. **`resolved_zone = 'unresolved'`** on every recent cycle count row.
   The location-resolution job (Rack-Location service?) may have
   stopped running. Counts created on 2026-04-24 still have
   `resolved_zone = 'unresolved'` 2 weeks later.

## Severity

- **Operator UX:** Workers see "No tasks available" instead of being
  routed back to their in-flight count after a refresh / re-open.
  Workaround: complete or release the in-flight row first.
- **Data integrity:** None — the row stays correctly assigned in
  `rr_cyclecount_data`; only the resume UX is broken.
- **Observability:** Symptom is now QUIET on the FE (noise fix
  shipped — operators see the "Pull Next Count" idle state). Risk:
  the bug is no longer obvious from the browser console; supervisors
  will only notice via shift productivity drops.

## Related

- [[Fix-RF-CycleCount-Empty-Queue-Noise]]
- [[Rust-Work-Service]]
- [[Implement-Rust-Work-Service-Phase11]]


## Resolution — 2026-05-14

`status/active` → `status/resolved`. Fix shipped in this commit as
[[Fix-RF-Cycle-Count-Stuck-Waiting]] after the bug recurred in
production for operator **David Simmons** (one in-flight
`rr_cyclecount_data` row + a mirroring `work_tasks` projection +
`capacity_per_worker = 1` = silently locked out of RF cycle count
forever).

**Approach landed:** Option A from the original recommendations —
the smallest-blast-radius fix. A new `phase0_already_assigned_cycle_count`
helper in `rust-work-service/src/db/queries.rs` runs the
already-assigned read BEFORE `resolve_effective_capacity`, so an
operator who currently holds an in-flight count is always routed
back to their own row regardless of `capacity_per_worker`. Phase 2
(new-claim) behaviour unchanged.

**Strategy filter on Phase 0:** intentionally **not** applied — same
rationale as Phase 1 inside `claim_next_cycle_count`. Returning an
operator's own in-flight row is a contract, not a candidate
selection.

**Scope of fix:** `cycle_count` only. Other `capacity_per_worker = 1`
task_types (zone_audit, replenish, kit_pick) follow the
`generic_claim_against_work_tasks` path and have no analogous Phase 1
short-circuit today; the same bug class exists there but is not
currently triggered in production. Filed as a follow-up in
[[Fix-RF-Cycle-Count-Stuck-Waiting]].

Regression test
`tests/dispatcher_phase1.rs::phase0_bypasses_capacity_gate_for_already_assigned_row`
seeds the exact production state (rr_cyclecount_data + work_tasks
rows, both in_progress, capacity=1) and asserts the call resolves to
the seeded row instead of `None`. Existing
`returns_already_assigned_row_first` test preserved.

Deploy via `railway up` on `rust-work-service`. No migration, no
frontend change.
