import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import {
  putawayLogService,
  type PutawayOperationsWithUser,
  type PutawayLogStatistics,
  type ImportProgress,
  type PutawayOperationData,
} from '@/lib/supabase/putaway-log.service'
import { logger } from '@/lib/utils/logger'

export interface UsePutawayOperationsProps {
  enableRealtime?: boolean
  searchQuery?: string
}

export interface UsePutawayOperationsReturn {
  // Data
  data: PutawayOperationsWithUser
  filteredData: PutawayOperationsWithUser
  statistics: PutawayLogStatistics | null

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
  createPutawayOperation: (
    operationData: Partial<PutawayOperationData>
  ) => Promise<void>
  updatePutawayOperation: (
    id: string,
    updates: Partial<PutawayOperationData>
  ) => Promise<void>
  deletePutawayOperation: (id: string) => Promise<void>

  // Utility functions
  refreshData: () => void
  exportToCSV: () => string

  // Rust service status
  isUsingRust: boolean
}

// Query keys for React Query
const PUTAWAY_OPERATIONS_QUERY_KEY = 'putaway-operations'
const PUTAWAY_STATISTICS_QUERY_KEY = 'putaway-statistics'

export function usePutawayOperations({
  enableRealtime = true,
  searchQuery: initialSearchQuery = '',
}: UsePutawayOperationsProps = {}): UsePutawayOperationsReturn {
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const { user, profile } = authState

  // State for search and import
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery)
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null
  )

  // Query for fetching putaway operations
  const {
    data: rawData = [],
    isLoading,
    error,
    refetch: refetchOperations,
  } = useQuery({
    queryKey: [PUTAWAY_OPERATIONS_QUERY_KEY, user?.id],
    queryFn: async () => {
      const { data, error } = await putawayLogService.fetchPutawayOperations()
      if (error) {
        throw new Error(`Failed to fetch putaway operations: ${error.message}`)
      }
      return data
    },
    enabled: !!user,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  })

  // Query for fetching statistics
  const {
    data: statistics = null,
    isLoading: isLoadingStatistics,
    error: statisticsError,
    refetch: refetchStatistics,
  } = useQuery({
    queryKey: [PUTAWAY_STATISTICS_QUERY_KEY, user?.id],
    queryFn: async () => {
      const { statistics, error } = await putawayLogService.fetchStatistics()
      if (error) {
        logger.warn('Statistics fetch error:', error)
        return null
      }
      return statistics
    },
    enabled: !!user,
    staleTime: 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes
  })

  // Filter data based on search query
  const filteredData = useCallback(() => {
    if (!rawData) return []
    return putawayLogService.filterPutawayOperations(rawData, searchQuery)
  }, [rawData, searchQuery])()

  // Real-time subscription effect
  useEffect(() => {
    if (!enableRealtime || !user) return

    logger.log('🔄 Setting up real-time subscription for putaway operations')

    const channel = supabase
      .channel('putaway-operations-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rf_putaway_operations',
        },
        (payload) => {
          logger.log('📡 Putaway operations real-time update:', payload)

          // Invalidate and refetch queries on any change
          queryClient.invalidateQueries({
            queryKey: [PUTAWAY_OPERATIONS_QUERY_KEY],
          })
          queryClient.invalidateQueries({
            queryKey: [PUTAWAY_STATISTICS_QUERY_KEY],
          })

          // Show toast notifications for changes
          if (payload.eventType === 'INSERT') {
            toast.success('New putaway operation added')
          } else if (payload.eventType === 'UPDATE') {
            toast.info('Putaway operation updated')
          } else if (payload.eventType === 'DELETE') {
            toast.info('Putaway operation deleted')
          }
        }
      )
      .subscribe()

    return () => {
      logger.log('🔄 Cleaning up putaway operations real-time subscription')
      supabase.removeChannel(channel)
    }
  }, [enableRealtime, user, queryClient])

  // Mutation for creating putaway operations
  const createMutation = useMutation({
    mutationFn: async (operationData: Partial<PutawayOperationData>) => {
      if (!user) throw new Error('User not authenticated')

      const dataWithUser = {
        ...operationData,
        created_by: user.id,
        organization_id: profile?.organization_id || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const { data, error } =
        await putawayLogService.createPutawayOperation(dataWithUser)
      if (error)
        throw new Error(`Failed to create putaway operation: ${error.message}`)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [PUTAWAY_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [PUTAWAY_STATISTICS_QUERY_KEY],
      })
      toast.success('Putaway operation created successfully')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to create putaway operation'
      )
    },
  })

  // Mutation for updating putaway operations
  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<PutawayOperationData>
    }) => {
      const { data, error } = await putawayLogService.updatePutawayOperation(
        id,
        updates
      )
      if (error)
        throw new Error(`Failed to update putaway operation: ${error.message}`)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [PUTAWAY_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [PUTAWAY_STATISTICS_QUERY_KEY],
      })
      toast.success('Putaway operation updated successfully')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to update putaway operation'
      )
    },
  })

  // Mutation for deleting putaway operations
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { success, error } =
        await putawayLogService.deletePutawayOperation(id)
      if (!success)
        throw new Error(
          `Failed to delete putaway operation: ${error?.message || 'Unknown error'}`
        )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [PUTAWAY_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [PUTAWAY_STATISTICS_QUERY_KEY],
      })
      toast.success('Putaway operation deleted successfully')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to delete putaway operation'
      )
    },
  })

  // Import from clipboard functionality
  const importFromClipboard = useCallback(async () => {
    if (!user) {
      toast.error('User not authenticated')
      return
    }

    setIsImporting(true)
    setImportProgress(null)

    try {
      const importGenerator = putawayLogService.importFromClipboard(
        (progress) => {
          setImportProgress(progress)
        }
      )

      let lastResult = null
      for await (const result of importGenerator) {
        lastResult = result

        if (result.errors.length > 0) {
          // Show first few errors as warnings
          result.errors.slice(0, 3).forEach((error) => {
            toast.warning(error, { duration: 5000 })
          })
        }
      }

      if (lastResult) {
        const successCount = lastResult.processed - lastResult.errors.length
        const hasErrors = lastResult.errors.length > 0

        if (successCount > 0) {
          toast.success(
            `Import completed! ${successCount} putaway operations imported${hasErrors ? ` (${lastResult.errors.length} errors)` : ''}`,
            { duration: 8000 }
          )

          // Refresh data after successful import
          queryClient.invalidateQueries({
            queryKey: [PUTAWAY_OPERATIONS_QUERY_KEY],
          })
          queryClient.invalidateQueries({
            queryKey: [PUTAWAY_STATISTICS_QUERY_KEY],
          })
        } else {
          toast.error('Import failed - no valid data processed')
        }
      }
    } catch (error) {
      logger.error('Import error:', error)
      toast.error(error instanceof Error ? error.message : 'Import failed')
    } finally {
      setIsImporting(false)

      // Auto-hide progress after completion
      setTimeout(() => {
        setImportProgress(null)
      }, 3000)
    }
  }, [user, queryClient])

  // Utility functions
  const refreshData = useCallback(() => {
    refetchOperations()
    refetchStatistics()
  }, [refetchOperations, refetchStatistics])

  const exportToCSV = useCallback(() => {
    return putawayLogService.exportToCSV(filteredData)
  }, [filteredData])

  // Destructure mutateAsync for stable dependency references
  const { mutateAsync: createMutateAsync } = createMutation
  const { mutateAsync: updateMutateAsync } = updateMutation
  const { mutateAsync: deleteMutateAsync } = deleteMutation

  // CRUD operation wrappers
  const createPutawayOperation = useCallback(
    async (operationData: Partial<PutawayOperationData>) => {
      await createMutateAsync(operationData)
    },
    [createMutateAsync]
  )

  const updatePutawayOperation = useCallback(
    async (id: string, updates: Partial<PutawayOperationData>) => {
      await updateMutateAsync({ id, updates })
    },
    [updateMutateAsync]
  )

  const deletePutawayOperation = useCallback(
    async (id: string) => {
      await deleteMutateAsync(id)
    },
    [deleteMutateAsync]
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
    createPutawayOperation,
    updatePutawayOperation,
    deletePutawayOperation,

    // Utility functions
    refreshData,
    exportToCSV,

    // Rust service status
    isUsingRust: putawayLogService.isUsingRust(),
  }
}
