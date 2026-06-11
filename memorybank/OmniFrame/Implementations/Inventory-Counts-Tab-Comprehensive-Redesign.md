---
tags:
  - type/implementation
  - status/active
  - domain/frontend
  - cycle-count
created: 2026-05-01
---
# Inventory Counts Tab — Comprehensive Redesign (2026-05-01)

## Purpose
Comprehensive UX/visual overhaul of the Inventory Management → Inventory Counts tab. Three goals:
1. **Rename** tab from "Manual Counts" → "Inventory Counts".
2. **Make the four statistic cards into clickable filters** that drive the data table below.
3. **Modernize** the Active Operators panel and the middle section between the cards and the table.

## Files Modified
- `src/components/inventory-management.tsx` — tab label rename only (`id` kept as `manual-counts` to preserve the tab-permission row in `tab_permissions`, see migration `034_update_inventory_movements_to_manual_counts.sql`).
- `src/components/manual-counts-search.tsx` — clickable statistic pills + active-filter strip + in-card heading rename.
- `src/components/live-operator-status.tsx` — full rewrite of the Active Operators panel (modern grid + summary tiles + per-operator cards).

## 1. Tab Rename — Backwards-Compatible
- Label only — the `tab_id` (`'manual-counts'`) is referenced from a Postgres migration (`034_…`) and `useTabPermissions`. Touching the id would break per-org tab permissions, deep links, and existing analytics.
- Two strings updated: `inventoryTabs[3].label` and the `<h2>` inside the table card header.

## 2. Clickable Stat Cards → Table Filters
Each pill inside the four statistic cards is now a `<button type='button'>` that **toggles** the matching column filter on the table:

| Card | Pill | Filter applied |
|---|---|---|
| Count Status | Total | clears `status` to `all` |
| Count Status | Pending | `status='pending'` |
| Count Status | Completed | `status='completed'` |
| Variance Metrics | Review | `status='variance_review'` |
| Variance Metrics | Recounts | `status='recount'` |
| Variance Metrics | Variance value | non-clickable (informational sum) |
| Priority Breakdown | Critical | `priority='critical'` |
| Priority Breakdown | Hot | `priority='hot'` |
| Priority Breakdown | Normal | `priority='normal'` |
| Accuracy Metrics | Count Accuracy / Bin Accuracy | non-clickable (computed metrics) |

### Implementation details
- Three new `useCallback` handlers inside `ManualCountsSearch`:
  - `toggleStatusFilter(status)` — toggles status filter, resets pagination + selection.
  - `togglePriorityFilter(priority)` — same for priority.
  - `clearStatusAndPriorityFilters()` — resets both.
- `StatisticsCards` was promoted from a static `useMemo([statistics, …])` to a memo with **the filter state in deps** so the active-pill ring updates instantly.
- Active state visual: `ring-2 ring-{color}-500/60` ring around the pressed pill plus `aria-pressed` for screen readers.
- Header right-rail of each card swaps between `Click to filter` (hint) and `Filtered · clear` (action) when a card-level filter is active.

## 3. Active Card-Filter Strip (new middle-section element)
When any status or priority filter is active, a polished strip renders **between the cards and the operator panel**:
- Left: "Filtering table by" label + chip-per-active-filter (color-coded, click-to-remove with `×`).
- Right: `N of M rows` row counter + "Clear all" ghost button.
- This makes the connection between the clickable cards and the filtered table obvious and provides a one-click escape hatch.

## 4. Active Operators Panel — Full Rewrite
### Old design
List of horizontal rows with avatar + status dot + status badge + map pin + relative time. Empty state was a horizontal dashed strip.

### New design
- **Header bar**: gradient icon tile + "Active Operators" title + subtitle showing `N active · M total tracked`. Top-right: Live/Polling chip with animated ping + refresh button.
- **Summary tile row**: 5-column grid (Busy / Online / Idle / Break / Offline) with colored icons + numbers. Tiles light up only when their count > 0.
- **Operator cards**: 3-column responsive grid (`grid-cols-1 md:grid-cols-2 xl:grid-cols-3`). Each card has:
  - Initials avatar (h-10 w-10) with status-colored ring + status dot overlay (animated ping on busy).
  - Name + small status pill on top.
  - Map-pin location row OR italic placeholder (`Waiting for assignment` / `On break` / `No active task`).
  - Task type pill if present (mono font).
  - Last-seen relative timestamp on the right.
- **Status theme map** (`STATUS_THEME`) centralizes per-status colors so dot, ring, chip, and card border stay in lockstep.
- **Empty state**: rounded dashed card with icon + helpful text (kept simple).

## Patterns Reinforced / Reused
- Opacity-based dual-mode color system: `bg-{color}-500/{opacity}` + `dark:bg-{color}-500/{lower}` (see [[Dark-Mode-Opacity-Colors]]).
- Card chrome: `border-border/50 bg-card/50 backdrop-blur-sm`.
- Aria-pressed + visible ring for toggle buttons.
- `useCallback` for setter helpers consumed inside a `useMemo`-rendered subtree (keeps dep arrays stable).

## Verification
- `npx tsc --noEmit -p tsconfig.app.json` → clean.
- `npx eslint src/components/manual-counts-search.tsx src/components/live-operator-status.tsx src/components/inventory-management.tsx` → 0 errors (8 pre-existing `no-explicit-any` warnings on lines I did not touch).
- `npx vitest run src/components/__tests__/formatDateEST.test.ts src/components/ui/__tests__/tab-menu.test.tsx` → 9/9 pass.

## Related
- [[ManualCountsSearch - Inventory Tab]]
- [[LiveOperatorStatus - Real-Time Panel]]
- [[Redesign-Manual-Counts-Tab-UI]]
- [[Manual-Counts-Column-Filters]]
- [[Dark-Mode-Opacity-Colors]]
