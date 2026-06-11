// Created and developed by Jai Singh
/**
 * `useMultiOperatorTasks` — dispatcher-grid data layer.
 *
 * The pre-existing `useWorkerTasks(workerId, { enableRealtime })`
 * works perfectly for ONE operator (it's what the per-operator
 * dialog uses) but stacks one WS handler per visible operator when
 * mounted N times. The dispatcher shows up to ~6 active operators
 * simultaneously — we don't want 6 redundant handlers all listening
 * to the same singleton.
 *
 * Strategy (referenced in the implementation note):
 *
 *   1. Issue per-operator HTTP fetches in parallel via TanStack
 *      Query's `useQueries` (same `WORKER_TASKS_QUERY_KEY` used by
 *      `useWorkerTasks` so the cache is shared with the dialog).
 *   2. Subscribe to `workServiceWs` ONCE at the shell level. The
 *      handler invalidates `[WORKER_TASKS_QUERY_KEY, workerId]` for
 *      every visible worker on relevant events.
 *   3. Honour `.cursor/rules/realtime-policy.mdc` — no new
 *      `supabase.channel(...)` callsites; the rust-work-service WS
 *      already carries every variant we need.
 *
 * Burst detection: when 2+ `TaskAssigned` / `PushedWork` events
 * land within `TASK_ENTER_STAGGER_BURST_MS` for the same lane, the
 * lane's `staggerEnter` flag flips on so the AnimatePresence
 * reveal staggers. A single arrival skips the stagger so a one-off
 * assignment animates immediately rather than after a 40ms delay.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { logger } from '@/lib/utils/logger'
import { workServiceClient } from '@/lib/work-service/client'
import type {
  CycleCountTask,
  WorkerStatus,
  WsEvent,
} from '@/lib/work-service/types'
import { workServiceWs } from '@/lib/work-service/websocket'
import { WORKER_TASKS_QUERY_KEY } from '@/hooks/use-active-workers'
import { TASK_ENTER_STAGGER_BURST_MS } from '../constants'
import type { OperatorLaneState } from '../types'

interface UseMultiOperatorTasksOptions {
  workers: WorkerStatus[]
}

interface UseMultiOperatorTasksReturn {
  /** Lane state per worker, keyed by `worker.user_id`. */
  lanes: Map<string, OperatorLaneState>
  /** TanStack Query refetch — useful for the manual Refresh button. */
  refetchAll: () => void
  /** WS connection state, reflected straight from the singleton. */
  isWsConnected: boolean
}

/**
 * Worker ids whose lane should be bumped to `staggerEnter: true`
 * for the next render cycle. Tracked outside React state because
 * the burst-detection ref doesn't drive layout (it only feeds the
 * lane payload built once per render).
 */
interface BurstTracker {
  /** Last event timestamp per worker id. */
  lastSeenAt: Map<string, number>
  /** Worker ids in stagger mode. Gets cleared after the render cycle. */
  staggered: Set<string>
}

export function useMultiOperatorTasks({
  workers,
}: UseMultiOperatorTasksOptions): UseMultiOperatorTasksReturn {
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id

  const [isWsConnected, setIsWsConnected] = useState(() =>
    workServiceWs.isConnected()
  )
  const [, forceTick] = useState(0)
  const burstRef = useRef<BurstTracker>({
    lastSeenAt: new Map(),
    staggered: new Set(),
  })

  const queries = useQueries({
    queries: workers.map((worker) => ({
      queryKey: [WORKER_TASKS_QUERY_KEY, worker.user_id],
      queryFn: () => workServiceClient.getWorkerTasks(worker.user_id),
      enabled: !!organizationId && !!worker.user_id,
      staleTime: 30 * 1000,
    })),
  })

  // Build the lane map. New objects on every render because the
  // staggered-ids ref might have flipped between renders without
  // prompting a referential equality change in `queries` itself.
  const lanes = new Map<string, OperatorLaneState>()
  workers.forEach((worker, idx) => {
    const q = queries[idx]
    lanes.set(worker.user_id, {
      worker,
      tasks: (q?.data ?? []) as CycleCountTask[],
      isLoading: q?.isLoading ?? false,
      error: (q?.error as Error | null) ?? null,
      staggerEnter: burstRef.current.staggered.has(worker.user_id),
    })
  })

  // Shell-level WS handler — fans out invalidations across every
  // visible lane based on event semantics. Filtering by `user_id`
  // when the variant carries one would save a few HTTP round
  // trips, but the cost is dwarfed by the correctness risk if we
  // ever miss an event (e.g. supervisor switches lanes mid-frame).
  // Cheap to invalidate; expensive to be wrong.
  const handleWsEvent = useCallback(
    (event: WsEvent) => {
      const visibleIds = workers.map((w) => w.user_id)
      switch (event.type) {
        case 'TaskAssigned':
        case 'PushedWork': {
          // These events typically arrive in bursts when the
          // supervisor mass-pushes (push_batch). Mark the affected
          // lane(s) for staggered reveal next render.
          const target = event.user_id
          if (target && visibleIds.includes(target)) {
            markBurst(burstRef, target)
            queryClient.invalidateQueries({
              queryKey: [WORKER_TASKS_QUERY_KEY, target],
            })
            forceTick((n) => n + 1)
          } else {
            visibleIds.forEach((id) => {
              queryClient.invalidateQueries({
                queryKey: [WORKER_TASKS_QUERY_KEY, id],
              })
            })
          }
          return
        }
        case 'TaskStatusChanged': {
          const target = event.user_id
          if (target && visibleIds.includes(target)) {
            queryClient.invalidateQueries({
              queryKey: [WORKER_TASKS_QUERY_KEY, target],
            })
          } else {
            // No user_id on the event (rare — e.g. release) — fan
            // out to all visible lanes since any of them could be
            // the holder.
            visibleIds.forEach((id) => {
              queryClient.invalidateQueries({
                queryKey: [WORKER_TASKS_QUERY_KEY, id],
              })
            })
          }
          return
        }
        case 'ReservationEscalated': {
          // The previous owner loses the task; the new holder (if
          // any) gains it. Invalidate both when known.
          const previous = event.previous_owner
          const current = event.user_id
          ;[previous, current].forEach((id) => {
            if (id && visibleIds.includes(id)) {
              queryClient.invalidateQueries({
                queryKey: [WORKER_TASKS_QUERY_KEY, id],
              })
            }
          })
          return
        }
        case 'WorkerStatusChanged':
          // The active workers list is owned by `useActiveWorkers`
          // which has its own handler — we don't need to invalidate
          // task lists here. (Going offline does NOT release the
          // worker's tasks; the canonical release flow runs through
          // `TaskStatusChanged`.)
          return
        default:
          return
      }
    },
    [queryClient, workers]
  )

  useEffect(() => {
    if (!organizationId) return undefined
    workServiceWs.connect(organizationId, handleWsEvent)
    const unsub = workServiceWs.onStateChange((state) => {
      setIsWsConnected(state === 'connected')
    })
    setIsWsConnected(workServiceWs.isConnected())
    return () => {
      workServiceWs.removeHandler(handleWsEvent)
      unsub()
    }
  }, [organizationId, handleWsEvent])

  // After a burst-flagged render, drop the stagger flag so the next
  // arrival animates with single-item timing. The microtask queue
  // is enough — we only need the lane to render once with the flag
  // set so AnimatePresence picks up the staggered transition.
  useEffect(() => {
    if (burstRef.current.staggered.size === 0) return
    // Use rAF so the flag persists for the layout commit that
    // actually renders the staggered children.
    const id = requestAnimationFrame(() => {
      burstRef.current.staggered.clear()
    })
    return () => cancelAnimationFrame(id)
  })

  const refetchAll = useCallback(() => {
    workers.forEach((worker) => {
      queryClient.invalidateQueries({
        queryKey: [WORKER_TASKS_QUERY_KEY, worker.user_id],
      })
    })
  }, [queryClient, workers])

  return {
    lanes,
    refetchAll,
    isWsConnected,
  }
}

/**
 * Mark a worker as in a burst: if the previous event landed within
 * `TASK_ENTER_STAGGER_BURST_MS`, flag the lane for stagger.
 * Otherwise just record the timestamp — a single arrival doesn't
 * need a stagger.
 */
function markBurst(
  ref: React.MutableRefObject<BurstTracker>,
  workerId: string
) {
  const now = Date.now()
  const last = ref.current.lastSeenAt.get(workerId)
  if (last !== undefined && now - last <= TASK_ENTER_STAGGER_BURST_MS) {
    ref.current.staggered.add(workerId)
  }
  ref.current.lastSeenAt.set(workerId, now)
  // Trim the map periodically so it doesn't grow unbounded across
  // long supervisor sessions.
  if (ref.current.lastSeenAt.size > 64) {
    const entries = Array.from(ref.current.lastSeenAt.entries())
    entries.sort((a, b) => b[1] - a[1])
    ref.current.lastSeenAt = new Map(entries.slice(0, 32))
  }
  logger.debug(
    `[useMultiOperatorTasks] burst flagged for worker ${workerId} (now=${now} last=${last ?? 'none'})`
  )
}

// Created and developed by Jai Singh
