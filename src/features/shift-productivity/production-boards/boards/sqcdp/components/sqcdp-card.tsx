// Created and developed by Jai Singh
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  IconArrowRight,
  IconPencil,
  IconPlus,
  IconTrendingDown,
  IconTrendingUp,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useBoardEditMode } from '../../../hooks/use-board-edit-mode'
import { useCanEditBoards } from '../../../hooks/use-can-edit-boards'
import { useSqcdpCategoriesContext } from '../hooks/use-sqcdp-categories-context'
import type { SqcdpMetricRow, SubMetric } from '../hooks/use-sqcdp-metrics'
import { useUniformHeroFit, type HeroTier } from '../hooks/use-uniform-hero-fit'
import {
  computeAutoValue,
  isAutoValueActive,
  tickIntervalFor,
} from '../lib/auto-value'
import {
  defaultColorFor,
  getCategory,
  type SqcdpCategoryDef,
  type SqcdpCategoryId,
} from '../lib/categories'
import { formatValue, formatValueWithOptions } from '../lib/format'
import {
  DEFAULT_HEADER,
  DEFAULT_STYLES,
  type FieldStyle,
  fieldClasses,
  fieldColor,
  fieldInlineStyle,
  headerClasses,
  headerGroupClasses,
  headerOuterClasses,
  isSizePinned,
  type StyleConfig,
} from '../lib/style-config'
import { SqcdpChart } from './sqcdp-chart'

export type SqcdpCardDensity = 'normal' | 'tv'

interface SqcdpCardProps {
  category: SqcdpCategoryId
  metric: SqcdpMetricRow | null
  density?: SqcdpCardDensity
  /** Index in the row, used to stagger the chart's Recharts animationBegin. */
  index?: number
  /**
   * Whether the card runs its own mount-in animation. The v5 Elevated KPI
   * Stat Cards recipe stages an `animate-in` fade+slide; that's appropriate
   * when the card is rendered standalone, but the v9 SQCDP grid orchestrates
   * mount-in via framer-motion variants — the parent passes `false` to
   * suppress double-animation. Defaults to `true` so callers outside the
   * grid (e.g. `<SqcdpGridSkeleton>`) keep the standalone behaviour.
   */
  mountAnimation?: boolean
  onEdit?: (metric: SqcdpMetricRow) => void
  onCreate?: (category: SqcdpCategoryId) => void
  /**
   * Pre-resolved category def. The grid passes this to avoid every card
   * re-running the lookup against the context's category list. When
   * omitted the card falls back to the categories context (and finally
   * to the builtin seed via `getCategory`'s null-safe path).
   */
  categoryOverride?: SqcdpCategoryDef
}

const PERIOD_LABELS: Record<string, string> = {
  rolling_4_weeks: 'Rolling 4 Weeks',
  rolling_30_days: 'Rolling 30 Days',
  last_6_months: 'Last 6 Months',
  ytd: 'Year to Date',
  custom: 'Custom Range',
}

/**
 * Period → comparison-label mapping for the v12 "vs N {period}" subtext
 * line. The unit is intentionally coarse (the comparison is between the
 * last two recorded points, not a calendar boundary), so the period
 * label above the comparison value gives users the context they need
 * without overpromising precision.
 */
const COMPARISON_LABELS: Record<string, string> = {
  rolling_4_weeks: 'last week',
  rolling_30_days: 'yesterday',
  last_6_months: 'last month',
  ytd: 'last week',
  custom: 'previously',
}

// Lifted from the BoardMetrics 3-stop shadow recipe — see
// `boards/hourly/components/board-metrics.tsx` for the canonical version.
const SHADOW_NORMAL = [
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_1px_2px_0_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(15,23,42,0.18)]',
  'dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_2px_4px_0_rgba(0,0,0,0.5),0_24px_48px_-12px_rgba(0,0,0,0.55)]',
  'motion-safe:hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_2px_4px_0_rgba(0,0,0,0.08),0_16px_40px_-12px_rgba(15,23,42,0.25)]',
  'motion-safe:dark:hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_4px_8px_0_rgba(0,0,0,0.55),0_32px_64px_-16px_rgba(0,0,0,0.6)]',
].join(' ')

const SHADOW_TV = [
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_2px_4px_0_rgba(0,0,0,0.07),0_24px_48px_-16px_rgba(15,23,42,0.28)]',
  'dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_4px_8px_0_rgba(0,0,0,0.55),0_40px_80px_-20px_rgba(0,0,0,0.65)]',
].join(' ')

/**
 * v15.2 — TV-only **measured** uniform hero typography. Supersedes
 * the v15.1 `vh`-only recipe (see
 * [[Implement-SQCDP-Measured-Hero-Typography]] +
 * [[ADR-SQCDP-Measured-vs-Viewport-Hero-Typography]]).
 *
 * Evolution: v15 used CSS container queries (`cqh`) so each card
 * scaled to its OWN value-block height — siblings drifted because
 * per-card content drove different container heights. v15.1 swapped
 * `cqh` for `vh` so the clamp resolved to the SAME px in every card
 * — siblings agreed but the chosen size had no width awareness, so
 * longer values ("99.7%" on Delivery, "73 DAYS FOR PHYSICAL" on
 * Announcement) overflowed their cards. The user reported this with
 * a TV screenshot:
 *
 *   > "It looks like it is currently not displaying as expected. The
 *   >  sizes are still different, and the percent is cut off. Please
 *   >  review comprehensively and fix these issues."
 *
 * Pure-CSS approaches can't deliver "every card the same px AND no
 * card overflows" without measuring what actually fits. v15.2 takes
 * the JS measurement route via `useUniformHeroFit`: three
 * independent registries (`primary`, `sub`, `secondarySingle`) pick
 * the largest px that fits the snuggest card per tier and apply that
 * uniform px to every member. Width-aware AND uniform.
 *
 * Curator overrides still win: when `metric.styleConfig.primary.size`
 * is set we pass `enabled: false` to the hook, registration is
 * skipped, and the curator's static `text-{N}xl` survives via the
 * existing `primaryClasses` chain — see `<FieldStyleRow>` in
 * `<SqcdpEditorDialog>` for the curator-facing hint.
 *
 * Wrap behaviour: every measured value renders single-line via the
 * `whitespace-nowrap overflow-hidden` chain so the measurement isn't
 * fighting wrap. The hook surfaces an `overflow` flag for the
 * pathological case where a value can't fit at the tier floor —
 * those entries relax to `whitespace-normal` + `line-clamp-2` and
 * the tier picks its size from the survivors.
 *
 * `leading-[0.95]` packs the value tightly. Static class literals so
 * Tailwind v4's JIT keeps them in the bundle (same gotcha as
 * [[Patterns/Per-Field-Style-Overrides]]).
 *
 * Tuning lives in `DEFAULT_UNIFORM_HERO_FIT_OPTIONS` (see the hook):
 *  - Primary: 56 px floor / 11vh ceiling / 128 px initial.
 *  - Sub-metric: 32 px floor / 6vh ceiling / 56 px initial.
 *  - Secondary single: 48 px floor / 9vh ceiling / 96 px initial.
 *  - 16 px inline safety, 4 px rounding, 100 ms resize debounce.
 */
const TV_MEASURED_HERO =
  'whitespace-nowrap overflow-hidden leading-[0.95] motion-safe:transition-opacity motion-safe:duration-150'
const TV_MEASURED_HERO_OVERFLOW =
  'whitespace-normal overflow-hidden leading-[0.95] line-clamp-2 motion-safe:transition-opacity motion-safe:duration-150'
const TV_MEASURED_SUB =
  'whitespace-nowrap overflow-hidden leading-[1] motion-safe:transition-opacity motion-safe:duration-150'
const TV_MEASURED_SUB_OVERFLOW =
  'whitespace-normal overflow-hidden leading-[1.05] line-clamp-2 motion-safe:transition-opacity motion-safe:duration-150'

interface DensityTokens {
  card: string
  body: string
  primary: string
  /**
   * Min-height reserved for the big-number block so single-line ("475")
   * and two-line ("848 Days" wraps) cards anchor at the same baseline.
   * Sized at 2× `text-{N}xl leading-none` so the worst-case 2-line wrap
   * still fits. Paired with `flex items-end` on the number element so
   * single-line values sit at the bottom of the reserved space.
   */
  primaryReserve: string
  /**
   * v12 — sub-metric block reserve. When the card switches to the
   * stacked layout, each sub-metric block uses a smaller hero number and
   * we share the primary reserve across rows. ~5xl (3rem leading-none)
   * fits comfortably for 2-3 stacked rows inside the same card height.
   */
  subPrimary: string
  subPrimaryReserve: string
  subTitle: string
  subSubtitle: string
  subtitle: string
  target: string
  /**
   * v11.3 — Colored Header Scorecard variant. The category title now
   * lives inside a saturated colored band at the top of the card
   * (replaces the 4 px top accent line). The thyssenkrupp Branch
   * Performance scorecard layout is the visual reference.
   */
  header: string
  headerTitle: string
  headerIconSize: string
  headerEditButton: string
  /**
   * Legacy `label` token retained for the empty-slot placeholder card,
   * which still renders the eyebrow row pattern (icon + small caps
   * label). Populated cards no longer use `label` — they use
   * `headerTitle` inside the colored band.
   */
  label: string
  iconSize: string
  shadow: string
  chartStrip: string
  /** v12 — trend-arrow size matched to the primary number scale. */
  trendIconSize: string
  /** v12 — comparison-value (vs X last week) typography. */
  comparison: string
}

const DENSITY: Record<SqcdpCardDensity, DensityTokens> = {
  normal: {
    card: 'rounded-2xl',
    body: 'flex flex-1 flex-col gap-3 p-5',
    primary: 'text-7xl font-black tabular-nums tracking-tight leading-none',
    // text-7xl = 4.5rem font-size, leading-none = 1.0 line-height → 2 lines = 9rem.
    primaryReserve: 'min-h-[9rem] flex items-end',
    subPrimary: 'text-5xl font-black tabular-nums tracking-tight leading-none',
    subPrimaryReserve: 'min-h-[3.5rem] flex items-end',
    subTitle:
      'text-sm font-semibold uppercase tracking-wide text-foreground/90',
    subSubtitle: 'text-[11px] text-muted-foreground',
    subtitle: 'text-sm text-muted-foreground',
    target: 'text-xs text-muted-foreground tabular-nums',
    // Header layout chrome. Padding / justify come from `headerClasses(...)`
    // at render time so curators can swap the band height (compact /
    // normal / tall) and alignment (left / center) via the editor without
    // editing this density token.
    header: 'flex items-center gap-3 px-5',
    headerTitle:
      'text-2xl font-bold uppercase tracking-tight text-white truncate',
    headerIconSize: 'h-5 w-5 text-white/95 shrink-0',
    headerEditButton:
      'h-8 w-8 text-white/85 hover:bg-white/15 hover:text-white focus-visible:ring-white/40',
    label: 'text-xs font-semibold uppercase tracking-wider',
    iconSize: 'h-4 w-4',
    shadow: SHADOW_NORMAL,
    chartStrip: 'border-t border-border/30 px-3 pt-2 pb-3',
    trendIconSize: 'h-7 w-7',
    comparison: 'text-xs text-muted-foreground tabular-nums',
  },
  tv: {
    card: 'rounded-3xl',
    body: 'flex flex-1 flex-col gap-4 p-7',
    primary: 'text-9xl font-black tabular-nums tracking-tight leading-none',
    // TV mode lives inside a viewport-filling grid (see <SqcdpGrid>'s
    // `flex h-full flex-col` + `auto-rows-fr` chain). Every card in a
    // row is the same stretched height, so we get baseline alignment
    // "for free" by letting the value block flex-grow inside the body
    // and bottom-anchor — no need to bake in a `min-h-[16rem]` worst-
    // case reserve, which used to leave ~half a card's worth of dead
    // space above single-line values ("848 Days" floating mid-card)
    // when the card was tall.
    primaryReserve: 'flex flex-1 items-end min-h-0',
    subPrimary: 'text-7xl font-black tabular-nums tracking-tight leading-none',
    // Sub-metric reserve follows the same logic — flex-grow within the
    // stacked-mode wrapper instead of a hardcoded 5.5rem reservation.
    subPrimaryReserve: 'flex flex-1 items-end min-h-0',
    subTitle:
      'text-base font-semibold uppercase tracking-wide text-foreground/90',
    subSubtitle: 'text-sm text-muted-foreground',
    subtitle: 'text-base text-muted-foreground',
    target: 'text-sm text-muted-foreground tabular-nums',
    // Header layout chrome. Padding / justify come from `headerClasses(...)`
    // at render time (see normal density above for the rationale).
    header: 'flex items-center gap-4 px-7',
    headerTitle:
      'text-4xl font-bold uppercase tracking-tight text-white truncate',
    headerIconSize: 'h-7 w-7 text-white/95 shrink-0',
    headerEditButton:
      'h-10 w-10 text-white/85 hover:bg-white/15 hover:text-white focus-visible:ring-white/40',
    label: 'text-sm font-semibold uppercase tracking-wider',
    iconSize: 'h-5 w-5',
    shadow: SHADOW_TV,
    chartStrip: 'border-t border-border/30 px-4 pt-3 pb-4',
    trendIconSize: 'h-10 w-10',
    comparison: 'text-sm text-muted-foreground tabular-nums',
  },
}

interface SurfaceProps {
  color: string
  density: SqcdpCardDensity
  children: React.ReactNode
  className?: string
  mountAnimation?: boolean
  /**
   * v12 — when true, the card stretches its `min-h` to better hold a
   * stacked sub-metrics layout + a chart strip without cramping. Single
   * mode keeps the v11.x heights.
   */
  stackedMode?: boolean
}

function CardSurface({
  color,
  density,
  children,
  className,
  mountAnimation = true,
  stackedMode = false,
}: SurfaceProps) {
  const d = DENSITY[density]
  const style: CSSProperties = { ['--accent-color' as string]: color }
  return (
    <div
      style={style}
      className={cn(
        // `h-full` makes the card stretch to its grid row height — the
        // parent grid uses `align-items: stretch` so every card in a row
        // matches the tallest. Pairs with `flex-1` on the body so the
        // chart strip anchors at the bottom regardless of how many lines
        // the big-number value wraps to.
        'group border-border/60 bg-card relative isolate flex h-full flex-col overflow-hidden border',
        d.card,
        // v12 — bump min-height in stacked mode so 2-3 sub-metrics + a
        // chart strip have room without cramping. Single mode keeps its
        // grid-stretch behavior unchanged.
        stackedMode && (density === 'tv' ? 'min-h-144' : 'min-h-96'),
        'bg-linear-to-b from-white/4 via-transparent to-transparent',
        d.shadow,
        'transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'motion-safe:hover:-translate-y-0.5',
        // Mount-in animation when not orchestrated by a parent (per
        // [[Elevated-KPI-Stat-Cards]] v5).
        mountAnimation &&
          'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-backwards motion-safe:duration-500',
        className
      )}
    >
      {/*
       * v11.3 dropped the 4 px top color band — the colored header
       * strip rendered by `<SqcdpCard>` covers the same accent
       * function and reads as a substantial scorecard band rather
       * than a hairline. Header inherits rounded top corners via
       * the parent's `overflow-hidden`.
       */}
      {children}
    </div>
  )
}

type Trend = 'up' | 'down' | 'flat' | 'none'

/**
 * Compute trend direction from the last two history points.
 * Returns 'none' when fewer than 2 points are available.
 */
function computeTrend(history: { value: number }[]): {
  trend: Trend
  previous: number | null
} {
  if (history.length < 2) return { trend: 'none', previous: null }
  const last = history[history.length - 1]
  const prev = history[history.length - 2]
  if (last.value > prev.value) return { trend: 'up', previous: prev.value }
  if (last.value < prev.value) return { trend: 'down', previous: prev.value }
  return { trend: 'flat', previous: prev.value }
}

/**
 * Map (trend, lower_is_better) → tailwind text color class. When
 * `lowerIsBetter` is true, ↑ = bad (red), ↓ = good (emerald) — the
 * polarity flips because for defects / cost / incidents, fewer is better.
 * Flat is always muted.
 */
function trendColorClass(trend: Trend, lowerIsBetter: boolean): string {
  if (trend === 'flat' || trend === 'none') return 'text-muted-foreground/70'
  if (lowerIsBetter) {
    return trend === 'up' ? 'text-red-600' : 'text-emerald-600'
  }
  return trend === 'up' ? 'text-emerald-600' : 'text-red-600'
}

interface TrendIndicatorProps {
  trend: Trend
  lowerIsBetter: boolean
  sizeClass: string
  /**
   * Optional inline width/height override. v15.2 uses this to scale
   * the icon proportionally to the measured hero px so the arrow
   * tracks the hero across viewports without re-introducing a
   * separate clamp expression.
   */
  sizeStyle?: CSSProperties
  ariaLabel: string
}

function TrendIndicator({
  trend,
  lowerIsBetter,
  sizeClass,
  sizeStyle,
  ariaLabel,
}: TrendIndicatorProps) {
  if (trend === 'none') return null
  const Icon =
    trend === 'up'
      ? IconTrendingUp
      : trend === 'down'
        ? IconTrendingDown
        : IconArrowRight
  return (
    <Icon
      className={cn(sizeClass, trendColorClass(trend, lowerIsBetter))}
      style={sizeStyle}
      aria-label={ariaLabel}
      data-testid='sqcdp-trend-indicator'
      data-trend={trend}
    />
  )
}

/**
 * Resolved numeric value for the card's primary number. Returns the
 * live-computed counter when `metric.autoValueConfig` is active,
 * otherwise the static `currentValue`. `now` is passed in so render-
 * time consumers can share a single `Date.now()` capture (and so the
 * card unit tests stay deterministic).
 */
function resolvePrimaryNumber(
  metric: SqcdpMetricRow,
  now: number
): number | null {
  if (isAutoValueActive(metric.autoValueConfig)) {
    return computeAutoValue(metric.autoValueConfig, now)
  }
  return metric.currentValue
}

/**
 * Render the styled big primary value (single-mode) — applies prefix /
 * suffix / decimal_places + the per-field font/size/weight overrides.
 * `now` lets the auto-counter codepath stay pure for the tests; in
 * production callers pass the value from `useAutoValueClock`.
 */
function renderPrimaryValue(metric: SqcdpMetricRow, now: number): string {
  if (metric.valueFormat === 'text') {
    return formatValue(metric.valueFormat, metric.subtitle, metric.unit)
  }
  return formatValueWithOptions(
    metric.valueFormat,
    resolvePrimaryNumber(metric, now),
    metric.unit,
    {
      prefix: metric.valuePrefix,
      suffix: metric.valueSuffix,
      decimal_places: metric.decimalPlaces,
    }
  )
}

/**
 * Once-per-minute clock used by cards in auto-counter mode. Returns a
 * `now` epoch the renderer can pass through `computeAutoValue`. When
 * no auto-counter is active the hook returns a stable timestamp (the
 * mount moment) so it doesn't cause needless re-renders.
 *
 * Tick cadence is mode-aware (`tickIntervalFor`) so weekly/monthly
 * counters don't burn renders 60× per minute. Pauses while the tab is
 * hidden so background cards don't churn the React tree.
 */
function useAutoValueClock(metric: SqcdpMetricRow | null): number {
  const cfg = metric?.autoValueConfig
  const active = isAutoValueActive(cfg)
  const interval = tickIntervalFor(cfg?.mode)
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    if (!active) return
    if (typeof window === 'undefined') return
    let timer: number | null = null
    let visibilityHandler: (() => void) | null = null
    const start = (): void => {
      if (timer !== null) return
      timer = window.setInterval(() => {
        setNow(Date.now())
      }, interval)
    }
    const stop = (): void => {
      if (timer !== null) {
        window.clearInterval(timer)
        timer = null
      }
    }
    if (
      typeof document === 'undefined' ||
      document.visibilityState === 'visible'
    ) {
      start()
    }
    if (typeof document !== 'undefined') {
      visibilityHandler = (): void => {
        if (document.visibilityState === 'visible') {
          setNow(Date.now())
          start()
        } else {
          stop()
        }
      }
      document.addEventListener('visibilitychange', visibilityHandler)
    }
    return () => {
      stop()
      if (visibilityHandler && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibilityHandler)
      }
    }
  }, [active, interval])

  return now
}

interface SubMetricBlockProps {
  sub: SubMetric
  /** Stable parent metric id — used to scope sub-metric ids in the fit registry. */
  metricId: string
  density: SqcdpCardDensity
  styleConfig: StyleConfig
  /** Show divider above this block (false on the first block). */
  showDivider: boolean
}

function SubMetricBlock({
  sub,
  metricId,
  density,
  styleConfig,
  showDivider,
}: SubMetricBlockProps): ReactNode {
  const d = DENSITY[density]
  const subDefaults: Required<FieldStyle> = {
    ...DEFAULT_STYLES.title,
    // Sub-metric titles get a smaller default than the colored-header
    // variant — they're inline blocks inside the body, not a saturated band.
    size: density === 'tv' ? 'base' : 'sm',
    transform: 'uppercase',
  }
  const titleClasses = fieldClasses(styleConfig.title, subDefaults)
  const titleInline = fieldInlineStyle(styleConfig.title, subDefaults)
  const subtitleClasses = fieldClasses(
    styleConfig.subtitle,
    DEFAULT_STYLES.subtitle
  )
  const subtitleInline = fieldInlineStyle(
    styleConfig.subtitle,
    DEFAULT_STYLES.subtitle
  )
  const primaryClasses = fieldClasses(
    styleConfig.primary,
    DEFAULT_STYLES.primary
  )
  const primaryInline = fieldInlineStyle(
    styleConfig.primary,
    DEFAULT_STYLES.primary
  )
  const formatted = formatValueWithOptions(
    sub.value_format,
    sub.value,
    sub.unit,
    {
      decimal_places: sub.decimal_places,
    }
  )
  // v15.2 — measured uniform sizing kicks in for TV density when the
  // curator hasn't pinned a `primary.size` (enum) OR `sizePt` (pt)
  // override. Sub-metric blocks share the metric's `styleConfig.primary`
  // for value-text styling.
  const useMeasured = density === 'tv' && !isSizePinned(styleConfig.primary)
  const fit = useUniformHeroFit({
    enabled: useMeasured,
    tier: 'sub',
    id: `${metricId}::${sub.id}`,
    text: formatted,
  })
  return (
    <div
      className={cn(
        'flex flex-col gap-1',
        showDivider && 'border-border/30 mt-2 border-t pt-2',
        // Each block still claims an equal share of the stacked-mode
        // wrapper's height — that's a layout concern (so 1 / 2 / 3
        // sub-metric stacks distribute evenly) independent of the
        // typography model. v15.2 the value font size itself is driven
        // by JS measurement so siblings within the tier render at the
        // same px regardless of per-block height.
        density === 'tv' && 'min-h-0 flex-1'
      )}
      data-testid='sqcdp-sub-metric-block'
    >
      <div
        className={cn(titleClasses, 'text-foreground/80')}
        style={titleInline}
      >
        {sub.title}
      </div>
      <div
        ref={useMeasured ? fit.ref : undefined}
        className={cn(
          d.subPrimary,
          d.subPrimaryReserve,
          primaryClasses,
          useMeasured &&
            (fit.overflow ? TV_MEASURED_SUB_OVERFLOW : TV_MEASURED_SUB),
          // Hide the value for paint-frame 0 so the initial-px fallback
          // doesn't flash before the measured size lands. `ready`
          // flips to true after the first compute pass.
          useMeasured && !fit.ready && 'opacity-0'
        )}
        // Order matters: measured-fit's inline `fontSize` must win when
        // active, otherwise curator's pt override wins, otherwise the
        // tier-class supplied via primaryClasses wins. The merge order
        // here (primary inline → measured-fit) is fine because measured
        // is gated on `!isSizePinned`, so they never both apply.
        style={{
          ...primaryInline,
          ...(useMeasured ? fit.style : undefined),
        }}
        data-testid='sqcdp-sub-metric-value'
      >
        {formatted}
      </div>
      {sub.subtitle && (
        <div
          className={cn(subtitleClasses, d.subSubtitle)}
          style={subtitleInline}
        >
          {sub.subtitle}
        </div>
      )}
    </div>
  )
}

export function SqcdpCard({
  category,
  metric,
  density = 'normal',
  index = 0,
  mountAnimation = true,
  onEdit,
  onCreate,
  categoryOverride,
}: SqcdpCardProps) {
  const d = DENSITY[density]
  const ctx = useSqcdpCategoriesContext()
  // Resolve order: explicit prop > org categories list > builtin fallback.
  const def = categoryOverride ?? getCategory(category, ctx.categories) ?? null
  const { canEdit } = useCanEditBoards()
  const [editMode] = useBoardEditMode()
  const showEditAffordances = canEdit && editMode

  // Auto-counter clock (v16) — must run on every render per the Rules
  // of Hooks. Pauses internally when the metric isn't in auto mode so
  // most cards pay only the mount cost.
  const now = useAutoValueClock(metric)

  // Pre-compute v15.2 measured-fit hook args BEFORE any early returns so
  // the hook is called on every render (Rules of Hooks). When metric /
  // def is missing OR when conditions don't allow measured sizing, we
  // pass `enabled: false` so the hook short-circuits and remains a
  // no-op. The fit result is then read inside the populated branch.
  const styleConfigForFit = metric?.styleConfig ?? {}
  const isStackedModeForFit = (metric?.subMetrics.length ?? 0) >= 1
  const tierForFit: HeroTier =
    def?.tier === 'primary' ? 'primary' : 'secondarySingle'
  const renderedPrimaryValueForFit = metric
    ? renderPrimaryValue(metric, now)
    : ''
  const useMeasuredForFit =
    !!metric &&
    !!def &&
    density === 'tv' &&
    !isSizePinned(styleConfigForFit.primary)
  const primaryFit = useUniformHeroFit({
    enabled: useMeasuredForFit && !isStackedModeForFit,
    tier: tierForFit,
    id: metric?.id ?? `${category}::no-metric`,
    text: renderedPrimaryValueForFit,
  })

  if (!def) {
    // Category metadata missing entirely — render a degraded placeholder
    // rather than crashing. Surfaces in dev when the slug doesn't match
    // any category (typically a backend-side mismatch the curator should
    // fix via the manager dialog).
    return (
      <div
        className='border-border/40 bg-muted/30 flex h-full min-h-[160px] items-center justify-center rounded-2xl border border-dashed p-4 text-center'
        data-testid='sqcdp-card-missing-category'
      >
        <span className='text-muted-foreground text-xs'>
          Unknown category &quot;{category}&quot;.
        </span>
      </div>
    )
  }

  const Icon = def.Icon
  const isPrimary = def.tier === 'primary'

  if (!metric) {
    const color = defaultColorFor(category, ctx.categories)
    return (
      <button
        type='button'
        disabled={!showEditAffordances}
        onClick={() => onCreate?.(category)}
        className={cn(
          'group border-border/60 bg-card/40 relative flex h-full min-h-[200px] flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-dashed p-5 text-center transition-colors',
          showEditAffordances
            ? 'hover:border-border hover:bg-card cursor-pointer'
            : 'cursor-not-allowed opacity-60'
        )}
      >
        <div
          aria-hidden
          className='-mx-5 -mt-5 mb-1 h-1 w-full self-stretch'
          style={{ backgroundColor: color }}
        />
        <div className='flex items-center gap-2'>
          <Icon className={cn(d.iconSize)} style={{ color }} aria-hidden />
          <span className={d.label} style={{ color }}>
            {def.label}
          </span>
        </div>
        {showEditAffordances ? (
          <div className='text-muted-foreground inline-flex items-center gap-2 text-sm'>
            <IconPlus className='h-4 w-4' aria-hidden />
            Add metric
          </div>
        ) : (
          <p className='text-muted-foreground text-xs'>No metric set</p>
        )}
      </button>
    )
  }

  const color =
    metric.colorHex ?? defaultColorFor(metric.category, ctx.categories)
  const periodLabel = PERIOD_LABELS[metric.trendPeriod] ?? metric.trendPeriod
  const subMetrics = metric.subMetrics
  const isStackedMode = subMetrics.length >= 1

  const styleConfig = metric.styleConfig ?? {}
  const headerCfg = styleConfig.header ?? DEFAULT_HEADER
  const showHeaderIcon = headerCfg.showIcon ?? DEFAULT_HEADER.showIcon

  const titleClasses = fieldClasses(styleConfig.title, DEFAULT_STYLES.title)
  const titleInline = fieldInlineStyle(styleConfig.title, DEFAULT_STYLES.title)
  const subtitleClasses = fieldClasses(
    styleConfig.subtitle,
    DEFAULT_STYLES.subtitle
  )
  const subtitleInline = fieldInlineStyle(
    styleConfig.subtitle,
    DEFAULT_STYLES.subtitle
  )
  // Density's leading/tracking-tight/tabular-nums concerns are locked
  // for visual coherence; per-field overrides via fieldClasses +
  // fieldInlineStyle control the size/weight/font/transform/align/
  // letterSpacing/italic/underline/lineHeight dimensions.
  const primaryClasses = fieldClasses(
    styleConfig.primary,
    DEFAULT_STYLES.primary
  )
  const primaryInline = fieldInlineStyle(
    styleConfig.primary,
    DEFAULT_STYLES.primary
  )
  // The primary value falls back to the category accent when no
  // curator-supplied color is present — keep this fallback chain intact
  // so SQCDP cards still glow with their category palette by default.
  const primaryColor =
    fieldColor(styleConfig.primary, DEFAULT_STYLES.primary) ?? color

  const { trend, previous } = computeTrend(metric.history)
  // v12 painted both the trend arrow and the comparison subtext whenever
  // history had ≥ 2 points. v12.1 added an explicit per-metric opt-out so
  // curators can hide both on cards that read better as just the headline
  // number — `metric.showTrend === false` suppresses BOTH the arrow and
  // the "vs N {previous}" line below it.
  const trendEnabled =
    metric.showTrend && isPrimary && !isStackedMode && trend !== 'none'
  const showComparison = metric.showTrend && previous !== null
  const comparisonLabel = COMPARISON_LABELS[metric.trendPeriod] ?? 'previously'
  // v15.2 measured-fit gate (definitive — the pre-return computation
  // above used loose nullable typing so the hook always runs). Here we
  // re-derive against the now-known-defined `metric` + `def`.
  const useMeasured = density === 'tv' && !isSizePinned(styleConfig.primary)
  const renderedPrimaryValue = renderPrimaryValue(metric, now)
  // Trend icon tracks the hero scale at ~50% with a hard ceiling so
  // the arrow doesn't balloon past the card on huge viewports.
  const measuredHeroPx = primaryFit.sizePx
  const measuredIconStyle: CSSProperties | undefined =
    measuredHeroPx != null
      ? (() => {
          const px = Math.max(28, Math.min(measuredHeroPx * 0.5, 80))
          return { width: `${px}px`, height: `${px}px` }
        })()
      : undefined

  return (
    <CardSurface
      color={color}
      density={density}
      mountAnimation={mountAnimation}
      stackedMode={isStackedMode && isPrimary}
    >
      {/*
       * v11.3 colored header strip — replaces the 4 px top accent
       * band. Icon + title sit inline on the saturated accent; the
       * pencil edit affordance is hover-revealed in the right slot.
       * Bottom inset shadow gives a hairline separator into the
       * neutral meta block. White text passes WCAG AA "large text"
       * (≥ 3.0:1) on every canonical SQCDP accent — see
       * [[Implement-Production-Boards-Hourly-Grid]] § v11.3.
       */}
      <div
        className={cn(
          d.header,
          headerClasses(headerCfg, density),
          headerOuterClasses(headerCfg),
          'shadow-[inset_0_-1px_0_rgba(0,0,0,0.10)]'
        )}
        style={{ backgroundColor: color }}
      >
        <div
          className={cn(
            'flex min-w-0 items-center gap-2.5',
            headerGroupClasses(headerCfg)
          )}
        >
          {showHeaderIcon && <Icon className={d.headerIconSize} aria-hidden />}
          <h3 className={cn(d.headerTitle, titleClasses)} style={titleInline}>
            {def.label}
          </h3>
        </div>
        {showEditAffordances && (
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className={cn(
              d.headerEditButton,
              'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100'
            )}
            onClick={() => onEdit?.(metric)}
            aria-label={`Edit ${metric.title}`}
          >
            <IconPencil className='h-4 w-4' aria-hidden />
          </Button>
        )}
      </div>

      <div
        className={d.body}
        data-testid='sqcdp-card-body'
        data-stacked={isStackedMode ? 'true' : 'false'}
      >
        {isStackedMode ? (
          <div
            className={cn(
              'flex flex-col',
              // TV mode: let the stacked block consume the body's
              // available vertical space so multiple sub-metrics
              // distribute their own flex-1 reserves evenly across
              // the stretched card height (see DENSITY.tv).
              density === 'tv' && 'min-h-0 flex-1'
            )}
          >
            {subMetrics.map((sub, i) => (
              <SubMetricBlock
                key={sub.id}
                sub={sub}
                metricId={metric.id}
                density={density}
                styleConfig={metric.styleConfig}
                showDivider={i > 0}
              />
            ))}
          </div>
        ) : (
          <div
            className={cn(
              'flex flex-col gap-1',
              // TV mode: grow into the body so the value block's own
              // `flex-1` has actual space to expand into and bottom-
              // anchor against. Without this the wrapper sizes to
              // content and the in-card "flex-1" collapses to zero.
              density === 'tv' && 'min-h-0 flex-1'
            )}
          >
            <div
              className={cn(
                d.primary,
                primaryClasses,
                // primaryReserve carries the items-end + size policy.
                // Normal density still reserves a 2-line worst case
                // (`min-h-[9rem]`) so "475" (1 line) and "848 Days"
                // (2 lines) share a baseline across the row. TV
                // density drops the hard min-h and uses flex-1
                // instead (see DENSITY.tv) so the row's stretched
                // height alone drives baseline alignment.
                d.primaryReserve,
                'flex items-end gap-3',
                'dark:[text-shadow:0_1px_0_rgba(255,255,255,0.04)]'
              )}
              style={{ color: primaryColor, ...primaryInline }}
            >
              {/*
               * v15.2 — the registered element is this inner wrapper
               * (not the outer flex row) so the measurement's
               * available-width reading factors in the trend icon
               * sitting as a flex sibling. The wrapper is `min-w-0
               * flex-1` so the icon gets its natural width first and
               * the value text takes whatever's left over — which is
               * exactly what we want to measure against.
               */}
              <div
                ref={useMeasured && !isStackedMode ? primaryFit.ref : undefined}
                className={cn(
                  'min-w-0 flex-1',
                  useMeasured &&
                    !isStackedMode &&
                    (primaryFit.overflow
                      ? TV_MEASURED_HERO_OVERFLOW
                      : TV_MEASURED_HERO),
                  useMeasured &&
                    !isStackedMode &&
                    !primaryFit.ready &&
                    'opacity-0'
                )}
                style={
                  useMeasured && !isStackedMode ? primaryFit.style : undefined
                }
                data-testid='sqcdp-primary-value'
              >
                {renderedPrimaryValue}
              </div>
              {trendEnabled && (
                <TrendIndicator
                  trend={trend}
                  lowerIsBetter={metric.lowerIsBetter}
                  sizeClass={d.trendIconSize}
                  sizeStyle={useMeasured ? measuredIconStyle : undefined}
                  ariaLabel={`Trend ${trend}${
                    metric.lowerIsBetter ? ' (lower is better)' : ''
                  }`}
                />
              )}
            </div>
            <div
              className={cn(d.subtitle, subtitleClasses)}
              style={subtitleInline}
            >
              {metric.subtitle ?? metric.title}
            </div>
            {showComparison && (
              <div
                className={d.comparison}
                data-testid='sqcdp-comparison-value'
              >
                vs{' '}
                {formatValueWithOptions(
                  metric.valueFormat,
                  previous,
                  metric.unit,
                  {
                    prefix: metric.valuePrefix,
                    suffix: metric.valueSuffix,
                    decimal_places: metric.decimalPlaces,
                  }
                )}{' '}
                {comparisonLabel}
              </div>
            )}
          </div>
        )}

        {/* `mt-auto` pushes the target/period row (and the optional
            "Updated …" row that follows) to the bottom of the meta block
            — i.e. just above the chart strip on primary cards, and to
            the bottom of the card on secondary cards. Keeps the spacing
            between the period chip and the chart consistent regardless
            of how tall the row stretched to. */}
        <div className='mt-auto flex items-center justify-between gap-2 text-xs'>
          {metric.targetValue != null ? (
            <span className={d.target}>
              Target:{' '}
              {formatValue(metric.valueFormat, metric.targetValue, metric.unit)}
            </span>
          ) : (
            <span aria-hidden className='inline-block' />
          )}
          <span className='bg-muted/50 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase'>
            {periodLabel}
          </span>
        </div>

        {metric.lastDataAt && (
          <div className='text-muted-foreground text-[10px] tabular-nums'>
            Updated{' '}
            {new Date(metric.lastDataAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </div>
        )}
      </div>

      {isPrimary && (
        <div className={d.chartStrip}>
          <SqcdpChart
            metric={metric}
            density={density}
            animationDelay={index * 60}
          />
        </div>
      )}
    </CardSurface>
  )
}

// Created and developed by Jai Singh
