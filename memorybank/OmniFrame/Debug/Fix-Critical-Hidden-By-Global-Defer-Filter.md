---
tags: [type/debug, status/resolved, domain/backend, domain/database, cycle-count, priority-ordering, defer-scope, rust]
created: 2026-05-01
resolved: 2026-05-01
---

# Critical/Hot counts hidden from Pull Next by global defer filter

## Status — RESOLVED 2026-05-01 23:30Z

**Fix applied in two phases:**

1. **Immediate SQL unblock** — `cleared 26 rows (5 critical + 21 hot)` in `cycle_count_operator_deferred_counts` for org `c9d89a74-7179-4033-93ea-56267cf42a17`. Verified Phase 2 candidate set for Jai (`8fe94172-…`) now leads with all 5 critical IDs in priority order (`CC-20260424-1539, CC-20260425-0031, CC-20260425-0033, CC-20260425-0035, CC-20260425-0007`). All 5 are in zones `RK / RL / RP`. Confirms the priority-first ORDER BY shipped in 252 + redeployed in `rust-work-service v0.1.31` is correct — the only blocker was upstream candidate elimination by the global defer filter.

2. **Permanent Rust patch** — `rust-work-service/src/db/queries.rs` and `rust-work-service/src/api/routes/work.rs` updated. Three call sites fixed:
   - `claim_next_cycle_count` Phase 2: `AND user_id = $2` added to defer subquery.
   - `get_pending_cycle_counts(pool, org_id)` → `get_pending_cycle_counts(pool, org_id, auth_user_id: Uuid)`. `WHERE … AND user_id = $2` added; route handler updated to thread `user.user_id` through.
   - `get_queue_stats(pool, org_id)` → `get_queue_stats(pool, org_id, auth_user_id: Uuid)`. `pending` subquery scoped to `user_id = $2`; `deferred_pending` left global as admin signal. Route handler updated similarly.

   Phase 1 (`assigned_to = $2`), Phase 3 / `get_deferred_count_for_user` (already `d.user_id = $1`), and `get_worker_tasks` (already `assigned_to = $1`) untouched — they were already correctly scoped.

   The scheduler `broadcast_queue_stats` (org-scoped WS payload, single fan-out per org) intentionally keeps global defer semantics — the WS broadcast can't represent per-recipient computation. Migration 253's "REST and WS match 1:1" goal is preserved AT THE ORG LEVEL; the per-operator REST flavor is a strict superset of information.

   **Verification:** `cargo check` clean (1.10s), `cargo test` 16/16 pass (8 lib + 8 bin). Diff: `+89 / -10` LOC across two files. Lints clean.

   **Awaiting redeploy.** Run `cd rust-work-service && railway up` (Railway service `fac8472c-199b-41ec-8806-a869ee96e783`). Until then, the SQL unblock keeps the floor running by clearing the 26 specific stranded rows; new defers by other operators will continue to behave as a global block-list against critical/hot rows in this org until the new binary boots.

## Symptom

User **Jai Singh** (`8fe94172-0267-4b14-96bd-06f8691bb04c`, superadmin, org `c9d89a74-7179-4033-93ea-56267cf42a17`) opened the RF cycle-count interface at 2026-05-01 23:14:46 UTC and was served `CC-20260421-2345` at `K2-71-02-2` with priority **NORMAL**, despite 5 critical and 21 hot counts existing in the unassigned pool.

Initially suspected to be a re-occurrence of [[Cycle-Count-Bug-Fix-Pass-2026-05-01]] Bug C (priority not first). Forensics ruled that out — the actual cause is unrelated.

## Root cause

`rust-work-service/src/db/queries.rs::claim_next_cycle_count` Phase 2 excludes deferred counts with a **GLOBAL** filter rather than per-operator:

```sql
AND rcc.id NOT IN (
  SELECT count_id FROM cycle_count_operator_deferred_counts
  WHERE is_active = true        -- ❌ no user_id scope
)
```

The `cycle_count_operator_deferred_counts` table tracks per-operator skips (it has a `user_id` column). The function name `skip_cycle_count_for_operator` and the schema make the per-operator intent explicit. But the Rust Phase 2 filter ignores `user_id`, so a count deferred by operator A becomes invisible to operator B's Pull Next.

Forensic snapshot at the time Jai pulled:

| Priority | Total unassigned | Deferred by other operators | Eligible for Jai |
|---------:|-----------------:|----------------------------:|-----------------:|
| critical | 5                | 5 (all)                     | 0                |
| hot      | 21               | 21 (all)                    | 0                |
| normal   | 4094             | 66                          | 4028             |

Deferred-by breakdown for the 26 critical+hot rows: Erick Robinson 16, Benjamin Brewer 6, David Simmons 3, William Brewer 1. None deferred by Jai.

With the current global filter, the Phase 2 candidate scan for Jai sees zero critical, zero hot — so the priority-first ORDER BY (correctly shipped in 252 + redeployed in `rust-work-service v0.1.31`) is moot. The next-best candidate is the alphabetically-first normal in the warehouse: `K2-71-02-2` → `CC-20260421-2345`.

## Why the 252 audit missed this

252 + 253 focused on:
- Zone collision (NULL-zone fallback)
- Supervisor-assigned escalation race
- Phase 1/2 priority-first ORDER BY (shipped)
- Push-path supervisor stamps
- WS isolation, queue stats parity
- Pattern-aware Phase 1 collision filter
- `assign_next_cycle_count` grant tightening

No gap covered the per-operator-vs-global scope of `cycle_count_operator_deferred_counts`. The 252 smoke `Phase C` test only inserted two fresh rows and verified `ORDER BY priority FIRST` — it never inserted a deferred row, so the global-filter behavior was never exercised. Both review passes on top of 252 also looked at `claim_next_cycle_count` line-by-line but anchored on priority/zone/sticky logic, not the defer scope.

## Verified NOT the cause

| Hypothesis | Evidence |
|---|---|
| Rust binary is pre-252 | Latest deploy `c1cd4f50-c3dd-463c-a1f2-880e1844d5ea` SUCCESS at 2026-05-01 23:04:12 EDT (23:04 UTC) — AFTER migrations 252 (21:22Z) and 253 (22:55Z). Container started 23:05:59Z as `rust-work-service v0.1.31`. Jai's claim was 23:14:46Z, ~9 min later. |
| Phase 1 stale-assignment served Jai | Phase 1 only matches `assigned_to = $2`. Jai had no prior assignment when he opened the RF (worker_heartbeats had `current_task_id` set only AFTER the claim). |
| Sticky-zone preference | `cycle_count_zone_rules.sticky_zone = false` for this org. Sticky branch in Phase 2 ORDER BY is inert. |
| Zone-locked / zone-assigned | Zero rows in `cycle_count_zone_assignments`. None of the 26 critical/hot are in K2 (Jai's heartbeat zone) — they're in RK / RL / RP / RQ / ST / SU / SV. |
| Supervisor push to specific user | Zero critical/hot are currently `assigned_to IS NOT NULL`. No active push-mode rows in the pool. |
| `bypass_priorities` re-routes critical | `bypass_priorities = []`. No priority bypass active. |
| `treat_null_zone_as_locked` confused trigger | All critical/hot have non-null zones (RK / RL / etc.). Setting is `false` anyway. |
| Stale escalation wiped Jai's assignment | The earlier history on CC-20260421-2345 shows two notes from Jai's claim's predecessor (auto-release at 20:40, hard-unassign at 21:40 — both for James Dearman). These predate Jai's claim and are unrelated. |

## Reproducer (pure SELECT)

Run against prod, simulates Jai's Phase 2 candidate scan with the **current** global filter — returns 0 critical, 0 hot:

```sql
WITH cand AS (
  SELECT rcc.priority::text AS priority
  FROM rr_cyclecount_data rcc
  WHERE rcc.organization_id = 'c9d89a74-7179-4033-93ea-56267cf42a17'
    AND rcc.status IN ('pending','recount')
    AND rcc.assigned_to IS NULL
    AND rcc.id NOT IN (
      SELECT count_id FROM cycle_count_operator_deferred_counts
      WHERE is_active = true        -- current bug: no user_id scope
    )
) SELECT priority, count(*) FROM cand GROUP BY 1 ORDER BY 1;
-- → [{normal: 4028}]
```

Same query with the proposed per-operator scope — flips Jai's top-5 to ALL 5 criticals:

```sql
    AND rcc.id NOT IN (
      SELECT count_id FROM cycle_count_operator_deferred_counts
      WHERE is_active = true
        AND user_id = '8fe94172-0267-4b14-96bd-06f8691bb04c'   -- fix
    )
-- → [{critical: 5, hot: 21, normal: 4094}]
-- top 5 = CC-20260424-1539, CC-20260425-0031, CC-20260425-0033, CC-20260425-0035, CC-20260425-0007
```

## Fix

### Permanent (Rust patch, requires redeploy)

Scope every `cycle_count_operator_deferred_counts` filter on the per-operator path to `user_id = $current_user`:

- `claim_next_cycle_count` Phase 2 candidate scan (lines 366–369). Add `AND user_id = $2`.
- `get_pending_cycle_counts` (lines 94–97). Per-operator queue list — should mirror Phase 2 semantics. Add `AND user_id = $auth_user`. (Note: `get_pending_cycle_counts` currently takes only `org_id` — the caller / route handler must pass the auth'd user id through.)
- `get_queue_stats` `pending` field (lines 127–133). Same — admin views should EXCLUDE per-operator defers from the per-operator queue total. Keep `deferred_pending` global as an admin signal.
- `get_pending_cycle_counts` is also called from contexts where there is no `user_id` (e.g. admin queue dashboards). For those callers, the global filter is correct. Best path: split into `get_pending_cycle_counts_for_operator(org, user)` (per-operator scope) vs `get_pending_cycle_counts_for_admin(org)` (global). All admin/UI surfaces stay on the global flavor; the RF / Pull Next surfaces switch to the per-operator flavor.

Phase 1 + Phase 3 + `get_worker_tasks` are already correctly scoped (Phase 1 on `assigned_to = $2`, Phase 3 on `user_id = $1`, `get_worker_tasks` on `assigned_to = $1`).

### Immediate (SQL, reversible)

Mark the 26 stranded critical/hot defers as inactive so the next Pull Next from any operator picks them up:

```sql
UPDATE cycle_count_operator_deferred_counts d
   SET is_active = false,
       cleared_at = NOW(),
       updated_at = NOW()
  FROM rr_cyclecount_data cc
 WHERE d.count_id = cc.id
   AND cc.organization_id = 'c9d89a74-7179-4033-93ea-56267cf42a17'
   AND cc.priority::text IN ('critical','hot')
   AND cc.status IN ('pending','recount')
   AND cc.assigned_to IS NULL
   AND d.is_active = true;
-- expected: 26 rows updated
```

Reversal (if the operator who deferred wants their queue back):

```sql
UPDATE cycle_count_operator_deferred_counts d
   SET is_active = true, cleared_at = NULL, updated_at = NOW()
  FROM rr_cyclecount_data cc
 WHERE d.count_id = cc.id
   AND cc.organization_id = 'c9d89a74-7179-4033-93ea-56267cf42a17'
   AND cc.priority::text IN ('critical','hot')
   AND d.cleared_at >= NOW() - INTERVAL '1 hour';
```

## Ship status (forensics for the report)

- Migration 252: applied in 5 batches between **2026-05-01 21:22:44Z and 21:24:17Z** (1.5 hr before Jai's claim). Live.
- Migration 253: applied at **2026-05-01 22:55:06Z** (~20 min before Jai's claim). Live.
- Rust deploy `c1cd4f50` SUCCESS at **2026-05-01 23:04:12 EDT = 23:04:12Z**. Container booted **23:05:59Z** as `rust-work-service v0.1.31`. Live and serving.
- Jai's claim: **2026-05-01 23:14:46Z** — 9 minutes after the new container booted. The priority-first ORDER BY in Phase 1 + Phase 2 IS in the running binary. The bug is upstream of ORDER BY — the candidate set itself is empty of critical/hot.

## Related

- [[Cycle-Count-Bug-Fix-Pass-Migration-252]] — priority-first ORDER BY (correct, in production).
- [[Cycle-Count-Final-Hardening-Pass-Migration-253]] — supervisor stamp / WS isolation / queue stats / pattern-aware collision (all correct, in production).
- [[Cycle-Count-Bug-Fix-Pass-2026-05-01]] — sibling debug for 252.
- [[Per-Operator-vs-Global-Defer-Scope]] — pattern note for future refactors.
