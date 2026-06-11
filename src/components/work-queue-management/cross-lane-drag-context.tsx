// Created and developed by Jai Singh
/**
 * `<CrossLaneDragContext>` — single `<DndContext>` wrapping every
 * lane in the dispatcher grid.
 *
 * Owns:
 *
 *   - PointerSensor with 5px activation distance (so a click on a
 *     card body doesn't get hijacked into a drag).
 *   - KeyboardSensor with the standard `sortableKeyboardCoordinates`
 *     coordinate getter so Tab/Space/Arrow navigation works.
 *   - `<DragOverlay>` rendering the floating task card with a
 *     2deg tilt + soft lift shadow during drag.
 *   - Drag-state bookkeeping (`activeTask`, `sourceWorkerId`)
 *     exposed to the dispatcher via the render-prop pattern so
 *     lanes can react (highlight target, fade source).
 *   - Drag-end resolution: within-lane reorder calls into the
 *     persistence hook reused from `operator-task-queue.tsx`;
 *     cross-lane drop fires `onCrossLaneReassign` with the
 *     decoded ids.
 *   - `aria-live="polite"` announcement region — narrates each
 *     successful keyboard / pointer move ("CC-… moved to Nikki
 *     Mason"). Throttled to 700ms so noisy reorder spam doesn't
 *     overwhelm screen readers.
 *
 * Cross-lane FLIP: we set `layoutId={`task-${countId}`}` on the
 * dragged card via the overlay so framer-motion can interpolate
 * the transition to the new lane on drop. Because the FLIP runs
 * inside `<DispatcherTaskCard variant="overlay">` and the source
 * card stays mounted with the same `layoutId`, framer's shared
 * layout machinery handles the cross-lane animation. If the FLIP
 * proves janky, the SHOULD-fallback in the spec is the existing
 * spring enter/exit pair on the lane's `<AnimatePresence>` — which
 * is already in place. We tested the FLIP path in development;
 * see `Implement-Work-Queue-Management-Tab.md` for the decision.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { logger } from '@/lib/utils/logger'
import type { CycleCountTask, WorkerStatus } from '@/lib/work-service/types'
import { DispatcherTaskCard } from './task-card'
import {
  decodeLaneDropZoneId,
  decodeLaneTaskId,
  type CrossLaneDragState,
} from './types'

interface CrossLaneDragContextProps {
  workers: WorkerStatus[]
  /**
   * Read-only access to per-lane task arrays for the in-context
   * drag handler. We need the source lane's current task list to
   * compute the within-lane reorder via `useOperatorTaskQueueOrder`.
   * The dispatcher passes `lanes` from `useMultiOperatorTasks` here.
   */
  getLaneTasks: (workerId: string) => CycleCountTask[]
  onCrossLaneReassign: (args: {
    task: CycleCountTask
    fromWorkerId: string
    toWorkerId: string
  }) => void
  children: (state: CrossLaneDragState) => ReactNode
}

/**
 * The dispatcher reuses the per-operator localStorage scratchpad
 * for within-lane reorder. The scratchpad is keyed by operator id;
 * to avoid mounting one `useOperatorTaskQueueOrder` hook per lane
 * inside this drag context (which would couple the context to the
 * lane lifecycle), we call it dynamically inside the drag-end
 * handler via a small adapter. This keeps the source of truth
 * single (the localStorage entry) and means a within-lane
 * reorder via this drag context behaves identically to a within-
 * lane reorder via the per-operator dialog.
 */
function reorderInLane(
  workerId: string,
  tasks: CycleCountTask[],
  activeTaskId: string,
  overTaskId: string
) {
  // Mirrors the in-hook write path. We only persist the new id
  // sequence; the hook will re-read it on next render.
  if (typeof window === 'undefined') return
  if (activeTaskId === overTaskId) return
  const ids = tasks.map((t) => t.id)
  const fromIndex = ids.indexOf(activeTaskId)
  const toIndex = ids.indexOf(overTaskId)
  if (fromIndex === -1 || toIndex === -1) return
  const next = [...ids]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  try {
    window.localStorage.setItem(
      `omniframe.operator-task-queue-order.v1.${workerId}`,
      JSON.stringify(next)
    )
    // Trigger a synthetic `storage` event so the hook (in another
    // component) re-reads. Same-tab `setItem` does NOT fire `storage`
    // by default, so we dispatch one manually. Multi-tab works
    // automatically.
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: `omniframe.operator-task-queue-order.v1.${workerId}`,
        newValue: JSON.stringify(next),
      })
    )
  } catch (err) {
    logger.warn('[CrossLaneDragContext] Failed to persist reorder:', err)
  }
}

const ANNOUNCE_THROTTLE_MS = 700

export function CrossLaneDragContext({
  workers,
  getLaneTasks,
  onCrossLaneReassign,
  children,
}: CrossLaneDragContextProps) {
  const [drag, setDrag] = useState<CrossLaneDragState>({
    task: null,
    sourceWorkerId: null,
  })
  const [announcement, setAnnouncement] = useState('')
  const lastAnnounceAt = useRef(0)
  // Force a re-render when the lane mutation lands so the
  // `useOperatorTaskQueueOrder` hooks inside lanes pick up the
  // change. The synthetic StorageEvent above primes the hook on
  // its own; this is a defence-in-depth bump for direct setItem.
  const [, bumpReorderTick] = useState(0)

  // The lane's `useOperatorTaskQueueOrder` hook listens for
  // `storage` events on its key (cross-surface sync extension on
  // 2026-05-10). The dispatcher writes directly to localStorage
  // here and dispatches the synthetic event below; the lane re-
  // reads on its own.

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const announce = useCallback((message: string) => {
    const now = Date.now()
    if (now - lastAnnounceAt.current < ANNOUNCE_THROTTLE_MS) return
    lastAnnounceAt.current = now
    setAnnouncement(message)
  }, [])

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const decoded = decodeLaneTaskId(String(event.active.id))
      if (!decoded) return
      const tasks = getLaneTasks(decoded.workerId)
      const task = tasks.find((t) => t.id === decoded.taskId) ?? null
      if (!task) return
      setDrag({ task, sourceWorkerId: decoded.workerId })
    },
    [getLaneTasks]
  )

  const handleDragCancel = useCallback(() => {
    setDrag({ task: null, sourceWorkerId: null })
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      // Always reset the overlay state regardless of resolution.
      const startState = drag
      setDrag({ task: null, sourceWorkerId: null })

      if (!over) return
      const activeDecoded = decodeLaneTaskId(String(active.id))
      if (!activeDecoded) return
      const overIdStr = String(over.id)

      // Drop on a lane drop-zone (after-now / end-of-pipeline).
      const overZone = decodeLaneDropZoneId(overIdStr)
      if (overZone) {
        if (overZone.workerId === activeDecoded.workerId) {
          // Dropping on a zone in the SAME lane — interpret as
          // "move to that position within the same lane". The
          // sortable strategy handles within-lane reorder when
          // dropping on another task; for explicit drop-zones we
          // simulate "move to the end" or "after now" by writing
          // the desired order directly.
          const tasks = getLaneTasks(activeDecoded.workerId)
          if (tasks.length === 0) return
          const ids = tasks.map((t) => t.id)
          const fromIndex = ids.indexOf(activeDecoded.taskId)
          if (fromIndex === -1) return
          const next = ids.filter((id) => id !== activeDecoded.taskId)
          if (overZone.zone === 'after-now') {
            // Insert right after the current NOW (index 0 of remaining).
            // If the active task IS the now task, this is a no-op.
            if (fromIndex === 0) return
            next.splice(1, 0, activeDecoded.taskId)
          } else {
            next.push(activeDecoded.taskId)
          }
          if (typeof window !== 'undefined') {
            try {
              window.localStorage.setItem(
                `omniframe.operator-task-queue-order.v1.${activeDecoded.workerId}`,
                JSON.stringify(next)
              )
              window.dispatchEvent(
                new StorageEvent('storage', {
                  key: `omniframe.operator-task-queue-order.v1.${activeDecoded.workerId}`,
                  newValue: JSON.stringify(next),
                })
              )
              bumpReorderTick((n) => n + 1)
            } catch (err) {
              logger.warn(
                '[CrossLaneDragContext] Failed to persist same-lane drop:',
                err
              )
            }
          }
          return
        }
        // Cross-lane drop on a lane drop-zone.
        const sourceTasks = getLaneTasks(activeDecoded.workerId)
        const task =
          sourceTasks.find((t) => t.id === activeDecoded.taskId) ??
          startState.task
        if (!task) return
        if (task.status === 'in_progress') {
          announce(`Cannot reassign in-progress task ${task.count_number}.`)
          return
        }
        const target = workers.find((w) => w.user_id === overZone.workerId)
        announce(
          `${task.count_number} moved to ${target?.full_name ?? 'operator'}.`
        )
        onCrossLaneReassign({
          task,
          fromWorkerId: activeDecoded.workerId,
          toWorkerId: overZone.workerId,
        })
        return
      }

      // Drop on another sortable task.
      const overDecoded = decodeLaneTaskId(overIdStr)
      if (!overDecoded) return
      if (activeDecoded.taskId === overDecoded.taskId) return

      if (overDecoded.workerId === activeDecoded.workerId) {
        // Within-lane reorder.
        const tasks = getLaneTasks(activeDecoded.workerId)
        reorderInLane(
          activeDecoded.workerId,
          tasks,
          activeDecoded.taskId,
          overDecoded.taskId
        )
        bumpReorderTick((n) => n + 1)
        return
      }

      // Cross-lane drop directly on another task. Treat as
      // "reassign to the other lane and let the canonical priority
      // settle the position" — server resolves the actual order.
      const sourceTasks = getLaneTasks(activeDecoded.workerId)
      const task =
        sourceTasks.find((t) => t.id === activeDecoded.taskId) ??
        startState.task
      if (!task) return
      if (task.status === 'in_progress') {
        announce(`Cannot reassign in-progress task ${task.count_number}.`)
        return
      }
      const target = workers.find((w) => w.user_id === overDecoded.workerId)
      announce(
        `${task.count_number} moved to ${target?.full_name ?? 'operator'}.`
      )
      onCrossLaneReassign({
        task,
        fromWorkerId: activeDecoded.workerId,
        toWorkerId: overDecoded.workerId,
      })
    },
    [drag, getLaneTasks, onCrossLaneReassign, workers, announce]
  )

  // Clear the announcement after it's read so the same message can
  // be re-announced for a subsequent move.
  useEffect(() => {
    if (!announcement) return
    const id = setTimeout(() => setAnnouncement(''), ANNOUNCE_THROTTLE_MS * 2)
    return () => clearTimeout(id)
  }, [announcement])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      {children(drag)}
      <DragOverlay
        dropAnimation={{
          duration: 220,
          easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
        }}
      >
        {drag.task ? (
          <DispatcherTaskCard
            task={drag.task}
            variant='overlay'
            dragHandleProps={null}
          />
        ) : null}
      </DragOverlay>
      <div
        aria-live='polite'
        aria-atomic='true'
        role='status'
        className='sr-only'
      >
        {announcement}
      </div>
    </DndContext>
  )
}

// Created and developed by Jai Singh
