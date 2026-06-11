---
tags:
  - type/component
  - status/active
  - domain/frontend
created: 2026-04-12
updated: 2026-04-12
---
# ManualCountsSearch — Inventory Tab

## Purpose
Primary component for the **Manual Counts** tab within the Inventory Management page (`/apps/inventory?tab=manual-counts`). Provides a full dashboard for managing warehouse cycle counts — statistics overview, live operator tracking, work distribution, and a rich data table with inline filtering.

## Location
`src/components/manual-counts-search.tsx`

## Architecture
- **Statistics Cards** — 4 metric cards (Count Status, Variance Metrics, Priority Breakdown, Accuracy Metrics) rendered via `useMemo` (`StatisticsCards`). Each card uses a 3-column grid layout with rounded pill backgrounds per metric.
- **LiveOperatorStatus** — External component showing real-time operators connected via WebSocket.
- **WorkDistributionPanel** — Conditional panel that appears when table rows are selected; allows supervisor push/release of work.
- **Data Table** — Full-featured table with:
  - Column header row (uppercase tracking-wide labels)
  - Inline filter row beneath headers (per-column text/select filters)
  - Multi-select via checkbox column
  - Row actions dropdown (edit, assign, priority change, recount, approve)
  - Client-side pagination with compact ghost-button style

## Key Dependencies
- `useCycleCountOperations` hook — data fetching, mutations, statistics
- `workServiceWs` — WebSocket connection for real-time updates
- `CycleCountService` — priority colors/labels
- `useUnifiedAuth` — current user context
- Supabase direct calls for approve/delete operations

## Sub-components (inline)
- `AddCountModal` — Legacy manual count creation (deprecated, kept for fallback)
- `EditCountModal` — Baseball-card-style detail modal with tabs for count info, photo placeholder, recount workflow

## Sub-components (external)
- [[LiveOperatorStatus - Real-Time Panel]]
- `WorkDistributionPanel` (`src/components/work-distribution-panel.tsx`)
- `UserAssignmentModal` (`src/components/user-assignment-modal.tsx`)
- `AddCountsFromLX03Modal` (`src/components/add-counts-from-lx03-modal.tsx`)

## Design System Notes (as of 2026-04-12 redesign)
- Cards use `border-border/50 bg-card/50 backdrop-blur-sm` with `group` hover effects
- Icon containers: `h-6 w-6 rounded-md bg-slate-500/10 dark:bg-slate-400/10`
- Labels: `text-[11px] font-medium tracking-wider uppercase text-muted-foreground`
- Metric values: `text-2xl font-bold tabular-nums tracking-tight` inside rounded-lg pill backgrounds
- Status badges: opacity-based `bg-{color}-500/15 text-{color}-700 dark:bg-{color}-500/10 dark:text-{color}-400`
- Table header row: `bg-muted/40` with uppercase column names
- Filter inputs: `h-7 bg-background/50 border-border/30 text-[11px]`
- Alternating rows use `bg-muted/15` at index % 2
- Pagination: ghost buttons, compact `h-7 w-7` with active page using `bg-primary`

## Related
- [[LiveOperatorStatus - Real-Time Panel]]
- [[RFCycleCountServices - Supabase Service]]
- [[RoutingSystem - TanStack Router]]
- [[Redesign-Manual-Counts-Tab-UI]]


## 2026-05-01 — Inventory Counts Comprehensive Redesign
- Tab now labeled **Inventory Counts** in the inventory tabs strip and in the table card header. The underlying `tab_id` remains `manual-counts` (DB-backed permission row in migration 034).
- Statistic cards became **clickable filter palette** for the table: pills inside Count Status / Variance Metrics / Priority Breakdown set/toggle the matching column filter. Active pill shows ring-2 highlight + `aria-pressed`.
- New `useCallback` helpers: `toggleStatusFilter`, `togglePriorityFilter`, `clearStatusAndPriorityFilters`. `StatisticsCards` memo now depends on `columnFilters.status` + `columnFilters.priority`.
- New "Filtering table by" strip renders between cards and operator panel when card filters are active — chips per filter (click × to clear) + row counter `N of M rows` + Clear all button.
- See [[Inventory-Counts-Tab-Comprehensive-Redesign]].



## 2026-05-18 — Fix: Count Status Total Now Matches Pending + Completed
- The `Count Status` card's Total previously included rows in `variance_review` and `approved` that weren't represented by the Pending / Completed pills, so the visible math didn't add up.
- Supabase RPC `get_cycle_count_statistics` regrouped in migration `315_fix_cycle_count_statistics_grouping.sql`:
  - `pendingCounts` = `pending` + `in_progress`
  - `completedCounts` = `completed` + `approved` + `variance_review`
  - `totalCounts` = sum of the two groups (excludes `cancelled`)
- Frontend `columnFilteredData` predicate updated: clicking the Pending / Completed pill expands to the matching group; clicking the Variance Metrics “Recounts” pill now actually filters by `requires_recount = true AND !recount_completed` instead of the dead `status = 'recount'` comparison.
- See [[Fix-Inventory-Counts-Total-Mismatch]].



## 2026-05-19 — Bulk-Import Progress Dialog Added
- The **Import Bulk Counts** prompt now hands off to a non-dismissable progress modal (`<CycleCountImportProgressDialog>`) while `cycleCountService.importFromClipboard` runs.
- Subscribes to `importProgress` from `useCycleCountOperations` (already emitted per-row by the service). Shows `processed / total` percentage bar, inserted / errors / remaining badges, and the last 5 errors inline.
- Escape / click-outside / × are blocked during the loop and a `beforeunload` listener triggers the browser's native "leave site?" confirmation, so users can't silently abandon a half-finished import.
- Local `importProgressDismissed` flag lets the user close via the **Done** button without waiting for the 3 s `setTimeout` in the hook that clears `importProgress` post-completion. The flag resets to `false` whenever a fresh import starts.
- See [[Add-Bulk-Import-Progress-Dialog-Inventory-Counts]].
