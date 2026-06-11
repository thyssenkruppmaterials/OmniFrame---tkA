// Created and developed by Jai Singh
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
import { PUSHED_WORK_QUERY_KEY } from './use-pushed-work'
import { QUEUE_STATS_QUERY_KEY, WORK_QUEUE_QUERY_KEY } from './use-work-queue'

// ============================================
// Types
// ============================================

/**
 * Draft data structure for auto-save.
 * Persists the full workflow position so a refresh/reopen restores exactly where the operator left off.
 */
export interface DraftData {
  taskId: string
  countedQuantity: number | null
  notes: string
  step: number
  startedAt: number
  lastUpdated: number
  locationVerified?: boolean
  scannedLocation?: string
  emptyLocationState?: {
    isEmpty: boolean | null
    foundPartNumber: string
    foundQuantity: number
  }
  // Extras pipeline state — lets operators resume mid-extras without
  // repeating captures. Results themselves live on the task row's
  // `workflow_result` JSONB; these just remember the UI position.
  subStep?: 'pre_extras' | 'post_extras' | null
  preCountIndex?: number
  postCountIndex?: number
  // Supervisor sign-off state is intentionally NOT persisted — PINs
  // should never touch localStorage.
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
  isInitialized: boolean
  isClaiming: boolean
  isCompleting: boolean
  isStarting: boolean
  isReleasing: boolean

  // Actions
  claimNext: () => Promise<void>
  startTask: (taskId: string) => Promise<void>
  completeTask: (countedQuantity: number, notes?: string) => Promise<void>
  releaseTask: () => Promise<void>
  skipTask: (reason?: string) => Promise<void>
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
  const [isInitialized, setIsInitialized] = useState(false)
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

      // Zone-exclusivity errors (migrations 225/226/227) deserve tailored
      // toasts. There are two distinct variants:
      //   ZONE_LOCKED   — someone else is actively counting this zone.
      //   ZONE_ASSIGNED — this zone is admin-assigned to a different user.
      if (err.message && err.message.includes('ZONE_ASSIGNED')) {
        const zoneMatch = /Zone\s+"([^"]+)"/i.exec(err.message)
        const ownerMatch = /assigned to\s+([^.]+?)\./i.exec(err.message)
        const zone = zoneMatch?.[1] ?? 'this zone'
        const owner = ownerMatch?.[1]?.trim() ?? 'another counter'
        toast.error(`Zone ${zone} is assigned`, {
          description: `This zone is dedicated to ${owner}. Try a different zone — the queue will route you to your available work.`,
          duration: 6000,
        })
        return
      }
      if (err.message && err.message.includes('ZONE_LOCKED')) {
        const zoneMatch = /Zone\s+"([^"]+)"/i.exec(err.message)
        const zone = zoneMatch?.[1] ?? 'this zone'
        const reserved =
          /reserved for/i.test(err.message) ||
          /state=reserved/i.test(err.message)
        if (reserved) {
          const ownerMatch = /reserved for\s+([^(.]+?)(?:\s*\(|\.)/i.exec(
            err.message
          )
          const owner = ownerMatch?.[1]?.trim() ?? 'another counter'
          toast.error(`Zone ${zone} is reserved`, {
            description: `Held for ${owner} until they return or an admin clears it. Try a different zone — the queue will route you automatically.`,
            duration: 6000,
          })
        } else {
          const ownerMatch = /counted by\s+([^.]+?)\./i.exec(err.message)
          const owner = ownerMatch?.[1]?.trim() ?? 'another counter'
          toast.error(`Zone ${zone} is busy`, {
            description: `${owner} is counting there. Try another zone — the queue will route you automatically.`,
            duration: 6000,
          })
        }
        return
      }

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
            locationVerified:
              data.locationVerified ?? existingDraft?.locationVerified,
            scannedLocation:
              data.scannedLocation ?? existingDraft?.scannedLocation,
            emptyLocationState:
              data.emptyLocationState ?? existingDraft?.emptyLocationState,
            subStep: data.subStep ?? existingDraft?.subStep ?? null,
            preCountIndex:
              data.preCountIndex ?? existingDraft?.preCountIndex ?? 0,
            postCountIndex:
              data.postCountIndex ?? existingDraft?.postCountIndex ?? 0,
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

  // Claim next task. The Rust route signals "queue is empty for this
  // worker right now" by resolving with `{ success: false, task: null }`
  // (see `workServiceClient.claimNext`). That is NOT an error — we render
  // the "Pull Next Count" landing UI instead of toasting. Only genuine
  // failures (HTTP 4xx/5xx, network) reach `onError`.
  const claimMutation = useMutation({
    mutationFn: async () => {
      setIsLoading(true)
      return workServiceClient.claimNext()
    },
    onSuccess: (response) => {
      setIsLoading(false)
      const task = response?.task ?? null
      if (task) {
        setCurrentTask(task)
        setTaskStartTime(Date.now())
        toast.success(`Claimed: ${task.count_number}`, {
          description: `${task.material_number} at ${task.location}`,
        })
      } else {
        // Empty-queue is a normal product state: the parent component
        // already renders a "Pull Next Count" landing when
        // `currentTask === null`. Don't surface a toast on every retry —
        // it'd flood the operator's screen on a quiet shift. Logging
        // stays at debug so a verbose build can still see the cadence.
        logger.debug(
          '[useUnifiedCycleCount] claim returned no task (queue idle)'
        )
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
      // Pushed-work badge can change when a pushed task completes.
      queryClient.invalidateQueries({ queryKey: [PUSHED_WORK_QUERY_KEY] })
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
      queryClient.invalidateQueries({ queryKey: [PUSHED_WORK_QUERY_KEY] })
    },
    onError: (err: Error) => {
      handleError(err, 'Failed to release task')
    },
  })

  // Skip/defer task
  const skipMutation = useMutation({
    mutationFn: ({ taskId, reason }: { taskId: string; reason?: string }) =>
      workServiceClient.skipTask(taskId, reason),
    onSuccess: () => {
      toast.info('Count skipped — it will come back after your other counts')
      clearDraft()
      setCurrentTask(null)
      setTaskStartTime(null)
      queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
      queryClient.invalidateQueries({ queryKey: [QUEUE_STATS_QUERY_KEY] })
    },
    onError: (err: Error) => {
      handleError(err, 'Failed to skip task')
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
  const { mutateAsync: skipMutateAsync } = skipMutation
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

  const skipTask = useCallback(
    async (reason?: string) => {
      if (!currentTask) {
        handleError(new Error('No active task to skip'), 'skipTask')
        return
      }
      await skipMutateAsync({ taskId: currentTask.id, reason })
      if (mode === 'pull') {
        // Auto-claim is best-effort. Migration 252 fix: surface the
        // outcome to the operator instead of leaving them wondering.
        //
        // The empty-queue branch is now signalled by a resolved
        // `{ success: false, task: null }` rather than a throw (see the
        // 2026-05-07 noise fix in `workServiceClient.claimNext`), so we
        // detect both: a thrown error (zone collision, server error)
        // AND a resolved-but-empty response (no eligible next-up).
        try {
          const response = await claimMutateAsync()
          const claimedTask = response?.task ?? null
          if (!claimedTask) {
            toast.info('Skipped. No more counts available right now.', {
              description: 'Tap Pull Next to try again.',
              duration: 6000,
            })
          }
        } catch (err) {
          logger.warn(
            '[useUnifiedCycleCount] auto-claim after skip failed:',
            err
          )
          const msg = err instanceof Error ? err.message : ''
          if (/ZONE_LOCKED|ZONE_ASSIGNED/i.test(msg)) {
            toast.warning(
              'Skipped. Next-up count is in a zone reserved for someone else.',
              {
                description:
                  'Tap Pull Next when you finish your current zone, or ask a supervisor to release the reservation.',
                duration: 8000,
              }
            )
          } else {
            toast.info('Skipped. No more counts available right now.', {
              description: 'Tap Pull Next to try again.',
              duration: 6000,
            })
          }
        }
      }
    },
    [currentTask, skipMutateAsync, handleError, mode, claimMutateAsync]
  )

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
      // Accept PushedWork regardless of current mode so auto-detection can switch to push
      if (event.type === 'PushedWork' && event.user_id === userId) {
        logger.log('[useUnifiedCycleCount] Received pushed work:', event)

        const taskId = event.task_id
        if (!taskId) return

        workServiceClient
          .getTask(taskId)
          .then((fullTask) => {
            setPushedTasks((prev) => {
              if (prev.some((t) => t.id === fullTask.id)) return prev
              return [...prev, fullTask]
            })
            onTaskReceived?.(fullTask)
            queryClient.invalidateQueries({
              queryKey: [PUSHED_WORK_QUERY_KEY],
            })
            toast.info(`New work assigned: ${event.material}`, {
              description: `Location: ${event.location} | Priority: ${event.priority}`,
              duration: 10000,
            })
          })
          .catch((err) => {
            logger.error(
              '[useUnifiedCycleCount] Failed to fetch pushed task:',
              err
            )
            // Surface to the operator so they don't silently miss work
            // that was just pushed to them.
            toast.warning('Pushed work received but details failed to load', {
              description:
                'The notification arrived but task details could not be fetched. Refresh to try again.',
              duration: 8000,
            })
          })
      }

      // Handle task status changes
      if (
        event.type === 'TaskStatusChanged' &&
        event.task_id === currentTask?.id
      ) {
        logger.log('[useUnifiedCycleCount] Task status changed:', event)
        setCurrentTask((prev) =>
          prev ? { ...prev, status: event.new_status || prev.status } : null
        )
      }
    },
    [userId, organizationId, currentTask?.id, onTaskReceived, queryClient]
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
  // Initial fetch for pre-existing push assignments
  // ============================================

  useEffect(() => {
    if (!userId || !organizationId) return
    workServiceClient
      .getQueue()
      .then((queue) => {
        const myPushed = queue.filter(
          (t) =>
            t.push_mode === 'push' &&
            t.assigned_to === userId &&
            !t.push_acknowledged
        )
        if (myPushed.length > 0) {
          setPushedTasks((prev) => {
            const existing = new Set(prev.map((t) => t.id))
            const newTasks = myPushed.filter((t) => !existing.has(t.id))
            return newTasks.length > 0 ? [...prev, ...newTasks] : prev
          })
          logger.log(
            `[useUnifiedCycleCount] Found ${myPushed.length} pre-existing push assignments`
          )
        }
      })
      .catch(() => {
        logger.warn(
          '[useUnifiedCycleCount] Could not fetch queue for push assignments'
        )
      })
  }, [userId, organizationId])

  // ============================================
  // Auto-claim on mount (pull mode)
  // ============================================

  useEffect(() => {
    if (mode === 'pull' && autoClaimOnMount && userId && !currentTask) {
      const ACTIVE_STATUSES = ['pending', 'in_progress', 'recount']

      const finalize = () => setIsInitialized(true)

      // Check for existing draft first
      const draft = loadDraft()
      if (draft && draft.taskId) {
        workServiceClient
          .getTask(draft.taskId)
          .then((task) => {
            if (
              task &&
              task.assigned_to === userId &&
              ACTIVE_STATUSES.includes(task.status)
            ) {
              setCurrentTask(task)
              setHasDraft(true)
              setTaskStartTime(draft.startedAt)
              toast.info('Resumed in-progress count', {
                description: `${task.material_number} at ${task.location}`,
              })
              finalize()
            } else {
              clearDraft()
              claimMutation.mutate(undefined, { onSettled: finalize })
            }
          })
          .catch(() => {
            clearDraft()
            claimMutation.mutate(undefined, { onSettled: finalize })
          })
      } else {
        claimMutation.mutate(undefined, { onSettled: finalize })
      }
    } else {
      setIsInitialized(true)
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
    isInitialized,
    isClaiming: claimMutation.isPending,
    isCompleting: completeMutation.isPending,
    isStarting: startMutation.isPending,
    isReleasing: releaseMutation.isPending,

    // Actions
    claimNext,
    startTask,
    completeTask,
    releaseTask,
    skipTask,
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

// Created and developed by Jai Singh
