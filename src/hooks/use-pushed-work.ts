/**
 * Pushed Work Hook
 * React Query hook for receiving and managing pushed work in RF interface
 * Handles real-time notifications when supervisors push tasks to workers
 */
import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { logger } from '@/lib/utils/logger'
import { workServiceClient } from '@/lib/work-service/client'
import type {
  CycleCountPriority,
  CycleCountTask,
  WsEvent,
} from '@/lib/work-service/types'
import { workServiceWs } from '@/lib/work-service/websocket'
import { QUEUE_STATS_QUERY_KEY, WORK_QUEUE_QUERY_KEY } from './use-work-queue'

// Query key for pushed work
export const PUSHED_WORK_QUERY_KEY = 'pushed-work'

/**
 * Hook options
 */
export interface UsePushedWorkOptions {
  /** Enable WebSocket real-time updates */
  enableRealtime?: boolean
  /** Show toast notifications for new pushed work */
  showNotifications?: boolean
  /** Auto-acknowledge pushed tasks */
  autoAcknowledge?: boolean
}

/**
 * Hook return type
 */
export interface UsePushedWorkReturn {
  // Data
  pushedTasks: CycleCountTask[]

  // Loading states
  isLoading: boolean

  // Alert state for new pushes
  newPushAlert: CycleCountTask | null
  clearAlert: () => void

  // Operations
  acknowledgePush: (taskId: string) => void
  startPushedTask: (taskId: string) => void

  // Computed values
  pushedCount: number
  hasPendingPush: boolean
  highestPriorityPush: CycleCountTask | null

  // Utility functions
  refreshPushed: () => void

  // Operation states
  isAcknowledgePending: boolean
  isStartPending: boolean

  // WebSocket state
  isWsConnected: boolean
}

/**
 * Priority order for sorting (lower is higher priority)
 */
const PRIORITY_ORDER: Record<CycleCountPriority, number> = {
  critical: 1,
  hot: 2,
  normal: 3,
  low: 4,
}

/**
 * Main hook for pushed work in RF interface
 * Handles real-time push notifications and task management
 */
export function usePushedWork(
  options: UsePushedWorkOptions = {}
): UsePushedWorkReturn {
  const {
    enableRealtime = true,
    showNotifications = true,
    autoAcknowledge = false,
  } = options

  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const userId = authState.user?.id
  const organizationId = authState.profile?.organization_id

  const [newPushAlert, setNewPushAlert] = useState<CycleCountTask | null>(null)
  const [isWsConnected, setIsWsConnected] = useState(false)

  // ============================================
  // Query for pushed tasks
  // ============================================

  const {
    data: pushedTasks = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: [PUSHED_WORK_QUERY_KEY, userId],
    queryFn: async () => {
      // Get the queue and filter for pushed tasks assigned to current user
      const queue = await workServiceClient.getQueue()
      return queue.filter(
        (task) =>
          task.push_mode === 'push' &&
          task.assigned_to === userId &&
          !task.push_acknowledged
      )
    },
    enabled: !!userId && !!organizationId,
    staleTime: 15 * 1000, // 15 seconds
    refetchInterval: 30 * 1000, // 30 seconds fallback polling
  })

  // ============================================
  // Mutations
  // ============================================

  // Acknowledge push mutation
  const acknowledgeMutation = useMutation({
    mutationFn: (taskId: string) => workServiceClient.acknowledgePush(taskId),
    onSuccess: (_, taskId) => {
      logger.log('[usePushedWork] Acknowledged push:', taskId)
      queryClient.invalidateQueries({ queryKey: [PUSHED_WORK_QUERY_KEY] })
      queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to acknowledge: ${error.message}`)
    },
  })

  // Start task mutation
  const startMutation = useMutation({
    mutationFn: async (taskId: string) => {
      // First acknowledge if not already
      await workServiceClient.acknowledgePush(taskId)
      // Then start the task
      await workServiceClient.startTask(taskId)
    },
    onSuccess: () => {
      toast.success('Task started')
      queryClient.invalidateQueries({ queryKey: [PUSHED_WORK_QUERY_KEY] })
      queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
      queryClient.invalidateQueries({ queryKey: [QUEUE_STATS_QUERY_KEY] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to start task: ${error.message}`)
    },
  })

  const { mutate: acknowledgeMutate } = acknowledgeMutation

  // ============================================
  // WebSocket Handler
  // ============================================

  const handleWsEvent = useCallback(
    (event: WsEvent) => {
      // Handle pushed work events for current user
      if (event.type === 'PushedWork' && event.user_id === userId) {
        logger.log('[usePushedWork] Received push:', event)

        // Create minimal task object for alert
        const alertTask: CycleCountTask = {
          id: event.task_id!,
          count_number: event.count_number || '',
          material_number: event.material || '',
          material_description: null,
          location: event.location || '',
          warehouse: null,
          system_quantity: 0,
          counted_quantity: null,
          unit_of_measure: 'EA',
          priority: (event.priority as CycleCountPriority) || 'normal',
          status: 'pending',
          count_type: null,
          assigned_to: userId || null,
          assigned_at: new Date().toISOString(),
          push_mode: 'push',
          pushed_by: null,
          pushed_at: new Date().toISOString(),
          push_acknowledged: false,
          organization_id: organizationId || '',
        }

        // Set alert for UI notification
        setNewPushAlert(alertTask)

        // Show toast notification
        if (showNotifications) {
          toast.info(`New work pushed: ${event.material}`, {
            description: `Location: ${event.location} | Priority: ${event.priority}`,
            duration: 10000,
            action: {
              label: 'View',
              onClick: () => {
                // Keep alert visible
              },
            },
          })
        }

        // Auto-acknowledge if enabled
        if (autoAcknowledge && event.task_id) {
          acknowledgeMutate(event.task_id)
        }

        // Refetch pushed tasks
        queryClient.invalidateQueries({ queryKey: [PUSHED_WORK_QUERY_KEY] })
      }

      // Also listen for task status changes that might affect pushed work
      if (event.type === 'TaskStatusChanged') {
        queryClient.invalidateQueries({ queryKey: [PUSHED_WORK_QUERY_KEY] })
      }
    },
    [
      userId,
      organizationId,
      showNotifications,
      autoAcknowledge,
      queryClient,
      acknowledgeMutate,
    ]
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

  const pushedCount = pushedTasks.length
  const hasPendingPush = pushedCount > 0

  // Get highest priority pushed task
  const highestPriorityPush =
    pushedTasks.length > 0
      ? pushedTasks.reduce((highest, current) => {
          const currentOrder = PRIORITY_ORDER[current.priority] || 99
          const highestOrder = PRIORITY_ORDER[highest.priority] || 99
          return currentOrder < highestOrder ? current : highest
        })
      : null

  // ============================================
  // Utility Functions
  // ============================================

  const clearAlert = useCallback(() => {
    setNewPushAlert(null)
  }, [])

  const refreshPushed = useCallback(() => {
    refetch()
  }, [refetch])

  // ============================================
  // Return
  // ============================================

  return {
    // Data
    pushedTasks,

    // Loading states
    isLoading,

    // Alert state
    newPushAlert,
    clearAlert,

    // Operations
    acknowledgePush: acknowledgeMutation.mutate,
    startPushedTask: startMutation.mutate,

    // Computed values
    pushedCount,
    hasPendingPush,
    highestPriorityPush,

    // Utility functions
    refreshPushed,

    // Operation states
    isAcknowledgePending: acknowledgeMutation.isPending,
    isStartPending: startMutation.isPending,

    // WebSocket state
    isWsConnected,
  }
}

/**
 * Hook for worker heartbeat management
 * Sends periodic heartbeats to maintain worker presence
 */
export function useWorkerHeartbeat(
  options: {
    enabled?: boolean
    interval?: number
    taskId?: string
    taskType?: string
    zone?: string
    location?: string
  } = {}
) {
  const {
    enabled = true,
    interval = 30000, // 30 seconds default
    taskId,
    taskType,
    zone,
    location,
  } = options

  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id

  useEffect(() => {
    if (!enabled || !organizationId) return

    const sendHeartbeat = () => {
      const status = taskId ? 'busy' : 'idle'

      // Prefer WebSocket heartbeat when connected
      if (workServiceWs.isConnected()) {
        workServiceWs.sendHeartbeat({
          task_id: taskId,
          task_type: taskType,
          zone,
          location,
          status,
        })
      } else {
        // Fallback to HTTP
        workServiceClient
          .sendHeartbeat({
            task_id: taskId,
            task_type: taskType,
            zone,
            location,
            status,
          })
          .catch((error) => {
            logger.warn('[useWorkerHeartbeat] HTTP heartbeat failed:', error)
          })
      }
    }

    // Send initial heartbeat
    sendHeartbeat()

    // Set up interval
    const intervalId = setInterval(sendHeartbeat, interval)

    return () => {
      clearInterval(intervalId)
    }
  }, [enabled, interval, organizationId, taskId, taskType, zone, location])
}
