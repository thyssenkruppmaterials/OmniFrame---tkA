// Created and developed by Jai Singh
/**
 * `<DispatcherTaskCard>` — task row presentation for the dispatcher
 * lanes. Mirrors the visual vocabulary of `<SortableTaskCard>` from
 * `operator-task-queue.tsx` (priority pill, status chips, position
 * chip, location/material/qty layout) so the dispatcher feels like
 * a sibling surface to the existing dialog.
 *
 * Differences from the dialog row:
 *
 * - The DnD plumbing (`useSortable`, `attributes`, `listeners`)
 *   lives in the wrapper component (`SortableTaskRow`) rather than
 *   here so this component stays a pure render. The cross-lane drag
 *   context owns the single `<DndContext>` for the whole tab; lanes
 *   just provide `<SortableContext>` children. Keeping the row
 *   presentation drag-context-agnostic also means the NOW hero and
 *   the drag overlay can both reuse it without a parallel render
 *   path.
 * - The hero (`variant="now"`) variant is taller, gets a ring/glow
 *   pulse for in-progress, and uses larger type. The pipeline
 *   variant is denser (slim row, single line of metadata).
 *
 * Honours the `<MotionConfig reducedMotion="user">` wrapper at the
 * tab level — the glow loop is wrapped in a `useReducedMotion`
 * gate so the pulse simplifies to a static ring for users with
 * reduced-motion enabled.
 */
import { memo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { motion, useReducedMotion } from 'framer-motion'
import { GripVertical, MapPin, Package, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  CycleCountPriority,
  CycleCountTask,
} from '@/lib/work-service/types'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ACTIVE_GLOW_KEYFRAMES, ACTIVE_GLOW_TRANSITION } from './constants'

const PRIORITY_THEME: Record<
  CycleCountPriority,
  {
    label: string
    dot: string
    chipBg: string
    chipText: string
    cardAccent: string
  }
> = {
  critical: {
    label: 'Critical',
    dot: 'bg-red-500',
    chipBg: 'bg-red-500/15 dark:bg-red-500/10',
    chipText: 'text-red-700 dark:text-red-400',
    cardAccent: 'border-l-red-500/70',
  },
  hot: {
    label: 'Hot',
    dot: 'bg-orange-500',
    chipBg: 'bg-orange-500/15 dark:bg-orange-500/10',
    chipText: 'text-orange-700 dark:text-orange-400',
    cardAccent: 'border-l-orange-500/70',
  },
  normal: {
    label: 'Normal',
    dot: 'bg-blue-500',
    chipBg: 'bg-blue-500/15 dark:bg-blue-500/10',
    chipText: 'text-blue-700 dark:text-blue-400',
    cardAccent: 'border-l-blue-500/60',
  },
  low: {
    label: 'Low',
    dot: 'bg-slate-400',
    chipBg: 'bg-slate-500/10 dark:bg-slate-400/10',
    chipText: 'text-slate-600 dark:text-slate-400',
    cardAccent: 'border-l-slate-400/50',
  },
}

function priorityTheme(priority: string) {
  return PRIORITY_THEME[priority as CycleCountPriority] ?? PRIORITY_THEME.normal
}

interface DispatcherTaskCardProps {
  task: CycleCountTask
  /** 1-indexed position in the lane. Hidden on the NOW hero. */
  position?: number
  /**
   * Layout variant.
   * - `'now'`     — hero NOW card (taller, larger type, glow when active)
   * - `'pipeline'` — slim row in the NEXT pipeline
   * - `'overlay'`  — render shape used inside `<DragOverlay>`
   *                  (slight tilt + lift, no drag handle visible)
   */
  variant: 'now' | 'pipeline' | 'overlay'
  /**
   * Drag-handle props from `useSortable`. When `null`, the grip
   * affordance still renders (so the layout is consistent) but
   * doesn't accept pointer events. Pass `null` for in-progress
   * tasks (the dispatcher disables their drag); the visual cue is
   * a `cursor-not-allowed` and a muted handle.
   *
   * Loosely typed as a generic prop bag so this card can be reused
   * inside a drag overlay (no real listeners) without the `dnd-kit`
   * type leaking into a presentational component.
   */
  dragHandleProps?: {
    listeners?: Record<string, (e: never) => void> | undefined
    attributes?: Record<string, string | number | boolean | undefined>
    onPointerDown?: (e: React.PointerEvent) => void
  } | null
  /**
   * `true` when the row is currently being dragged (its source
   * slot). Renders a dashed outline so the supervisor sees where
   * the card came from.
   */
  isDragSource?: boolean
}

/**
 * Pure presentational task row. No drag plumbing, no data fetch —
 * everything required is passed in as props. Memoized because the
 * dispatcher re-renders the lane on every WS event and most
 * prop changes are referentially equal.
 */
export const DispatcherTaskCard = memo(function DispatcherTaskCard({
  task,
  position,
  variant,
  dragHandleProps,
  isDragSource,
}: DispatcherTaskCardProps) {
  const theme = priorityTheme(task.priority)
  const wasPushed = Boolean(task.pushed_at)
  const inProgress = task.status === 'in_progress'
  const recount = task.status === 'recount'
  const path = [task.resolved_zone, task.resolved_aisle]
    .filter((s): s is string => Boolean(s))
    .join(' · ')
  const isHero = variant === 'now'
  const isOverlay = variant === 'overlay'
  const prefersReducedMotion = useReducedMotion()
  const dragDisabled = dragHandleProps === null

  return (
    <motion.div
      data-testid={`dispatcher-task-${task.id}`}
      data-variant={variant}
      animate={
        isHero && inProgress && !prefersReducedMotion
          ? { boxShadow: ACTIVE_GLOW_KEYFRAMES as unknown as string[] }
          : undefined
      }
      transition={
        isHero && inProgress && !prefersReducedMotion
          ? ACTIVE_GLOW_TRANSITION
          : undefined
      }
      className={cn(
        'group bg-card relative flex items-stretch gap-2 rounded-lg border border-l-4 transition-all',
        theme.cardAccent,
        isHero && 'border-emerald-500/0',
        isHero && inProgress && 'ring-1 ring-emerald-500/40',
        !isHero && inProgress && 'ring-1 ring-emerald-500/30',
        !isHero && !isOverlay && 'hover:border-foreground/20 hover:shadow-sm',
        isOverlay && 'scale-[1.02] rotate-[2deg] shadow-xl shadow-black/20',
        isDragSource &&
          'outline-foreground/30 opacity-30 outline-2 outline-dashed'
      )}
    >
      <button
        type='button'
        aria-label={
          dragDisabled
            ? `Cannot reassign in-progress task ${task.count_number}`
            : `Drag to reorder or reassign task ${task.count_number}`
        }
        disabled={dragDisabled}
        {...(dragHandleProps?.attributes ?? {})}
        {...(dragHandleProps?.listeners ?? {})}
        onPointerDown={dragHandleProps?.onPointerDown}
        className={cn(
          'flex shrink-0 items-center rounded-l-md px-1.5 transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2',
          dragDisabled
            ? 'text-muted-foreground/30 cursor-not-allowed'
            : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted cursor-grab touch-none active:cursor-grabbing',
          isOverlay && 'pointer-events-none'
        )}
      >
        <GripVertical
          className={cn(isHero ? 'h-4 w-4' : 'h-3.5 w-3.5')}
          aria-hidden='true'
        />
      </button>

      <div
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2.5 pr-3',
          isHero ? 'py-3' : 'py-2'
        )}
      >
        {!isHero && typeof position === 'number' && (
          <div
            className='text-muted-foreground bg-muted/60 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums'
            aria-label={`Position ${position}`}
            title={`Position ${position}`}
          >
            {position}
          </div>
        )}

        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-1.5'>
            <span
              className={cn(
                'text-foreground truncate font-semibold',
                isHero ? 'text-sm' : 'text-xs'
              )}
            >
              {task.count_number}
            </span>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0 font-semibold tracking-wide uppercase',
                isHero ? 'text-[10px]' : 'text-[9px]',
                theme.chipBg,
                theme.chipText
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', theme.dot)} />
              {theme.label}
            </span>
            {inProgress && (
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0 font-semibold tracking-wide text-emerald-700 uppercase dark:bg-emerald-500/10 dark:text-emerald-400',
                  isHero ? 'text-[10px]' : 'text-[9px]'
                )}
              >
                In Progress
              </span>
            )}
            {recount && (
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0 font-semibold tracking-wide text-amber-700 uppercase dark:bg-amber-500/10 dark:text-amber-400',
                  isHero ? 'text-[10px]' : 'text-[9px]'
                )}
              >
                Recount
              </span>
            )}
            {wasPushed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-0.5 rounded-full bg-violet-500/15 px-1.5 py-0 font-semibold tracking-wide text-violet-700 uppercase dark:bg-violet-500/10 dark:text-violet-400',
                      isHero ? 'text-[10px]' : 'text-[9px]'
                    )}
                    aria-label='Pushed by supervisor'
                  >
                    <Send className='h-2.5 w-2.5' />
                    Pushed
                  </span>
                </TooltipTrigger>
                <TooltipContent side='top' align='start'>
                  <div className='text-[11px]'>
                    Pushed{' '}
                    {task.pushed_at
                      ? formatDistanceToNow(new Date(task.pushed_at), {
                          addSuffix: true,
                        })
                      : 'recently'}
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          <div
            className={cn(
              'text-muted-foreground mt-0.5 flex items-center gap-2',
              isHero ? 'text-[12px]' : 'text-[11px]'
            )}
          >
            <span className='inline-flex min-w-0 items-center gap-1'>
              <MapPin className='h-3 w-3 shrink-0' />
              <span className='truncate font-mono'>{task.location}</span>
            </span>
            {path && (
              <>
                <span className='text-muted-foreground/40'>·</span>
                <span className='truncate text-[10px]'>{path}</span>
              </>
            )}
          </div>

          <div
            className={cn(
              'text-muted-foreground/90 mt-0.5 flex items-center gap-1',
              isHero ? 'text-[12px]' : 'text-[11px]'
            )}
          >
            <Package className='h-3 w-3 shrink-0' />
            <span className='truncate font-mono text-[10px]'>
              {task.material_number}
            </span>
            {task.material_description && (
              <span className='truncate'>
                {' '}
                <span className='text-muted-foreground/50'>·</span>{' '}
                <span className='text-foreground/80 truncate'>
                  {task.material_description}
                </span>
              </span>
            )}
          </div>
        </div>

        <div
          className={cn(
            'text-muted-foreground/80 flex shrink-0 flex-col items-end text-right tabular-nums',
            isHero ? 'text-[11px]' : 'text-[10px]'
          )}
        >
          <span className='font-mono'>
            {Number.isFinite(task.system_quantity) ? task.system_quantity : '—'}
          </span>
          <span className='text-muted-foreground/60'>
            {task.unit_of_measure || 'EA'}
          </span>
        </div>
      </div>
    </motion.div>
  )
})

/**
 * Skeleton placeholder used by the lane during the first paint.
 * Matches the pipeline row height so the lane doesn't reflow when
 * data lands.
 */
export function DispatcherTaskCardSkeleton({
  variant = 'pipeline',
}: {
  variant?: 'now' | 'pipeline'
}) {
  const isHero = variant === 'now'
  return (
    <div
      className={cn(
        'border-border/40 bg-card/60 flex items-center gap-2 rounded-lg border border-l-4 px-3',
        isHero ? 'h-[120px] py-3' : 'py-2'
      )}
    >
      <div className='bg-muted/60 h-4 w-4 shrink-0 animate-pulse rounded' />
      {!isHero && (
        <div className='bg-muted/60 h-7 w-7 shrink-0 animate-pulse rounded-md' />
      )}
      <div className='flex-1 space-y-1.5'>
        <div
          className={cn(
            'bg-muted/60 animate-pulse rounded',
            isHero ? 'h-4 w-32' : 'h-3 w-24'
          )}
        />
        <div
          className={cn(
            'bg-muted/40 animate-pulse rounded',
            isHero ? 'h-3 w-48' : 'h-2.5 w-40'
          )}
        />
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
