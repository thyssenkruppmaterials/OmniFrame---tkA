// Created and developed by Jai Singh
/**
 * InventoryCompletionView — LX25 cross-warehouse cycle-count completion
 * dashboard (2026-05-10).
 *
 * Result renderer for the new "Inventory Completion" entry in the
 * SAP Testing → Inventory Management → Query Library → WAREHOUSE
 * category. Backed by the agent's `/sap/lx25/inventory-completion`
 * endpoint (capability `lx25-inventory-completion`).
 *
 * Surface (top-to-bottom):
 *   1. Aggregate stat card — full-width, prominent. Big completion %,
 *      bins counted / total, status pill.
 *   2. 5 per-warehouse cards in a `grid-cols-1 sm:grid-cols-2 lg:grid-cols-5`
 *      grid. Each card shows warehouse code + completion % + bins
 *      counted / total + per-status breakdown (executed / active /
 *      planned / not_executed). Failed warehouses render with a red
 *      badge + the SAP error message.
 *   3. Detail table — one row per (warehouse × storage type).
 *      Searchable, sortable, with a warehouse chip filter row above
 *      and a CSV export button.
 *
 * Empty state: helpful copy + a Run Query CTA. Loading state: 5
 * skeleton cards (one per warehouse, code visible) + a progress bar
 * placeholder.
 *
 * Uses the [[Patterns/Elevated-KPI-Stat-Cards]] visual recipe for the
 * stat tiles (top accent line + radial hover glow + multi-stop
 * shadow stack) so the page reads as a premium dashboard not an
 * inflated drop-shadow.
 *
 * Related:
 *   - [[Implementations/Implement-LX25-Inventory-Completion]]
 *   - [[Components/Inventory-Management - SAP Query Framework]]
 *   - [[Components/Omni-Agent - Headless SAP Agent]]
 *   - [[Patterns/Elevated-KPI-Stat-Cards]]
 */
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  ArrowUpAZ,
  ArrowUpDown,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Download,
  Layers,
  PlayCircle,
  RefreshCw,
  Search,
  Target,
  Warehouse,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
// Constants + types live in a sibling `.ts` file so this `.tsx`
// component file can stay a pure component file (avoids the
// react-refresh/only-export-components warning that triggers when a
// `.tsx` exports both a component and a non-component value). Both
// the FE and the agent's Python constant fall back to the same
// hardcoded list — see `inventory-completion-types.ts` for the
// authoritative definition.
import {
  LX25_WAREHOUSES,
  type InventoryCompletionMeta,
  type InventoryCompletionResult,
  type InventoryCompletionTotals,
  type InventoryCompletionWarehouse,
} from './inventory-completion-types'

interface InventoryCompletionViewProps {
  result: InventoryCompletionResult | null
  isRunning: boolean
  /** Best-effort progress label while the fan-out is in flight. The
   *  agent runs all 5 warehouses server-side in one call so we don't
   *  have true mid-flight progress; this is a placeholder shape that
   *  a future SSE/WS upgrade can drive. */
  progress: { current: number; total: number; label: string } | null
  lastRunAt: string | null
  onRefresh: () => void
}

// ──────────────────────────────────────────────────────────────────────
// Business rule: yearly cycle-count goal (10% per month)
// ──────────────────────────────────────────────────────────────────────
//
// The user's annual cycle-count goal is **100% by Dec 31** with linear
// monthly accrual: **10% per month**. So the year-to-date target at
// the END of month N is `N × 10%` — e.g. May (month 5) → 50%.
//
// Status thresholds key off the YTD goal so the pill reflects whether
// the user is ahead of plan, on plan, or trailing it:
//
//   ahead     pct >= ytdGoal            (at/past end-of-month goal)
//   on-track  pct >= ytdGoal - 10       (cleared LAST month's goal,
//                                        working through this month's)
//   at-risk   pct >= ytdGoal - 20       (one full month behind)
//   behind    pct <  ytdGoal - 20       (two+ months behind)
//
// Thresholds clamp to 0 so the early year (where the goal is small
// and `ytdGoal - 20` would be negative) doesn't surface a bogus
// `behind` status. e.g. January: ytdGoal=10, onTrack=0, atRisk=0 —
// any progress reads as on-track or ahead.
//
// Single source of truth — adjusting either of these constants
// rebalances every status threshold + the goal label on the card.
// ──────────────────────────────────────────────────────────────────────

const MONTHLY_GOAL_PCT = 10
const ANNUAL_GOAL_PCT = 100

interface GoalContext {
  /** 1-12, current calendar month (Jan=1, Dec=12). */
  currentMonth: number
  /** Year-to-date goal at the END of the current month (0-100). */
  ytdGoal: number
  /** Threshold at/above which the user is "ahead" (== ytdGoal). */
  aheadThreshold: number
  /** Threshold at/above which the user is "on track" — has cleared
   *  the PREVIOUS month's goal but not yet the current month's. */
  onTrackThreshold: number
  /** Threshold at/above which the user is "at risk" — one full month
   *  behind the current YTD pace. */
  atRiskThreshold: number
  /** Localized month name for display (e.g. "May"). */
  monthName: string
  /** Last day of the current month (used in the goal label so the
   *  user sees "Goal · 50% by May 31" with the right end-date even
   *  when the month has 30 / 28 / 29 days). */
  monthLastDay: number
}

/** Build the goal context from the supplied date. Pure — same input
 *  always returns the same `GoalContext`, so the caller can memoize
 *  on a stable date dependency without worrying about reference
 *  identity churn. */
function getGoalContext(now: Date): GoalContext {
  const currentMonth = now.getMonth() + 1
  const ytdGoal = Math.min(currentMonth * MONTHLY_GOAL_PCT, ANNUAL_GOAL_PCT)
  // Last day of the current month — `new Date(year, month, 0)` returns
  // the last day of the previous month (using a 1-indexed month), so
  // passing `now.getMonth() + 1` (which is `currentMonth`) gives the
  // last day of the current month.
  const monthLastDay = new Date(now.getFullYear(), currentMonth, 0).getDate()
  return {
    currentMonth,
    ytdGoal,
    aheadThreshold: ytdGoal,
    onTrackThreshold: Math.max(ytdGoal - MONTHLY_GOAL_PCT, 0),
    atRiskThreshold: Math.max(ytdGoal - 2 * MONTHLY_GOAL_PCT, 0),
    monthName: now.toLocaleString(undefined, { month: 'long' }),
    monthLastDay,
  }
}

// ──────────────────────────────────────────────────────────────────────
// Goal-aware status — replaces the prior absolute-threshold bucket
// (≥90 emerald / ≥70 amber / <70 red), which mis-classified a
// 57.6% reading in May (correctly AHEAD of the 50% YTD goal) as
// "AT RISK". See [[Sessions/2026-05-10]] § "Inventory Completion
// goal-aware status pill" for the full rationale.
// ──────────────────────────────────────────────────────────────────────

type CompletionStatusKey =
  | 'ahead'
  | 'on-track'
  | 'at-risk'
  | 'behind'
  | 'unknown'

interface CompletionStatusInfo {
  /** Which of the four (+ unknown) thresholds the value cleared. */
  status: CompletionStatusKey
  /** Pill label in display copy: 'AHEAD' / 'ON TRACK' / 'AT RISK' /
   *  'BEHIND' / 'NO DATA'. */
  label: string
  /** Signed delta vs the END-of-month goal, in pts. Positive when
   *  ahead, negative when behind. `null` when status is `unknown`
   *  (no completion %). */
  delta: number | null
  /** Pre-formatted delta text rendered alongside the pill label,
   *  e.g. `'+7.6 pts'` / `'-15.0 pts'`. `null` for on-track (where the
   *  delta is meaningful only inside the current month's bucket and
   *  surfacing it as a negative number reads as failure) and for
   *  unknown. */
  deltaText: string | null
  /** Lucide arrow component for the pill prefix, or `null` for
   *  on-track / unknown which read better without one. */
  IconComponent: React.ComponentType<{ className?: string }> | null
  numberClass: string
  badgeClass: string
  barClass: string
  accentLineClass: string
  glowRgba: string
  iconBgClass: string
  iconRingClass: string
}

const STATUS_VISUAL = {
  emerald: {
    numberClass: 'text-emerald-600 dark:text-emerald-400',
    badgeClass:
      'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    barClass: 'bg-emerald-500',
    accentLineClass: 'via-emerald-500/60 dark:via-emerald-400/55',
    glowRgba: 'rgba(16, 185, 129, 0.10)',
    iconBgClass:
      'bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/15 dark:text-emerald-400',
    iconRingClass: 'ring-emerald-500/20 dark:ring-emerald-400/25',
  },
  amber: {
    numberClass: 'text-amber-600 dark:text-amber-400',
    badgeClass:
      'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    barClass: 'bg-amber-500',
    accentLineClass: 'via-amber-500/60 dark:via-amber-400/55',
    glowRgba: 'rgba(245, 158, 11, 0.10)',
    iconBgClass:
      'bg-amber-500/10 text-amber-500 dark:bg-amber-500/15 dark:text-amber-400',
    iconRingClass: 'ring-amber-500/20 dark:ring-amber-400/25',
  },
  red: {
    numberClass: 'text-red-600 dark:text-red-400',
    badgeClass:
      'border-red-500/40 bg-red-500/10 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    barClass: 'bg-red-500',
    accentLineClass: 'via-red-500/60 dark:via-red-400/55',
    glowRgba: 'rgba(239, 68, 68, 0.10)',
    iconBgClass:
      'bg-red-500/10 text-red-500 dark:bg-red-500/15 dark:text-red-400',
    iconRingClass: 'ring-red-500/20 dark:ring-red-400/25',
  },
  muted: {
    numberClass: 'text-muted-foreground',
    badgeClass: 'border-border bg-muted text-muted-foreground',
    barClass: 'bg-muted-foreground/40',
    accentLineClass: 'via-muted-foreground/30',
    glowRgba: 'rgba(148, 163, 184, 0.10)',
    iconBgClass:
      'bg-muted text-muted-foreground dark:bg-muted/60 dark:text-muted-foreground',
    iconRingClass: 'ring-border',
  },
} as const

/** Format a signed delta as a `'+7.6 pts'` / `'-15.0 pts'` string. */
function formatDelta(delta: number): string {
  const sign = delta >= 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)} pts`
}

/** Resolve a completion percentage against the YTD goal context to a
 *  full status descriptor (label + delta + visual styles). */
function getCompletionStatus(
  pct: number | null | undefined,
  ctx: GoalContext
): CompletionStatusInfo {
  if (pct == null || Number.isNaN(pct)) {
    return {
      status: 'unknown',
      label: 'NO DATA',
      delta: null,
      deltaText: null,
      IconComponent: null,
      ...STATUS_VISUAL.muted,
    }
  }
  // Round to 1 decimal so the displayed delta matches the displayed
  // percentage (both formatted to 1dp). Avoids a `+7.6 pts` pill on a
  // `57.6%` value that would actually compute to `+7.5999…` raw.
  const delta = Math.round((pct - ctx.ytdGoal) * 10) / 10

  if (pct >= ctx.aheadThreshold) {
    return {
      status: 'ahead',
      label: 'AHEAD',
      delta,
      deltaText: formatDelta(delta),
      IconComponent: ArrowUp,
      ...STATUS_VISUAL.emerald,
    }
  }
  if (pct >= ctx.onTrackThreshold) {
    return {
      status: 'on-track',
      label: 'ON TRACK',
      // We compute the delta but DON'T surface it on the pill —
      // on-track means the user is inside the current month's bucket,
      // and a negative delta vs end-of-month would falsely imply
      // failure. The numeric delta is preserved on the returned shape
      // so a future tooltip / detail view can display it if useful.
      delta,
      deltaText: null,
      IconComponent: null,
      ...STATUS_VISUAL.emerald,
    }
  }
  if (pct >= ctx.atRiskThreshold) {
    return {
      status: 'at-risk',
      label: 'AT RISK',
      delta,
      deltaText: formatDelta(delta),
      IconComponent: ArrowDown,
      ...STATUS_VISUAL.amber,
    }
  }
  return {
    status: 'behind',
    label: 'BEHIND',
    delta,
    deltaText: formatDelta(delta),
    IconComponent: ArrowDown,
    ...STATUS_VISUAL.red,
  }
}

// ──────────────────────────────────────────────────────────────────────
// Number formatting
// ──────────────────────────────────────────────────────────────────────

const _intFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const _pctFmt = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

function formatInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return _intFmt.format(n)
}

function formatPct(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return '—'
  return `${_pctFmt.format(pct)}%`
}

// ──────────────────────────────────────────────────────────────────────
// Aggregate stat card (the hero) + per-warehouse card
// ──────────────────────────────────────────────────────────────────────

const SHADOW_NORMAL = cn(
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_1px_2px_0_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(15,23,42,0.18)]',
  'dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_2px_4px_0_rgba(0,0,0,0.5),0_24px_48px_-12px_rgba(0,0,0,0.55)]',
  'motion-safe:hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_2px_4px_0_rgba(0,0,0,0.08),0_16px_40px_-12px_rgba(15,23,42,0.25)]',
  'motion-safe:dark:hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_4px_8px_0_rgba(0,0,0,0.55),0_32px_64px_-16px_rgba(0,0,0,0.6)]'
)

function AggregateStatCard({
  totals,
  meta,
  totalWarehouses,
  goalCtx,
  onRefresh,
  refreshing,
}: {
  totals: InventoryCompletionTotals
  meta?: InventoryCompletionMeta
  totalWarehouses: number
  goalCtx: GoalContext
  onRefresh: () => void
  refreshing: boolean
}) {
  const pct = totals.completion_pct ?? null
  const status = getCompletionStatus(pct, goalCtx)

  return (
    <div
      role='group'
      aria-label='Total Inventory Completion'
      style={{ ['--kpi-glow' as string]: status.glowRgba }}
      className={cn(
        'group border-border/60 bg-card relative isolate overflow-hidden rounded-2xl border',
        'bg-linear-to-b from-white/4 via-transparent to-transparent',
        SHADOW_NORMAL,
        'transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'motion-safe:hover:-translate-y-0.5'
      )}
    >
      {/* Top accent line */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-3 top-0 h-px rounded-full',
          'bg-linear-to-r from-transparent to-transparent',
          status.accentLineClass
        )}
      />
      {/* Subtle radial glow on hover */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 opacity-0',
          'bg-[radial-gradient(120%_60%_at_50%_0%,var(--kpi-glow),transparent_60%)]',
          'motion-safe:transition-opacity motion-safe:duration-500',
          'motion-safe:group-hover:opacity-100'
        )}
      />

      <div className='relative flex flex-col gap-4 p-6'>
        <div className='flex items-start justify-between gap-3'>
          <div className='flex items-center gap-2'>
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md',
                status.iconBgClass,
                'shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-inset',
                status.iconRingClass
              )}
            >
              <ClipboardCheck className='h-4 w-4' aria-hidden />
            </div>
            <div className='flex flex-col gap-0.5'>
              <span className='text-muted-foreground text-[10px] font-semibold tracking-widest uppercase'>
                Total Inventory Completion
              </span>
              <span className='text-foreground text-xs font-medium'>
                Across {totalWarehouses} warehouses ·{' '}
                {totals.warehouses_succeeded} ok
                {totals.warehouses_failed > 0 && (
                  <span className='text-red-600 dark:text-red-400'>
                    {' '}
                    · {totals.warehouses_failed} failed
                  </span>
                )}
              </span>
            </div>
          </div>
          <Badge
            variant='outline'
            className={cn(
              'shrink-0 gap-1 text-[10px] tracking-wide uppercase',
              status.badgeClass
            )}
            title={`Year-to-date goal: ${goalCtx.ytdGoal}% by ${goalCtx.monthName} ${goalCtx.monthLastDay} (${MONTHLY_GOAL_PCT}%/mo)`}
          >
            {status.IconComponent && (
              <status.IconComponent className='h-3 w-3' aria-hidden />
            )}
            <span>{status.label}</span>
            {status.deltaText && (
              <span className='font-mono tabular-nums'>{status.deltaText}</span>
            )}
          </Badge>
        </div>

        <div className='flex flex-wrap items-end gap-x-4 gap-y-1'>
          <div
            className={cn(
              'text-5xl font-semibold tracking-tight tabular-nums',
              status.numberClass,
              'dark:[text-shadow:0_1px_0_rgba(255,255,255,0.04)]'
            )}
          >
            {formatPct(pct)}
          </div>
          <div className='mb-1 flex flex-col gap-0.5 text-sm'>
            <div className='text-muted-foreground'>
              <span className='text-foreground font-semibold'>
                {formatInt(totals.executed)}
              </span>{' '}
              of{' '}
              <span className='text-foreground font-semibold'>
                {formatInt(totals.total_bins)}
              </span>{' '}
              bins counted
            </div>
            <div className='text-muted-foreground inline-flex items-center gap-1.5 text-xs'>
              <Target className='h-3 w-3' aria-hidden />
              <span>
                Goal ·{' '}
                <span className='text-foreground font-semibold'>
                  {goalCtx.ytdGoal}%
                </span>{' '}
                by {goalCtx.monthName} {goalCtx.monthLastDay} (
                {MONTHLY_GOAL_PCT}%/mo)
              </span>
            </div>
          </div>
        </div>

        {/* Progress bar with goal tick mark. The tick lives INSIDE the
            overflow-hidden track (top:0/bottom:0) so a 0px-tall row
            doesn't bleed past the rounded corners; it doubles as a
            visual anchor for the "Goal · 50%" subtitle above. */}
        <div className='bg-muted relative h-2 w-full overflow-hidden rounded-full'>
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500 ease-out',
              status.barClass
            )}
            style={{ width: `${Math.min(Math.max(pct ?? 0, 0), 100)}%` }}
          />
          {goalCtx.ytdGoal > 0 && goalCtx.ytdGoal < 100 && (
            <span
              aria-hidden
              title={`YTD goal · ${goalCtx.ytdGoal}% by ${goalCtx.monthName} ${goalCtx.monthLastDay}`}
              className='bg-foreground/70 dark:bg-foreground/80 absolute inset-y-0 w-px'
              style={{ left: `${Math.min(goalCtx.ytdGoal, 100)}%` }}
            />
          )}
        </div>

        {/* Status row: per-bucket counts + meta */}
        <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-xs'>
          <span className='inline-flex items-center gap-1.5'>
            <CheckCircle2 className='h-3 w-3 text-emerald-500' />
            <span className='text-muted-foreground'>Counted</span>
            <span className='text-foreground font-mono font-semibold tabular-nums'>
              {formatInt(totals.executed)}
            </span>
          </span>
          <span className='inline-flex items-center gap-1.5'>
            <Layers className='h-3 w-3 text-amber-500' />
            <span className='text-muted-foreground'>Active</span>
            <span className='text-foreground font-mono font-semibold tabular-nums'>
              {formatInt(totals.active)}
            </span>
          </span>
          {totals.planned > 0 && (
            <span className='inline-flex items-center gap-1.5'>
              <ClipboardList className='h-3 w-3 text-sky-500' />
              <span className='text-muted-foreground'>Planned</span>
              <span className='text-foreground font-mono font-semibold tabular-nums'>
                {formatInt(totals.planned)}
              </span>
            </span>
          )}
          <span className='inline-flex items-center gap-1.5'>
            <XCircle className='h-3 w-3 text-red-500' />
            <span className='text-muted-foreground'>Not yet counted</span>
            <span className='text-foreground font-mono font-semibold tabular-nums'>
              {formatInt(totals.not_executed)}
            </span>
          </span>
          <span className='ml-auto inline-flex items-center gap-2'>
            {meta?.elapsed_sec != null && (
              <span className='text-muted-foreground text-[11px]'>
                Pulled in {meta.elapsed_sec.toFixed(1)}s
              </span>
            )}
            <Button
              variant='outline'
              size='sm'
              onClick={onRefresh}
              disabled={refreshing}
              className='h-7'
            >
              <RefreshCw
                className={cn('mr-1.5 h-3 w-3', refreshing && 'animate-spin')}
              />
              Refresh
            </Button>
          </span>
        </div>
      </div>
    </div>
  )
}

function PerWarehouseCard({
  warehouse,
  variant,
  data,
  goalCtx,
  isActive,
  onClick,
  index,
}: {
  warehouse: string
  variant: string
  data: InventoryCompletionWarehouse | undefined
  goalCtx: GoalContext
  isActive: boolean
  onClick: () => void
  index: number
}) {
  const pct =
    data && data.ok && data.completion_pct != null ? data.completion_pct : null
  const status = getCompletionStatus(pct, goalCtx)
  const failed = data && !data.ok
  const empty = data?.empty === true

  return (
    <button
      type='button'
      onClick={onClick}
      style={{
        ['--kpi-glow' as string]: status.glowRgba,
        animationDelay: `${index * 60}ms`,
      }}
      className={cn(
        'group focus-visible:ring-ring focus-visible:ring-offset-background border-border/60 bg-card relative isolate flex flex-col gap-3 overflow-hidden rounded-xl border p-4 text-left transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'bg-linear-to-b from-white/4 via-transparent to-transparent',
        SHADOW_NORMAL,
        'motion-safe:hover:-translate-y-0.5',
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-backwards motion-safe:duration-500',
        isActive && 'ring-primary ring-offset-background ring-2 ring-offset-2'
      )}
      aria-pressed={isActive}
    >
      {/* Top accent line */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-2 top-0 h-px rounded-full',
          'bg-linear-to-r from-transparent to-transparent',
          status.accentLineClass
        )}
      />
      {/* Subtle radial glow on hover */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 opacity-0',
          'bg-[radial-gradient(120%_60%_at_50%_0%,var(--kpi-glow),transparent_60%)]',
          'motion-safe:transition-opacity motion-safe:duration-500',
          'motion-safe:group-hover:opacity-100'
        )}
      />

      {/* Header: warehouse code + variant chip + status pill */}
      <div className='relative flex items-start justify-between gap-2'>
        <div className='flex flex-col gap-0.5'>
          <span className='text-foreground font-mono text-2xl font-bold tracking-tight'>
            {warehouse}
          </span>
          <span className='text-muted-foreground font-mono text-[10px]'>
            {variant}
          </span>
        </div>
        <Badge
          variant='outline'
          className={cn(
            'shrink-0 gap-1 text-[10px] tracking-wide uppercase',
            failed
              ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:bg-red-500/15 dark:text-red-300'
              : empty
                ? 'border-border bg-muted text-muted-foreground'
                : status.badgeClass
          )}
          title={
            failed || empty
              ? undefined
              : `Year-to-date goal: ${goalCtx.ytdGoal}% by ${goalCtx.monthName} ${goalCtx.monthLastDay}`
          }
        >
          {!failed && !empty && status.IconComponent && (
            <status.IconComponent className='h-3 w-3' aria-hidden />
          )}
          <span>{failed ? 'Failed' : empty ? 'Empty' : status.label}</span>
          {!failed && !empty && status.deltaText && (
            <span className='font-mono tabular-nums'>{status.deltaText}</span>
          )}
        </Badge>
      </div>

      {/* Body: percentage or error message */}
      {failed ? (
        <div className='relative flex flex-col gap-1.5'>
          <div className='flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400'>
            <AlertTriangle className='h-3.5 w-3.5 shrink-0' />
            <span className='truncate'>
              {data?.step
                ? `Failed at ${data.step.replace(/_/g, ' ')}`
                : 'Failed'}
            </span>
          </div>
          <p className='text-muted-foreground line-clamp-3 text-[11px] leading-snug'>
            {data?.error || 'Unknown error.'}
          </p>
        </div>
      ) : (
        <>
          <div className='relative flex items-end gap-2'>
            <span
              className={cn(
                'text-3xl font-semibold tracking-tight tabular-nums',
                status.numberClass,
                'dark:[text-shadow:0_1px_0_rgba(255,255,255,0.04)]'
              )}
            >
              {formatPct(pct)}
            </span>
          </div>
          <div className='text-muted-foreground relative text-[11px]'>
            <span className='text-foreground font-semibold'>
              {formatInt(data?.executed ?? 0)}
            </span>
            {' / '}
            <span className='text-foreground font-semibold'>
              {formatInt(data?.total_bins ?? 0)}
            </span>{' '}
            bins
          </div>
          <div className='bg-muted relative h-1.5 w-full overflow-hidden rounded-full'>
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500 ease-out',
                status.barClass
              )}
              style={{ width: `${Math.min(Math.max(pct ?? 0, 0), 100)}%` }}
            />
            {/* Goal tick. Same recipe as the aggregate card's bar; sits
                inside the overflow-hidden track so a flush-against-edge
                tick doesn't escape the rounded corners. */}
            {goalCtx.ytdGoal > 0 && goalCtx.ytdGoal < 100 && (
              <span
                aria-hidden
                title={`YTD goal · ${goalCtx.ytdGoal}%`}
                className='bg-foreground/70 dark:bg-foreground/80 absolute inset-y-0 w-px'
                style={{ left: `${Math.min(goalCtx.ytdGoal, 100)}%` }}
              />
            )}
          </div>
          {data && data.ok && (data.storage_types?.length ?? 0) > 0 && (
            <div className='text-muted-foreground relative text-[10px]'>
              {data.storage_types?.length} storage type
              {(data.storage_types?.length ?? 0) === 1 ? '' : 's'}
              {data.elapsed_sec != null && (
                <span> · {data.elapsed_sec.toFixed(1)}s</span>
              )}
            </div>
          )}
        </>
      )}
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Detail table row shape — flattens (warehouse × storage type)
// ──────────────────────────────────────────────────────────────────────

interface DetailRow {
  warehouse: string
  variant: string
  storage_type: string
  storage_type_name: string
  total_bins: number
  executed: number
  active: number
  planned: number
  not_executed: number
  completion_pct: number | null
}

type SortKey = keyof DetailRow

function buildDetailRows(
  warehouses: InventoryCompletionWarehouse[]
): DetailRow[] {
  const rows: DetailRow[] = []
  for (const w of warehouses) {
    if (!w.ok) continue
    const storageTypes = w.storage_types ?? []
    for (const st of storageTypes) {
      rows.push({
        warehouse: w.warehouse,
        variant: w.variant,
        storage_type: st.storage_type,
        storage_type_name: st.storage_type_name,
        total_bins: st.total_bins,
        executed: st.executed,
        active: st.active,
        planned: st.planned,
        not_executed: st.not_executed,
        completion_pct: st.completion_pct,
      })
    }
  }
  return rows
}

function escapeCsv(value: unknown): string {
  if (value == null) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ──────────────────────────────────────────────────────────────────────
// Main view
// ──────────────────────────────────────────────────────────────────────

export function InventoryCompletionView({
  result,
  isRunning,
  progress,
  lastRunAt,
  onRefresh,
}: InventoryCompletionViewProps) {
  const [activeWarehouse, setActiveWarehouse] = useState<string | null>(null)
  const [tableSearch, setTableSearch] = useState('')
  const [sortBy, setSortBy] = useState<{ col: SortKey; dir: 'asc' | 'desc' }>({
    col: 'warehouse',
    dir: 'asc',
  })

  // Goal context — recomputed on every fresh run so a tab kept open
  // across a month boundary picks up the new YTD goal on the next
  // Refresh click. `lastRunAt` is bumped by the parent on every
  // dispatch so it's the right "tick" key to re-derive against.
  // Defaults to the current wall clock when no run has happened yet
  // (lets the empty/loading states still show a sensible goal label).
  const goalCtx = useMemo(
    () => getGoalContext(lastRunAt ? new Date(lastRunAt) : new Date()),
    [lastRunAt]
  )

  // Build a warehouse lookup from the response so the per-warehouse
  // card grid can render even when the agent returned fewer entries
  // than the FE renders (a degraded response or an in-flight loading
  // state). The base list always comes from `LX25_WAREHOUSES` so the
  // grid shape is stable across runs.
  const warehouseMap = useMemo(() => {
    const m = new Map<string, InventoryCompletionWarehouse>()
    for (const w of result?.warehouses ?? []) {
      m.set(w.warehouse, w)
    }
    return m
  }, [result?.warehouses])

  const detailRows = useMemo(() => {
    return buildDetailRows(result?.warehouses ?? [])
  }, [result?.warehouses])

  const filteredRows = useMemo(() => {
    let rows = detailRows
    if (activeWarehouse) {
      rows = rows.filter((r) => r.warehouse === activeWarehouse)
    }
    const q = tableSearch.trim().toLowerCase()
    if (q) {
      rows = rows.filter((r) => {
        const haystack = [
          r.warehouse,
          r.variant,
          r.storage_type,
          r.storage_type_name,
        ]
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })
    }
    return rows
  }, [detailRows, activeWarehouse, tableSearch])

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows]
    const dir = sortBy.dir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      const av = a[sortBy.col]
      const bv = b[sortBy.col]
      if (av == null && bv == null) return 0
      if (av == null) return 1 * dir
      if (bv == null) return -1 * dir
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * dir
      }
      return String(av).localeCompare(String(bv)) * dir
    })
    return rows
  }, [filteredRows, sortBy])

  const handleSort = (col: SortKey) => {
    setSortBy((prev) =>
      prev.col === col
        ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: 'asc' }
    )
  }

  const handleExport = () => {
    if (sortedRows.length === 0) {
      toast.error('Nothing to export', {
        description: 'No rows match the current filter.',
      })
      return
    }
    const headers = [
      'Warehouse',
      'Variant',
      'Storage Type',
      'Storage Type Name',
      'Total Bins',
      'Counted',
      'Active',
      'Planned',
      'Not Counted',
      'Completion %',
    ]
    const lines = [headers.map(escapeCsv).join(',')]
    for (const r of sortedRows) {
      lines.push(
        [
          r.warehouse,
          r.variant,
          r.storage_type,
          r.storage_type_name,
          r.total_bins,
          r.executed,
          r.active,
          r.planned,
          r.not_executed,
          r.completion_pct == null ? '' : r.completion_pct,
        ]
          .map(escapeCsv)
          .join(',')
      )
    }
    const ts = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const filename = `inventory_completion_${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}.csv`
    downloadCsv(filename, lines.join('\n'))
    toast.success('CSV exported', { description: filename })
  }

  // ── Empty state — never run yet AND not currently running ──
  if (!result && !isRunning) {
    return (
      <Card className='shadow-sm'>
        <CardContent className='flex flex-col items-center justify-center gap-3 py-16 text-center'>
          <div className='bg-muted flex h-12 w-12 items-center justify-center rounded-full'>
            <ClipboardCheck className='text-muted-foreground h-6 w-6' />
          </div>
          <div>
            <h3 className='text-foreground text-base font-semibold'>
              No inventory completion data yet
            </h3>
            <p className='text-muted-foreground mx-auto mt-1 max-w-md text-sm'>
              Click <span className='font-medium'>Run Query</span> to fetch
              cycle-count completion across all {LX25_WAREHOUSES.length}{' '}
              warehouses. The fan-out runs LX25 sequentially with each
              warehouse&apos;s SAP variant and aggregates the results.
            </p>
          </div>
          <Button onClick={onRefresh} className='mt-2'>
            <PlayCircle className='mr-2 h-4 w-4' />
            Run Query
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ── Loading state — render placeholder cards so the user sees the
  // shape of what's coming. Real progress lives in the `progress`
  // prop (not currently emitted by the agent — single round-trip — but
  // wired so a future SSE upgrade can drive it). ──
  if (isRunning && !result) {
    return (
      <div className='space-y-4'>
        <Card className='shadow-sm'>
          <CardContent className='flex flex-col gap-4 p-6'>
            <div className='flex items-center justify-between gap-4'>
              <div className='flex flex-col gap-1'>
                <span className='text-muted-foreground text-[10px] font-semibold tracking-widest uppercase'>
                  Total Inventory Completion
                </span>
                <span className='text-foreground text-xs'>
                  {progress?.label ??
                    `Fetching all ${LX25_WAREHOUSES.length} warehouses…`}
                </span>
              </div>
              <Skeleton className='h-6 w-16' />
            </div>
            <div className='flex items-end gap-4'>
              <Skeleton className='h-12 w-32' />
              <Skeleton className='mb-1 h-4 w-48' />
            </div>
            <div className='bg-muted relative h-2 w-full overflow-hidden rounded-full'>
              <div
                className='bg-primary h-full animate-pulse'
                style={{
                  width:
                    progress?.total && progress.current >= 0
                      ? `${Math.round((progress.current / progress.total) * 100)}%`
                      : '15%',
                }}
              />
            </div>
          </CardContent>
        </Card>

        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5'>
          {LX25_WAREHOUSES.map((w, idx) => (
            <Card
              key={w.warehouse}
              className='flex flex-col gap-3 p-4 shadow-sm'
              style={{ animationDelay: `${idx * 60}ms` }}
            >
              <div className='flex items-start justify-between gap-2'>
                <div className='flex flex-col gap-0.5'>
                  <span className='text-foreground font-mono text-2xl font-bold tracking-tight'>
                    {w.warehouse}
                  </span>
                  <span className='text-muted-foreground font-mono text-[10px]'>
                    {w.variant}
                  </span>
                </div>
                <Skeleton className='h-5 w-12' />
              </div>
              <Skeleton className='h-8 w-20' />
              <Skeleton className='h-3 w-32' />
              <Skeleton className='h-1.5 w-full rounded-full' />
            </Card>
          ))}
        </div>
      </div>
    )
  }

  // ── Error / total-failure state — agent returned ok=false at the
  // top level (couldn't even acquire a SAP session). Per-warehouse
  // failures are surfaced inside the cards below, NOT here. ──
  if (result && !result.ok) {
    return (
      <Card className='border-red-500/40 bg-red-500/5 shadow-sm'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base text-red-700 dark:text-red-300'>
            <AlertTriangle className='h-5 w-5' />
            Inventory Completion failed
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          <p className='text-sm'>{result.error || 'Unknown error.'}</p>
          {result.step && (
            <p className='text-muted-foreground text-xs'>
              Step: <span className='font-mono'>{result.step}</span>
            </p>
          )}
          <Button onClick={onRefresh} size='sm' variant='outline'>
            <RefreshCw className='mr-2 h-3.5 w-3.5' />
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ── Success state ──
  const totals: InventoryCompletionTotals = result?.totals ?? {
    warehouses_succeeded: 0,
    warehouses_failed: 0,
    total_bins: 0,
    executed: 0,
    active: 0,
    planned: 0,
    not_executed: 0,
    completion_pct: null,
  }

  const sortIcon = (col: SortKey) => {
    if (sortBy.col !== col) {
      return <ArrowUpDown className='ml-1 inline h-3 w-3 opacity-40' />
    }
    return sortBy.dir === 'asc' ? (
      <ArrowUpAZ className='ml-1 inline h-3 w-3' />
    ) : (
      <ArrowDownAZ className='ml-1 inline h-3 w-3' />
    )
  }

  return (
    <div className='space-y-4'>
      {/* 1. Aggregate stat card */}
      <AggregateStatCard
        totals={totals}
        meta={result?.meta}
        totalWarehouses={LX25_WAREHOUSES.length}
        goalCtx={goalCtx}
        onRefresh={onRefresh}
        refreshing={isRunning}
      />

      {/* 2. Per-warehouse cards */}
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5'>
        {LX25_WAREHOUSES.map((w, idx) => (
          <PerWarehouseCard
            key={w.warehouse}
            warehouse={w.warehouse}
            variant={w.variant}
            data={warehouseMap.get(w.warehouse)}
            goalCtx={goalCtx}
            isActive={activeWarehouse === w.warehouse}
            onClick={() =>
              setActiveWarehouse((prev) =>
                prev === w.warehouse ? null : w.warehouse
              )
            }
            index={idx}
          />
        ))}
      </div>

      {/* 3. Detail table */}
      <Card className='shadow-sm'>
        <CardHeader className='flex flex-col gap-3 pb-3'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div className='flex flex-col gap-0.5'>
              <CardTitle className='flex items-center gap-2 text-sm font-semibold'>
                <Warehouse className='h-4 w-4' />
                Storage Type Detail
              </CardTitle>
              <p className='text-muted-foreground text-xs'>
                {sortedRows.length} row{sortedRows.length === 1 ? '' : 's'}{' '}
                {activeWarehouse ? (
                  <>
                    · filtered to{' '}
                    <span className='text-foreground font-mono font-semibold'>
                      {activeWarehouse}
                    </span>
                  </>
                ) : (
                  '· all warehouses'
                )}
                {lastRunAt && (
                  <>
                    {' '}
                    · last run{' '}
                    <span className='text-foreground'>
                      {new Date(lastRunAt).toLocaleTimeString()}
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className='flex items-center gap-2'>
              <div className='relative'>
                <Search className='text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2' />
                <Input
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder='Search storage type…'
                  className='h-8 w-56 pl-8 text-xs'
                />
              </div>
              <Button
                size='sm'
                variant='outline'
                className='h-8'
                onClick={handleExport}
                disabled={sortedRows.length === 0}
              >
                <Download className='mr-1.5 h-3.5 w-3.5' />
                CSV
              </Button>
            </div>
          </div>

          {/* Warehouse chip filter row — clicking a chip filters the
              table to that warehouse, clicking the active chip
              (or "All") resets. */}
          <div className='flex flex-wrap items-center gap-1.5'>
            <button
              type='button'
              onClick={() => setActiveWarehouse(null)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                activeWarehouse === null
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'
              )}
            >
              All ({detailRows.length})
            </button>
            {LX25_WAREHOUSES.map((w) => {
              const wh = warehouseMap.get(w.warehouse)
              const count = wh && wh.ok ? (wh.storage_types?.length ?? 0) : 0
              const isFailed = wh && !wh.ok
              const isActive = activeWarehouse === w.warehouse
              return (
                <button
                  key={w.warehouse}
                  type='button'
                  onClick={() =>
                    setActiveWarehouse((prev) =>
                      prev === w.warehouse ? null : w.warehouse
                    )
                  }
                  disabled={count === 0 && !isFailed}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold transition-colors',
                    'disabled:cursor-not-allowed disabled:opacity-40',
                    isActive
                      ? 'border-primary bg-primary text-primary-foreground'
                      : isFailed
                        ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                        : 'border-border bg-muted/40 text-foreground hover:bg-muted'
                  )}
                >
                  {w.warehouse}
                  {!isFailed && count > 0 && (
                    <span className='text-muted-foreground ml-1 font-sans font-normal'>
                      · {count}
                    </span>
                  )}
                  {isFailed && (
                    <AlertTriangle className='ml-1 inline h-3 w-3' />
                  )}
                </button>
              )
            })}
          </div>
        </CardHeader>

        <CardContent className='p-0'>
          {sortedRows.length === 0 ? (
            <div className='text-muted-foreground flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-sm'>
              <Boxes className='h-6 w-6 opacity-40' />
              {tableSearch
                ? 'No storage types match the current search.'
                : activeWarehouse
                  ? `No storage types in ${activeWarehouse}.`
                  : 'No storage types returned.'}
            </div>
          ) : (
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow className='hover:bg-transparent'>
                    <TableHead
                      className='cursor-pointer select-none'
                      onClick={() => handleSort('warehouse')}
                    >
                      Warehouse {sortIcon('warehouse')}
                    </TableHead>
                    <TableHead
                      className='cursor-pointer select-none'
                      onClick={() => handleSort('storage_type')}
                    >
                      Storage Type {sortIcon('storage_type')}
                    </TableHead>
                    <TableHead className='cursor-pointer select-none'>
                      Description
                    </TableHead>
                    <TableHead
                      className='cursor-pointer text-right select-none'
                      onClick={() => handleSort('total_bins')}
                    >
                      Total {sortIcon('total_bins')}
                    </TableHead>
                    <TableHead
                      className='cursor-pointer text-right select-none'
                      onClick={() => handleSort('executed')}
                    >
                      Counted {sortIcon('executed')}
                    </TableHead>
                    <TableHead
                      className='cursor-pointer text-right select-none'
                      onClick={() => handleSort('active')}
                    >
                      Active {sortIcon('active')}
                    </TableHead>
                    <TableHead
                      className='cursor-pointer text-right select-none'
                      onClick={() => handleSort('not_executed')}
                    >
                      Not yet {sortIcon('not_executed')}
                    </TableHead>
                    <TableHead
                      className='cursor-pointer text-right select-none'
                      onClick={() => handleSort('completion_pct')}
                    >
                      Completion {sortIcon('completion_pct')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.map((row, idx) => {
                    const rowStatus = getCompletionStatus(
                      row.completion_pct,
                      goalCtx
                    )
                    return (
                      <TableRow
                        key={`${row.warehouse}-${row.storage_type}-${idx}`}
                        className='align-middle'
                      >
                        <TableCell className='font-mono font-semibold'>
                          {row.warehouse}
                        </TableCell>
                        <TableCell className='font-mono'>
                          {row.storage_type}
                        </TableCell>
                        <TableCell className='text-muted-foreground'>
                          {row.storage_type_name}
                        </TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {formatInt(row.total_bins)}
                        </TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {formatInt(row.executed)}
                        </TableCell>
                        <TableCell className='text-right text-amber-600 tabular-nums dark:text-amber-400'>
                          {row.active === 0 ? (
                            <span className='text-muted-foreground'>—</span>
                          ) : (
                            formatInt(row.active)
                          )}
                        </TableCell>
                        <TableCell className='text-right text-red-600 tabular-nums dark:text-red-400'>
                          {row.not_executed === 0 ? (
                            <span className='text-muted-foreground'>—</span>
                          ) : (
                            formatInt(row.not_executed)
                          )}
                        </TableCell>
                        <TableCell className='text-right'>
                          <div className='flex items-center justify-end gap-2'>
                            <div className='bg-muted relative h-1.5 w-12 overflow-hidden rounded-full'>
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  rowStatus.barClass
                                )}
                                style={{
                                  width: `${Math.min(Math.max(row.completion_pct ?? 0, 0), 100)}%`,
                                }}
                              />
                              {/* Goal tick — same recipe as the cards
                                  above so a per-row %, the per-warehouse
                                  card, and the aggregate card all agree
                                  on what "the goal line" looks like. */}
                              {goalCtx.ytdGoal > 0 && goalCtx.ytdGoal < 100 && (
                                <span
                                  aria-hidden
                                  className='bg-foreground/60 dark:bg-foreground/70 absolute inset-y-0 w-px'
                                  style={{
                                    left: `${Math.min(goalCtx.ytdGoal, 100)}%`,
                                  }}
                                />
                              )}
                            </div>
                            <span
                              className={cn(
                                'min-w-14 text-right font-mono font-semibold tabular-nums',
                                rowStatus.numberClass
                              )}
                            >
                              {formatPct(row.completion_pct)}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// Created and developed by Jai Singh
