---
tags: [type/debug, status/active, domain/frontend, domain/backend, domain/database, cycle-count]
created: 2026-05-12
---
# Investigate: Cycle Counts Hidden in Shift Productivity Dashboard

## Symptom

On the `Shift Productivity → Team Performance → All Associates` view
(`/apps/shift-productivity`), most Inventory Control associates show
**"No activity"** even though cycle counts are happening throughout the
day. Expanding a row that does show a task (e.g. *David Simmons — Material
Handler / Inventory Control*) shows `1 task, 100% efficiency` and a
`LEGEND` row but **no task-breakdown bars on the Gantt** — the timeline is
effectively empty.

Meanwhile Outbound Shipping rows (e.g. *Elaine Williams, Shipping Clerk —
8 tasks, 15% efficiency*) render normally, proving the dashboard data
pipeline isn't globally broken.

This is a **review-only** session — no code changes were made.

## Data path

1. UI: [`AssociatePerformanceRow`](../../../src/features/shift-productivity/team-performance/components/associate-performance-row.tsx)
   inside [`TeamPerformanceDashboard`](../../../src/features/shift-productivity/team-performance/team-performance-dashboard.tsx),
   wired by [`useTeamPerformance`](../../../src/features/shift-productivity/team-performance/hooks/use-team-performance.ts).
2. Service: [`TeamPerformanceService.getTeamProductivity`](../../../src/lib/supabase/team-performance.service.ts)
   fires 4 parallel RPCs:
   - `get_shift_assignments_with_details(p_organization_id)`
   - `get_team_productivity_counts(org, start, end)` → today's RPC body lives in
     `supabase/migrations/188_add_cart_stow_to_productivity.sql` (replaces
     the older dynamic 091/093 implementation).
   - `get_team_activity_events(org, start, end)` → also from 188.
   - `labor_standards` select (for efficiency).
3. Cycle count source table: `rr_cyclecount_data`.

## Root cause — three compounding filters

Migration 188 is the **active** definition of both productivity RPCs.
For cycle counts they look like:

```sql
-- get_team_productivity_counts (per-user totals → drives the row's task count)
cyclecount_counts AS (
  SELECT assigned_to AS uid, COUNT(*) AS cnt
  FROM rr_cyclecount_data
  WHERE organization_id = p_organization_id
    AND status IN ('completed', 'approved')
    AND completed_at >= p_start_date
    AND completed_at <= p_end_date
    AND assigned_to IN (
      SELECT au.uid FROM active_users au  -- shift_assignments active+primary
    )
  GROUP BY assigned_to
)

-- get_team_activity_events (timestamped events → drives the Gantt)
SELECT rcd.assigned_to, 'cycle_count', COALESCE(rcd.completed_at, rcd.created_at), 'Inventory'
FROM rr_cyclecount_data rcd
WHERE rcd.organization_id = p_organization_id
  AND rcd.status IN ('completed', 'approved')
  AND rcd.created_at >= p_start_date    -- ⚠️ created_at, not completed_at
  AND rcd.created_at <= p_end_date
  AND rcd.assigned_to IN (SELECT au.uid FROM active_users au)
```

Three filters drop legitimate cycle count work before it reaches the UI:

### Bug A — `created_at` vs `completed_at` mismatch in the events RPC (Gantt blocks vanish)

The counts RPC filters by `completed_at` (the natural "when was the work
done" timestamp). The events RPC filters by `created_at` (when the task
row was inserted into the queue, often days earlier).

A cycle count created last night at 21:14 EDT and completed this morning at
08:29 EDT therefore:

- **Is counted** by `get_team_productivity_counts` → the associate row shows
  `1 task`.
- **Is filtered out** by `get_team_activity_events` (its `created_at` falls
  outside today's UTC window) → the Gantt has no block for it, the
  `taskBreakdown` is empty, the legend renders without any swatches.

This is exactly the David Simmons row in the screenshot. SQL confirmation
(today, 2026-05-12, 08:42 EDT):

- 22 of today's completed cycle counts were created on a previous day.
- David Simmons' single `CC-20260512-0007` row: `created_local = 2026-05-11
  21:14`, `completed_local = 2026-05-12 08:29`. Counts as `1 task` but no
  Gantt block.

Every other activity source in the same RPC filters by its **action**
timestamp (`scanned_at`, `picked_at`, `packed_at`, etc.). Cycle count is
the only outlier — almost certainly a copy-paste regression when 188 was
written.

### Bug B — Cycle counts attributed to users with no shift_assignment are silently dropped

Both RPCs require `assigned_to IN (SELECT user_id FROM shift_assignments
WHERE status='active' AND is_primary_position=true)`. Today's organization
`c9d89a74` data:

- 24 completed cycle counts since EST midnight.
- 17 of them assigned to **Marvin Berry** (`fb6e0266-…`), whose
  `user_profiles.status='active'` but who has **zero rows in
  `shift_assignments`**. His 17 counts are invisible to the dashboard.
- Over the last 7 days, Marvin alone owns 165 completed cycle counts that
  the dashboard silently drops.
- On 2026-05-11: 277 completed cycle counts, 165 (≈60%) excluded by the
  active-primary-position filter — all 165 belong to Marvin.

Why he owns so many is a separate operational question (system / supervisor
bulk handler, missing onboarding step, agent-driven assignment, etc.), but
the dashboard's failure mode is silent: there's no "unassigned",
"unconfigured user", or "missing assignment" bucket in the UI to surface
these rows.

### Bug C — `variance_review` cycle counts are excluded from "completed work"

The `status IN ('completed', 'approved')` filter excludes
`variance_review` (and `recount`, `awaiting_supervisor_signoff`,
`cancelled`). On many days `variance_review` rows are negligible, but
several of today's 8 actual cycle-count completions sit in
`variance_review` (6/8 = 75%). Across the live `rr_cyclecount_data` snapshot
223 rows are in `variance_review` waiting on supervisor sign-off.

This is arguably **intended** (variance_review is not yet "approved"
work), but it's worth surfacing in the UI rather than treating the work as
if it never happened. The associate did the count; the supervisor hasn't
reviewed it yet.

## What is _not_ the problem

- ✅ `activity_source_config` has an active, system-owned row for
  `cycle_count` (source_table=`rr_cyclecount_data`, user_id_column=
  `assigned_to`, timestamp_column=`completed_at`,
  where_conditions=`{"status":["completed","approved"]}`). No
  configuration is missing.
- ✅ The frontend row, gantt, legend, and breakdown components all
  understand `cycle_count` / `cycle_counts`. No frontend filter hides them.
- ✅ The labor-standards efficiency calculation maps `count`, `cycle_count`,
  `counting` aliases correctly
  ([`team-performance.service.ts`](../../../src/lib/supabase/team-performance.service.ts) lines
  1570–1633).
- ⚠️ Migration 091/093 made the RPCs read from `activity_source_config`
  dynamically. Migration **188 reverted both RPCs to hardcoded UNION ALL**
  blocks (to add `cart_stow` + `customer_response`). The config table is
  now decorative for these two RPCs — it still drives nothing on the
  current code path.

## Concrete fix path (NOT applied — review only)

### Bug A fix (the screenshot bug)

[`supabase/migrations/188_add_cart_stow_to_productivity.sql`](../../../supabase/migrations/188_add_cart_stow_to_productivity.sql)
lines 221–232 — change the Cycle counts UNION arm to filter by
`completed_at`:

```diff
   -- Cycle counts
   SELECT
     rcd.assigned_to AS user_id,
     'cycle_count'::TEXT AS event_type,
     COALESCE(rcd.completed_at, rcd.created_at) AS event_timestamp,
     'Inventory'::TEXT AS area
   FROM rr_cyclecount_data rcd
   WHERE rcd.organization_id = p_organization_id
     AND rcd.status IN ('completed', 'approved')
-    AND rcd.created_at >= p_start_date
-    AND rcd.created_at <= p_end_date
+    AND rcd.completed_at >= p_start_date
+    AND rcd.completed_at <= p_end_date
     AND rcd.assigned_to IN (SELECT au.uid FROM active_users au)
```

Ship this as a small forward migration that re-creates
`get_team_activity_events`. After the change, every cycle count that the
row's task counter shows will also have a Gantt block on the same day.

### Bug B mitigations

Two options, not mutually exclusive:

1. **Data fix (no code change):** ensure every user who appears in
   `rr_cyclecount_data.assigned_to` for completed work has an `active`,
   `is_primary_position=true` row in `shift_assignments`. Marvin Berry
   and similar rows are the immediate offenders — open the Labor
   Management → Unassigned Users tab and assign them to a working area.
2. **Code fix:** add a fallback bucket. Either widen `active_users` to
   include any `user_profiles.status='active'` row, OR add an
   "Unassigned associates" group in the dashboard so their work is
   visible-but-flagged. Discuss in an ADR before changing the filter —
   the current filter prevents bot/system users (e.g. omni_agent
   service accounts) from polluting the team view.

### Bug C mitigation (optional)

Decide explicitly whether `variance_review` is "work done" for the
purposes of this dashboard. If yes, extend the status list to
`('completed', 'approved', 'variance_review')` in both RPC arms; if no,
add a separate "pending review" stat / chip so it's not silent.

## Open questions

1. **Marvin Berry**: is he an operator, a supervisor bulk-handler, a
   service account, or a leftover that should be deleted? The same
   question applies to anyone else owning completed counts without a
   shift_assignment.
2. **`created_at` vs `completed_at` semantics**: confirm with the
   product owner that the dashboard should attribute a cycle count to
   the day it was *completed* (not created). This was clearly the
   original intent — the counts RPC and `activity_source_config` both
   use `completed_at`, and every other activity source filters by
   action time. The events RPC is the outlier.
3. **variance_review handling**: should the row's task count and the
   Gantt include `variance_review` rows? They're "done by the operator,
   waiting on supervisor sign-off" — they shouldn't be invisible.

## Files / line ranges to edit when fix is implemented

- `supabase/migrations/188_add_cart_stow_to_productivity.sql` lines
  221–232 → new migration recreating `get_team_activity_events` with
  cycle-count filter changed to `completed_at`.
- (Optional) `supabase/migrations/188_add_cart_stow_to_productivity.sql`
  lines 370–378 (`cyclecount_counts`) — if Bug C is in scope, widen
  `status IN (…)` and consider whether to use `completed_at` (current) or
  `COALESCE(completed_at, updated_at)`.
- Labor Management → Unassigned Users action for the Marvin Berry-style
  rows (no code change).

## Related
- [[ShiftProductivity - Feature Module]]
- [[TeamPerformance - Supabase Service]]
- [[ProductivityAndSettings - Supabase Service]]
- [[Redesign-ShiftProductivity-Associate-Row]]
- [[Fix-CycleCount-Completed-With-Variance]]
- [[Cycle-Count-Bug-Fix-Pass-2026-05-01]]
- [[Work-Engine-Roadmap-Cycle-Counts-To-Picks-Putaways]]


## 2026-05-12 follow-up — David Simmons empty Gantt

### User observation (8:47 PM EDT)

David Simmons (Material Handler, Inventory Control) shows
**41 tasks at 100% efficiency** but the expanded Gantt strip shows only
the legend (Shift Time / Break / Overtime End) with very little
activity. User asked: if it's only Bug A, how can 41 tasks completed
today be so invisible — wouldn't most of them be created today too?

### Live evidence — Bug A is 100% sufficient for David's cycle counts

David's user_id: `cbe23c27-51fa-4986-a9d1-ab9159fff409`. Active primary
`shift_assignments` row exists (so the `active_users` CTE doesn't drop
him — Bug B not in play). Today's UTC window passed by
`team-performance.service.ts:1231` for an EDT session is
`2026-05-12T04:00:00Z … 2026-05-13T03:59:59.999Z`.

Simulating each RPC arm against the raw tables, scoped to David:

| Activity arm | counts-RPC arm | events-RPC arm | Notes |
|---|---|---|---|
| `inbound_scans` | 0 | 0 | no inbound work |
| `cart_stows` | 0 | 0 | no cart stow work |
| `putaways` | 14 | 14 | both arms use `rpo.created_at` — agree |
| `picking` | 0 | 0 | not his role |
| `packed` / `shipped` / `final_packed` | 0 | 0 | not his role |
| `putbacks` | 0 | 0 | none today |
| **`cycle_counts`** | **27** | **0** | **Bug A: events filters `created_at`, counts filters `completed_at`** |
| `customer_responses` | 0 | 0 | none |
| **Total** | **41** | **14** | matches the dashboard's 41-tasks/100% number exactly |

So Bug A drops **27 of 27** of David's cycle counts (100%). Every
single one of today's 27 completed counts was *created on a previous
day* and only assigned/completed today:

- 8 rows created `2026-05-12 01:14 UTC` (= 2026-05-11 21:14 EDT) — last
  night's batch.
- 17 rows created `2026-04-24 11:45 UTC` (= 2026-04-24 07:45 EDT) —
  a bulk import from 18 days ago.
- 2 rows created `2026-04-21 11:08 UTC` (= 2026-04-21 07:08 EDT) —
  21 days ago.

In this org, cycle counts are mass-created upfront in nightly/weekly
batches and worked off later. The premise that "plenty of time today
to create AND complete" turns out to be wrong — virtually no count is
created and completed on the same day, so Bug A drops effectively
every same-day completion.

### Bug A blast radius — org-wide today

Replicating both arms across the org for 2026-05-12 (filtering to
active primary-position users only, mirroring both RPCs' `active_users`
CTE):

| Associate | counts arm (visible in row total) | events arm (visible on Gantt) | Dropped by Bug A |
|---|---|---|---|
| William Brewer | 79 | 3 | 76 |
| James Dearman | 39 | 3 | 36 |
| David Simmons | 27 | 0 | 27 |
| Erick Robinson | 28 | 3 | 25 |
| **TOTAL** | **173** | **9** | **164 (95%)** |

Org-wide (including users without active shift_assignments, i.e. before
the `active_users` filter), today 202 completed cycle counts → only 13
survive the events-RPC `created_at` filter → **189 (93.5%) silently
dropped from the Gantt**.

For comparison, the `putbacks` arm filters by `created_at` in BOTH
RPCs, so Detric Hardin (Outbound Shipping) — who has 33 putback
tickets today — shows up identically in both arms and renders a normal
Gantt. This is the inconsistency: every other UNION arm in the events
RPC filters by the same column the counts RPC uses, except the
cycle-count arm.

### Why "the rest of David's Gantt looks empty" too

The events RPC does return 14 putaway events for David, with
timestamps `2026-05-12 16:43-16:45 UTC` (3 events, ~12:43 EDT) and
`20:00-20:14 UTC` (11 events, ~16:00 EDT). Those are real Gantt blocks
that exist in the data — `buildDailyTimeline` and `buildActivityBlocks`
in `team-performance.service.ts` will turn them into 1–2 tight work
strips. They are probably visually present but **sparse and clustered
into two short bursts** (~6 minutes around 12:43 EDT, ~14 minutes
around 16:00 EDT), while 27 cycle-count blocks spread across
12:22 → 17:26 EDT would have dominated the strip if they weren't being
dropped. So the perceived emptiness is mostly the missing 27 cycle
counts; the 14 putaway blocks are present but easy to miss in the
5+ hour gap they sit inside.

### Bug C tally for David today

In the same window:
- 22 `completed`
- 5 `approved`
- 7 `variance_review` (excluded by status filter — Bug C; out of scope
  for this fix but worth noting that David alone would jump from
  27 → 34 if `variance_review` were included)

### Proposed forward migration (NOT applied — vault capture only)

A single column swap on lines 230–231 of
[`supabase/migrations/188_add_cart_stow_to_productivity.sql`](../../../supabase/migrations/188_add_cart_stow_to_productivity.sql).
Ship as a new migration that re-creates `get_team_activity_events` so we
leave 188 immutable:

```diff
--- supabase/migrations/188_add_cart_stow_to_productivity.sql
+++ supabase/migrations/304_fix_team_activity_events_cycle_count_filter.sql
@@ get_team_activity_events / Cycle counts arm @@
   -- Cycle counts
   SELECT
     rcd.assigned_to AS user_id,
     'cycle_count'::TEXT AS event_type,
     COALESCE(rcd.completed_at, rcd.created_at) AS event_timestamp,
     'Inventory'::TEXT AS area
   FROM rr_cyclecount_data rcd
   WHERE rcd.organization_id = p_organization_id
     AND rcd.status IN ('completed', 'approved')
-    AND rcd.created_at >= p_start_date
-    AND rcd.created_at <= p_end_date
+    AND rcd.completed_at >= p_start_date
+    AND rcd.completed_at <= p_end_date
     AND rcd.assigned_to IN (SELECT au.uid FROM active_users au)
```

Shape of the actual `304_fix_team_activity_events_cycle_count_filter.sql`
file (full `CREATE OR REPLACE FUNCTION` recreated so we don't depend on
`ALTER FUNCTION`'s per-arm semantics):

```sql
-- ============================================================================
-- Migration 304: Fix get_team_activity_events cycle-count timestamp filter
-- Description: The cycle-count UNION arm of get_team_activity_events filters
--              by rcd.created_at, which silently drops every completed count
--              whose create-side timestamp is outside the events window.
--              In OmniFrame, cycle counts are mass-created in nightly /
--              weekly batches and worked off later, so the prior filter
--              dropped ~93% of today's completed counts from the Gantt
--              while still counting them in get_team_productivity_counts
--              (which already filters by completed_at). Aligns the events
--              arm with the counts arm and with every other UNION arm in
--              this RPC (all of which filter by their action timestamp).
-- Related: memorybank/OmniFrame/Debug/Investigate-Shift-Productivity-Cycle-Counts-Hidden.md
-- ============================================================================

CREATE OR REPLACE FUNCTION get_team_activity_events(
  p_organization_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS TABLE (
  user_id UUID,
  event_type TEXT,
  event_timestamp TIMESTAMPTZ,
  area TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM validate_organization_access(p_organization_id);

  RETURN QUERY
  WITH active_users AS (
    SELECT DISTINCT sa.user_id AS uid
    FROM shift_assignments sa
    WHERE sa.organization_id = p_organization_id
      AND sa.status = 'active'
      AND sa.is_primary_position = true
  )

  -- … every UNION arm copied verbatim from migration 188 …
  -- (Inbound scans, Cart stows, Putaways, Putaway confirms, Picking,
  --  Pack, Ship, Final pack, Putbacks, Customer portal actions)

  -- Cycle counts — FIX: filter by completed_at (was created_at) so the
  -- Gantt timeline agrees with get_team_productivity_counts and reflects
  -- the day the work was actually performed.
  SELECT
    rcd.assigned_to AS user_id,
    'cycle_count'::TEXT AS event_type,
    COALESCE(rcd.completed_at, rcd.created_at) AS event_timestamp,
    'Inventory'::TEXT AS area
  FROM rr_cyclecount_data rcd
  WHERE rcd.organization_id = p_organization_id
    AND rcd.status IN ('completed', 'approved')
    AND rcd.completed_at >= p_start_date
    AND rcd.completed_at <= p_end_date
    AND rcd.assigned_to IN (SELECT au.uid FROM active_users au)

  ORDER BY user_id, event_timestamp;
END;
$$;

GRANT EXECUTE ON FUNCTION get_team_activity_events TO authenticated;
```

### Data backfill required?

**No.** The data in `rr_cyclecount_data` is correct — `completed_at`
is populated for every completed/approved row (confirmed for David's
27 + the 162 other dropped rows org-wide today). The bug is purely a
filter mismatch in the RPC. Once migration 304 lands, the next
dashboard refresh (15s cache) will show the missing 189 cycle-count
blocks for today and analogous backfills for prior days.

The two adjacent issues remain unchanged from the original
investigation:
- **Bug B (Marvin Berry-style phantom assignees)** is a data /
  shift_assignments gap, not affected by Bug A's fix.
- **Bug C (variance_review)** is a product decision; today David has 7
  rows that would jump from invisible → counted if the status
  allowlist were widened.

### Frontend safety after the fix

`buildDailyTimeline` in `team-performance.service.ts:845-864` already
filters events whose timestamp falls outside the target date in the
configured timezone, so a cycle count completed at 23:59:50 EDT and a
count completed at 00:00:10 EDT next day will each land on the correct
day — no cross-day misattribution from widening the RPC's filter.

### Open questions for the user before implementation

1. **Variance review inclusion (Bug C)** — David has 7 `variance_review`
   rows today on top of his 27 counted ones. The fix above does NOT
   touch that. Confirm whether to ship Bug A alone (safer, just unhides
   already-counted work) or bundle Bug C (widens the status allowlist —
   product decision).
2. **Putaway visibility** — David's 14 putaway events DO reach the
   Gantt (confirmed live). If after the fix the user still feels the
   Gantt is too sparse, the real ask may be a denser activity
   representation (e.g. show the time span between `started_at` and
   `completed_at` on cycle counts rather than a single point event).
   This is a Gantt-rendering tweak, not a data filter — file separately
   if requested.
3. **Migration timing** — migration 303 just landed today
   ([[Fix-Kit-Build-Cross-Linked-Parts]]). 304 should be safe to apply
   immediately afterwards; no schema dependency.


## Resolution — 2026-05-12 (Bug A + Bug C shipped)

Fix landed in [`supabase/migrations/304_fix_team_activity_events_cycle_count_filter.sql`](../../../supabase/migrations/304_fix_team_activity_events_cycle_count_filter.sql)
and applied to `wncpqxwmbxjgxvrpcake` via Supabase MCP `apply_migration`
(success). Full diff, live before/after numbers, and per-associate
verification captured in [[Fix-Shift-Productivity-Cycle-Count-Filter]].

Status:

- ✅ **Bug A** (cycle-count `created_at` vs `completed_at` filter on the
  events RPC) — **resolved**. David Simmons events arm went 0 → 34
  cycle counts; org-wide drop ratio 164/173 (active users) → 0/173.
- ✅ **Bug C** (`variance_review` excluded from status allowlist) —
  **resolved**. Status allowlist widened to
  `('completed','approved','variance_review')` in both arms; David's
  cycle-count total went 27 → 34 today, William Brewer 79 → 110, etc.
- 🔴 **Bug B** (phantom assignees like Marvin Berry without a
  `shift_assignments` row) — **still open**. The fix above only
  changes the cycle-count arm filter; users who own counts but have
  no active primary-position shift assignment remain invisible. The
  user has not yet decided between (a) data cleanup (assign Marvin to
  a working area / delete the user), (b) widening `active_users` to
  include any `user_profiles.status='active'` row, or (c) adding an
  "Unassigned associates" group in the dashboard UI. Separate ADR /
  conversation required.

No data backfill was needed. No application code or Gantt rendering
was changed (the user explicitly chose to keep point-event rendering).


## 2026-05-12 follow-up #2 — Gantt render fix (PostgREST row-limit truncation)

### Symptom (post-migration 304)

After migration 304 shipped, David Simmons's row correctly read
**48 tasks / 100% efficiency** (14 putaway + 34 cycle_count, matching
`get_team_productivity_counts`). But the expanded Gantt strip remained
**completely empty** — only the inner Legend with Shift Time / Break /
Overtime End markers rendered. `enhancedTimeline.activityBlocks.length`
was 0 even though `get_team_activity_events` should have returned 48
events for him.

Detric Hardin (33 putbacks today) rendered his Gantt normally in the
same view, proving the rendering pipeline itself is healthy.

### Hypotheses ruled out via live data

1. **`started_at` NULL on cycle counts** — not applicable. The RPC
   returns only `event_timestamp` (a point in time); the Gantt does not
   require an interval.
2. **`event_type` typo** — RPC emits `'cycle_count'` (snake), FE expects
   `'cycle_count'`. Match.
3. **Shift-window clamping** — David's shift is `07:30-16:00` EDT. His
   48 events span `08:22-16:14` EDT; 11 putaways after `16:00` get
   clamped but the cycle counts and the 12:49 putaway cluster all sit
   inside the shift. A Node simulation of `buildDailyTimeline` against
   David's exact event list produced **17 activity blocks** (8 work
   + 8 idle + 1 pre-shift idle), not 0.
4. **Per-event area_id missing** — the Gantt does not group by area_id.
5. **Stale TanStack Query cache** — ruled out by the user; the row
   total already showed the post-migration value of 48 tasks.

Both RPCs use `SECURITY DEFINER` and the same `validate_organization_access`
guard; both return data; the row total proves
`get_team_productivity_counts` returned 48 for David. So
`get_team_activity_events` had to be returning fewer rows than the
48 SQL says it should.

### Root cause — PostgREST default page limit (1000 rows)

[`team-performance.service.ts:getTeamActivityEvents`](../../../src/lib/supabase/team-performance.service.ts) calls the RPC via
`(supabase as any).rpc('get_team_activity_events', {…})` with no
explicit `.range()` or `.limit()` chain. PostgREST applies the
project's default row limit (**1000**) to RPC responses just like to
`.from(…).select(…)` queries; supabase-js does NOT override this by
default.

Live evidence (today, `2026-05-12T04:00:00Z … 2026-05-13T03:59:59.999Z`,
active-primary users only):

```
  total events returned by RPC body:  1651
  rows whose user_id < David's UUID:  1342
  David's user_id:                    cbe23c27-51fa-4986-a9d1-ab9159fff409
  David's events:                      48
  rows whose user_id > David's UUID:   261
```

The RPC ends in `ORDER BY user_id, event_timestamp`. Sorted, David's
48 events occupy rows **1343–1390** of 1651 — well past the 1000-row
cutoff. PostgREST silently returns the first 1000 rows and the
client never sees David's events. He's not the only victim: every
associate whose `user_id` UUID sorts past position 1000 (in today's
result, ~7 associates) loses their Gantt. The truncation is silent;
no error is raised.

Detric Hardin's UUID (`08921ea2-…`) sorts very low alphabetically,
well inside the first 1000 rows. That's why his Gantt renders.

This same bug explains the morning report ("1 task / 100% efficiency,
empty Gantt"). Org-wide event totals have exceeded 1000 for at least
several weeks; David has been silently truncated the entire time. Bug
A / Bug C were independent, real bugs (the row total was 41 in the
morning rather than 48), but they're not what drove the empty Gantt
— the empty Gantt is the 1000-row limit.

### Fix

Append `.range(0, 49999)` to the `.rpc()` chain in
[`team-performance.service.ts`](../../../src/lib/supabase/team-performance.service.ts) (lines 363–395). `PostgrestFilterBuilder`
returned by `.rpc()` exposes both `.range()` and `.limit()` in
supabase-js v2; the former sets the HTTP `Range` header that PostgREST
honours.

```diff
   private async getTeamActivityEvents(
     organizationId: string,
     startDate: string,
     endDate: string,
   ): Promise<Map<string, ActivityEvent[]>> {
-    const { data, error } = await (supabase as any).rpc(
-      'get_team_activity_events',
-      {
-        p_organization_id: organizationId,
-        p_start_date: startDate,
-        p_end_date: endDate,
-      }
-    )
+    const { data, error } = await (supabase as any)
+      .rpc('get_team_activity_events', {
+        p_organization_id: organizationId,
+        p_start_date: startDate,
+        p_end_date: endDate,
+      })
+      .range(0, 49999)
```

50,000 is comfortably above any realistic single-day org-wide volume
(~22 events/associate/day × ~74 active associates ~ 1,600 today; even
on heavy days nowhere near 50K). The cap also keeps the response well
under PostgREST's payload limits.

No migration / RPC change required. Counts and assignments RPCs return
1 row per user (~74 rows) so they're not at risk; only the events RPC
fans out to ~1,600+ rows.

### Validation

- `pnpm exec eslint src/lib/supabase/team-performance.service.ts` — clean.
- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm vitest run src/lib/supabase` — 36/37 pass; the 1 fail is the
  pre-existing jsdom Supabase-auth storage shim in
  `rf-cycle-count.service.test.ts`. No new failures.
- `node -e "…supabase.rpc('foo', {}).range…"` smoke check confirmed
  `.range()` and `.limit()` exist on the `PostgrestFilterBuilder`
  returned by `.rpc()` in `@supabase/supabase-js` v2.89.

### Verification in the browser data path (no live access)

After the fix is deployed:
1. `getTeamActivityEvents` will request up to 50,000 rows. PostgREST
   honours the `Range: 0-49999` header and returns all 1,651 of
   today's events.
2. `activityEvents.get('cbe23c27-…')` will return 48 events for
   David (matches the SQL).
3. `buildDailyTimeline` will produce ~17 activity blocks (Node sim
   verified).
4. `enhancedTimeline.activityBlocks.length > 0` →
   `hasEnhancedTimeline = true` → Gantt renders with visible cycle_count
   and putaway blocks.

The user will need a single page reload (or a 30s wait for the
refetchInterval) after the new JS bundle is deployed; the cache is
keyed by org/date/filters and refetches every 30s on today.

### Open / non-issues

- **Bug B (phantom assignees / Marvin Berry-style)** — still open;
  unrelated to this fix.
- **Long-term scalability** — 50,000 is generous but bounded. If a
  single org ever exceeds 50K events in one day we'd need server-side
  pagination (per-user request) or a different fetch pattern.
  Currently the heaviest day on record is ~1,700 rows for the largest
  tenant; we have ~30× headroom.
- **Other RPCs in this service** — `getTeamProductivityCounts`,
  `getShiftAssignmentsWithDetails`, `getWeeklyTrendOptimized` all
  return 1 row per user/day (<= 1000); not at immediate risk. If
  any of them grow row counts past 1000, the same `.range()` fix
  pattern applies.


## 2026-05-12 follow-up #3 — Deploy / cache resolution

User ran `railway up` after the previous follow-up shipped
`.range(0, 49999)`. David's Gantt was STILL empty at 21:48 EDT. Five
hypotheses on the table; verdict below.

### Verdict

**(b)** — the deploy is healthy, the JS bundle contains the
`.range(0,49999)` call, but PostgREST's `db-max-rows = 1000` is a
hard server-side cap that no `Range` header can exceed, AND PostgREST
ignores `Range` offsets entirely on `POST /rpc/...`. So `.range(0,
49999)` was a no-op against a 1000-row hard cap; the fix mechanism
for (b) needs both client-side pagination AND a switch to `GET /rpc/...`.

### Proof

#### Deploy is fresh

- Railway service `onebox-ai-logistics` deployment
  `94b9e1a7-280a-4ea3-a42e-690de027b655`, status `SUCCESS`,
  `createdAt: 2026-05-13T01:43:28Z` (= 21:43 EDT).
- Local file mtime `21:39:32 EDT` (~4 min before deploy). Deploy build
  ran inside the project's Dockerfile (`COPY . . && pnpm run
  frontend:build`), so the working-tree edit was packaged.
- `https://onebox-ai-logistics-production.up.railway.app/build-info.json`
  reports `buildTime: 2026-05-13T01:44:44Z` (= 21:44 EDT).
- Grepping the prod chunk:

  ```
  curl -sS https://…/assets/feature-shift-productivity-BwNnx6Jw.js \
    | grep -oE "get_team_activity_events.{0,200}"
  ```

  shows verbatim:

  ```
  W.rpc("get_team_activity_events",{...}).range(0,49999)
  ```

  So the deploy DID include the `.range(0,49999)` fix.

#### PostgREST cap probe

Created a one-off `_tmp_range_probe()` returning `generate_series(1,
1651)` rows (then dropped). Live `curl` against
`https://wncpqxwmbxjgxvrpcake.supabase.co/rest/v1/rpc/_tmp_range_probe`:

| Method | Range header | HTTP | Content-Range | data length |
|--------|--------------|------|---------------|-------------|
| POST   | (none)       | 206  | `0-999/1651`  | 1000        |
| POST   | `0-49999`    | 206  | `0-999/1651`  | 1000        |
| POST   | `1000-1999`  | 206  | `0-999/1651`  | **1000 — OFFSET IGNORED, returns first page** |
| GET    | `0-999`      | 200  | `0-999/*`     | 1000 (rows 1–1000) |
| GET    | `1000-1999`  | 200  | `1000-1650/*` | 651 (rows 1001–1651) |

So:

1. `db-max-rows = 1000` is enforced regardless of `Range`.
2. `POST /rpc/…` does NOT honour Range OFFSET. It always returns the
   first 1000 rows, which is exactly what supabase-js sends by
   default for `.rpc(…)`.
3. `GET /rpc/…` honours Range as offset+limit. Pagination only works
   via GET.

This flipped my earlier assumption that `.range()` alone overrides the
cap. It does not.

#### Why David specifically

The events RPC ends `ORDER BY user_id, event_timestamp`. With 1651
org-wide rows today and `db-max-rows = 1000`, only the first 1000
(sorted by `user_id`) ever reach the browser. David's user_id
`cbe23c27-…` sorts at row 1343 of 1651 — his entire 48-event tail
is dropped. Detric Hardin's `08921ea2-…` sorts at ~row 7 and his
rows render normally.

### Fix

Client-side pagination in [`team-performance.service.ts`](../../../src/lib/supabase/team-performance.service.ts) `getTeamActivityEvents`:

```ts
const PAGE_SIZE = 1000
const SAFETY_CAP_ROWS = 50000

// First page: GET (so Range pages work) + count=exact (so we learn the total).
const firstPage = await (supabase as any)
  .rpc(
    'get_team_activity_events',
    { p_organization_id, p_start_date, p_end_date },
    { get: true, count: 'exact' },
  )
  .range(0, PAGE_SIZE - 1)

// If totalRows > PAGE_SIZE, fan out the remaining pages in parallel
// (still GET; .range() supplies offset+limit per page).
```

Key moving parts:
- `{ get: true }` switches supabase-js to `GET /rpc/…`, where
  PostgREST honours Range as offset+limit.
- `{ count: 'exact' }` adds `Prefer: count=exact`, so the
  `Content-Range` header reports the total and supabase-js surfaces
  it as `firstPage.count`.
- `Promise.all` issues subsequent pages in parallel.
- 50,000-row safety cap with a `logger.warn` if exceeded.
- On page-error the loop preserves the rows we already have rather
  than blanking the UI.

No SQL change required. Migration 304's RPCs are unchanged.

### Validation

- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm exec eslint src/lib/supabase/team-performance.service.ts`
  — clean.
- `pnpm vitest run src/lib/supabase` — 36/37 pass; the 1 fail is the
  pre-existing `rf-cycle-count.service.test.ts` jsdom Supabase-auth
  storage shim issue from this morning's session log. No new
  failures.
- `pnpm build` — succeeds. Grepping the newly built chunk
  `dist/assets/feature-shift-productivity-kbvwkVvn.js`:

  ```
  B.rpc("get_team_activity_events",{...},{get:!0,count:"exact"}).range(0,999)
  ```

  followed by a `Promise.all` over additional `.range(b, c)` calls.
  Two `.range(` calls, two `get_team_activity_events` references.

### Next step for the user

Run `railway up` again. The deploy will rebuild via the Dockerfile
(`pnpm run frontend:build` inside `node:20-alpine`), pick up the new
`team-performance.service.ts`, and ship a chunk with the GET-based
paginated fetcher. After deploy, one hard refresh (or 30s for the
refetchInterval) and David's row should show ~17 activity blocks
(31 cycle_count + 14 putaway + idle gaps clamped to his 07:30–16:00
EDT shift).

The `dist/` produced locally by `pnpm build` is for verification
only; Railway rebuilds inside the Docker container.
