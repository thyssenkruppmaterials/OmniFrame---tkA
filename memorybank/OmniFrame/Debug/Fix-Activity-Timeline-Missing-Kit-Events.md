---
tags: [type/debug, status/active, domain/frontend, domain/backend]
created: 2026-05-18
---

# Fix — Activity Timeline Missing Kit Events (off-shift work clamped to idle)

## Purpose / Context

Follow-up to [[Investigate-Kit-Productivity-Not-Showing]]. After that note shipped its `TASK_COLORS` extension, Jai Singh's row on `Shift Productivity → Real-Time` for **Sunday, 2026-05-17 EDT** rendered:

- Header counters: **63 tasks · 100% efficiency** ✅ (counts RPC was healthy)
- Bottom strip — `Kitting · 31 / 31 / 1 / 63` ✅ (per-area breakdown was healthy)
- ACTIVITY TIMELINE strip in the middle: ❌ **one continuous grey block**, summary `First 8:40 PM · Last 10:19 PM · Work 0m · Idle 9h · Efficiency 100%`

The smoking gun was `Work 0m` despite 63 events — the events reached the frontend but were not converted into renderable Gantt segments. The previous note's date-bucket diagnosis was correct for the COUNTS surface but missed that the TIMELINE rendering path silently dropped 100% of Jai's events.

## Hypothesis matrix (all chased)

| # | Hypothesis | Verdict |
|---|---|---|
| H1 | Gantt has a colour/label allowlist that filters unknown `event_type` | ❌ — `useActivityConfig.DEFAULT_COLORS` and the Gantt's color-resolution chain (`SPECIAL_BLOCK_COLORS` → `block.displayColor` → `getActivityColors`) all support kit_picking / kit_building / kit_inspection / kit_dock_staging. `_DYNAMIC_COLOR_SAFELIST` in `activity-gantt.tsx` covers `bg-lime-500`, `bg-teal-500`, `bg-fuchsia-500`; `bg-sky-500` is referenced as a literal in `use-activity-config.ts` so Tailwind v4's class scanner picks it up. |
| H2 | Events have null/zero duration → invisible bars | ❌ — `buildActivityBlocks` enforces `Math.max(duration, 1)` on every block; gantt enforces `minWidth = 0.15%` for any work block with `taskCount > 0`. Even a 1-event kit_dock_staging stamp would render as a thin coloured blip. |
| H3 | Bucketer classifies kit types as idle | ❌ — `buildActivityBlocks` is type-agnostic; it carries `events[0].type` straight onto the block and the `totalWorkMinutes` calc treats anything not `idle` / `break` as work. |
| H4 | Gantt fetches via a third RPC the migration didn't touch | ❌ — `Grep .rpc(` across `src/features/shift-productivity/` and `src/components/my-productivity-dashboard.tsx` lists only `get_team_productivity_counts`, `get_team_activity_events`, `get_shift_assignments_with_details`, `get_activity_configurations`, `get_weekly_*`. All four already emit kit types post-migration 310. The frontend builds the timeline IN MEMORY from `get_team_activity_events`'s rows. |
| H5 | Browser cache / stale built JS | ❌ — same `pnpm dev` build that surfaces the correct counts feeds the timeline component. The bug reproduces on a hard reload. |
| **H6 — NEW** | **Shift-window clamping silently drops 100% of work blocks when every event falls outside the operator's scheduled shift** | **✅ — root cause** |

## Root cause

`buildDailyTimeline` in `src/lib/supabase/team-performance.service.ts` clamps every activity block to the operator's scheduled shift window before rendering. The clamp loop drops any block whose `[start, end]` is entirely outside `[shift_start, shift_end]` and a follow-up gap-fill rebalances idle time so the totals match the shift duration exactly.

For Jai Singh:

- `shift_assignments.shift_schedule` = `{"days":[1,2,3,4,5], "start_time":"08:00", "end_time":"17:00"}` (verified live via Supabase MCP) — read into `inline_shift_schedule` by `get_shift_assignments_with_details`.
- Kit events on 2026-05-17 EDT happened **20:40 → 22:19** (verified live: 31 kit_picking 20:40-20:54, 31 kit_building 21:09-21:19, 1 kit_dock_staging 22:19) — every event is **after** `end_time = 17:00`.
- Shift-clamp loop:
  - Pre-shift idle (`shiftStart → firstActivity` = 480→1240 min) was added per the existing pre-shift idle logic, then clamped to `[480, 1020]` = 540 min — kept.
  - **Every** kit_picking / kit_building / kit_dock_staging block had `clampedStart > clampedEnd` (1240 > 1020, 1269 > 1020, 1339 > 1020) → returned `null`. Dropped silently.
  - The internal idle gaps between kit stages were also dropped (same condition).
- After filter, `activityBlocks = [{idle, 540min}]`. Totals match shift duration exactly so no further rebalance fires. `totalWorkMinutes = 0`, `totalIdleMinutes = 540` — exactly the screenshot's `Work 0m · Idle 9h`.

The Gantt then renders one big grey idle bar 8 AM – 5 PM (the user's perception of "8 PM through 3 AM" is the rendered position read against the unmarked 24-hour ruler — the bar IS at the daytime portion of the timeline, not where the events occurred). All four kit blocks are gone.

This bug is **not kit-specific**. Any operator who logs work outside their declared shift window had their off-shift events silently swallowed into idle. It hadn't been observed before because the regular floor staff log their work during their declared shifts; Jai is the first user (a test admin) to reproducibly do real off-shift work.

Smoking-gun cross-foot:

```
select for Jai on 2026-05-17 EDT:
  events RPC                : 63 (31 + 31 + 1)
  productivity_counts RPC   : 63
  buildDailyTimeline output : 0 work blocks, 1 idle block (540 min)
```

## Fix shipped

[`src/lib/supabase/team-performance.service.ts`](../../../src/lib/supabase/team-performance.service.ts) — two coordinated edits inside `buildDailyTimeline`'s shift-clamp block:

1. **Off-shift work exception in the clamp loop.** When `clampedStart > clampedEnd`, instead of unconditionally returning `null`, keep work blocks (`type !== 'idle' && type !== 'break' && taskCount > 0`) at their **original** uncl amped `startTime` / `endTime` with `duration = max(blockEnd - blockStart, 1)`. Idle and break blocks outside the shift still get dropped.

   ```ts
   if (clampedStartMin > clampedEndMin) {
     if (isWorkBlock && hasActivity) {
       const offShiftDuration = Math.max(blockEndMin - blockStartMin, 1)
       return {
         ...block,
         duration: offShiftDuration,
         wasTruncatedStart: false,
         wasTruncatedEnd: false,
         originalDuration,
       }
     }
     return null
   }
   ```

2. **Idle-fill never subtracts.** The follow-up rebalance was `if (Math.abs(difference) > 0)` and `idle += difference`. With off-shift work retained, `currentTotal > shiftDurationMinutes` so `difference < 0` and the old code would shrink idle to mask the off-shift work. Tightened the gate to `if (difference > 0)` so we ADD idle to fill a gap but never subtract — off-shift work is allowed to push the total above the nominal shift duration.

Net behaviour for Jai on 2026-05-17 EDT after the fix:

```
activityBlocks = [
  { idle, 08:00 → 17:00, 540 min },                  // his nominal shift was idle
  { kit_picking, 20:40 → 20:54, 14 min, 31 tasks },  // lime
  { kit_building, 21:09 → 21:19, 10 min, 31 tasks }, // teal
  { kit_dock_staging, 22:19 → 22:20, 1 min, 1 task } // sky
]
// totalWorkMinutes = 25, totalIdleMinutes = 540
```

The Gantt now renders the idle bar 8 AM – 5 PM **plus** three coloured work blocks (lime / teal / sky) at the right timestamps. The strip summary reads `Work 25m · Idle 9h` instead of `Work 0m · Idle 9h`.

### Why not adjust the shift window or skip clamping entirely?

- Adjusting the operator's `shift_schedule` is a data-integrity decision, not a Gantt-rendering one.
- Skipping clamp entirely would re-introduce regressions for operators who genuinely clock in early / late by a few minutes — the original clamp was a real fix for that case.
- The off-shift exception is the minimum surgical change that preserves all prior intent and unblocks the new failure mode.

## Don't break — preserved

- `Fix-Build-Kit-Completion-Multi-Kit-PO` — serial-scoping invariant lives in the kit RPCs, not `buildDailyTimeline`. Untouched.
- `Investigate-Shift-Productivity-Cycle-Counts-Hidden` — cycle-count `completed_at` filter and the `variance_review` widening live in migration 304 + the in-frontend pagination loop. Untouched.
- `Optional-Kit-Inspection-Toggle` — inspection-bypass guard sits in migration 310's RPC body. Untouched.
- The previous fix's `lime` / `cyan` / `fuchsia` / `sky` `TASK_COLORS` extension in `my-productivity-dashboard.tsx`. Untouched.
- Operators who clock in early / work overtime within their shift window: clamp still trims their pre-shift / post-shift edges. Same behaviour as before.

## Validation

- `pnpm exec tsc -b --noEmit` → clean (exit 0).
- `pnpm exec eslint src/lib/supabase/team-performance.service.ts` → clean (exit 0).
- `pnpm vitest run src/lib/supabase src/features/shift-productivity` → **437 of 438 passing**. The 1 failure is the pre-existing `kit-serial-scoping.test.ts > createKitBuildPlan kanban link stamp` date-bomb (`KIT-20260518-001` vs hardcoded `KIT-20260512-006`) — out-of-scope, same as the `[[Productivity-Wiring-Kit-Workflow-Stages]]` validation log.
- `pnpm build` → succeeds in 11.07s. `feature-shift-productivity` chunk: **477.75 KB raw / 101.71 KB gzip** (was 477.64 KB pre-fix; +110 bytes for the off-shift exception body). Well under the 500 KB per-chunk budget.
- Bundle-budget script's three pre-existing per-chunk overruns (`warehouse-location-map`, `feature-admin`, `feature-rf-interface`) are unchanged — none of those chunks were touched.
- No SQL / migration changes (the bug was 100% client-side post-pagination).

## What the user should see now

1. Hard-reload `Shift Productivity → Real-Time` (Cmd-Shift-R) once the fix lands so HMR picks up the new `team-performance.service.ts`.
2. Click **Previous Day** to **Sunday, May 17, 2026**.
3. Jai Singh's row's expanded ACTIVITY TIMELINE strip now shows:
   - Grey idle bar from **8:00 AM** through **5:00 PM** (his nominal shift, idle because he didn't work during it).
   - **Lime** kit_picking bar at **20:40 – 20:54 EDT** (31 tasks, hover tooltip = `Kit Picking · 14m · Quantity: 31`).
   - **Teal** kit_building bar at **21:09 – 21:19 EDT** (31 tasks).
   - **Sky** kit_dock_staging blip at **22:19 EDT** (1 task).
   - Summary footer: `First 8:40 PM · Last 10:19 PM · Work 25m · Idle 9h`.
4. Headers and the Tasks-by-Area strip continue to read `63 tasks / 100% efficiency` and `Kitting · 31 / 31 / 1 / 63`.
5. Operators working *within* their declared shift window see no change — the existing clamp still trims their pre-shift / post-shift edges as before.

Same behaviour applies to **My Productivity** and **Production Boards** for any operator with off-shift events.

## Files touched

- `src/lib/supabase/team-performance.service.ts` — `buildDailyTimeline` shift-clamp loop (off-shift work exception) + idle-fill gate (no-subtract).

## Related

- [[Investigate-Kit-Productivity-Not-Showing]] — sibling debug; updated with a follow-up callout pointing here.
- [[Productivity-Wiring-Kit-Workflow-Stages]] — the migration-310 slice whose data this fix surfaces on the Gantt.
- [[Investigate-Shift-Productivity-Cycle-Counts-Hidden]] — the canonical "counts vs Gantt split" precedent (cycle-count `created_at` vs `completed_at`); same shape of bug, different layer (here it's the frontend timeline builder, not the RPC).
- [[ShiftProductivity - Feature Module]] — surface that hosts the affected Gantt strip.
- [[TeamPerformance - Supabase Service]] — owner of `buildDailyTimeline`.
