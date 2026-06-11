---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-10
---
# Selectable Chart Variants (line / area / bar)

## Purpose / Context

Reusable recipe for **per-row-selectable historical charts** — the user (or a curator) picks a visualisation type per data row, and the same React component renders one of three Recharts geometries. Use this when:

- A dashboard has 4–12 KPIs each with their own historical series, and "one chart type for all" would mute meaningful variance (a counter metric reads better as bars; a continuous-rate metric reads better as area).
- The chart type is a **persisted column** on the data row (not a viewer toggle) — so the choice survives refreshes and is curator-managed.
- The host surface already has Recharts in the bundle — the variants don't add a vendor dependency.

Do NOT use this when:

- All KPIs on the surface are the same metric type (just lock the chart variant and skip the column).
- The surface is read-only and the chart type is a presentation concern only — a `<Tabs>` or `<ToggleGroup>` over a single chart with internal state is simpler.
- You need a non-Recharts geometry (heatmap, scatter, sankey, etc.) — this recipe is scoped to line/area/bar.

First surfaced from [[Implement-Production-Boards-Hourly-Grid]] § v9 (SQCDP scorecard cards). Likely next adopter: [[ProductionBoards - Feature Module]]'s Hourly KPI strip (the four-cell `<BoardMetrics>` row currently shows just a number).

## Recipe

### 1. Persisted column on the data row

```sql
ALTER TABLE public.<row_table>
  ADD COLUMN IF NOT EXISTS chart_type text NOT NULL DEFAULT 'area'
    CHECK (chart_type IN ('line', 'area', 'bar'));
```

Default to `'area'` (the premium-dashboard look). The CHECK constraint pins the allowed values so the frontend zod enum and the DB stay in lock-step.

Mirror the column in the typed row interface (`chartType: 'line' | 'area' | 'bar'`) and in the create / update mutation inputs. Use `chart_type` (snake_case) for the DB column and `chartType` (camelCase) on the runtime row — the row mapper is the only place the two collide.

### 2. Single component, switch on `chart_type`

```tsx
interface SelectableChartProps {
  metric: { chartType: 'line' | 'area' | 'bar'; history: { recordedAt: string; value: number }[]; targetValue: number | null; ... }
  density?: 'normal' | 'tv'
  animationDelay?: number  // per-row stagger offset for the geometry's draw
  height?: number          // override for editor previews
}

export function SelectableChart({ metric, density = 'normal', animationDelay = 0, height }: SelectableChartProps) {
  const accentColor = metric.colorHex ?? defaultColorFor(metric.category)
  const prefersReducedMotion = useReducedMotion()  // framer-motion
  const isAnimationActive = !prefersReducedMotion
  const chartHeight = height ?? DENSITY_HEIGHT[density]
  const gradientId = useId()

  if (metric.history.length < 2) return <EmptyChartState height={chartHeight} accent={accentColor} />

  const commonAxes = (
    <>
      <XAxis dataKey='recordedAt' hide />
      <YAxis hide domain={['auto', 'auto']} />
      <CartesianGrid stroke='currentColor' strokeOpacity={0.06} vertical={false} />
      <Tooltip content={renderTooltip} cursor={{ stroke: accentColor, strokeOpacity: 0.18 }} />
      {metric.targetValue != null && (
        <ReferenceLine y={metric.targetValue} stroke={accentColor} strokeOpacity={0.35} strokeDasharray='3 3'>
          <Label value='target' position='right' fontSize={9} fill={accentColor} fillOpacity={0.65} />
        </ReferenceLine>
      )}
    </>
  )

  return (
    <div data-chart-type={metric.chartType}>
      <ResponsiveContainer width='100%' height={chartHeight}>
        {metric.chartType === 'line' ? (
          <LineChart data={metric.history} margin={...}>
            {commonAxes}
            <Line type='monotone' dataKey='value' stroke={accentColor} strokeWidth={2.5} dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: accentColor }}
              isAnimationActive={isAnimationActive} animationDuration={1400}
              animationBegin={animationDelay} animationEasing='ease-out' />
          </LineChart>
        ) : metric.chartType === 'bar' ? (
          <BarChart data={metric.history} margin={...}>
            {commonAxes}
            <Bar dataKey='value' fill={accentColor} fillOpacity={0.85} radius={[4, 4, 0, 0]}
              isAnimationActive={...} animationDuration={1400} animationBegin={animationDelay} />
          </BarChart>
        ) : (
          <AreaChart data={metric.history} margin={...}>
            <defs>
              <linearGradient id={gradientId} x1='0' y1='0' x2='0' y2='1'>
                <stop offset='0%' stopColor={accentColor} stopOpacity={0.45} />
                <stop offset='50%' stopColor={accentColor} stopOpacity={0.15} />
                <stop offset='100%' stopColor={accentColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {commonAxes}
            <Area type='monotone' dataKey='value' stroke={accentColor} strokeWidth={2.5}
              fill={`url(#${gradientId})`}
              isAnimationActive={...} animationDuration={1400} animationBegin={animationDelay}
              animationEasing='ease-out' activeDot={{ r: 4, strokeWidth: 0, fill: accentColor }} />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
```

Key details:

- **`useId()` for gradient IDs** — two charts of the same metric in the DOM (an editor preview + the production card) would otherwise collide on a static gradient ID and one would lose its fill.
- **Common chrome lifted out** — `commonAxes` keeps the chrome consistent across the three variants. Inline tweaks per geometry are the exception, not the rule.
- **Named imports only** — `import { Area, AreaChart, Bar, BarChart, Line, LineChart, ... } from 'recharts'`. Don't `import * as Recharts`; tree-shaking matters when three variants live in one component.
- **ResponsiveContainer at the top** — every variant nests inside the same `<ResponsiveContainer width='100%' height={chartHeight}>`; only the geometry tag swaps.

### Variant-specific knobs (dataKey / stroke / fill)

| Variant | Geometry | Stroke / fill | Distinguishing prop |
|---|---|---|---|
| `line` | `<LineChart>` + `<Line>` | `stroke={accentColor}` strokeWidth 2.5, no fill, `dot={false}` | `activeDot={{ r: 4, fill: accentColor }}` |
| `area` | `<AreaChart>` + `<Area>` | `stroke={accentColor}` strokeWidth 2.5, `fill='url(#gradientId)'` | `<linearGradient>` 3-stop fade `0.45 → 0.15 → 0.02` |
| `bar` | `<BarChart>` + `<Bar>` | `fill={accentColor} fillOpacity={0.85}`, no stroke | `radius={[4, 4, 0, 0]}` for the rounded top |

### 3. Animation stagger across the row

Two layers compose:

1. **Card-level mount stagger** via framer-motion variants on the parent grid:

```tsx
const containerVariants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
}
const cardVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
}

<MotionConfig reducedMotion='user'>
  <motion.div variants={containerVariants} initial='initial' animate='animate'>
    {rows.map((r, idx) => (
      <motion.div key={r.id} variants={cardVariants}>
        <SelectableChart metric={r} animationDelay={idx * 60} />
      </motion.div>
    ))}
  </motion.div>
</MotionConfig>
```

2. **Geometry-level draw** via `animationBegin={idx * 60}` on the Recharts `<Line>` / `<Area>` / `<Bar>`. This makes each chart's geometry start drawing 60 ms after the previous one — layered with the card's framer-motion landing it produces a synchronised cascade.

`<MotionConfig reducedMotion='user'>` short-circuits the per-row variants for users with `prefers-reduced-motion: reduce`. The chart itself separately checks `useReducedMotion()` and disables Recharts' animation when true — belt-and-suspenders: if a future consumer drops the `<MotionConfig>` wrapper but uses `<SelectableChart>` standalone, reduced-motion still works.

### 4. Editor preview

When the row is curator-edited, render the same component below the `<Select>` field at a smaller height (~80 px) using either real history (when ≥ 2 points exist) or an 8-point demo dataset for fresh rows. The preview reuses the production component with `height={80}` so editors always see exactly what they're getting.

### 5. Empty state

When `history.length < 2` render a faint dashed horizontal line (CSS-only — `linear-gradient` repeating mask) + centred italic copy at `text-muted-foreground/60 text-[11px]`. Keep the chart frame at the same height as the populated state so card heights stay stable.

Deliberately do NOT seed demo data in the production state — the empty state is a UX invitation, not a placeholder. (The editor preview is the exception because the curator hasn't saved anything yet.)

### 6. Tooltip body

```tsx
<div className='bg-popover/95 border-border/50 rounded-md border px-2 py-1 text-xs shadow-md backdrop-blur-sm'>
  <div className='text-foreground font-medium tabular-nums'>{formattedValue}</div>
  <div className='text-muted-foreground text-[10px]'>{relativeDate /* formatDistanceToNow */}</div>
</div>
```

Absolute date is a future toggle (forensic use). Relative date is the default because it's faster to read at glance distance.

## Don't

- **Don't `import * as Recharts`** — the variants don't share enough surface to justify wholesale; named imports keep tree-shaking honest.
- **Don't reuse a static gradient ID across two instances of the same metric.** Use `useId()`. Otherwise the second instance loses its fill.
- **Don't seed demo data on empty production cards.** Production should reflect real data — the dashed-line empty state is the UX invitation. Demo data only belongs in the editor preview.
- **Don't omit `prefers-reduced-motion` handling.** Both layers (framer-motion variants and Recharts `isAnimationActive`) need to honour it; missing one creates a jank for a small but real user segment.
- **Don't build three separate chart components.** The shared chrome (axes, grid, tooltip, reference line, height, margin) drifts across copies and the three start to look subtly different. One component with a `chart_type` switch keeps the family coherent.
- **Don't render axes / labels on a small card chart.** The card's period chip carries the time scope — axis labels are noise at this size and they fight the geometry.
- **Don't use `radius={[4, 4, 4, 4]}` on bars.** Round only the top corners — round bottoms detach from the baseline grid line and the chart starts to look toy-like.
- **Don't hand-roll the tooltip's portal logic.** Recharts' built-in `<Tooltip content={...}>` does the positioning; the custom content prop is for the body markup, not the wrapper.

## Reusability checklist

Likely adopters once the pattern stabilises:

- [[ProductionBoards - Feature Module]] Hourly KPI strip — `<BoardMetrics>` already has the four KPI cells; `<SelectableChart height={32}>` underneath each big number would make it a sparkline/scoreboard hybrid.
- Inventory Health summary — 5–7 location-buckets each with a 30-day occupancy trend.
- Customer Tickets dashboard — ticket-resolution-time / open-ticket-count hero KPIs with curator-picked geometry per metric.

If two consumers land outside production-boards/sqcdp, promote `<SelectableChart>` to `src/components/charts/` and the `chart_type` enum to a shared `lib/chart-types.ts`.

## Related

- [[Implement-Production-Boards-Hourly-Grid]] § v9 — first application; full file inventory and Recharts variant configs.
- [[Elevated-KPI-Stat-Cards]] — the surface recipe `<SqcdpCard>` extends; the chart strip lives below the card body, separated by a thin border.
- [[Editable-Board-Sheets]] — the editor pattern that hosts the `<Select>` for chart_type and the live preview.
- [[Dark-Mode-Opacity-Colors]] — grid stroke / reference line / muted copy all draw from this token system.
- [[Cinematic-Tab-Rotation]] — same `[0.22, 1, 0.36, 1]` cubic-bezier easing for grammar cohesion across the page chrome and the chart cascade.



## Reference lines + extremes recipe (v13)

When a chart needs to layer multiple horizontal reference lines on top of the data series, follow this composition pattern — it falls out of the v13 SQCDP work and is reusable anywhere we render a Recharts line/area/bar with overlaid context (e.g. hourly-grid productivity, dashboard KPIs).

### 1. Persist the bag, not the booleans

Use a single `jsonb NOT NULL DEFAULT '{}'` column for chart appearance overrides instead of N typed columns. The v12.x experience taught us each new toggle costs another ALTER TABLE + pgrst NOTIFY + frontend deploy ordering window. Validate the shape **client-side** via Zod, sanitize on read via a `parseChartConfig`-style helper. Empty object always preserves prior render.

### 2. Resolve, don't conditional-render

`resolveTargetLine(config, fallbackAccent)` returns a fully-populated `{ color, style, width, showLabel }` so the JSX call site doesn't fork on "is the override set or not". The callsite stays terse:

```tsx
const target = resolveTargetLine(cfg, accentColor)
<ReferenceLine
  y={metric.targetValue}
  stroke={target.color}
  strokeDasharray={STYLE_DASH[target.style]}
  strokeWidth={target.width}
/>
```

The `STYLE_DASH` map (`solid → undefined`, `dashed → '4 4'`, `dotted → '2 4'`) lives next to the helper so all callers get the same Recharts pattern strings.

### 3. Extremes via a `pickDot` composer (line / area)

When multiple dot states overlap (e.g. show-markers + above-target highlight + min/max highlight), keep the per-variant render simple by hoisting the composition into a pure helper:

```ts
function pickDot(args: PickDotArgs): ReactNode {
  if (!args.showMarkers) return null
  const isExtreme = ... // wins over above-target
  const isAboveTarget = ... && !isExtreme
  // pick radius / stroke / strokeWidth from the highest-priority match
  return <circle ... />
}
```

Call the helper from each variant's `dot` prop. Tag the rendered `<circle>` with `data-extreme` + `data-above-target` so smoke tests can assert which path fired without re-running the layering math.

### 4. Bar variant uses `<Cell>`, not `dot`

Bar charts don't accept a `dot` prop — to mark min/max bars, render `<Cell>` children inside the `<Bar>` and condition `stroke` / `strokeWidth` on each bar's `recordedAt` matching the precomputed extremes:

```tsx
<Bar dataKey='value' radius={[4, 4, 0, 0]}>
  {data.map((p) => {
    const isExtreme = highlightExtremes && (
      extremes.max?.recordedAt === p.recordedAt ||
      extremes.min?.recordedAt === p.recordedAt
    )
    return (
      <Cell
        key={p.recordedAt}
        fill={accentColor}
        stroke={isExtreme ? 'currentColor' : 'none'}
        strokeWidth={isExtreme ? 1.5 : 0}
      />
    )
  })}
</Bar>
```

### 5. Caption row below the chart, not labels on it

For extremes, render a tiny `mt-1 flex items-center justify-between text-[10px] tabular-nums text-muted-foreground/80` row **outside** the `<ResponsiveContainer>`. Inline labels at the min/max points crowd the SVG; a caption row gives the eye a stable anchor without competing with the data line.

### Reference

Shipped in v13 of [[Implement-Production-Boards-Hourly-Grid]]. Helpers live in `src/features/shift-productivity/production-boards/boards/sqcdp/lib/chart-config.ts`. Editor surface: `<ChartTab>` in `sqcdp-editor-dialog.tsx` + `<SqcdpGoalLinesEditor>` (drag-to-reorder via `@dnd-kit`).
