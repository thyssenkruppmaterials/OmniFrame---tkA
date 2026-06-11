// Created and developed by Jai Singh
/**
 * SqcdpChart — full-width historical chart that lives in the footer strip
 * of every primary SQCDP card. Replaces v6's `<SqcdpSparkline>`.
 *
 * Three selectable variants share the same data shape (last-6-months
 * `{ recordedAt, value }[]` from `metric.history` — or, when explicitly
 * passed, an `overrideHistory` prop the editor uses to feed the LATEST
 * history points from `useSqcdpMetricHistory` into the live preview),
 * the same dashed target reference line, and the same minimal-chrome
 * aesthetic — only the geometry (line / gradient-area / rounded-bar)
 * changes.
 *
 * Common chrome:
 *  - <ResponsiveContainer width='100%' height={chartHeight}>
 *  - hidden axes by default (period chip on the card carries the time
 *    scope); v13 lets curators opt into Y-axis tick labels via
 *    `chartConfig.y_axis.show`.
 *  - faint grid (`stroke-opacity 0.06`) — v13 splits horizontal /
 *    vertical toggles, defaults to horizontal-only (matches v12.x).
 *  - target reference line at `metric.target_value` when set (v13
 *    lets the curator restyle it via `chartConfig.target_line`).
 *  - additional `chartConfig.goal_lines[]` reference lines (v13).
 *  - optional `chartConfig.show_average` overlay (v13).
 *  - custom Tooltip — `formatDistanceToNow` + formatted value
 *
 * Markers (v10):
 *  - `metric.showMarkers === true` paints filled circles at every data
 *    point on the line / area variants (silently skipped on bars — the
 *    bars themselves are the markers).
 *  - When `target_value !== null`, points at-or-above target render with
 *    a slightly larger radius (4 vs 3) and a faint `currentColor` ring so
 *    "we hit target on these days" reads at a glance.
 *  - v13: when `chartConfig.highlight_extremes === true`, the min + max
 *    points are bumped further (r=5) with a `currentColor` outline so
 *    the eye lands on the noteworthy values. The composition lives in
 *    `pickDot` — a pure helper exercised by both line + area variants.
 *
 * Animation:
 *  - Recharts' built-in is 1400ms ease-out, opt-out via `animationBegin` /
 *    `useReducedMotion()`.
 *  - The `animationDelay` prop (ms) is the per-card stagger offset that the
 *    parent grid passes in (`index * 60` typically). Recharts' animation
 *    starts at `animationBegin` so the line/area/bar draws after the card
 *    itself has landed via framer-motion.
 *
 * Empty state: when `metric.history.length < 2` we render a faint dashed
 * baseline + a centered "History will appear here once values are updated"
 * line so the card height stays stable instead of collapsing.
 */
import { useId, useMemo, type CSSProperties, type ReactNode } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { useReducedMotion } from 'framer-motion'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import { cn } from '@/lib/utils'
import { useSqcdpCategoriesContext } from '../hooks/use-sqcdp-categories-context'
import type { SqcdpMetricRow } from '../hooks/use-sqcdp-metrics'
import { defaultColorFor } from '../lib/categories'
import {
  DEFAULT_CHART_CONFIG,
  STYLE_DASH,
  computeAverage,
  findExtremes,
  resolveGoalLine,
  resolveTargetLine,
  type ChartConfig,
} from '../lib/chart-config'
import { hexToRgba } from '../lib/color'
import { formatNumber, formatValue } from '../lib/format'

export type SqcdpChartDensity = 'normal' | 'tv'

interface SqcdpChartProps {
  metric: SqcdpMetricRow
  density?: SqcdpChartDensity
  /** Animation start delay (ms) for stagger across the card row. */
  animationDelay?: number
  /** Override the density-derived height in px. Used by the editor preview. */
  height?: number
  /**
   * Override the metric's embedded `history` slice. The editor's live
   * preview passes the latest points from `useSqcdpMetricHistory` so the
   * preview reflects in-flight history edits without waiting for the
   * parent metric query to invalidate and re-fetch.
   */
  overrideHistory?: { recordedAt: string; value: number }[]
  /**
   * Override the metric's persisted `chartConfig`. The editor's live
   * preview passes the in-flight form values so curators see chart-tab
   * changes without saving. Defaults to `metric.chartConfig`.
   */
  overrideChartConfig?: ChartConfig
  className?: string
}

const DENSITY_HEIGHT: Record<SqcdpChartDensity, number> = {
  normal: 120,
  tv: 180,
}

const CHART_MARGIN = { top: 8, right: 6, bottom: 4, left: 6 }
const ANIMATION_DURATION_MS = 1400

interface ChartDatum {
  recordedAt: string
  value: number
}

/**
 * Pure dot-renderer composer. Three concerns layer cleanly on top of
 * each other so the same callback works for line + area variants:
 *
 *  1. `showMarkers` gates the entire callback — without it, line/area
 *     don't render any dots.
 *  2. `highlightExtremes` bumps the matching min/max dot to r=5 with a
 *     thicker outline (overrides #3 because extreme highlighting is the
 *     stronger signal).
 *  3. above-target highlight (existing v10 behaviour) — r=4 with a
 *     subtle outline so "we hit target on these days" still reads.
 */
interface PickDotArgs {
  cx: number
  cy: number
  payload: ChartDatum
  showMarkers: boolean
  highlightExtremes: boolean
  extremes: ReturnType<typeof findExtremes>
  targetValue: number | null
  accentColor: string
  index: number
}

function pickDot(args: PickDotArgs): ReactNode {
  const {
    cx,
    cy,
    payload,
    showMarkers,
    highlightExtremes,
    extremes,
    targetValue,
    accentColor,
    index,
  } = args
  if (!showMarkers) return null
  const isMax =
    highlightExtremes && extremes.max?.recordedAt === payload.recordedAt
  const isMin =
    highlightExtremes && extremes.min?.recordedAt === payload.recordedAt
  const isExtreme = isMax || isMin
  const isAboveTarget =
    targetValue !== null && payload.value >= targetValue && !isExtreme
  let radius = 3
  let stroke: string = 'none'
  let strokeWidth = 0
  if (isExtreme) {
    radius = 5
    stroke = 'currentColor'
    strokeWidth = 1.5
  } else if (isAboveTarget) {
    radius = 4
    stroke = 'currentColor'
    strokeWidth = 1
  }
  return (
    <circle
      key={`dot-${index}`}
      data-testid='sqcdp-chart-dot'
      data-above-target={isAboveTarget ? 'true' : 'false'}
      data-extreme={isExtreme ? (isMax ? 'max' : 'min') : 'none'}
      cx={cx}
      cy={cy}
      r={radius}
      fill={accentColor}
      stroke={stroke}
      strokeOpacity={0.4}
      strokeWidth={strokeWidth}
    />
  )
}

export function SqcdpChart({
  metric,
  density = 'normal',
  animationDelay = 0,
  height,
  overrideHistory,
  overrideChartConfig,
  className,
}: SqcdpChartProps) {
  const { categories } = useSqcdpCategoriesContext()
  const accentColor =
    metric.colorHex ?? defaultColorFor(metric.category, categories)
  const prefersReducedMotion = useReducedMotion()
  const isAnimationActive = !prefersReducedMotion
  const chartHeight = height ?? DENSITY_HEIGHT[density]
  const gradientId = useId()
  const showMarkers = metric.showMarkers === true

  const cfg: ChartConfig = overrideChartConfig ?? metric.chartConfig ?? {}
  const target = resolveTargetLine(cfg, accentColor)
  const grid = { ...DEFAULT_CHART_CONFIG.grid, ...(cfg.grid ?? {}) }
  const yAxis = { ...DEFAULT_CHART_CONFIG.y_axis, ...(cfg.y_axis ?? {}) }
  const curve = cfg.curve ?? DEFAULT_CHART_CONFIG.curve
  const showAverage = cfg.show_average ?? false
  const highlightExtremes = cfg.highlight_extremes ?? false
  const goalLines = cfg.goal_lines ?? []

  const sourceHistory = overrideHistory ?? metric.history
  const data = useMemo<ChartDatum[]>(
    () =>
      sourceHistory.map((h) => ({
        recordedAt: h.recordedAt,
        value: Number(h.value),
      })),
    [sourceHistory]
  )

  const extremes = useMemo(() => findExtremes(data), [data])
  const average = useMemo(() => computeAverage(data), [data])
  const showExtremesCaption =
    highlightExtremes &&
    data.length > 1 &&
    extremes.min !== null &&
    extremes.max !== null

  if (data.length < 2) {
    return (
      <div
        role='img'
        aria-label='Not enough history yet for a trend chart'
        className={cn('relative w-full', className)}
        style={{ height: chartHeight }}
      >
        <div
          aria-hidden
          className='absolute inset-x-2 top-1/2 h-px -translate-y-1/2'
          style={{
            backgroundImage: `linear-gradient(to right, ${hexToRgba(
              accentColor,
              0.18
            )} 50%, transparent 50%)`,
            backgroundSize: '6px 1px',
            backgroundRepeat: 'repeat-x',
          }}
        />
        <span
          className={cn(
            'text-muted-foreground/60 absolute inset-0 flex items-center',
            'justify-center text-center text-[11px] italic',
            'px-3'
          )}
        >
          History will appear here once values are updated.
        </span>
      </div>
    )
  }

  const renderTooltip = (props: TooltipContentProps<number, string>) => (
    <SqcdpChartTooltip
      payload={props.payload}
      active={props.active}
      metric={metric}
    />
  )

  const yDomain: [number | string, number | string] = [
    yAxis.min ?? 'auto',
    yAxis.max ?? 'auto',
  ]
  const yAxisWidth = yAxis.show ? 32 : 0

  const showAnyGrid = grid.show_horizontal || grid.show_vertical

  const commonAxes = (
    <>
      <XAxis dataKey='recordedAt' hide />
      <YAxis
        hide={!yAxis.show}
        domain={yDomain}
        tick={{ fontSize: 10 }}
        width={yAxisWidth}
        axisLine={false}
        tickLine={false}
      />
      {showAnyGrid && (
        <CartesianGrid
          stroke='currentColor'
          strokeOpacity={Math.max(0, Math.min(50, grid.opacity ?? 6)) / 100}
          horizontal={grid.show_horizontal}
          vertical={grid.show_vertical}
        />
      )}
      <Tooltip
        cursor={{ stroke: accentColor, strokeOpacity: 0.18 }}
        content={renderTooltip}
        wrapperStyle={{ outline: 'none' }}
      />
      {metric.targetValue != null && (
        <ReferenceLine
          y={metric.targetValue}
          stroke={target.color}
          strokeOpacity={0.45}
          strokeDasharray={STYLE_DASH[target.style]}
          strokeWidth={target.width}
          ifOverflow='extendDomain'
        >
          {target.showLabel ? (
            <Label
              position='insideTopRight'
              value={`Target ${formatNumber(metric.targetValue)}`}
              fontSize={9}
              fill={target.color}
              fillOpacity={0.65}
            />
          ) : (
            <Label
              value='target'
              position='insideTopRight'
              fontSize={9}
              fill={target.color}
              fillOpacity={0.65}
            />
          )}
        </ReferenceLine>
      )}
      {goalLines.map((goal) => {
        const r = resolveGoalLine(goal, accentColor)
        return (
          <ReferenceLine
            key={goal.id}
            y={goal.value}
            stroke={r.color}
            strokeDasharray={STYLE_DASH[r.style]}
            strokeWidth={r.width}
            ifOverflow='extendDomain'
            data-testid='sqcdp-chart-goal-line'
          >
            {goal.label ? (
              <Label
                position='insideTopRight'
                value={goal.label}
                fontSize={9}
                fill={r.color}
              />
            ) : null}
          </ReferenceLine>
        )
      })}
      {showAverage && average != null && (
        <ReferenceLine
          y={average}
          stroke='currentColor'
          strokeOpacity={0.45}
          strokeDasharray='2 2'
          strokeWidth={1}
          ifOverflow='extendDomain'
          data-testid='sqcdp-chart-average-line'
        >
          <Label
            position='left'
            value={`avg ${formatNumber(average)}`}
            fontSize={9}
            fill='currentColor'
            fillOpacity={0.6}
          />
        </ReferenceLine>
      )}
    </>
  )

  // When markers are enabled, render circles at every data point. The
  // composer in `pickDot` layers the show_markers / above-target /
  // highlight-extremes concerns so we can keep the per-variant render
  // call sites simple. Recharts may invoke the dot renderer with
  // undefined coords for the gradient legend slot — return a degenerate
  // empty group there to keep the SVG valid without painting.
  const dotProp = showMarkers
    ? (props: {
        cx?: number
        cy?: number
        payload?: ChartDatum
        index?: number
      }) => {
        const { cx, cy, payload, index = 0 } = props
        if (cx === undefined || cy === undefined || !payload) {
          return (
            <g key={`dot-empty-${index}`} data-testid='sqcdp-chart-dot-empty' />
          )
        }
        return pickDot({
          cx,
          cy,
          payload,
          showMarkers,
          highlightExtremes,
          extremes,
          targetValue: metric.targetValue,
          accentColor,
          index,
        })
      }
    : false

  const activeDotRadius = showMarkers ? 5 : 4

  return (
    <div
      data-testid='sqcdp-chart'
      data-chart-type={metric.chartType}
      data-show-markers={showMarkers ? 'true' : 'false'}
      data-highlight-extremes={highlightExtremes ? 'true' : 'false'}
      className={cn('relative w-full', className)}
    >
      <ResponsiveContainer width='100%' height={chartHeight}>
        {metric.chartType === 'line' ? (
          <LineChart data={data} margin={CHART_MARGIN}>
            {commonAxes}
            <Line
              type={curve}
              dataKey='value'
              stroke={accentColor}
              strokeWidth={2.5}
              dot={dotProp}
              activeDot={{
                r: activeDotRadius,
                strokeWidth: 0,
                fill: accentColor,
              }}
              isAnimationActive={isAnimationActive}
              animationDuration={ANIMATION_DURATION_MS}
              animationBegin={animationDelay}
              animationEasing='ease-out'
            />
          </LineChart>
        ) : metric.chartType === 'bar' ? (
          <BarChart data={data} margin={CHART_MARGIN}>
            {commonAxes}
            <Bar
              dataKey='value'
              radius={[4, 4, 0, 0]}
              isAnimationActive={isAnimationActive}
              animationDuration={ANIMATION_DURATION_MS}
              animationBegin={animationDelay}
              animationEasing='ease-out'
            >
              {data.map((p) => {
                const isMax =
                  highlightExtremes && extremes.max?.recordedAt === p.recordedAt
                const isMin =
                  highlightExtremes && extremes.min?.recordedAt === p.recordedAt
                const isExtreme = isMax || isMin
                return (
                  <Cell
                    key={p.recordedAt}
                    fill={accentColor}
                    fillOpacity={0.85}
                    stroke={isExtreme ? 'currentColor' : 'none'}
                    strokeOpacity={0.4}
                    strokeWidth={isExtreme ? 1.5 : 0}
                    data-testid='sqcdp-chart-bar-cell'
                    data-extreme={isExtreme ? (isMax ? 'max' : 'min') : 'none'}
                  />
                )
              })}
            </Bar>
          </BarChart>
        ) : (
          <AreaChart data={data} margin={CHART_MARGIN}>
            <defs>
              <linearGradient id={gradientId} x1='0' y1='0' x2='0' y2='1'>
                <stop offset='0%' stopColor={accentColor} stopOpacity={0.45} />
                <stop offset='50%' stopColor={accentColor} stopOpacity={0.15} />
                <stop
                  offset='100%'
                  stopColor={accentColor}
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
            {commonAxes}
            <Area
              type={curve}
              dataKey='value'
              stroke={accentColor}
              strokeWidth={2.5}
              fill={`url(#${gradientId})`}
              dot={dotProp}
              isAnimationActive={isAnimationActive}
              animationDuration={ANIMATION_DURATION_MS}
              animationBegin={animationDelay}
              animationEasing='ease-out'
              activeDot={{
                r: activeDotRadius,
                strokeWidth: 0,
                fill: accentColor,
              }}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
      {showExtremesCaption && (
        <div
          data-testid='sqcdp-chart-extremes-caption'
          className='text-muted-foreground/80 mt-1 flex items-center justify-between text-[10px] tabular-nums'
        >
          <span>▲ MAX {formatNumber(extremes.max!.value)}</span>
          <span>▼ MIN {formatNumber(extremes.min!.value)}</span>
        </div>
      )}
    </div>
  )
}

interface TooltipPayloadEntry {
  payload?: ChartDatum
  value?: number | string
}

interface SqcdpChartTooltipProps {
  active?: boolean
  payload?: ReadonlyArray<TooltipPayloadEntry>
  metric: SqcdpMetricRow
}

function SqcdpChartTooltip({
  active,
  payload,
  metric,
}: SqcdpChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const point = payload[0]?.payload
  if (!point) return null
  const recorded = new Date(point.recordedAt)
  const relative = Number.isFinite(recorded.getTime())
    ? formatDistanceToNow(recorded, { addSuffix: true })
    : null
  const formatted = formatValue(metric.valueFormat, point.value, metric.unit)
  const tooltipStyle: CSSProperties = { lineHeight: 1.25 }
  return (
    <div
      className={cn(
        'bg-popover/95 border-border/50 rounded-md border px-2 py-1',
        'text-xs shadow-md backdrop-blur-sm'
      )}
      style={tooltipStyle}
    >
      <div className='text-foreground font-medium tabular-nums'>
        {formatted}
      </div>
      {relative && (
        <div className='text-muted-foreground text-[10px]'>{relative}</div>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
