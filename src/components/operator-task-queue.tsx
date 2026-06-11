// Created and developed by Jai Singh
/**
 * `<OperatorTaskQueueDialog>` — supervisor pop-up of a single
 * operator's upcoming cycle-count tasks. Opened by clicking an
 * operator card on `<LiveOperatorStatus>` (Tab 1 — "On Counts").
 *
 * The dialog is a thin wrapper around `<OperatorTaskQueueBody>`
 * (the drag-to-reorder list, status row, reset/custom-order chips)
 * so the body can be reused or composed elsewhere if a future
 * surface wants a non-modal version. The body's contract is
 * `worker: WorkerStatus` — operator scope is implicit from the
 * card the supervisor clicked, so there's no operator selector
 * inside the dialog (clicking a different card opens that
 * operator's queue instead).
 *
 * ## Realtime
 *
 * Cache freshness comes from the existing
 * `WorkServiceWebSocket` singleton — `useWorkerTasks` invalidates on
 * `TaskAssigned` / `TaskStatusChanged` / `PushedWork` /
 * `ReservationEscalated` / `WorkerStatusChanged`. **No new
 * `supabase.channel(...)` callsite** — the component honours
 * `.cursor/rules/realtime-policy.mdc`.
 *
 * The body mounts only while the dialog is open, so the WS
 * subscription cleans up automatically on close (the `useEffect`
 * cleanup in `useWorkerTasks` removes the singleton handler).
 *
 * ## Reorder semantics (today)
 *
 * Drag-to-reorder is a **supervisor-side scratchpad** persisted to
 * `localStorage` keyed by operator. The backend ORDER BY
 * (priority → pushed_at → resolved_zone/aisle/sequence → location →
 * assigned_at) is the canonical source; the supervisor's reorder is
 * purely a presentation override. Clicking "Reset" restores the
 * canonical order. See
 * `Implementations/Implement-Operator-Cycle-Count-Queue-Tab` for the
 * follow-up work needed to make the order authoritative
 * (`ADR-Supervisor-Task-Queue-Reorder-Persistence`).
 *
 * ## Animation
 *
 * - Dialog backdrop + content: shadcn `<DialogContent>` ships with
 *   `data-[state=open]:animate-in data-[state=closed]:animate-out
 *   fade-in-0 zoom-in-95 duration-200` baked in — fade + scale 0.96
 *   → 1.0 on open, reverse on close. Radix's `Presence` defers the
 *   unmount until the exit animation finishes, so realtime cleanup
 *   happens at the right moment.
 * - Inner task list: framer-motion stagger (one-shot, on dialog
 *   open). Reorder transitions are owned by `@dnd-kit/sortable`
 *   (its `transform`/`transition` style on each sortable item).
 *   Honours `prefers-reduced-motion` via `useReducedMotion`.
 */
import { useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import {
  AlertCircle,
  GripVertical,
  ListTodo,
  Loader2,
  MapPin,
  Package,
  RotateCcw,
  Send,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  CycleCountPriority,
  CycleCountTask,
  WorkerStatus,
} from '@/lib/work-service/types'
import { useWorkerTasks } from '@/hooks/use-active-workers'
import { useOperatorTaskQueueOrder } from '@/hooks/use-operator-task-queue-order'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/**
 * How many tasks to show in the queue. The user asked for "next 10
 * to 15 tasks" — 12 sits in the middle of that band and matches the
 * typical 1–2 hour planning horizon for cycle-count work. The
 * backend returns the worker's full task list, so this trim is
 * purely a UI cap.
 */
export const OPERATOR_TASK_QUEUE_LIMIT = 12

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

interface SortableTaskCardProps {
  task: CycleCountTask
  position: number
}

function SortableTaskCard({ task, position }: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const theme = priorityTheme(task.priority)
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const wasPushed = Boolean(task.pushed_at)
  const inProgress = task.status === 'in_progress'
  const recount = task.status === 'recount'
  const path = [task.resolved_zone, task.resolved_aisle]
    .filter((s): s is string => Boolean(s))
    .join(' · ')

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group bg-card flex items-stretch gap-2 rounded-lg border border-l-4 transition-all',
        theme.cardAccent,
        isDragging
          ? 'z-10 opacity-90 shadow-lg ring-2 ring-blue-500/30'
          : 'hover:border-foreground/20 hover:shadow-sm',
        inProgress && 'ring-1 ring-emerald-500/20'
      )}
    >
      <button
        type='button'
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder task ${task.count_number}`}
        className='hover:bg-muted text-muted-foreground/60 hover:text-foreground flex shrink-0 cursor-grab touch-none items-center rounded-l-md px-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 active:cursor-grabbing'
      >
        <GripVertical className='h-4 w-4' aria-hidden='true' />
      </button>

      <div className='flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-3'>
        <div
          className={cn(
            'text-muted-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums',
            'bg-muted/60'
          )}
          aria-label={`Position ${position + 1}`}
          title={`Position ${position + 1}`}
        >
          {position + 1}
        </div>

        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-1.5'>
            <span className='text-foreground truncate text-xs font-semibold'>
              {task.count_number}
            </span>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0 text-[9px] font-semibold tracking-wide uppercase',
                theme.chipBg,
                theme.chipText
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', theme.dot)} />
              {theme.label}
            </span>
            {inProgress && (
              <span className='inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0 text-[9px] font-semibold tracking-wide text-emerald-700 uppercase dark:bg-emerald-500/10 dark:text-emerald-400'>
                In Progress
              </span>
            )}
            {recount && (
              <span className='inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0 text-[9px] font-semibold tracking-wide text-amber-700 uppercase dark:bg-amber-500/10 dark:text-amber-400'>
                Recount
              </span>
            )}
            {wasPushed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className='inline-flex shrink-0 items-center gap-0.5 rounded-full bg-violet-500/15 px-1.5 py-0 text-[9px] font-semibold tracking-wide text-violet-700 uppercase dark:bg-violet-500/10 dark:text-violet-400'
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

          <div className='text-muted-foreground mt-0.5 flex items-center gap-2 text-[11px]'>
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

          <div className='text-muted-foreground/90 mt-0.5 flex items-center gap-1 text-[11px]'>
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

        <div className='text-muted-foreground/80 flex shrink-0 flex-col items-end text-right text-[10px] tabular-nums'>
          <span className='font-mono'>
            {Number.isFinite(task.system_quantity) ? task.system_quantity : '—'}
          </span>
          <span className='text-muted-foreground/60'>
            {task.unit_of_measure || 'EA'}
          </span>
        </div>
      </div>
    </div>
  )
}

function TaskCardSkeleton() {
  return (
    <div className='border-border/40 bg-card/60 flex items-center gap-2 rounded-lg border border-l-4 px-3 py-2'>
      <div className='bg-muted/60 h-4 w-4 shrink-0 animate-pulse rounded' />
      <div className='bg-muted/60 h-7 w-7 shrink-0 animate-pulse rounded-md' />
      <div className='flex-1 space-y-1.5'>
        <div className='bg-muted/60 h-3 w-24 animate-pulse rounded' />
        <div className='bg-muted/40 h-2.5 w-40 animate-pulse rounded' />
      </div>
    </div>
  )
}

interface OperatorTaskQueueBodyProps {
  /**
   * The operator the queue is scoped to. Required — the queue is
   * always opened from a clicked card, so the caller knows which
   * operator the supervisor wants to see. There is no "Switch
   * operator" affordance inside the dialog (clicking a different
   * card on the panel re-opens the dialog scoped to that operator).
   */
  worker: WorkerStatus
}

/**
 * The actual task-queue surface — operator stats, status row,
 * sortable list, error/loading/empty states. Exported in case a
 * future surface wants a non-modal embedding (a side panel, an
 * expanded row, etc.); today only `<OperatorTaskQueueDialog>`
 * mounts it.
 */
export function OperatorTaskQueueBody({ worker }: OperatorTaskQueueBodyProps) {
  const operatorId = worker.user_id

  const {
    data: tasks = [],
    isLoading,
    error,
    refetch,
    isFetching,
  } = useWorkerTasks(operatorId, {
    enableRealtime: true,
  })

  const visibleTasks = useMemo(
    () => tasks.slice(0, OPERATOR_TASK_QUEUE_LIMIT),
    [tasks]
  )

  const { orderedItems, isCustomOrder, reorder, resetOrder } =
    useOperatorTaskQueueOrder<CycleCountTask>({
      operatorId,
      items: visibleTasks,
    })

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // 5px activation distance prevents click events from being
      // hijacked as drag starts when the supervisor just clicks a
      // card without intent to move it.
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    reorder(String(active.id), String(over.id))
  }

  const totalTaskCount = tasks.length
  const overflowCount = Math.max(0, totalTaskCount - OPERATOR_TASK_QUEUE_LIMIT)

  const prefersReducedMotion = useReducedMotion()
  // Stagger the initial reveal of the task list so it feels like the
  // dialog "fills in" rather than appearing all at once. Reduced-
  // motion users get instant cards (`duration: 0`) instead of a
  // disabled animation entirely so the visual outcome is identical.
  const listVariants: Variants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: prefersReducedMotion ? 0 : 0.025,
        delayChildren: prefersReducedMotion ? 0 : 0.05,
      },
    },
  }
  const itemVariants: Variants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 6 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: prefersReducedMotion ? 0 : 0.18,
        ease: 'easeOut',
      },
    },
  }

  return (
    <div className='space-y-3'>
      {/* Reorder controls + freshness chip — the operator name lives
          in the dialog header, so this row is just status + actions. */}
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]'>
          <span>
            Showing{' '}
            <span className='text-foreground font-semibold tabular-nums'>
              {orderedItems.length}
            </span>{' '}
            of{' '}
            <span className='text-foreground font-semibold tabular-nums'>
              {totalTaskCount}
            </span>{' '}
            {totalTaskCount === 1 ? 'task' : 'tasks'}
          </span>
          {overflowCount > 0 && (
            <span className='text-muted-foreground/80'>
              · +{overflowCount} more in backlog
            </span>
          )}
          {isFetching && !isLoading && (
            <span className='inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400'>
              <Loader2 className='h-3 w-3 animate-spin' />
              Updating…
            </span>
          )}
        </div>

        <div className='flex shrink-0 items-center gap-2'>
          {isCustomOrder && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className='inline-flex cursor-help items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-blue-700 uppercase dark:text-blue-400'>
                  <Sparkles className='h-3 w-3' />
                  Custom order
                </span>
              </TooltipTrigger>
              <TooltipContent side='left' className='max-w-[260px]'>
                <div className='text-[11px]'>
                  This queue is in your manually-saved order, not the default
                  priority order. The operator's RF queue still claims tasks in
                  the canonical priority order.
                </div>
              </TooltipContent>
            </Tooltip>
          )}
          <Button
            variant='ghost'
            size='sm'
            disabled={!isCustomOrder}
            onClick={resetOrder}
            className='h-7 px-2 text-[11px]'
            title='Reset to default priority order'
          >
            <RotateCcw className='mr-1 h-3 w-3' />
            Reset
          </Button>
        </div>
      </div>

      {/* Task list (or loading / error / empty) */}
      {error ? (
        <div className='flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] dark:border-amber-500/20'>
          <AlertCircle className='mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400' />
          <div className='min-w-0 flex-1'>
            <div className='text-foreground font-semibold'>
              Couldn't load this operator's queue
            </div>
            <div className='text-muted-foreground'>
              {error.message ??
                'The work service did not respond. Try refreshing or close and re-open this dialog.'}
            </div>
          </div>
          <Button
            variant='ghost'
            size='sm'
            className='h-7 px-2 text-[11px]'
            onClick={() => refetch()}
          >
            Retry
          </Button>
        </div>
      ) : isLoading ? (
        <div className='space-y-1.5'>
          <TaskCardSkeleton />
          <TaskCardSkeleton />
          <TaskCardSkeleton />
        </div>
      ) : orderedItems.length === 0 ? (
        <div className='border-border/50 bg-muted/20 flex items-center justify-center gap-3 rounded-xl border border-dashed py-8'>
          <div className='bg-muted/60 flex h-10 w-10 items-center justify-center rounded-full'>
            <ListTodo className='text-muted-foreground/60 h-5 w-5' />
          </div>
          <div>
            <p className='text-foreground text-sm font-medium'>
              No tasks in queue
            </p>
            <p className='text-muted-foreground text-[11px]'>
              {worker.full_name ?? 'This operator'} isn't assigned any pending
              counts right now.
            </p>
          </div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={orderedItems.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <motion.ul
              className='space-y-1.5'
              variants={listVariants}
              initial='hidden'
              animate='visible'
            >
              {orderedItems.map((task, idx) => (
                <motion.li key={task.id} variants={itemVariants}>
                  <SortableTaskCard task={task} position={idx} />
                </motion.li>
              ))}
            </motion.ul>
          </SortableContext>
        </DndContext>
      )}

      <p className='text-muted-foreground/70 text-[10px] italic'>
        Drag the grip on the left to reorder. Reorders are saved per operator on
        this device — the operator's RF queue still claims tasks in the
        canonical priority order until a server-side reorder endpoint ships.
      </p>
    </div>
  )
}

interface OperatorTaskQueueDialogProps {
  /**
   * The operator the dialog is scoped to. Pass `null` (and `open=false`)
   * when no operator is selected. Keeping the prop on the parent and
   * conditionally rendering the body inside the Dialog means the WS
   * subscription inside `useWorkerTasks(...)` mounts only while the
   * dialog is open and unmounts on close — no leaked handlers.
   */
  worker: WorkerStatus | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Click-to-open per-operator task queue dialog. Mounted once at the
 * bottom of `<LiveOperatorStatus>`; opens when an operator card is
 * clicked. The dialog header carries the operator's identity; the
 * body is the existing reorderable task queue, scoped to that
 * operator.
 *
 * The dialog defers to shadcn's `<Dialog>` for backdrop fade,
 * content scale-in, focus trap, and ESC handling; framer-motion is
 * only layered on the inner list for the stagger reveal. This keeps
 * the shared `<DialogContent>` primitive untouched.
 */
export function OperatorTaskQueueDialog({
  worker,
  open,
  onOpenChange,
}: OperatorTaskQueueDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[85vh] w-full flex-col gap-0 p-0 sm:max-w-2xl'>
        <DialogHeader className='border-border/40 border-b px-5 pt-5 pb-4'>
          <DialogTitle className='text-base font-semibold'>
            {worker?.full_name ?? 'Operator queue'}
          </DialogTitle>
          <DialogDescription className='text-[11px]'>
            Up next — drag to reorder this supervisor view of the operator's
            pending and in-progress cycle counts.
          </DialogDescription>
        </DialogHeader>

        <div className='min-h-0 flex-1 overflow-y-auto px-5 py-4'>
          {worker ? (
            <OperatorTaskQueueBody worker={worker} />
          ) : (
            <div className='text-muted-foreground py-8 text-center text-xs'>
              Select an operator to see their queue.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
