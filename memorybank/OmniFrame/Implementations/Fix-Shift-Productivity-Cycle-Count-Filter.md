---
tags: [type/implementation, status/active, domain/database, domain/frontend, cycle-count, shift-productivity]
created: 2026-05-12
---
# Fix Shift Productivity Cycle Count Filter

## Purpose / Context

Resolves [[Investigate-Shift-Productivity-Cycle-Counts-Hidden]] Bug A
(cycle-count `created_at` filter on the events RPC) and Bug C
(`variance_review` rows excluded by the status allowlist) for the
Shift Productivity → Team Performance → All Associates dashboard.
User reported David Simmons (Material Handler, Inventory Control)
showing `41 tasks / 100% efficiency` but an empty Gantt strip;
investigation found Bug A drops 100% of his completed cycle counts
from the events RPC because the batched create-side timestamps fall
outside the events window.

Bug B (phantom assignees without `shift_assignments`, e.g. Marvin
Berry) is intentionally **left open** — it's a data/ops cleanup
decision (delete the user, backfill an assignment, or add an
"Unassigned" UI bucket) that the user has not yet approved.

## Details

### Migration

[`supabase/migrations/304_fix_team_activity_events_cycle_count_filter.sql`](../../../supabase/migrations/304_fix_team_activity_events_cycle_count_filter.sql)
(407 lines).

Re-creates both `get_team_activity_events` and
`get_team_productivity_counts` in full so they remain byte-equivalent
with migration 188 outside the cycle-count arm. SECURITY DEFINER mode
preserved, GRANT EXECUTE TO authenticated re-issued. No
`SET search_path` is applied because migration 188's DROP+CREATE on
`get_team_productivity_counts` already wiped the hardening from
migration 173 (`pg_proc.proconfig` was already `NULL` on both functions
before 304); re-hardening belongs in a separate pass.

### Diff against migration 188 (cycle-count arms only)

```diff
-- get_team_activity_events / Cycle counts UNION arm
   FROM rr_cyclecount_data rcd
   WHERE rcd.organization_id = p_organization_id
-    AND rcd.status IN ('completed', 'approved')
-    AND rcd.created_at >= p_start_date
-    AND rcd.created_at <= p_end_date
+    AND rcd.status IN ('completed', 'approved', 'variance_review')
+    AND rcd.completed_at >= p_start_date
+    AND rcd.completed_at <= p_end_date
     AND rcd.assigned_to IN (SELECT au.uid FROM active_users au)

-- get_team_productivity_counts / cyclecount_counts CTE
   SELECT assigned_to AS uid, COUNT(*) AS cnt
   FROM rr_cyclecount_data
   WHERE organization_id = p_organization_id
-    AND status IN ('completed', 'approved')
+    AND status IN ('completed', 'approved', 'variance_review')
     AND completed_at >= p_start_date AND completed_at <= p_end_date
     AND assigned_to IN (SELECT au.uid FROM active_users au)
   GROUP BY assigned_to
```

Everything else in both RPCs (active_users CTE, the nine other UNION
arms / CTEs, the LEFT JOIN aggregation, total_tasks calculation) is
copied byte-for-byte from 188.

### Applied

Applied to project `wncpqxwmbxjgxvrpcake` via Supabase MCP
`apply_migration` (name: `fix_team_activity_events_cycle_count_filter`).

```
Apply migration result: { success: true }
```

Post-apply `pg_proc` check confirms both functions have the same
signature and security configuration as before:

| Function | args | sec_def | proconfig |
|---|---|---|---|
| `get_team_activity_events` | `p_organization_id uuid, p_start_date timestamptz, p_end_date timestamptz` | true | null |
| `get_team_productivity_counts` | `p_organization_id uuid, p_start_date timestamptz, p_end_date timestamptz` | true | null |

### Live verification — David Simmons (today, 2026-05-12 EDT window)

David's user_id: `cbe23c27-51fa-4986-a9d1-ab9159fff409`. Window:
`2026-05-12T04:00:00.000Z … 2026-05-13T03:59:59.999Z`.

| Arm | Before fix | After fix | Delta |
|---|---|---|---|
| cycle_count (events RPC) | 0 | 34 | +34 (27 new from Bug A + 7 from Bug C) |
| cycle_count (counts RPC) | 27 | 34 | +7 (Bug C only) |
| putaway (events RPC) | 14 | 14 | unchanged — not affected |
| **row total_tasks** | **41** | **48** | **+7 (variance_review)** |

Events ↔ counts now agree exactly for cycle counts on David.

### Live verification — org-wide cycle-count visibility (today)

| Metric | Before fix | After fix |
|---|---|---|
| Completed+approved rows in counts arm (active users only) | 173 | 173 |
| Completed+approved rows in events arm (active users only) | 9 | 173 |
| Bug A drops | 164 | 0 |
| With variance_review widened (post-Bug C, active users) | n/a | 239 |

Per-associate post-fix breakdown:

| Associate | counts arm pre-fix | variance_review added | post-fix total |
|---|---|---|---|
| William Brewer | 79 | +31 | 110 |
| James Dearman | 39 | +13 | 52 |
| Erick Robinson | 28 | +15 | 43 |
| David Simmons | 27 | +7 | 34 |

### Regression check

- Detric Hardin (Outbound Shipping, `08921ea2-4e83-4008-8138-96d6451b791f`)
  still returns 33 putbacks in the events arm — unchanged. Spot-check
  on the other UNION arms (inbound_scan etc.) returns the same values
  pre- and post-fix.
- `pg_proc.proconfig` and `prosecdef` unchanged — SECURITY DEFINER
  preserved, GRANT EXECUTE TO authenticated re-issued.

### Unit tests

`pnpm test:unit`: 455/480 pass; 25 failing tests are entirely
pre-existing on a clean tree (jsdom Supabase-auth storage shim
failures in `security-validation.test.ts`, `rbac-hardening.test.ts`,
`work-distribution-panel.test.tsx`, `rf-cycle-count.service.test.ts`,
`zone-rules.service.test.ts`, `client-env-guard.test.ts`, plus one
additional `kit-serial-scoping.test.ts` failure that flipped today
because the UTC clock crossed midnight — expected `KIT-20260512-006`
got `KIT-20260513-001`). None touch the shift-productivity surface;
this is a SQL-only migration with no TypeScript change.

## Files touched

- **Created** `supabase/migrations/304_fix_team_activity_events_cycle_count_filter.sql`
  (407 lines).
- No application code touched. No Gantt rendering change — the user
  explicitly chose to keep point-event rendering.

## Cache caveat for the live dashboard

`useTeamPerformance` uses a 15s `staleTime` on today's data with a
30s `refetchInterval` when auto-refresh is on. After the migration
lands, the dashboard will pick up the new event counts on the next
poll cycle (≤0.5 min). If a user is staring at the dashboard and
wants immediate confirmation, a hard refresh (⌘⇧R) flushes the
TanStack Query cache and re-fetches synchronously.

## Related

- [[Investigate-Shift-Productivity-Cycle-Counts-Hidden]] — the
  three-bug investigation; Bug A and Bug C are now Resolved, Bug B
  remains open.
- [[TeamPerformance - Supabase Service]] — frontend service consuming
  these two RPCs.
- [[ShiftProductivity - Feature Module]] — the feature module.
- [[Redesign-ShiftProductivity-Associate-Row]] — the per-row
  rendering that was failing to show blocks for David.
- [[Fix-CycleCount-Completed-With-Variance]] — prior cycle-count
  status work; related context for variance_review handling.
- [[Cycle-Count-Bug-Fix-Pass-2026-05-01]] — prior pass on the
  cycle-count subsystem.


## Follow-up fixes

### 2026-05-12 evening — PostgREST 1000-row truncation on events RPC

After migration 304 shipped, David Simmons's row read **48 tasks / 100%**
but the Gantt strip remained empty. Root cause turned out to be unrelated
to Bug A / Bug C: `getTeamActivityEvents` in
[`team-performance.service.ts`](../../../src/lib/supabase/team-performance.service.ts)
called `(supabase as any).rpc(…)` with no `.range()` / `.limit()` override.
PostgREST applies its **default 1,000-row limit** to RPC responses just
like to `from(…).select(…)`, and supabase-js does not override it. The
events RPC returns 1,651 rows for our largest tenant on a busy day,
sorted by `user_id, event_timestamp`; David's UUID
(`cbe23c27-…`) sorts at row 1,343 of 1,651 — his entire 48-event tail
falls past the cutoff and never reaches the client. The truncation is
silent; no error is raised.

**Fix** (~5 LoC, in the same file):

```diff
     const { data, error } = await (supabase as any)
-      .rpc('get_team_activity_events', {
+      .rpc('get_team_activity_events', {
         p_organization_id: organizationId,
         p_start_date: startDate,
         p_end_date: endDate,
-      }
-    )
+      })
+      .range(0, 49999)
```

Covered: both the main `getTeamProductivity` path (used by
`AssociatePerformanceRow`'s Gantt) and the public wrapper
`getActivityEventsForDate` (used by Production Boards' hourly grid) call
through this private method, so the single fix patches both surfaces.

Not at risk: `get_team_productivity_counts`,
`get_shift_assignments_with_details`, and `get_weekly_productivity_summary`
each return 1 row per user/day (≤74 rows in our largest tenant) and stay
well under the 1,000-row default.

**Validation**

- `pnpm exec eslint src/lib/supabase/team-performance.service.ts` — clean.
- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm vitest run src/lib/supabase` — 36/37 pass; 1 pre-existing failure
  (`rf-cycle-count.service.test.ts`) is the jsdom Supabase-auth storage
  shim issue documented in the morning's session log. No new failures.
- Node smoke check confirmed `.rpc(…).range(…)` is a valid chain on
  `PostgrestFilterBuilder` in supabase-js v2.89.

**No SQL migration** — this is a pure TypeScript fix. The migration 304
functions are unchanged.

Full root-cause and live evidence captured in the
`## 2026-05-12 follow-up #2 — Gantt render fix` section of
[[Investigate-Shift-Productivity-Cycle-Counts-Hidden]].


### 2026-05-12 late evening — Pagination via GET + `count: 'exact'`

The initial `.range(0, 49999)` fix shipped successfully (verified in
the Railway deploy bundle `feature-shift-productivity-BwNnx6Jw.js`)
but did NOT solve the problem. Two distinct PostgREST behaviours, both
verified by live `curl` probes against
`https://wncpqxwmbxjgxvrpcake.supabase.co/rest/v1/rpc/_tmp_range_probe`:

1. **`db-max-rows = 1000` is a hard cap.** `Range: 0-49999` returned
   the SAME 1000 rows (`Content-Range: 0-999/1651`) as no Range
   header at all. The Range header cannot exceed the project's cap.
2. **`POST /rpc/…` ignores Range OFFSET.** `Range: 1000-1999` on a
   POST RPC returned rows 0–999, not 1000–1999. PostgREST only
   honours Range offsets on `GET /rpc/…`.

Fix: switch the events RPC to GET + paginated client-side fetch.

```diff
-    const { data, error } = await (supabase as any)
-      .rpc('get_team_activity_events', { p_organization_id, p_start_date, p_end_date })
-      .range(0, 49999)
+    const firstPage = await (supabase as any)
+      .rpc(
+        'get_team_activity_events',
+        { p_organization_id, p_start_date, p_end_date },
+        { get: true, count: 'exact' },
+      )
+      .range(0, 999)
+
+    // ...if firstPage.count > 1000, fan out the remaining pages in
+    // parallel using { get: true } + .range(from, to). 50K row safety
+    // cap with a logger.warn if exceeded.
```

Key points:
- `{ get: true }` switches supabase-js to `GET /rpc/…` (where Range
  paginates).
- `{ count: 'exact' }` adds `Prefer: count=exact`, so the
  `Content-Range` header reports the total and supabase-js surfaces
  it as `firstPage.count`. We use that to compute how many additional
  pages to issue.
- Pages 2…N are fanned out in parallel (`Promise.all`); each page
  request is also capped at 1000 rows by PostgREST, but the pages
  cover distinct offsets so the union is the full response.
- Per-page errors are logged but do not blank the UI — we keep the
  rows we already collected.
- 50,000-row safety cap with a `logger.warn`. Realistic single-day
  org-wide volume is ~1,700 today and unlikely to exceed ~5,000;
  50,000 is ~30× headroom.

**Validation** (same as before plus rebuild):

- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm exec eslint src/lib/supabase/team-performance.service.ts` — clean.
- `pnpm vitest run src/lib/supabase` — 36/37 pass; pre-existing
  `rf-cycle-count.service.test.ts` jsdom failure unchanged.
- `pnpm build` — succeeds. The new chunk `feature-shift-productivity-kbvwkVvn.js`
  contains the verbatim string `B.rpc("get_team_activity_events",{…},{get:!0,count:"exact"}).range(0,999)`
  followed by a `Promise.all` over additional `.range(…)` calls.
  Two `.range(` calls, two `get_team_activity_events` references.

**Deploy step for the user**: run `railway up` again. The Dockerfile
rebuilds the frontend bundle (`pnpm run frontend:build` inside the
builder stage), so the working-tree edit will be picked up. After
deploy + one hard refresh David's Gantt should show ~17 blocks.

### Cross-cutting note: PostgREST RPC method semantics

This is worth remembering for any future RPC that may return >1000
rows: `supabase.rpc(…)` defaults to POST, which does not page. If
the response can be large, pass `{ get: true }` and chain `.range()`,
or design the RPC with explicit `p_limit` / `p_offset` parameters.
The `count: 'exact'` option is the cheapest way to discover the
total in a single round-trip alongside the first page.