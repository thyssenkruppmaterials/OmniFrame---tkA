---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-05-05
---
# Outbound Stat Card Filter Wiring

## Purpose / Context

The **Outbound Apps** surface had two pages with prominent stat cards — **Delivery Status** (`delivery-status-manager.tsx`) and **Data Manager** (`outbound-data-manager.tsx`) — whose numeric pills were static read-outs. The Inventory Apps tab (Inventory Counts) had already shipped the [[Stat-Card-Clickable-Filter-Pills]] pattern where each pill doubles as a quick-filter for the table beneath it. This implementation brings both Outbound pages onto the same affordance so the dashboard cards become interactive filter palettes.

Reported by user May 5, 2026: *"In the outbound apps, in both the delivery status page and data manager page, please update the stat cards to be clickable filters like how it is setup in the inventory apps page, in the inventory counts tab."*

## Details

### Delivery Status Manager (`src/components/delivery-status-manager.tsx`)

Introduced a single `cardFilter` state that drives the table:

```ts
type CardFilter =
  | { type: 'shippingPoint'; value: 'oe' | 'irna' }
  | { type: 'daysOpen'; value: 'over30' | 'over12' | 'over4' }
  | { type: 'tka'; value: 'liftFan' | 'wawf' | 'placeholder' }
  | null
```

4-card layout (now `xl:grid-cols-4`, opacity-based colour palette per [[Dark-Mode-Opacity-Colors]]):

1. **Total Deliveries** — pills: `Open` (clears filter, shows OE+IRNA combined), `OE`, `IRNA`. Filters table on `shipping_point`.
2. **Days Open** — pills: `>30 Days` (red), `>12 Days` (orange), `>4 Days` (amber). Mutually-exclusive aging buckets matching the existing `daysOpenCounts` math.
3. **TKA Non-Controllable** — pills: `LiftFan`, `WAWF`, `TBD` (placeholder). LiftFan/WAWF rows are normally excluded by the upstream `openOnly` query, so the hook is wired to bypass `openOnly` whenever `cardFilter?.type === 'tka'`:

   ```ts
   openOnly:
     showOpenOnly && !showJS01Only && !showDeletedOnly &&
     cardFilter?.type !== 'tka'
   ```

4. **Deliveries PGI** — single-value KPI (calendar IS the filter). Restyled to match the new card chrome but the pill grid is replaced by an info tile + the existing date popover.

New `useEffect` resets `currentPage` to 1 when `cardFilter` changes. `handleClearFilters` also clears `cardFilter`.

### Outbound Data Manager (`src/components/outbound-data-manager.tsx`)

The page already had four boolean filter modes (`showCriticalOnly`, `showWavedOnly`, `showPickedOnly`, `showShippedOnly`) wired to `OutboundTODataService.fetchByStatuses` / `fetchCriticalDeliveries`. Added a fifth (`showPendingOnly`) to support the Pending pill, and consolidated all five behind two helpers so the legacy "More" dropdown and the new pills share the same toggle path:

```ts
type StatusFilterKey = 'critical' | 'pending' | 'waved' | 'picked' | 'shipped'
const activeStatusFilter: StatusFilterKey | null = ...derived from booleans
const setStatusFilter = useCallback((next: StatusFilterKey | null) => {
  setShowCriticalOnly(next === 'critical')
  setShowPendingOnly(next === 'pending')
  setShowWavedOnly(next === 'waved')
  setShowPickedOnly(next === 'picked')
  setShowShippedOnly(next === 'shipped')
  setCurrentPage(1)
}, [])
const toggleStatusFilter = useCallback((key) => {
  setStatusFilter(activeStatusFilter === key ? null : key)
}, [activeStatusFilter, setStatusFilter])
```

Four cards:

1. **Delivery Status** — `Pending` (clickable, amber), `Waved Today` (info tile, date-scoped), `Critical` (clickable, red, pulses when > 0).
2. **Picks Available** — `Waved` (clickable, teal), `Picked Today` (info tile).
3. **Packing Available** — `Picked` (clickable, blue), `Packed Today` (info tile).
4. **Deliveries Shipped Today** — `Shipped` (clickable, purple), `Final Packed Today` (info tile, emerald).

The `fetchStatusFilteredData` `useEffect` now branches on the new `showPendingOnly` mode and calls `service.fetchByStatuses(['pending'], cutoffDate)`. The `filteredData` `useMemo` and the in-page `Clear Filter` button were updated to include `showPendingOnly` everywhere `showCriticalOnly` etc. were referenced. The dropdown menu "More" entries gained a **Pending Only** item and were refactored to call the new `toggleStatusFilter` helper.

### Informational tiles

"Today" pills (Waved Today, Picked Today, Packed Today, Final Packed Today) are date-scoped — they don't map to a status filter — so they render as static `infoTileBase` tiles, the same treatment used for the `Variance` summary in the Inventory Counts tab. This preserves the visual rhythm of the card without false-affordance.

### Removed unused imports

- `delivery-status-manager.tsx`: dropped `Separator` and `Users` after the redesign (replaced by pill grid + new icons including `Clock`).
- `outbound-data-manager.tsx`: dropped `Separator`.

## Quality

- `pnpm tsc -b --noEmit` clean.
- `pnpm exec eslint` clean for both files.
- `pnpm exec prettier --write` applied.
- `pnpm build` succeeds in ~10s; no new bundle-budget violations.
- The two pre-existing `-inset-[1px]` / `inset-[1px]` warnings are inside the unrelated `RustPoweredSearchInput` forwardRef and predate this change.

## Files Touched

- `src/components/delivery-status-manager.tsx` — added `cardFilter` state, applied filter pass in `sortedAndFilteredData`, made hook bypass `openOnly` for TKA pills, rewrote `StatisticsCards` block, dropped unused imports.
- `src/components/outbound-data-manager.tsx` — added `showPendingOnly` state, added `StatusFilterKey` / `setStatusFilter` / `toggleStatusFilter` helpers, threaded `showPendingOnly` through `fetchStatusFilteredData` and `filteredData`, refactored "More" dropdown items, rewrote `StatisticsCards` block, dropped unused `Separator` import.

## Related

- [[Stat-Card-Clickable-Filter-Pills]] — the reusable pattern this implementation establishes
- [[Dark-Mode-Opacity-Colors]] — colour tokens used
- [[ManualCountsSearch - Inventory Tab]] — origin component for the pattern
