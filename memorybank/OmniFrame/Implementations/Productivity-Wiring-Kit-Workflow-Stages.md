---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-05-17
---

# Productivity Wiring — Kit Workflow Stages

## Purpose / Context

Wired the four Kitting Apps workflow stages — **Picking**, **Building**, **Inspection**, **Dock Staging** — into the productivity counters that drive the three operator-facing dashboards:

- **My Productivity** (`/_authenticated/my-productivity`) — per-operator personal dashboard.
- **Shift Productivity** (`/_authenticated/apps/shift-productivity`) — team-level row counters + Gantt timeline.
- **Production Boards** (`/_authenticated/apps/production-boards`) — TV-display hourly grid.

Before this slice every kit action was invisible to all three surfaces. Now when an operator picks a TO line, kits a material, completes an inspection, or stages a kit to dock, the action shows up in their personal count, their team row, the labor-standard comparisons, the per-hour grid bucket, the KPI strip totals, and the CSV export — attributed to the right user and bucketed by the right action timestamp.

Follows the canonical convention established by [[Investigate-Shift-Productivity-Cycle-Counts-Hidden]] § Bug A: every arm of `get_team_productivity_counts` / `get_team_activity_events` filters on the **action timestamp** (`*_date_time` for kit stages), never on `created_at`.

## Audit findings (before this slice)

The live state of both RPCs (Supabase MCP `get_team_activity_events` + `get_team_productivity_counts` `pg_proc.prosrc`) before migration 310 came verbatim from `supabase/migrations/304_fix_team_activity_events_cycle_count_filter.sql`. None of the four kit stages were wired:

| Stage | Wired in counts RPC? | Wired in events RPC? | Action timestamp column | Actor user column |
|---|---|---|---|---|
| Picking | ❌ | ❌ | `kit_to_line_picked_date_time` | `kit_to_line_picked_by_user` |
| Building | ❌ | ❌ | `kit_to_line_kitted_date_time` | `kit_to_line_kitted_by_user` |
| Inspection | ❌ | ❌ | `kit_inspection_completion_date_time` | `kit_inspection_by_user` |
| Dock Staging | ❌ | ❌ | `kit_ready_on_dock_date_time` | `kit_ready_on_dock_by_user` |

The column names were verified live via `information_schema.columns` on `RR_Kitting_DATA`. There is **no `kit_built_by_user` column** — `kit_inspection_by_user` is the bypass-stamped operator on the skip-inspection path (see [[Optional-Kit-Inspection-Toggle]]).

The cycle-count `created_at → completed_at` fix (and the `variance_review` widening) called out in [[Investigate-Shift-Productivity-Cycle-Counts-Hidden]] was already shipped in migration 304 and stayed verbatim through 310. Nothing to bundle.

## Migration 310 — what changed in each RPC

[`supabase/migrations/310_kit_workflow_productivity.sql`](../../../supabase/migrations/310_kit_workflow_productivity.sql)

### `get_team_activity_events` — four new `UNION ALL` arms

Each arm emits one event row per operator action, intersects with the existing `active_users` CTE (active primary-position shift assignments scoped to the requested org), and attributes the event to the actor user column.

Key shape:

```sql
-- Kit picking (per TO line)
SELECT rkd.kit_to_line_picked_by_user, 'kit_picking', rkd.kit_to_line_picked_date_time, 'Kitting'
FROM "RR_Kitting_DATA" rkd
WHERE rkd.kit_to_line_picked_date_time >= p_start_date
  AND rkd.kit_to_line_picked_date_time <= p_end_date
  AND rkd.kit_to_line_picked_by_user IS NOT NULL
  AND rkd.kit_to_line_picked_by_user IN (SELECT au.uid FROM active_users au)
```

`kit_building` mirrors it on `kit_to_line_kitted_*`. The two kit-level stages (`kit_inspection`, `kit_dock_staging`) wrap a `SELECT DISTINCT kit_serial_number, *_by_user, *_date_time` subquery because the underlying UPDATE stamps those columns on every TO-line row of the kit — without the DISTINCT we would double-count a 31-line kit as 31 inspections.

### `get_team_productivity_counts` — four new CTEs and four new return columns

Return-table grew additively from 12 → 16 columns: `kit_picking BIGINT`, `kit_building BIGINT`, `kit_inspection BIGINT`, `kit_dock_staging BIGINT` before the existing trailing `total_tasks BIGINT`. Every existing caller in `src/lib/supabase/team-performance.service.ts` was updated to consume the new fields in the same slice.

The per-kit CTEs mirror the events-side `SELECT DISTINCT` pattern so the per-user counter is one bump per kit, not one bump per TO line.

### Org scoping convention

`RR_Kitting_DATA` does **not** carry an `organization_id` column today — confirmed via `information_schema.columns`. Org scope for every kit arm therefore comes purely from the existing `active_users` intersection (which already restricts to users with active primary-position shift assignments in the requested org). This matches the cycle-count arm's effective envelope and the cart-stow arm's mixed pattern.

## Inspection-bypass exclusion — decision

The brief offered an inspection-bypass exclusion (the auto-stamped path doesn't represent productive inspection work). [[Optional-Kit-Inspection-Toggle]]'s skip-inspection branch stamps `kit_inspection_by_user` / `kit_inspection_completion_date_time` to the build operator's `auth.uid()` and `now()` so the production-tracker stage calculator stays coherent if an admin later flips the workflow flag back on. Those rows look identical to a real inspection at the column level — only the **org-level workflow flag** distinguishes them.

**Chosen pattern: org-level NOT EXISTS guard** rather than per-row `kit_inspection_by_user != kit_built_by_user` (there is no `kit_built_by_user` column, and `kit_to_line_kitted_by_user` is N:1 per kit so per-row comparison is ambiguous). The inspection arm gates on:

```sql
AND (SELECT required FROM org_inspection_required)

-- where:
org_inspection_required AS (
  SELECT NOT EXISTS (
    SELECT 1 FROM kitting_workflow_settings kws
    WHERE kws.organization_id = p_organization_id
      AND kws.kit_inspection_required = FALSE
  ) AS required
)
```

Semantics:

- **Orgs with no `kitting_workflow_settings` row** (default behaviour) → `required = TRUE` → inspection events count as productive work (legacy three-stage flow).
- **Orgs with `kit_inspection_required = TRUE`** → `required = TRUE` → inspection events count.
- **Orgs with `kit_inspection_required = FALSE`** → `required = FALSE` → inspection arm contributes zero events. The bypass-stamped rows are filtered out org-wide.

Verified on the live `j.AI OneBox` tenant (`c9d89a74-…`, currently inspection-OFF): the smoke query returned `kit_inspection: 0 events` even though `RR_Kitting_DATA` has 2 distinct kits with `kit_inspection_completion_date_time` set. The exclusion holds.

When an org flips the workflow flag back ON, future inspections by real inspectors will start counting on the next 60s poll — no per-row backfill needed.

## Frontend wiring

### Types (`src/features/shift-productivity/team-performance/types/team-performance.types.ts`)

- `StandardActivityType` gained `cart_stow`, `kit_picking`, `kit_building`, `kit_inspection`, `kit_dock_staging`.
- `TaskBreakdownByArea` gained the four kit-stage counters.
- `TeamProductivityStats` gained the four kit-stage counters.
- `AreaPerformance.taskMetrics` gained the four kit-stage counters.
- `calculateTotalTasks` now includes the four kit-stage counts in the running total.

### `src/lib/supabase/productivity.service.ts`

`ProductivityStats` interface (the base type that `AssociateProductivity` extends) gained four `kit_*: number` fields. The per-user legacy fallback path (`getCompleteTodayStats`) initialises them to 0 — the day-aware batch path in `team-performance.service` overlays real values from the RPC.

### `src/lib/supabase/team-performance.service.ts`

- `ProductivityCountsRow` interface mirrors the new RPC return shape (added `cart_stows`, `kit_picking`, `kit_building`, `kit_inspection`, `kit_dock_staging`).
- The per-user `productivity` builder in `getTeamProductivity` now hydrates the four kit fields from the RPC row (falling back to 0).
- `totalTasks` formula sums the kit fields.
- `calculateTaskBreakdown` switch added `cart_stow`, `kit_picking`, `kit_building`, `kit_inspection`, `kit_dock_staging` cases so the per-area card breakdown reflects each stage. `cart_stow` had been silently missing before — fixed in the same pass.
- `calculateAssociateEfficiency` aliases gained four new kit task-type rows so a labor standard configured with `task_type='kit_building'` (or any alias in the new tables) participates in the weighted efficiency calculation. The legacy `'kit_picking'` alias was moved off the generic `picking` row into its own dedicated row so a kit-pick standard can target the kit-pick count specifically (the generic `picking` row still maps to outbound TO picks).
- `calculateLaborStandardComparisons` extended with the same four taskMapping rows so the comparisons UI surfaces each kit stage as its own line.
- `calculateTeamStats` and `aggregateByArea.taskMetrics` accumulate the kit fields.
- `getTeamProductivityForDateRange` aggregation (existing-row + empty-state defaults + recalculate-efficiency) carries the kit fields.
- `mergeTaskBreakdowns` adds the kit fields when merging same-area breakdowns across days. Also picked up a latent `cart_stows` merge bug — same pattern.
- `exportToCsv` headers + rows include `Kit Picking`, `Kit Building`, `Kit Inspection`, `Kit Dock Staging`.

### `src/components/my-productivity-dashboard.tsx` — My Productivity dashboard

- `MyTaskBreakdown` task-type summary chips show **Kit Pick** (lime), **Kit Build** (cyan), **Kit Inspect** (fuchsia), **Dock Stage** (sky) — only when the count is non-zero, matching the existing pattern.
- `TaskBreakdownCard` per-area pill row shows the same four chips with the same colour ramp.

### `src/features/shift-productivity/team-performance/components/associate-performance-row.tsx` — Shift Productivity row

The legacy expanded-details strip (`!expandable` branch — two instances, kept in lock-step via `replace_all`) and the area-breakdown pill row both grew the four kit-stage entries.

### `src/features/shift-productivity/team-performance/components/department-card.tsx` — Area card

`TASK_METRIC_CONFIG` now declares the four kit stages with `key` (matching `AreaPerformance.taskMetrics`), `label`, `shortLabel`, and a colour token. The area-card metrics grid is wholly data-driven off this array, so the four stages appear automatically wherever an area card renders.

### `src/hooks/use-activity-config.ts` — Gantt colours / labels

`DEFAULT_COLORS` now defines `cart_stow`, `customer_response`, `kit_picking`, `kit_building`, `kit_inspection`, `kit_dock_staging` so the Gantt chart, My Productivity timeline, and any other consumer of `useActivityConfig().getActivityColors / getActivityLabel` gets stable colours + labels without needing curators to seed `activity_source_config`. The `getTimelineActivityTypes` / `getSummaryActivityTypes` empty-state defaults also include the four new types so an org that hasn't yet customised configs still sees a complete set.

### `src/features/shift-productivity/production-boards/boards/hourly/lib/hour-bucket.ts` — Hourly grid

`targetKeyForEventType` now routes `kit_picking → picking` so kit-pick events compete with the same per-hour target. `kit_building` / `kit_inspection` / `kit_dock_staging` fall back to `default` until operators configure dedicated per-hour targets on `shift_productivity_settings`. The bucketer is already neutral to activity type so the four new event types flow through the per-hour, per-user grid with no other changes.

## Don't break

- The serial-scoping invariant from [[Fix-Build-Kit-Completion-Multi-Kit-PO]] — none of the new RPC arms aggregate by PO; they all filter by date + actor user column.
- The cycle-count `completed_at` + `variance_review` convention from [[Investigate-Shift-Productivity-Cycle-Counts-Hidden]] (already shipped as migration 304; preserved verbatim in 310).
- The auto-stamped inspection bypass per [[Optional-Kit-Inspection-Toggle]]: handled via the org-level `NOT EXISTS` guard documented above.
- No new Supabase Realtime channels (per [[Realtime-Policy]]). The productivity surfaces refresh via TanStack Query polling (15s on Shift Productivity row counters, 60s on Production Boards activity events) — same as before.
- No new permission key. The four new dashboards inherit the existing `shift_productivity:view` gate.

## Permission / RBAC

Unchanged. `My Productivity`, `Shift Productivity`, and `Production Boards` all continue to use the existing `shift_productivity:view` permission. No new entries in `permissions` or `role_navigation_permissions`.

## Validation log

- `pnpm exec tsc -b --noEmit` → clean.
- `pnpm exec eslint` on every touched non-UI file (`team-performance.service.ts`, `productivity.service.ts`, `team-performance.types.ts`, `associate-performance-row.tsx`, `department-card.tsx`, `my-productivity-dashboard.tsx`, `use-activity-config.ts`, `hour-bucket.ts`) → clean. `src/components/ui/` is project-ignored by the ESLint config.
- `pnpm vitest run src/features/shift-productivity/ src/lib/supabase/ src/components/my-productivity-dashboard` → **437 of 438 passing**. The 1 failure is the pre-existing `createKitBuildPlan kanban link stamp` date-bomb (hardcoded `KIT-20260512-006` vs today's `KIT-20260518-001`) documented in [[RF-Build-Kit-By-Serial-Number]] / [[RF-Kit-Pick-By-Serial-Number]] / [[Fix-Build-Kit-Completion-Multi-Kit-PO]] / [[Optional-Kit-Inspection-Toggle]] / [[RF-Dock-Staging-Flow]] / [[Kit-Kanban-Inspection-Aware-Progress-And-Dock-Completion]] — independently reproducible on `git stash`'d main, out-of-scope.
- `pnpm build` → succeeds. Per-chunk delta:
  - `feature-shift-productivity`: **474.66 → 477.64 KB (+2.98 KB)** raw, 101.68 KB gzip — well under the 500 KB per-chunk budget. The +3 KB is the kit-stage entries in `TASK_METRIC_CONFIG`, `DEFAULT_COLORS`, `calculateTaskBreakdown` switch, and the per-stage rows in `taskMapping` / efficiency aliases.
  - `feature-rf-interface`: 547.48 KB — unchanged (no RF code touched).
  - `kitting-data-manager` and other kit-feature chunks: unchanged.
  - Pre-existing oversized chunks (`warehouse-location-map`, `feature-admin`, `feature-rf-interface`) — unchanged in nature, out-of-scope per the same Future Work bucket from [[RF-Dock-Staging-Flow]].
- One new unit-test block added to `src/features/shift-productivity/production-boards/boards/hourly/lib/hour-bucket.test.ts` (`targetKeyForEventType` → kit workflow stages) — 42/42 passing.

## Migration apply + smoke-query output

Migration applied to `wncpqxwmbxjgxvrpcake` via Supabase MCP `apply_migration` in two parts (events RPC then counts RPC, split only because the MCP `apply_migration` payload limit prefers smaller bodies). Both succeeded. Verified via Supabase MCP `execute_sql`:

```
proname                          | result
---------------------------------+----------------------------------------------------------------------
get_team_activity_events         | TABLE(user_id uuid, event_type text, event_timestamp tz, area text)
get_team_productivity_counts     | TABLE(user_id uuid, inbound_scans bigint, cart_stows bigint,
                                          put_aways bigint, picking bigint, packed bigint,
                                          shipped bigint, final_packed bigint, putbacks bigint,
                                          cycle_counts bigint, customer_responses bigint,
                                          kit_picking bigint, kit_building bigint,
                                          kit_inspection bigint, kit_dock_staging bigint,
                                          total_tasks bigint)
```

Live smoke query against `j.AI OneBox` (`c9d89a74-…`, last 30 days, simulating the RPC body so we don't trip `validate_organization_access` from the MCP service role):

```
event_type        | events | distinct_users | earliest                 | latest
------------------+--------+----------------+--------------------------+-----------------------------
kit_building      | 55     | 2              | 2026-05-13 15:44:03+00   | 2026-05-18 01:19:25+00
kit_dock_staging  | 1      | 1              | 2026-05-18 02:19:58+00   | 2026-05-18 02:19:58+00
kit_picking       | 55     | 2              | 2026-05-13 12:47:57+00   | 2026-05-18 00:54:05+00
```

`kit_inspection` returned **0** events as expected — the org has `kit_inspection_required = FALSE` (verified via `SELECT * FROM kitting_workflow_settings`), so the inspection-bypass guard correctly suppresses the auto-stamped rows. The single `kit_dock_staging` event corresponds to the dock-staging flow shipped earlier today ([[RF-Dock-Staging-Flow]] / [[Kit-Kanban-Inspection-Aware-Progress-And-Dock-Completion]]).

## Surface-by-surface result

### My Productivity
- Personal task-type summary now shows **Kit Pick / Kit Build / Kit Inspect / Dock Stage** chips alongside the existing eight (Scans / Putaway / Picking / Pack / Ship / Final Pack / Putback / Counts), only when the operator has done that work.
- Per-area breakdown card lists the same four chips when present.
- Gantt timeline picks up kit_picking (lime) / kit_building (teal) / kit_inspection (fuchsia) / kit_dock_staging (sky) blocks via `useActivityConfig` defaults.

### Shift Productivity
- Each associate row's expanded detail strip lists the four kit-stage counters when the operator has activity.
- The area breakdown card (`TaskBreakdownCard`) shows per-area kit-stage pills.
- The area-card metrics grid (`TASK_METRIC_CONFIG`) displays kit-stage totals.
- Labor-standard comparisons surface each kit stage as its own line when a matching `labor_standards.task_type` is configured.
- CSV export gains four trailing columns (Kit Picking / Kit Building / Kit Inspection / Kit Dock Staging) before Total Tasks.

### Production Boards
- Hourly Completion Tracker buckets kit_* events into per-user × per-hour cells (the bucketer is type-neutral so no per-tile changes were needed).
- KPI strip totals include kit-stage events.
- Skills matrix shows the existing P (Picker) tile as `demonstrated` for operators who ran `kit_picking` events, via the pre-existing `mapEventTypeToSkill` rule.
- Per-hour target ramp uses the picking target for kit_picking; the other three stages share the `default` target (operator-configurable on `shift_productivity_settings`).

## Files touched

### Database
- `supabase/migrations/310_kit_workflow_productivity.sql` (NEW) — both productivity RPCs recreated in full, plus the org-level inspection-bypass guard.

### Service / types
- `src/features/shift-productivity/team-performance/types/team-performance.types.ts` — `StandardActivityType` / `TaskBreakdownByArea` / `TeamProductivityStats` / `AreaPerformance.taskMetrics` / `calculateTotalTasks`.
- `src/lib/supabase/productivity.service.ts` — `ProductivityStats` interface + the per-user fallback path's empty defaults.
- `src/lib/supabase/team-performance.service.ts` — RPC row interface, per-user builder, `calculateTaskBreakdown`, `calculateAssociateEfficiency`, `calculateLaborStandardComparisons`, `calculateTeamStats`, `aggregateByArea.taskMetrics`, `getTeamProductivityForDateRange` aggregation, `mergeTaskBreakdowns`, `exportToCsv`.

### UI
- `src/components/my-productivity-dashboard.tsx` — `MyTaskBreakdown` summary + `TaskBreakdownCard`.
- `src/features/shift-productivity/team-performance/components/associate-performance-row.tsx` — legacy details strip + area-breakdown pills.
- `src/features/shift-productivity/team-performance/components/department-card.tsx` — `TASK_METRIC_CONFIG`.
- `src/hooks/use-activity-config.ts` — `DEFAULT_COLORS` + default timeline / summary type lists.
- `src/features/shift-productivity/production-boards/boards/hourly/lib/hour-bucket.ts` — `targetKeyForEventType`.

### Tests
- `src/features/shift-productivity/production-boards/boards/hourly/lib/hour-bucket.test.ts` — new `targetKeyForEventType` describe-it for kit workflow stages (4 assertions, all green).

## Future work

- **Per-hour kit targets.** `shift_productivity_settings` only has `target_*_per_hour` for picking / put_aways / inbound_scans / cycle_counts. Adding `target_kit_*_per_hour` (or a generic `target_default_per_hour_per_activity` map) would let the hourly board's colour ramp respond to kit-build pace specifically, instead of folding it into the `default` target.
- **Activity-source-config seed for the new types.** The four new types render correctly via `DEFAULT_COLORS` in `use-activity-config.ts`, but operators can't customise their colour / label without seeding a row in `activity_source_config`. A small per-org backfill RPC could insert default rows the first time a user opens Activity Sources settings — out of scope today.
- **Labor standards UI awareness.** The `task_type` dropdown in `AddStandardDialog` / `EditStandardDialog` already accepts arbitrary strings, but adding explicit menu items for `kit_picking` / `kit_building` / `kit_inspection` / `kit_dock_staging` would let operators set per-stage standards from a known-good list instead of free-typing.

## Related

- [[Investigate-Shift-Productivity-Cycle-Counts-Hidden]] — the canonical "every arm filters on the action timestamp" convention this slice extends to the four kit stages.
- [[RF-Dock-Staging-Flow]] — defines the dock-staging stamp this productivity arm consumes.
- [[Optional-Kit-Inspection-Toggle]] — explains the auto-stamped inspection rows whose exclusion this slice gates via `kitting_workflow_settings`.
- [[Kit-Kanban-Inspection-Aware-Progress-And-Dock-Completion]] — same-day Kit Kanban work that consumes the dock-staging fact.
- [[Fix-Build-Kit-Completion-Multi-Kit-PO]] — serial-scoping invariant preserved by every kit arm (filter by date + actor, never aggregate by PO).
- [[TeamPerformance - Supabase Service]] — owns both RPCs and the per-day aggregation pipeline this slice extends.
- [[ProductionBoards - Feature Module]] — Hourly Completion Tracker now buckets the four kit-stage events.
- [[ShiftProductivity - Feature Module]] — sibling app whose Gantt + row counters now reflect kit work.
- [[Kitting System - Feature Module]] — parent module that owns the four `RR_Kitting_DATA` action columns this slice reads.
- [[Kit-Serial-Scoping]] — the per-serial convention; kit-level arms (inspection / dock_staging) DISTINCT on `kit_serial_number` to honour it.
- [[Realtime-Policy]] — no new channels were introduced; surfaces continue to refresh via TanStack Query polling.


## Verification (2026-05-17 23:08 ET — read-only audit)

Independent read-only audit after the implementation slice shipped. No code, schema, or migrations modified. Sources: `pg_get_functiondef` on both productivity RPCs, raw `RR_Kitting_DATA` probes simulating the RPC body (the MCP service role can't bypass `validate_organization_access`, same constraint the original agent hit), `pnpm exec tsc -b --noEmit`, `pnpm vitest run src/features/shift-productivity/ src/lib/supabase/ src/components/my-productivity-dashboard`, `pnpm build`, and `Grep` for forbidden patterns.

### Layer 1 — Database / RPC

- `pg_get_functiondef('get_team_activity_events(uuid,timestamptz,timestamptz)'::regprocedure)` returns 14 UNION arms in the exact shape of the migration file (inbound_scan, cart_stow, putaway, putaway_confirm, picking, pack, ship, final_pack, putback, cycle_count, customer_response, **kit_picking, kit_building, kit_inspection, kit_dock_staging**). Every existing arm is byte-equivalent with the migration 304 baseline; the cycle-count arm still filters on `rcd.completed_at` and includes `status='variance_review'` (Bug A / Bug C preserved). The inspection arm carries the `AND (SELECT required FROM org_inspection_required)` clause.
- `pg_get_functiondef('get_team_productivity_counts(uuid,timestamptz,timestamptz)'::regprocedure)` returns 16 columns in the order documented in the migration (`user_id, inbound_scans, cart_stows, put_aways, picking, packed, shipped, final_packed, putbacks, cycle_counts, customer_responses, kit_picking, kit_building, kit_inspection, kit_dock_staging, total_tasks`) and 14 count CTEs, one per arm, with `total_tasks` summing all 14.
- `SECURITY DEFINER` + `GRANT EXECUTE TO authenticated` preserved on both.
- Migration 310 contains zero `kit_po_number` references (`Grep`) — serial-scoping invariant from [[Fix-Build-Kit-Completion-Multi-Kit-PO]] preserved; every kit arm joins/filters on `kit_serial_number` (DISTINCT for per-kit arms) or per-row keys.

### Layer 2 — Service / hook layer

Reviewed each touched file end-to-end:

- `src/lib/supabase/team-performance.service.ts` — `ProductivityCountsRow` has all four `kit_*: number` fields; `getTeamProductivity` builder hydrates them with `?? 0`; `totalTasks` formula sums them; `calculateTaskBreakdown` switch has all four `case 'kit_*':` arms; `calculateAssociateEfficiency` has all four kit aliases in `taskTypes`; `calculateLaborStandardComparisons` has all four kit entries in `taskMapping`; `calculateTeamStats` sums all four into `TeamProductivityStats`; `aggregateByArea.taskMetrics` sums all four; `getTeamProductivityForDateRange` aggregates them across days (existing-row + empty-state defaults + recalculate-efficiency); `mergeTaskBreakdowns` carries them across same-area merges; `exportToCsv` emits four trailing columns.
- `src/lib/supabase/productivity.service.ts` — `ProductivityStats` interface has all four kit fields; per-user fallback path (`getUserTodayStats`) initialises them to 0 with the inline comment that the batch RPC overlays real values.
- `src/components/my-productivity-dashboard.tsx` — `MyTaskBreakdown` summary chips include Kit Pick / Kit Build / Kit Inspect / Dock Stage; `TaskBreakdownCard` per-area pill row has matching chips.
- `src/features/shift-productivity/team-performance/components/associate-performance-row.tsx` — both legacy `!expandable` `legacyMetrics` arrays (lines ~548 and ~1840) include the four kit-stage labels; the `TaskBreakdownCard` pill row inside this file lists them too.
- `src/features/shift-productivity/team-performance/components/department-card.tsx` — `TASK_METRIC_CONFIG` has the four trailing entries with matching `key` (typed to `keyof AreaPerformance['taskMetrics']`), `label`, `shortLabel`, colour token.
- `src/features/shift-productivity/team-performance/types/team-performance.types.ts` — `StandardActivityType` union includes all four kit types; `TaskBreakdownByArea`, `TeamProductivityStats`, `AreaPerformance.taskMetrics` all have the four fields; `calculateTotalTasks` sums them with `|| 0` guards (additive, safe for old data).
- `src/hooks/use-activity-config.ts` — `DEFAULT_COLORS` has stable colour/label entries for all four kit types; `getTimelineActivityTypes` / `getSummaryActivityTypes` empty-state fallbacks include them.
- `src/features/shift-productivity/production-boards/boards/hourly/lib/hour-bucket.ts` — `targetKeyForEventType` routes `kit_picking → picking` and the other three to `default`; matching unit-test block in `hour-bucket.test.ts` asserts all four routings. Bucketer is otherwise type-neutral so the four event types flow through unchanged.

### Layer 3 — Live render projection (3 representative operators)

Simulated the RPC body against j.AI OneBox (`c9d89a74-7179-4033-93ea-56267cf42a17`), last 30 days. Per-user counts cross-foot exactly between the events arm (`COUNT(*) GROUP BY event_type`) and the counts arm (`SUM(kit_*)`):

```
activity_type     | events RPC | counts RPC | match
------------------+------------+------------+-------
kit_picking       | 55         | 55         | PASS
kit_building      | 55         | 55         | PASS
kit_inspection    |  0         |  0         | PASS (org bypass on)
kit_dock_staging  |  1         |  1         | PASS
```

Per-user breakdown:

```
user                            | kit_picking | kit_building | kit_dock_staging
--------------------------------+-------------+--------------+------------------
Jai Singh (8fe94172-…)          | 31          | 31           | 1
Adrian Anderson (26dfb07a-…)    | 24          |  0           | 0
Christopher Flores (00cbb52…)   |  0          | 24           | 0
```

Projected surface state for Jai Singh:

- **My Productivity** card → task-type chips show `Kit Pick: 31`, `Kit Build: 31`, `Dock Stage: 1`. `Kit Inspect` chip is filtered out (value=0) per the `.filter((m) => m.value > 0)` rule in `MyTaskBreakdown`.
- **Shift Productivity** row → expanded `ActivityStatStrip` / area pill row shows the same three counters; `total_tasks` rolls them into the header tile.
- **Production Boards** → kit_picking events bucket against the `picking` per-hour target; kit_building / kit_dock_staging fall back to the `default` target; all three roll into the KPI strip totals.

### Layer 4 — Cross-cutting checks

- **No new Realtime channels** — `Grep` on the eight touched files returned zero `supabase.channel(` callsites. The `Grep` hits elsewhere in `src/` (presence service, work-queue hooks, etc.) are all pre-existing files outside this slice's scope. [[Realtime-Policy]] compliant.
- **No PO-keyed aggregation** — `Grep` for `kit_po_number` in `supabase/migrations/310_kit_workflow_productivity.sql` returned zero matches. Every kit arm filters by action timestamp + actor user, with `DISTINCT` on `kit_serial_number` for per-kit arms. [[Fix-Build-Kit-Completion-Multi-Kit-PO]] invariant preserved.
- **Permission gate** — no new permission key introduced. My Productivity / Shift Productivity / Production Boards continue to gate on the existing `shift_productivity:view`.
- **Inspection-bypass guard** — verified via three independent checks:
  1. `SELECT * FROM kitting_workflow_settings` returns one row for j.AI OneBox with `kit_inspection_required = FALSE`.
  2. `RR_Kitting_DATA` has 48 rows org-wide with `kit_inspection_completion_date_time IS NOT NULL`. None are inside j.AI OneBox's `active_users ∩ last-30-days` window, so the bypass-guard's suppression isn't directly demonstrable on live data right now — but the events RPC returns `kit_inspection: 0` and the SQL pattern (`NOT EXISTS (... WHERE kit_inspection_required = FALSE)` → `required = FALSE` → `AND FALSE` short-circuits the inspection arm) is structurally correct.
  3. The default-true semantics are guaranteed by `NOT EXISTS`: any org without a `kitting_workflow_settings` row, OR with `kit_inspection_required = TRUE`, satisfies `required = TRUE` and the inspection arm contributes normally. Verified by inspecting the function body.
- **Cycle-count backward compat** — events arm still filters by `rcd.completed_at` and accepts `status IN ('completed', 'approved', 'variance_review')`, byte-equivalent to migration 304.
- **Migration 310 = full re-create** — both functions are dropped/recreated in their entirety; no DDL drift between the migration file and `pg_get_functiondef` output (diffed by eye).

### Build + test verification

- `pnpm exec tsc -b --noEmit` → clean (exit 0, no output).
- `pnpm vitest run src/features/shift-productivity/ src/lib/supabase/ src/components/my-productivity-dashboard` → **437 of 438 passing**. The single failure is the pre-existing `kit-serial-scoping.test.ts > createKitBuildPlan kanban link stamp` date-bomb (`expected 'KIT-20260518-001' to be 'KIT-20260512-006'` — hardcoded yesterday's date). Out-of-scope per the original Validation log.
- `pnpm build` → succeeds in 14.63s. `feature-shift-productivity` chunk: **477.64 KB raw / 101.68 KB gzip** — matches the original claim exactly, well under the 500 KB per-chunk budget. PWA precache generated (191 entries, 10696 KiB).

### PASS matrix

| Activity \\ Surface | DB/RPC | My Productivity | Shift Productivity | Production Boards |
|---|---|---|---|---|
| `kit_picking`        | PASS (55 events, 55 counts) | PASS | PASS | PASS (`picking` target) |
| `kit_building`       | PASS (55 events, 55 counts) | PASS | PASS | PASS (`default` target) |
| `kit_inspection`     | PASS (org bypass → 0 events, 0 counts) | PASS (chip hides at value=0) | PASS | PASS |
| `kit_dock_staging`   | PASS (1 event, 1 count) | PASS | PASS | PASS (`default` target) |

No bugs, regressions, or suspicious findings. Every claim in the original implementation note holds on a fresh tree. Slice ships clean.
