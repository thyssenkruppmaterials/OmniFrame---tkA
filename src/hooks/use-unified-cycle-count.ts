/**
 * Unified Cycle Count Hook
 * Consolidates cycle count workflow logic for both pull and push modes
 * Handles WebSocket subscriptions, draft auto-save, and abandonment detection
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { logger } from '@/lib/utils/logger'
import { workServiceClient } from '@/lib/work-service/client'
import type {
  CycleCountTask,
  TaskResult,
  WsEvent,
} from '@/lib/work-service/types'
import {
  workServiceWs,
  type ConnectionState,
} from '@/lib/work-service/websocket'
import { QUEUE_STATS_QUERY_KEY, WORK_QUEUE_QUERY_KEY } from './use-work-queue'

// ============================================
// Types
// ============================================

/**
 * Draft data structure for auto-save
 */
export interface DraftData {
  taskId: string
  countedQuantity: number | null
  notes: string
  step: number
  startedAt: number
  lastUpdated: number
}

/**
 * Hook configuration options
 */
export interface UseUnifiedCycleCountOptions {
  /** Operating mode - pull (worker claims) or push (supervisor assigns) */
  mode: 'pull' | 'push'
  /** Callback when a task is received (push mode) */
  onTaskReceived?: (task: CycleCountTask) => void
  /** Callback when an error occurs */
  onError?: (error: Error) => void
  /** Auto-claim next task on mount in pull mode (default: false) */
  autoClaimOnMount?: boolean
  /** Enable WebSocket real-time updates (default: true) */
  enableRealtime?: boolean
  /** Draft auto-save debounce delay in ms (default: 3000) */
  draftDebounceMs?: number
  /** Maximum draft age before considered expired in ms (default: 3600000 = 1 hour) */
  draftMaxAgeMs?: number
  /** Abandonment warning threshold in minutes (default: 20) */
  abandonmentWarningMinutes?: number
}

/**
 * Hook return type
 */
export interface UseUnifiedCycleCountReturn {
  // Current task being worked on
  currentTask: CycleCountTask | null

  // For push mode - list of pushed tasks awaiting acknowledgment
  pushedTasks: CycleCountTask[]

  // Loading states
  isLoading: boolean
  isClaiming: boolean
  isCompleting: boolean
  isStarting: boolean
  isReleasing: boolean

  // Actions
  claimNext: () => Promise<void>
  startTask: (taskId: string) => Promise<void>
  completeTask: (countedQuantity: number, notes?: string) => Promise<void>
  releaseTask: () => Promise<void>
  acknowledgeTask: (taskId: string) => Promise<void>
  setCurrentTask: (task: CycleCountTask | null) => void

  // Draft management
  saveDraft: (data: Partial<DraftData>) => void
  loadDraft: () => DraftData | null
  clearDraft: () => void
  hasDraft: boolean

  // WebSocket connection status
  isConnected: boolean
  connectionState: ConnectionState

  // Abandonment detection
  taskDurationMinutes: number | null
  isNearingAbandonment: boolean

  // Error state
  error: Error | null
  clearError: () => void
}

// ============================================
// Constants
// ============================================

const DRAFT_KEY_PREFIX = 'unified-cycle-count-draft'

// ============================================
// Main Hook
// ============================================

/**
 * Unified cycle count hook for RF interface
 * Supports both pull mode (worker claims tasks) and push mode (supervisor assigns)
 */
export function useUnifiedCycleCount(
  options: UseUnifiedCycleCountOptions
): UseUnifiedCycleCountReturn {
  const {
    mode,
    onTaskReceived,
    onError,
    autoClaimOnMount = false,
    enableRealtime = true,
    draftDebounceMs = 3000,
    draftMaxAgeMs = 3600000, // 1 hour
    abandonmentWarningMinutes = 20,
  } = options

  // ============================================
  // Hooks & State
  // ============================================

  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const userId = authState.user?.id
  const organizationId = authState.profile?.organization_id

  const [currentTask, setCurrentTask] = useState<CycleCountTask | null>(null)
  const [pushedTasks, setPushedTasks] = useState<CycleCountTask[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('disconnected')
  const [hasDraft, setHasDraft] = useState(false)
  const [taskStartTime, setTaskStartTime] = useState<number | null>(null)

  // Refs for debouncing and cleanup
  const draftTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abandonmentIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  )

  // ============================================
  // Error Handling
  // ============================================

  const handleError = useCallback(
    (err: Error, context: string) => {
      logger.error(`[useUnifiedCycleCount] ${context}:`, err.message)
      setError(err)
      onError?.(err)
      toast.error(`${context}: ${err.message}`)
    },
    [onError]
  )

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  // ============================================
  // Draft Management
  // ============================================

  const getDraftKey = useCallback(() => {
    if (!userId) return null
    return `${DRAFT_KEY_PREFIX}-${userId}`
  }, [userId])

  // Internal load function (not debounced) - must be defined before saveDraft
  const loadDraftInternal = useCallback(
    (key: string): DraftData | null => {
      try {
        const stored = localStorage.getItem(key)
        if (!stored) return null

        const draft: DraftData = JSON.parse(stored)
        const age = Date.now() - draft.lastUpdated

        // Check if draft is expired
        if (age > draftMaxAgeMs) {
          localStorage.removeItem(key)
          return null
        }

        return draft
      } catch {
        return null
      }
    },
    [draftMaxAgeMs]
  )

  const saveDraft = useCallback(
    (data: Partial<DraftData>) => {
      const key = getDraftKey()
      if (!key || !currentTask) return

      // Clear existing timeout
      if (draftTimeoutRef.current) {
        clearTimeout(draftTimeoutRef.current)
      }

      // Debounce the save
      draftTimeoutRef.current = setTimeout(() => {
        try {
          const existingDraft = loadDraftInternal(key)
          const draft: DraftData = {
            taskId: currentTask.id,
            countedQuantity:
              data.countedQuantity ?? existingDraft?.countedQuantity ?? null,
            notes: data.notes ?? existingDraft?.notes ?? '',
            step: data.step ?? existingDraft?.step ?? 1,
            startedAt: existingDraft?.startedAt ?? Date.now(),
            lastUpdated: Date.now(),
          }

          localStorage.setItem(key, JSON.stringify(draft))
          setHasDraft(true)
          logger.log('[useUnifiedCycleCount] Draft saved:', draft.taskId)
        } catch (err) {
          logger.error('[useUnifiedCycleCount] Failed to save draft:', err)
        }
      }, draftDebounceMs)
    },
    [currentTask, getDraftKey, draftDebounceMs, loadDraftInternal]
  )

  const loadDraft = useCallback((): DraftData | null => {
    const key = getDraftKey()
    if (!key) return null
    return loadDraftInternal(key)
  }, [getDraftKey, loadDraftInternal])

  const clearDraft = useCallback(() => {
    const key = getDraftKey()
    if (!key) return

    try {
      localStorage.removeItem(key)
      setHasDraft(false)
      logger.log('[useUnifiedCycleCount] Draft cleared')
    } catch (err) {
      logger.error('[useUnifiedCycleCount] Failed to clear draft:', err)
    }
  }, [getDraftKey])

  // ============================================
  // Mutations
  // ============================================

  // Claim next task
  const claimMutation = useMutation({
    mutationFn: async () => {
      setIsLoading(true)
      return workServiceClient.claimNext()
    },
    onSuccess: (task) => {
      setIsLoading(false)
      if (task) {
        setCurrentTask(task)
        setTaskStartTime(Date.now())
        toast.success(`Claimed: ${task.count_number}`, {
          description: `${task.material_number} at ${task.location}`,
        })
      } else {
        toast.info('No tasks available')
      }
      queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
      queryClient.invalidateQueries({ queryKey: [QUEUE_STATS_QUERY_KEY] })
    },
    onError: (err: Error) => {
      setIsLoading(false)
      handleError(err, 'Failed to claim task')
    },
  })

  // Start task
  const startMutation = useMutation({
    mutationFn: (taskId: string) => workServiceClient.startTask(taskId),
    onSuccess: () => {
      setTaskStartTime(Date.now())
      queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
    },
    onError: (err: Error) => {
      handleError(err, 'Failed to start task')
    },
  })

  // Complete task
  const completeMutation = useMutation({
    mutationFn: ({ taskId, result }: { taskId: string; result: TaskResult }) =>
      workServiceClient.completeTask(taskId, result),
    onSuccess: () => {
      toast.success('Task completed successfully')
      clearDraft()
      setCurrentTask(null)
      setTaskStartTime(null)
      queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
      queryClient.invalidateQueries({ queryKey: [QUEUE_STATS_QUERY_KEY] })
    },
    onError: (err: Error) => {
      handleError(err, 'Failed to complete task')
    },
  })

  // Release task
  const releaseMutation = useMutation({
    mutationFn: (taskId: string) => workServiceClient.releaseTask(taskId),
    onSuccess: () => {
      toast.info('Task released back to queue')
      clearDraft()
      setCurrentTask(null)
      setTaskStartTime(null)
      queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
      queryClient.invalidateQueries({ queryKey: [QUEUE_STATS_QUERY_KEY] })
    },
    onError: (err: Error) => {
      handleError(err, 'Failed to release task')
    },
  })

  // Acknowledge pushed task
  const acknowledgeMutation = useMutation({
    mutationFn: (taskId: string) => workServiceClient.acknowledgePush(taskId),
    onSuccess: (_, taskId) => {
      // Remove from pushed tasks list
      setPushedTasks((prev) => prev.filter((t) => t.id !== taskId))
      queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
    },
    onError: (err: Error) => {
      handleError(err, 'Failed to acknowledge task')
    },
  })

  // ============================================
  // Action Handlers
  // ============================================

  // Destructure mutateAsync for stable dependency references
  const { mutateAsync: claimMutateAsync } = claimMutation
  const { mutateAsync: startMutateAsync } = startMutation
  const { mutateAsync: completeMutateAsync } = completeMutation
  const { mutateAsync: releaseMutateAsync } = releaseMutation
  const { mutateAsync: acknowledgeMutateAsync } = acknowledgeMutation

  const claimNext = useCallback(async () => {
    if (mode !== 'pull') {
      logger.warn(
        '[useUnifiedCycleCount] claimNext only available in pull mode'
      )
      return
    }
    await claimMutateAsync()
  }, [mode, claimMutateAsync])

  const startTask = useCallback(
    async (taskId: string) => {
      await startMutateAsync(taskId)
    },
    [startMutateAsync]
  )

  const completeTask = useCallback(
    async (countedQuantity: number, notes?: string) => {
      if (!currentTask) {
        handleError(new Error('No active task to complete'), 'completeTask')
        return
      }
      await completeMutateAsync({
        taskId: currentTask.id,
        result: { counted_quantity: countedQuantity, notes },
      })
    },
    [currentTask, completeMutateAsync, handleError]
  )

  const releaseTask = useCallback(async () => {
    if (!currentTask) {
      handleError(new Error('No active task to release'), 'releaseTask')
      return
    }
    await releaseMutateAsync(currentTask.id)
  }, [currentTask, releaseMutateAsync, handleError])

  const acknowledgeTask = useCallback(
    async (taskId: string) => {
      await acknowledgeMutateAsync(taskId)
    },
    [acknowledgeMutateAsync]
  )

  // ============================================
  // WebSocket Handler
  // ============================================

  const handleWsEvent = useCallback(
    (event: WsEvent) => {
      // Handle pushed work events for current user
      if (
        event.type === 'PushedWork' &&
        event.user_id === userId &&
        mode === 'push'
      ) {
        logger.log('[useUnifiedCycleCount] Received pushed work:', event)

        // Create task object for the pushed work
        const pushedTask: CycleCountTask = {
          id: event.task_id!,
          count_number: event.count_number || '',
          material_number: event.material || '',
          material_description: null,
          location: event.location || '',
          warehouse: null,
          system_quantity: 0,
          counted_quantity: null,
          unit_of_measure: 'EA',
          priority:
            (event.priority as 'critical' | 'hot' | 'normal' | 'low') ||
            'normal',
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

        // Add to pushed tasks
        setPushedTasks((prev) => {
          // Prevent duplicates
          if (prev.some((t) => t.id === pushedTask.id)) return prev
          return [...prev, pushedTask]
        })

        // Notify via callback
        onTaskReceived?.(pushedTask)

        // Show toast notification
        toast.info(`New work assigned: ${event.material}`, {
          description: `Location: ${event.location} | Priority: ${event.priority}`,
          duration: 10000,
        })
      }

      // Handle task status changes
      if (
        event.type === 'TaskStatusChanged' &&
        event.task_id === currentTask?.id
      ) {
        logger.log('[useUnifiedCycleCount] Task status changed:', event)
        // Update current task status
        setCurrentTask((prev) =>
          prev ? { ...prev, status: event.new_status || prev.status } : null
        )
      }
    },
    [userId, organizationId, mode, currentTask?.id, onTaskReceived]
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
      setConnectionState(state)
      setIsConnected(state === 'connected')
    })

    // Initial state check
    setIsConnected(workServiceWs.isConnected())
    setConnectionState(workServiceWs.getConnectionState())

    return () => {
      workServiceWs.removeHandler(handleWsEvent)
      unsubscribe()
    }
  }, [organizationId, enableRealtime, handleWsEvent])

  // ============================================
  // Auto-claim on mount (pull mode)
  // ============================================

  useEffect(() => {
    if (mode === 'pull' && autoClaimOnMount && userId && !currentTask) {
      // Check for existing draft first
      const draft = loadDraft()
      if (draft && draft.taskId) {
        // Try to fetch the task from the draft
        workServiceClient
          .getTask(draft.taskId)
          .then((task) => {
            if (task && task.assigned_to === userId) {
              setCurrentTask(task)
              setHasDraft(true)
              setTaskStartTime(draft.startedAt)
              toast.info('Resumed in-progress count', {
                description: `${task.material_number} at ${task.location}`,
              })
            } else {
              // Draft is stale, clear it and claim new
              clearDraft()
              claimMutation.mutate()
            }
          })
          .catch(() => {
            // Task no longer available, clear draft and claim new
            clearDraft()
            claimMutation.mutate()
          })
      } else {
        claimMutation.mutate()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally minimal deps: only runs on mount/mode change, not on every state update
  }, [mode, autoClaimOnMount, userId])

  // ============================================
  // Check for draft on mount
  // ============================================

  useEffect(() => {
    const draft = loadDraft()
    setHasDraft(!!draft)
  }, [loadDraft])

  // ============================================
  // Abandonment Detection
  // ============================================

  const taskDurationMinutes = useMemo(() => {
    if (!taskStartTime) return null
    return Math.floor((Date.now() - taskStartTime) / 60000)
  }, [taskStartTime])

  const isNearingAbandonment = useMemo(() => {
    if (taskDurationMinutes === null) return false
    return taskDurationMinutes >= abandonmentWarningMinutes
  }, [taskDurationMinutes, abandonmentWarningMinutes])

  // Abandonment warning interval
  useEffect(() => {
    if (!currentTask || !taskStartTime) {
      if (abandonmentIntervalRef.current) {
        clearInterval(abandonmentIntervalRef.current)
        abandonmentIntervalRef.current = null
      }
      return
    }

    // Check every minute
    abandonmentIntervalRef.current = setInterval(() => {
      const durationMinutes = Math.floor((Date.now() - taskStartTime) / 60000)
      if (
        durationMinutes >= abandonmentWarningMinutes &&
        durationMinutes % 5 === 0
      ) {
        toast.warning('Task may be marked as abandoned soon', {
          description: `You've been working on this count for ${durationMinutes} minutes.`,
        })
      }
    }, 60000)

    return () => {
      if (abandonmentIntervalRef.current) {
        clearInterval(abandonmentIntervalRef.current)
        abandonmentIntervalRef.current = null
      }
    }
  }, [currentTask, taskStartTime, abandonmentWarningMinutes])

  // ============================================
  // Cleanup
  // ============================================

  useEffect(() => {
    return () => {
      if (draftTimeoutRef.current) {
        clearTimeout(draftTimeoutRef.current)
      }
      if (abandonmentIntervalRef.current) {
        clearInterval(abandonmentIntervalRef.current)
      }
    }
  }, [])

  // ============================================
  // Return
  // ============================================

  return {
    // Current task
    currentTask,

    // Pushed tasks (for push mode)
    pushedTasks,

    // Loading states
    isLoading,
    isClaiming: claimMutation.isPending,
    isCompleting: completeMutation.isPending,
    isStarting: startMutation.isPending,
    isReleasing: releaseMutation.isPending,

    // Actions
    claimNext,
    startTask,
    completeTask,
    releaseTask,
    acknowledgeTask,
    setCurrentTask,

    // Draft management
    saveDraft,
    loadDraft,
    clearDraft,
    hasDraft,

    // WebSocket connection
    isConnected,
    connectionState,

    // Abandonment detection
    taskDurationMinutes,
    isNearingAbandonment,

    // Error state
    error,
    clearError,
  }
}

// ============================================
// Utility Exports
// ============================================

/**
 * Check if any unified cycle count drafts exist for the current user
 */
export function hasUnifiedCycleCountDraft(userId: string): boolean {
  try {
    const key = `${DRAFT_KEY_PREFIX}-${userId}`
    return !!localStorage.getItem(key)
  } catch {
    return false
  }
}

/**
 * Clear all unified cycle count drafts
 */
export function clearAllUnifiedDrafts(): void {
  try {
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith(DRAFT_KEY_PREFIX)
    )
    keys.forEach((key) => localStorage.removeItem(key))
    logger.log('[useUnifiedCycleCount] Cleared all drafts:', keys.length)
  } catch (err) {
    logger.error('[useUnifiedCycleCount] Failed to clear all drafts:', err)
  }
}
