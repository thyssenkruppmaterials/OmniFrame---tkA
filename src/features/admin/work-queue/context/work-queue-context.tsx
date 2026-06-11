// Created and developed by Jai Singh
/**
 * Simple Work Queue Context Provider
 * Simplified state management for work queue administration interface
 * Temporary version while resolving TypeScript typing issues.
 *
 * Stats freshness is push-driven via the existing `WorkServiceWebSocket`
 * singleton (see `src/lib/work-service/websocket.ts`). The legacy
 * `setInterval(refreshQueueStats, 30_000)` was retired as part of the
 * "Bundle with Option 2" Roadmap migration (see
 * `memorybank/OmniFrame/Decisions/Roadmap-Rust-WS-Unlocks.md`); a slow
 * 5-minute safety-net `setInterval` only kicks in when the WS is NOT
 * `'connected'`.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { logger } from '@/lib/utils/logger'
import type { WsEvent } from '@/lib/work-service/types'
import { workServiceWs } from '@/lib/work-service/websocket'

/**
 * Safety-net poll cadence when the WS is NOT connected. Mirrors the
 * `WORK_QUEUE_FALLBACK_REFETCH_MS` constant in `src/hooks/use-work-queue.ts`
 * — kept as a local copy because this provider doesn't otherwise depend
 * on that hook and re-importing it just to share a number would create
 * an awkward FE→FE coupling.
 */
const QUEUE_STATS_FALLBACK_INTERVAL_MS = 5 * 60 * 1000

// ============================================================================
// SIMPLIFIED INTERFACES AND TYPES
// ============================================================================

interface SimpleQueueStats {
  total_pending: number
  total_assigned: number
  total_in_progress: number
  total_completed_today: number
  total_failed_today: number
  average_completion_time: number
  worker_utilization: number
  queue_depth_by_priority: Record<string, number>
  queue_depth_by_type: Record<string, number>
}

interface SimpleRealTimeMetrics {
  timestamp: string
  queue_depth: number
  tasks_per_minute: number
  average_wait_time: number
  worker_utilization: number
  completion_rate: number
  error_rate: number
  sla_compliance: number
  bottlenecks: string[]
}

interface SimpleBottleneckAnalysis {
  identified_bottlenecks: Array<{
    type: string
    severity: string
    description: string
    affected_tasks: number
    recommended_actions: string[]
    estimated_impact: string
  }>
  overall_health_score: number
  recommendations: string[]
}

interface SimpleWorkQueueTask {
  id: string
  title: string
  description?: string | null
  task_type: string
  priority: number
  status: string
  location?: string
  zone?: string
  material_number?: string
  quantity?: number
  unit_of_measure?: string
  assigned_to?: string
  created_at: string
}

interface SimpleWorkerProfile {
  id: string
  user_id: string
  is_available: boolean
  max_concurrent_tasks: number
  current_tasks?: number
  tasks_completed_today: number
  productivity_score?: number
  current_zone?: string
  user_profiles?: {
    full_name?: string
    email?: string
  }
}

interface WorkQueueContextState {
  // Queue Data
  queueStats: SimpleQueueStats | null
  realtimeMetrics: SimpleRealTimeMetrics | null
  bottleneckAnalysis: SimpleBottleneckAnalysis | null

  // Tasks
  pendingTasks: SimpleWorkQueueTask[]
  assignedTasks: SimpleWorkQueueTask[]
  completedTasks: SimpleWorkQueueTask[]

  // Workers
  availableWorkers: SimpleWorkerProfile[]
  workerLoadDistribution: Array<{ workerId: string; load: number }>

  // Loading States
  isLoadingStats: boolean
  isLoadingMetrics: boolean
  isLoadingWorkers: boolean
  isLoadingTasks: boolean

  // Actions
  refreshAllData: () => Promise<void>
  refreshQueueStats: () => Promise<void>
  refreshWorkers: () => Promise<void>
  refreshTasks: () => Promise<void>

  // Real-time subscriptions
  isSubscribed: boolean
  subscribeToUpdates: () => void
  unsubscribeFromUpdates: () => void
}

const WorkQueueContext = createContext<WorkQueueContextState | undefined>(
  undefined
)

// ============================================================================
// CONTEXT PROVIDER
// ============================================================================

interface WorkQueueProviderProps {
  children: React.ReactNode
}

export function WorkQueueProvider({ children }: WorkQueueProviderProps) {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id

  const [queueStats, setQueueStats] = useState<SimpleQueueStats | null>(null)
  const [realtimeMetrics, setRealtimeMetrics] =
    useState<SimpleRealTimeMetrics | null>(null)
  const [bottleneckAnalysis, setBottleneckAnalysis] =
    useState<SimpleBottleneckAnalysis | null>(null)
  const [pendingTasks, setPendingTasks] = useState<SimpleWorkQueueTask[]>([])
  const [assignedTasks, setAssignedTasks] = useState<SimpleWorkQueueTask[]>([])
  const [completedTasks, setCompletedTasks] = useState<SimpleWorkQueueTask[]>(
    []
  )
  const [availableWorkers, setAvailableWorkers] = useState<
    SimpleWorkerProfile[]
  >([])
  const [workerLoadDistribution] = useState<
    Array<{ workerId: string; load: number }>
  >([])

  // Loading States
  const [isLoadingStats, setIsLoadingStats] = useState(false)
  const [isLoadingMetrics] = useState(false)
  const [isLoadingWorkers, setIsLoadingWorkers] = useState(false)
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)

  // Subscription State
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [subscriptions, setSubscriptions] = useState<
    Array<{ unsubscribe: () => void }>
  >([])

  // ========================================================================
  // DATA LOADING FUNCTIONS
  // ========================================================================

  const refreshQueueStats = useCallback(async () => {
    setIsLoadingStats(true)
    try {
      // Simulated data for now
      const stats: SimpleQueueStats = {
        total_pending: 2,
        total_assigned: 1,
        total_in_progress: 0,
        total_completed_today: 0,
        total_failed_today: 0,
        average_completion_time: 25,
        worker_utilization: 15,
        queue_depth_by_priority: { high: 1, medium: 1, low: 0 },
        queue_depth_by_type: { CYCLE_COUNT: 1, PUTAWAY: 1, PICKING: 0 },
      }

      const metrics: SimpleRealTimeMetrics = {
        timestamp: new Date().toISOString(),
        queue_depth: 2,
        tasks_per_minute: 0.5,
        average_wait_time: 5,
        worker_utilization: 15,
        completion_rate: 100,
        error_rate: 0,
        sla_compliance: 98,
        bottlenecks: [],
      }

      const bottlenecks: SimpleBottleneckAnalysis = {
        identified_bottlenecks: [],
        overall_health_score: 95,
        recommendations: [
          'System operating efficiently - no major bottlenecks detected',
        ],
      }

      setQueueStats(stats)
      setRealtimeMetrics(metrics)
      setBottleneckAnalysis(bottlenecks)

      logger.log('✅ Work Queue Context: Queue statistics loaded (simulated)')
    } catch (error: unknown) {
      logger.error('Unexpected error loading queue stats:', error)
      toast.error('Failed to load queue statistics')
    } finally {
      setIsLoadingStats(false)
    }
  }, [])

  const refreshWorkers = useCallback(async () => {
    setIsLoadingWorkers(true)
    try {
      // Simulated worker data
      const workers: SimpleWorkerProfile[] = [
        {
          id: '1',
          user_id: '1',
          is_available: true,
          max_concurrent_tasks: 3,
          current_tasks: 1,
          tasks_completed_today: 5,
          productivity_score: 85,
          current_zone: 'A1',
          user_profiles: {
            full_name: 'Test Worker',
            email: 'worker@test.com',
          },
        },
      ]

      setAvailableWorkers(workers)
      logger.log('✅ Work Queue Context: Workers loaded (simulated)')
    } catch (error: unknown) {
      logger.error('Unexpected error loading workers:', error)
      toast.error('Failed to load workers')
    } finally {
      setIsLoadingWorkers(false)
    }
  }, [])

  const refreshTasks = useCallback(async () => {
    setIsLoadingTasks(true)
    try {
      // Simulated task data
      const pending: SimpleWorkQueueTask[] = [
        {
          id: '1',
          title: 'Cycle Count - Zone A1',
          description: 'Count inventory in warehouse zone A1',
          task_type: 'CYCLE_COUNT',
          priority: 75,
          status: 'pending',
          location: 'A1-B2-C3',
          zone: 'A1',
          material_number: 'MAT001',
          quantity: 150,
          unit_of_measure: 'EA',
          created_at: new Date().toISOString(),
        },
      ]

      const assigned: SimpleWorkQueueTask[] = [
        {
          id: '2',
          title: 'Put Away - Batch TK2025001',
          description: 'Store received items from batch TK2025001',
          task_type: 'PUTAWAY',
          priority: 60,
          status: 'assigned',
          location: 'B2-C3-D4',
          zone: 'B2',
          material_number: 'MAT002',
          quantity: 75,
          unit_of_measure: 'EA',
          assigned_to: '1',
          created_at: new Date().toISOString(),
        },
      ]

      setPendingTasks(pending)
      setAssignedTasks(assigned)
      setCompletedTasks([])

      logger.log('✅ Work Queue Context: Tasks loaded (simulated)')
    } catch (error: unknown) {
      logger.error('Unexpected error loading tasks:', error)
      toast.error('Failed to load tasks')
    } finally {
      setIsLoadingTasks(false)
    }
  }, [])

  const refreshAllData = useCallback(async () => {
    await Promise.all([refreshQueueStats(), refreshWorkers(), refreshTasks()])
  }, [refreshQueueStats, refreshWorkers, refreshTasks])

  // ========================================================================
  // REAL-TIME SUBSCRIPTIONS
  // ========================================================================

  const subscribeToUpdates = useCallback(() => {
    if (isSubscribed) return

    logger.log(
      '🔔 Work Queue Context: Subscribing to real-time updates (simulated)'
    )
    setIsSubscribed(true)
    toast.success('Real-time updates enabled')
  }, [isSubscribed])

  const unsubscribeFromUpdates = useCallback(() => {
    if (!isSubscribed) return

    logger.log('🔕 Work Queue Context: Unsubscribing from real-time updates')

    subscriptions.forEach((subscription) => {
      if (subscription && typeof subscription.unsubscribe === 'function') {
        subscription.unsubscribe()
      }
    })

    setSubscriptions([])
    setIsSubscribed(false)
    toast.info('Real-time updates disabled')
  }, [isSubscribed, subscriptions])

  // ========================================================================
  // EFFECTS
  // ========================================================================

  // Load initial data
  useEffect(() => {
    refreshAllData()
  }, [refreshAllData])

  // ========================================================================
  // PUSH-DRIVEN STATS REFRESH
  // ========================================================================
  // Stats freshness comes from the existing `WorkServiceWebSocket`. The
  // 30-second `setInterval(refreshQueueStats, 30_000)` that used to live
  // here was retired in the 2026-05-06 "Bundle with Option 2" migration
  // (see `memorybank/OmniFrame/Decisions/Roadmap-Rust-WS-Unlocks.md`).
  //
  // The WS handler invalidates by calling `refreshQueueStats()`; a
  // 5-minute safety-net interval only runs when the WS is NOT in
  // `'connected'` state. Steady-state network volume in healthy WS
  // conditions is zero — events drive everything.
  // ========================================================================

  // Use a ref for the handler so the WS effect below doesn't re-register
  // on every `refreshQueueStats` identity change (which would tear down
  // and re-establish the singleton subscription on each provider render).
  const refreshQueueStatsRef = useRef(refreshQueueStats)
  useEffect(() => {
    refreshQueueStatsRef.current = refreshQueueStats
  }, [refreshQueueStats])

  useEffect(() => {
    if (!organizationId) return

    const handleWsEvent = (event: WsEvent) => {
      // Any event that can change a queue-stat field — assignment,
      // status transition, push, escalation, worker counts, or the
      // canonical scheduler-pushed `QueueStatsUpdated`.
      switch (event.type) {
        case 'TaskAssigned':
        case 'TaskStatusChanged':
        case 'PushedWork':
        case 'ReservationEscalated':
        case 'WorkerStatusChanged':
        case 'QueueStatsUpdated':
          logger.log('[WorkQueueContext] WS-driven stats refresh:', event.type)
          void refreshQueueStatsRef.current()
          return
        default:
          return
      }
    }

    workServiceWs.connect(organizationId, handleWsEvent)

    let intervalId: ReturnType<typeof setInterval> | null = null

    const armOrDisarmInterval = (
      state: ReturnType<typeof workServiceWs.getConnectionState>
    ) => {
      if (state === 'connected') {
        if (intervalId !== null) {
          clearInterval(intervalId)
          intervalId = null
        }
        return
      }
      if (intervalId === null) {
        intervalId = setInterval(() => {
          void refreshQueueStatsRef.current()
        }, QUEUE_STATS_FALLBACK_INTERVAL_MS)
      }
    }

    armOrDisarmInterval(workServiceWs.getConnectionState())
    const unsubscribeStateChange =
      workServiceWs.onStateChange(armOrDisarmInterval)

    return () => {
      workServiceWs.removeHandler(handleWsEvent)
      unsubscribeStateChange()
      if (intervalId !== null) clearInterval(intervalId)
    }
  }, [organizationId])

  // Cleanup subscriptions on unmount
  useEffect(() => {
    return () => {
      unsubscribeFromUpdates()
    }
  }, [unsubscribeFromUpdates])

  // ========================================================================
  // CONTEXT VALUE
  // ========================================================================

  const contextValue: WorkQueueContextState = {
    // Queue Data
    queueStats,
    realtimeMetrics,
    bottleneckAnalysis,

    // Tasks
    pendingTasks,
    assignedTasks,
    completedTasks,

    // Workers
    availableWorkers,
    workerLoadDistribution,

    // Loading States
    isLoadingStats,
    isLoadingMetrics,
    isLoadingWorkers,
    isLoadingTasks,

    // Actions
    refreshAllData,
    refreshQueueStats,
    refreshWorkers,
    refreshTasks,

    // Real-time subscriptions
    isSubscribed,
    subscribeToUpdates,
    unsubscribeFromUpdates,
  }

  return (
    <WorkQueueContext.Provider value={contextValue}>
      {children}
    </WorkQueueContext.Provider>
  )
}

// ============================================================================
// HOOK
// ============================================================================

export function useWorkQueue() {
  const context = useContext(WorkQueueContext)
  if (context === undefined) {
    throw new Error('useWorkQueue must be used within a WorkQueueProvider')
  }
  return context
}

// Created and developed by Jai Singh
