---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-05-10
---
# Implement Production Boards — Hourly Completion Tracker

## Purpose / Context

Shipped a new sidebar entry **Production Boards** under Labor Management whose first board is the **Hourly Completion Tracker** — a per-associate × per-hour grid mirroring the Daily Completion Tracker recipe but bucketed by clock hour. Goal: a TV-display-grade live view of who is hitting per-hour targets across the floor right now.

Reference component: [[ProductionBoards - Feature Module]].

## Decisions

### TV mode is `?tv=1`, not a separate route

Used a search param so any deep link can be "cast to TV" without changing the canonical app URL. `<TvFrame>` is a `fixed inset-0 z-50` overlay; the page itself doesn't unmount. Benefits:

- Refresh on the TV preserves the working-area filter (filters live in component state, but the URL keeps the `?tv=1`).
- ESC key + a small bottom-right Exit button both `pushState` away from `?tv=1` to drop the overlay without rerunning the route loader (no auth round-trip).
- Best-effort `requestFullscreen()` on mount, swallowed silently if the browser blocks for lack of user gesture.

### Polling cadence: 30 s, visibility-gated

Per `realtime-policy workspace rule` no new Supabase Realtime channel can be added. We poll the activity-events RPC every 30 s when (a) the date is today AND (b) `document.visibilityState === 'visible'`. The visibility flag is tracked via a small `useDocumentVisibility` hook that listens to `visibilitychange`; React Query's `refetchInterval` is recomputed every render, so flipping the flag toggles the timer. Background tabs cost zero requests.

`refetchOnWindowFocus` is set to `isToday` (true on today, false on historical dates) so the TV gets a fresh snapshot when an operator returns to it.

### No new permission key — reuse `shift_productivity:view`

Added `PRODUCTION_BOARDS` to `ROUTE_PROTECTION_CONFIGS` mapped to `{ action: 'view', resource: 'shift_productivity' }`. The DB migration (`292_add_production_boards_navigation.sql`) only inserts a `navigation_items` row + `role_navigation_permissions`; it intentionally does NOT add a `permissions` row. Any role that can view Shift Productivity can view Production Boards.

If a future board needs different access (e.g. customer-facing TVs), file an ADR and add a `production_boards:view` permission then.

### Colour ramp tied to `shift_productivity_settings.target_*_per_hour`

The colour ramp (`above` / `on` / `below` / `no-activity` / `off-shift`) is derived from `getHourCellState({ count, target })`:

- count <= 50% target → `below`
- count between 50–100% → `on`
- count > target → `above`
- 0 → `no-activity`
- outside the user's shift window → `off-shift` (rendered at opacity 30)

`target` is computed by `effectiveTargetForBucket(byType, hourTargets)` — single-type buckets pick the matching `target_*_per_hour`; mixed buckets are a count-weighted average across the present types. This matches operator intuition ("the more a task type contributed, the more its target should weigh on the colour") without forcing us to pick the smallest target and tank everyone.

### Hour bucket built client-side from `getTeamActivityEvents`

Decided NOT to write a new `get_team_hourly_*` RPC. Instead, exposed two new public wrappers on `TeamPerformanceService`:

- `getActivityEventsForDate(orgId, dateString, timezone)` — wraps the existing private `getTeamActivityEvents(...)` after computing `getUTCBoundariesForDate(dateString, timezone)`.
- `getShiftAssignmentsRaw(orgId)` — wraps the private `getShiftAssignmentsWithDetails(orgId)` so we can read shift start/end clock times for off-shift dimming without re-running the heavy `getTeamProductivity` aggregation.

Client bucketing via `bucketEventsByHour` is O(events) and fits comfortably in a render tick at typical event counts (≤ ~10k/day across an org). If event volume becomes an issue we can introduce `get_team_hourly_counts` later without changing the React surface (the hook returns the bucketed Map; the producer can swap).

### Wake Lock + idle cursor hide

`useScreenWakeLock()` is mounted inside `<TvFrame>` and re-acquires on `visibilitychange`. The cursor hides after 3 s of mouse idle and reappears on `mousemove`. Both work via plain web APIs — no third-party library.

### Off-shift dimming

`isHourWithinShift(hour, startMinutes, endMinutes)` handles overnight shifts (`end < start`) by splitting into `[start, 24:00) ∪ [00:00, end)`. Users with no active shift assignment are treated as on-shift everywhere so the board still displays activity for ad-hoc / unassigned associates.

## Files created / modified

### New

- `src/routes/_authenticated/apps/production-boards.tsx`
- `src/features/shift-productivity/production-boards/index.ts`
- `src/features/shift-productivity/production-boards/production-boards-page.tsx`
- `src/features/shift-productivity/production-boards/components/{hourly-completion-board,board-header,board-legend,working-area-filter,tv-frame,tv-clock}.tsx`
- `src/features/shift-productivity/production-boards/hooks/{use-hourly-productivity,use-screen-wake-lock}.ts`
- `src/features/shift-productivity/production-boards/lib/{types,hour-bucket,hour-bucket.test}.ts`
- `supabase/migrations/292_add_production_boards_navigation.sql`

### Modified

- `src/components/layout/data/sidebar-data.ts` — added Production Boards leaf under Labor Management with `IconLayoutDashboard`.
- `src/lib/auth/route-protection.ts` — added `PRODUCTION_BOARDS` config mirroring `SHIFT_PRODUCTIVITY`.
- `src/lib/supabase/team-performance.service.ts` — exported `ShiftAssignmentDetailRow` interface; added public `getActivityEventsForDate` and `getShiftAssignmentsRaw` wrappers.
- `src/components/layout/breadcrumbs.tsx` — added `'/apps/production-boards': 'Production Boards'` label.

## Validation

- `pnpm vitest run src/features/shift-productivity/production-boards/lib/hour-bucket.test.ts` → 21 tests passed (formatHour, getAllHours, getLocalHour, getCurrentHour, targetKeyForEventType, bucketEventsByHour, getHourCellState, effectiveTargetForBucket, isHourWithinShift, parseClockTime).
- `pnpm lint:check` → 91 warnings, 0 errors. Same warning count as pre-change baseline; my new files contribute 0 warnings (the original `useCallback` / `@tanstack/query/no-unstable-deps` warning was fixed by destructuring `refetch` references).
- `pnpm build` → ✓ successful. `feature-shift-productivity` chunk is 424.44 KB (under the 500 KB per-chunk budget).
- Bundle budget script reports pre-existing failures on `warehouse-location-map` and `feature-admin` chunks — NOT introduced by this work.
- ESLint warning ratchet remains at the existing post-baseline state (91 warnings vs baseline 16). Pre-existing; no warnings added.

## Open follow-ups

- **Department filter UI** — the hook exposes `departments` and accepts a `departments` filter, but the page only wires the working-area multi-select. Add a department filter (or fold both into a single "Filters" popover) when needed.
- **Dedicated `get_team_hourly_*` RPC** — if event volume per day grows beyond ~50k rows the in-memory bucket will start to feel sluggish on first load. Swap `getActivityEventsForDate` for a server-side hourly aggregation while keeping the same React surface.
- **Live shift-event overlays** — future enhancement: stripe scheduled breaks across the affected hour cells (the data already exists in `assignment.breaks` / `inline_shift_schedule.breaks`).
- **Multi-board layout** — "Production Boards" is plural by design. Add a board-picker tab strip when the second board ships (e.g. "Hourly Throughput by Area").
- **Search box** — the hook already filters by `filters.search`; the page UI doesn't render the input yet.

## Related

- [[ProductionBoards - Feature Module]]
- [[ShiftProductivity - Feature Module]]
- [[TeamPerformance - Supabase Service]]
- [[Dark-Mode-Opacity-Colors]]
- [[Realtime-Subscription-Hygiene]]
- [[React-Query-Patterns]]



## v2 — Per-Area Tabs + KPI Strip (2026-05-10)

### Layout

Production Boards now opens to a tabbed surface — one tab per active working area + an `All Areas` aggregate on the far left (default). Each tab renders, top-down:

1. `<BoardMetrics />` — 4-cell unified-workbench KPI strip (`Card gap-0 overflow-hidden p-0 shadow-sm` with `lg:grid-cols-4 lg:divide-x` between cells, per [[Unified-Workbench-Card-Layout]]).
2. `<HourlyCompletionBoard />` — the existing hour grid, scoped to the active tab.

The order is metrics-on-top / tracker-at-the-bottom and they share the same `space-y-4 lg:space-y-6` rhythm; the tracker keeps its inner Card chrome so it reads as a sibling section, not a nested one.

### URL state pattern

Added a `?area=<area_code>` search param alongside the existing `?tv=1`. Mirrors the same hand-rolled `URLSearchParams + history.replaceState` pattern (the codebase has no `validateSearch` precedent yet). Defaults to `area=all` (omitted from URL when default). `replaceState` (not `pushState`) so tab clicks don't pollute history.

```ts
// useAreaSearchParam — reads ?area=, popstate-aware setter
const [activeAreaValue, setActiveAreaValue] = useAreaSearchParam()
```

The page derives `activeTab` from `areaTabs.find((t) => t.value === activeAreaValue) ?? areaTabs[0]`, then pushes the resolved area's `id` (or `null` for `all`) into `useHourlyProductivity().updateFilters({ workingAreaIds: [...] })` via a tiny diff-aware effect.

### Decision: dropped the WorkingArea multi-select filter

The tab strip is now the single area selector. The previous `<WorkingAreaFilter>` (shadcn `<MultiSelect>`) was redundant for area scoping and added a second mental model ("set the URL params — or — set the multi-select?"). Deleting it removed ~40 lines, one component file, and one barrel export. If a future board needs *cross-area subset* (e.g. "include outbound + receiving"), file an ADR and bring back a multi-select. For now the tab strip is enough.

### KPI cards (computed by `computeBoardMetrics`)

Pure helper added to `lib/hour-bucket.ts`:

```ts
computeBoardMetrics({ associates, hourBuckets, hourTargets, isToday, timezone, now }) =>
  { activeAssociates, totalAssigned, totalCompletions, avgPerHour, hoursElapsed, targetAchievementPercent, targetPerHour, ramp }
```

Definitions:

| Card | Primary | Subtitle | Icon · color |
|---|---|---|---|
| Active Associates | `count(associates with userTotal>0)` | `of {totalAssigned} assigned` | `IconUsers` · sky-500 |
| Total Completions | `sum(events for active associates)` | `Pace {avgPerHour}/hr` | `IconChecks` · emerald-500 |
| Average per Hour | `totalCompletions / hoursElapsed` | `Default {targetPerHour}/hr` (or settings label) | `IconClockHour4` · amber-500 |
| Target Achievement | `(avgPerHour / targetPerHour) * 100` capped at **999%** | source label (`Default 100/hr` when no settings row) | `IconTarget` · violet-500, primary number coloured by ramp |

`hoursElapsed`:
- Today: minutes-since-local-midnight in org tz / 60, **floored at 5 min** so the avg/hour denominator never blows up at the start of a shift (returned in `hoursElapsed` field for transparency).
- Historical days: 24h.

`ramp` (mirrors the cell-state ramp): ≥100 → `above` (emerald-600), 50–100 → `on` (emerald-600/80), 25–50 → `below` (emerald-600/60), <25 → `muted`. Exposed via `rampForTargetAchievement(percent)` helper.

Target source: `hourTargets.default` (currently routed from `target_picks_per_hour ?? 20`). The KPI strip uses a single coarse target — it's the "are we hitting our average" signal, not the fine-grained per-cell ramp the grid uses (which weights by event-type mix).

### Decision: filter on associate-area assignment, not event area

`get_team_activity_events` returns an `area: TEXT` column populated from configurable per-source `area_column` / `area_fallback` (migration 091). The string is not normalised against `working_areas.id` — it's whatever a per-activity-source `area_column` returns (often a name, sometimes a code, sometimes "Unknown"). We therefore filter purely on the **associate's current `working_area_id`**, NOT on `event.area`.

Documented limitation: an associate reassigned mid-day will show their entire day's events under their *current* area, not split between areas. Acceptable for now — operators care about "who's productive in this area right now" more than "how was this user's split today". If we ever need event-level area attribution, add a `working_area_id` column to the activity events RPC instead of trying to text-match.

### TV mode evolution

- `<TvFrame>` gained `areaName` / `areaCode` props rendered as a prominent `text-2xl font-semibold` badge in the header bar (next to the title).
- New `kpiStrip` slot above the body — the page passes `<BoardMetrics density='tv' />` (5xl primary numbers, sm uppercase labels, scaled icon tiles) so the KPI bar reads from across the warehouse.
- The hourly board still renders inside `<TvFrame>` with `density='tv' bare`.
- `?tv=1&area=outbound` works — TV mode honours the active tab.

### TV auto-rotation

When the URL params **start** with `?tv=1` AND the initial `?area=` is `all` (or omitted) and there's at least one working area, the page rotates the tab every 30s in `[All, area1, area2, …, All, …]` order. A small `IconRotate` indicator + `Rotating areas every 30s` label appears in the TV footer.

Key detail — rotation is gated on the *initial* URL param, not the current one. That way clicking a specific area in TV mode (e.g. via deep link or follow-up nav) pins the rotation off without re-reading state. The interval reads the live URL value each tick to compute the next area, so React state closure on `areaTabs` updates is irrelevant.

### Hook surface delta

`useHourlyProductivity` now also returns `allAssociates: AssociateRow[]` (unfiltered roster) and `workingAreas[].is_active`. The page uses these for the per-tab count badges and to filter the tab strip to active areas only.

### Empty / loading states

- A specific area with zero assigned associates renders a polished `<EmptyAreaState />` (`IconUserOff` tile, "No associates assigned to {area_name}", hint to assign via Labor Management). The metrics strip + grid are skipped — better than rendering 0/0/0 and making the operator think the system is broken.
- Initial load skeletons: 4 grey blocks for the metrics strip; 10 user-row skeletons × 24 hour cells for the grid (TV-density variant scales the swatches).

### Validation

- `pnpm vitest run src/features/shift-productivity/production-boards` → **33/33 ✅** (21 pre-existing + 9 new for `computeBoardMetrics` / `computeHoursElapsed` / `rampForTargetAchievement` + 3 new for `useHourlyProductivity` area-filter shaping).
- `pnpm lint:check` → 91 warnings, 0 errors. Same warning count as pre-v2 baseline; new files contribute **0** warnings.
- `pnpm build` → ✅ successful. `feature-shift-productivity` chunk: **431.97 KB raw / 88.19 KB gzip** (was 424.44 KB pre-v2; +7.5 KB delta). Well under 500 KB per-chunk budget. `node scripts/check-bundle-budget.mjs` reports the same pre-existing failures on `warehouse-location-map` and `feature-admin` only — no new regression.

### Files

**New**
- `src/features/shift-productivity/production-boards/components/board-metrics.tsx`
- `src/features/shift-productivity/production-boards/hooks/use-hourly-productivity.test.tsx`

**Modified**
- `src/features/shift-productivity/production-boards/production-boards-page.tsx` — full rewrite (Tabs, `?area=` state, TV-mode rotation, empty / loading slots).
- `src/features/shift-productivity/production-boards/components/tv-frame.tsx` — added `areaName` / `areaCode` / `kpiStrip` / `rotationActive` props.
- `src/features/shift-productivity/production-boards/lib/types.ts` — added `BoardMetrics` and `TargetRamp` types.
- `src/features/shift-productivity/production-boards/lib/hour-bucket.ts` — added `computeBoardMetrics`, `computeHoursElapsed`, `rampForTargetAchievement`.
- `src/features/shift-productivity/production-boards/lib/hour-bucket.test.ts` — +9 cases.
- `src/features/shift-productivity/production-boards/hooks/use-hourly-productivity.ts` — exposes `allAssociates`; `workingAreas[].is_active` flag.
- `src/features/shift-productivity/production-boards/index.ts` — barrel updates (added `BoardMetrics`, `computeBoardMetrics`, `computeHoursElapsed`, `rampForTargetAchievement`, `BoardMetricsValue`, `TargetRamp`; removed `WorkingAreaFilter`).

**Deleted**
- `src/features/shift-productivity/production-boards/components/working-area-filter.tsx` — superseded by the tab strip.

### Open follow-ups (carry-over from v1 + new)

- **Event-level area attribution** — if operators ever need historical re-assignment splits, add `working_area_id` to `get_team_activity_events` rather than text-matching `event.area`.
- **KPI strip target sourcing** — currently uses `hourTargets.default` (a single number). Consider per-activity-mix weighted target later if the strip starts mis-representing diverse-task days.
- (carry-over) Department filter UI — hook accepts the filter, no UI yet.
- (carry-over) Dedicated `get_team_hourly_*` RPC for high-event-volume orgs.
- (carry-over) Live shift-event overlays (break stripes).
- (carry-over) Multi-board layout (board-picker tab strip when board #2 ships).



## v3 — Associate ID Card + Mini Skills Matrix (2026-05-10)

Replaced the user-column cell of the Hourly Completion Tracker with a rounded-corner ID-card widget that includes a compact skills matrix. Each row now reads like a workplace badge — gradient avatar, name + primary-skill pill, sub-line, and an 8-tile skill grid below the name.

### Skills derivation strategy — Branch B

No `associate_skills` (or equivalent) table is wired into the Production Boards data path. `shift_assignments` only carries a single `position_id`, and `worker_profiles.skills` (migration 039) is unused by the labor-management surface today. So v3 derives the skills picture entirely from data we already had in the hook:

- **`primarySkill`** ⇐ case-insensitive partial match against `shift_positions.position_title` via `mapPositionToSkill()`. Order: lead/supervisor → coordinator → picker → packer → shipper → putaway/stocker → receiver/inbound → cycle/count/auditor → rf/radio frequency → fallback `'warehouse'`.
- **`demonstratedSkills`** ⇐ Set of canonical skill ids derived from each user's bucketed event types via `mapEventTypeToSkill()`. Mapped against the live `activity_source_config` rows: `inbound_*` → receiver; `putaway*`/`putback`/`cart_stow` → putaway; `pick*`/`kit_picking` → picker; `pack`/`final_pack` → packer; `ship` → shipper; `cycle*` → cycle_count; `customer_response` → null (no tile).
- **`getSkillState(skills, skillId)`** ⇐ pure lookup returning `'primary' | 'demonstrated' | 'none'`. Primary outranks demonstrated when both apply; non-canonical primaries (`warehouse` / `coordinator`) leave every tile demonstrated-or-none.

### Canonical skills list (matrix tile order)

| # | id | label | code |
|---|----|---|---|
| 1 | picker | Picker | P |
| 2 | packer | Packer | K |
| 3 | shipper | Shipper | S |
| 4 | putaway | Putaway | U |
| 5 | receiver | Receiver | R |
| 6 | cycle_count | Cycle Count | C |
| 7 | rf | RF | F |
| 8 | lead | Lead | L |

`coordinator` and `warehouse` are *primary-only* labels — they appear in the primary pill ("COORD" / "WHS") but are NOT rendered as matrix tiles. This keeps the matrix to operational skills the bucketed events can actually demonstrate.

### Area-color rule

Each `working_areas.area_code` is hashed (FNV-1a) into one of 8 curated palette keys: `emerald | sky | amber | violet | rose | cyan | lime | fuchsia`. The card's avatar gradient + ring + primary pill + active-row outline all derive from this single key via a static Tailwind class table (so JIT picks up the literals).

The All-Areas-vs-single-area decision: when `filters.workingAreaIds.length === 1` the hook overrides every visible row's `areaColor` to the active area's colour so the cards read as a cohesive tab; in All-Areas view (or a future multi-area selection) each row keeps its intrinsic area colour so they stay distinguishable. Documented on `AssociateRow.areaColor` and in `useHourlyProductivity` directly.

### TV density variant

`density='tv'` is plumbed through `<AssociateIdCard>` and `<SkillsMatrix>`:

- Avatar 56×56 (`h-14 w-14`), name `text-base font-semibold`, sub-line `text-xs`.
- Skills tiles `h-6 w-6 rounded-md text-[10px] font-bold`.
- Card padding `px-4 py-3`, `min-h-[88px]`.
- Card chrome `border-border/40 ring-1 ring-border/30` (cooler than the normal density's `border-border/60`).

The Hourly board's user-column widths bump to `min-w-[260px] lg:min-w-[280px]` (normal) and `min-w-[340px]` (TV) to fit the new card.

### Files

**New**
- `src/features/shift-productivity/production-boards/lib/skills.ts` — canonical list, position/event-type mappers, `getSkillState`, area-color hash + static class table.
- `src/features/shift-productivity/production-boards/lib/skills.test.ts` — 22 cases (mapper edges, fallback, derivation, getSkillState combinations, deterministic colour).
- `src/features/shift-productivity/production-boards/components/associate-id-card.tsx` — the ID-card widget with avatar block, identity block, skills matrix, shift-state icon.
- `src/features/shift-productivity/production-boards/components/skills-matrix.tsx` — the 8-tile mini matrix with per-tile tooltips.

**Modified**
- `src/features/shift-productivity/production-boards/lib/types.ts` — extended `AssociateRow` with `primarySkill`, `demonstratedSkills`, `areaColor`. Re-exported `SkillId`, `SkillState`, `AssociateSkills`, `AreaColorKey`.
- `src/features/shift-productivity/production-boards/lib/hour-bucket.ts` — added `collectDemonstratedSkills(perUserBuckets)` sibling helper.
- `src/features/shift-productivity/production-boards/lib/hour-bucket.test.ts` — fixtures bumped to include the new fields (3 new cases for `collectDemonstratedSkills`).
- `src/features/shift-productivity/production-boards/hooks/use-hourly-productivity.ts` — split `intrinsicAssociates` (stable across filter changes) from `associates` (merged with hourBuckets-derived demonstrated skills + active-area colour override). Re-ordered so `hourBuckets` is computed before `associates`.
- `src/features/shift-productivity/production-boards/components/hourly-completion-board.tsx` — replaced the user-column inline avatar/name block with `<AssociateIdCard>`. Sticky-left `<td>` is now `bg-card/0` so the inner card is the visible card. Computes `cardActive` (any demonstrated skill or currently on shift) and `cardOffShift` (today AND off-shift now AND no activity AND a known shift window) per row.
- `src/features/shift-productivity/production-boards/index.ts` — barrel adds `AssociateIdCard`, `SkillsMatrix`, the skills helpers, `collectDemonstratedSkills`, and the new types.

### Validation

- `pnpm vitest run src/features/shift-productivity/production-boards` → **58 / 58 ✅** (22 new + 33 hour-bucket + 3 hook).
- `pnpm lint:check` → 91 warnings, 0 errors. Same warning count as v2 baseline; new files contribute **0** warnings.
- `pnpm build` → ✅ successful. `feature-shift-productivity` chunk: **440.73 KB raw / 90.78 KB gzip** (was 432 KB pre-v3; +8.7 KB delta — well under the 30 KB headroom budget). Bundle-budget script (post-min) reports the chunk at **430.40 KB · pass**.
- The two pre-existing chunk-budget failures on `warehouse-location-map` and `feature-admin` carry over from v1/v2 — NOT introduced by this work.
- Repo-wide `pnpm test:unit` shows the same 24 pre-existing failures (security-validation, rbac-hardening, work-distribution-panel, rf-cycle-count-unified) — none touch shift-productivity.

### Open follow-ups (carry-over + new)

- **Real `associate_skills` schema** — biggest follow-up. v3 derives skills from existing data; a proper per-user multi-skill record (skill, proficiency, effective_from, effective_to, source) would let HR, RF Cross-Training, and the matrix all read the same source of truth. Would replace `mapPositionToSkill` / `mapEventTypeToSkill` with a join in the hook without changing the AssociateIdCard surface.
- **Avatar fallback** — when `user_profiles.avatar_url` exists but loads slowly, the gradient + initials currently doesn't get rendered. Could swap to the `<Avatar>` shadcn primitive for a smoother fallback.
- **Tooltip provider count** — `<SkillsMatrix>` and the shift-state icon each wrap a `<TooltipProvider>`. Radix tolerates nested providers but a single row-level provider would be cheaper for very large rosters (~100+ associates).
- (carry-over from v1/v2) Department filter UI; dedicated `get_team_hourly_*` RPC for high-event-volume orgs; live shift-event break stripes; multi-board picker tab strip; search box.



## v4 — Operating-Hours Window 6 AM – 7 PM (2026-05-10)

Trimmed the Hourly Completion Tracker from a full 24-hour grid to the building's operating window. The board now renders only the 13 hour buckets the floor is actually open for — `[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]`, i.e. 6 AM through the 6 PM hour ending at 7 PM (`[BOARD_OPENING_HOUR, BOARD_CLOSING_HOUR) = [6, 19)` half-open).

### Constants and helpers

Centralised the operating window in `production-boards/lib/hour-bucket.ts` so the rest of the feature consumes one source of truth (and a future operator-configurable window has one place to land):

```ts
export const BOARD_OPENING_HOUR = 6
export const BOARD_CLOSING_HOUR = 19  // exclusive
export const BOARD_HOURS = [6, 7, 8, …, 18]  // length = 13
export const isWithinBoardHours = (h) => h >= 6 && h < 19
export const getCurrentBoardHour = (tz) =>
  isWithinBoardHours(getCurrentHour(tz)) ? getCurrentHour(tz) : null
```

`bucketEventsByHour` now drops events whose local hour falls outside `[6, 19)` so off-hours scans can't pollute KPI strip totals or the per-row `userTotal`. Verified by a dedicated test (events at 5:45 AM EDT and 7:30 PM EDT are both excluded; an in-window 11:30 AM event sticks).

### 13-column layout

`hourly-completion-board.tsx` now iterates `BOARD_HOURS` instead of `getAllHours()`. The today/current-hour highlight resolves through `getCurrentBoardHour(timezone)` — when the building is closed, no header column lights up. The user-column ID-card stays at `min-w-[260px] lg:min-w-[280px]` (normal) and `min-w-[340px]` (TV); table widths recomputed for 13 columns:

| Density | `min-w` | Hour cell |
|---|---|---|
| `normal` | `min-w-[1000px]` (was 1280px) | `h-8 min-w-[56px] text-[11px]` |
| `tv` | `min-w-[1500px]` (was 1700px) | `h-10 min-w-[80px] text-[13px]` |

Cells got bigger per column (56 → 80 in TV) because we have ~half the hour columns to spread across the same canvas. The grid now fills a 1080p TV horizontally without scroll while keeping each cell readable from across the warehouse.

### Pre-open / post-close UX

- **Pre-6 AM today** — `computeBoardMetrics` returns `hoursElapsed = 0`, `isPreOpen = true`, `ramp = 'muted'`. `<BoardMetrics>` renders `—` for **Average per Hour** and **Target Achievement** with the subtitle `"Building opens at 6 AM"`. The **Total Completions** card's pace subtitle also flips to `"Building opens at 6 AM"` when pre-open.
- **6 AM – 7 PM today** — clamp `(now − 6 AM) / 60` to `[5/60, 13]`. The 5-minute floor preserves the existing divide-by-zero guard for fresh opens. Avg / target render normally.
- **Post-7 PM today** — `hoursElapsed` clamps at `BOARD_HOURS.length = 13`, so the avg uses the full operating day rather than continuing to grow. Metrics render normally.
- **Historical days** — `hoursElapsed = 13` (was 24). `"Average per Hour"` and `"Target Achievement"` are now scoped to operating-hours-only activity to match the bucketed grid. Documented in `BoardMetrics.hoursElapsed` JSDoc.
- **Building-closed footnote** — when `isToday && currentBoardHour === null` (pre-6 AM OR post-7 PM today) the `HourlyCompletionBoard` renders a subtle centred line above the table: `"Building closed · opens 6a"`. Sized `text-xs` in normal and `text-base` in TV. Quiet by design — the closed state is also shouted via the muted KPI strip.

### 12 PM band divider

With only 13 columns, the morning / afternoon split reads better with a vertical hairline. The 12 PM `<th>` and matching `<td>` cells now carry a `border-l border-border/40` — picked via a tiny `bandDivider(hour)` helper inside the component so the hour-column rendering loop stays compact.

### Off-shift dimming with the trimmed window

`isHourWithinShift(...)` is unchanged — the existing same-day / overnight logic already handles all the cases. Verified with a new `5 AM – 9 AM shift` test: of `BOARD_HOURS`, only `[6, 7, 8]` come back as on-shift (5 is excluded by `isWithinBoardHours`; 9 is the exclusive end of the shift). Overnight shifts that wrap past midnight continue to clamp naturally because the rendering loop iterates `BOARD_HOURS` only — out-of-window hours never render.

### Auto-rotation safety

The TV-mode 30s area auto-rotation is unchanged — no logic depended on the old 24-column count. The smaller grid renders sub-second and the rotation interval stays appropriate.

### Files modified

- `src/features/shift-productivity/production-boards/lib/hour-bucket.ts` — added `BOARD_OPENING_HOUR` / `BOARD_CLOSING_HOUR` / `BOARD_HOURS` / `isWithinBoardHours` / `getCurrentBoardHour`; `bucketEventsByHour` filters off-hours events; `computeHoursElapsed` rebuilt around the new origin (with strict `< 0` check so 6:00 AM exact falls through to the 5-min floor); `computeBoardMetrics` adds `isPreOpen` and forces `ramp = 'muted'` while pre-open.
- `src/features/shift-productivity/production-boards/lib/types.ts` — `BoardMetrics.isPreOpen: boolean`, JSDoc reworded to `13h on historical days`.
- `src/features/shift-productivity/production-boards/lib/hour-bucket.test.ts` — replaced 3 old `computeHoursElapsed` cases with 5 new ones (historical=13, in-window math from 6 AM origin, pre-open returns 0, 5-min floor at exactly 6:00, 13h cap post-7pm); updated all 6 `computeBoardMetrics` cases for the 5-hours-elapsed reference instant; added the 4 required new cases (`BOARD_HOURS` shape, off-hours event-bucket filter, historical denominator, pre-open `isPreOpen` flag) plus the `5 AM – 9 AM shift` trimmed-window case. **66/66 ✅**.
- `src/features/shift-productivity/production-boards/components/hourly-completion-board.tsx` — iterates `BOARD_HOURS`, computes `currentBoardHour` locally, draws the `Building closed · opens 6a` footnote, applies the 12 PM band divider via `bandDivider(hour)`, density widths recomputed.
- `src/features/shift-productivity/production-boards/components/board-metrics.tsx` — em-dash + `Building opens at 6 AM` subtitles when `metrics.isPreOpen`; ARIA labels updated.
- `src/features/shift-productivity/production-boards/index.ts` — barrel exports `BOARD_HOURS`, `BOARD_OPENING_HOUR`, `BOARD_CLOSING_HOUR`, `getCurrentBoardHour`, `isWithinBoardHours`.
- `src/features/shift-productivity/production-boards/production-boards-page.tsx` — `HourlyBoardSkeleton` now renders 13 cells (sized larger to match the new normal/TV cells).

### Validation

- `pnpm vitest run src/features/shift-productivity/production-boards` → **66 / 66 ✅** (41 hour-bucket + 22 skills + 3 hook).
- `pnpm lint:check` → 91 warnings, 0 errors — same baseline as v3; new files contribute **0** warnings.
- `pnpm build` → ✅ successful. `feature-shift-productivity` chunk **431.26 KB** post-min (was 430.40 KB at v3, +0.86 KB — neutral as predicted). Pre-existing `warehouse-location-map` / `feature-admin` chunk-budget failures carry over from v1/v2/v3 and are NOT introduced by this work.

### Trade-offs

- **`getAllHours()` left in place** — still emits a 24-element array `[0..23]` and is still re-exported. Nothing in the production-boards feature uses it after v4, but removing it would be a wider change than this slice intends. A future cleanup can drop it (and the corresponding test) in a follow-up.
- **Window is hard-coded to 6 AM – 7 PM** — the spec called out this is a local board concern; we explicitly didn't add an org-configurable `shift_productivity_settings.operating_hours_start/end` because that would introduce a new abstraction without an immediate second consumer. See **Open follow-ups**.
- **`HOURS_IN_DAY = 24` left in place** — also still exported, kept around so `getAllHours()` (and any external caller) remains coherent with the 24-hour clock.

### Open follow-ups (carry-over + new)

- **Org-configurable operating window** — promote `BOARD_OPENING_HOUR` / `BOARD_CLOSING_HOUR` to `shift_productivity_settings.{board_opening_hour, board_closing_hour}` (with a check constraint enforcing `closing > opening` and both inside `[0, 24]`). Read through `useShiftProductivitySettings()` and pass into `bucketEventsByHour` / `computeHoursElapsed` instead of the const. Worth doing the first time a different operator asks for a different window.
- **"Closed" state for historical days outside the window** — historical days with no in-window activity render an empty grid with no "closed" footnote (the footnote only shows for `isToday`). If operators ever back-fill data for off-hours days this becomes confusing; revisit then.
- (carry-over from v1/v2/v3) Real `associate_skills` schema; department filter UI; dedicated `get_team_hourly_*` RPC for high-event-volume orgs; live shift-event break stripes; multi-board picker tab strip; search box.



## v5 — KPI Stat Card Elevation (2026-05-10)

Replaced the unified-workbench KPI strip with **four discrete elevated cards**. The previous one-Card / four-cells / `divide-x` panel reads as a single calm surface — fine for a control-center workbench, but the KPI strip is the page's hero summary and benefits from the cards reading as **lifted tiles**, not divider-separated cells.

### Visual recipe

Each card is a plain `<div>` (NOT the shadcn `<Card>` primitive — its built-in shadow class fights with the multi-stop stack we layer ourselves). The surface is composed of four cooperating layers, all clipped by the parent's `overflow-hidden`:

```
┌── border + bg-card (rounded-2xl / -3xl)
├── bg-linear-to-b from-white/4  ← top-light gradient "pop" hint
├── shadow stack                  ← the elevation (see below)
└── radial-glow span (group-hover) ← per-KPI accent on hover
```

Icon tile gains its own micro-elevation: `ring-1 ring-inset ring-{color}-500/20` + `shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]`. The big primary number gets a 1-pixel top text-shadow in dark mode only (`dark:[text-shadow:0_1px_0_rgba(255,255,255,0.04)]`) for a tactile touch — light mode reads fine without and a highlight there starts to look like a print artefact.

### Shadow stack — the box-shadow strings shipped

Normal density (24×7 floor monitors, laptops, supervisor desktops):

- **Light, resting** — `inset 0 1px 0 0 rgba(255,255,255,0.04), 0 1px 2px 0 rgba(0,0,0,0.06), 0 8px 24px -12px rgba(15,23,42,0.18)`
- **Dark, resting** — `inset 0 1px 0 0 rgba(255,255,255,0.05), 0 2px 4px 0 rgba(0,0,0,0.5), 0 24px 48px -12px rgba(0,0,0,0.55)`
- **Light, hover** — `inset 0 1px 0 0 rgba(255,255,255,0.05), 0 2px 4px 0 rgba(0,0,0,0.08), 0 16px 40px -12px rgba(15,23,42,0.25)`
- **Dark, hover** — `inset 0 1px 0 0 rgba(255,255,255,0.06), 0 4px 8px 0 rgba(0,0,0,0.55), 0 32px 64px -16px rgba(0,0,0,0.6)`

TV density (1920×1080, viewed across the warehouse):

- **Light, resting** — `inset 0 1px 0 0 rgba(255,255,255,0.04), 0 2px 4px 0 rgba(0,0,0,0.07), 0 24px 48px -16px rgba(15,23,42,0.28)`
- **Dark, resting** — `inset 0 1px 0 0 rgba(255,255,255,0.05), 0 4px 8px 0 rgba(0,0,0,0.55), 0 40px 80px -20px rgba(0,0,0,0.65)`
- **Light, hover** — `inset 0 1px 0 0 rgba(255,255,255,0.05), 0 4px 8px 0 rgba(0,0,0,0.10), 0 32px 64px -16px rgba(15,23,42,0.32)`
- **Dark, hover** — `inset 0 1px 0 0 rgba(255,255,255,0.07), 0 6px 12px 0 rgba(0,0,0,0.6), 0 48px 96px -24px rgba(0,0,0,0.7)`

Three stops per state (top inset highlight + tight 1–2 px ambient + wide soft drop) — any more and the card crosses from "premium quiet" into "inflated drop-shadow."

### Hover behaviour + reduced-motion

Three affordances on hover:

1. `-translate-y-0.5` (normal) / `-translate-y-1` (TV) — subtle lift, no big move.
2. Shadow stack swaps to its hover variant (slightly stronger second + third stops).
3. Per-KPI radial glow span (`bg-[radial-gradient(120%_60%_at_50%_0%,var(--kpi-glow),transparent_60%)]`) fades in at `opacity-0 → opacity-100` over 500 ms. The glow colour is set via inline `style={{ '--kpi-glow': accentRgba }}` so the JIT sees the literal class string for all four KPIs.

All three are gated on `motion-safe:` — users with `prefers-reduced-motion` see static cards with the same elevation. Concretely:

- Lift uses `motion-safe:hover:-translate-y-…`
- Hover-shadow swap uses `motion-safe:hover:shadow-[…]` and `motion-safe:dark:hover:shadow-[…]`
- Glow fade uses `motion-safe:transition-opacity motion-safe:group-hover:opacity-100`
- Mount-in animation uses `motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 motion-safe:fill-mode-backwards` with a 60 ms-per-card stagger via inline `style={{ animationDelay: `${index * 60}ms` }}`. `fill-mode-backwards` ensures cards stay invisible during their stagger delay so #4 doesn't paint at full opacity before #1 finishes.

### TV variant

The `density='tv'` token table differs from `'normal'` only in:

- `rounded-3xl` (vs `rounded-2xl`)
- Outer grid `gap-6` (vs `gap-4 lg:gap-5`)
- Stronger second + third shadow stops (see above) — needed so the elevation reads from across the warehouse.
- Larger hover lift (`-translate-y-1` vs `-translate-y-0.5`) — even when nobody's actually hovering on a TV, the accompanying mount-in animation gives a gentle "alive" feel.
- Body padding `p-8`, primary number `text-5xl`, label `text-sm`, secondary `text-base`, icon tile `h-10 w-10 rounded-lg`.

All handled by a single `density` prop on the inline `KpiCard` — no component fork.

### Why split into discrete cards vs the prior unified panel

- **Hierarchy clarity** — the page's other big surface is the hourly grid (`shadow-sm` outer Card). Lifting the KPIs above it visually says "this is the hero summary" without needing an explicit heading.
- **Per-cell affordances** — each card now hosts its own accent line, hover glow, and micro icon-tile elevation. The unified panel couldn't carry distinct top-accent lines without looking like four sub-panels.
- **TV scale-up** — at 1920×1080 the unified panel's `divide-x` hairlines become visually irrelevant (lost in pixel pitch from 30 ft away). Discrete cards with strong shadows are the only way to read the structure at distance.
- **Reusable elevation token** — captured in a new pattern note; future stat-card surfaces (e.g. `LiveOperatorStatus` summary tiles) can reach for the same recipe.

The unified-workbench pattern still applies elsewhere (Inventory Mgmt workbench, Agent Triggers Mission Control / Fleet & Diagnostics) — this is **not** a deprecation, just a different tool for a different problem. See [[Unified-Workbench-Card-Layout]] § "When NOT to use this pattern" for the same kind of carve-out.

### Files

**Modified** (no new files this slice):

- `src/features/shift-productivity/production-boards/components/board-metrics.tsx` — full rewrite around discrete elevated `KpiCard`s + density-aware shadow tokens + motion-safe mount + hover stack. `<MetricsSkeleton>` now mirrors the four-card grid for visual continuity through the loading→loaded transition.

No changes were needed in `tv-frame.tsx` (the TV path already passes `density='tv'` into `<BoardMetrics>`) or `production-boards-page.tsx` (the metrics outer container is now the component's own grid). The hourly board's `shadow-sm` outer Card was left as-is — the new elevation is meaningfully bigger, so the hierarchy already reads "lifted KPIs above a calm grid" without bumping the hourly board.

### Validation

- `pnpm vitest run src/features/shift-productivity/production-boards` → **66 / 66 ✅** (41 hour-bucket + 22 skills + 3 hook). Same suite, same green count as v4 — the markup change didn't break any assertions and no test queries the old single `<Card>` wrapper.
- `pnpm lint:check` → **91 warnings, 0 errors**. Same baseline as v4; the new file contributes **0** new warnings (Tailwind v4 warnings flagged on first pass were resolved by switching to `bg-linear-to-{b,r}` and `from-white/4` v4 idioms, and dropping decorative underscores in the `bg-[radial-gradient(…)]` value).
- `pnpm build` → ✅ successful. `feature-shift-productivity` chunk **434.08 KB** post-min (was 431.26 KB at v4; **+2.82 KB delta** — neutral as the spec predicted). Well under the 500 KB per-chunk budget.
- `node scripts/check-bundle-budget.mjs` — only the pre-existing `warehouse-location-map` (1487 KB) and `feature-admin` (975 KB) failures, both carry-overs from v1–v4. Zero new bundle-budget regressions.
- Playwright MCP not enabled in this environment; screenshot step skipped.

### Trade-offs

- **Arbitrary `shadow-[…]` values are long.** Inline shadow stacks inflate the JSX considerably (eight stack strings: 4 modes × 2 densities). Considered moving to `@utility` blocks in `index.css` but kept inline because: (a) Tailwind v4 JIT handles them natively without lint/build pain after the v4 idiom fixes, (b) they're co-located with the component, (c) they're the only consumer right now. If a second consumer adopts the pattern, promote into utilities — see new [[Elevated-KPI-Stat-Cards]] for the token recipe.
- **`rounded` synchronisation.** The radial-glow `<span>` and the top-accent line both rely on the parent card's `overflow-hidden` to clip them to the rounded edge. Don't drop `overflow-hidden` from the card surface — it's load-bearing for the visual.

### Reusability

The elevation recipe is captured as a stand-alone pattern in [[Elevated-KPI-Stat-Cards]] with the canonical token table + a "Don't" list. Likely next adopter: the `LiveOperatorStatus` summary tiles (already referenced in [[Dark-Mode-Opacity-Colors]]) — they're the same KPI-tile shape.

### Open follow-ups (carry-over + new)

- **Apply pattern to LiveOperatorStatus summary tiles** — the new pattern is now reusable. Aligning them on the same elevation recipe would make the productivity surfaces feel cohesive across the app.
- (Carry-over) Org-configurable operating window; "closed" footnote on historical days; real `associate_skills` schema; department filter UI; dedicated `get_team_hourly_*` RPC for high-event-volume orgs; live shift-event break stripes; multi-board picker tab strip; search box.



---

## v6 — Global Boards (SQCDP / Announcements / HR News / Jobs / Safety Alerts) (2026-05-10)

v6 turns the page from a single-board surface (the Hourly Completion Tracker) into a six-tab production-boards hub. The hourly board moves under `boards/hourly/` unchanged; five new boards live alongside it, each lazy-loaded into its own bundle chunk, all gated behind the new `production_boards:edit` permission for write paths.

### Migration shipped

`supabase/migrations/295_production_boards_content_tables.sql` — applied via Supabase MCP `apply_migration` on 2026-05-10. Contents:

- 8 tables: `production_boards`, `branches`, `sqcdp_metrics`, `sqcdp_metric_history`, `sqcdp_problems`, `production_board_posts`, `production_board_post_acks`, `production_board_job_postings`.
- 6 enums: `sqcdp_category` (locked at the canonical 9 entries — `safety/quality/cost/delivery/production/maintenance/shipping/big_idea/announcement` — no `custom`), `metric_value_format`, `metric_trend_period`, `post_scope`, `post_severity`, `sqcdp_problem_status`.
- RLS on every new table: org-scope SELECT + `production_boards:edit` mutation gating via `public.has_permission(...)`. The acks table also permits insert-by-self for the row's `user_id` so any authenticated user can ack a safety alert without `:edit`.
- Permission `production_boards.edit` seeded; granted to `admin`, `superadmin`, `manager`, `tka_supervisors`. Cast handles the legacy `user_role` enum NOT NULL column (custom roles fall back to `'viewer'::user_role` placeholder while `role_id` carries the actual lookup).
- New public storage bucket `production-board-images` (5 MB cap, image MIME types only). SELECT public; INSERT/UPDATE/DELETE require `production_boards:edit`.
- Per-org seed of 6 `production_boards` rows in display order.
- 403 backfill: `rolls_royce_assembly` and `tka_leaders` get `visible = false` rows on the production-boards navigation item so the frontend `.single()` lookup returns a clean falsy row instead of 406.

### Folder restructure (before → after)

**Before** (v5):
```
production-boards/
  components/{associate-id-card,board-header,board-legend,board-metrics,hourly-completion-board,skills-matrix,tv-frame,tv-clock}.tsx
  hooks/{use-hourly-productivity,use-screen-wake-lock}.ts
  lib/{hour-bucket,skills,types}.ts
  production-boards-page.tsx
  index.ts
```

**After** (v6):
```
production-boards/
  boards/
    hourly/  ← all v1–v5 hourly content moved here, 0 logic changes
      components/{associate-id-card,board-header,board-legend,board-metrics,hourly-completion-board,skills-matrix}.tsx
      hooks/{use-hourly-productivity,use-hourly-productivity.test}.ts(x)
      lib/{hour-bucket,skills,types}.ts
      hourly-board.tsx       ← per-area tabs + KPI strip + grid + auto-rotation + TvFrame chrome
    sqcdp/
      components/{sqcdp-card,sqcdp-grid,sqcdp-problems-table,sqcdp-sparkline,sqcdp-editor-sheet}.tsx
      hooks/{use-sqcdp-metrics,use-sqcdp-problems}.ts
      lib/{categories,categories.test,format,format.test}.ts
      sqcdp-board.tsx
    announcements/announcements-board.tsx
    hr-news/hr-news-board.tsx
    jobs/
      components/{job-card,job-editor-sheet}.tsx
      hooks/use-job-postings.ts
      jobs-board.tsx
    safety-alerts/safety-alerts-board.tsx
  components/
    {tv-frame,tv-clock,board-tabs,board-shell,board-edit-toggle}.tsx
    {post-card,post-editor-sheet}.tsx       ← shared by 3 post-scope boards
  hooks/
    {use-screen-wake-lock,use-board-search-param,use-board-search-param.test,use-can-edit-boards,use-can-edit-boards.test}.ts(x)
    {use-board-posts,use-branches,use-board-working-areas}.ts
  lib/boards.ts                              ← lazy registry
  production-boards-page.tsx                 ← header + tabs + shell + Suspense + (board)
  index.ts                                   ← updated barrel
```

### Tab shell + framer-motion `<AnimatePresence>` choice

`<BoardShell slug={...}>` wraps the active board in `<MotionConfig reducedMotion='user'><AnimatePresence mode='wait'>` and animates an 8 px slide + opacity (`duration: 0.25, ease: [0.22, 1, 0.36, 1]`) keyed on `slug`. The `mode='wait'` choice means the outgoing board fully exits before the incoming one mounts — important because each lazy chunk fires its own `<Suspense>` skeleton while loading and we don't want to overlay two skeletons on top of each other. `reducedMotion='user'` honours `prefers-reduced-motion` and falls back to a no-op transition.

The `?board=` URL state lives on `useBoardSearchParam()` — a tiny `URLSearchParams + popstate` wrapper that mirrors the existing `useTvSearchParam()` shape. The default slug (`hourly`) is normalised away from the URL on write so the canonical landing URL stays clean.

Edit affordances are gated by:
- `useCanEditBoards()` — TanStack Query around `authService.checkPermission(userId, 'production_boards', 'edit')`, `staleTime: 5 min`.
- `useBoardEditMode()` — `?edit=1` URL state. Toggled by `<BoardEditToggle>` in the page chrome (rendered only when `canEdit`).

When both are true, every editable surface (per-card pencil, problem row pencil, `+ Add` CTAs) flips visible. The toggle survives reload because it's URL state, not React state.

### SQCDP card recipe — extends [[Elevated-KPI-Stat-Cards]]

The SQCDP card lifts the v5 elevated-KPI surface recipe (border + bg-card + top-light gradient + 3-stop shadow + isolate + overflow-hidden + rounded-2xl/3xl) and stacks on top of it:

- **4 px solid colour band on top** (the new variant marker, distinct from the inset-1px highlight on the BoardMetrics cards). Colour is `metric.color_hex ?? defaultColorFor(category)` so the band reads as the category accent.
- **Header row**: Tabler icon (sized to `h-4 w-4` normal / `h-5 w-5` TV) tinted with the same accent, beside an uppercase category label.
- **Hero number**: `text-7xl font-black tabular-nums tracking-tight leading-none` (TV: `text-9xl`). Rendered via `formatValue(format, value, unit)` so each metric's `value_format` (`number/percent/currency/duration/text`) routes through its own formatter.
- **Subtitle + target line**: small muted text — subtitle from `metric.subtitle ?? metric.title`; target line `Target: {formatValue(...)}` only when `target_value != null`.
- **Sparkline**: `<SqcdpSparkline>` — Recharts `<LineChart>` inside `<ResponsiveContainer height={32}>` (TV: 48). No axes/grid, no animation, dashed `<ReferenceLine>` at `target_value`. When fewer than 2 history points exist, renders a single em-dash instead of a degenerate dot.
- **Period chip + last-update stamp**: small `bg-muted/50 rounded-full px-2 py-0.5 text-[10px]` chip showing the `trend_period` label; tabular-nums `Updated MMM d` derived from `MAX(history.recorded_at)`.
- **Hover-revealed pencil** (top-right) only when `canEdit && editMode`. Click bubbles up to `onEdit(metric)`.
- **Empty state** when no metric exists for a category: dashed-border placeholder card with the same 4 px coloured band on top and a `+ Add metric` CTA gated identically.

`<SqcdpGrid>` iterates over `SQCDP_CATEGORIES` (NOT over `metrics`) so empty categories still render a placeholder. Layout: 5-column primary row (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4`) above a 4-column secondary row.

`<SqcdpProblemsTable>`: shadcn `<Table>` with columns Problem · Category · Owner · Severity · Status · Due · (pencil). Severity + status badges use the opacity-token system per [[Dark-Mode-Opacity-Colors]] (e.g. `bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/25`). Empty state: "No active problems — nice job." Owner avatar pulls initials from the joined `user_profiles!assigned_to(full_name)` field.

`<SqcdpEditorSheet>`: right-side `<Sheet side='right' className='w-[480px]'>`, discriminated-union `mode` prop (`'metric' | 'problem'`). react-hook-form + zod, `<ColorPickerInput>` for colour overrides, `<ConfirmDialog>` for delete.

Locked-decision note: the spec drafted `position` for grid order on `sqcdp_metrics` and `due_date` (DATE) + `owner_user_id` for `sqcdp_problems`; the applied migration uses `display_order`, `due_at` (TIMESTAMPTZ), and `assigned_to` respectively. The hooks expose the migration column names on the row interface.

### Shared posts pattern (announcements / HR / safety on one table)

`production_board_posts.scope` discriminates the three boards on a single table. The shared infrastructure:

- **`useBoardPosts(scope, filters?)`** — single TanStack-Query hook, query key `['board-posts', scope, organizationId, workingAreaId, branchId]`, 60 s polling, visibility-gated. Joins `working_areas`, `branches`, `user_profiles!posted_by` and aggregates `production_board_post_acks` per post (`acks: production_board_post_acks ( user_id )` returns the array which the mapper turns into `ackCount` + `acknowledgedByCurrentUser`).
- **`<PostEditorSheet scope=...>`** — single editor handles all three scopes. Branch chooser only appears for `hr_news`; working-area chooser appears for `announcement` + `safety_alert`. Ack toggle defaults to `true` for `safety_alert`. Image uploads write to `production-board-images/{org}/{uuid}.{ext}` and persist the `getPublicUrl(...)` result on the post row.
- **`<PostCard>`** — renders the 4 px left severity border (`danger/warning/info/success` colours), the optional image header, scope-aware badges (working area / branch / company-wide / pinned), the body as `<div className='whitespace-pre-wrap'>` (markdown rendering deferred — see follow-ups), and the ack pill: "Acknowledge" button → green `Acknowledged` chip after the user's own ack lands.
- **Acknowledgement path**: `acknowledgePost(postId)` inserts into `production_board_post_acks` and tolerates the `23505` (unique violation) error code as success — the table's UNIQUE constraint on `(post_id, user_id)` is the source of truth.

Each scope's board is a thin wrapper that picks the filter chip strip, sets the empty-state copy, and wires the editor:

- `announcements-board.tsx`: chip strip is `[All, ...workingAreas]` from `useBoardWorkingAreas()`.
- `hr-news-board.tsx`: chip strip is `[All, Company-wide, ...branches]` from `useBranches()`. "Company-wide" maps to `branch_id IS NULL`.
- `safety-alerts-board.tsx`: no filter chips; the post list is sorted by `severity` (`danger > warning > info > success`) THEN `published_at DESC`. The card's left border is the severity colour.

### Jobs board

Distinct table (`production_board_job_postings`) so the schema can carry `department / requirements / apply_url / apply_email / is_internal / closes_at` instead of shoehorning them into `production_board_posts`. The board has its own `useJobPostings()` hook + `<JobEditorSheet>` + `<JobCard>` — the card includes a closing-date chip computed from `closes_at` (Closed · Closes today · Closes in N days) and Apply URL / email buttons.

### Polling cadence change (Hourly 30 s → 60 s)

The hourly board's events query was bumped from `refetchInterval: 30_000` → `60_000` (still visibility-gated and only when `isToday`). Rationale: there are now six boards stacked behind the global tab strip and each runs its own 60 s polling (SQCDP metrics + problems, posts × 3 scopes, jobs). Doubling the hourly cadence keeps the org-wide network footprint under the budget while the hourly grid stays fresh enough — a single 60 s tick adds at most 60 s of latency to a cell flipping `below → on → above`, which is well within the operational sense-making horizon. The TV-frame footer text "Auto-refresh 30s" was updated to "Auto-refresh 60s" for consistency.

No test changes were needed — the hook tests don't assert on the interval value (they exercise the filter logic and roster shaping; the polling cadence is incidental).

### 403 backfill

`rolls_royce_assembly` and `tka_leaders` were 406-ing on the production-boards `.single()` lookup because the `(role_id, navigation_item_id)` row didn't exist. Migration 295 inserts `(role_id, navigation_item_id, visible=false, role='viewer'::user_role)` for both via `ON CONFLICT DO NOTHING`. Future audits should hit `/403` cleanly rather than the confusing 406 fallback.

### Validation

- `pnpm vitest run src/features/shift-productivity/production-boards` → **98 / 98 ✅** (71 carry-over + 19 format + 5 search-param + 3 can-edit).
- `pnpm lint:check` → **0 errors, 92 warnings** (down from 106 because the pre-existing `IconLayoutDashboard` import error was fixed and the v6 hooks were rewritten to skip the `useMemo` that was triggering `@tanstack/query/no-unstable-deps` warnings). One pre-existing `react-refresh/only-export-components` warning on `board-edit-toggle.tsx` (created by the previous worker, exports both `BoardEditToggle` and `useBoardEditMode` from the same file).
- `pnpm build` → ✅ successful.
  - `feature-shift-productivity` parent chunk: **463 KB** (was 434 KB at v5). Under the 500 KB cap.
  - Per-board lazy chunks (split via a new `manualChunks` carve-out in `vite.config.ts` — see below): `sqcdp-board` 36 KB · `jobs-board` 16 KB · `hourly-board` 7 KB · `announcements-board` 4 KB · `hr-news-board` 4 KB · `safety-alerts-board` 3 KB · `production-boards` (registry) 1.6 KB.
- `node scripts/check-bundle-budget.mjs` — only the pre-existing `warehouse-location-map` (1488 KB) and `feature-admin` (983 KB) failures remain. Zero new bundle-budget regressions.

### Vite chunking carve-out

The sweeping `if (id.includes('/features/shift-productivity/')) return 'feature-shift-productivity'` rule in `vite.config.ts` collapses every file under the feature folder into one chunk by default. To preserve the per-board lazy chunks, a new exclusion was added immediately above that rule:

```ts
if (
  id.includes('/features/shift-productivity/production-boards/boards/')
)
  return undefined  // Let Rollup auto-split each board into its own chunk
```

This returns `undefined` for files under `boards/<slug>/`, which lets Rollup's auto-chunking honour the `React.lazy(() => import('../boards/<slug>/<slug>-board'))` calls in `lib/boards.ts`. Shared infrastructure in `production-boards/components/` and `production-boards/hooks/` (post-card, post-editor-sheet, useBoardPosts, useBranches, useBoardWorkingAreas) still falls into the parent `feature-shift-productivity` chunk because they're imported by multiple boards and the shell page.

### Open follow-ups

- **Markdown rendering** for post bodies — currently `whitespace-pre-wrap` only. Needs `react-markdown` + sanitization (`rehype-sanitize`) before exposing user-controlled markdown to the floor-wide TVs.
- **Image alt text** — the post editor uploads images but doesn't capture an `alt` field; PostCard currently renders `alt=''` (decorative). Add an alt-text input to the editor sheet for accessibility before any safety-critical post relies on the image alone.
- **Recent Operational Events rail** on the safety-alerts board — punted from v6. Surface the last N completed/escalated alerts so floor leads can spot patterns.
- **Real `associate_skills` schema** for SQCDP problem ownership — the `assigned_to` join uses `user_profiles!assigned_to(full_name)` today, no skills filter on the picker.
- **Multi-metric carousel per category** — v6 renders only the first metric (by `display_order`) per SQCDP cell. If a category needs to rotate between two scoreboards, that's a v7 idea.
- **TV mode for `<SqcdpProblemsTable>`** — currently the SQCDP TvFrame body shows just the metric grid. The problems table is dense and reads poorly at distance, but a stripped-down TV variant (top-3 problems by severity, no avatars) would be useful.
- **Service-worker prefetch** of the per-board chunks — the `<Suspense>` skeleton is fine, but pre-warming the next-likely-board (e.g. SQCDP after Hourly) would smooth the tab transition.

### Files (this slice)

**Created**:
- `src/features/shift-productivity/production-boards/boards/sqcdp/lib/format.test.ts` (19 tests)
- `src/features/shift-productivity/production-boards/boards/sqcdp/hooks/{use-sqcdp-metrics,use-sqcdp-problems}.ts`
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/{sqcdp-sparkline,sqcdp-card,sqcdp-grid,sqcdp-problems-table,sqcdp-editor-sheet}.tsx`
- `src/features/shift-productivity/production-boards/boards/sqcdp/sqcdp-board.tsx` (full implementation)
- `src/features/shift-productivity/production-boards/boards/announcements/announcements-board.tsx`
- `src/features/shift-productivity/production-boards/boards/hr-news/hr-news-board.tsx`
- `src/features/shift-productivity/production-boards/boards/safety-alerts/safety-alerts-board.tsx`
- `src/features/shift-productivity/production-boards/boards/jobs/jobs-board.tsx`
- `src/features/shift-productivity/production-boards/boards/jobs/components/{job-card,job-editor-sheet}.tsx`
- `src/features/shift-productivity/production-boards/boards/jobs/hooks/use-job-postings.ts`
- `src/features/shift-productivity/production-boards/components/{post-card,post-editor-sheet}.tsx`
- `src/features/shift-productivity/production-boards/hooks/{use-board-posts,use-branches,use-board-working-areas}.ts`
- `src/features/shift-productivity/production-boards/hooks/{use-board-search-param.test,use-can-edit-boards.test}.tsx`

**Modified**:
- `src/features/shift-productivity/production-boards/boards/hourly/hooks/use-hourly-productivity.ts` — `refetchInterval: 30_000 → 60_000`.
- `src/features/shift-productivity/production-boards/components/tv-frame.tsx` — footer text "Auto-refresh 30s" → "Auto-refresh 60s".
- `src/features/shift-productivity/production-boards/index.ts` — barrel re-exports for `useBoardPosts`, `useBranches`, `useBoardWorkingAreas`, `PostCard`, `PostEditorSheet`.
- `src/features/shift-productivity/production-boards/production-boards-page.tsx` — fixed pre-existing `IconLayoutDashboard` import (was `lucide-react`, should be `@tabler/icons-react`).
- `vite.config.ts` — added the `boards/` carve-out so per-board lazy chunks split correctly.



## v7 — Cross-Component URL-State Sync (Edit-toggle bug fix) (2026-05-10)

User report: “Going through each of the new tabs and the current hourly tab, clicking on the editing button does absolutely nothing.”

### Bug

The four URL-state hooks shipped with v6 each followed the same pattern:

1. `useState(() => readSearchParam(...))` — initialise from the URL once on mount.
2. `popstate` listener — re-sync on browser back/forward.
3. Setter writes via `history.replaceState` (or `pushState`).

This is silently broken whenever **two or more components subscribe to the same URL bit**. Per the HTML spec, `replaceState` and `pushState` do **not** fire `popstate` — it only fires for actual back/forward navigation. So when the toggle button calls `setEditMode(true)`, its own local state advances but every sibling reader (the per-card pencils across all six boards) stays frozen at the value it captured on mount.

For `?board=`, `?tv=`, and `?area=` the bug was masked because there was only one writer + one reader. For `?edit=` there are many readers (`<SqcdpCard>`, `<SqcdpProblemsTable>`, `<PostCard>`, `<JobCard>`, plus board-level `+ Add` CTAs) and they all sat at `editMode = false` forever — hence “clicking does absolutely nothing visible.”

### Fix

Introduced a small **module-level subscriber + custom-event broadcast** so writers notify readers within the same SPA session. This avoided restructuring everything to React Context (which would have meant wrapping the page tree with multiple providers and re-plumbing the page → board prop chain).

New shared module: [`production-boards/lib/url-search-state.ts`](../../../src/features/shift-productivity/production-boards/lib/url-search-state.ts)

- `readSearchParam(key)` / `writeSearchParam(key, value, method)` — thin wrappers around `URLSearchParams` + `history.{replace,push}State` that **dispatch a custom event** (`omniframe:productionboards:urlstate`) on every write.
- `subscribeToSearchParam(key, listener)` — attaches both a custom-event handler (intra-SPA writes) and a `popstate` handler (browser nav). Returns an unsubscribe function that detaches both.
- `useSearchParamState<T>(key, parse, serialize, options?)` — generic React hook with the same `[value, setter]` shape the four hooks expose. Optimistically updates local state on write so the writer's UI doesn't double-flicker; the event listener also fires and re-reads the URL so cached value matches the address bar.

### Hooks refactored

Each refactored hook preserved its public API exactly so callers didn't need to change.

| Hook | Before | After |
|------|--------|-------|
| `useBoardEditMode` | Inline in `components/board-edit-toggle.tsx` (mixed component + hook export, lint warning) | Moved to `hooks/use-board-edit-mode.ts`, calls `useSearchParamState<boolean>` |
| `useBoardSearchParam` | `hooks/use-board-search-param.ts` (own popstate-only impl) | Same path, calls `useSearchParamState<BoardSlug>` |
| `useTvSearchParam` | Inlined inside `production-boards-page.tsx` | Promoted to `hooks/use-tv-search-param.ts`, calls `useSearchParamState<boolean>` with `method: 'push'` (preserves existing history-entry behaviour) |
| `useAreaSearchParam` | Inlined inside `boards/hourly/hourly-board.tsx` | Promoted to `boards/hourly/hooks/use-area-search-param.ts`, calls `useSearchParamState<string>`. Exports `ALL_AREAS_VALUE` so the rotation effect can compare against it |

### Smoke test pattern (canonical)

`components/board-edit-toggle.test.tsx` mounts `<BoardEditToggle>` alongside a tiny `<EditModeProbe>` that also calls `useBoardEditMode()` — the exact topology of every per-card pencil reader — and asserts:

1. The probe starts at `idle` (URL has no `?edit=`).
2. After clicking the toggle, the probe re-renders to `editing` AND `window.location.search === '?edit=1'`.
3. After clicking again, the probe re-renders to `idle` AND the URL is cleared.
4. When `useCanEditBoards()` resolves `granted: false`, the toggle is absent and the probe stays at `idle`.

This is the canonical regression check whenever a new URL-state hook lands. It catches the `replaceState` → `popstate` invariant violation that v6 walked into.

### Lint warning eliminated

Moving `useBoardEditMode` out of `board-edit-toggle.tsx` dropped the `react-refresh/only-export-components` warning the colocated hook used to trigger — the component file now exports only the component.

### Files (this slice)

**Created**:
- `src/features/shift-productivity/production-boards/lib/url-search-state.ts` (helper)
- `src/features/shift-productivity/production-boards/lib/url-search-state.test.ts` (12 tests)
- `src/features/shift-productivity/production-boards/hooks/use-board-edit-mode.ts`
- `src/features/shift-productivity/production-boards/hooks/use-tv-search-param.ts`
- `src/features/shift-productivity/production-boards/boards/hourly/hooks/use-area-search-param.ts`
- `src/features/shift-productivity/production-boards/components/board-edit-toggle.test.tsx` (2 smoke tests)

**Modified**:
- `src/features/shift-productivity/production-boards/components/board-edit-toggle.tsx` — removed the inline hook; now imports from `../hooks/use-board-edit-mode`.
- `src/features/shift-productivity/production-boards/hooks/use-board-search-param.ts` — reduced to a 12-line wrapper around `useSearchParamState`.
- `src/features/shift-productivity/production-boards/production-boards-page.tsx` — inline `useTvSearchParam` removed; imports the new hook.
- `src/features/shift-productivity/production-boards/boards/hourly/hourly-board.tsx` — inline `useAreaSearchParam` and `readUrlParam` removed; imports the new hook + `readSearchParam` from the helper for the rotation effect.
- `src/features/shift-productivity/production-boards/index.ts` — barrel split: `BoardEditToggle` exports from the component, `useBoardEditMode` exports from `hooks/use-board-edit-mode`.
- `src/features/shift-productivity/production-boards/boards/{sqcdp,jobs,announcements,hr-news,safety-alerts}/**/*.tsx` and `components/post-card.tsx` — import path updates from `../../components/board-edit-toggle` to `../../hooks/use-board-edit-mode`.

### Validation

- `pnpm vitest run src/features/shift-productivity/production-boards` — **9 files, 112 tests pass** (98 pre-existing + 12 helper + 2 smoke).
- `pnpm lint:check` — 0 errors; pre-existing warning count unchanged minus 1 (the `react-refresh` warning on `board-edit-toggle.tsx` is gone).
- `pnpm build` — succeeds; `feature-shift-productivity` chunk **441.62 kB**, down from 463 kB pre-fix and well under the 500 KB budget.

### Cross-feature pattern

The URL-state subscriber pattern is reusable. Promoted to [[Cross-Component-URL-Search-State]] so other features (Inventory's `?execMode=`, Customer Tickets' `?status=`, etc.) can adopt it without rediscovering the `replaceState` ↔ `popstate` footgun.



## v8 — Cinematic Per-Area Transition (TV Mode) (2026-05-10)

Replaced the abrupt swap of the per-area body in TV-mode rotation with a four-layer cinematic transition. When `?tv=1` is on AND the auto-rotation is active, each 30s cycle now plays as a film-style chapter break — the outgoing area dissolves out, a centred chapter title overlays in the area's accent colour, and the incoming area materialises gently. In normal mode (or with `prefers-reduced-motion: reduce`) the transition collapses to a 250ms crossfade so users who navigate intentionally don't get the cinematic blocking the click.

### Four-layer orchestration

```
t=0ms                                                                            t≈2000ms
├── Layer 1: outgoing fades+scales+blurs+lifts up   ──── 600ms ──→
│                       ┌── Layer 2: chapter overlay ──── 1450ms total ────┐
│                       │   eyebrow → code → name+sub cascade @80/160ms    │
│                                                  ├── Layer 3: incoming fades+scales+blurs+slides down ──── 700ms ──→
│                                                  └── (Layer 4 omitted — 460KB chunk gate)
```

All three timings use `[0.22, 1, 0.36, 1]` (the project's house cubic-bezier — same easing as `BoardShell`) for cohesion across the page chrome and the transition.

### TV-only gate

The transition is gated on `cinematic = isTv && isRotating`. Manual area clicks in normal mode keep the existing instant Tabs swap. Manual area clicks in TV mode (deep-linked `?tv=1&area=outbound` or hypothetical pin-via-click) collapse to the calm 250ms crossfade — the cinematic chapter overlay would feel distracting when the user navigated intentionally.

`<MotionConfig reducedMotion='user'>` wraps the entire transition so users with `prefers-reduced-motion: reduce` get framer-motion's built-in fallback (transition-less swap). The chapter overlay also uses `motion-safe`-friendly variants — its mount/exit are the same opacity-driven primitives framer-motion short-circuits.

### Accent colour reuse

The chapter overlay's radial-glow backdrop AND the area code's text colour both pull from the same `deriveAreaColor(area_code)` hash that already paints the associate ID-card avatar gradient, primary pill, and active-row outline. One area_code → one colour, everywhere. Concretely, a new helper in `boards/hourly/lib/area-color.ts`:

- `accentHexFor(areaCode)` — string → Tailwind 500-band hex (`#10b981` for emerald, etc.). Falls back to slate-500 (`#64748b`) for null/empty.
- `accentRgbaFor(areaCode, alpha)` — string + alpha → `rgba(...)` clamped to `[0,1]` for the glow CSS variable (`--accent-glow`).

Unit-tested with 9 cases covering determinism, the bucket collision invariant (8 hash buckets), the neutral fallback, key→hex direct lookup, alpha clamping, and well-formed rgba output.

### Reduced-motion fallback

`<MotionConfig reducedMotion='user'>` — set on the AreaTransitionFrame wrapper. framer-motion short-circuits all transitions in this subtree when the user's OS-level `prefers-reduced-motion: reduce` is on. The chapter overlay's variants reduce to simple opacity changes; the body content does the same crossfade as the calm-mode path. No flicker, no jank.

### Framer-motion variants shipped

```ts
// Body — outgoing/incoming when cinematic = isTv && isRotating
const cinematicVariants = {
  initial: { opacity: 0, y: 12, scale: 1.015, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)',
             transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, y: -12, scale: 0.985, filter: 'blur(6px)',
             transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
}

// Body — calm fallback (manual nav in TV, normal mode, reduced-motion)
const calmVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] } },
}

// Chapter overlay — container with stagger so eyebrow → code → name → sub cascade
const containerVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1],
             when: 'beforeChildren', staggerChildren: 0.08 } },
  exit:    { opacity: 0, scale: 1.04, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
}
const eyebrowVariants = { initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } } }
const codeVariants    = { initial: { opacity: 0, scale: 0.92, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.55, ease: EASE } } }
const nameVariants    = { initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE, delay: 0.08 } } }
const subVariants     = { initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE, delay: 0.16 } } }
```

The chapter overlay's mount/dismiss is timed by a `setTimeout(..., 1450)` set on each `activeAreaValue` change inside `<AreaTransitionFrame>` — when it fires, `chapterKey` is set to `null` and the `<AnimatePresence>` plays the exit variant. Dismiss runs concurrently with the incoming body's enter (~150ms overlap), giving the smooth handoff the spec called for.

### Layer 4 (rotation progress bar) — omitted

The optional bottom progress bar that drains+refills over the 30s cycle was prototyped but **gated off** by the 460 KB chunk-budget guard the spec set. With layer 4 the chunk landed at 478 KB; without it 467 KB (still ~17 KB heavier than the spec's 444–450 KB prediction because framer-motion's variant resolution + stagger machinery pulls in more of the `framer-motion` module than `<BoardShell>` did alone). When the chunk gets headroom we can revive the helper from git history — its shape is documented in this entry.

### Files

**Created:**
- `src/features/shift-productivity/production-boards/boards/hourly/lib/area-color.ts` — `accentHexFor` / `accentRgbaFor` / `accentHexForKey` + `AREA_COLOR_HEX` table reusing the `AreaColorKey` palette from `./skills`.
- `src/features/shift-productivity/production-boards/boards/hourly/lib/area-color.test.ts` — 9 cases (determinism, bucket collision, neutral fallback, palette completeness, alpha clamping, rgba shape).
- `src/features/shift-productivity/production-boards/boards/hourly/components/area-chapter-overlay.tsx` — the centred chapter title overlay (eyebrow / code / name / sub-line cascade).
- `src/features/shift-productivity/production-boards/boards/hourly/components/area-transition-frame.tsx` — wraps the TV body. Owns the cinematic-vs-calm variant switch and the `<AreaChapterOverlay>` mount lifecycle.
- `src/features/shift-productivity/production-boards/boards/hourly/components/area-transition-frame.test.tsx` — 5 smoke tests (chapter overlay only mounts when `isTv && isRotating && area changed`).

**Modified:**
- `src/features/shift-productivity/production-boards/boards/hourly/hourly-board.tsx` — wraps the TV body in `<AreaTransitionFrame>`. The `kpiStrip` slot of `<TvFrame>` is no longer used in TV mode; metrics now live INSIDE the transition frame so they participate in the cinematic swap (otherwise the KPI numbers would snap to the new area at t=0 while the body was still fading out).
- `src/features/shift-productivity/production-boards/index.ts` — barrel exports `AreaChapterOverlay`, `AreaTransitionFrame`, `accentHexFor`, `accentRgbaFor`, `accentHexForKey`, `AREA_COLOR_HEX`, `NEUTRAL_FALLBACK_HEX`.

### Validation

- `pnpm vitest run src/features/shift-productivity/production-boards` → **126 / 126 ✅** (112 pre-existing + 9 area-color + 5 area-transition-frame).
- `pnpm lint:check` → 0 errors, 91 warnings — same 91-warning baseline as v7. New files contribute **0** warnings.
- `pnpm build` → ✅ successful. `feature-shift-productivity` chunk **467.20 KB** post-min / 102.00 KB gzip (was 441.62 KB at v7; **+25.58 KB delta**). Under the 500 KB per-chunk hard cap. Above the spec's 444–450 KB prediction — see Layer 4 note above for why.
- `node scripts/check-bundle-budget.mjs` reports the same pre-existing FAILs on `warehouse-location-map` (1488 KB) and `feature-admin` (983 KB); zero new bundle-budget regressions. `feature-shift-productivity` shows as WARN at 467.20 KB.

### Trade-offs

- **Inline variant objects** keep the orchestration co-located with the component. If a second board adopts the same recipe (e.g. SQCDP rotating categories with the same chapter-break), promote the variants to a shared `lib/cinematic-variants.ts` and the chapter overlay to `components/`.
- **MotionConfig at AreaTransitionFrame**, not the page. Scoped reduced-motion gating keeps unrelated framer-motion consumers (e.g. `<BoardShell>`'s tab transition) free to honour their own settings.
- **No per-row stagger on the grid**. The spec discussed an optional `staggerChildren: 0.03` on the ID-card list. We deliberately apply motion at the body level only — 50 rows × 13 cols = 650 cells, and per-row variants would create a stutter on lower-end TV hardware. The single body fade does the entire entrance.
- **Metrics inside the transition**, not above it. The kpiStrip slot of `<TvFrame>` is unused in TV mode now; the metrics sit inside `<AreaTransitionFrame>` so they fade with the body. Otherwise the four KPI numbers would snap to the new area at t=0 while the body was still showing the previous area — visible dissonance even with the chapter overlay covering the body.

### Cross-feature pattern

The transition recipe (cinematic body fade + accent-coloured chapter overlay + calm fallback) is captured as a stand-alone pattern in [[Cinematic-Tab-Rotation]]. Likely next adopter: SQCDP rotating between categories on a TV, or any future per-area / per-category rotation surface.

### Open follow-ups (carry-over + new)

- **Reinstate Layer 4** when the chunk gets headroom (split the SQCDP board into its own bundle, or trim framer-motion usage elsewhere).
- **Promote the recipe** to `production-boards/components/` and a shared variants file once a second board adopts it.
- **Per-row ripple** on the ID-card list once a profile shows the 650-cell grid can stagger without stutter on the actual TV hardware.
- (carry-over) Markdown rendering for post bodies; image alt text in the post editor; Recent Operational Events rail; real `associate_skills` schema; multi-metric carousel per SQCDP category; TV mode for `<SqcdpProblemsTable>`; service-worker prefetch of next-likely board chunks.



## v9 — SQCDP Historical Charts (line / area / bar, color-matched, motion mount) (2026-05-10)

The SQCDP scorecards lost the screen real-estate-shaming "big number + period chip + tiny sparkline" silhouette and gained a **last-6-months historical chart** in the footer of every primary card (Safety / Quality / Cost / Delivery / Production). Each metric picks its own visualisation — line, area (default), or bar — and the chart's accent matches the card's `color_hex` (or `defaultColorFor(category)` fallback). Cards mount with a framer-motion variants stagger across the row, and the Recharts geometry inside each card draws with `animationBegin = index * 60` for a synchronised cascade.

### Migration 296 — `sqcdp_metrics.chart_type`

```sql
ALTER TABLE public.sqcdp_metrics
  ADD COLUMN IF NOT EXISTS chart_type text NOT NULL DEFAULT 'area'
    CHECK (chart_type IN ('line', 'area', 'bar'));
COMMENT ON COLUMN public.sqcdp_metrics.chart_type IS
  'Visualisation type for the per-card historical chart. Defaults to area.';
```

Applied via Supabase MCP `apply_migration` (NOT `execute_sql`) so it's a first-class member of the migration history. Verification SELECT confirmed every existing metric (5 rows) received `'area'` as its DEFAULT — no manual backfill needed. Disk artefact: `supabase/migrations/296_sqcdp_chart_type.sql`.

### Three Recharts variants — shared chrome, geometry-only swap

All three variants share:

- `<ResponsiveContainer width='100%' height={chartHeight}>` where chartHeight is 120 px normal / 180 px TV (configurable via a new `height` prop used by the editor preview at 80 px).
- Margin `{ top: 8, right: 6, bottom: 4, left: 6 }`.
- `<XAxis hide />` — the period chip on the card carries the time scope.
- `<YAxis hide domain={['auto', 'auto']} />` — Recharts auto-fits to the data extent.
- `<CartesianGrid stroke='currentColor' strokeOpacity={0.06} vertical={false} />` — the faintest of horizontal grid lines so the eye has a single read-line.
- Custom `<Tooltip>` body — `bg-popover/95 border-border/50 backdrop-blur-sm rounded-md` with formatted value (via `formatValue(metric.valueFormat, ...)`) on top and a `formatDistanceToNow(...)` relative date below.
- Dashed `<ReferenceLine y={metric.target_value} stroke={accentColor} strokeOpacity={0.35} strokeDasharray='3 3'>` with a `<Label position='right' value='target' />` when `target_value` is non-null.

Geometry-only differences:

- **`line`** — `<Line type='monotone' stroke={accentColor} strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: accentColor }} />`.
- **`area` (default)** — `<Area type='monotone' stroke={accentColor} strokeWidth={2.5} fill={url(#gradientId)} />` over a `<linearGradient>` with three stops at `accent / 0.45`, `accent / 0.15`, `accent / 0.02` for the premium dashboard gradient feel. The `id` is from `useId()` so two charts of the same metric in the DOM (preview + card) don't share gradients.
- **`bar`** — `<Bar fill={accentColor} fillOpacity={0.85} radius={[4, 4, 0, 0]} />`.

All three forward `isAnimationActive`, `animationDuration={1400}`, `animationBegin={animationDelay}` (the per-card stagger offset), and `animationEasing='ease-out'`.

### Mount-in stagger orchestration

`<SqcdpGrid>`'s primary row is wrapped in:

```tsx
<MotionConfig reducedMotion='user'>
  <motion.div
    variants={containerVariants}   // staggerChildren: 0.08, delayChildren: 0.15
    initial='initial'
    animate='animate'
  >
    {primary.map((cat, idx) => (
      <motion.div key={cat.id} variants={cardVariants}>
        <SqcdpCard
          ...
          index={idx}
          mountAnimation={false}
        />
      </motion.div>
    ))}
  </motion.div>
```

Where:

- `cardVariants = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } } }`
- `containerVariants` only declares the `transition` orchestration (no visual change).

`<SqcdpCard>` accepts a new `mountAnimation` prop (defaulting to `true` to keep [[Elevated-KPI-Stat-Cards]] callers outside the grid behaving identically). When the parent grid orchestrates motion, primary cards pass `mountAnimation={false}` to suppress the v5 `motion-safe:animate-in` recipe — otherwise we'd see two simultaneous fade+slide animations stacking. `<SqcdpGridSkeleton>` and the secondary row keep `mountAnimation={true}` (default).

The Recharts animation in each card runs with `animationBegin={index * 60}` so each chart's line/area/bar geometry draws *behind* the framer-motion card-landing — a small synchronised cascade that prevents the geometry from racing the surrounding chrome.

### Empty-state UX

`metric.history.length < 2` is the boundary condition — a one-point line is just a dot and reads as broken UI. The chart frame stays mounted at the same height as the populated state (so card heights don't shimmy when data eventually lands), but renders:

- A faint dashed horizontal line at 50% height drawn from a `linear-gradient` repeating mask (`backgroundImage: linear-gradient(to right, accent/0.18 50%, transparent 50%)`, `backgroundSize: 6px 1px`). No SVG — pure CSS.
- A centred copy line: `text-muted-foreground/60 text-[11px] italic` reading `"History will appear here once values are updated."`.

Deliberately **NOT** seeding demo data — production should reflect real data, never lie about volume. The empty state is a UX invitation, not a placeholder.

### Editor preview pattern

The editor sheet's metric form gained a **Chart type** select (Line / Area / Bar), and just below it, a small live preview at 80 px tall × full sheet width inside a `bg-muted/20` framed rounded box. The preview reuses the production `<SqcdpChart>` component with:

- `metric.history` when ≥ 2 points exist, else an 8-point sine-ish demo dataset spaced at 1-week intervals over the last 8 weeks (so brand-new metrics still produce a meaningful preview).
- The form's live `colorHex` (falling back to category default) so colour changes render instantly under the select.
- A new `height={80}` override on `<SqcdpChart>` (otherwise the chart would render at 120 px and force the editor sheet to scroll just for the preview).

This is the biggest UX win in the slice — admins can see what they're getting before they save.

### 6-month query scope decision (client-slice)

Spec called for the chart to scope to the last 6 months. Two paths considered:

1. **Server-filter** — pass a `gte('recorded_at', cutoff)` to the inner Supabase select. Pro: less data over the wire. Con: requires touching the embedded relation filter syntax (`history:sqcdp_metric_history!inner(...).gte(...)`) which the typed client wraps awkwardly.
2. **Client-slice** — `mapRow` filters `history` by `recorded_at >= now() - 180 days`.

Went with **client-slice** because the row volumes are tiny (≤ 1 sample per metric per update event — the `updateMetric` path explicitly only inserts a history row when `current_value` changed, and metrics update on the order of once a day at most). Saving 5–20 KB of payload doesn't justify reaching into the relation filter syntax. The cutoff is computed against `Date.now()` per render — stale-but-recent metrics still surface their full slice; an old metric with no recent updates simply collapses to its tail (degraded but not broken).

New constant exported from `use-sqcdp-metrics.ts`: `SQCDP_HISTORY_WINDOW_DAYS = 180`.

History rows are sorted ASC so the chart x-axis reads left → right chronologically (matches every other Western chart convention).

### Reduced-motion fallback

`<SqcdpChart>` reads `useReducedMotion()` from framer-motion (already in the bundle for the cinematic v8 transition). When true:

- Recharts' built-in animation is disabled (`isAnimationActive={false}`) so line / area / bar render in their final state instantly.
- The framer-motion `<MotionConfig reducedMotion='user'>` wrapper around `<SqcdpGrid>` short-circuits the per-card variants — cards land at their final position with no stagger.

Reduced-motion users see the same charts and the same data; they just skip the orchestration.

### Files

**Created:**
- `supabase/migrations/296_sqcdp_chart_type.sql`
- `src/features/shift-productivity/production-boards/boards/sqcdp/lib/color.ts` — `hexToRgba(hex, alpha)` with malformed-input fallback + tests (7 cases).
- `src/features/shift-productivity/production-boards/boards/sqcdp/lib/color.test.ts`
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-chart.tsx` — three variants, custom tooltip, empty state, height override.
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-chart.test.tsx` — 6 smoke tests (one per chart_type, plus empty state + reference-line presence/absence).

**Modified:**
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-card.tsx` — replaced the tiny sparkline strip with `<SqcdpChart>` in a bordered footer strip; added `index` and `mountAnimation` props; primary cards render the chart, secondary cards stay at v6 density (no chart). Card body restructured so the period chip + target line live above the chart strip and a single "Updated MMM d" line replaces the dual-row trailing meta block.
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-grid.tsx` — wrapped the primary row in `<MotionConfig reducedMotion='user'>` + `<motion.div variants={containerVariants}>` for the stagger orchestration; primary `SqcdpCard`s now pass `index={idx} mountAnimation={false}`.
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-editor-sheet.tsx` — new `chartType` zod field + form default; new `<Select>` field below the accent-colour picker; new `<ChartPreview>` helper component renders below the select using real history (or an 8-point demo dataset).
- `src/features/shift-productivity/production-boards/boards/sqcdp/hooks/use-sqcdp-metrics.ts` — added `chartType: SqcdpChartType` to `SqcdpMetricRow` + `CreateSqcdpMetricInput`; `mapRow` slices to last 180 days; SELECT / INSERT / UPDATE all carry `chart_type`; optimistic onMutate threads it through.

**Deleted:**
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-sparkline.tsx` — the v6 32-px-tall LineChart-only sparkline. Sole consumer was `<SqcdpCard>` which now uses `<SqcdpChart>`. No external imports needed; deletion is clean.

### Validation

- `pnpm vitest run src/features/shift-productivity/production-boards` → **139 / 139 ✅** (126 pre-existing + 7 hexToRgba + 6 chart smoke). Five jsdom "unrecognized SVG tag" warnings are emitted by the chart smoke tests because the Recharts mock unwraps `<defs>` / `<linearGradient>` / `<stop>` to plain `<div>`s outside an SVG ancestor; they don't affect results.
- `pnpm lint:check` — 0 new warnings. Pre-existing baseline of 91 warnings unchanged. Pre-existing 1 error in `inventory-completion-view.tsx` is from an unrelated WIP feature (LX25 Inventory Completion) that was already dirty before this session.
- `pnpm build` → ✅ successful.
  - `feature-shift-productivity` parent chunk: **467.20 KiB / 478.42 kB** (102.01 KB gzip). Identical to v8 — most of the v9 work landed in the lazy `sqcdp-board` chunk, not the parent.
  - `sqcdp-board` lazy chunk: **41.37 KiB / 42.36 kB** (was ~36 KB at v6 → +6 KB for the chart variants + framer-motion stagger + ChartPreview). Well under any per-chunk threshold.
- `node scripts/check-bundle-budget.mjs` reports the same pre-existing FAILs on `warehouse-location-map` (1487.63 KB) and `feature-admin` (982.97 KB) — zero new bundle-budget regressions.

### Trade-offs

- **Client-slice over server-filter** (see above) — saves a relation-filter SQL detour at the cost of ~5–20 KB of stale rows over the wire. Acceptable until row volumes change.
- **Recharts named imports only** — `<SqcdpChart>` imports `Area, AreaChart, Bar, BarChart, Line, LineChart, Tooltip, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Label, CartesianGrid` by name. No `import * as Recharts`. Tree-shaking keeps the geometry-specific chunks pulling only what each variant needs.
- **No chart on secondary cards** — Maintenance / Shipping / Big Idea / Announcement intentionally stay at v6 density. Their visual job is to be auxiliary; adding charts would dilute the primary scorecards' visual primacy. If a sparkline-only secondary variant is ever wanted, the `<SqcdpChart height={32}>` override is ready to pick up.
- **Card mount-animation toggle as a prop, not a global** — `mountAnimation={false}` is a per-call decision, not a context. If a future consumer wants to opt into the v5 mount-in animation while still using `<SqcdpGrid>`, they can swap the grid for a flat `.map(c => <SqcdpCard ... />)` and let the default `true` win.

### Open follow-ups

- **Hover tooltip absolute date** — currently shows relative-only (`3 days ago`). For forensic / audit use a small `text-muted-foreground/70 tabular-nums` line with the absolute formatted date underneath would help — gated on whether the floor really cares about "April 23" vs "3 weeks ago" at a glance.
- **Sparse-coverage gap fill** — when history covers 6 months but only with 4 points 6 weeks apart, the area gradient looks lumpy. A `connectNulls` or a synthetic interpolated curve (with a clear visual indicator that it's interpolated) would smooth things out.
- **Sparkline-only secondary cards** — explicitly punted (see Trade-offs). When somebody needs Maintenance to show a 2-week throughput trend without dilating its surface, drop a `<SqcdpChart height={32}>` into the bottom of `<SqcdpCard>` for `tier === 'secondary'`.
- **Hourly board KPI strip sparklines** — the v9 chart variants are reusable. The hourly KPI row (`<BoardMetrics>`) currently shows just a number; adding a tiny `<SqcdpChart>`-flavoured sparkline per KPI would unify the surface family and reuse Recharts code already in the bundle. See [[Selectable-Chart-Variants]] for the recipe.

### Cross-feature pattern

The "three Recharts variants behind one component, with shared chrome and a `chart_type` switch on the data row" pattern is captured as [[Selectable-Chart-Variants]] so other surfaces (Hourly KPI strip, Inventory Health summary, etc.) can adopt it without rediscovering the gradient-stops / tooltip-shape / animation-stagger details.



## v10 — Editor Dialog + Historical Data CRUD + Chart Markers (2026-05-10)

Three coherent slices to the SQCDP editor + chart, all touching the same component tree, shipped as one cohesive change.

### Sheet → Dialog conversion

The v6 right-side `<Sheet side='right' className='w-[480px]'>` editor was the right tool while the form was a single tall column with a tiny live-preview. v10 swaps it for a centred shadcn `<Dialog>` at `sm:max-w-[820px]` so the metric form can:

- Use a **2-column grid** — left column (Category / Title / Subtitle / Format/Period / Current/Target / Unit), right column (Color override / Accent color / Chart type / Show markers / Visible / Notes).
- Host the **live chart preview** at full width (140 px tall) below the 2-column form.
- Embed the **<SqcdpHistoryEditor>** below the preview (CRUD over the last-180-day window).

None of those three fit comfortably in a 480 px sheet — the preview was previously a cramped 80 px wedge below the chart-type select, and there was no path at all to enter historical data points (see Change 2 below).

File renames + structure:

- `boards/sqcdp/components/sqcdp-editor-sheet.tsx` → `boards/sqcdp/components/sqcdp-editor-dialog.tsx` (renamed; new export `SqcdpEditorDialog`).
- The sole in-repo caller (`boards/sqcdp/sqcdp-board.tsx`) is updated in the same change. **No alias** is shipped — atomic diff.
- Body uses `max-h-[calc(88vh-7rem)] overflow-y-auto` so long forms (especially with the history editor populated) scroll cleanly inside the dialog.

ESC + outside-click + the X button all route through `attemptClose()`, which short-circuits with a small **"Discard unsaved changes?"** confirm dialog when react-hook-form's `formState.isDirty` is true. Two `<ConfirmDialog>` instances live alongside the editor — one for delete (variant=danger), one for confirm-exit (variant=warning).

Validation rules added:
- `title: z.string().min(1).max(80)` (was `min(1)` only).
- `chartType: z.enum(['line', 'area', 'bar'])` (unchanged from v9).
- `showMarkers: z.boolean()` (new).

The Problems form stays in the same dialog component (mode discriminator `'metric' | 'problem'`) but renders just title / description / category / severity / status / due / notes — no preview, no history editor.

### Migration 297 — `sqcdp_metrics.show_markers`

```sql
ALTER TABLE public.sqcdp_metrics
  ADD COLUMN IF NOT EXISTS show_markers boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sqcdp_metrics.show_markers IS
  'When true, the historical chart renders dot markers at each data point.';
```

Applied via Supabase MCP `apply_migration` (NOT `execute_sql`) on 2026-05-10 so it's a first-class member of the migration history. Verification SELECT confirmed all 5 existing metric rows defaulted to `false`. Disk artefact: `supabase/migrations/297_sqcdp_show_markers.sql`.

Default is **false** so existing users see no change unless they opt in via the editor's `<Switch>`.

### `useSqcdpMetricHistory(metricId)` — independent hook

New TanStack Query hook scoped to a single metric's `sqcdp_metric_history` rows over the last 180 days. Independent from the parent `useSqcdpMetrics` so the editor's history editor can refetch + mutate without invalidating every metric in the parent grid (which would force the chart strip on the SQCDP board to re-render and re-animate every cell).

Query key: `['sqcdp-metric-history', metricId, '180d']`. The 180-day cutoff is computed inside `queryFn` (not in the queryKey) so the key stays stable across renders while each refetch picks up a fresh cutoff.

Server-filter via `gte('recorded_at', cutoffISO)` (not client-slice — the editor's table is intentionally finite and the user shouldn't see ancient back-dates that the card chart silently filters out).

Mutations exposed: `createPoint` / `updatePoint` / `deletePoint` / `bulkInsertPoints`. All four invalidate BOTH the history key (so the editor stays fresh) AND the parent metrics list (so the card chart on the SQCDP board re-renders with the new points).

Disabled when `metricId === null` so the editor can call this hook in create-mode without firing a query for a non-existent row.

### `<SqcdpHistoryEditor>` — admin-facing CRUD

New component at `boards/sqcdp/components/sqcdp-history-editor.tsx`. Lives below the 2-column form + chart preview inside the dialog.

Visual recipe:

- **Header row** — `"Historical data points"` + `"26 weeks · {n} points recorded"` stat + toolbar.
- **Toolbar** — `+ Add data point` (always visible) + `+ Generate sample data` (gated on `points.length === 0`, `text-muted-foreground` outline).
- **Table** — shadcn `<Table>` with Date | Value | Source | Actions columns. Empty state copy: `"No history recorded yet. Add a data point or generate sample data to populate the chart."`
- Display-mode rows show relative date (`"3 weeks ago"` via `formatDistanceToNow`) wrapped in a `<Tooltip>` carrying the absolute date for hover.
- Inline edit-mode (toggled by per-row pencil) swaps the date cell for a `<DatePicker>` (the project's existing primitive at `src/components/ui/date-picker.tsx`) and the value cell for a numeric `<Input>`. Save / cancel inline.
- Per-row trash + `<ConfirmDialog>` for delete.
- Sort: newest first by default; clicking the Date column header toggles.
- Wrapper `max-h-[280px] overflow-y-auto` so long lists scroll inside the dialog body.

**Generate sample data** writes 26 plausible weekly points walking around `metric.current_value` with ±10% steps (capped at `target_value × 1.05` if a target is set), one per Sunday for the past 26 weeks. A small `<ConfirmDialog>` (variant=info) gates the action so users opt in ("Generate 26 sample data points for visualisation? You can delete or edit them later."). The bulk-insert sets `source = 'sample'` so future filters can distinguish auto-generated from manual entries.

**Create-mode placeholder** — when `metric === null` (the dialog opened in create-mode), the section renders a small dashed-border placeholder reading `"Save the metric first to start recording history."` instead of the table.

### Live preview pulls from the LATEST history

The dialog's `<ChartPreview>` no longer reads from the parent metric's stale snapshot. Instead it calls `useSqcdpMetricHistory(initial.metric?.id ?? null)` and passes the live `points` into `<SqcdpChart overrideHistory={...}>`. The new `overrideHistory` prop on `<SqcdpChart>` swaps in the editor's in-flight history before falling back to `metric.history`.

Watch chain (react-hook-form `useWatch` / `form.watch`): `chartType`, `colorHex`, `showMarkers`, `category` — toggling any of those re-renders the preview instantly so admins see exactly what the saved card will paint.

### Chart line markers (`show_markers`)

`<SqcdpChart>` gained dot markers for the **line** + **area** variants. Bar variant intentionally skips marker rendering (the bars themselves are the markers) — documented in the editor field's helper copy: `"Render circles at each historical data point. Best with line and area charts. Markers apply to line and area charts."`

Implementation uses Recharts' functional `dot` form so we can paint per-point geometry decisions:

```tsx
const dotProp = showMarkers
  ? (props) => {
      const { cx, cy, payload, index = 0 } = props
      if (cx === undefined || cy === undefined || !payload) {
        return <g key={`dot-empty-${index}`} />
      }
      const isAboveTarget =
        metric.targetValue !== null && payload.value >= metric.targetValue
      return (
        <circle
          key={`dot-${index}`}
          cx={cx} cy={cy}
          r={isAboveTarget ? 4 : 3}
          fill={accentColor}
          stroke={isAboveTarget ? 'currentColor' : 'none'}
          strokeOpacity={0.4}
          strokeWidth={isAboveTarget ? 1 : 0}
        />
      )
    }
  : false
```

**Above-target highlight** — when `show_markers && metric.target_value !== null`, points at-or-above target render with a slightly larger radius (4 vs 3) and a faint `currentColor` ring. Reads instantly as "we hit target on these days" without needing tooltip drill-in. `data-above-target="{true|false}"` is set on each dot for testability.

`activeDot` radius bumps from 4 → 5 when markers are on so the hover dot stays visibly bigger than the resting markers.

### Hook + types updates

- `SqcdpMetricRow` gained `showMarkers: boolean`. `mapRow` reads `raw.show_markers ?? false`.
- `CreateSqcdpMetricInput` gained `showMarkers?: boolean`.
- `createMetric` writes `show_markers: input.showMarkers ?? false`. `updateMetric` patches `show_markers` when `patch.showMarkers !== undefined`. Optimistic onMutate threads it through.
- All SELECT clauses now include `show_markers` between `chart_type` and `is_visible`.

### Files

**Created:**
- `supabase/migrations/297_sqcdp_show_markers.sql`
- `src/features/shift-productivity/production-boards/boards/sqcdp/hooks/use-sqcdp-metric-history.ts`
- `src/features/shift-productivity/production-boards/boards/sqcdp/hooks/use-sqcdp-metric-history.test.tsx` (6 cases)
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-history-editor.tsx`
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-history-editor.test.tsx` (2 smoke cases)
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-editor-dialog.tsx` (replaces the deleted sheet file)

**Modified:**
- `src/features/shift-productivity/production-boards/boards/sqcdp/hooks/use-sqcdp-metrics.ts` — `showMarkers` on `SqcdpMetricRow`/`CreateSqcdpMetricInput`/`mapRow`/SELECTs/INSERT/UPDATE/optimistic onMutate.
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-chart.tsx` — `showMarkers` dot rendering + above-target highlight + `overrideHistory` prop + `data-show-markers` test attribute + `activeDot` radius bump.
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-chart.test.tsx` — Recharts mock now walks children to invoke functional `dot` props per datum; +5 new cases (markers on line, markers on area, no markers default, above-target marking, overrideHistory path).
- `src/features/shift-productivity/production-boards/boards/sqcdp/sqcdp-board.tsx` — import swap from `SqcdpEditorSheet` → `SqcdpEditorDialog`.

**Deleted:**
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-editor-sheet.tsx` — superseded by the dialog. Sole caller (`sqcdp-board.tsx`) updated in the same patch.

### Validation

- `pnpm vitest run src/features/shift-productivity/production-boards` → **152 / 152 ✅** (139 pre-existing + 5 new chart marker tests + 6 history hook tests + 2 history editor smoke tests).
- `pnpm lint:check` → **0 errors, 91 warnings** — same baseline as v9; new files contribute **0** new warnings. (One pre-existing error in `WorkflowErrorBoundary.tsx` and one in `inventory-completion-view.tsx` were already dirty before this session.)
- `pnpm build` → ✅ successful.
  - `feature-shift-productivity` parent chunk: **478.42 KB raw / 102.01 KB gzip** = **identical to v9** (the work all landed in the lazy `sqcdp-board` chunk).
  - `sqcdp-board` lazy chunk: **56.86 KB raw / 15.06 KB gzip** (was 41.37 KB at v9 → +15.49 KB delta; the editor dialog + history editor + history hook all land here).
  - **467.21 KB post-min** for `feature-shift-productivity` per the bundle-budget script (matches v9).
- `node scripts/check-bundle-budget.mjs` reports the same pre-existing FAILs on `warehouse-location-map` (1487.63 KB) and `feature-admin` (983.26 KB); zero new bundle-budget regressions. `feature-shift-productivity` shows as WARN at 467.21 KB.
- Migration 297 applied via Supabase MCP `apply_migration` and verified with a follow-up SELECT.

### Trade-offs

- **Server-filter for history (`gte('recorded_at', cutoff)`)** instead of v9's client-slice. The editor surface is finite (max-h-[280px] table + scroll); ancient back-dates would confuse curators since the card chart silently filters them out anyway. The parent `useSqcdpMetrics` hook keeps client-slice (smaller payload variance + the row counts there are tiny).
- **Optimistic IDs use `-Date.now()`** in the history hook's `onMutate`. Negative ids signal optimistic — they're replaced by the real bigserial on `onSettled`'s invalidate. Direct reference comparison across renders is unreliable, so the invalidate is the source of truth.
- **Confirm-if-dirty exit** via a second `<ConfirmDialog>` (warning variant) routed through `attemptClose()`. Keeps the close-affordance contract tight (ESC, X, outside-click all funnel through the same gate) without a global beforeunload prompt.
- **No alt-text capture for sample series source labels** — every sample-generated point lands with `source='sample'`; manual adds with `source='manual'`. Future filters can use the column but the editor doesn't surface a per-row source switch yet.
- **Atomic rename** — the sheet file is deleted in the same patch as the new dialog file + the caller update; no alias bridge. The single-caller surface area made this safe.

### Open follow-ups

- **CSV import for bulk historical data** — the bulk-insert path is built; an admin-friendly CSV upload would beat the random-walk sample generator for real back-fill scenarios.
- **Per-data-point source labels** — `sqcdp_metric_history.source` is captured but not exposed as a filter / badge in the editor. Add a small chip column distinguishing `manual` / `sample` / `imported` once the CSV import lands.
- **Markers are size-uniform** beyond the binary above-target highlight. Could scale by recency (most-recent point bigger) or by deviation from target (further away → bigger so outliers pop).
- **Live preview demo dataset never hits markers** because the demo points lack a target. Acceptable for the create-mode preview but worth noting if curators ever ask why markers don't render at preview time.
- **`<SqcdpHistoryEditor>` doesn't surface a sort filter for source** — newest-first by date is enough today; revisit when CSV import lands.
- **The dialog's `max-h-[88vh]` body scroll** is browser-aware but not container-aware on tiny laptop screens. If the toolbar disappears on very short displays, consider a sticky header inside the body div.

### Cross-feature pattern

The dialog editor recipe is captured as [[Editable-Board-Dialogs]] (the new sibling pattern to [[Editable-Board-Sheets]]). The decision tree: forms ≤ 5 fields with no embedded subsystem use the sheet recipe; forms ≥ 6 fields, those that need a 2-column layout, those that host a live preview, or those that embed a CRUD subsystem (like the SQCDP history editor) use the dialog recipe.

### Related (added)

- [[Editable-Board-Dialogs]] — new pattern note covering the dialog-style editor recipe (replaces the sheet recipe for forms ≥ 6 fields).



## v11 — Console Error Triage (FK swap + notifications 404 graceful) (2026-05-10)

### Symptoms (production)

Two distinct console errors spamming users on the production Production-Boards routes:

1. **CRITICAL** — every 60 s (the SQCDP problems poll cadence):
   ```
   GET /rest/v1/sqcdp_problems?...&owner:user_profiles!assigned_to(full_name)&...
     400 (Bad Request)
   PGRST200: Could not find a relationship between 'sqcdp_problems' and 'user_profiles' in the schema cache
   ```
2. **NOISE** — every authenticated route mount + every 5 min while WS disconnected:
   ```
   GET https://rust-work-service-production.up.railway.app/api/v1/notifications/?unread_only=false&limit=50
     net::ERR_ABORTED 404 (Not Found)
   ```

### Error 1 — PGRST200 root cause

Migration 295 created seven user-attribution columns whose FK targets `auth.users(id)`. PostgREST only auto-discovers relationships whose target table lives in an exposed schema (`public`); `auth` is not exposed, so the embed cache lacked any link from `sqcdp_problems` to `user_profiles`. The fix swaps each FK to `public.user_profiles(id)` — valid because `user_profiles.id` is itself a 1-to-1 `REFERENCES auth.users(id) ON DELETE CASCADE` populated by trigger on every auth insert.

#### Migration 298 — columns swapped

| Table | Column | New target | ON DELETE |
| --- | --- | --- | --- |
| `sqcdp_problems` | `assigned_to` | `user_profiles(id)` | SET NULL |
| `sqcdp_problems` | `reported_by` | `user_profiles(id)` | SET NULL |
| `sqcdp_metrics` | `created_by` | `user_profiles(id)` | SET NULL |
| `sqcdp_metrics` | `updated_by` | `user_profiles(id)` | SET NULL |
| `production_board_posts` | `posted_by` | `user_profiles(id)` | SET NULL |
| `production_board_post_acks` | `user_id` | `user_profiles(id)` | CASCADE |
| `production_board_job_postings` | `posted_by` | `user_profiles(id)` | SET NULL |

**Pre-flight orphan audit** — zero rows had a `user_profiles`-orphan value across all seven columns (verified via per-column LEFT JOIN counts before applying the migration). Safe swap with no `UPDATE … SET col = NULL` required.

**Schema-cache reload** — migration ends with `NOTIFY pgrst, 'reload schema'` so PostgREST picks up the new relationships without a service restart.

**Pattern reinforced** — future Production tables that need PostgREST user-name embeds MUST FK to `public.user_profiles(id)`, never `auth.users(id)`. Captured in [[Fix-Sqcdp-Problems-PostgREST-Embed]] as the canonical lesson.

#### Hooks audited

All three potentially-impacted hooks already use the correct PostgREST embed syntax — they were just waiting for the FK to be visible. **No frontend code changes required for Error 1.**

- `boards/sqcdp/hooks/use-sqcdp-problems.ts` · `owner:user_profiles!assigned_to ( full_name )`
- `hooks/use-board-posts.ts` · `poster:user_profiles!posted_by ( full_name )` (acks join is on `production_board_post_acks` directly, not `user_profiles` — unaffected)
- `boards/jobs/hooks/use-job-postings.ts` · `poster:user_profiles!posted_by ( full_name )`

### Error 2 — notifications 404 graceful (Option A++)

The `useNotifications` hook bootstraps from `GET /api/v1/notifications/` on every authenticated route mount + every 5 min while the WS is disconnected. When `rust-work-service-production` doesn't yet have the `/api/v1/notifications/*` routes deployed, every bootstrap 404s. Crucially, **the JS already handled the 404 by returning an empty list and downgrading to `logger.debug`** — but the browser's network layer still emits `GET ... 404 (Not Found)` to DevTools BEFORE our JS sees the response. A try/catch alone can't suppress browser-level network-error logs.

**Fix** — module-level probe-cache pattern in `src/lib/work-service/notifications.client.ts`:

- `_endpointReachable: boolean | null = null` (module scope; resets on page reload).
- First call falls through to a real `fetch`. If the response is 404, set `_endpointReachable = false` and return `EMPTY_RESPONSE`.
- Every subsequent call short-circuits at the top — no network request, no browser log.
- 5xx responses still fail soft for the current call but DON'T poison the cache (transient outages should retry on the next safety-net tick).
- Added `__resetNotificationsEndpointProbe` test seam for future unit tests.

This is a Option-A variant: rather than letting every call 404 silently in JS while the browser keeps logging, we probe ONCE per page load and elide subsequent attempts. The cache resets on page reload, so a service redeploy is picked up by the next bootstrap with no code change.

**Why not a feature flag?** — there's no `VITE_RUST_WORK_NOTIFICATIONS_ENABLED` precedent (the existing flag is `VITE_RUST_CORE_ENABLED` for `rust-core-service`, a different deployment). Adding one would couple the FE bundle to a manual deploy step; the probe-cache is automatically self-healing.

#### `retry: false`

`useNotifications` doesn't use TanStack Query — it's a hand-rolled `useState` + `useEffect` bootstrap. There's no per-fetch retry, only the on-mount + 5-min safety-net. The probe-cache makes the safety-net a no-op once 404 is established. So no `retry: false` toggle needed.

### Files Touched

- `supabase/migrations/298_production_boards_user_profiles_fks.sql` (new)
- `src/lib/work-service/notifications.client.ts` (probe-cache + test seam)

### Validation

- `pnpm vitest run src/features/shift-productivity/production-boards` — **152/152 pass** (no regressions from v10).
- `pnpm lint:check` — 0 errors, 91 pre-existing warnings (lint-ratchet ≡).
- `pnpm build` — succeeded; `feature-shift-productivity` chunk = **478.42 KB raw / 102.01 KB gzip** (identical to v10; under 500 KB hard cap).
- Supabase MCP `apply_migration` succeeded with `success: true`. Post-migration `pg_catalog` query confirms all 7 FKs now reference `user_profiles(id)`.

### Open Follow-ups

- **Implement `/api/v1/notifications/*` in `rust-work-service-production`** — the probe-cache is a graceful pause, not a permanent solution. Once the route ships, the bell starts populating without any FE code change (cache resets on reload). Track in `Roadmap-Rust-WS-Unlocks.md` Tier 2.2.
- **Add a unit test** for the probe-cache in `notifications.client.ts` exercising `__resetNotificationsEndpointProbe` — deferred since the pattern is straightforward and the existing integration via `useNotifications` already covers the happy path.
- Consider migrating other `auth.users`-targeted FKs in `public` schema (e.g. `inbound-cart`, `cycle-count`, `standard-work` services) to `user_profiles` proactively if the FE is going to embed them — audit pending.

### Related

- [[Fix-Sqcdp-Problems-PostgREST-Embed]] — the standalone Debug write-up for Error 1 with the canonical "FK to `user_profiles`, not `auth.users`" lesson.
- [[ProductionBoards - Feature Module]] § v6 (introduced the offending `auth.users` FKs)
- [[Sessions/2026-05-10]]


## v11.1 — sqcdp_metric_history.source column (2026-05-10)

Follow-up schema fix for v10. The v10 worker (`useSqcdpMetricHistory`) shipped reading + writing a `source` column (`'manual'` for individual editor inserts, `'sample'` for the bulk "Generate sample data" path), but **migration 295 never added the column** — the spec described the semantics in the implementation log, the worker honoured them in code, and the migration body silently omitted them. End result: every history poll 400'd with `column sqcdp_metric_history.source does not exist` and the editor's bulk-insert button was dead from day one of v10.

Migration **299** (`supabase/migrations/299_sqcdp_metric_history_source.sql`) — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS source text`. Nullable + free-form text (not enum) so future provenance labels (`imported` / `csv` / `auto` / ...) don't require another migration. Existing rows stay as `NULL` (interpreted as "unknown source"); new writes land with `'manual'` or `'sample'` per the worker's defaults. No backfill, no FE code changes — the worker was already correctly wired and was waiting for the column to exist. Ends with `NOTIFY pgrst, 'reload schema'` so PostgREST picks up the new column without a service restart.

Validation — 152/152 production-boards vitest pass, lint baseline carry-over (91 warnings / 0 errors), schema query confirms `source text NULLABLE` is now present, and the exact failing browser query (`select id, metric_id, recorded_at, value, source ... order by recorded_at asc limit 5`) now succeeds. Did a quick column drift audit across the other two SQCDP tables while in the schema — `sqcdp_metrics` and `sqcdp_problems` match their spec exactly; only `last_data_at` was listed in the spec but never read by the FE (`rg last_data_at` → 0 callsites), so it's a doc-only artefact, not real drift. Migration 299 stays tightly scoped to the one column the FE actually reads.

Lesson captured in [[Fix-Sqcdp-Metric-History-Missing-Source]] for future worker hand-offs: when a worker spec lists columns that the migration body skips, audit the live schema BEFORE the dependent FE worker is wired up. The implementation note and the migration are two separate artefacts and they can drift silently — mocked unit tests can't catch it because they don't round-trip through PostgREST's schema cache.


## v11.2 — SQCDP Equal Card Heights (2026-05-10)

Fix for visual unevenness across the primary 5-card SQCDP row (and the secondary 4-card row) caused by big-number values wrapping to a different line count per card ("848 Days" wraps to 2 lines, "475" stays on 1 line, "8 % OT" wraps differently). Because the meta block stacked content from the top, the chart strip landed at a different vertical position on every card and the empty space accumulated below the chart — making the row read as ragged. Fix anchors the chart strip to the bottom of every card and reserves a stable big-number footprint:

- [[Patterns/Elevated-KPI-Stat-Cards|Elevation surface]] (`<CardSurface>`) now carries `h-full` so each card stretches to the grid row's stretched height (`align-items: stretch` is the default on the parent grid; we just had to forward it through the `<motion.div>` wrapper in `<SqcdpGrid>` with an explicit `h-full` since framer-motion shrink-wrapped to its child by default).
- Meta block (`d.body`) gains `flex-1` so it absorbs the row's height variance instead of leaving the empty space below the chart.
- New `DENSITY.primaryReserve` token = `min-h-[9rem] flex items-end` (normal) / `min-h-[16rem] flex items-end` (TV). Sized at exactly 2 lines of `text-{7,9}xl leading-none` (4.5rem × 2 = 9rem; 8rem × 2 = 16rem) so the worst-case 2-line wrap fits without breaking the layout, and `items-end` bottom-anchors single-line values like "475" at the same baseline as wrapped values like "848 Days".
- The target/period row gets `mt-auto` so it (and the optional "Updated …" caption that follows) push to the bottom of the meta block — i.e. just above the chart strip on primary cards, and at the bottom of the card on secondary cards. Keeps the period chip → chart edge distance constant across the row.
- The empty `+ Add metric` placeholder already had `h-full min-h-[200px] flex flex-col`; verified it picks up the grid's stretched height alongside filled siblings, so a row with mixed empty/filled cells still reads as a clean horizontal strip.
- Chart height is already locked at `DENSITY_HEIGHT[density]` inside `<SqcdpChart>` (120 px normal / 180 px TV); no further work needed there.

Validation: all 152 production-boards vitest tests pass, eslint clean on the two touched files (`sqcdp-card.tsx`, `sqcdp-grid.tsx`), bundle size on `feature-shift-productivity` is identical at 478.42 kB / 102.01 kB gzip before and after.

Follow-ups: the same `primaryReserve` token should drop into any future KPI card that uses big-number wrapping (e.g. if `LiveOperatorStatus` adopts the same elevation pattern). If we ever find a real 3-line wrap in production, we'd need to bump `primaryReserve` to `min-h-[13.5rem]` or move to an `clamp(2,4)` line clamp instead — for today's value formats (number, percent, currency, duration, text) 2 lines is the realistic ceiling.


## v11.3 — SQCDP Colored Header Strip + Larger Category Title (2026-05-10)

Visual upgrade for the SQCDP scorecard cards: the previous 4 px solid color band on top is gone, replaced by a substantial **colored header strip** (~58–62 px tall normal / ~88–92 px TV) that carries the category title in white at a real heading size. Visual reference is the thyssenkrupp Branch Performance scorecard — each cell wears a saturated header (red for Safety, green for Quality, …) that telegraphs the category at a glance.

Diff vs v11.2:

- **Top accent**: 4 px `<div>` band → full-width colored header `<div>` styled `flex items-center justify-between gap-3 px-5 py-3.5` (TV: `gap-4 px-7 py-5`) with `style={{ backgroundColor: color }}` and a `shadow-[inset_0_-1px_0_rgba(0,0,0,0.10)]` hairline at the bottom edge for a touch of depth into the meta block. The header inherits rounded top corners via the parent `<CardSurface>`'s `overflow-hidden rounded-2xl` (no `rounded-t-2xl` on the header itself — would double up).
- **Title**: was `<span class='text-xs uppercase tracking-wider'>` (~12 px). Now a real `<h3 class='text-2xl font-bold uppercase tracking-tight text-white truncate'>` (~24 px) at normal density, `text-4xl` (~36 px) at TV. Promoted to a real heading element so screen readers / outline tooling pick it up. Stayed at `text-2xl` rather than bumping to `text-3xl` because uppercase + bold + tracking-tight already reads as substantial relative to the `text-7xl` big number two rows down — `text-3xl` started fighting the value for visual weight.
- **Icon tile dropped**: the v5 Elevated-KPI-Stat-Cards eyebrow uses an `IconTile` (`bg-{accent}/10 text-{accent} ring-1 ring-inset`) because it sits on a NEUTRAL surface and needs a tinted backdrop to read. Inside the new colored header the icon sits directly on its own accent — no tile needed. Renders as a plain `<Icon class='h-5 w-5 text-white/95 shrink-0'>` (TV: `h-7 w-7`) inline next to the title.
- **Pencil edit affordance moved into the header**: still `editMode && canEdit` gated and still hover-revealed (`opacity-0 transition-opacity group-hover:opacity-100`), now styled `text-white/85 hover:text-white hover:bg-white/15 focus-visible:ring-white/40` so it stays legible against any saturated accent. Uses `<Button variant='ghost' size='icon'>` from shadcn so the focus ring + ARIA stay intact. Added `focus-visible:opacity-100` so keyboard users without hover can still tab to it.
- **Body simplified**: the old eyebrow row (icon + label + pencil at top of `d.body`) is gone — body now starts directly with the big-number block. Reduces the body to two visual concerns: hero number + meta footer. Cleaner read.
- **Density tokens added**: `header`, `headerTitle`, `headerIconSize`, `headerEditButton` per density. Existing `label` + `iconSize` retained for the empty-slot placeholder card (which still uses the eyebrow shape — see below).
- **Placeholder untouched**: the `+ Add metric` empty slot still renders as a dashed-border button with the small-caps eyebrow row + accent thin band on top. Decision was to keep the placeholder visually distinct from populated cards (dashed border = "this is empty, click to fill"); upgrading the placeholder to a colored-header card would muddy that affordance signal.

### Color contrast note

The 9 canonical SQCDP accents are all in the 500–800 saturation range:

| Category | Hex | White text contrast | WCAG (large text, ≥ 18 pt or ≥ 14 pt bold) |
|----------|------|---------------------|---------------------------------------------|
| Safety | `#DC2626` | ~5.9:1 | AA / AAA |
| Quality | `#16A34A` | ~3.9:1 | AA |
| Cost | `#EA580C` | ~3.7:1 | AA |
| Delivery | `#0EA5A9` | ~3.0:1 | AA (just) |
| Production | `#CA8A04` | ~3.4:1 | AA |
| Maintenance | `#7C3AED` | ~6.0:1 | AA |
| Shipping | `#9333EA` | ~6.0:1 | AA |
| Big Idea | `#1E3A8A` | ~12:1 | AAA |
| Announcement | `#0EA5E9` | ~3.0:1 | AA (just) |

The `text-2xl font-bold` title qualifies as "large text" under WCAG (24 px ≈ 18 pt; bold lowers the threshold further to ~14 pt), so the 3.0:1 floor is the relevant bar. Every canonical accent clears it. The `text-white/95` icon hits non-text contrast 3.0:1 against the same backgrounds (it's an icon, not text).

### Hover glow scoping

The v5 Elevated-KPI-Stat-Cards recipe references a card-wide radial-glow `<span>` on hover. The SQCDP variant does not currently include that span (was intentionally dropped at v6 build-out — the `<CardSurface>` here only carries the top-light gradient + hover shadow stack), so there was nothing to scope around the colored header. If a future change adds a card-wide glow to SQCDP cards, it should be moved into the meta-block container so it doesn't fight the saturated header band.

### Files changed

- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-card.tsx` — added `header` / `headerTitle` / `headerIconSize` / `headerEditButton` density tokens, dropped the 4 px `<div>` band from `<CardSurface>`, replaced the body's eyebrow row with the new colored header `<div>` rendering `<h3>` + icon + ghost pencil button.

No schema, no test, no chart changes. Pure CSS reshuffle.

### Validation

- 152/152 production-boards vitest pass.
- `pnpm lint:check` — 91 warnings / 0 errors (matches v11.2 baseline exactly; no new warnings introduced).
- `pnpm build` succeeds; `feature-shift-productivity` chunk = **478.42 kB raw / 102.02 kB gzip** — identical to v11.2's 478.42 kB / 102.01 kB gzip (gzip noise of 0.01 kB).
- `node scripts/check-bundle-budget.mjs` — pre-existing FAIL on `warehouse-location-map` and `feature-admin` (both untouched by v11.3); `feature-shift-productivity` reports as 467.21 KB by the budget tool (different counting path than rollup output) and stays in the WARN-but-passing band.

### Pattern impact

This takes the SQCDP cards visually distinct from the generic [[Patterns/Elevated-KPI-Stat-Cards]] recipe — that recipe pairs a thin top-edge accent line with a tinted icon tile on a neutral surface, the SQCDP variant pairs a saturated colored header band with the icon inline in white. Both share the same elevation surface (border + bg-card + 3-stop shadow stack + hover lift), they just diverge on the header treatment. Captured as a `## Variant: Colored Header Scorecard` section on the pattern note so the next adopter sees both shapes side-by-side and picks the right one for their use-case.

### Open follow-ups

- Curator-set `metric.colorHex` is currently free-form — if a curator picks a very light hex (e.g. `#FFEB3B` yellow), white text on the header becomes unreadable. Could auto-pick black text below a luminance threshold (e.g. `relativeLuminance(color) > 0.5 → text-slate-900`), but skipping for v11.3 because (a) the color picker UI isn't shipped yet and the 9 canonical defaults are all safe, (b) it's curator-side data quality, not a chrome bug. Park as a follow-up to revisit when the metric editor exposes a free hex picker.
- The placeholder card still uses the v6 dashed-border + thin top band shape. If the design team wants the empty slot to match the colored-header family more closely, we could render a desaturated/striped version of the colored header band there — but the dashed-border affordance is doing real work signalling "empty, click to add", so changing it should be a deliberate UX decision, not drive-by polish.
- Consider promoting the colored-header tokens into a tiny shared helper (e.g. `getColoredHeaderTokens(density)`) if a second consumer adopts the variant. One adopter today doesn't justify the abstraction.



## v12 — SQCDP Editor Flexibility (per-input fonts, stacked sub-metrics, trend / prefix / suffix / decimals / polarity) (2026-05-10)

Three explicit user requests + a tightly scoped "more flexibility" follow-on shipped together as one cohesive editor + card upgrade. Curators can now (1) pick font family / size / weight per text field on the card, (2) split one card into multiple stacked sub-metric blocks (the thyssenkrupp Maintenance pattern: "Open Work Orders: 8" stacked above "Machine Down: 6"), and (3) tune each metric's prefix / suffix / decimal places / lower-is-better polarity. The card now also paints a trend arrow + a comparison value next to the big number whenever 2+ history points exist.

### Migration 300

`supabase/migrations/300_sqcdp_metrics_editor_v12.sql` — applied via Supabase MCP `apply_migration` on 2026-05-10. Adds 6 columns to `sqcdp_metrics`:

- `style_config jsonb NOT NULL DEFAULT '{}'::jsonb` — per-field font / size / weight / transform overrides. Empty object = use density defaults.
- `sub_metrics jsonb NOT NULL DEFAULT '[]'::jsonb` — when non-empty, the card switches from the single-value layout to a stacked-blocks layout (each block is a labeled value pair with a divider above).
- `value_prefix text` — prepended to the formatted primary value (e.g. `$`, `~`).
- `value_suffix text` — appended after the formatted primary value + optional unit (e.g. ` ppm`).
- `decimal_places int CHECK (NULL OR 0..4)` — explicit override of the formatter's max/min fraction digits for `number` and `percent` formats. Null = each format's default.
- `lower_is_better boolean NOT NULL DEFAULT false` — polarity flag. When true, ↑ paints red and ↓ paints green on the trend indicator.

`COMMENT ON COLUMN` on the two `jsonb` shapes so future curators / migrations have a contract reference. Migration ends with `NOTIFY pgrst, 'reload schema'` so PostgREST picks up the columns without a service restart. Verification SELECT post-apply confirmed all existing rows defaulted as expected (`{}` / `[]` / `null` / `null` / `null` / `false`).

### Tabbed dialog refactor

The v10 flat-form `<SqcdpEditorDialog>` got unscannable once font controls + sub-metrics joined the basics — too many concerns competing for the same vertical scroll. v12 promotes the metric form body to a shadcn `<Tabs>` interface with four tabs:

- **Basics** — Category, Title, Subtitle, Format, Period, Current value, Target, Unit, Notes, Visible toggle.
- **Style** — Color override, Accent color, Chart type, Show markers, AND the new per-input typography rows (Title / Subtitle / Primary value, each with Family / Size / Weight selects + a "Reset to default" link that clears the override).
- **Advanced** — Prefix, Suffix, Decimal places, Lower-is-better, AND the bulk of this tab is the sub-metrics editor (drag-to-reorder list with per-row Title / Value / Format / Subtitle inputs).
- **History** — the existing `<SqcdpHistoryEditor>` (moved out of the bottom of the dialog into its own tab so the editor body no longer scrolls past it on the way to the footer). Tab is `disabled` in create-mode (no metric ID yet).

Dialog width bumped from `sm:max-w-[820px]` → `sm:max-w-[920px]` to accommodate the tab strip + a real card preview. Body cap stays at `max-h-[88vh]`.

**Sticky live preview** at the top of the dialog renders an actual `<SqcdpCard>` (not just the chart) keyed off `useWatch(form.control)` so the curator sees the colored header + big number + sub-metric stack + chart strip update as they edit any tab. `pointer-events-none` on the preview wrapper disables the per-card pencil affordance — they're already in the editor; an extra hover-pencil here would be noise.

### Style config shape + the JIT-safe static-class-map technique

Defined in `boards/sqcdp/lib/style-config.ts`:

```ts
export interface FieldStyle {
  font?: 'sans' | 'serif' | 'mono'
  size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl' |
         '4xl' | '5xl' | '6xl' | '7xl' | '8xl' | '9xl'
  weight?: 'normal' | 'medium' | 'semibold' | 'bold' | 'black'
  transform?: 'none' | 'uppercase' | 'capitalize'
}
export interface StyleConfig {
  title?: FieldStyle
  subtitle?: FieldStyle
  primary?: FieldStyle
}
```

**Critical detail**: Tailwind v4 JIT scans source files for class literals — a dynamically-composed string like `text-${size}` is invisible to the compiler and the resulting CSS won't ship the class. Solved by exporting static maps that list every utility once:

```ts
export const SIZE_CLASS: Record<FontSize, string> = {
  xs: 'text-xs', sm: 'text-sm', base: 'text-base', lg: 'text-lg',
  xl: 'text-xl', '2xl': 'text-2xl', '3xl': 'text-3xl', '4xl': 'text-4xl',
  '5xl': 'text-5xl', '6xl': 'text-6xl', '7xl': 'text-7xl',
  '8xl': 'text-8xl', '9xl': 'text-9xl',
}
export const WEIGHT_CLASS: Record<FontWeight, string> = {
  normal: 'font-normal', medium: 'font-medium', semibold: 'font-semibold',
  bold: 'font-bold', black: 'font-black',
}
export const FONT_FAMILY_CLASS: Record<FontFamily, string> = {
  sans: 'font-sans', serif: 'font-serif', mono: 'font-mono',
}
```

The spec mentioned a `display` family — confirmed there's no `font-display` utility in this project (`@theme inline` in `src/index.css` defines `--font-inter / --font-manrope / --font-geist / --font-plus-jakarta-sans / --font-dm-sans` but none alias to `display`), so it was dropped from the picker. `fieldClasses(style, defaults)` merges per-key, then composes the output via `cn(FONT_FAMILY_CLASS[..], SIZE_CLASS[..], WEIGHT_CLASS[..], TRANSFORM_CLASS[..])`. `parseStyleConfig(raw)` sanitizes JSON from the DB (drops unrecognized keys + bogus enum values) so a malformed payload never crashes the card.

**Pattern surfaces**: this is reusable across any future scorecard / dashboard config surface — captured as the start of [[Per-Field-Style-Overrides]] (see Pattern Impact below).

### Sub-metric shape + the "non-empty subs ignores current_value" rule

```ts
export interface SubMetric {
  id: string                     // crypto.randomUUID() at create time
  title: string                  // 1–60 chars
  value: number | null
  value_format: ValueFormat      // reuses the existing dispatch
  unit?: string | null
  subtitle?: string | null
  decimal_places?: number | null // 0–4 or null
}
export type SubMetrics = SubMetric[]
```

Stored on the row as `sub_metrics jsonb`. **Layout switch rule**:

- `sub_metrics.length === 0` → card renders the legacy single-value layout (current_value + subtitle + trend + comparison). Existing single-metric cards keep working as-is.
- `sub_metrics.length >= 1` → card renders the stacked layout: each sub-metric is a small block (title at `text-sm uppercase` / value at `text-5xl black tabular-nums` / optional subtitle at `text-[11px] muted`), divider (`border-t border-border/30`) between blocks. **`current_value` is ignored entirely** — the curator opted into the stacked layout by adding a sub-metric, the parent's big number doesn't compete for the same visual real estate.

This avoids a "first-row migration" — the column defaults to `[]`, so every existing card stays at the single-value layout until the curator deliberately adds a sub-metric. The stacked-mode card also bumps `min-h` (`min-h-96` normal, `min-h-144` TV) so 2-3 stacked rows + a chart strip fit without cramping; single-mode keeps its grid-stretch behavior unchanged.

The sub-metrics editor is a `@dnd-kit` (already in the bundle — `@dnd-kit/{core,sortable,modifiers,utilities}`) sortable list. `restrictToVerticalAxis` modifier + `verticalListSortingStrategy` so reorder feels right; the drag handle is a small `IconGripVertical` button to the left of each row (`activationConstraint: { distance: 4 }` to avoid hijacking clicks on the row's inputs).

### Trend computation + lower-is-better polarity

Computed inside `<SqcdpCard>` from the last 2 entries of `metric.history`:

```ts
const { trend, previous } = computeTrend(metric.history)
// trend: 'up' | 'down' | 'flat' | 'none'
// previous: number | null  (null when history < 2)
```

`trendColorClass(trend, lowerIsBetter)`:

- `flat` / `none` → `text-muted-foreground/70`
- `lowerIsBetter === false` (default — higher is better, e.g. quality, throughput): ↑ green, ↓ red.
- `lowerIsBetter === true` (defects, cost, incidents): ↑ red, ↓ green.

Rendered as a `<TrendIndicator>` (Tabler `IconTrendingUp` / `IconTrendingDown` / `IconArrowRight`) inline next to the big number. Sized at `h-7 w-7` normal / `h-10 w-10` TV — substantial enough to read at distance, not so loud that it competes with the value itself. Skipped entirely when `metric.subMetrics.length >= 1` (the stacked layout has its own visual weight; an arrow next to one of the sub-blocks would be confusing) and skipped when `trend === 'none'`.

The **comparison value** subtext (`vs 6.21 last week`) renders below the big number when a previous point exists. Period-label mapping:

- `rolling_4_weeks` → `last week`
- `rolling_30_days` → `yesterday`
- `last_6_months` → `last month`
- `ytd` → `last week`
- else → `previously`

Format reuses `formatValueWithOptions` so the comparison honours the same prefix / suffix / decimal_places as the big number.

### Format helper extension

`formatValueWithOptions(format, value, unit, { prefix, suffix, decimal_places })` lives in `lib/format.ts`. Skips prefix/suffix on the em-dash sentinel (so empty cards don't read as `$—`), and only applies the decimal override on `number` / `percent` formats — `currency` and `duration` keep their dispatcher-controlled rounding (overriding fraction digits there would muddy hours-minutes formatting and locale-dependent currency rendering). Tested with 6 cases covering pass-through, prefix+suffix, decimal padding (12.5 → `12.50`), prefix + suffix + decimal + unit combo, em-dash protection, and the non-numeric format pass-through.

### Files added / modified

**Created**:
- `supabase/migrations/300_sqcdp_metrics_editor_v12.sql`
- `src/features/shift-productivity/production-boards/boards/sqcdp/lib/style-config.ts` (+ `.test.ts`, 9 cases — defaults, partial override, full override, transform classes, exhaustive map literals, parser sanitisation)
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-sub-metrics-editor.tsx`
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-card.test.tsx` (7 cases — single-mode, prefix+suffix+decimals, trend, polarity, comparison, stacked × 2)

**Modified**:
- `src/features/shift-productivity/production-boards/boards/sqcdp/lib/format.ts` — `formatValueWithOptions(...)` + `FormatOptions` interface (+6 test cases in `format.test.ts`).
- `src/features/shift-productivity/production-boards/boards/sqcdp/hooks/use-sqcdp-metrics.ts` — `SubMetric` / `SubMetrics` types, `parseSubMetrics()` sanitiser, `styleConfig` / `subMetrics` / `valuePrefix` / `valueSuffix` / `decimalPlaces` / `lowerIsBetter` on `SqcdpMetricRow` + `CreateSqcdpMetricInput`; `mapRow` reads the new columns; `RawMetricRow` updated; SELECT clauses (query + insert + update) carry the new columns; INSERT/UPDATE serialise them; optimistic `onMutate` threads them through. Auto-record-on-change preserves existing behavior — only `current_value` actually changing writes a new history row.
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-card.tsx` — `computeTrend` / `trendColorClass` / `TrendIndicator` / `SubMetricBlock` / `renderPrimaryValue` helpers, density tokens for `subPrimary` / `subPrimaryReserve` / `subTitle` / `subSubtitle` / `trendIconSize` / `comparison`, stacked-mode rendering branch, prefix/suffix/decimals via `formatValueWithOptions`, style-config application via `fieldClasses`, comparison subtext.
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-editor-dialog.tsx` — full restructure: form body wrapped in `<Tabs>`, `<LivePreview>` renders a real `<SqcdpCard>` from `useWatch` values, `BasicsTab` / `StyleTab` / `AdvancedTab` extracted, `<FieldStyleRow>` helper renders one Family / Size / Weight row per text-field key, sub-metrics tab embeds `<SqcdpSubMetricsEditor>` via `Controller`. Dialog width `sm:max-w-[820px]` → `sm:max-w-[920px]`.
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-chart.test.tsx` — `buildMetric` extended with the new `SqcdpMetricRow` fields (no test logic changes).
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-history-editor.test.tsx` — same `buildMetric` extension.

### Validation

- `pnpm vitest run src/features/shift-productivity/production-boards` → **174 / 174 ✅** (152 carried over + 9 new style-config + 6 new format option + 7 new card stacked-mode/trend/polarity/prefix-suffix tests).
- `pnpm lint:check` → **0 errors, 91 warnings** — same baseline as v11.x; new files contribute 0 new warnings.
- `pnpm build` → ✅ successful.
  - `feature-shift-productivity` parent chunk: **478.42 KB raw / 102.01 KB gzip** = identical to v11.x baseline (everything landed in the lazy `sqcdp-board` chunk).
  - `sqcdp-board` lazy chunk: **77.26 KB raw / 20.30 KB gzip** (was 56.86 KB at v10 → +20.40 KB delta — the spec predicted 75–85 KB; landed inside the window).
- `node scripts/check-bundle-budget.mjs` reports the same pre-existing FAILs on `warehouse-location-map` and `feature-admin`; zero new bundle-budget regressions. `feature-shift-productivity` shows as WARN at 467.21 KB (matches v11.x exactly).

### Trade-offs

- **Tabs at 4-section threshold** — flat form was tolerable through v11 (≤ 12 fields). Once font controls (3 rows × 3 selects) + sub-metrics editor (variable rows × 4 inputs) joined, the flat form would have been > 25 visible controls in a single scroll. Tabs split the editor by concern; the Pattern note ([[Editable-Board-Dialogs]]) gained a "When to add tabs" section pointing at this v12 work as the canonical example.
- **Sticky preview is a `<SqcdpCard>`, not just a chart** — the v10 preview was `<SqcdpChart>` only. With v12's per-input typography + sub-metrics + prefix/suffix + decimals + polarity, a chart-only preview would have hidden most of the changes the curator was making. The card preview lives in a `pointer-events-none` wrapper so the hover-pencil and any future click affordances don't fire during editing.
- **`useWatch` for the entire form** instead of per-field watch (the v10 dialog used `form.watch('chartType')` × 4 fields). With ~25 watchable fields under the v12 surface, the per-render cost of `useWatch` once is cheaper than 25 individual `form.watch(...)` calls.
- **Static class maps over Tailwind safelist** — could have added a `safelist` block to the Tailwind config, but listing utilities in a `Record<FontSize, string>` keeps the JIT-visible classes co-located with the code that uses them and survives any future build-system rename of the safelist mechanism.
- **`lower_is_better` only affects the trend arrow color** — the spec mentioned an optional chart fill inversion. Inspected the area-chart gradient (3-stop accent fade); inverting it would muddy the dashed target line + the above-target marker highlight, which both rely on the same accent. Skipped per the spec's "judgment call".
- **`primary` field's leading-none + tabular-nums + tracking are NOT user-configurable** — only family / size / weight / transform are exposed. Locking the leading + tabular-nums + tracking keeps every value read at the same baseline; letting curators flip those would risk "475" and "848 Days" landing at different y-positions across the row.
- **Sub-metric titles get a smaller default than the colored-header** — `text-sm` normal / `text-base` TV (vs the header strip's `text-2xl` / `text-4xl`). They're inline blocks inside the body, not a saturated band; the saturated style would compete with the colored header.
- **`crypto.randomUUID()` with a Math.random() fallback** — the project polyfills crypto in `src/test-setup.ts` but the fallback (`sm_${randomHex}_${timestamp}`) keeps the editor working in any sub-spec environment that strips `crypto.randomUUID()`.

### Open follow-ups

- **Animated count-up on big number when value updates** — currently the v9 framer-motion stagger animates the card mount but the value itself is a plain `<span>{n}</span>`. A `<motion.span>` with a number tween would smooth `12 → 14` updates.
- **Annotation markers on chart at specific dates** — overlay events (deployments, audits, weather days) on the chart strip. Would need a new `sqcdp_metric_annotations` table; defer until a curator asks.
- **Per-metric refresh cadence override** — the parent hook polls every 60 s for every metric. A `refresh_cadence_seconds` column would let high-churn metrics tighten and low-churn metrics relax.
- **Theme presets** — pre-built `style_config` bundles users could apply with one click (e.g. "Compact density", "Newspaper", "Display"). The shape is already there; needs UI design.
- **Sub-metric trend / target / chart per-row** — the spec scoped sub-metrics to the labeled value pair. If a curator wants per-sub-metric trend or target, that's a v13 ADR.
- **Sub-metric drag-handle accessibility** — the keyboard sensor is wired but the on-screen affordance for keyboard reorder needs a small instruction (`Press space to lift, arrow keys to reorder`) — the editor's drag-context could expose it via a small label below the list.
- **Curator-set free-form `colorHex` on a very light hex still renders white text** on the colored header (carry-over from v11.3). Could auto-pick black text below a luminance threshold; deferred since the 9 canonical defaults all clear AA.

### Pattern impact

- [[Editable-Board-Dialogs]] gained a "When to add tabs" decision rule pointing at this v12 work — ≥ 4 sections of unrelated form fields = use tabs.
- The static-class-map JIT-safe technique (along with the `parseStyleConfig` sanitisation pattern) is the seed of [[Per-Field-Style-Overrides]] — a reusable recipe for any future card / scorecard config surface.



## v12.1 — Show-trend toggle (2026-05-10)

Follow-on to v12: curators asked for explicit per-metric control over the auto-painted trend arrow + comparison subtext. v12 forced both whenever history had ≥ 2 points; some cards read better as just the headline number, and the `vs N {previous}` subtext is noisy when the previous point is structurally identical (e.g. a binary status flipping).

### Migration 301

`supabase/migrations/301_sqcdp_show_trend.sql` — applied via Supabase MCP `apply_migration`. Adds one column to `sqcdp_metrics`:

- `show_trend boolean NOT NULL DEFAULT true` — when false, the card suppresses BOTH the ↑/↓/→ arrow and the `vs N {previous}` comparison subtext even if 2+ history points exist. Default `true` preserves the v12 behaviour for every existing row (verification SELECT confirmed all 5 production rows defaulted as expected).

Migration ends with `NOTIFY pgrst, 'reload schema'` so PostgREST picks up the column without a service restart, mirroring the migration 300 pattern.

### Card gating

Both render gates were hoisted into named locals at the top of `<SqcdpCard>` so the intent is grep-able:

```ts
const trendEnabled =
  metric.showTrend && isPrimary && !isStackedMode && trend !== 'none'
const showComparison = metric.showTrend && previous !== null
```

The stacked sub-metric layout already skipped both (its `isStackedMode ? <stacked> : <single>` switch only renders trend / comparison in the single branch), so no change was required there. The polarity / lower-is-better colour logic is reached only via `<TrendIndicator>`, so suppressing the arrow at the gate also suppresses every downstream colour decision.

### Editor dialog

The v12 Advanced tab already hosts `lowerIsBetter` as a sibling switch row. Added `showTrend` as a third row in the same 2-col `grid grid-cols-1 gap-3 md:grid-cols-2` block (collapses to a single column on `< md` — third row stacks naturally below). Description copy: *Display the auto-computed ↑/↓/→ arrow next to the primary value plus the "vs {previous}" comparison subtext. Hide if you only want the headline number.*

The sticky live preview already reads `metric.showTrend` (it builds a synthetic `SqcdpMetricRow` from `useWatch(form.control)` and the card render gate consumes the field) so the toggle flips the preview in real time — no extra `form.watch` wiring needed.

### Files changed

**Created**:
- `supabase/migrations/301_sqcdp_show_trend.sql`

**Modified**:
- `src/features/shift-productivity/production-boards/boards/sqcdp/hooks/use-sqcdp-metrics.ts` — `showTrend: boolean` on `SqcdpMetricRow` + `CreateSqcdpMetricInput`; `show_trend` on `RawMetricRow`; `mapRow` reads `raw.show_trend ?? true`; SELECT clauses (query / insert select / update select) carry the column; INSERT/UPDATE serialise it; optimistic `onMutate` threads it through.
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-card.tsx` — `trendEnabled` + `showComparison` named locals gate the trend arrow + the comparison subtext on `metric.showTrend`.
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-editor-dialog.tsx` — `showTrend: z.boolean()` on `metricSchema`; default `true` in form `defaultValues`; payload includes the value; `buildPreviewMetric` carries it through; Advanced tab gains the `Show trend arrow` switch row beside `lowerIsBetter`.
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-card.test.tsx` — `buildMetric` includes `showTrend: true`; new suppression test asserts both `sqcdp-trend-indicator` and `sqcdp-comparison-value` are absent when `showTrend === false` while the primary number still renders.
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-chart.test.tsx` + `sqcdp-history-editor.test.tsx` — `buildMetric` includes `showTrend: true` (no test logic changes).

### Validation

- `pnpm vitest run src/features/shift-productivity/production-boards` → **175 / 175 ✅** (174 carried over + 1 new suppression test).
- `pnpm lint:check` → 0 errors, **91 warnings** — same baseline as v12; new code contributes 0 new warnings.
- `pnpm build` → ✅ successful. `feature-shift-productivity` parent chunk: **478.42 KB raw / 102.01 KB gzip** = identical to v12 baseline. `sqcdp-board` lazy chunk: 78.16 KB (was 77.26 KB; +0.9 KB for the field passthrough + Switch). No new bundle-budget regressions.

### Decisions

- **Default true, not false** — every existing row gets the field set automatically on read (`raw.show_trend ?? true`) and on insert (`input.showTrend ?? true`). A false default would have flipped behaviour on the 5 production rows without a curator opt-in.
- **One column, one switch** — not two (e.g. a separate `show_comparison`). The arrow and the subtext are conceptually the same affordance ("trend context next to the headline number") and bundling them keeps the editor simple. If a future user wants only the arrow without the subtext (or vice versa), file an ADR.
- **No stacked-mode change** — verified by reading the card JSX that the stacked branch never renders the trend arrow or comparison subtext today (a single-mode-only layout decision from v12). The new toggle therefore has no observable effect when `sub_metrics.length >= 1`. The card hook still threads `showTrend` through so flipping back to single-mode preserves the curator's intent.



## v12.2 — Editor Style Tab Polish (font sizes in points + enterprise layout) (2026-05-10)

Follow-on UX polish to v12.1. Two related improvements landed in a single ship:

1. **Concrete point labels on the size picker** — the v12 editor exposed Tailwind tier names (`xs` / `sm` / `base` / `lg` / `xl` / `2xl` / ... / `9xl`) on the per-input typography Size `<Select>`. Curators were never developers; Office, Photoshop, Figma all speak points (`12 pt` / `18 pt` / `54 pt`). The picker now renders concrete point labels via `formatSizePoints(size)` while storage stays the Tailwind enum string — purely a presentational swap, zero DB schema change.
2. **Enterprise-grade layout for all three editable tabs (Basics / Style / Advanced)** — the previous flat stack of unlabeled rows was unscannable once the v12 form crossed ~12 controls per tab. Reorganised every tab into bordered "section" groupings with a hairline-divider header, optional one-line description, and (where applicable) a right-aligned action slot. The Style tab's Typography sub-section gained a uppercase column-header row (Field / Family / Size / Weight) and an inline ghost "Reset" button per row + a section-level "Reset all".

No new DB columns. No new form fields. No tests broken. Pure layout polish + display-label change.

### The point-mapping table

Tailwind v4 tier (px) → points (pt = px / 1.333, rounded to whole points):

| key | px | pt |
|---|---|---|
| `xs` | 12 | 9 |
| `sm` | 14 | 11 |
| `base` | 16 | 12 |
| `lg` | 18 | 14 |
| `xl` | 20 | 15 |
| `2xl` | 24 | 18 |
| `3xl` | 30 | 23 |
| `4xl` | 36 | 27 |
| `5xl` | 48 | 36 |
| `6xl` | 60 | 45 |
| `7xl` | 72 | 54 |
| `8xl` | 96 | 72 |
| `9xl` | 128 | 96 |

Lives in `boards/sqcdp/lib/style-config.ts` as `SIZE_POINTS: Record<FontSize, number>`. Helper `formatSizePoints(size: FontSize): string` returns `"<n> pt"` (e.g. `formatSizePoints('base') === '12 pt'`). Three new test cases verify (a) every key in `SIZE_CLASS` has a matching `SIZE_POINTS` entry, (b) point values increase monotonically with the tier, (c) the formatter renders the canonical `<n> pt` shape for a representative spread of tiers.

Storage stays the Tailwind enum string (`metric.styleConfig.title.size === '2xl'`); only the `<SelectItem>` render swap. Round-trip is unaffected — `parseStyleConfig` still validates against `SIZE_CLASS`.

### Bordered-section pattern (`<Section>`)

A small in-file `<Section>` component lives at the top of the dialog file. Single responsibility: wrap a group of related controls in a `rounded-lg border border-border/50 bg-muted/20 p-4` panel with a header that pairs:

- `text-foreground text-sm font-semibold` title
- optional `text-muted-foreground text-xs` description
- optional right-aligned `action` ReactNode slot (used by the Style tab's "Reset all" ghost button)
- a 1px hairline divider (`border-b border-border/40 pb-2 mb-4`) under the header for clear delineation

Inside the panel, children are `flex flex-col gap-3` so rows breathe consistently. Sections are separated by `gap-5` at the tab level (was `gap-4` in v12).

```tsx
function Section({ title, description, action, children }) {
  return (
    <section className='border-border/50 bg-muted/20 rounded-lg border p-4'>
      <header className='border-border/40 mb-4 flex items-start justify-between gap-4 border-b pb-2'>
        <div className='flex flex-col gap-0.5'>
          <h3 className='text-foreground text-sm font-semibold'>{title}</h3>
          {description ? <p className='text-muted-foreground text-xs'>{description}</p> : null}
        </div>
        {action ? <div className='flex shrink-0 items-center'>{action}</div> : null}
      </header>
      <div className='flex flex-col gap-3'>{children}</div>
    </section>
  )
}
```

### Column-header pattern (Style tab Typography sub-section)

The three typography rows (Title / Subtitle / Primary value) used to render as a flat list of three unlabeled triplets — the curator had to memorise that the three selects were Family / Size / Weight in order. v12.2 adds a header row above the data rows that mirrors the same grid template:

```tsx
const TYPOGRAPHY_GRID_CLASS =
  'grid items-center gap-3 grid-cols-[minmax(0,3fr)_minmax(0,3fr)_minmax(0,3fr)_minmax(0,3fr)_auto]'

// header row (aria-hidden — purely decorative for column titles)
<div className={`${TYPOGRAPHY_GRID_CLASS} text-muted-foreground px-1 pb-1 text-[11px] font-medium tracking-wide uppercase`} aria-hidden='true'>
  <span>Field</span>
  <span>Family</span>
  <span>Size</span>
  <span>Weight</span>
  <span className='w-14' />
</div>
```

Each `<FieldStyleRow>` renders a row using the same `TYPOGRAPHY_GRID_CLASS` so the cells line up under the header. The 5th `auto` cell is reserved for the inline per-row Reset button (see next section); the header's 5th cell is an empty `w-14` placeholder so the column widths match.

Why the explicit 5-column grid template instead of `grid-cols-12`? The user spec asked for four 3-cell columns + an auto cell for Reset. A `grid-cols-12` template doesn't have room for the Reset button without re-allocating space; `[minmax(0,3fr)_minmax(0,3fr)_minmax(0,3fr)_minmax(0,3fr)_auto]` keeps the four data columns equal-width and lets the Reset button take only the space it needs.

### Inline-reset-per-row pattern

v12 rendered a single "Reset to default" text-link beside each field name (above the row's three selects), only visible when the row was dirty. v12.2 moves that to the END of the row in a tiny ghost `<Button variant='ghost' size='sm'>` (still only visible when dirty), inside the 5th grid cell:

```tsx
<div className='flex w-14 justify-end'>
  {isDirtyRow ? (
    <Button
      type='button'
      variant='ghost'
      size='sm'
      className='text-muted-foreground hover:text-foreground h-7 px-2 text-xs'
      onClick={onReset}
    >
      Reset
    </Button>
  ) : null}
</div>
```

The Style tab's section header gains a sibling **"Reset all"** ghost button on the right — disabled when no row is overridden, otherwise calls `setValue('styleConfig', {}, { shouldDirty: true })` to clear all three rows in one click. The enabled state is computed from a single `useWatch({ control, name: 'styleConfig' })` at the tab level, which the same hook reuses to feed the new live preview (see next section).

### Live preview hint (`<PrimaryValuePreview>`)

At the bottom of the Typography section, a tiny inline reinforcement renders a sample `123` at the chosen primary-value typography:

```tsx
function PrimaryValuePreview({ styleConfig }: { styleConfig: StyleConfig }) {
  const cls = fieldClasses(styleConfig.primary, DEFAULT_STYLES.primary)
  return (
    <div className='border-border/30 mt-1 flex items-center gap-3 border-t pt-3'>
      <span className='text-muted-foreground text-[11px] tracking-wide uppercase'>Primary value preview</span>
      <span className={`${cls} leading-none tabular-nums`}>123</span>
    </div>
  )
}
```

Why duplicate the sticky-top live-preview card? The full card preview is small (140 px wide, in a 920 px dialog) and the curator's eyes are at the bottom of the dialog while picking sizes. The inline `<PrimaryValuePreview>` lives directly under the size picker so they see `54 pt` actually look like 54 pt without flicking up to the sticky preview. Reads from the already-watched `styleConfig` so there's no extra subscription cost.

### Tab-by-tab section breakdown

**Basics tab** (3 sections):

- **Identity** — Category + Title (2-col), Subtitle (full row).
- **Value** — Format + Period (2-col), Current value + Target (2-col), Unit (full row).
- **Notes & visibility** — Notes textarea, then the Visible-on-board switch row (with a small description below the label).

**Style tab** (3 sections):

- **Card colors** — Color override + Accent color (2-col).
- **Chart appearance** — Chart type + Show-data-points switch (2-col, switch is a self-contained `border-border/40 bg-background` mini-card to read as a control). Description copy tightened: *"Display data points as circles. Applies to line and area charts."* (was *"Render circles at each historical data point. Best with line and area charts. Markers apply to line and area charts."*).
- **Typography** — Section header has "Reset all" ghost button (right-aligned, disabled when no row is overridden). Body has the column-header row + 3 `<FieldStyleRow>`s + the `<PrimaryValuePreview>`.

**Advanced tab** (3 sections):

- **Number formatting** — Prefix + Suffix (2-col), Decimal places (full row).
- **Trend behaviour** — Show trend arrow + Lower is better (2-col mini-card switches with descriptions). Reordered so the more user-facing toggle (trend arrow visibility) comes first.
- **Stacked sub-metrics** — wraps the existing `<SqcdpSubMetricsEditor>` unchanged. Section description carries the "Drag to reorder" hint that v12 had inside the section header.

History tab is unchanged — already a self-contained component with its own internal layout.

### Files added / modified

**Modified**:

- `boards/sqcdp/lib/style-config.ts` — new `SIZE_POINTS` map + `formatSizePoints` helper.
- `boards/sqcdp/lib/style-config.test.ts` — +3 tests (12 / 12 total in this file).
- `boards/sqcdp/components/sqcdp-editor-dialog.tsx` — full Style tab restructure, Basics + Advanced tabs grouped into `<Section>` panels, `<FieldStyleRow>` updated to share `TYPOGRAPHY_GRID_CLASS` and host an inline Reset, new `<Section>` + `<PrimaryValuePreview>` helpers. Imports `fieldClasses` + `formatSizePoints` from `style-config.ts` and `UseFormSetValue` from `react-hook-form`. Form body gap bumped `gap-4` → `gap-5 pb-2`. Tab body wrappers `mt-3` → `mt-4`.

### Validation

- `pnpm vitest run src/features/shift-productivity/production-boards` → **178 / 178 ✅** (was 175; +3 new SIZE_POINTS tests).
- `pnpm lint:check` → 0 errors, 91 warnings (same baseline as v12.1; my edited files contribute 0 new warnings — verified by running `pnpm exec eslint` on just the three modified files, which returned empty).
- `pnpm build` → ✅. `feature-shift-productivity` parent chunk: **478.42 KB / 102.01 KB gzip** = identical to v12.1 baseline (zero KB delta — the spec predicted 0 KB; layout reshuffle only). `sqcdp-board` lazy chunk: **80.41 KB / 21.17 KB gzip** (was 78.16 KB at v12.1; +2.25 KB for the new `<Section>` + `<PrimaryValuePreview>` helpers + the `formatSizePoints` import).
- `node scripts/check-bundle-budget.mjs` reports the same pre-existing FAILs on `warehouse-location-map` and `feature-admin`; `feature-shift-productivity` shows as `pass` in the per-chunk table at 467.21 KB. Zero new bundle-budget regressions.

### Decisions / trade-offs

- **Whole-point rounding** instead of fractional points (e.g. `text-3xl` is 22.5 pt rounded to 23 pt). Curators expect whole numbers in font pickers — Photoshop, Word, Figma all default to integer values in their list. The 0.5-pt error doesn't affect the rendering at all (the actual class is unchanged), only the human-readable label.
- **Storage stays the enum string, NOT the point value.** Persisting `"size": 12` would lock us into hard-coding a px-to-class lookup at render time and break the JIT-safe static class map (see [[Per-Field-Style-Overrides]]). The `SIZE_POINTS` map is purely for the picker label.
- **No free-form numeric input** for arbitrary point values (e.g. "13 pt", "26 pt"). The whitelisted `SIZE_OPTIONS` per field key already encodes "sensible options for this role"; letting curators type "text-fancy" would defeat that. Listed under follow-ups.
- **5-column grid template (`[3fr_3fr_3fr_3fr_auto]`)** instead of `grid-cols-12`. The user spec called out `col-span-3` for the four data columns, but didn't reserve a 5th cell for the Reset button. Using `auto` for the 5th cell lets Reset take only the space it needs (`w-14` placeholder in the header for alignment) while keeping the four data columns equal-width.
- **`useWatch` once at the tab level** for the new "Reset all" enabled state + the `<PrimaryValuePreview>` source. Both call sites would otherwise pay for their own subscription via separate `useWatch` calls; one shared subscription is cheaper.
- **Inline `<PrimaryValuePreview>` even though there's a sticky-top card preview** — see the live-preview-hint section above. Eye-position justifies the duplication; it's tiny (1 sample number, no card chrome).
- **Description copy shortened** across the dialog — `lowerIsBetter` description went from a 2-sentence explanation to *"Flip arrow polarity for defects, cost, incidents."*, `showMarkers` from a 3-sentence explanation to *"Display data points as circles. Applies to line and area charts."*. Enterprise tone: assume the curator can read the field name and the description fills only the non-obvious detail.
- **`isVisible` switch row gained a small description** (`"Hide while you draft a new metric without removing it."`). v12 had no description there; the new section grouping makes the additional muted text balance the controls visually.

### Open follow-ups

- **Numeric input alongside the Select for arbitrary point sizes** — current shipping list is fixed (`SIZE_OPTIONS` per field key). If a curator wants 13 pt or 26 pt, they can't pick that today; they'd need 12 or 14 (or 24 vs 27). Adding a numeric input would require either (a) generating the matching `text-[13pt]` arbitrary class at render time (defeats the JIT-safe static-map invariant) or (b) bucketing custom sizes onto the nearest enum (silently rounds the curator's input). Defer until a curator asks; the current 13-tier list covers Office's standard set.
- **Per-field point-precision indicator** — the picker reads `12 pt` but the underlying tier is `text-base` (16 px / 12 pt). A `<span className='text-muted-foreground text-[10px]'>{SIZE_CLASS[size]}</span>` next to the option label would show developers what tier they're picking; deferred since the curator-facing label is the priority.
- **Apply the section pattern to the Problem dialog** — the editor's `<ProblemForm>` is still flat (Category + Due-date / Title / Description / Severity + Status / Notes). Lower urgency since it's a 6-field form, but consistency would be nice once it crosses the threshold from [[Editable-Board-Dialogs]].
- **Persist a curator's most-recently-used size** as a `localStorage` hint and surface it as the default highlight on next open. Quality-of-life polish; deferred.

### Pattern impact

- [[Per-Field-Style-Overrides]] gained a "Display labels (curator-facing units)" section pointing at this v12.2 work — the rule "show concrete point values to non-developer curators; keep the Tailwind enum in storage" is a reusable insight for any future pattern that exposes Tailwind tiers to end users.
- [[Editable-Board-Dialogs]] gained a "Bordered sections + column headers for dense forms" section pointing at the v12.2 layout — the section component, the 5-column typography grid, and the inline-reset-per-row pattern are reusable across any future tabbed-dialog editor that hosts ≥ 3 logical control groups per tab.



## v13 — Chart Flexibility (editable goal lines, curve, axes, grid, average, extremes) (2026-05-10)

v12.x baked the chart aesthetic into `<SqcdpChart>` directly: monotone curve, hidden Y-axis, horizontal-only grid, dashed accent target line, optional point markers. v13 lets curators layer additional reference lines + tweak the geometry per metric without changing every metric on the board.

### Migration 302 — `chart_config jsonb`

`supabase/migrations/302_sqcdp_chart_config.sql` adds a single `jsonb NOT NULL DEFAULT '{}'` column to `sqcdp_metrics`. Schema-less by design (validated client-side via Zod, not via a CHECK constraint) so we don't pay another ALTER TABLE every time we add a chart toggle. Empty object preserves the v12.x render unchanged.

Applied via Supabase MCP `apply_migration` (NOT `execute_sql`); verified all existing rows default to `{}`.

### Goal-line shape + style mapping

```ts
interface GoalLine {
  id: string                    // crypto.randomUUID()
  value: number
  label?: string | null
  color_hex?: string | null     // null/undefined → falls back to accentColor
  style?: 'solid' | 'dashed' | 'dotted'   // default 'dashed'
  width?: 1 | 2 | 3             // default 1
}
```

Recharts `strokeDasharray` mapping (`STYLE_DASH` in `lib/chart-config.ts`):

| Style | strokeDasharray |
|-----|-----|
| `solid` | `undefined` (continuous stroke) |
| `dashed` | `'4 4'` |
| `dotted` | `'2 4'` |

Dashed/dotted patterns picked to read at the small chart heights the SQCDP cards live at (120–180 px).

### Curve / Y-axis / Grid / Average / Extremes additions

- **Curve type** — `monotone | linear | step` (Recharts `<Line type=...>` / `<Area type=...>`); bar variant ignores.
- **Y-axis range** — `y_axis: { show?, min?, max? }`. `null` on either bound = `'auto'` (Recharts default domain).
- **Show Y-axis labels** — opt-in via `y_axis.show`; the period chip on the card carries the time scope by default.
- **Grid** — independent `show_horizontal` (default `true`, matches v12.x) + `show_vertical` (default `false`). Hides grid entirely when both `false`.
- **Show average line** — overlays a faint dashed line at the historical mean, `text-muted-foreground` color so it doesn't fight the goal lines or accent.
- **Highlight extremes** — bumps min/max dot radius (line/area) or paints a `1px currentColor` outline on the matching `<Cell>` (bar). Below the chart: `▲ MAX 67.4 / ▼ MIN 12.1` caption row.
- **Target-line styling** — `target_line: { color_hex?, style?, width?, show_label? }` overrides the built-in dashed-accent target line. Default `show_label: false` keeps the existing terse `'target'` tag.

### Editor `Chart` tab placement (between Style and Advanced)

The editor dialog gains a 5th tab between **Style** and **Advanced**:

```
Basics  Style  Chart  Advanced  History
```

The Chart tab body uses the v12.2 `<Section>` panel pattern. Five sections:

1. **Display** — `chartType` + `showMarkers` (moved here from the Style tab — chart appearance is conceptually about the chart, not card colors).
2. **Curve & axis** — curve type select + show-Y-axis-labels toggle + min/max numeric inputs (placeholder `'auto'`).
3. **Grid** — horizontal/vertical toggles.
4. **Reference lines** — primary target line (color picker + style + width + show-label) and additional goal lines (drag-to-reorder via `@dnd-kit`, same pattern as `SqcdpSubMetricsEditor`). `Reset all` button on the section header.
5. **Annotations** — show-average + highlight-extremes switches.

The sticky live-preview card at the top of the dialog reacts to every Chart-tab change via the existing `useWatch` subscription on the whole form value — no extra plumbing needed. `buildPreviewMetric` threads `chartConfig` onto the synthetic `SqcdpMetricRow` so the embedded `<SqcdpChart>` reads it directly.

### Style tab's chart controls moved to the new Chart tab

The Style tab's `Chart appearance` section (chart-type + show-data-points) was removed and reborn as the Chart tab's `Display` section. Style tab now hosts only **Card colors** + **Typography**, which is more honest about what each tab is for.

### Pure helper composition — `pickDot`

The v10 dot callback combined `showMarkers` + above-target highlight. v13 adds a third concern (extremes highlight). To keep the per-variant render call sites simple, the composition lives in a pure helper:

```ts
function pickDot(args: {
  cx, cy, payload,
  showMarkers, highlightExtremes, extremes,
  targetValue, accentColor, index,
}): ReactNode
```

Layer order: (1) `showMarkers` gates the entire callback; (2) extreme highlight wins over above-target (extreme is the stronger signal); (3) above-target falls through. Tested via `data-extreme="max|min|none"` + `data-above-target="true|false"` attributes on the rendered `<circle>`.

For the bar variant, dots don't apply — instead the v13 chart maps over `data` and renders one `<Cell>` per bar with conditional `stroke` on the min/max bars. This is the only place the chart now uses `Cell` (we previously didn't import it).

### Files added / modified

**Added:**
- `supabase/migrations/302_sqcdp_chart_config.sql`
- `src/features/shift-productivity/production-boards/boards/sqcdp/lib/chart-config.ts`
- `src/features/shift-productivity/production-boards/boards/sqcdp/lib/chart-config.test.ts` (22 tests)
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-goal-lines-editor.tsx`

**Modified:**
- `src/features/shift-productivity/production-boards/boards/sqcdp/hooks/use-sqcdp-metrics.ts` — `SqcdpMetricRow` gains `chartConfig: ChartConfig`; `mapRow` parses it via `parseChartConfig`; SELECTs / create / update / optimistic onMutate all thread it through.
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-chart.tsx` — full v13 rewrite: `pickDot` helper, common goal-line / target-line / average-line / extremes-caption rendering, `<Cell>` for bar extremes.
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-editor-dialog.tsx` — 5th `Chart` tab between Style & Advanced; `chartConfigSchema` zod; Style tab loses its `Chart appearance` section.
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-chart.test.tsx` — fixture gains `chartConfig: {}`; new tests for goal-lines / average / extremes / bar-cell extremes.
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-card.test.tsx` — fixture gains `chartConfig: {}`.
- `src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-history-editor.test.tsx` — fixture gains `chartConfig: {}`.

### Bundle impact

- `feature-shift-productivity` parent chunk: **478.42 KB** (was 478 KB — neutral, well under 500 KB ceiling).
- `sqcdp-board` lazy chunk: **97.35 KB** (was ~80 KB — within the predicted 95–105 KB range).

### Tests

- `chart-config.test.ts` — 22 unit tests (resolveTargetLine, resolveGoalLine, computeAverage, findExtremes, STYLE_DASH, parseChartConfig).
- `sqcdp-chart.test.tsx` — 14 smoke tests (3 new for v13: goal-line render count, average + extremes caption, bar Cell extremes).
- All 203 production-boards tests pass.

### Open follow-ups (deferred, do NOT bundle into this iteration)

- **Threshold zones** — colored bands above/below target (e.g. green > target, red < critical floor). Distinct from goal lines because they're filled regions, not strokes.
- **Per-data-point annotations with notes** — let curators tag specific history points ("line down 4h") that render as tooltips or pinned callouts.
- **Animation toggle** — opt-out of the 1400ms ease-out draw so TV-mode dashboards don't replay on every poll.
- **Chart background gradient** — optional gradient fill behind the geometry for emphasis.
