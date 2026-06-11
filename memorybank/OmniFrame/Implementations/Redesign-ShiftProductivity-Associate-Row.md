---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-04-25
---
# Redesign Shift Productivity Associate Row

## Purpose / Context
The Team Performance tab on `/apps/shift-productivity` rendered a list of associate rows that, when expanded, vertically stacked four sections (Activity Timeline, Tasks by Area, Task Summary, Activity Legend). The result felt unfluid: the expanded row was too tall, the legend duplicated all configured activity types per row, and the row-virtualizer over-estimated heights, producing a visible blank gap between an expanded row and the next row in the list.

This pass restructures the expanded row into a denser side-by-side layout, filters the legend to per-row present activities, fixes the virtualization estimate, harmonises animations, and adds a presence indicator for 0-task associates.

## Details

### Files changed
- `src/features/shift-productivity/team-performance/components/associate-performance-row.tsx`
- `src/features/shift-productivity/team-performance/components/activity-gantt.tsx`

### Expanded row, before vs after

**Before:** vertical stack `space-y-4 p-4`
```
[Activity Timeline header + Gantt + (built-in summary footer)]
[Tasks by Area header + 1/2/3-col grid of card-style TaskBreakdownCards]
[Task Summary header + flex-wrap chips]
[Activity Legend (UNFILTERED, ~15 chips)]
```

**After:** denser horizontal layout `space-y-3 p-3`
```
[Activity Timeline header + Gantt with showSummary={false}]
[Compact stat strip: First | Last | Work | Break | Idle | Efficiency | OT]
[2-col grid on lg: Tasks by Area (compact pill rows) | Filtered Legend (compact)]
```

The Task Summary section was removed; its information is folded into the stat strip and the Tasks by Area rows.

### New helpers added in `associate-performance-row.tsx`
- `formatClockTime(timestamp)` — locale `hh:mm AM/PM` in the configured `TIMEZONE`.
- `getPresence(associate, hasTimeline)` — returns `working | off-shift | inactive` so 0-task rows can render a status badge instead of a flat `0 / 0%`.
- `StatChip` and `ActivityStatStrip` — small horizontal chips replacing the Gantt's built-in summary footer, plus efficiency and overtime as additional chips.
- `ExpandedRowContent` — single shared expanded-body component used by both `AssociatePerformanceRow` and `AssociatePerformanceRowWithCallback`. Eliminates the previous JSX duplication and keeps the layout in one place.
- `PresenceCell` — right-side cell of the trigger row. Shows `tasks / efficiency` for working associates and a `Off shift` / `No activity` badge with full numbers in a tooltip otherwise.
- `MiniTimelinePlaceholder` — thin `bg-muted/40 h-1 rounded` strip rendered in the mini-Gantt slot when the associate has no timeline, keeping rows visually aligned at `md+`.

### Trigger row tweaks
- Removed `motion.div` + `whileHover={{ x: 2 }}` on the row trigger so the hover translation no longer fights the collapsible's height transition.
- Softened expanded card emphasis: `isExpanded ? 'bg-muted/70 ring-border/50 z-10 ring-1'` → `'bg-muted/60'` (no ring, no z-10). This stops adjacent rows from being shifted-under in the visual stack.
- Mini-Gantt breakpoint `lg:flex` → `md:flex` (and width `200px` → `180px`) so tablet sizes keep the middle column.
- All trigger transitions are now `transition-colors duration-200`.

### Legend
- `<ActivityLegend>` is now invoked with `timeline={enhancedTimeline}` and `compact` so it filters to only present activity types per row and uses tighter spacing/swatches.

### Activity Gantt animation
- Per-bar stagger `transition={{ duration: 0.3, delay: idx * 0.015 }}` → `transition={{ duration: 0.2 }}`. With 50+ blocks the previous stagger took ~750ms to fade in and read as laggy.

### Virtualization estimate
The previous `estimateSize` always counted a 76px Task Summary section, a 100px Activity Legend, +2 sections in the gap math, and an additional +80px safety buffer. Even when those sections were not rendered the virtualizer reserved ~280-400px more than the row actually painted — this is the root cause of the visible gap on expand.

New estimate (in `AssociateList`) computes height from the same conditions the JSX uses:
- `timelineHeight = hasTimeline ? 24 + 36 + 28 + 8 : 0` (header + Gantt + stat strip + inner gap)
- `breakdownHeight = hasBreakdown ? 24 + items * 36 + 4 : 0` (compact pill rows)
- `legendHeight = 24 + min(2, ceil((presentActivities + 2) / 6)) * 22`
- Bottom grid takes `max(breakdown, legend)` (they sit side-by-side on lg)
- Container chrome `1 + 24` (border-t + p-3) + `12 * (sections - 1)` (space-y-3 gaps)
- Safety buffer reduced from 80 → 16; ResizeObserver corrects the rest within a frame.

`VIRTUALIZATION_THRESHOLD` raised from 50 → 100 because typical team dashboards have <100 associates and the redesigned non-virtualized path no longer needs estimate gymnastics.

### Out of scope
- Department-card, labor-board, settings tabs.
- Backend / Supabase RPC.
- Global `.CollapsibleContent` 300ms animation in `src/index.css` (kept untouched to avoid affecting Standard Work, sidebar nav, and settings collapsibles).

## Verification
- `npx tsc --noEmit -p tsconfig.app.json` — clean.
- `npx eslint src/features/shift-productivity/team-performance/components/{associate-performance-row,activity-gantt}.tsx` — clean.
- `npm run build` — succeeds; `feature-shift-productivity` chunk = 350.21 KB / gzip 64.96 KB.
- `npx vitest run src/features/rf-interface/__tests__/rf-interface-shell.test.tsx` (downstream consumer of `ActivityGantt` / `ActivityLegend`) — passes.

## Related
- [[ShiftProductivity - Feature Module]]
- [[UI-Component-Conventions]]
- [[Dark-Mode-Opacity-Colors]]
