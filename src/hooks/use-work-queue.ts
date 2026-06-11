// Created and developed by Jai Singh
/**
 * Work Queue Hook
 * React Query hook for managing the work queue from Rust work service.
 *
 * Push-based: subscribes to `WorkServiceWebSocket` events and invalidates
 * the relevant React Query caches when a `TaskAssigned`, `TaskStatusChanged`,
 * `PushedWork`, `WorkerStatusChanged`, `QueueStatsUpdated`, or
 * `ReservationEscalated` event fires. The 30s/60s polls that used to drive
 * freshness here have been retired; a 5-minute "safety net" refetch only
 * runs while the WS is NOT in `'connected'` state (matching the pattern
 * in `use-pushed-work.ts` and `use-active-workers.ts`).
 *
 * See `memorybank/OmniFrame/Decisions/Roadmap-Rust-WS-Unlocks.md` for the
 * "Bundle with Option 2" sequencing this migration is part of, and
 * `memorybank/OmniFrame/Decisions/ADR-Presence-Architecture-Next-Steps.md`
 * for why we are migrating reactive workloads off Supabase Realtime onto
 * the existing `rust-work-service /ws` singleton.
 */
import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { logger } from '@/lib/utils/logger'
import { workServiceClient } from '@/lib/work-service/client'
import type {
  CycleCountTask,
  QueueStats,
  TaskResult,
  WsEvent,
} from '@/lib/work-service/types'
import {
  workServiceWs,
  type ConnectionState,
} from '@/lib/work-service/websocket'

export const WORK_QUEUE_QUERY_KEY = 'work-queue'
export const QUEUE_STATS_QUERY_KEY = 'queue-stats'

/**
 * Safety-net poll cadence used when the WS is NOT connected. Five minutes
 * is intentionally slow — the Rust WS push is the source of freshness.
 * This only kicks in while `connectionState !== 'connected'` (i.e. during
 * `connecting` / `reconnecting` / `disconnected` / `unavailable` /
 * `error`), so the steady-state network volume in healthy WS conditions
 * is zero.
 */
export const WORK_QUEUE_FALLBACK_REFETCH_MS = 5 * 60 * 1000

/**
 * Hook options for work queue
 */
export interface UseWorkQueueOptions {
  /**
   * Enable WebSocket-driven cache invalidation. Defaults to `true`. Pass
   * `false` to behave like a one-shot fetch (no realtime, no fallback poll).
   */
  enableRealtime?: boolean
  /**
   * Enable the 5-minute safety-net poll while the WS is not connected.
   * Defaults to `true`. Independent of `enableRealtime` so callers can
   * choose any of the four corners (push only / push + fallback / poll
   * only / neither).
   *
   * @deprecated `enablePolling` is the legacy boolean flag for the
   * 30s/60s active polls that this hook USED to do. The new
   * push-based behaviour replaces those polls with WS invalidation +
   * a 5-minute fallback. The flag is retained as an alias for the
   * fallback poll to keep the call sites in
   * `src/features/admin/work-queue/components/*` source-compatible.
   */
  enablePolling?: boolean
  /**
   * @deprecated Ignored. The old 30s/60s polling intervals were retired
   * in the work-queue WS migration (2026-05-06). The hook now uses
   * `WORK_QUEUE_FALLBACK_REFETCH_MS` whenever the WS is not connected.
   */
  pollingInterval?: number
}

/**
 * Hook return type
 */
export interface UseWorkQueueReturn {
  // Data
  queue: CycleCountTask[]
  stats: QueueStats | undefined

  // Loading states
  isLoading: boolean
  isStatsLoading: boolean

  // Error states
  error: Error | null
  statsError: Error | null

  // Queue operations
  claimNext: () => void
  pushToUser: (params: { taskId: string; userId: string }) => void
  refreshQueue: () => void

  // Task operations
  startTask: (taskId: string) => void
  completeTask: (params: { taskId: string; result: TaskResult }) => void
  releaseTask: (taskId: string) => void
  acknowledgePush: (taskId: string) => void

  // Operation states
  isClaimPending: boolean
  isPushPending: boolean
  isStartPending: boolean
  isCompletePending: boolean
  isReleasePending: boolean
  isAcknowledgePending: boolean
}

/**
 * Main hook for work queue operations
 * Provides queue data and all mutation operations
 */
export function useWorkQueue(
  options: UseWorkQueueOptions = {}
): UseWorkQueueReturn {
  const { enableRealtime = true, enablePolling = true } = options

  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id

  // Mirror of `workServiceWs.getConnectionState()`. Stored in component
  // state so the `refetchInterval` value below re-evaluates whenever
  // the WS state changes — when the socket flips to `'connected'`, the
  // safety-net poll stops; when it drops, the poll resumes within the
  // 5min cadence on the next render.
  const [wsConnectionState, setWsConnectionState] = useState<ConnectionState>(
    () => workServiceWs.getConnectionState()
  )

  // Safety-net poll interval — `false` (no polling) while the WS is
  // healthy, otherwise the 5-minute fallback cadence. Re-evaluates on
  // every render that changes `wsConnectionState`, which React Query
  // picks up as an options change without remounting the query.
  const fallbackRefetchInterval: number | false =
    enablePolling && wsConnectionState !== 'connected'
      ? WORK_QUEUE_FALLBACK_REFETCH_MS
      : false

  // ============================================
  // Queries
  // ============================================

  const {
    data: queue = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: [WORK_QUEUE_QUERY_KEY],
    queryFn: () => workServiceClient.getQueue(),
    staleTime: 30 * 1000,
    refetchInterval: fallbackRefetchInterval,
  })

  const {
    data: stats,
    isLoading: isStatsLoading,
    error: statsError,
  } = useQuery({
    queryKey: [QUEUE_STATS_QUERY_KEY],
    queryFn: () => workServiceClient.getQueueStats(),
    staleTime: 15 * 1000,
    refetchInterval: fallbackRefetchInterval,
  })

  // ============================================
  // WebSocket — invalidate cache on push
  // ============================================

  /**
   * Single multiplexed handler covering every event variant emitted by
   * `rust-work-service` today (see `rust-work-service/src/websocket/mod.rs`
   * `enum WsEvent`):
   *
   * - `TaskAssigned` / `TaskStatusChanged` / `PushedWork` /
   *   `ReservationEscalated` change the queue contents → invalidate the
   *   queue list. They also shift counts (`pending` ↔ `in_progress` ↔
   *   `completed_today`) so we invalidate the stats cache too.
   * - `QueueStatsUpdated` is the canonical stats push from the scheduler;
   *   invalidate the stats cache (kept idempotent — the queue cache is
   *   left alone since the row set hasn't changed).
   * - `WorkerStatusChanged` shifts `total_workers_online` in
   *   `QueueStats`; invalidate stats only.
   *
   * `invalidateQueries` is preferred over `setQueryData` here — TanStack
   * Query dedupes overlapping invalidations and a refetch already in
   * flight will service the new subscriber, so a burst of WS events
   * collapses to a single network round trip.
   */
  const handleWsEvent = useCallback(
    (event: WsEvent) => {
      switch (event.type) {
        case 'TaskAssigned':
        case 'TaskStatusChanged':
        case 'PushedWork':
        case 'ReservationEscalated':
          logger.log(
            '[useWorkQueue] WS invalidate (queue + stats):',
            event.type
          )
          queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
          queryClient.invalidateQueries({ queryKey: [QUEUE_STATS_QUERY_KEY] })
          return
        case 'QueueStatsUpdated':
        case 'WorkerStatusChanged':
          logger.log('[useWorkQueue] WS invalidate (stats):', event.type)
          queryClient.invalidateQueries({ queryKey: [QUEUE_STATS_QUERY_KEY] })
          return
        default:
          return
      }
    },
    [queryClient]
  )

  useEffect(() => {
    if (!enableRealtime || !organizationId) return

    workServiceWs.connect(organizationId, handleWsEvent)

    const unsubscribe = workServiceWs.onStateChange((state) => {
      setWsConnectionState(state)
    })

    setWsConnectionState(workServiceWs.getConnectionState())

    return () => {
      workServiceWs.removeHandler(handleWsEvent)
      unsubscribe()
    }
  }, [organizationId, enableRealtime, handleWsEvent])

  // ============================================
  // Mutations
  // ============================================

  // Claim next task mutation. Mirrors `useUnifiedCycleCount` semantics:
  // a `{ success: false, task: null }` resolution from the Rust route
  // means "queue idle for this worker" — surface it as a quiet info
  // toast (this hook is admin-facing where the explicit feedback is
  // useful), not as an error.
  const claimMutation = useMutation({
    mutationFn: () => workServiceClient.claimNext(),
    onSuccess: (response) => {
      const task = response?.task ?? null
      if (task) {
        toast.success(`Claimed count: ${task.count_number}`, {
          description: `Material: ${task.material_number} at ${task.location}`,
        })
      } else {
        toast.info('No tasks available to claim')
      }
      queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
      queryClient.invalidateQueries({ queryKey: [QUEUE_STATS_QUERY_KEY] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to claim task: ${error.message}`)
    },
  })

  // Push task to user mutation
  const pushMutation = useMutation({
    mutationFn: ({ taskId, userId }: { taskId: string; userId: string }) =>
      workServiceClient.pushToUser(taskId, userId),
    onSuccess: () => {
      toast.success('Work pushed to operator')
      queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
      queryClient.invalidateQueries({ queryKey: [QUEUE_STATS_QUERY_KEY] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to push work: ${error.message}`)
    },
  })

  // Start task mutation
  const startMutation = useMutation({
    mutationFn: (taskId: string) => workServiceClient.startTask(taskId),
    onSuccess: () => {
      toast.success('Task started')
      queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
      queryClient.invalidateQueries({ queryKey: [QUEUE_STATS_QUERY_KEY] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to start task: ${error.message}`)
    },
  })

  // Complete task mutation
  const completeMutation = useMutation({
    mutationFn: ({ taskId, result }: { taskId: string; result: TaskResult }) =>
      workServiceClient.completeTask(taskId, result),
    onSuccess: () => {
      toast.success('Task completed successfully')
      queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
      queryClient.invalidateQueries({ queryKey: [QUEUE_STATS_QUERY_KEY] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to complete task: ${error.message}`)
    },
  })

  // Release task mutation
  const releaseMutation = useMutation({
    mutationFn: (taskId: string) => workServiceClient.releaseTask(taskId),
    onSuccess: () => {
      toast.info('Task released back to queue')
      queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
      queryClient.invalidateQueries({ queryKey: [QUEUE_STATS_QUERY_KEY] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to release task: ${error.message}`)
    },
  })

  // Acknowledge push mutation
  const acknowledgeMutation = useMutation({
    mutationFn: (taskId: string) => workServiceClient.acknowledgePush(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to acknowledge: ${error.message}`)
    },
  })

  // ============================================
  // Utility Functions
  // ============================================

  const refreshQueue = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
    queryClient.invalidateQueries({ queryKey: [QUEUE_STATS_QUERY_KEY] })
  }, [queryClient])

  // ============================================
  // Return
  // ============================================

  return {
    // Data
    queue,
    stats,

    // Loading states
    isLoading,
    isStatsLoading,

    // Error states
    error: error as Error | null,
    statsError: statsError as Error | null,

    // Queue operations
    claimNext: claimMutation.mutate,
    pushToUser: pushMutation.mutate,
    refreshQueue,

    // Task operations
    startTask: startMutation.mutate,
    completeTask: completeMutation.mutate,
    releaseTask: releaseMutation.mutate,
    acknowledgePush: acknowledgeMutation.mutate,

    // Operation states
    isClaimPending: claimMutation.isPending,
    isPushPending: pushMutation.isPending,
    isStartPending: startMutation.isPending,
    isCompletePending: completeMutation.isPending,
    isReleasePending: releaseMutation.isPending,
    isAcknowledgePending: acknowledgeMutation.isPending,
  }
}

/**
 * Hook for getting a specific task
 */
export function useWorkTask(taskId: string | undefined) {
  return useQuery({
    queryKey: [WORK_QUEUE_QUERY_KEY, 'task', taskId],
    queryFn: () => workServiceClient.getTask(taskId!),
    enabled: !!taskId,
    staleTime: 30 * 1000,
  })
}

// Created and developed by Jai Singh
