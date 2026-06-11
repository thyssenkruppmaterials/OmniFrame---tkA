// Created and developed by Jai Singh
/**
 * `<OperatorLane>` — one column in the dispatcher grid.
 *
 * Layout: lane chrome (operator chip + status + queued count)
 * stacked on top of NOW (hero card) stacked on top of NEXT (slim
 * pipeline rows). The lane registers itself as TWO droppables on
 * the parent `<DndContext>`:
 *
 *   - `lane-zone::<workerId>::after-now`        — drop directly
 *      after the active task. Visually highlighted as "Drop after
 *      current".
 *   - `lane-zone::<workerId>::end-of-pipeline`  — drop at the end
 *      of the queue. Visually highlighted as "Drop at end".
 *
 * Within-lane reorders are handled by the parent's `<DndContext>`
 * + this lane's `<SortableContext>`. Cross-lane drops fire
 * `onCrossLaneReassign` on the parent which calls the
 * `useCrossLaneReassign` hook.
 *
 * Virtualization: the NEXT pipeline turns on `@tanstack/react-virtual`
 * when the lane's task count exceeds `VIRTUALIZATION_PER_LANE_THRESHOLD`
 * OR the parent passes `forceVirtualize` (because total tasks
 * across the grid exceeds the global threshold). The hero NOW card
 * is never virtualized.
 */
import { useMemo, useRef } from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useVirtualizer } from '@tanstack/react-virtual'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Activity,
  ListTodo,
  Pause,
  Sparkles,
  Users,
  WifiOff,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CycleCountTask, WorkerStatus } from '@/lib/work-service/types'
import { useOperatorTaskQueueOrder } from '@/hooks/use-operator-task-queue-order'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  OPERATOR_TASK_QUEUE_LIMIT,
  PIPELINE_ITEM_VARIANTS,
  PIPELINE_LIST_VARIANTS,
  PIPELINE_ROW_HEIGHT_PX,
  PIPELINE_SCROLL_HEIGHT_PX,
  SPRING_LANE_ENTER,
  VIRTUALIZATION_PER_LANE_THRESHOLD,
} from './constants'
import { DispatcherTaskCard, DispatcherTaskCardSkeleton } from './task-card'
import { encodeLaneDropZoneId, encodeLaneTaskId } from './types'

interface OperatorLaneProps {
  worker: WorkerStatus
  tasks: CycleCountTask[]
  isLoading: boolean
  error: Error | null
  /**
   * Worker id of the currently dragged task's source lane (if any).
   * Drives the "drop target" highlight on this lane when the
   * dragged task came from elsewhere.
   */
  dragSourceWorkerId: string | null
  /**
   * Task id currently being dragged (any lane). Used to fade out
   * the source slot in the original lane.
   */
  draggingTaskId: string | null
  /** Force virtualization on regardless of per-lane threshold. */
  forceVirtualize?: boolean
  /** Whether the lane is currently considered the offline ghost lane. */
  isGhost?: boolean
  staggerEnter?: boolean
}

const STATUS_THEME = {
  busy: {
    label: 'Busy',
    border: 'border-orange-500/30 dark:border-orange-500/25',
    chipBg: 'bg-orange-500/15 dark:bg-orange-500/10',
    chipText: 'text-orange-700 dark:text-orange-400',
    icon: Activity,
    headerBg: 'bg-orange-500/[0.04] dark:bg-orange-500/[0.06]',
  },
  online: {
    label: 'Online',
    border: 'border-emerald-500/25 dark:border-emerald-500/20',
    chipBg: 'bg-emerald-500/15 dark:bg-emerald-500/10',
    chipText: 'text-emerald-700 dark:text-emerald-400',
    icon: Users,
    headerBg: 'bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06]',
  },
  idle: {
    label: 'Idle',
    border: 'border-sky-500/25 dark:border-sky-500/20',
    chipBg: 'bg-sky-500/15 dark:bg-sky-500/10',
    chipText: 'text-sky-700 dark:text-sky-400',
    icon: Pause,
    headerBg: 'bg-sky-500/[0.04] dark:bg-sky-500/[0.06]',
  },
  break: {
    label: 'Break',
    border: 'border-amber-500/25 dark:border-amber-500/20',
    chipBg: 'bg-amber-500/15 dark:bg-amber-500/10',
    chipText: 'text-amber-700 dark:text-amber-400',
    icon: Pause,
    headerBg: 'bg-amber-500/[0.04] dark:bg-amber-500/[0.06]',
  },
  offline: {
    label: 'Offline',
    border: 'border-border/50',
    chipBg: 'bg-slate-500/10 dark:bg-slate-400/10',
    chipText: 'text-slate-600 dark:text-slate-400',
    icon: WifiOff,
    headerBg: 'bg-card/60',
  },
} as const

/**
 * Sortable wrapper around `<DispatcherTaskCard>`. Owns the
 * `useSortable` hook and threads its drag handle props into the
 * card's grip button.
 */
function SortableTaskRow({
  task,
  workerId,
  position,
  draggingTaskId,
  variant,
}: {
  task: CycleCountTask
  workerId: string
  position: number
  draggingTaskId: string | null
  variant: 'now' | 'pipeline'
}) {
  const sortableId = encodeLaneTaskId(workerId, task.id)
  const inProgress = task.status === 'in_progress'
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sortableId,
    disabled: inProgress,
    data: { workerId, task },
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  // Fade the source slot when the card is mid-drag (the DragOverlay
  // shows the lifted version). `draggingTaskId` is global — the
  // dispatcher uses one DndContext.
  const isDragSource = draggingTaskId === task.id || isDragging

  // `useSortable` types `listeners` and `attributes` as DnD-kit's
  // own narrow shapes; spread them onto the grip button via the
  // task card's loose `dragHandleProps` bag. The unknown casts are
  // intentional — the prop bag is only spread, never read by the
  // task card.
  const dragHandleProps = inProgress
    ? null
    : {
        attributes: attributes as unknown as Record<
          string,
          string | number | boolean | undefined
        >,
        listeners: listeners as unknown as
          | Record<string, (e: never) => void>
          | undefined,
      }

  return (
    <div ref={setNodeRef} style={style}>
      <DispatcherTaskCard
        task={task}
        position={position}
        variant={variant}
        dragHandleProps={dragHandleProps}
        isDragSource={isDragSource}
      />
    </div>
  )
}

export function OperatorLane({
  worker,
  tasks,
  isLoading,
  error,
  dragSourceWorkerId,
  draggingTaskId,
  forceVirtualize,
  isGhost,
  staggerEnter,
}: OperatorLaneProps) {
  const theme = STATUS_THEME[worker.status] ?? STATUS_THEME.offline
  const StatusIcon = theme.icon
  const operatorId = worker.user_id

  // Apply the supervisor reorder scratchpad. Same hook as the
  // per-operator dialog — sharing the storage key shape means the
  // dispatcher and dialog stay lockstep.
  const visibleTasks = useMemo(
    () => tasks.slice(0, OPERATOR_TASK_QUEUE_LIMIT),
    [tasks]
  )
  const { orderedItems } = useOperatorTaskQueueOrder<CycleCountTask>({
    operatorId,
    items: visibleTasks,
  })

  const nowTask = orderedItems[0] ?? null
  const pipelineTasks = orderedItems.slice(1)
  const overflowCount = Math.max(0, tasks.length - orderedItems.length)
  const totalTaskCount = tasks.length

  // Droppables — two distinct zones per lane.
  const afterNowDroppable = useDroppable({
    id: encodeLaneDropZoneId(operatorId, 'after-now'),
    data: { workerId: operatorId, zone: 'after-now' },
  })
  const endDroppable = useDroppable({
    id: encodeLaneDropZoneId(operatorId, 'end-of-pipeline'),
    data: { workerId: operatorId, zone: 'end-of-pipeline' },
  })

  const isCrossLaneTarget =
    dragSourceWorkerId !== null && dragSourceWorkerId !== operatorId
  const isOverAfterNow = afterNowDroppable.isOver && isCrossLaneTarget
  const isOverEnd = endDroppable.isOver && isCrossLaneTarget

  const sortableIds = useMemo(
    () => orderedItems.map((t) => encodeLaneTaskId(operatorId, t.id)),
    [orderedItems, operatorId]
  )

  // Virtualisation: only when threshold exceeded.
  const shouldVirtualize =
    forceVirtualize === true ||
    pipelineTasks.length > VIRTUALIZATION_PER_LANE_THRESHOLD
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? pipelineTasks.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => PIPELINE_ROW_HEIGHT_PX,
    overscan: 4,
  })

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{
        opacity: isGhost ? 0.35 : 1,
        y: 0,
        filter: isGhost ? 'grayscale(0.5)' : 'none',
      }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.25 } }}
      transition={SPRING_LANE_ENTER}
      data-testid={`operator-lane-${operatorId}`}
      className={cn(
        'bg-card/60 flex h-full min-w-[260px] flex-col rounded-xl border backdrop-blur-sm',
        theme.border,
        isCrossLaneTarget &&
          'border-emerald-500/40 ring-2 ring-emerald-500/15 transition-colors duration-300'
      )}
    >
      {/* Lane chrome — operator identity + status + queued count */}
      <div
        className={cn(
          'border-border/30 sticky top-0 z-10 flex items-center gap-2 rounded-t-xl border-b px-3 py-2',
          theme.headerBg
        )}
      >
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-2',
            theme.chipBg,
            theme.chipText,
            'ring-current/20'
          )}
        >
          {getInitials(worker.full_name)}
        </div>
        <div className='min-w-0 flex-1'>
          <div className='text-foreground truncate text-xs font-semibold'>
            {worker.full_name ?? 'Unknown'}
          </div>
          <div className='text-muted-foreground flex items-center gap-1.5 text-[10px]'>
            <StatusIcon className={cn('h-3 w-3', theme.chipText)} />
            <span className={theme.chipText}>{theme.label}</span>
            <span className='text-muted-foreground/40'>·</span>
            <span className='tabular-nums'>{totalTaskCount} queued</span>
          </div>
        </div>
      </div>

      <div className='flex flex-1 flex-col gap-3 p-3'>
        {/* NOW — hero slot */}
        <div className='space-y-1.5'>
          <div className='text-muted-foreground/80 flex items-center justify-between text-[10px] font-semibold tracking-wide uppercase'>
            <span>Now</span>
            {nowTask && nowTask.status === 'in_progress' && (
              <span className='inline-flex items-center gap-1 text-[9px] font-bold tracking-wide text-emerald-700 dark:text-emerald-400'>
                <span className='relative flex h-1.5 w-1.5'>
                  <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75' />
                  <span className='relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500' />
                </span>
                Active
              </span>
            )}
          </div>
          {error ? (
            <div className='rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-[11px]'>
              <div className='text-foreground font-semibold'>
                Couldn't load queue
              </div>
              <div className='text-muted-foreground'>
                {error.message ?? 'The work service did not respond.'}
              </div>
            </div>
          ) : isLoading ? (
            <DispatcherTaskCardSkeleton variant='now' />
          ) : nowTask ? (
            <SortableContext
              items={sortableIds}
              strategy={verticalListSortingStrategy}
            >
              <div
                ref={afterNowDroppable.setNodeRef}
                className={cn(
                  'rounded-lg transition-colors',
                  isOverAfterNow &&
                    'bg-emerald-500/10 ring-2 ring-emerald-500/40'
                )}
              >
                <SortableTaskRow
                  task={nowTask}
                  workerId={operatorId}
                  position={1}
                  draggingTaskId={draggingTaskId}
                  variant='now'
                />
                {isOverAfterNow && (
                  <div className='mt-1 rounded-lg border border-dashed border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-center text-[10px] font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-400'>
                    Drop after current
                  </div>
                )}
              </div>
            </SortableContext>
          ) : (
            <NowEmptyState worker={worker} totalTaskCount={totalTaskCount} />
          )}
        </div>

        {/* NEXT — pipeline */}
        <div className='flex min-h-0 flex-1 flex-col space-y-1.5'>
          <div className='text-muted-foreground/80 flex items-center justify-between text-[10px] font-semibold tracking-wide uppercase'>
            <span>Next</span>
            {overflowCount > 0 && (
              <span className='text-muted-foreground/70 inline-flex items-center gap-1 text-[10px] font-medium normal-case'>
                <Sparkles className='h-3 w-3' />+{overflowCount} more
              </span>
            )}
          </div>

          {error || isLoading ? (
            <div className='space-y-1.5'>
              <DispatcherTaskCardSkeleton />
              <DispatcherTaskCardSkeleton />
              <DispatcherTaskCardSkeleton />
            </div>
          ) : pipelineTasks.length === 0 ? (
            <PipelineEmptyState hasNow={!!nowTask} />
          ) : (
            <SortableContext
              items={sortableIds}
              strategy={verticalListSortingStrategy}
            >
              <div
                ref={endDroppable.setNodeRef}
                className={cn(
                  'min-h-[40px] rounded-lg transition-colors',
                  isOverEnd && 'bg-emerald-500/10 ring-2 ring-emerald-500/40'
                )}
              >
                {shouldVirtualize ? (
                  // Virtualised path needs a real overflow element
                  // because `useVirtualizer` calls
                  // `getScrollElement().scrollTop` to compute the
                  // visible range. Radix's `<ScrollArea>` hides its
                  // viewport behind an internal ref so we drop to a
                  // plain styled div here. The lighter-weight rendering
                  // is fine because virtualisation is the
                  // "many-rows" path — supervisors won't stop on
                  // these lanes; they're scrolling.
                  <div
                    ref={scrollRef}
                    className='overflow-y-auto pr-1'
                    style={{ height: PIPELINE_SCROLL_HEIGHT_PX }}
                  >
                    <div
                      style={{
                        height: virtualizer.getTotalSize(),
                        position: 'relative',
                      }}
                    >
                      {virtualizer.getVirtualItems().map((virtualRow) => {
                        const t = pipelineTasks[virtualRow.index]
                        return (
                          <div
                            key={virtualRow.key}
                            ref={virtualizer.measureElement}
                            data-index={virtualRow.index}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              right: 0,
                              transform: `translateY(${virtualRow.start}px)`,
                              paddingTop: 4,
                              paddingBottom: 4,
                            }}
                          >
                            <SortableTaskRow
                              task={t}
                              workerId={operatorId}
                              position={virtualRow.index + 2}
                              draggingTaskId={draggingTaskId}
                              variant='pipeline'
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <ScrollArea
                    className='pr-1'
                    style={{ maxHeight: PIPELINE_SCROLL_HEIGHT_PX }}
                  >
                    <motion.ul
                      className='space-y-1.5'
                      variants={PIPELINE_LIST_VARIANTS}
                      initial='hidden'
                      animate='visible'
                      custom={{ stagger: staggerEnter ?? false }}
                    >
                      <AnimatePresence initial={false}>
                        {pipelineTasks.map((t, idx) => (
                          <motion.li
                            key={t.id}
                            layout='position'
                            variants={PIPELINE_ITEM_VARIANTS}
                            initial='hidden'
                            animate='visible'
                            exit='exit'
                          >
                            <SortableTaskRow
                              task={t}
                              workerId={operatorId}
                              position={idx + 2}
                              draggingTaskId={draggingTaskId}
                              variant='pipeline'
                            />
                          </motion.li>
                        ))}
                      </AnimatePresence>
                    </motion.ul>
                  </ScrollArea>
                )}
                {isOverEnd && (
                  <div className='mt-1 rounded-lg border border-dashed border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-center text-[10px] font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-400'>
                    Drop at end
                  </div>
                )}
              </div>
            </SortableContext>
          )}
        </div>
      </div>
    </motion.div>
  )
}

function NowEmptyState({
  worker,
  totalTaskCount,
}: {
  worker: WorkerStatus
  totalTaskCount: number
}) {
  // Distinguish "operator just completed" from "operator queue clear".
  // The work-service status fields are the source of truth: a busy /
  // online operator with zero tasks is awaiting an assignment; an
  // idle / break operator with zero tasks is just clear.
  const isAwaitingAssignment =
    totalTaskCount === 0 &&
    (worker.status === 'busy' || worker.status === 'online')
  return (
    <motion.div
      animate={isAwaitingAssignment ? { opacity: [1, 0.7, 1] } : undefined}
      transition={
        isAwaitingAssignment
          ? { duration: 2, repeat: Infinity, ease: 'easeInOut' }
          : undefined
      }
      className='border-border/50 bg-muted/20 flex h-[120px] items-center justify-center gap-2 rounded-lg border border-dashed px-3 text-center'
    >
      <ListTodo className='text-muted-foreground/60 h-4 w-4 shrink-0' />
      <div>
        <p className='text-foreground text-xs font-medium'>
          {isAwaitingAssignment ? 'Awaiting next assignment' : 'Queue clear'}
        </p>
        <p className='text-muted-foreground text-[10px]'>
          {isAwaitingAssignment
            ? `${worker.full_name ?? 'Operator'} is ready for work`
            : 'No counts queued for this operator'}
        </p>
      </div>
    </motion.div>
  )
}

function PipelineEmptyState({ hasNow }: { hasNow: boolean }) {
  return (
    <div className='border-border/30 bg-muted/10 flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-4 text-center'>
      <p className='text-muted-foreground text-[10px]'>
        {hasNow ? 'No tasks queued after current.' : ' '}
      </p>
    </div>
  )
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '··'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
  }
  return name.substring(0, 2).toUpperCase()
}

// Created and developed by Jai Singh
