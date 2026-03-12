import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import {
  cycleCountService,
  type CycleCountData,
  type CycleCountDataWithUser,
  type CycleCountPriority,
  type CycleCountStatistics,
  type ImportProgress,
} from '@/lib/supabase/cycle-count.service'
import { logger } from '@/lib/utils/logger'

export interface UseCycleCountOperationsProps {
  enableRealtime?: boolean
  searchQuery?: string
}

export interface UseCycleCountOperationsReturn {
  // Data
  data: CycleCountDataWithUser[]
  filteredData: CycleCountDataWithUser[]
  statistics: CycleCountStatistics | null

  // Loading states
  isLoading: boolean
  isLoadingStatistics: boolean
  isImporting: boolean

  // Error states
  error: Error | null
  statisticsError: Error | null

  // Import functionality
  importProgress: ImportProgress | null
  importFromClipboard: () => Promise<void>

  // Search functionality
  searchQuery: string
  setSearchQuery: (query: string) => void

  // CRUD operations
  createCycleCount: (cycleCountData: Partial<CycleCountData>) => Promise<void>
  createMultipleCycleCounts: (
    countsData: Array<Partial<CycleCountData>>
  ) => Promise<void>
  updateCycleCount: (
    id: string,
    updates: Partial<CycleCountData>
  ) => Promise<void>
  deleteCycleCount: (id: string) => Promise<void>
  approveCycleCount: (id: string, approvalComments?: string) => Promise<void>
  markForRecount: (id: string, reason?: string) => Promise<void>
  initiateRecount: (id: string, reason?: string) => Promise<void>
  completeRecount: (
    id: string,
    newCountedQuantity: number,
    recountBy: string
  ) => Promise<void>

  // Assignment operations
  assignCountToUser: (countId: string, userId: string) => Promise<void>
  unassignCount: (countId: string) => Promise<void>
  assignNextCount: (
    userId: string
  ) => Promise<{ success: boolean; data?: unknown; error: unknown }>

  // Priority operations
  updateCycleCountPriority: (
    countId: string,
    priority: CycleCountPriority
  ) => Promise<void>

  // Utility functions
  refreshData: () => void
  exportToCSV: () => string
}

// Query keys for React Query (exported for use in WebSocket invalidation)
export const CYCLE_COUNT_OPERATIONS_QUERY_KEY = 'cycle-count-operations'
export const CYCLE_COUNT_STATISTICS_QUERY_KEY = 'cycle-count-statistics'

export function useCycleCountOperations({
  enableRealtime = true,
  searchQuery: initialSearchQuery = '',
}: UseCycleCountOperationsProps = {}): UseCycleCountOperationsReturn {
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null
  )
  const [isImporting, setIsImporting] = useState(false)

  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()

  // Fetch cycle count operations
  const {
    data: rawData = [],
    isLoading,
    error,
    refetch: refetchOperations,
  } = useQuery({
    queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
    queryFn: async () => {
      const result = await cycleCountService.fetchCycleCountData()
      if (result.error) {
        throw new Error(
          result.error.message || 'Failed to fetch cycle count data'
        )
      }
      return result.data
    },
    staleTime: 30000, // 30 seconds
    refetchInterval: enableRealtime ? 60000 : false, // 1 minute if real-time enabled
  })

  // Fetch statistics
  const {
    data: statistics = null,
    isLoading: isLoadingStatistics,
    error: statisticsError,
    refetch: refetchStatistics,
  } = useQuery({
    queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
    queryFn: async () => {
      const result = await cycleCountService.fetchStatistics()
      if (result.error) {
        throw new Error(
          result.error.message || 'Failed to fetch cycle count statistics'
        )
      }
      return result.statistics
    },
    staleTime: 60000, // 1 minute
    refetchInterval: enableRealtime ? 300000 : false, // 5 minutes if real-time enabled
  })

  // Real-time subscription for cycle count data
  // Enhanced with organization-level filtering to improve performance
  useEffect(() => {
    if (!enableRealtime || !authState.user) return

    // Get user's organization ID for filtering
    const userOrgId = authState.profile?.organization_id

    if (!userOrgId) {
      logger.warn(
        '⚠️ No organization ID found for user, skipping real-time subscription'
      )
      return
    }

    // Create organization-specific channel for better performance
    const channelName = `cycle-count-changes-${userOrgId}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rr_cyclecount_data',
          filter: `organization_id=eq.${userOrgId}`, // ✅ Filter by organization
        },
        (payload) => {
          logger.log(
            '🔄 Cycle count data change detected (org-filtered):',
            payload
          )

          // Invalidate and refetch data
          queryClient.invalidateQueries({
            queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
          })
          queryClient.invalidateQueries({
            queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [
    enableRealtime,
    authState.user,
    authState.profile?.organization_id,
    queryClient,
  ])

  // Filter data based on search query
  const filteredData = rawData.filter((item: CycleCountData) => {
    if (!searchQuery) return true

    const searchTerm = searchQuery.toLowerCase()
    return (
      item.material_number?.toLowerCase().includes(searchTerm) ||
      item.material_description?.toLowerCase().includes(searchTerm) ||
      item.location?.toLowerCase().includes(searchTerm) ||
      item.warehouse?.toLowerCase().includes(searchTerm) ||
      item.count_number?.toLowerCase().includes(searchTerm) ||
      item.counter_name?.toLowerCase().includes(searchTerm) ||
      item.batch_number?.toLowerCase().includes(searchTerm) ||
      item.status?.toLowerCase().includes(searchTerm) ||
      item.count_type?.toLowerCase().includes(searchTerm)
    )
  })

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (cycleCountData: Partial<CycleCountData>) => {
      const result = await cycleCountService.createCycleCount(cycleCountData)
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to create cycle count')
      }
      return result.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
      toast.success('Cycle count created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create cycle count: ${error.message}`)
    },
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<CycleCountData>
    }) => {
      const result = await cycleCountService.updateCycleCount(id, updates)
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to update cycle count')
      }
      return result.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
      toast.success('Cycle count updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update cycle count: ${error.message}`)
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const result = await cycleCountService.deleteCycleCount(id)
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to delete cycle count')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
      toast.success('Cycle count deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete cycle count: ${error.message}`)
    },
  })

  // Approval mutation
  const approveMutation = useMutation({
    mutationFn: async ({
      id,
      approvalComments,
    }: {
      id: string
      approvalComments?: string
    }) => {
      const result = await cycleCountService.approveCycleCount(
        id,
        approvalComments
      )
      if (!result.success) {
        throw new Error(
          result.error?.message || 'Failed to approve cycle count'
        )
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
      toast.success('Cycle count approved successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to approve cycle count: ${error.message}`)
    },
  })

  // Mark for recount mutation
  const recountMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const result = await cycleCountService.markForRecount(id, reason)
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to mark for recount')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
      toast.success('Marked for recount successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to mark for recount: ${error.message}`)
    },
  })

  // Initiate recount mutation
  const initiateRecountMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const result = await cycleCountService.initiateRecount(id, reason)
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to initiate recount')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
      toast.success('Recount initiated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to initiate recount: ${error.message}`)
    },
  })

  // Complete recount mutation
  const completeRecountMutation = useMutation({
    mutationFn: async ({
      id,
      newCountedQuantity,
      recountBy,
    }: {
      id: string
      newCountedQuantity: number
      recountBy: string
    }) => {
      const result = await cycleCountService.completeRecount(
        id,
        newCountedQuantity,
        recountBy
      )
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to complete recount')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
      toast.success('Recount completed successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to complete recount: ${error.message}`)
    },
  })

  // Import from clipboard functionality
  const importFromClipboard = useCallback(async () => {
    try {
      setIsImporting(true)
      setImportProgress({
        total: 0,
        processed: 0,
        errors: [],
        isComplete: false,
      })

      const clipboardText = await navigator.clipboard.readText()
      if (!clipboardText.trim()) {
        toast.error('Clipboard is empty')
        return
      }

      const result = await cycleCountService.importFromClipboard(
        clipboardText,
        setImportProgress
      )

      if (result.success) {
        toast.success('Data imported successfully')
        refetchOperations()
        refetchStatistics()
      } else {
        toast.error(`Import failed with ${result.errors.length} errors`)
        logger.error('Import errors:', result.errors)
      }
    } catch (error) {
      toast.error('Failed to import data')
      logger.error('Import error:', error)
    } finally {
      setIsImporting(false)
      setTimeout(() => setImportProgress(null), 3000) // Clear progress after 3 seconds
    }
  }, [refetchOperations, refetchStatistics])

  // Utility functions
  const refreshData = useCallback(() => {
    refetchOperations()
    refetchStatistics()
  }, [refetchOperations, refetchStatistics])

  const exportToCSV = useCallback(() => {
    return cycleCountService.exportToCSV(filteredData)
  }, [filteredData])

  // Destructure mutateAsync from mutations for stable dependency references
  const { mutateAsync: createMutateAsync } = createMutation
  const { mutateAsync: updateMutateAsync } = updateMutation
  const { mutateAsync: deleteMutateAsync } = deleteMutation
  const { mutateAsync: approveMutateAsync } = approveMutation
  const { mutateAsync: recountMutateAsync } = recountMutation
  const { mutateAsync: initiateRecountMutateAsync } = initiateRecountMutation
  const { mutateAsync: completeRecountMutateAsync } = completeRecountMutation

  // CRUD operation wrappers
  const createCycleCount = useCallback(
    async (cycleCountData: Partial<CycleCountData>) => {
      await createMutateAsync(cycleCountData)
    },
    [createMutateAsync]
  )

  const createMultipleCycleCounts = useCallback(
    async (countsData: Array<Partial<CycleCountData>>) => {
      const result =
        await cycleCountService.createMultipleCycleCounts(countsData)
      if (result.success) {
        toast.success(
          `Successfully created ${result.successCount} cycle counts`
        )
        queryClient.invalidateQueries({
          queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
        })
        queryClient.invalidateQueries({
          queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
        })
      } else {
        toast.error(
          `Failed to create cycle counts: ${result.error?.message || 'Unknown error'}`
        )
        throw result.error
      }
    },
    [queryClient]
  )

  const updateCycleCount = useCallback(
    async (id: string, updates: Partial<CycleCountData>) => {
      await updateMutateAsync({ id, updates })
    },
    [updateMutateAsync]
  )

  const deleteCycleCount = useCallback(
    async (id: string) => {
      await deleteMutateAsync(id)
    },
    [deleteMutateAsync]
  )

  const approveCycleCount = useCallback(
    async (id: string, approvalComments?: string) => {
      await approveMutateAsync({ id, approvalComments })
    },
    [approveMutateAsync]
  )

  const markForRecount = useCallback(
    async (id: string, reason?: string) => {
      await recountMutateAsync({ id, reason })
    },
    [recountMutateAsync]
  )

  const initiateRecount = useCallback(
    async (id: string, reason?: string) => {
      await initiateRecountMutateAsync({ id, reason })
    },
    [initiateRecountMutateAsync]
  )

  const completeRecount = useCallback(
    async (id: string, newCountedQuantity: number, recountBy: string) => {
      await completeRecountMutateAsync({
        id,
        newCountedQuantity,
        recountBy,
      })
    },
    [completeRecountMutateAsync]
  )

  // Assignment mutations
  const assignCountMutation = useMutation({
    mutationFn: async ({
      countId,
      userId,
    }: {
      countId: string
      userId: string
    }) => {
      const result = await cycleCountService.assignCountToUser(countId, userId)
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to assign count')
      }
      return result
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
      toast.success('Cycle count assigned successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to assign count: ${error.message}`)
    },
  })

  const unassignCountMutation = useMutation({
    mutationFn: async (countId: string) => {
      const result = await cycleCountService.unassignCount(countId)
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to unassign count')
      }
      return result
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
      toast.success('Cycle count unassigned successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to unassign count: ${error.message}`)
    },
  })

  const { mutateAsync: assignCountMutateAsync } = assignCountMutation
  const { mutateAsync: unassignCountMutateAsync } = unassignCountMutation

  const assignCountToUser = useCallback(
    async (countId: string, userId: string) => {
      await assignCountMutateAsync({ countId, userId })
    },
    [assignCountMutateAsync]
  )

  const unassignCount = useCallback(
    async (countId: string) => {
      await unassignCountMutateAsync(countId)
    },
    [unassignCountMutateAsync]
  )

  const assignNextCount = useCallback(async (userId: string) => {
    return await cycleCountService.assignNextCount(userId)
  }, [])

  // Priority mutations
  const updatePriorityMutation = useMutation({
    mutationFn: async ({
      countId,
      priority,
    }: {
      countId: string
      priority: CycleCountPriority
    }) => {
      const result = await cycleCountService.updateCycleCountPriority(
        countId,
        priority
      )
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to update priority')
      }
      return result
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
      toast.success('Cycle count priority updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update priority: ${error.message}`)
    },
  })

  const { mutateAsync: updatePriorityMutateAsync } = updatePriorityMutation

  const updateCycleCountPriority = useCallback(
    async (countId: string, priority: CycleCountPriority) => {
      await updatePriorityMutateAsync({ countId, priority })
    },
    [updatePriorityMutateAsync]
  )

  return {
    // Data
    data: rawData,
    filteredData,
    statistics,

    // Loading states
    isLoading,
    isLoadingStatistics,
    isImporting,

    // Error states
    error: error as Error | null,
    statisticsError: statisticsError as Error | null,

    // Import functionality
    importProgress,
    importFromClipboard,

    // Search functionality
    searchQuery,
    setSearchQuery,

    // CRUD operations
    createCycleCount,
    createMultipleCycleCounts,
    updateCycleCount,
    deleteCycleCount,
    approveCycleCount,
    markForRecount,
    initiateRecount,
    completeRecount,

    // Assignment operations
    assignCountToUser,
    unassignCount,
    assignNextCount,

    // Priority operations
    updateCycleCountPriority,

    // Utility functions
    refreshData,
    exportToCSV,
  }
}
