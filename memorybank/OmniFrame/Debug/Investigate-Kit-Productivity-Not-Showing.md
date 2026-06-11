---
tags: [type/debug, status/active, domain/frontend, domain/database]
created: 2026-05-18
---

# Investigate — Kit Productivity Not Showing on My Productivity / Shift Productivity

## Purpose / Context

Jai Singh (`admin@j.ai`, `user_id = 8fe94172-0267-4b14-96bd-06f8691bb04c`) reported that the 63 kit events they generated on 2026-05-17 EDT (31 picks + 31 builds + 1 dock stage) did not show on **My Productivity** or **Shift Productivity** after [[Productivity-Wiring-Kit-Workflow-Stages]] shipped. A read-only verifier audit declared the slice clean. This debug walks through every probe in priority order, eliminates each hypothesis, and lands the real root cause + the one cosmetic gap worth shipping.

## Live database probes (executed via Supabase MCP `wncpqxwmbxjgxvrpcake`)

### Identity

```
auth.users → 8fe94172… email=admin@j.ai (display name pulled from user_profiles.full_name='Jai Singh')
user_profiles 8fe94172… → organization_id = c9d89a74-7179-4033-93ea-56267cf42a17 (j.AI OneBox)
shift_assignments 8fe94172… → status='active', is_primary_position=true, start_date 2026-02-12, end_date NULL
```

**H1 — `active_users` CTE dropping Jai → ELIMINATED.** Jai is in `active_users` (verified by re-running the CTE body inline).

### Raw kit attribution in `RR_Kitting_DATA`

```
event_type        | n  | earliest                  | latest
kit_picking       | 31 | 2026-05-18 00:40:33.707Z  | 2026-05-18 00:54:05.038Z
kit_building      | 31 | 2026-05-18 01:09:11.638Z  | 2026-05-18 01:19:25.330Z
kit_dock_staging  |  1 | 2026-05-18 02:19:58.292Z  | 2026-05-18 02:19:58.292Z
```

All three timestamps are in the **2026-05-17 EDT** day-bucket (20:40 → 22:19 local) — the user's reported "yesterday" matches.

### Live RPC output (impersonating Jai via `set_config('request.jwt.claims', …)`)

```sql
SELECT event_type, COUNT(*)
FROM get_team_activity_events(
  'c9d89a74-7179-4033-93ea-56267cf42a17'::uuid,
  '2026-05-17T04:00:00.000Z'::timestamptz, -- 00:00 EDT May 17
  '2026-05-18T03:59:59.999Z'::timestamptz  -- 23:59 EDT May 17
)
WHERE user_id = '8fe94172-…' GROUP BY event_type;

kit_building     | 31
kit_dock_staging |  1
kit_picking      | 31
```

```sql
SELECT kit_picking, kit_building, kit_dock_staging, total_tasks
FROM get_team_productivity_counts('c9d89a74-…'::uuid, '2026-05-17T04:00:00Z', '2026-05-18T03:59:59Z')
WHERE user_id = '8fe94172-…';

kit_picking=31, kit_building=31, kit_dock_staging=1, total_tasks=63
```

The RPCs return Jai's events end-to-end through the **live** functions, not just through inline simulations. Cross-foot matches between the events RPC (per-event rows) and the counts RPC (per-user totals) is perfect.

The same probes against **today's** EDT window (2026-05-18T04:00:00Z → 2026-05-19T03:59:59Z) return **zero** events for Jai — no kit work has been logged today yet.

### Other ruled-out hypotheses

| Hypothesis | Status | Evidence |
|---|---|---|
| H1 — `active_users` drops Jai | ❌ | Jai is in `active_users` (probed inline) |
| H2 — Activity Gantt uses a different RPC | ❌ | Grep across `src/` shows the gantt sources from `useTeamPerformance` → `getTeamActivityEvents`. No separate `get_user_activity_timeline` or `get_my_productivity_events` RPC exists. |
| H3 — RLS / `validate_organization_access` rejects | ❌ | `user_profiles` row for Jai has `organization_id = c9d89a74`. The validator simply checks that join; the real frontend JWT carries Jai's `sub` so it passes. The verifier's earlier inability to call the RPC was a **service-role limitation** (service role has no `auth.uid()`), not a runtime failure. |
| H4 — Timezone / date window | ⚠️ | The window IS correct — `getTeamProductivity` uses `getUTCBoundariesForDate(dateString, 'America/New_York')`, which maps May 17 EDT to `2026-05-17T04:00:00Z` → `2026-05-18T03:59:59Z`. That window **includes** all 63 of Jai's events. |
| H5 — TanStack stale cache | ⚠️ | `getStaleTimeForDate(selectedDate)` returns `Infinity` for non-today dates and 15s for today. A page kept open since *before* migration 310 applied AND held on "Yesterday" would never invalidate. Mitigation: hard refresh / `refresh()` button. Not a code bug. |
| H6 — Frontend allowlist filters kit_* | ❌ | `calculateTaskBreakdown` switch, `calculateAssociateEfficiency` taskTypes, `calculateLaborStandardComparisons` taskMapping, `calculateTeamStats`, `aggregateByArea.taskMetrics`, `mergeTaskBreakdowns`, `exportToCsv` — every consumer in `team-performance.service.ts` has explicit `kit_*` arms. No silent allowlist. |
| H7 — RPC wrong shape | ❌ | `pg_get_function_result` → `TABLE(user_id uuid, event_type text, event_timestamp timestamptz, area text)`. Frontend `ActivityEventRow` accepts those four; the `activity_label`/`display_color`/`activity_category` fields are optional and currently unused. |
| H8 — Wrong Supabase project | ❌ | `.env.local` → `VITE_SUPABASE_URL=https://wncpqxwmbxjgxvrpcake.supabase.co`. Same project the migration was applied to. |

## Actual root cause

**There is no data-loss bug.** Both productivity RPCs return Jai's 63 kit events correctly for the **May 17 EDT** date bucket. The default landing of both *My Productivity* and *Shift Productivity → Real-Time* is `selectedDate = new Date()` — i.e. **today** (May 18 EDT) — which (correctly) has no events because the work happened the previous EDT day.

The user must click **Previous Day** (or open the date picker) and select **May 17, 2026** to see the kit blocks on the Activity Gantt and the kit columns / chips in the per-user breakdown. After that the row counters (`Kit Pick: 31`, `Kit Build: 31`, `Dock Stage: 1`) and the lime/teal/sky blocks on the Gantt should populate as documented in [[Productivity-Wiring-Kit-Workflow-Stages]] § Surface-by-surface result.

If the page was loaded *before* migration 310 was applied and is still open on "yesterday", TanStack Query's `staleTime = Infinity` for historical dates means the cached empty payload will persist forever. **Click the in-page Refresh button** (or hard-reload) to invalidate.

## Secondary finding — Tailwind colour gap for the new kit chips

`MyTaskBreakdown` in `src/components/my-productivity-dashboard.tsx` shipped the four new kit chips with colour keys `'lime'`, `'cyan'`, `'fuchsia'`, `'sky'`, but the local `TASK_COLORS` lookup map at the bottom of the file only declares the original eight (blue, purple, green, orange, teal, amber, rose, indigo). Tailwind v4's class scanner can't see strings the map doesn't contain, so when the chip renders the wrapper `cn('...border px-3 py-2', undefined)` produces an unstyled badge.

This is **not** the user's reported bug — even unstyled the badges would still render with the correct number and label — but it's a real visual regression introduced in the same slice and worth shipping in the same fix.

### Fix applied

Extended `TASK_COLORS` to include `lime`, `cyan`, `fuchsia`, `sky`:

```ts
lime: 'border-lime-500/50 bg-lime-50 text-lime-700 dark:bg-lime-950/30 dark:text-lime-300',
cyan: 'border-cyan-500/50 bg-cyan-50 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300',
fuchsia: 'border-fuchsia-500/50 bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-950/30 dark:text-fuchsia-300',
sky: 'border-sky-500/50 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300',
```

Added a header comment so the next developer knows the map must stay exhaustive against the keys produced by `MyTaskBreakdown.taskMetrics`. Tailwind picks up the new literal classnames on the next build.

## Validation

- `pnpm exec tsc -b --noEmit` → clean (no output, exit 0).
- `ReadLints` on the touched file → no errors.
- Live-DB cross-foot of events RPC vs counts RPC for Jai for the May 17 EDT window → both report 31 / 31 / 1 (perfect match).
- Same query for the May 18 EDT window → zero events (as expected — no kit work today).

## What the user should see now

1. Hard-reload the dashboard tab (Cmd-Shift-R) to drop any pre-migration TanStack cache.
2. On **My Productivity**, click **Previous Day** once → date row reads **Sunday, May 17, 2026**. The Activity Gantt should now show three lime blocks (kit pick at 20:40–20:54 EDT), three teal blocks (kit build at 21:09–21:19 EDT), and one sky block (dock stage at 22:19 EDT). The Task Breakdown card below shows `31 Kit Pick / 31 Kit Build / 1 Dock Stage` chips with their proper lime/cyan/sky colours (no longer plain grey thanks to the fix above).
3. On **Shift Productivity → Real-Time**, click **Previous Day** to May 17. Jai's row's expanded detail strip should show the same `31 / 31 / 1` counters and `Total Tasks: 63`. The area-breakdown card and labor-standard comparisons reflect the kit stages.
4. **Today** (May 18 EDT) intentionally shows zero kit events until the operator does new kit work today. Same applies to Production Boards' hourly tracker.

If step 2 still shows no Gantt blocks for May 17 EDT after a hard reload, capture the browser console + network panel response for the `get_team_activity_events` GET request and re-open this debug note — at that point the gap would have to be in the runtime JWT or in supabase-js routing, neither of which my probes could exercise without Jai's live session.

## Files touched

- `src/components/my-productivity-dashboard.tsx` — extend `TASK_COLORS` map to cover the four kit chip colour keys (`lime`, `cyan`, `fuchsia`, `sky`). Added a header comment explaining why the map must stay exhaustive.

## Related

- [[Productivity-Wiring-Kit-Workflow-Stages]] — the slice that introduced the four kit chips this debug audits.
- [[Investigate-Shift-Productivity-Cycle-Counts-Hidden]] — the canonical "action-timestamp" convention; reaffirmed (no regression).
- [[Optional-Kit-Inspection-Toggle]] — explains why the inspection arm returned 0 for j.AI OneBox (org has `kit_inspection_required=false`); not a bug.
- [[RF-Dock-Staging-Flow]] — origin of the single dock-staging stamp that surfaces.



## 2026-05-18 follow-up — timeline rendering fix

The original "date-bucket + Tailwind colour-gap" diagnosis above was correct for the COUNTS surface (header tile + Tasks-by-Area chips), but the **ACTIVITY TIMELINE** Gantt strip in the expanded row was still empty after the user picked May 17 EDT and hard-reloaded.

Follow-up bug + fix captured in [[Fix-Activity-Timeline-Missing-Kit-Events]]. Smoking gun: row summary read `Work 0m · Idle 9h` despite 63 events. Root cause was the shift-clamp loop in `buildDailyTimeline` (`team-performance.service.ts`) silently dropping every work block whose `[start, end]` fell entirely outside the operator's scheduled shift window. Jai's `inline_shift_schedule = {start:'08:00', end:'17:00'}` and his kit work at 20:40–22:19 EDT was 100% off-shift, so all four kit blocks were filtered out.

The fix keeps work blocks (with `taskCount > 0`) at their original bounds even when outside the shift, and tightens the idle-fill gate to never subtract from idle. Operators within-shift see no change.