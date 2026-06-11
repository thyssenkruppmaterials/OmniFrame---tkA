---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-16
---

# Responsive StatTile and KpiGrid

## Purpose / Context

Dashboard KPI tiles that resize correctly inside **any** container width.

Introduced 2026-05-16 to fix the `/apps/inventory` Inventory Counts "Variance 25074" clipping bug: a six-digit number was being painted under the left rail because every KPI tile in the strip used a fixed `text-3xl` value and the surrounding flex chain was missing `min-w-0`. The standard CSS escape hatch (`overflow-x-auto` on the page) was the *wrong* fix because it hid the page chrome — the right fix is to make the tile itself shrink-aware.

`<StatTile>` + `<KpiGrid>` are the canonical primitives going forward for any new KPI strip. They live in `src/components/ui/` so they're available everywhere without per-feature copy-paste.

## When to use

✅ Use `<StatTile>` + `<KpiGrid>` when:

- You need a row of 2–6 numeric KPIs that should reflow as the *container* (not the viewport) shrinks — e.g. embedded inside a split pane, a sidebar, or a workbench column.
- The values can grow unpredictably (counts, currency, deltas) and you can't promise they'll fit at every viewport width.
- You're inside a feature that doesn't need the full "premium dashboard" treatment from [[Elevated-KPI-Stat-Cards]] — `StatTile` is the **utilitarian** primitive; `Elevated-KPI-Stat-Cards` is the **hero** recipe.

❌ Don't use these primitives for:

- TV-density / hero KPI strips at the top of a dashboard — use [[Elevated-KPI-Stat-Cards]] for the multi-stop shadow stack, hover lift, mount stagger, and accent line system.
- Categorical performance scorecards with colored header strips (SQCDP-style) — that's the Variant section in [[Elevated-KPI-Stat-Cards]].
- A single-section page that just needs one Card — drop in a regular `<Card>` instead.

The two patterns are complementary: `<KpiGrid><StatTile/></KpiGrid>` is the everyday workhorse; the elevated recipe is the formal occasion. If a feature graduates from one to the other later, swap the inner tile component — the grid wrapper stays the same shape.

## API surface

### `<StatTile>`

```tsx
import { StatTile } from '@/components/ui/stat-tile'

<StatTile
  label='Variance'
  value={25074}
  hint='since last count'
  icon={<TriangleAlert />}
  accent='amber'
  format='count'
  valueTitle='25,074 units'
/>
```

| Prop | Type | Notes |
|---|---|---|
| `label` | `ReactNode` | Short uppercase eyebrow above the value. Truncates with `…`. |
| `value` | `ReactNode` | Primary number. Numeric values are run through `toLocaleString()` when `format='count'`. |
| `hint` | `ReactNode?` | Optional small descriptor below the value (units, delta, etc.). Truncates. |
| `icon` | `ReactNode?` | Lucide icon (or any element). Sized via container query — `size-3.5` → `size-4` at `@sm/stat-tile`. |
| `accent` | `'default' \| 'sky' \| 'emerald' \| 'amber' \| 'rose' \| 'violet' \| 'orange'` | Maps to a value text colour + a soft surface tint (5%/10% in light/dark). Add new keys in the source file, don't pass raw Tailwind classes. |
| `format` | `'count' \| 'percent' \| 'raw'` | `count` (default) calls `toLocaleString()` on numbers. `percent` appends `%`. `raw` passes the value untouched (use for JSX, currency, already-formatted strings). |
| `valueTitle` | `string?` | Override for the tooltip / a11y fallback when truncated. Defaults to `String(value)`. |
| `valueClassName` | `string?` | Escape hatch for the value element (e.g. force a smaller size). Prefer the container-query default. |

### `<KpiGrid>`

```tsx
import { KpiGrid } from '@/components/ui/kpi-grid'

<KpiGrid columns={4} density='comfortable'>
  <StatTile label='Total'     value={total}     accent='sky' />
  <StatTile label='Pending'   value={pending}   accent='amber' />
  <StatTile label='Completed' value={completed} accent='emerald' />
  <StatTile label='Variance'  value={variance}  accent='rose' />
</KpiGrid>
```

| Prop | Type | Notes |
|---|---|---|
| `columns` | `2 \| 3 \| 4 \| 5 \| 6` | Number of columns. `2` and `3` are **unconditional** (the grid stays at that column count at every container width — `<StatTile>`'s `min-w-0` + `truncate` + `tabular-nums` + `title=` chain is the safety net that keeps narrow cells legible). `4`, `5`, and `6` step DOWN on truly narrow containers via `@md/kpi-grid` / `@sm/kpi-grid` / `@lg/kpi-grid` so a wide strip doesn't crush each tile when the surrounding card is squeezed. Default `3`. |
| `density` | `'compact' \| 'comfortable'` | `compact` = `gap-2`, `comfortable` (default) = `gap-3`. |

The grid sets `@container/kpi-grid` and `min-w-0` on itself, so it never pushes its parent flex chain wider. Drop it inside any layout — `Card`, `divide-y` stack, sidebar — and it will just work.

## Four behaviours `<StatTile>` guarantees

These are the things hand-rolled tiles consistently forget, and the reason this primitive exists:

1. **`min-w-0` everywhere.** The tile itself is `min-w-0`, the label row is `min-w-0`, the value is `min-w-0`, and the hint is `min-w-0`. Flexbox defaults `min-width: auto` on every child, which means a 6-digit number will *expand* its parent rather than shrink — and the expansion bubbles up until something pushes horizontal page scroll. Threading `min-w-0` through every level breaks that chain.

2. **`truncate` + `title=`.** The value element is `truncate` (= `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`). When the container forces the value to clip, the full string remains reachable on hover and via assistive tech through `title={valueTitle ?? String(value)}`. No "…25" mystery numbers, no a11y regression.

3. **Container-query typography.** The value steps from `text-lg` → `text-xl` → `text-2xl` → `text-3xl` at `@sm/stat-tile` → `@md/stat-tile` → `@xl/stat-tile` — based on the **tile's own width**, not the viewport's. A `<StatTile>` rendered in a 1280px-wide tab uses big type; the *same* tile in a 240px sidebar uses small type. Viewport breakpoints (`sm:` / `md:`) can't do that.

4. **`toLocaleString()` by default.** `format='count'` runs numeric values through `value.toLocaleString()` so `25074` reads as `25,074`. Stops every consumer from re-implementing thousand separators (and forgetting locale-aware ones). Use `format='raw'` to opt out.

## Example migration

Before — the bug from `/apps/inventory` Inventory Counts:

```tsx
<div className='flex gap-3'>
  <div className='rounded-lg border p-4'>
    <div className='text-xs text-muted-foreground uppercase'>Variance</div>
    <div className='text-3xl font-semibold'>{variance}</div>
  </div>
  {/* …three more tiles, all `text-3xl`, all missing min-w-0… */}
</div>
```

Problems:

- `flex` chain has no `min-w-0`, so the inner `text-3xl` value pushes the row wider than the column.
- `25074` paints as `25074` (no separator) and overflows under the left rail.
- No tooltip when clipped.
- No container-query step-down — same `text-3xl` at every width.

After:

```tsx
import { KpiGrid } from '@/components/ui/kpi-grid'
import { StatTile } from '@/components/ui/stat-tile'

<KpiGrid columns={4}>
  <StatTile label='Total'     value={total}     accent='sky' />
  <StatTile label='Pending'   value={pending}   accent='amber' />
  <StatTile label='Completed' value={completed} accent='emerald' />
  <StatTile label='Variance'  value={variance}  accent='rose' />
</KpiGrid>
```

Result: the row reflows from 4-up → 2-up as the container shrinks (`columns={4}` steps down at `@md/kpi-grid`); `25074` reads as `25,074`; the value truncates with `…` and exposes the full string on hover; the typography steps down in narrow panes so the tile never clips in the first place. (For `columns={2}` and `columns={3}` the grid is unconditional — narrow-cell legibility is handled by `<StatTile>`'s `min-w-0` + `truncate` + `tabular-nums` + `title=` chain rather than a column stepdown, which matches the original pre-container-query design.)

## Don't

- **Don't** drop the `<KpiGrid>` wrapper just because you only have two tiles — it sets `@container/kpi-grid` and `min-w-0` so the row reflows. Without it, you're back to the hand-rolled `flex` chain that started the bug.
- **Don't** override `valueClassName` to force a fixed `text-3xl` — that defeats the container-query step-down and re-introduces clipping in narrow panes.
- **Don't** add a `whitespace-nowrap` ancestor — it breaks `truncate` and forces the value to expand its parent again.
- **Don't** pass raw Tailwind colour classes through `className` to fake a new accent — add the accent key to the source file so the value text colour, surface tint, and icon colour stay in sync.
- **Don't** reach for [[Elevated-KPI-Stat-Cards]] as your default. Use `<StatTile>` first; promote to the elevated recipe only when the strip is a page's headline hero KPIs and the extra elevation budget is warranted.

## Related

- [[Elevated-KPI-Stat-Cards]] — the hero/TV-density recipe. Use that when the KPI strip is the page's headline; use `<StatTile>` + `<KpiGrid>` for everything else.
- [[Unified-Workbench-Card-Layout]] — `<KpiGrid>` is the canonical content for the unified workbench KPI bar variant.
- [[UI-Component-Conventions]] — broader shadcn primitive conventions; `<StatTile>` follows the `data-slot` + `cn(...)` shape used by the rest of `src/components/ui/`.
- [[ResponsiveDialog-Width-Tokens]] — sibling sweep primitive; same "primitive that bakes in the fix you keep forgetting" philosophy.
- [[ADR-Container-Query-Stat-Tiles]] — the architecture decision that introduces `@container/stat-tile` and `@container/kpi-grid` as sanctioned tokens.
