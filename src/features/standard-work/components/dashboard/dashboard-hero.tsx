// Created and developed by Jai Singh
/**
 * Dashboard Hero
 *
 * Top of the Checklist Dashboard. Combines:
 *   - Time-aware greeting + today's date + a one-line summary of work
 *   - "Next up" card pinned to the right that previews the most urgent
 *     task and lets the user start it without scrolling
 *   - Working-area filter + refresh control inline
 *
 * Replaces the old separate "Filter row" so the page leads with a single,
 * confident header instead of two stacked rows of controls.
 */
import { motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Filter,
  MapPin,
  PlayCircle,
  RefreshCw,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  ScheduledTask,
  StandardWorkSubmission,
} from '@/hooks/use-standard-work'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const userLocale =
  typeof navigator !== 'undefined' && navigator.language
    ? navigator.language
    : 'en-US'

function timeOfDayGreeting(now: Date) {
  const h = now.getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

interface NextUpResult {
  task: ScheduledTask
  reason: 'overdue' | 'due_soon' | 'later_today'
  submission?: StandardWorkSubmission
}

/**
 * Pick the single most actionable task from the dashboard buckets:
 * overdue first, then due-soon, then any later-today task. Skips already
 * completed tasks. Used by the hero's "Next up" pinned card.
 */
function pickNextUp(
  buckets: {
    overdue: ScheduledTask[]
    dueSoon: ScheduledTask[]
    laterToday: ScheduledTask[]
  },
  todaySubmissions: StandardWorkSubmission[]
): NextUpResult | null {
  const find = (arr: ScheduledTask[]) =>
    arr.find((t) => !t.is_completed) ?? null

  const overdue = find(buckets.overdue)
  if (overdue) {
    return {
      task: overdue,
      reason: 'overdue',
      submission: matchSubmission(overdue, todaySubmissions),
    }
  }
  const dueSoon = find(buckets.dueSoon)
  if (dueSoon) {
    return {
      task: dueSoon,
      reason: 'due_soon',
      submission: matchSubmission(dueSoon, todaySubmissions),
    }
  }
  const later = find(buckets.laterToday)
  if (later) {
    return {
      task: later,
      reason: 'later_today',
      submission: matchSubmission(later, todaySubmissions),
    }
  }
  return null
}

function matchSubmission(
  task: ScheduledTask,
  todaySubmissions: StandardWorkSubmission[]
): StandardWorkSubmission | undefined {
  return todaySubmissions.find(
    (s) =>
      s.template_id === task.template_id &&
      s.working_area_id === task.working_area_id &&
      s.status !== 'submitted' &&
      s.status !== 'approved'
  )
}

interface DashboardHeroProps {
  userName?: string
  buckets: {
    overdue: ScheduledTask[]
    dueSoon: ScheduledTask[]
    laterToday: ScheduledTask[]
    completed: ScheduledTask[]
  }
  todaySubmissions: StandardWorkSubmission[]
  totalToday: number
  completedToday: number

  workingAreas: Array<{ id: string; area_name: string; is_active?: boolean }>
  selectedAreaId: string
  onAreaChange: (id: string) => void

  isRefetching: boolean
  onRefresh: () => void

  onStartChecklist: (templateId: string) => void
  onContinueChecklist: (submissionId: string) => void
}

export function DashboardHero({
  userName,
  buckets,
  todaySubmissions,
  totalToday,
  completedToday,
  workingAreas,
  selectedAreaId,
  onAreaChange,
  isRefetching,
  onRefresh,
  onStartChecklist,
  onContinueChecklist,
}: DashboardHeroProps) {
  const reduce = useReducedMotion()
  const now = new Date()
  const greeting = timeOfDayGreeting(now)
  const dateLabel = now.toLocaleDateString(userLocale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const activeAreas = workingAreas.filter((a) => a.is_active)
  const selectedAreaName = activeAreas.find(
    (a) => a.id === selectedAreaId
  )?.area_name

  const nextUp = pickNextUp(buckets, todaySubmissions)
  const allDone = totalToday > 0 && completedToday === totalToday
  const summary =
    totalToday === 0
      ? 'No standard work scheduled today.'
      : allDone
        ? `${completedToday} of ${totalToday} complete — all caught up.`
        : `${completedToday} of ${totalToday} complete · ${totalToday - completedToday} remaining.`

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className='from-primary/5 via-background to-background relative overflow-hidden rounded-2xl border bg-linear-to-br p-5 sm:p-6'
    >
      {/* Decorative subtle gradient blob behind the greeting */}
      <div
        aria-hidden='true'
        className='from-primary/10 pointer-events-none absolute -top-20 -right-20 h-60 w-60 rounded-full bg-linear-to-br to-transparent blur-3xl'
      />

      <div className='relative grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-8'>
        {/* Greeting + summary + filter */}
        <div className='min-w-0 space-y-3'>
          <div>
            <p className='text-muted-foreground text-xs font-medium tracking-wide'>
              {dateLabel}
            </p>
            <h2 className='mt-0.5 text-2xl font-bold tracking-tight sm:text-[28px]'>
              {greeting}
              {userName ? `, ${userName.split(' ')[0]}` : ''}
            </h2>
            <p className='text-muted-foreground mt-1 text-sm'>{summary}</p>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            <div className='text-muted-foreground/80 flex items-center gap-1.5 text-xs'>
              <Filter className='h-3.5 w-3.5' aria-hidden='true' />
              <span className='font-medium'>Filter</span>
            </div>
            <Select
              value={selectedAreaId || '_all'}
              onValueChange={(value) =>
                onAreaChange(value === '_all' ? '' : value)
              }
            >
              <SelectTrigger
                className='h-8 w-[220px] text-sm'
                aria-label='Working area filter'
              >
                <MapPin
                  className='text-muted-foreground mr-2 h-3.5 w-3.5'
                  aria-hidden='true'
                />
                <SelectValue placeholder='All Working Areas' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='_all'>All Working Areas</SelectItem>
                {activeAreas.map((area) => (
                  <SelectItem key={area.id} value={area.id}>
                    {area.area_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedAreaId && (
              <Button
                variant='secondary'
                size='sm'
                className='h-7 gap-1 px-2 text-xs'
                onClick={() => onAreaChange('')}
                aria-label={`Clear filter: ${selectedAreaName ?? 'working area'}`}
              >
                {selectedAreaName ?? 'Filtered'}
                <X className='h-3 w-3' aria-hidden='true' />
              </Button>
            )}
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8'
                    onClick={onRefresh}
                    disabled={isRefetching}
                    aria-label='Refresh dashboard data'
                  >
                    <RefreshCw
                      className={cn(
                        'h-3.5 w-3.5',
                        isRefetching && 'animate-spin'
                      )}
                      aria-hidden='true'
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Refresh today's tasks, progress, and schedule
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Next up panel */}
        <NextUpPanel
          nextUp={nextUp}
          allDone={allDone}
          totalToday={totalToday}
          onStartChecklist={onStartChecklist}
          onContinueChecklist={onContinueChecklist}
        />
      </div>
    </motion.div>
  )
}

// --- Next-up panel ---------------------------------------------------------

const REASON_TONE: Record<
  NextUpResult['reason'],
  {
    label: string
    chip: string
    icon: React.ComponentType<{ className?: string }>
  }
> = {
  overdue: {
    label: 'Overdue',
    chip: 'bg-destructive/10 text-destructive border-destructive/30',
    icon: AlertTriangle,
  },
  due_soon: {
    label: 'Due soon',
    chip: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30',
    icon: Clock,
  },
  later_today: {
    label: 'Later today',
    chip: 'bg-primary/10 text-primary border-primary/30',
    icon: ArrowRight,
  },
}

function NextUpPanel({
  nextUp,
  allDone,
  totalToday,
  onStartChecklist,
  onContinueChecklist,
}: {
  nextUp: NextUpResult | null
  allDone: boolean
  totalToday: number
  onStartChecklist: (templateId: string) => void
  onContinueChecklist: (submissionId: string) => void
}) {
  // No tasks today
  if (totalToday === 0) {
    return (
      <div className='border-border/60 bg-background/60 flex w-full max-w-sm items-center gap-3 rounded-xl border p-4 backdrop-blur-sm lg:w-[360px]'>
        <div className='bg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-lg'>
          <ClipboardCheck
            className='text-muted-foreground/60 h-5 w-5'
            aria-hidden='true'
          />
        </div>
        <div className='min-w-0'>
          <p className='text-muted-foreground text-[10px] font-medium tracking-wider uppercase'>
            Next up
          </p>
          <p className='text-sm font-semibold'>Nothing scheduled today</p>
          <p className='text-muted-foreground mt-0.5 text-xs'>
            See the upcoming schedule below.
          </p>
        </div>
      </div>
    )
  }

  // All caught up
  if (allDone || !nextUp) {
    return (
      <div className='flex w-full max-w-sm items-center gap-3 rounded-xl border border-green-500/20 bg-green-500/5 p-4 lg:w-[360px]'>
        <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-500/15'>
          <CheckCircle2 className='h-5 w-5 text-green-500' aria-hidden='true' />
        </div>
        <div className='min-w-0'>
          <p className='text-[10px] font-medium tracking-wider text-green-600 uppercase dark:text-green-400'>
            All caught up
          </p>
          <p className='text-sm font-semibold'>Today's checklist is complete</p>
          <p className='text-muted-foreground mt-0.5 text-xs'>
            Great work — see Recent Activity for details.
          </p>
        </div>
      </div>
    )
  }

  const tone = REASON_TONE[nextUp.reason]
  const Icon = tone.icon
  const isContinue = !!nextUp.submission

  return (
    <div className='border-border/60 bg-background/60 group flex w-full max-w-sm flex-col gap-3 rounded-xl border p-4 backdrop-blur-sm lg:w-[360px]'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-muted-foreground text-[10px] font-medium tracking-wider uppercase'>
          Next up
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
            tone.chip
          )}
        >
          <Icon className='h-3 w-3' aria-hidden='true' />
          {tone.label}
        </span>
      </div>

      <div className='flex items-start gap-3'>
        <div
          className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg'
          style={{ backgroundColor: `${nextUp.task.color}18` }}
        >
          <ClipboardCheck
            className='h-5 w-5'
            style={{ color: nextUp.task.color }}
            aria-hidden='true'
          />
        </div>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm font-semibold'>
            {nextUp.task.template_name}
          </p>
          <div className='text-muted-foreground mt-0.5 flex items-center gap-2 text-xs'>
            {nextUp.task.working_area_name ? (
              <span className='flex items-center gap-1 truncate'>
                <MapPin className='h-3 w-3 shrink-0' aria-hidden='true' />
                {nextUp.task.working_area_name}
              </span>
            ) : null}
            <span className='text-muted-foreground/40'>·</span>
            <span>
              {nextUp.task.items_count} item
              {nextUp.task.items_count === 1 ? '' : 's'}
            </span>
            <span className='text-muted-foreground/40'>·</span>
            <span>~{nextUp.task.estimated_duration_minutes}m</span>
          </div>
        </div>
      </div>

      <Button
        size='sm'
        onClick={() => {
          if (isContinue && nextUp.submission) {
            onContinueChecklist(nextUp.submission.id)
          } else {
            onStartChecklist(nextUp.task.template_id)
          }
        }}
        className='h-9 w-full gap-2'
      >
        {isContinue ? (
          <>
            <PlayCircle className='h-4 w-4' aria-hidden='true' />
            Continue checklist
          </>
        ) : (
          <>
            <PlayCircle className='h-4 w-4' aria-hidden='true' />
            Start checklist
          </>
        )}
      </Button>
    </div>
  )
}

// Created and developed by Jai Singh
