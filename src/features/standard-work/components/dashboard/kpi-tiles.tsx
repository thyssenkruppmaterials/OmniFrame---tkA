// Created and developed by Jai Singh
/**
 * Dashboard KPI Tiles
 *
 * Four refined tiles for the Checklist Dashboard. Each tile leads with a
 * unique mini-visualization (progress ring, weekly activity grid, sparkline,
 * status pill) instead of the generic "big number + icon" pattern, so the
 * row reads as a quick visual scan instead of four identical cards.
 *
 *   - TodayProgressTile  -> circular progress ring + completed/due
 *   - AttentionTile      -> count + context (overdue / due-soon)
 *   - StreakTile         -> current streak + 7-day calendar grid
 *   - OnTimeRateTile     -> percentage + 7-day sparkline trend
 */
import { useEffect, useMemo } from 'react'
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Flame,
  Info,
  TrendingUp,
} from 'lucide-react'
import { cn, getLocalDateString } from '@/lib/utils'
import type { UserDailyCompletion } from '@/hooks/use-standard-work'
import { Card, CardContent } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface TileShellProps {
  index?: number
  className?: string
  children: React.ReactNode
  ariaLabel?: string
}

function TileShell({
  index = 0,
  className,
  children,
  ariaLabel,
}: TileShellProps) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: reduce ? 0 : index * 0.05 }}
      whileHover={reduce ? undefined : { y: -2 }}
    >
      <Card
        className={cn(
          'relative h-full overflow-hidden p-0 transition-shadow duration-200 hover:shadow-md',
          className
        )}
        aria-label={ariaLabel}
      >
        <CardContent className='p-4 sm:p-5'>{children}</CardContent>
      </Card>
    </motion.div>
  )
}

function TileLabel({
  title,
  explainer,
}: {
  title: string
  explainer?: string
}) {
  return (
    <div className='flex items-center gap-1.5'>
      <p className='text-muted-foreground text-xs font-medium'>{title}</p>
      {explainer ? (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type='button'
                aria-label={`About ${title}`}
                className='text-muted-foreground/50 hover:text-muted-foreground transition-colors'
              >
                <Info className='h-3 w-3' />
              </button>
            </TooltipTrigger>
            <TooltipContent side='top' className='max-w-[220px]'>
              <p className='text-xs leading-relaxed'>{explainer}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </div>
  )
}

function AnimatedNumber({
  value,
  duration = 1.1,
}: {
  value: number
  duration?: number
}) {
  const reduce = useReducedMotion()
  const count = useMotionValue(reduce ? value : 0)
  const rounded = useTransform(count, (latest) => Math.round(latest))
  useEffect(() => {
    if (reduce) {
      count.set(value)
      return
    }
    const controls = animate(count, value, { duration, ease: 'easeOut' })
    return controls.stop
  }, [value, count, duration, reduce])
  return <motion.span>{rounded}</motion.span>
}

// ===== Today Progress Tile -- circular ring =================================

interface TodayProgressTileProps {
  completed: number
  due: number
  index?: number
}

export function TodayProgressTile({
  completed,
  due,
  index,
}: TodayProgressTileProps) {
  const pct = due > 0 ? Math.round((completed / due) * 100) : 0
  const ringTone = pct >= 100 ? 'green' : pct >= 50 ? 'primary' : 'amber'

  return (
    <TileShell index={index} ariaLabel="Today's progress">
      <div className='flex items-center gap-4'>
        <ProgressRing value={pct} tone={ringTone} />
        <div className='min-w-0 flex-1'>
          <TileLabel
            title="Today's progress"
            explainer="Standard work checklists you've completed today out of the total scheduled."
          />
          <p className='mt-1 text-2xl font-bold tracking-tight tabular-nums'>
            <AnimatedNumber value={completed} />
            <span className='text-muted-foreground/70 text-base font-medium'>
              {' / '}
              {due}
            </span>
          </p>
          <p className='text-muted-foreground mt-0.5 text-xs'>
            {due === 0
              ? 'Nothing scheduled today'
              : pct >= 100
                ? 'All complete'
                : `${due - completed} remaining`}
          </p>
        </div>
      </div>
    </TileShell>
  )
}

function ProgressRing({
  value,
  tone,
  size = 64,
  thickness = 6,
}: {
  value: number
  tone: 'primary' | 'green' | 'amber'
  size?: number
  thickness?: number
}) {
  const reduce = useReducedMotion()
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const motionValue = useMotionValue(reduce ? value : 0)
  useEffect(() => {
    if (reduce) {
      motionValue.set(value)
      return
    }
    const controls = animate(motionValue, value, {
      duration: 1.2,
      ease: 'easeOut',
    })
    return controls.stop
  }, [value, motionValue, reduce])
  const dashOffset = useTransform(
    motionValue,
    (v) => circumference * (1 - Math.min(100, Math.max(0, v)) / 100)
  )

  const stroke =
    tone === 'green'
      ? 'oklch(0.72 0.18 145)'
      : tone === 'amber'
        ? 'oklch(0.78 0.16 80)'
        : 'var(--primary)'

  return (
    <div
      className='relative shrink-0'
      style={{ width: size, height: size }}
      aria-hidden='true'
    >
      <svg width={size} height={size} className='-rotate-90'>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill='none'
          stroke='currentColor'
          strokeWidth={thickness}
          className='text-muted/40'
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill='none'
          stroke={stroke}
          strokeWidth={thickness}
          strokeDasharray={circumference}
          strokeLinecap='round'
          style={{ strokeDashoffset: dashOffset }}
        />
      </svg>
      <div className='absolute inset-0 flex items-center justify-center'>
        <span className='text-sm font-semibold tabular-nums'>{value}%</span>
      </div>
    </div>
  )
}

// ===== Attention Tile -- count + context ====================================

interface AttentionTileProps {
  overdue: number
  dueSoon: number
  nextOverdueLabel?: string
  index?: number
}

export function AttentionTile({
  overdue,
  dueSoon,
  nextOverdueLabel,
  index,
}: AttentionTileProps) {
  const total = overdue + dueSoon
  const isCritical = overdue > 0
  const isWarning = !isCritical && dueSoon > 0

  return (
    <TileShell
      index={index}
      ariaLabel='Attention needed'
      className={cn(
        isCritical &&
          'from-destructive/8 border-destructive/30 bg-linear-to-br to-transparent',
        isWarning &&
          'border-yellow-500/30 bg-linear-to-br from-yellow-500/8 to-transparent'
      )}
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <TileLabel
            title='Attention needed'
            explainer='Combines tasks that are already overdue with tasks due within the next hour.'
          />
          <p
            className={cn(
              'mt-1 text-2xl font-bold tracking-tight tabular-nums',
              isCritical && 'text-destructive'
            )}
          >
            <AnimatedNumber value={total} />
          </p>
          <p
            className={cn(
              'text-muted-foreground mt-0.5 truncate text-xs',
              isCritical && 'text-destructive/80'
            )}
          >
            {isCritical
              ? `${overdue} overdue${dueSoon > 0 ? `, ${dueSoon} due soon` : ''}`
              : isWarning
                ? `${dueSoon} due in the next hour`
                : 'Nothing pressing'}
          </p>
        </div>
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            isCritical
              ? 'bg-destructive/15 text-destructive'
              : isWarning
                ? 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400'
                : 'bg-muted/60 text-muted-foreground'
          )}
        >
          {isCritical ? (
            <AlertTriangle className='h-5 w-5' aria-hidden='true' />
          ) : (
            <ClipboardCheck className='h-5 w-5' aria-hidden='true' />
          )}
        </div>
      </div>
      {isCritical && nextOverdueLabel ? (
        <p className='border-destructive/20 mt-3 truncate border-t pt-2 text-[11px] font-medium'>
          <span className='text-muted-foreground'>Most pressing: </span>
          <span className='text-foreground'>{nextOverdueLabel}</span>
        </p>
      ) : null}
    </TileShell>
  )
}

// ===== Streak Tile -- flame + 7-day grid ====================================

interface StreakTileProps {
  current: number
  longest: number
  /** Last-7-days completion record from `userDailyCompletion`, current user's row. */
  weeklyCompletion?: { date: string; completed: number }[]
  index?: number
}

export function StreakTile({
  current,
  longest,
  weeklyCompletion,
  index,
}: StreakTileProps) {
  const week = useMemo(
    () => buildWeek(weeklyCompletion, current),
    [weeklyCompletion, current]
  )

  return (
    <TileShell index={index} ariaLabel='Streak'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <TileLabel
            title='Streak'
            explainer='Consecutive calendar days you have completed at least one assigned standard work task.'
          />
          <p className='mt-1 text-2xl font-bold tracking-tight tabular-nums'>
            <AnimatedNumber value={current} />
            <span className='text-muted-foreground/70 ml-1 text-base font-medium'>
              {current === 1 ? 'day' : 'days'}
            </span>
          </p>
          <p className='text-muted-foreground mt-0.5 text-xs'>
            {longest > 0
              ? `Best: ${longest} day${longest === 1 ? '' : 's'}`
              : 'Build consecutive completion days'}
          </p>
        </div>
        <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/15 text-orange-500'>
          <Flame className='h-5 w-5' aria-hidden='true' />
        </div>
      </div>
      <div className='mt-3 flex items-center gap-1.5'>
        {week.map((day) => (
          <div
            key={day.date}
            className='flex flex-1 flex-col items-center gap-1'
          >
            <div
              role='img'
              aria-label={`${day.label}: ${day.completed > 0 ? `${day.completed} completed` : 'no activity'}`}
              className={cn(
                'h-5 w-full rounded-sm',
                day.isToday && 'ring-primary/40 ring-2 ring-offset-1',
                day.completed > 0
                  ? day.completed >= 3
                    ? 'bg-orange-500'
                    : day.completed >= 2
                      ? 'bg-orange-400'
                      : 'bg-orange-300 dark:bg-orange-600'
                  : 'bg-muted/60'
              )}
            />
            <span
              className={cn(
                'text-muted-foreground/70 text-[9px] font-medium tabular-nums',
                day.isToday && 'text-foreground'
              )}
            >
              {day.shortLabel}
            </span>
          </div>
        ))}
      </div>
    </TileShell>
  )
}

interface WeekDay {
  date: string
  label: string
  shortLabel: string
  completed: number
  isToday: boolean
}

function buildWeek(
  weekly: { date: string; completed: number }[] | undefined,
  fallbackStreak: number
): WeekDay[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days: WeekDay[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const date = getLocalDateString(d)
    const isToday = i === 0
    const fromServer = weekly?.find((w) => w.date.startsWith(date))
    // Fallback: if we don't have per-day data, fill the last `fallbackStreak`
    // cells (capped at 7) so the visual still communicates streak length even
    // before `userDailyCompletion` returns.
    const fromFallback = i < Math.min(fallbackStreak, 7) ? 1 : 0
    const completed = fromServer ? fromServer.completed : fromFallback
    days.push({
      date,
      label: d.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      }),
      shortLabel: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
      completed,
      isToday,
    })
  }
  return days
}

// ===== On-Time Rate Tile -- sparkline =======================================

interface OnTimeRateTileProps {
  rate: number
  /** Last-N-days completion record for current user (sparkline data). */
  trend?: { date: string; completed: number }[]
  index?: number
}

export function OnTimeRateTile({ rate, trend, index }: OnTimeRateTileProps) {
  const points = useMemo(() => {
    const arr = (trend ?? []).slice(-14)
    if (arr.length < 2) return null
    return arr
  }, [trend])

  return (
    <TileShell index={index} ariaLabel='On-time rate'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <TileLabel
            title='On-time rate'
            explainer='Share of submitted tasks completed before the due time over the last 30 days.'
          />
          <p className='mt-1 text-2xl font-bold tracking-tight tabular-nums'>
            <AnimatedNumber value={Math.round(rate)} />
            <span className='text-muted-foreground/70 ml-0.5 text-base font-medium'>
              %
            </span>
          </p>
          <p className='text-muted-foreground mt-0.5 text-xs'>Last 30 days</p>
        </div>
        <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400'>
          {rate >= 100 ? (
            <CheckCircle2 className='h-5 w-5' aria-hidden='true' />
          ) : (
            <TrendingUp className='h-5 w-5' aria-hidden='true' />
          )}
        </div>
      </div>
      {points ? <Sparkline points={points} /> : <SparklinePlaceholder />}
    </TileShell>
  )
}

function Sparkline({
  points,
}: {
  points: { date: string; completed: number }[]
}) {
  const width = 240
  const height = 32
  const padding = 2
  const max = Math.max(1, ...points.map((p) => p.completed))
  const step =
    points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0
  const path = points
    .map((p, i) => {
      const x = padding + i * step
      const y = height - padding - (p.completed / max) * (height - padding * 2)
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
  const areaPath =
    `${path} L ${(padding + (points.length - 1) * step).toFixed(2)} ${height - padding} ` +
    `L ${padding} ${height - padding} Z`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width='100%'
      height={height}
      className='mt-3'
      aria-hidden='true'
      preserveAspectRatio='none'
    >
      <defs>
        <linearGradient id='sw-spark-fill' x1='0' x2='0' y1='0' y2='1'>
          <stop offset='0%' stopColor='var(--primary)' stopOpacity='0.25' />
          <stop offset='100%' stopColor='var(--primary)' stopOpacity='0' />
        </linearGradient>
      </defs>
      <path d={areaPath} fill='url(#sw-spark-fill)' />
      <path
        d={path}
        fill='none'
        stroke='var(--primary)'
        strokeWidth={1.5}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

function SparklinePlaceholder() {
  return <div className='bg-muted/30 mt-3 h-8 rounded-md' aria-hidden='true' />
}

// Re-export type so consumers don't need a separate import.
export type { UserDailyCompletion }

// Created and developed by Jai Singh
