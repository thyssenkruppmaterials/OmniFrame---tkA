/**
 * Work Queue Hook
 * React Query hook for managing the work queue from Rust work service
 * Provides queue data, stats, and mutation operations
 */
import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { workServiceClient } from '@/lib/work-service/client'
import type {
  CycleCountTask,
  QueueStats,
  TaskResult,
} from '@/lib/work-service/types'

// Query keys for React Query cache management
export const WORK_QUEUE_QUERY_KEY = 'work-queue'
export const QUEUE_STATS_QUERY_KEY = 'queue-stats'

/**
 * Hook options for work queue
 */
export interface UseWorkQueueOptions {
  /** Enable automatic polling for queue updates */
  enablePolling?: boolean
  /** Polling interval in milliseconds (default: 60000) */
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
  const {
    enablePolling = true,
    pollingInterval = 60 * 1000, // 1 minute default
  } = options

  const queryClient = useQueryClient()

  // ============================================
  // Queries
  // ============================================

  // Fetch work queue
  const {
    data: queue = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: [WORK_QUEUE_QUERY_KEY],
    queryFn: () => workServiceClient.getQueue(),
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: enablePolling ? pollingInterval : false,
  })

  // Fetch queue statistics
  const {
    data: stats,
    isLoading: isStatsLoading,
    error: statsError,
  } = useQuery({
    queryKey: [QUEUE_STATS_QUERY_KEY],
    queryFn: () => workServiceClient.getQueueStats(),
    staleTime: 15 * 1000, // 15 seconds
    refetchInterval: enablePolling ? pollingInterval / 2 : false,
  })

  // ============================================
  // Mutations
  // ============================================

  // Claim next task mutation
  const claimMutation = useMutation({
    mutationFn: () => workServiceClient.claimNext(),
    onSuccess: (task) => {
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
