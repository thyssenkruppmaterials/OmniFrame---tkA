---
tags: [type/component, status/active, domain/frontend]
created: 2026-05-10
---
# Production Boards — Feature Module

## Purpose / Context

New sidebar leaf under **Labor Management** (added 2026-05-10) that hosts TV-display-grade per-hour productivity views. The first board shipped is the **Hourly Completion Tracker** — a per-associate × per-hour grid mirroring the existing Daily Completion Tracker visual recipe but bucketed by clock hour instead of day.

Production Boards reuses the existing `shift_productivity:view` permission rather than introducing a new key (see `Decisions/` if a board ever needs finer-grained gating). The route is `/apps/production-boards`; passing `?tv=1` mounts a fullscreen TV overlay with auto-refresh, a screen Wake Lock, and an idle cursor-hide.

## Files

- Route: `src/routes/_authenticated/apps/production-boards.tsx` — lazy-loaded, gated by `createStandardProtectedRoute('PRODUCTION_BOARDS')`.
- Feature folder: `src/features/shift-productivity/production-boards/`
  - `production-boards-page.tsx` — top-level container; reads `?tv=1`, renders normal page chrome OR `<TvFrame>`.
  - `components/`
    - `hourly-completion-board.tsx` — 24-hour × N-associate grid (sticky-left user column, hourly cells with tooltip per-task-type breakdown). Supports `density: 'normal' | 'tv'` and a `bare` prop that strips outer `Card` chrome when embedded inside `<TvFrame>`.
    - `board-header.tsx` — icon tile + title + description + legend chips + last-updated stamp.
    - `board-legend.tsx` — four-state swatch strip (above / on / below / no-activity).
    - `working-area-filter.tsx` — multi-select using `@/components/ui/multi-select`.
    - `tv-frame.tsx` — fixed-overlay TV mode with header bar, scrollable body, footer bar, ESC-to-exit, idle cursor hide, body-scroll lock, best-effort `requestFullscreen`.
    - `tv-clock.tsx` — large `tabular-nums` clock + date in org timezone via `Intl.DateTimeFormat`.
  - `hooks/`
    - `use-hourly-productivity.ts` — TanStack Query hook orchestrating roster, working areas, shift assignments, and activity events; visibility-gated 30s polling on today (`refetchInterval = isToday && visible ? 30_000 : false`); tracks `lastUpdatedAt` from `dataUpdatedAt`. Returns `{ associates, hourBuckets, getCellState, getCellBucket, workingAreas, departments, hourTargets, lastUpdatedAt, ... }`.
    - `use-screen-wake-lock.ts` — narrow `navigator.wakeLock.request('screen')` wrapper with re-acquire on `visibilitychange`; silently no-ops when unsupported.
  - `lib/`
    - `hour-bucket.ts` — pure helpers: `bucketEventsByHour`, `getHourCellState`, `effectiveTargetForBucket`, `targetKeyForEventType`, `getLocalHour`, `getCurrentHour`, `formatHour`, `getAllHours`, `parseClockTime`, `isHourWithinShift`. Tested in `hour-bucket.test.ts` (21 cases, all green).
    - `types.ts` — `AssociateRow`, `HourBucket`, `HourCellState`, `HourTargets`, `BoardDensity`, `HourTypeBreakdown`.
  - `index.ts` — barrel export consumed by the route file and external callers.

## Data sources / RPCs consumed

| Query | Source |
|---|---|
| Active associates roster | `LaborManagementService.getActiveAssociates(orgId)` |
| Working areas (filter options) | `LaborManagementService.getWorkingAreas(orgId)` |
| Shift start/end clock times (off-shift dimming) | `TeamPerformanceService.getShiftAssignmentsRaw(orgId)` (new public wrapper around `get_shift_assignments_with_details` RPC) |
| Per-user activity events for the local date | `TeamPerformanceService.getActivityEventsForDate(orgId, dateString, timezone)` (new public wrapper around `get_team_activity_events` RPC, taking a YYYY-MM-DD string + IANA tz) |
| Per-hour targets | `useShiftProductivitySettings().effectiveSettings.target_*_per_hour` |

`getActivityEventsForDate` is the only new server contact this feature adds. Bucketing happens entirely client-side via `bucketEventsByHour`, so we don't pay for a dedicated `get_team_hourly_*` RPC unless event volume becomes painful (see Open follow-ups below).

## State / colour ramp

`getHourCellState({ count, target, hasShift })` returns one of `'no-activity' | 'below' | 'on' | 'above' | 'off-shift'`:

- `count <= 50% target` → `below` (`bg-emerald-500/40`)
- `count between 50–100% target` → `on` (`bg-emerald-500/70`)
- `count > target` → `above` (`bg-emerald-500`)
- `count == 0` → `no-activity` (`bg-muted/40`)
- Hour outside the user's shift window → `off-shift` (`bg-muted/20`, opacity-30)

The **effective target** for a bucket is single-type when only one event type was observed in the hour, else a count-weighted average across the per-hour targets in `shift_productivity_settings`. Mixed buckets pick a target that respects each task's contribution rather than picking the smallest target.

## TV mode

`?tv=1` mounts `<TvFrame>` as a fixed `z-50` overlay. The frame:

- Acquires a screen Wake Lock (`navigator.wakeLock.request('screen')`).
- Hides the OS cursor after 3 s of mouse idle (resets on `mousemove`).
- Listens for ESC and renders a small bottom-right "Exit" button — both `pushState` away from `?tv=1`.
- Best-effort `requestFullscreen()` on mount, swallowed if the browser blocks (no user-gesture).
- Locks `document.body.style.overflow = 'hidden'` during mount.
- Renders the same `<HourlyCompletionBoard density='tv' bare>` so chrome is owned by the frame, not the inner Card.

## Realtime policy

Production Boards is **polling-only** (per `realtime-policy workspace rule`). No `supabase.channel(...)` is added. The 30 s poll is gated by `document.visibilityState` so background tabs don't burn requests.

## Related

- [[ShiftProductivity - Feature Module]] — sibling app under Labor Management; shares `shift_productivity` permission and timezone.
- [[TeamPerformance - Supabase Service]] — owns `get_team_activity_events` RPC and the new public `getActivityEventsForDate` / `getShiftAssignmentsRaw` wrappers.
- [[LaborManagement - Supabase Service]] — `getActiveAssociates`, `getWorkingAreas`.
- [[ProductivityAndSettings - Supabase Service]] — `target_*_per_hour` source for the colour ramp.
- [[Dark-Mode-Opacity-Colors]] — colour token convention used throughout (`bg-emerald-500/{n}`).
- [[React-Query-Patterns]] — query/poll conventions; visibility-gated `refetchInterval`.
- [[Realtime-Subscription-Hygiene]] — why we chose polling over a new channel.
- [[UI-Component-Conventions]] — shadcn primitives, `cn()`, opacity tokens.



## v3 (2026-05-10) — Associate ID Card + Mini Skills Matrix

The user-column cell of the Hourly Completion Tracker is now an `<AssociateIdCard>` (rounded badge with gradient avatar, name + primary-skill pill, sub-line, 8-tile `<SkillsMatrix>`, and a shift-state icon). The card's accent colour is derived deterministically from each associate's `working_areas.area_code` via a hash into an 8-key Tailwind palette; in single-area-tab views every visible row is recoloured to the active area, in All-Areas the intrinsic colour stays. Skills are derived from existing data (no new schema): primary from `position_title`, demonstrated from today's bucketed event types. See [[Implement-Production-Boards-Hourly-Grid]] § v3 for the full canonical-skills list, mapper rules, and the area-color decision.

**New files in `production-boards/`:**
- `lib/skills.ts` — canonical list, mappers, `getSkillState`, area-color hash + class table
- `components/associate-id-card.tsx`
- `components/skills-matrix.tsx`

**`AssociateRow` gained:** `primarySkill: SkillId | 'warehouse' | 'coordinator'`, `demonstratedSkills: Set<SkillId>`, `areaColor: AreaColorKey`.



## v4 (2026-05-10) — Operating-Hours Window 6 AM – 7 PM

The Hourly Completion Tracker now renders a **13-column** grid scoped to the building's operating window `[BOARD_OPENING_HOUR, BOARD_CLOSING_HOUR) = [6, 19)` instead of the previous 24-hour grid. Constants live in `lib/hour-bucket.ts` (`BOARD_OPENING_HOUR`, `BOARD_CLOSING_HOUR`, `BOARD_HOURS`, `isWithinBoardHours`, `getCurrentBoardHour`).

- **`bucketEventsByHour`** drops events whose local hour falls outside `[6, 19)` so KPI totals reflect operating-hours activity only.
- **`computeHoursElapsed`** is now scoped to the operating window: 13h historically; clamp `(now − 6 AM)/60` to `[5/60, 13]` during the day; **0** before 6 AM (pre-open); **13** after 7 PM.
- **`<BoardMetrics>`** renders `—` for Average / Target with subtitle `"Building opens at 6 AM"` when `metrics.isPreOpen` is true.
- **`<HourlyCompletionBoard>`** draws a subtle centred footnote `"Building closed · opens 6a"` when `isToday` AND `getCurrentBoardHour() === null`. The 12 PM column carries a `border-l border-border/40` band divider so the AM/PM split reads at TV-distance.
- Density `min-w` recomputed: normal `min-w-[1000px]`, TV `min-w-[1500px]`. Each hour cell ≥ 56px (normal) / 80px (TV). Skeleton bumped from 24 → 13 cells.

See [[Implement-Production-Boards-Hourly-Grid]] § v4 for the full decision log, validation, and follow-ups.



## v6 (2026-05-10) — Multi-Board Hub (SQCDP / Announcements / HR News / Jobs / Safety Alerts)

The page evolved from a single board to a six-tab hub. The hourly board moved into `boards/hourly/` (its files are unchanged — just relocated); five new boards live alongside it, each lazy-loaded into its own chunk via `lib/boards.ts`'s `React.lazy(...)` registry. The page chrome (header + tab strip + edit toggle + animated `<BoardShell>`) is shared, every board owns its own TV chrome.

Write paths are gated behind a new permission: `production_boards:edit` — granted to `admin / superadmin / manager / tka_supervisors` (see migration 295). The frontend exposes that gate via `useCanEditBoards()` (TanStack Query around `authService.checkPermission`, 5 min staleTime). The `<BoardEditToggle>` flips a `?edit=1` URL bit which `useBoardEditMode()` reads; per-card pencils, `+ Add` CTAs, and inline editors all check `canEdit && editMode`.

All polling is **60 s, visibility-gated** — the hourly board was bumped from 30 s up to 60 s in this slice to keep the org-wide network footprint flat now that there are six concurrent polls per page view.

### New file tree

```
production-boards/
  boards/
    hourly/
      components/{associate-id-card,board-header,board-legend,board-metrics,hourly-completion-board,skills-matrix}.tsx
      hooks/{use-hourly-productivity,use-hourly-productivity.test}.ts(x)
      lib/{hour-bucket,hour-bucket.test,skills,skills.test,types}.ts
      hourly-board.tsx                       ← entry; per-area tabs + KPI strip + grid + auto-rotation + TvFrame
    sqcdp/
      components/
        sqcdp-card.tsx                       ← hero card recipe (extends Elevated-KPI-Stat-Cards v5)
        sqcdp-grid.tsx                       ← 5-primary + 4-secondary layout, iterates SQCDP_CATEGORIES
        sqcdp-sparkline.tsx                  ← Recharts <LineChart>, no axes/grid, dashed target line
        sqcdp-problems-table.tsx             ← shadcn <Table>, severity/status badges per Dark-Mode-Opacity-Colors
        sqcdp-editor-sheet.tsx               ← right-side <Sheet>, react-hook-form + zod, ColorPickerInput
      hooks/{use-sqcdp-metrics,use-sqcdp-problems}.ts
      lib/{categories,categories.test,format,format.test}.ts
      sqcdp-board.tsx                        ← entry; metric grid + problems table + editor + TvFrame
    announcements/announcements-board.tsx    ← entry; working-area chips + post grid + editor
    hr-news/hr-news-board.tsx                ← entry; branch chips (incl. Company-wide) + post grid + editor
    jobs/
      components/{job-card,job-editor-sheet}.tsx
      hooks/use-job-postings.ts
      jobs-board.tsx                         ← entry; job grid + closing-date chips + editor
    safety-alerts/safety-alerts-board.tsx    ← entry; severity-sorted post grid + ack pills
  components/
    tv-frame.tsx        (existing; refactored to accept a footerLegend slot prop)
    tv-clock.tsx        (existing)
    board-tabs.tsx      (Step 3) — the global tab strip
    board-shell.tsx     (Step 3) — framer-motion <AnimatePresence mode='wait'>
    board-edit-toggle.tsx (Step 3) — <BoardEditToggle> + useBoardEditMode hook
    post-card.tsx       (v6) — shared by announcements / HR / safety
    post-editor-sheet.tsx (v6) — shared by announcements / HR / safety; image upload to Storage
  hooks/
    use-screen-wake-lock.ts                  (existing)
    use-board-search-param.ts (Step 3)       — ?board= URL state + tests
    use-can-edit-boards.ts    (Step 3)       — production_boards:edit permission check + tests
    use-board-posts.ts        (v6)           — single TanStack hook for production_board_posts, scope-discriminated
    use-branches.ts           (v6)           — per-org branches lookup
    use-board-working-areas.ts (v6)          — narrow per-org working-areas lookup (cf. labor-management.service)
  lib/
    boards.ts                                — BoardSlug enum + lazy-loaded BOARDS registry
  production-boards-page.tsx                 — page header + BoardTabs + BoardShell + Suspense + (board)
  index.ts                                   — barrel re-exports
```

### Data sources / RPCs added

| Query | Source |
|---|---|
| SQCDP metrics + history join | `sqcdp_metrics` + `sqcdp_metric_history (recorded_at, value)` (RLS via migration 295) |
| SQCDP problems with owner name | `sqcdp_problems` + `user_profiles!assigned_to(full_name)` join |
| Posts (announcements / HR news / safety alerts) | `production_board_posts` + joined `working_areas`, `branches`, `user_profiles!posted_by`, and aggregated `production_board_post_acks(user_id)` |
| Acknowledgements | `production_board_post_acks` (insert-by-self via row-level policy) |
| Job postings | `production_board_job_postings` + joined `working_areas`, `branches`, `user_profiles!posted_by` |
| Branches lookup | `branches` (org-scoped, active) |
| Working areas (narrow) | `working_areas` (id / area_name / area_code only — the labor-management service is too rich for the post editor) |

All mutations are gated by RLS on `public.has_permission('production_boards', 'edit')` so the frontend's `useCanEditBoards()` is purely a UX gate — no security boundary.

### Realtime policy

Still **polling-only** (per `realtime-policy workspace rule`). No new `supabase.channel(...)` callsites. The 60 s cadence is gated by `document.visibilityState === 'visible'` so background tabs don't burn requests.

### Related (added)

- [[Editable-Board-Sheets]] — canonical recipe for the edit toggle → URL `?edit=1` → per-card pencil → right-side Sheet → react-hook-form + zod + ColorPickerInput → optimistic mutation → sonner toast pattern used by SQCDP, the post editor, and the job editor.
- [[Elevated-KPI-Stat-Cards]] — the v5 surface recipe that the SQCDP card extends with a `variant=hero` (4 px coloured top band + larger primary number + sparkline + period chip).
- [[Dark-Mode-Opacity-Colors]] — severity / status badge colour conventions used across PostCard, JobCard, SqcdpProblemsTable.



## v7 (2026-05-10) — Cross-Component URL-State Sync (Edit-toggle bug fix)

User report: clicking the editing button “does absolutely nothing.” Root cause: the four URL-state hooks (`useBoardEditMode`, `useBoardSearchParam`, `useTvSearchParam`, `useAreaSearchParam`) all relied on `useState` + `popstate` only — but `history.{replace,push}State` doesn't fire `popstate`, so any sibling reader stayed frozen at the value it captured on mount. For `?edit=` there are many readers (per-card pencils across all six boards), so flipping the toggle URL didn't propagate. v7 introduces `production-boards/lib/url-search-state.ts` — a `writeSearchParam` that dispatches a namespaced `CustomEvent` after the `history` write, plus a generic `useSearchParamState<T>` hook the four key-specific hooks now wrap. `useBoardEditMode` was extracted from `components/board-edit-toggle.tsx` to `hooks/use-board-edit-mode.ts` (silences `react-refresh/only-export-components`).

See [[Implement-Production-Boards-Hourly-Grid]] § v7 for the full file inventory, [[Fix-Production-Boards-Edit-Toggle-No-Op]] for the bug write-up, and [[Cross-Component-URL-Search-State]] for the reusable pattern.

### Related (added)

- [[Cross-Component-URL-Search-State]] — the reusable URL-state subscriber pattern extracted from this fix.
- [[Fix-Production-Boards-Edit-Toggle-No-Op]] — the bug write-up and lessons.



## v8 (2026-05-10) — Cinematic Per-Area Transition (TV mode)

The Hourly Completion Tracker's TV-mode per-area auto-rotation now plays as a film-style chapter break instead of an abrupt swap. Four-layer recipe: outgoing slice fades + scales + blurs + lifts up (600ms), a centred chapter title overlay mounts and holds for ~1.45s with the slice's accent radial gradient, then the incoming slice materialises with a fade + scale + blur + slide-down (700ms). The chapter overlay's accent reuses `deriveAreaColor(area_code)` so the colour matches the ID-card chrome already on screen. Manual nav (clicking an area tab) and `prefers-reduced-motion: reduce` both collapse to a 250ms calm crossfade.

**New files in `boards/hourly/`:**
- `lib/area-color.ts` — `accentHexFor` / `accentRgbaFor` mappers from area_code → Tailwind 500-band hex / rgba string. Reuses the same 8-bucket palette as `./skills`.
- `components/area-chapter-overlay.tsx` — the centred chapter title overlay component (eyebrow / code / name / sub-line cascade with framer-motion variants).
- `components/area-transition-frame.tsx` — wraps the TV body. Owns the cinematic-vs-calm variant switch and the chapter overlay's mount lifecycle.

Layer 4 (optional bottom progress bar that drains+refills across the cycle) was prototyped and gated off by the 460KB chunk-budget guard in the spec — the chunk landed at 467KB without it. See [[Implement-Production-Boards-Hourly-Grid]] § v8 for full validation, framer-motion variants, files, and trade-offs, and [[Cinematic-Tab-Rotation]] for the reusable pattern.

### Related (added)

- [[Cinematic-Tab-Rotation]] — the reusable four-layer pattern.



## v9 (2026-05-10) — SQCDP Historical Charts (line / area / bar, color-matched)

The SQCDP scorecards' tiny 32-px sparkline grew into a **last-6-months historical chart** in the footer of every primary card (Safety / Quality / Cost / Delivery / Production). Each metric picks its own visualisation — `chart_type` text column with a CHECK constraint pinning `'line' | 'area' | 'bar'`, default `'area'` (migration 296). The chart's accent matches `metric.color_hex` (or `defaultColorFor(category)` fallback); the gradient stops, target reference line, and tooltip body all reuse the same accent for visual cohesion. Cards mount with a framer-motion variants stagger across the primary row (`staggerChildren: 0.08`, `delayChildren: 0.15`), and Recharts' geometry inside each card draws with `animationBegin = index * 60` for a synchronised cascade. Reduced-motion users see static, instantly-rendered charts.

**New files in `boards/sqcdp/`:**
- `lib/color.ts` — `hexToRgba(hex, alpha)` with malformed-input fallback (used by the area gradient stops + target reference line opacity).
- `components/sqcdp-chart.tsx` — the three-variant component (replaces the v6 `<SqcdpSparkline>`, which was deleted; sole consumer was `<SqcdpCard>`).

**Modified:**
- `boards/sqcdp/components/{sqcdp-card,sqcdp-grid,sqcdp-editor-sheet}.tsx` — card body restructured for the chart strip, primary-row variants wrapper, editor sheet gained a `<Select>` + live `<ChartPreview>`.
- `boards/sqcdp/hooks/use-sqcdp-metrics.ts` — `chartType` on `SqcdpMetricRow`; `mapRow` slices history to last 180 days client-side (see `SQCDP_HISTORY_WINDOW_DAYS`).

**Validation:** 139/139 vitest pass (126 pre-existing + 7 hexToRgba + 6 chart smoke). 0 new lint warnings. `feature-shift-productivity` chunk **467.20 KiB** (unchanged from v8 — v9 work landed in the lazy `sqcdp-board` chunk which grew from ~36 → 41.37 KiB).

See [[Implement-Production-Boards-Hourly-Grid]] § v9 for the full Recharts variant configs, mount-stagger orchestration, empty-state UX, editor preview pattern, 6-month query scope decision, and trade-offs. The chart-variants recipe is captured as a stand-alone pattern in [[Selectable-Chart-Variants]] for reuse on the Hourly KPI strip and other dashboards.

### Related (added)

- [[Selectable-Chart-Variants]] — the reusable three-variant Recharts pattern.



## v10 (2026-05-10) — Editor Dialog + Historical Data CRUD + Chart Markers

The SQCDP card editor migrated from a 480 px right-side `<Sheet>` to a centred `<Dialog>` at `sm:max-w-[820px]` so the metric form can use a 2-column grid + host the live chart preview alongside it + embed the new `<SqcdpHistoryEditor>` below. Migration 297 added `sqcdp_metrics.show_markers` (boolean, default false). The chart's line + area variants paint dot markers when `show_markers === true`; points at-or-above target render at a slightly larger radius with a `currentColor` ring (the `"we hit target on these days"` cue). The history editor wraps a new `useSqcdpMetricHistory(metricId)` hook with `createPoint` / `updatePoint` / `deletePoint` / `bulkInsertPoints` mutations and lets curators back-fill past dates, edit mistakes, or one-click generate 26 weeks of plausible sample data. Confirm-if-dirty exit via `formState.isDirty` + a small `<ConfirmDialog>`.

**New files in `boards/sqcdp/`:**
- `hooks/use-sqcdp-metric-history.ts` (+ `.test.tsx`) — independent TanStack hook scoped to a single metric, server-filtered to the last 180 days, invalidates BOTH the history key and the parent metrics list on every mutation.
- `components/sqcdp-history-editor.tsx` (+ `.test.tsx`) — admin-facing CRUD with shadcn `<Table>` + per-row inline edit + `<DatePicker>` + `+ Generate sample data` (gated on empty history).
- `components/sqcdp-editor-dialog.tsx` — replaces `sqcdp-editor-sheet.tsx` (deleted in the same patch). 2-column form, full-width preview, history editor below.

**Modified:**
- `components/sqcdp-chart.tsx` — `dot` callback for `show_markers`, above-target highlight, new `overrideHistory` prop the editor preview uses to surface in-flight history edits.
- `hooks/use-sqcdp-metrics.ts` — `showMarkers` on `SqcdpMetricRow` / `CreateSqcdpMetricInput` / `mapRow` / SELECTs / INSERT / UPDATE / optimistic onMutate.
- `sqcdp-board.tsx` — import swap from `SqcdpEditorSheet` → `SqcdpEditorDialog`.

**Validation:** 152/152 vitest pass (139 pre-existing + 5 new chart marker tests + 6 new history hook tests + 2 new history editor smoke tests). 0 new lint warnings. `feature-shift-productivity` chunk **478.42 KB raw / 102.01 KB gzip** = identical to v9 (the work landed in the lazy `sqcdp-board` chunk: 41.37 → 56.86 KB / +15.49 KB delta).

See [[Implement-Production-Boards-Hourly-Grid]] § v10 for the full Recharts dot-callback shape, history hook query-key + invalidation chain, sample-series random-walk algorithm, and trade-offs. The dialog-style editor recipe is captured as [[Editable-Board-Dialogs]] (sibling to [[Editable-Board-Sheets]]; decision tree: dialog when forms ≥ 6 fields / 2-column / live preview / embedded subsystem).

### Related (added)

- [[Editable-Board-Dialogs]] — the new dialog-style editor recipe.



## v12 (2026-05-10) — SQCDP Editor Flexibility (per-input fonts, stacked sub-metrics, trend / prefix / suffix / decimals / polarity)

Landed the third major SQCDP editor pass plus a tightly scoped "more flexibility" follow-on. The metric editor went tabbed (Basics / Style / Advanced / History), the cards now render stacked sub-metric blocks when curators add at least one, and the surface picked up trend arrows, comparison subtext, prefix / suffix, decimal-place override, and lower-is-better polarity.

**Migration 300** added six columns to `sqcdp_metrics`:
- `style_config jsonb` — per-field font / size / weight / transform overrides
- `sub_metrics jsonb` — stacked sub-metric array; non-empty switches the card to the stacked layout (current_value is ignored)
- `value_prefix text`, `value_suffix text` — prepended / appended around the formatted value
- `decimal_places int CHECK (NULL OR 0..4)` — explicit override of the formatter's max/min fraction digits
- `lower_is_better boolean` — polarity flag for the trend arrow color

**New files in `boards/sqcdp/`:**
- `lib/style-config.ts` (+ `.test.ts`) — `FieldStyle` / `StyleConfig` types, the JIT-safe static class maps (`SIZE_CLASS` / `WEIGHT_CLASS` / `FONT_FAMILY_CLASS` / `TRANSFORM_CLASS`), `fieldClasses` merge helper, `parseStyleConfig` sanitiser. Pattern lives at [[Per-Field-Style-Overrides]].
- `components/sqcdp-sub-metrics-editor.tsx` — `@dnd-kit` drag-to-reorder list with per-row Title / Value / Format / Subtitle inputs.
- `components/sqcdp-card.test.tsx` — 7 smoke cases covering single-mode rendering, prefix+suffix+decimals, trend, polarity, comparison, and stacked sub-metric rendering for 1 + 2 sub-metrics.

**Modified:**
- `lib/format.ts` — `formatValueWithOptions(format, value, unit, { prefix, suffix, decimal_places })` skips em-dash sentinels and only applies decimal override on `number` / `percent`.
- `hooks/use-sqcdp-metrics.ts` — `SubMetric` / `SubMetrics` types, `parseSubMetrics()` sanitiser, all 6 v12 columns on `SqcdpMetricRow` + `CreateSqcdpMetricInput`; `mapRow` reads them; SELECTs / INSERT / UPDATE / optimistic onMutate carry them.
- `components/sqcdp-card.tsx` — `computeTrend` / `trendColorClass` / `TrendIndicator` / `SubMetricBlock` / `renderPrimaryValue` helpers, density tokens for the sub-metric block typography + trend icon size, stacked-mode rendering branch, prefix/suffix/decimals via `formatValueWithOptions`, style-config application via `fieldClasses`, comparison subtext.
- `components/sqcdp-editor-dialog.tsx` — full restructure: form body wrapped in shadcn `<Tabs>`, sticky `<LivePreview>` renders an actual `<SqcdpCard>` from `useWatch` values, dialog width bumped from `820px` → `920px`. Tabs: Basics / Style / Advanced / History (History `disabled` in create-mode).

**Validation:** 174/174 vitest pass (152 carry-over + 9 new style-config + 6 new format option + 7 new card smoke). 0 new lint warnings. `feature-shift-productivity` chunk: 478.42 KB raw / 102.01 KB gzip = identical to v11.x baseline (everything landed in the lazy `sqcdp-board` chunk: 56.86 → 77.26 KB / +20.40 KB delta).

See [[Implementations/Implement-Production-Boards-Hourly-Grid]] § v12 for the full migration shape, JIT-safe static-class-map technique, sub-metric layout switch rule, trend computation + polarity, files added/modified, and trade-offs. The dialog tabbed-body decision rule is captured in [[Editable-Board-Dialogs]] "When to add tabs to the dialog body". The reusable per-field style-overrides shape (and the JIT-safe technique) is captured in [[Per-Field-Style-Overrides]].

### Related (added)

- [[Per-Field-Style-Overrides]] — the new pattern note covering the JSON shape + JIT-safe static class map technique extracted from this work.



## v13 — Chart flexibility (2026-05-10)

SQCDP cards gained a per-metric chart-config bag (`chart_config jsonb`, migration 302). Curators can now layer N goal lines (each with their own value/label/color/style/width), restyle the built-in target line, choose curve type (`monotone | linear | step`), pin Y-axis bounds, toggle horizontal/vertical grid lines independently, and overlay an average line + min/max highlight.

**Editor surface:** new `Chart` tab in `<SqcdpEditorDialog>` between Style and Advanced (5 sections — Display / Curve & axis / Grid / Reference lines / Annotations). The Style tab lost its `Chart appearance` section — chart-type + show-data-points moved to the new Chart tab's `Display` section since they're conceptually about chart appearance, not card colors. Live preview at the top of the dialog reflects every Chart-tab change via the existing `useWatch` subscription.

**Pattern reference:** [[Selectable-Chart-Variants]] gained a "Reference lines + extremes recipe" section documenting the `pickDot` composer + `<Cell>` extremes pattern — reusable anywhere we render a Recharts series with overlaid context.

**Files added:** `lib/chart-config.ts` (+22 unit tests), `components/sqcdp-goal-lines-editor.tsx`, `migrations/302_sqcdp_chart_config.sql`.

**Bundle:** `feature-shift-productivity` parent chunk neutral at 478 KB; `sqcdp-board` lazy chunk grew from ~80 KB to 97 KB.

Details: [[Implement-Production-Boards-Hourly-Grid#v13 — Chart Flexibility (editable goal lines, curve, axes, grid, average, extremes) (2026-05-10)]]



## v15 (2026-05-17) — SQCDP Problems UI retired

The SQCDP **Problems** surface (Add Problem button + `<SqcdpProblemsTable>` + the `'problem'` branch of `<SqcdpEditorDialog>` + the `useSqcdpProblems` hook + the problems-table component file) was retired in full on 2026-05-17. UI-only removal — the `production_board_sqcdp_problems` table, its RLS, triggers, and composite FK onto `production_board_sqcdp_categories(organization_id, slug)` are intentionally preserved in the database in case the surface is brought back later. The board header now hosts only Manage categories / Refresh / Display on TV.

If you're reading this because you found the DB table with no UI surface: that's expected. The history + restore-points live in [[Sessions/2026-05-17#Remove SQCDP Problems UI]].
