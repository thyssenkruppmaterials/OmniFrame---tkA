// Created and developed by Jai Singh
import { useMemo, type CSSProperties } from 'react'
import {
  IconChecks,
  IconClockHour4,
  IconTarget,
  IconUsers,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { computeBoardMetrics } from '../lib/hour-bucket'
import type {
  AssociateRow,
  BoardDensity,
  BoardMetrics as BoardMetricsValue,
  HourBucket,
  HourTargets,
  TargetRamp,
} from '../lib/types'

interface BoardMetricsProps {
  associates: AssociateRow[]
  hourBuckets: Map<string, Map<number, HourBucket>>
  hourTargets: HourTargets
  isToday: boolean
  timezone: string
  density?: BoardDensity
  isLoading?: boolean
  /** Optional pre-computed metrics — when provided, skips the inline compute. */
  metrics?: BoardMetricsValue
  /**
   * Source label for the Target Achievement subtitle. Defaults to
   * 'Default 100/hr' when settings are at the in-code fallback.
   */
  targetSourceLabel?: string
  className?: string
}

const RAMP_TEXT: Record<TargetRamp, string> = {
  above: 'text-emerald-600 dark:text-emerald-400',
  on: 'text-emerald-600/80 dark:text-emerald-400/80',
  below: 'text-emerald-600/60 dark:text-emerald-400/50',
  muted: 'text-muted-foreground',
}

type AccentKey = 'sky' | 'emerald' | 'amber' | 'violet'

interface AccentTokens {
  iconBg: string
  iconRing: string
  accentLine: string
  /** rgba string used as the radial-gradient anchor on hover */
  glow: string
}

const ACCENTS: Record<AccentKey, AccentTokens> = {
  sky: {
    iconBg: 'bg-sky-500/10 text-sky-500 dark:bg-sky-500/15 dark:text-sky-400',
    iconRing: 'ring-sky-500/20 dark:ring-sky-400/25',
    accentLine: 'via-sky-500/60 dark:via-sky-400/55',
    glow: 'rgba(56,189,248,0.10)',
  },
  emerald: {
    iconBg:
      'bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/15 dark:text-emerald-400',
    iconRing: 'ring-emerald-500/20 dark:ring-emerald-400/25',
    accentLine: 'via-emerald-500/60 dark:via-emerald-400/55',
    glow: 'rgba(16,185,129,0.10)',
  },
  amber: {
    iconBg:
      'bg-amber-500/10 text-amber-500 dark:bg-amber-500/15 dark:text-amber-400',
    iconRing: 'ring-amber-500/20 dark:ring-amber-400/25',
    accentLine: 'via-amber-500/60 dark:via-amber-400/55',
    glow: 'rgba(245,158,11,0.10)',
  },
  violet: {
    iconBg:
      'bg-violet-500/10 text-violet-500 dark:bg-violet-500/15 dark:text-violet-400',
    iconRing: 'ring-violet-500/20 dark:ring-violet-400/25',
    accentLine: 'via-violet-500/60 dark:via-violet-400/55',
    glow: 'rgba(139,92,246,0.10)',
  },
}

interface DensityTokens {
  /** Outer grid wrapping the four cards. */
  grid: string
  /** Card outer container. */
  card: string
  /** Inner padding + flex container around the card body. */
  body: string
  iconWrap: string
  icon: string
  label: string
  primary: string
  secondary: string
  /** Hover lift translate amount. */
  hoverLift: string
  /** Box-shadow pair for resting + hover, light + dark — kept on the card class. */
  shadow: string
}

// Two-layer elevation, neutral palette, ramps gently into the background.
// Stops:
//   1. inset 1px highlight — top-edge sheen
//   2. tight 1–2px ambient — defines the silhouette
//   3. wide soft drop — lifts the card off the page
const SHADOW_NORMAL = [
  // Light
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_1px_2px_0_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(15,23,42,0.18)]',
  // Dark
  'dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_2px_4px_0_rgba(0,0,0,0.5),0_24px_48px_-12px_rgba(0,0,0,0.55)]',
  // Light hover
  'motion-safe:hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_2px_4px_0_rgba(0,0,0,0.08),0_16px_40px_-12px_rgba(15,23,42,0.25)]',
  // Dark hover
  'motion-safe:dark:hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_4px_8px_0_rgba(0,0,0,0.55),0_32px_64px_-16px_rgba(0,0,0,0.6)]',
].join(' ')

const SHADOW_TV = [
  // Light
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_2px_4px_0_rgba(0,0,0,0.07),0_24px_48px_-16px_rgba(15,23,42,0.28)]',
  // Dark
  'dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_4px_8px_0_rgba(0,0,0,0.55),0_40px_80px_-20px_rgba(0,0,0,0.65)]',
  // Light hover
  'motion-safe:hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_4px_8px_0_rgba(0,0,0,0.10),0_32px_64px_-16px_rgba(15,23,42,0.32)]',
  // Dark hover
  'motion-safe:dark:hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07),0_6px_12px_0_rgba(0,0,0,0.6),0_48px_96px_-24px_rgba(0,0,0,0.7)]',
].join(' ')

const DENSITY_TOKENS = {
  normal: {
    grid: 'grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-5',
    card: 'rounded-2xl',
    body: 'relative flex flex-col gap-1.5 p-5 lg:p-6',
    iconWrap: 'flex h-7 w-7 items-center justify-center rounded-md',
    icon: 'h-4 w-4',
    label: 'text-muted-foreground text-xs font-medium uppercase tracking-wide',
    primary: 'text-3xl font-semibold tabular-nums tracking-tight',
    secondary: 'text-muted-foreground text-xs',
    hoverLift: 'motion-safe:hover:-translate-y-0.5',
    shadow: SHADOW_NORMAL,
  },
  tv: {
    grid: 'grid grid-cols-2 gap-6 lg:grid-cols-4',
    card: 'rounded-3xl',
    body: 'relative flex flex-col gap-2 p-8',
    iconWrap: 'flex h-10 w-10 items-center justify-center rounded-lg',
    icon: 'h-6 w-6',
    label: 'text-muted-foreground text-sm font-medium uppercase tracking-wide',
    primary: 'text-5xl font-semibold tabular-nums tracking-tight',
    secondary: 'text-muted-foreground text-base',
    hoverLift: 'motion-safe:hover:-translate-y-1',
    shadow: SHADOW_TV,
  },
} as const satisfies Record<BoardDensity, DensityTokens>

interface KpiCardInput {
  label: string
  primary: string
  secondary: string
  accent: AccentKey
  Icon: typeof IconUsers
  primaryClass?: string
  ariaLabel: string
}

function KpiCard({
  label,
  primary,
  secondary,
  accent,
  Icon,
  primaryClass,
  ariaLabel,
  density,
  index,
}: KpiCardInput & { density: BoardDensity; index: number }) {
  const d = DENSITY_TOKENS[density]
  const a = ACCENTS[accent]
  // CSS variable so a single radial-gradient class can be color-themed per
  // KPI without baking dynamic class strings the JIT can't see.
  const glowVar = { '--kpi-glow': a.glow } as CSSProperties

  return (
    <div
      role='group'
      aria-label={ariaLabel}
      style={{
        ...glowVar,
        animationDelay: `${index * 60}ms`,
      }}
      className={cn(
        // Base surface
        'group border-border/60 bg-card relative isolate overflow-hidden border',
        d.card,
        // Soft top-light gradient — the "pop" hint
        'bg-linear-to-b from-white/4 via-transparent to-transparent',
        // Elevation
        d.shadow,
        // Hover lift + shadow transition
        'transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        d.hoverLift,
        // Subtle mount-in: stagger via inline animationDelay above. motion-safe so
        // prefers-reduced-motion users see the static elevation only.
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-backwards motion-safe:duration-500'
      )}
    >
      {/* Top accent — color-coded thin line tying the card to its KPI accent */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-3 top-0 h-px rounded-full',
          'bg-linear-to-r from-transparent to-transparent',
          a.accentLine
        )}
      />

      {/* Subtle radial glow, on hover only — uses --kpi-glow set via inline style. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 opacity-0',
          'bg-[radial-gradient(120%_60%_at_50%_0%,var(--kpi-glow),transparent_60%)]',
          'motion-safe:transition-opacity motion-safe:duration-500',
          'motion-safe:group-hover:opacity-100'
        )}
      />

      <div className={d.body}>
        <div className='flex items-center gap-2'>
          <div
            className={cn(
              d.iconWrap,
              a.iconBg,
              'ring-1 ring-inset',
              a.iconRing,
              // Inner micro-elevation so the tile reads as its own surface,
              // not a flat patch on the card.
              'shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
            )}
          >
            <Icon className={d.icon} aria-hidden />
          </div>
          <span className={d.label}>{label}</span>
        </div>
        <div
          className={cn(
            d.primary,
            // Tactile 1px top-highlight on the big number — dark mode only.
            // Light mode reads fine without and a highlight there starts to
            // look like a print artefact.
            'dark:[text-shadow:0_1px_0_rgba(255,255,255,0.04)]',
            primaryClass
          )}
        >
          {primary}
        </div>
        <div className={d.secondary}>{secondary}</div>
      </div>
    </div>
  )
}

function MetricsSkeleton({ density }: { density: BoardDensity }) {
  const d = DENSITY_TOKENS[density]
  return (
    <div className={d.grid}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn(
            'border-border/60 bg-card border',
            d.card,
            d.shadow,
            // Mount fade for skeletons too — keeps the strip from popping in
            // when transitioning from skeleton → real cards.
            'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500'
          )}
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <div className={d.body}>
            <div className='flex items-center gap-2'>
              <Skeleton
                className={
                  density === 'tv'
                    ? 'h-10 w-10 rounded-lg'
                    : 'h-7 w-7 rounded-md'
                }
              />
              <Skeleton className='h-3 w-24' />
            </div>
            <Skeleton className={density === 'tv' ? 'h-12 w-32' : 'h-8 w-20'} />
            <Skeleton className='h-3 w-32' />
          </div>
        </div>
      ))}
    </div>
  )
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

export function BoardMetrics({
  associates,
  hourBuckets,
  hourTargets,
  isToday,
  timezone,
  density = 'normal',
  isLoading = false,
  metrics,
  targetSourceLabel,
  className,
}: BoardMetricsProps) {
  const computed = useMemo<BoardMetricsValue>(
    () =>
      metrics ??
      computeBoardMetrics({
        associates,
        hourBuckets,
        hourTargets,
        isToday,
        timezone,
      }),
    [metrics, associates, hourBuckets, hourTargets, isToday, timezone]
  )

  if (isLoading)
    return (
      <div className={className}>
        <MetricsSkeleton density={density} />
      </div>
    )

  // Pre-open today — operating window hasn't started yet. Avg/Target are
  // unmeaningful (no hours-elapsed denominator); render an em-dash and a
  // helpful "Building opens at 6 AM" subtitle instead of 0/hr / 0%.
  const preOpenSubtitle = 'Building opens at 6 AM'
  const isPreOpen = computed.isPreOpen

  const paceLabel = isPreOpen
    ? preOpenSubtitle
    : computed.totalCompletions
      ? `Pace ${formatNumber(computed.avgPerHour)}/hr`
      : 'No completions yet'

  const targetSubtitle = isPreOpen
    ? preOpenSubtitle
    : targetSourceLabel
      ? `${targetSourceLabel} target`
      : `Target ${formatNumber(computed.targetPerHour)}/hr`

  const cards: KpiCardInput[] = [
    {
      label: 'Active Associates',
      primary: `${formatNumber(computed.activeAssociates)}`,
      secondary: `of ${formatNumber(computed.totalAssigned)} assigned`,
      accent: 'sky',
      Icon: IconUsers,
      ariaLabel: `Active associates, ${computed.activeAssociates}, of ${computed.totalAssigned} assigned`,
    },
    {
      label: 'Total Completions',
      primary: formatNumber(computed.totalCompletions),
      secondary: paceLabel,
      accent: 'emerald',
      Icon: IconChecks,
      ariaLabel: `Total completions, ${computed.totalCompletions}, pace ${computed.avgPerHour} per hour`,
    },
    {
      label: 'Average per Hour',
      primary: isPreOpen ? '—' : formatNumber(computed.avgPerHour),
      secondary: targetSubtitle,
      accent: 'amber',
      Icon: IconClockHour4,
      ariaLabel: isPreOpen
        ? 'Average completions per hour unavailable, building opens at 6 AM'
        : `Average completions per hour, ${computed.avgPerHour}`,
    },
    {
      label: 'Target Achievement',
      primary: isPreOpen
        ? '—'
        : `${formatNumber(computed.targetAchievementPercent)}%`,
      secondary: isPreOpen
        ? preOpenSubtitle
        : (targetSourceLabel ??
          `Default ${formatNumber(computed.targetPerHour)}/hr`),
      accent: 'violet',
      Icon: IconTarget,
      primaryClass: RAMP_TEXT[computed.ramp],
      ariaLabel: isPreOpen
        ? 'Target achievement unavailable, building opens at 6 AM'
        : `Target achievement, ${computed.targetAchievementPercent} percent`,
    },
  ]

  const d = DENSITY_TOKENS[density]
  return (
    <div className={cn(d.grid, className)}>
      {cards.map((card, index) => (
        <KpiCard key={card.label} {...card} density={density} index={index} />
      ))}
    </div>
  )
}

// Created and developed by Jai Singh
