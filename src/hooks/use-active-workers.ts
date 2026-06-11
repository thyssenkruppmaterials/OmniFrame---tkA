// Created and developed by Jai Singh
/**
 * Active Workers Hook
 * React Query hook for monitoring active workers with real-time WebSocket updates
 * Used by supervisors to see worker status and assign work
 */
import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { logger } from '@/lib/utils/logger'
import {
  setWorkServiceOrganization,
  workServiceClient,
} from '@/lib/work-service/client'
import type { WorkerStatus, WsEvent } from '@/lib/work-service/types'
import { workServiceWs } from '@/lib/work-service/websocket'

// Query key for workers
export const ACTIVE_WORKERS_QUERY_KEY = 'active-workers'
export const WORKER_TASKS_QUERY_KEY = 'worker-tasks'

/**
 * Hook options
 */
export interface UseActiveWorkersOptions {
  /** Enable WebSocket real-time updates */
  enableRealtime?: boolean
  /** Enable polling as fallback/supplement to WebSocket */
  enablePolling?: boolean
  /** Polling interval in milliseconds */
  pollingInterval?: number
}

/**
 * Hook return type
 */
export interface UseActiveWorkersReturn {
  // Data
  workers: WorkerStatus[]

  // Loading states
  isLoading: boolean

  // Error states
  error: Error | null

  // Computed values
  onlineCount: number
  busyCount: number
  idleCount: number
  offlineCount: number
  breakCount: number

  // Utility functions
  refreshWorkers: () => void

  // WebSocket state
  isWsConnected: boolean
}

/**
 * Main hook for active workers monitoring
 * Combines React Query with WebSocket for real-time updates
 */
export function useActiveWorkers(
  options: UseActiveWorkersOptions = {}
): UseActiveWorkersReturn {
  const {
    enableRealtime = true,
    enablePolling = true,
    pollingInterval = 60 * 1000, // 1 minute default
  } = options

  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id

  useEffect(() => {
    setWorkServiceOrganization(organizationId ?? null)
  }, [organizationId])

  const [isWsConnected, setIsWsConnected] = useState(false)

  // ============================================
  // Query
  // ============================================

  const {
    data: workers = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [ACTIVE_WORKERS_QUERY_KEY, organizationId],
    queryFn: () => workServiceClient.getWorkers(),
    enabled: !!organizationId,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: enablePolling ? pollingInterval : false,
  })

  // ============================================
  // WebSocket Handler
  // ============================================

  const handleWsEvent = useCallback(
    (event: WsEvent) => {
      if (event.type === 'WorkerStatusChanged') {
        logger.log('[useActiveWorkers] Worker status changed:', event.user_id)
        queryClient.invalidateQueries({ queryKey: [ACTIVE_WORKERS_QUERY_KEY] })
      }
    },
    [queryClient]
  )

  // ============================================
  // WebSocket Effect
  // ============================================

  useEffect(() => {
    if (!enableRealtime || !organizationId) return

    // Connect to WebSocket
    workServiceWs.connect(organizationId, handleWsEvent)

    // Track connection state
    const unsubscribe = workServiceWs.onStateChange((state) => {
      setIsWsConnected(state === 'connected')
    })

    // Initial state check
    setIsWsConnected(workServiceWs.isConnected())

    return () => {
      workServiceWs.removeHandler(handleWsEvent)
      unsubscribe()
    }
  }, [organizationId, enableRealtime, handleWsEvent])

  // ============================================
  // Computed Values
  // ============================================

  const onlineCount = workers.filter((w) => w.status === 'online').length
  const busyCount = workers.filter((w) => w.status === 'busy').length
  const idleCount = workers.filter((w) => w.status === 'idle').length
  const offlineCount = workers.filter((w) => w.status === 'offline').length
  const breakCount = workers.filter((w) => w.status === 'break').length

  // ============================================
  // Utility Functions
  // ============================================

  const refreshWorkers = useCallback(() => {
    refetch()
  }, [refetch])

  // ============================================
  // Return
  // ============================================

  return {
    // Data
    workers,

    // Loading states
    isLoading,

    // Error states
    error: error as Error | null,

    // Computed values
    onlineCount,
    busyCount,
    idleCount,
    offlineCount,
    breakCount,

    // Utility functions
    refreshWorkers,

    // WebSocket state
    isWsConnected,
  }
}

/**
 * Options for `useWorkerTasks`.
 */
export interface UseWorkerTasksOptions {
  /**
   * Subscribe to the work-service WebSocket and invalidate the
   * worker's task cache when relevant events fire (`TaskAssigned`,
   * `TaskStatusChanged`, `PushedWork`, `ReservationEscalated`,
   * `WorkerStatusChanged`). Defaults to `false` for back-compat —
   * legacy callers that don't render a live view stay one-shot.
   *
   * Realtime is preferred over polling for this query because the
   * relevant WS variants already exist on the singleton
   * `WorkServiceWebSocket` (no new channel introduced — see
   * `.cursor/rules/realtime-policy.mdc`). When enabled, the safety-
   * net poll (`refetchInterval`) is left at TanStack's default
   * `false` because the WS push is the freshness source and the
   * 30s `staleTime` covers the brief window between mount and the
   * first WS handshake.
   */
  enableRealtime?: boolean
}

/**
 * Hook for getting a specific worker's tasks. Optionally subscribes
 * to the work-service WS so the cache invalidates whenever the
 * worker's task list changes server-side — drives the
 * `<OperatorTaskQueue>` tab inside `<LiveOperatorStatus>`.
 */
export function useWorkerTasks(
  workerId: string | undefined,
  options: UseWorkerTasksOptions = {}
) {
  const { enableRealtime = false } = options
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: [WORKER_TASKS_QUERY_KEY, workerId],
    queryFn: () => workServiceClient.getWorkerTasks(workerId!),
    enabled: !!workerId && !!organizationId,
    staleTime: 30 * 1000,
  })

  // Single multiplexed handler covering every WS variant that can
  // change the per-worker task list. The handler is intentionally
  // permissive — `TaskAssigned` / `TaskStatusChanged` / `PushedWork`
  // / `ReservationEscalated` carry a `user_id` field that we COULD
  // gate on (skip invalidation when `event.user_id !== workerId`)
  // but the cost of an extra `getWorkerTasks` round trip is
  // negligible (typically <50ms, ~1 KB JSON for a 12-task queue) and
  // gating opens a correctness hole when the supervisor switches
  // operators between mount and the first WS frame. Cheap to
  // invalidate; expensive to be wrong.
  const handleWsEvent = useCallback(
    (event: WsEvent) => {
      if (!workerId) return
      switch (event.type) {
        case 'TaskAssigned':
        case 'TaskStatusChanged':
        case 'PushedWork':
        case 'ReservationEscalated':
        case 'WorkerStatusChanged':
          logger.log(
            `[useWorkerTasks] WS invalidate for worker ${workerId}:`,
            event.type
          )
          queryClient.invalidateQueries({
            queryKey: [WORKER_TASKS_QUERY_KEY, workerId],
          })
          return
        default:
          return
      }
    },
    [queryClient, workerId]
  )

  useEffect(() => {
    if (!enableRealtime || !organizationId || !workerId) return
    workServiceWs.connect(organizationId, handleWsEvent)
    return () => {
      workServiceWs.removeHandler(handleWsEvent)
    }
  }, [organizationId, workerId, enableRealtime, handleWsEvent])

  return query
}

/**
 * Hook for getting a specific worker's status
 */
export function useWorkerStatus(workerId: string | undefined) {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id

  return useQuery({
    queryKey: [ACTIVE_WORKERS_QUERY_KEY, 'status', workerId],
    queryFn: () => workServiceClient.getWorkerStatus(workerId!),
    enabled: !!workerId && !!organizationId,
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  })
}

// Created and developed by Jai Singh
