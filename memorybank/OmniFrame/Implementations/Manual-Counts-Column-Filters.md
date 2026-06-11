---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-04-11
---
# Manual Counts — column filters

## Purpose / Context
The Inventory app **Manual Counts** tab (`apps/inventory?tab=manual-counts`) used a global search only; users needed per-column filtering on the main table.

## Details
- **File:** `src/components/manual-counts-search.tsx`
- Added `ManualCountsColumnFilters` state (text inputs + **Priority** and **Status** selects).
- **`columnFilteredData`:** client-side `useMemo` applied after `filteredData` from `useCycleCountOperations` (global search unchanged).
- **`sortedData` / pagination / export** now operate on `columnFilteredData`.
- Second header row under column titles with compact `Input` / `Select` controls; **Clear column filters** in toolbar when any filter active.
- Empty state when column filters exclude all rows: message + clear action.
- Changing column filters resets page and row selection (same pattern as `searchQuery`).

## Related
- [[Components/Manual Counts]] (if present)
- [[Patterns/UI-Component-Conventions]]
