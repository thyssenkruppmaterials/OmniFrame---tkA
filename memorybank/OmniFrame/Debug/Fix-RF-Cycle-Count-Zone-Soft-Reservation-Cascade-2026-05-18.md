---
tags: [type/debug, status/active, domain/backend, domain/database, cycle-count, work-engine, zone-engine]
created: 2026-05-18
---
# Fix RF Cycle Count Zone Soft-Reservation Cascade (2026-05-18)

## Symptom

Operator **Marvin Berry** (`fb6e0266-5e52-461a-8a2d-7db73c5814c1`,
tenant `c9d89a74-…`) signed in to the RF, completed his last cycle
count at **14:51:02Z** (10:51 AM EDT), then was unable to claim any
new counts for the rest of the afternoon. By the time the user
reported the issue around **19:40Z** (3:40 PM EDT), Marvin had hit
`No tasks available` ~85 times in Railway logs since **15:34Z** (and
~13 more between 13:02Z and 14:51Z earlier in the day, almost
certainly from earlier instances of the same bug class).

He saw counts in his queue listing (the `/work/queue` view returned
`task_count=100` every poll), but `/work/claim` returned silent
empties. UI symptom matches the user's verbatim phrasing — "it does
not show up all the counts and keeps them stuck": queue _shows_
counts, but tapping Pull Next never advances.

## NOT the 2026-05-14 capacity-gate bug

[[Fix-RF-Cycle-Count-Stuck-Waiting]] / Phase 0 / v0.1.42 is **live
and working** — `/health → 0.1.42`, deployment
`90ea509c-095e-4505-95fd-583948616bba`, image digest
`sha256:60070ba31aae6f87d617c5ab7610d15b8a7cc66a499824c5434d32c68da55773`.
No new deploys since 2026-05-14. Marvin's row state today is:

| Predicate | Marvin |
|---|---|
| `rr_cyclecount_data` (`assigned_to=marvin AND status IN ('pending','in_progress','recount')`) | **0 rows** |
| `work_tasks` (`assigned_to=marvin AND status IN ('claimed','in_progress')`) | **0 rows** |
| Active defers (`is_active=true`) | **0 rows** (25 historical, all `cleared_at` set) |
| Capacity check | `open_total=0, open_per_type=0, cap_per_worker=1` → `effective_cap=1` (NOT exhausted) |

Phase 0 correctly returns `None` (he has no in-flight row to resume).
The capacity gate correctly passes (`1 > 0`). Dispatch falls through
to Phase 2 of `claim_next_cycle_count` (the new-claim path) — and
**Phase 2's candidate scan returns zero rows** despite **383
unassigned `pending` counts** existing org-wide.

## Root cause (file:line + SQL predicate)

`rust-work-service/src/db/queries.rs::claim_next_cycle_count` Phase 2
candidate-scan SQL at **lines 443-462** (the zone-mutual-exclusion
filter, originally migration 228 + 232 + 233):

```sql
AND (
  rcc.zone IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM cycle_count_zone_rules zr
    WHERE zr.organization_id = rcc.organization_id
      AND zr.enabled = true
      AND zr.policy = 'one_counter_per_zone'
      AND EXISTS (
        SELECT 1 FROM rr_cyclecount_data occupied
        WHERE occupied.organization_id = rcc.organization_id
          AND COALESCE(public.cycle_count_zone_of(occupied.location, zr.zone_pattern), occupied.zone)
              = COALESCE(public.cycle_count_zone_of(rcc.location, zr.zone_pattern), rcc.zone)
          AND occupied.assigned_to IS NOT NULL
          AND occupied.assigned_to <> $2
          AND occupied.status IN ('pending','in_progress','recount')  -- ← includes plain 'pending'!
      )
  )
)
```

Inline comment (verbatim):

> A zone is BUSY for the current operator when any other user has either:
>   * an actively-counting row (in_progress / recount), OR
>   * a soft-released reservation (pending + assigned_to set).

The "soft-released reservation" branch is the foot-gun. With
`policy='one_counter_per_zone'`, `zone_pattern=NULL` (so the
COALESCE falls through to `rcc.zone`), and **ALL 383 unassigned
pending RP counts on this org sitting in `zone='RP'`**, a single
operator's stale `pending+assigned` row in zone `RP` cascades into
locking the entire `RP` zone for the whole floor.

Today the single occupying row is:

| Field | Value |
|---|---|
| `id` | `ab9cba7c-cab1-47f2-947f-4dd52c12f37c` |
| `count_number` | **CC-20260424-1312** |
| `location` | `RP-47-B-01` |
| `zone` | **`RP`** |
| `status` | `pending` |
| `push_mode` | `pull` (NOT a push assignment — `pushed_by=null`, `pushed_at=null`) |
| `assigned_to` | `19afea2d-9e89-482f-9ff5-82056e95d3dd` (**James Dearman**) |
| `assigned_at` | **2026-05-18 17:31:50.581825+00** (≈ 2h14m before the user reported) |
| `updated_at` | 2026-05-18 18:11:35.818738+00 |
| `counter_name` | "James Dearman" (denormalised) |

Sequence:

1. James completed `CC-20260424-1311` at `17:31:44Z`.
2. James tapped Pull Next → `claim_next_cycle_count` Phase 2
   returned `CC-20260424-1312` → he landed on the Confirm screen.
3. James never tapped Confirm — closed tab, signed out, RF lost
   battery, walked away, etc.
4. Row state stuck at `status='pending', assigned_to=james`.
5. From `17:31:50Z` onward, every other operator's Phase 2 candidate
   scan finds `1312` matches the "soft-released reservation"
   predicate and treats zone `RP` as occupied → eliminates ALL 383
   candidates → returns empty → `claim_next_task` returns `Ok(None)`
   → route logs `No tasks available`.
6. The **`reservation_escalation_minutes = 60` escalator only
   downgrades `in_progress → pending`**. A row already in
   `pending+assigned` state is never reaped. (Confirmed in the
   2026-05-14 PM debug note's escalator description.)

## Reproduction (read-only, Supabase MCP `execute_sql`)

```sql
-- 1. Baseline: 383 unassigned pending in his org.
SELECT COUNT(*) FROM rr_cyclecount_data
 WHERE organization_id = 'c9d89a74-7179-4033-93ea-56267cf42a17'
   AND status IN ('pending','recount')
   AND assigned_to IS NULL;
-- → 383

-- 2. Zone distribution.
SELECT zone, COUNT(*) FROM rr_cyclecount_data
 WHERE organization_id = 'c9d89a74-7179-4033-93ea-56267cf42a17'
   AND status IN ('pending','recount')
   AND assigned_to IS NULL
 GROUP BY zone;
-- → ('RP', 383)  -- single zone, every candidate in 'RP'

-- 3. Step 1 + zone-mutual-exclusion filter ONLY.
--    (Same predicate as queries.rs:443-462, $2 = marvin.)
-- → 0  -- ALL 383 candidates eliminated by zone filter

-- 4. Hypothetical: re-run #3 with James's stuck row excluded
--    (occupied.id <> 'ab9cba7c-...').
-- → 383  -- one row is the sole bottleneck

-- 5. Phase 0 helper for Marvin — would return None (he holds nothing).
-- → 0 rows
```

## Log evidence (Railway, `rust-work-service` v0.1.42)

```
17:31:50Z  James claimed CC-20260424-1312 via Pull Next (rr_cyclecount_data INSERT/UPDATE)
17:46:25Z  No tasks available  user_id=fb6e0266 (Marvin)   task_type=cycle_count   [+15 min after James's claim]
18:11:25Z  No tasks available  user_id=8fe94172 (Jai)       task_type=cycle_count   [admin testing]
18:11:34Z  No tasks available  user_id=8fe94172 (Jai)       task_type=cycle_count
19:09:36Z  No tasks available  user_id=fb6e0266 (Marvin)   task_type=cycle_count
19:17:01Z  No tasks available  user_id=fb6e0266 (Marvin)
19:17:17Z  No tasks available  user_id=f0adc77a (Devon Melsheimer)
19:39:29Z  No tasks available  user_id=fb6e0266 (Marvin)
19:39:57Z  No tasks available  user_id=fb6e0266 (Marvin)
19:41:45Z  No tasks available  user_id=f0adc77a (Devon)
19:42:41-19:43:52Z   ~12 consecutive failures across Marvin + Devon
```

ZERO `Phase 0 returning already-assigned row` log lines (correctly —
Marvin holds nothing). ZERO `capacity exhausted` log lines (correctly
— his `effective_cap = 1`). The path went all the way through to
`claim_next_cycle_count` and returned `None` because the Phase 2
candidate scan returned zero rows.

## Scope (BUG CLASS — affects EVERY operator working zone RP)

Current org snapshot (`worker_heartbeats`, `last_heartbeat > now() - interval '5 minutes'`):

| Operator | role | heartbeat status | claim attempts logged today | status |
|---|---|---|---|---|
| James Dearman | tka_associate | idle | many earlier in the day; **holds the stuck row** | Self-blocked (would resume via Phase 0 if he taps Pull Next) |
| Marvin Berry | tka_associate | idle | **85+** in the period 15:34Z–19:44Z | Blocked |
| Devon Melsheimer | tka_associate | idle | 5 (19:17Z–19:43Z) | Blocked |
| Jai Singh (admin/test) | superadmin | idle | 2 (18:11Z) | Blocked |
| Darnell Holmes, Ed Brummett, Roger Rojas, Megan Osborne, Serenna Bottoms | tka_associate | idle | 0 (haven't tried Pull Next in the window I sampled) | Will be blocked the moment they try |

All 9 operators online right now will fail Pull Next on a
cycle_count claim until `1312` is cleared.

The class of bug recurs any time **any operator does Pull Next on a
zone-rule-active org, lands on the Confirm screen, and abandons
without explicit release**. With `zone_pattern=NULL` on this org's
single zone rule, the cascade radius is the entire `zone` field —
which today is `RP` for 100% of unassigned counts.

Tenants with finer-grained `zone_pattern` (e.g. per-aisle regex)
would see narrower cascades. Tenants with no zone rule enabled would
be immune.

## Operational unblock (preferred — NO code/SQL changes)

### Option A — Admin Unassign via UI (recommended; 30 seconds)

1. Navigate to **Inventory Management → Count Settings → Zone
   Rules** (or wherever the **Stuck Assignments** card lives in the
   current shell).
2. Find **CC-20260424-1312** — counter James Dearman, location
   `RP-47-B-01`, assigned ≥ 134 min ago.
3. Tap **+ Unassign**.
4. Refresh effect is **immediate**: the next Pull Next from any
   operator (Marvin, Devon, et al.) will succeed and pull the next
   ranked candidate from the now-unblocked 383-row pool.

### Option B — James self-resume (if he's still on shift)

1. Have James sign in to the RF → tap **Cycle Count**.
2. Phase 0 (cycle_count helper) reads `rr_cyclecount_data` for
   `assigned_to=james AND status IN ('pending','in_progress','recount')`
   → returns **CC-20260424-1312** → routes him to the Confirm screen
   for `RP-47-B-01`.
3. James either completes the count (zone unblocks) OR releases
   the row (zone unblocks the same).

### Option C — Targeted SQL (awaiting consent — NOT executed by this pass)

```sql
-- ONE row; SELECT-first to confirm the target, then UPDATE.
-- NOT executed by this investigation pass. Per task constraint:
-- "DO NOT run any UPDATE/DELETE/INSERT against rr_cyclecount_data
--  or work_tasks without explicit user consent."
UPDATE rr_cyclecount_data
   SET assigned_to   = NULL,
       assigned_at   = NULL,
       counter_name  = NULL,
       updated_at    = NOW()
 WHERE id = 'ab9cba7c-cab1-47f2-947f-4dd52c12f37c'
   AND status = 'pending'
   AND assigned_to = '19afea2d-9e89-482f-9ff5-82056e95d3dd'
RETURNING id, count_number, status::text, assigned_to;
-- → expect 1 row updated
```

## Code-side follow-ups (NOT implemented; surface for decision)

1. **Tighten the zone-mutual-exclusion predicate** at
   `queries.rs:443-462` (Phase 2 candidate scan) AND at
   `queries.rs:1792-1808` (Phase 0 helper's matching filter) to
   only count `('in_progress','recount')` as occupying — drop the
   bare `'pending'` branch from the "soft-released reservation"
   layer. Today's design is intentional (per the inline comment)
   but the operational pattern proves the foot-gun is real. Trade-off:
   tightening it removes the "soft reservation" UX intent — two
   operators _could_ both end up landing on counts in the same zone
   if they tap Pull Next simultaneously. Whether that's a meaningful
   regression depends on how often the system currently relies on
   pending-as-soft-reservation for legitimate ordering vs how often
   it cascades the entire floor. **File as ADR before coding.**
2. **Extend the escalator** (per
   [[Fix-RF-Cycle-Count-Stuck-Waiting]] PM section's
   `reservation_escalation_minutes`) to also downgrade
   `pending+assigned` rows older than the threshold to
   `pending+unassigned`. Catches today's stuck-mid-claim case
   automatically and bounds the cascade window to the threshold
   instead of "until admin notices". Less risky than #1; preserves
   the soft-reservation semantics for the threshold window.
3. **Surface a Stuck Assignments banner / canary on the admin
   dashboard** that fires when ANY row sits `pending+assigned` for
   more than ~10 minutes. Today the data is visible in the existing
   Stuck Assignments card but only admins who navigate there will
   see it. A live banner ("1 row in zone RP is blocking 9
   operators") would catch this in seconds.
4. **Auto-release on UI exit** — when the FE Confirm screen is
   closed (tab close, sign-out, navigation away) without an explicit
   Release/Confirm action, the FE could fire a best-effort
   `/work/release` on `beforeunload`. Today's behaviour is "row stays
   assigned forever". Not bulletproof (e.g. network drop, browser
   crash) but covers the common case.
5. **Alert when `claim_next_task` returns `None` AND the candidate
   set is non-empty pre-zone-filter** — prod-safe canary on the
   server side that emits a `WARN` log when there are >50 unassigned
   pending rows in the org and a claim still returns `None`. Today's
   `INFO No tasks available` doesn't distinguish "queue empty" from
   "queue non-empty but all zone-blocked", so the bug is invisible
   without explicit SQL inspection.

## Quality gates (this pass)

Read-only investigation. No code edits. No DB writes. No deploys.
No migrations.

- Verified live `/health → {"status":"healthy","version":"0.1.42","service":"rust-work-service"}`.
- Verified Railway deployment list — latest SUCCESS is
  `90ea509c-095e-4505-95fd-583948616bba` from 2026-05-14T16:29:45Z,
  image digest `sha256:60070ba31aae6f87d617c5ab7610d15b8a7cc66a499824c5434d32c68da55773`.
  Matches the user's prompt — no drift since 2026-05-14.
- Reproduced Phase 0 helper SQL for Marvin → returns 0 rows
  (correctly — he holds nothing).
- Reproduced Phase 2 candidate scan SQL for Marvin → returns 0 rows
  (matches the prod symptom).
- Pulled Railway logs (`get-logs deploy --filter "fb6e0266"`, 500
  lines) — corroborates: 5 `No tasks available` lines for Marvin
  today between 17:46Z and 19:44Z. ZERO Phase 0 or capacity-exhaust
  log lines for him.
- Pulled Railway logs (`get-logs deploy --filter "No tasks available
  AND cycle_count"`, 500 lines) — confirms Marvin (`fb6e0266`),
  Devon (`f0adc77a`), and Jai (`8fe94172`) all hitting the same
  empty-claim pattern in the same window.
- `agent_triggers` table: 2 enabled rules, both unchanged since
  2026-05-14 (`Auto-Confirm Completed Putaways` and
  `Auto-Confirm Completed Picks → LT12`). Phase 9 evaluator is
  healthy.

## Related

- [[Fix-RF-Cycle-Count-Stuck-Waiting]] — 2026-05-14 capacity-gate
  Phase 0 fix; verified live, not the cause of today's incident.
- [[Fix-Trigger-Evaluator-Empty-After-v041-Restart]] — 2026-05-14
  trigger-loader retry; healthy, not implicated.
- [[ADR-Pooler-Mode-Flip-Session-To-Transaction]] — sibling ADR;
  unrelated.
- [[Investigate-Work-Tasks-Capacity-Gate-Returning-Existing-Task]]
  — closed 2026-05-14.
- [[Sessions/2026-05-18]] — today's session log (this incident).
- `supabase/migrations/228_zone_column_perf.sql`
- `supabase/migrations/232_zone_reservation_enforcement.sql`
- `supabase/migrations/233_zone_engine_hardening.sql`
- `supabase/migrations/252_cycle_count_bug_fix_pass.sql`
- `supabase/migrations/266_work_tasks_zone_exclusivity.sql` — DB
  trigger that's the authoritative guard at write time; the Phase 2
  SQL filter is a fast-path pre-filter that today is too aggressive.
- `rust-work-service/src/db/queries.rs` Phase 2 SQL — lines
  443-462 + 1792-1808 carry the offending `('pending','in_progress','recount')`
  status filter on the `occupied` join.
