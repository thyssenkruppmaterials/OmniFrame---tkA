---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-05
---
# Stat Card Clickable Filter Pills

## Purpose / Context

User-facing pattern (originally introduced in [[ManualCountsSearch - Inventory Tab]] / `manual-counts-search.tsx`) where each numeric pill inside a stat card doubles as a quick-filter for the table below. Cards become a one-click filter palette: click a pill to scope the table to that subset, click again (or the `Filtered · clear` chip in the header) to clear it.

Applied across the **Inventory Counts** tab and (May 5, 2026) the **Outbound Apps → Delivery Status** and **Outbound Apps → Data Manager** tabs. Reuse this pattern any time a card already shows segmented metrics that map cleanly to existing filter dimensions on the table.

## Visual Anatomy

```
┌─────────────────────────────────────────┐
│  [icon] CARD TITLE     Click to filter  │  ← header (uppercase tracking)
│                                         │
│  ┌─────┐ ┌─────┐ ┌─────┐                │
│  │ 945 │ │ 845 │ │ 100 │                │  ← clickable pill buttons
│  │Open │ │ OE  │ │IRNA │                │
│  └─────┘ └─────┘ └─────┘                │
└─────────────────────────────────────────┘
```

When a pill is active the header chip flips to `Filtered · clear` (clears that card's filter when clicked) and the active pill gains a coloured `ring-2`.

## Implementation Recipe

### 1. State

Use a single source of truth for which pill is active:

```ts
type CardFilter =
  | { type: 'shippingPoint'; value: 'oe' | 'irna' }
  | { type: 'daysOpen'; value: 'over30' | 'over12' | 'over4' }
  | null
const [cardFilter, setCardFilter] = useState<CardFilter>(null)
```

For pages with multiple separate boolean filter modes already wired to the data layer (Outbound Data Manager — `showCriticalOnly`, `showWavedOnly`, `showPickedOnly`, `showShippedOnly`, `showPendingOnly`), derive an `activeStatusFilter` key and route both the dropdown items and the pills through a single `setStatusFilter(key | null)` helper to avoid drift.

### 2. Shared classes

```ts
const pillBase =
  'group/pill relative w-full rounded-lg p-2.5 text-center transition-all ' +
  'duration-200 focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-background cursor-pointer'

// Informational tile (non-clickable, e.g. "Variance", "Picked Today")
const infoTileBase =
  'cursor-default rounded-lg bg-slate-500/5 p-2.5 text-center dark:bg-slate-400/5'
```

Colour palette uses opacity tokens — see [[Dark-Mode-Opacity-Colors]] (`bg-{color}-500/8 hover:bg-{color}-500/15` light, `dark:bg-{color}-500/5` dark, `ring-{color}-500/60` when active).

### 3. Clickable pill

```tsx
<button
  type='button'
  aria-pressed={isActive('critical')}
  onClick={() => toggle('critical')}
  className={cn(
    pillBase,
    'bg-red-500/8 hover:bg-red-500/15 focus-visible:ring-red-500/40 dark:bg-red-500/5 dark:hover:bg-red-500/10',
    isActive('critical') && 'ring-2 ring-red-500/60'
  )}
  title='Filter table to Critical deliveries'
>
  <div className='text-2xl font-bold tracking-tight text-red-600 tabular-nums dark:text-red-400'>
    {count}
  </div>
  <p className='text-muted-foreground mt-0.5 text-[11px] font-medium'>Critical</p>
</button>
```

### 4. Header chip

```tsx
{anyActive ? (
  <button onClick={() => setCardFilter(null)} className='...'>
    Filtered · clear
  </button>
) : (
  <span className='text-muted-foreground/60 text-[10px] font-medium tracking-wider uppercase'>
    Click to filter
  </span>
)}
```

### 5. Filter application

Apply the card filter as a final pass on the already-fetched data inside the existing `sortedAndFilteredData` `useMemo`. When the pill represents rows excluded by the upstream fetch (e.g. TKA Non-Controllable rows excluded by `openOnly`), bypass the upstream filter for that pill:

```ts
openOnly: showOpenOnly && !showJS01Only && cardFilter?.type !== 'tka',
```

Always `setCurrentPage(1)` whenever `cardFilter` changes via a dedicated `useEffect`.

### 6. Mutual exclusivity

One pill at a time. Either drop the previous selection in the toggle (`setCardFilter(curr => curr?.value === v ? null : { type, value: v })`), or use a single `setStatusFilter` helper that flips all booleans at once.

## Informational Tiles

Some metrics don't map to a status filter (date-scoped "today" counters, sum-of-variance values). Render these as static tiles with `infoTileBase` so the visual rhythm of the card is preserved without misleading affordance. Mirrors the **Variance** tile inside the Variance Metrics card on the Inventory Counts tab.

## Where Used

- `src/components/manual-counts-search.tsx` — origin (Inventory Counts tab)
- `src/components/delivery-status-manager.tsx` — Outbound Apps → Delivery Status (May 5, 2026)
- `src/components/outbound-data-manager.tsx` — Outbound Apps → Data Manager (May 5, 2026)

## Related

- [[Dark-Mode-Opacity-Colors]] — opacity-based colour tokens used for pill backgrounds
- [[UI-Component-Conventions]] — broader shadcn/ui composition conventions
- [[Outbound-Stat-Card-Filter-Wiring]] — the May 5, 2026 implementation note covering both Outbound surfaces
