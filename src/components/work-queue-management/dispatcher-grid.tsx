// Created and developed by Jai Singh
/**
 * `<DispatcherGrid>` — the dispatcher canvas: lanes laid out edge-
 * to-edge with the cross-lane drag context wrapping them.
 *
 * Stitches together:
 *
 *   - `useMultiOperatorTasks` (data layer + shell-level WS handler)
 *   - `useCrossLaneReassign` (mutation + optimistic UI + Undo toast)
 *   - `<CrossLaneDragContext>` (single DndContext + DragOverlay)
 *   - `<OperatorLane>` per active worker
 *
 * Layout:
 *
 *   - `grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))`
 *     gives each lane a comfortable width and wraps to a new row
 *     when the supervisor's viewport runs out of horizontal space.
 *     A `max-w` cap on the grid keeps the lanes from stretching
 *     thin on ultra-wide displays.
 *   - The grid scrolls horizontally past ~6 lanes (we hint with
 *     `overflow-x-auto` instead of forcing a fixed lane count so
 *     widescreen monitors get the full canvas).
 *
 * The "ghost lane" treatment for offline operators is handled
 * inside `<OperatorLane>` itself; the dispatcher decides whether
 * to keep an operator mounted as a ghost (recently went offline)
 * or unmount entirely (offline + pruned).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Users, WifiOff } from 'lucide-react'
import type { WorkerStatus } from '@/lib/work-service/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  VIRTUALIZATION_PER_LANE_THRESHOLD,
  VIRTUALIZATION_TOTAL_THRESHOLD,
} from './constants'
import { CrossLaneDragContext } from './cross-lane-drag-context'
import { useCrossLaneReassign } from './hooks/use-cross-lane-reassign'
import { useMultiOperatorTasks } from './hooks/use-multi-operator-tasks'
import { OperatorLane } from './operator-lane'

interface DispatcherGridProps {
  workers: WorkerStatus[]
  /**
   * `true` when the active workers list is still loading. Drives
   * the skeleton lanes during first paint.
   */
  isWorkersLoading: boolean
}

/**
 * How long an operator that just went offline stays mounted as a
 * "ghost lane" before being unmounted. Preserves the supervisor's
 * spatial memory and avoids layout-reflow chaos when an operator
 * blips offline mid-session.
 */
const GHOST_LANE_TTL_MS = 6_000

export function DispatcherGrid({
  workers,
  isWorkersLoading,
}: DispatcherGridProps) {
  // Keep a stable list of "currently visible" workers — active
  // operators plus recently-offline ghosts that haven't yet
  // expired. Recomputed when the source `workers` array changes.
  const visibleWorkers = useGhostLaneWorkers(workers)

  const { lanes, isWsConnected } = useMultiOperatorTasks({
    workers: visibleWorkers,
  })

  const { reassign } = useCrossLaneReassign({ workers: visibleWorkers })

  // Total task count across all visible lanes — drives the
  // global virtualisation toggle.
  const totalTaskCount = useMemo(() => {
    let total = 0
    lanes.forEach((lane) => {
      total += lane.tasks.length
    })
    return total
  }, [lanes])
  const forceVirtualizeAll = totalTaskCount > VIRTUALIZATION_TOTAL_THRESHOLD

  const getLaneTasks = useMemo(() => {
    return (workerId: string) => lanes.get(workerId)?.tasks ?? []
  }, [lanes])

  if (!isWorkersLoading && visibleWorkers.length === 0) {
    return <NoActiveOperatorsEmptyState />
  }

  return (
    <div className='flex flex-col gap-3'>
      {!isWsConnected && (
        <Alert
          variant='default'
          className='border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10'
        >
          <WifiOff className='h-4 w-4 text-amber-700 dark:text-amber-400' />
          <AlertTitle className='text-foreground'>Reconnecting…</AlertTitle>
          <AlertDescription className='text-muted-foreground'>
            The realtime feed is offline. Showing the last-known queue state —
            your view will resync when the connection recovers.
          </AlertDescription>
        </Alert>
      )}

      <CrossLaneDragContext
        workers={visibleWorkers}
        getLaneTasks={getLaneTasks}
        onCrossLaneReassign={reassign}
      >
        {(drag) => (
          <div
            className='grid auto-cols-[minmax(260px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-3 sm:auto-cols-[minmax(280px,1fr)]'
            style={{ scrollbarWidth: 'thin' }}
          >
            <AnimatePresence initial={false}>
              {visibleWorkers.map((worker) => {
                const lane = lanes.get(worker.user_id)
                if (!lane) return null
                const isGhost = worker.status === 'offline'
                const forceLaneVirtualize =
                  forceVirtualizeAll ||
                  lane.tasks.length > VIRTUALIZATION_PER_LANE_THRESHOLD
                return (
                  <OperatorLane
                    key={worker.user_id}
                    worker={worker}
                    tasks={lane.tasks}
                    isLoading={lane.isLoading}
                    error={lane.error}
                    dragSourceWorkerId={drag.sourceWorkerId}
                    draggingTaskId={drag.task?.id ?? null}
                    forceVirtualize={forceLaneVirtualize}
                    isGhost={isGhost}
                    staggerEnter={lane.staggerEnter}
                  />
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </CrossLaneDragContext>
    </div>
  )
}

interface GhostEntry {
  worker: WorkerStatus
  expiresAt: number
}

/**
 * `useGhostLaneWorkers` — extends the active-workers list with
 * "ghost" entries for operators who just went offline. Each ghost
 * stays mounted for `GHOST_LANE_TTL_MS` so the supervisor's eye
 * doesn't lose track of where that operator's column was. After
 * the TTL elapses (or the operator comes back), the ghost
 * collapses out via the parent's `<AnimatePresence>` exit spec.
 *
 * Ghosts are tracked by `user_id`; we snapshot the worker payload
 * at the moment of disappearance so the lane chrome (name,
 * initials) stays consistent during the fade-out.
 */
function useGhostLaneWorkers(activeWorkers: WorkerStatus[]): WorkerStatus[] {
  const [ghosts, setGhosts] = useState<Map<string, GhostEntry>>(() => new Map())
  const prevActiveRef = useRef<Map<string, WorkerStatus>>(new Map())

  // Diff active vs. previous active to compute new ghosts and
  // ghosts to remove (operators who came back online).
  useEffect(() => {
    const prevActive = prevActiveRef.current
    const currentActive = new Map(
      activeWorkers.map((w) => [w.user_id, w] as const)
    )

    setGhosts((prev) => {
      let next: Map<string, GhostEntry> | null = null
      // Add ghosts for operators that disappeared since last render.
      prevActive.forEach((worker, id) => {
        if (!currentActive.has(id) && !prev.has(id)) {
          if (!next) next = new Map(prev)
          next.set(id, {
            worker,
            expiresAt: Date.now() + GHOST_LANE_TTL_MS,
          })
        }
      })
      // Remove ghosts that came back online.
      prev.forEach((_, id) => {
        if (currentActive.has(id)) {
          if (!next) next = new Map(prev)
          next.delete(id)
        }
      })
      return next ?? prev
    })

    prevActiveRef.current = currentActive
  }, [activeWorkers])

  // Single timer for the soonest-expiring ghost — fires once,
  // sweeps the map, then schedules itself again if any ghosts
  // remain. Cheaper than one timer per ghost.
  useEffect(() => {
    if (ghosts.size === 0) return undefined
    let earliest = Infinity
    ghosts.forEach((entry) => {
      if (entry.expiresAt < earliest) earliest = entry.expiresAt
    })
    const delay = Math.max(0, earliest - Date.now())
    const id = setTimeout(() => {
      setGhosts((prev) => {
        const now = Date.now()
        let next: Map<string, GhostEntry> | null = null
        prev.forEach((entry, id2) => {
          if (entry.expiresAt <= now) {
            if (!next) next = new Map(prev)
            next.delete(id2)
          }
        })
        return next ?? prev
      })
    }, delay + 50)
    return () => clearTimeout(id)
  }, [ghosts])

  return useMemo(() => {
    const activeIds = new Set(activeWorkers.map((w) => w.user_id))
    const ghostList = Array.from(ghosts.values())
      .filter((entry) => !activeIds.has(entry.worker.user_id))
      .map((entry) => ({ ...entry.worker, status: 'offline' as const }))
    return [...activeWorkers, ...ghostList]
  }, [activeWorkers, ghosts])
}

function NoActiveOperatorsEmptyState() {
  return (
    <div className='border-border/50 bg-muted/20 flex min-h-[280px] items-center justify-center rounded-xl border border-dashed p-8'>
      <div className='flex max-w-sm flex-col items-center gap-3 text-center'>
        <div className='bg-muted/60 flex h-14 w-14 items-center justify-center rounded-full'>
          <Users className='text-muted-foreground/60 h-6 w-6' />
        </div>
        <div className='space-y-1'>
          <h3 className='text-foreground text-base font-semibold'>
            No active operators
          </h3>
          <p className='text-muted-foreground text-sm'>
            Operators will appear when they sign in to RF Interface. Their
            queues populate this dispatcher view automatically.
          </p>
        </div>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
