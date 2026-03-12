import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import {
  grsGripProcessingService,
  type GRSGRIPProcessingData,
  type GRSGRIPProcessingStatistics,
  type GRSGRIPProcessingWithUser,
  type ImportProgress,
} from '@/lib/supabase/grs-grip-processing.service'
import { logger } from '@/lib/utils/logger'

export interface UseGRSGRIPProcessingProps {
  enableRealtime?: boolean
  searchQuery?: string
}

export interface UseGRSGRIPProcessingReturn {
  // Data
  data: GRSGRIPProcessingWithUser
  filteredData: GRSGRIPProcessingWithUser
  statistics: GRSGRIPProcessingStatistics | null

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
  createGRSGRIPProcessingOperation: (
    operationData: Partial<GRSGRIPProcessingData>
  ) => Promise<void>
  updateGRSGRIPProcessingOperation: (
    id: string,
    updates: Partial<GRSGRIPProcessingData>
  ) => Promise<void>
  deleteGRSGRIPProcessingOperation: (id: string) => Promise<void>

  // Utility functions
  refreshData: () => void
  exportToCSV: () => string
}

// Query keys for React Query
const GRS_GRIP_PROCESSING_QUERY_KEY = 'grs-grip-processing-operations'
const GRS_GRIP_STATISTICS_QUERY_KEY = 'grs-grip-processing-statistics'

export function useGRSGRIPProcessing({
  enableRealtime = true,
  searchQuery: initialSearchQuery = '',
}: UseGRSGRIPProcessingProps = {}): UseGRSGRIPProcessingReturn {
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const { user, profile } = authState

  // State for search and import
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery)
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null
  )

  // Query for fetching GRS GRIP processing operations
  const {
    data: rawData = [],
    isLoading,
    error,
    refetch: refetchOperations,
  } = useQuery({
    queryKey: [GRS_GRIP_PROCESSING_QUERY_KEY, user?.id],
    queryFn: async () => {
      const { data, error } =
        await grsGripProcessingService.fetchGRSGRIPProcessingOperations()
      if (error) {
        throw new Error(
          `Failed to fetch GRS GRIP processing operations: ${error.message}`
        )
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
    queryKey: [GRS_GRIP_STATISTICS_QUERY_KEY, user?.id],
    queryFn: async () => {
      const { statistics, error } =
        await grsGripProcessingService.fetchStatistics()
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
    return grsGripProcessingService.searchGRSGRIPProcessingOperations(
      rawData,
      searchQuery
    )
  }, [rawData, searchQuery])()

  // Real-time subscription effect
  useEffect(() => {
    if (!enableRealtime || !user) return

    logger.log(
      '🔄 Setting up real-time subscription for GRS GRIP processing operations'
    )

    const channel = supabase
      .channel('grs-grip-processing-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rr_grsgrip_processing',
        },
        (payload) => {
          logger.log('📡 GRS GRIP processing real-time update:', payload)

          // Invalidate and refetch queries on any change
          queryClient.invalidateQueries({
            queryKey: [GRS_GRIP_PROCESSING_QUERY_KEY],
          })
          queryClient.invalidateQueries({
            queryKey: [GRS_GRIP_STATISTICS_QUERY_KEY],
          })

          // Show toast notifications for changes
          if (payload.eventType === 'INSERT') {
            toast.success('New GRS GRIP processing operation added')
          } else if (payload.eventType === 'UPDATE') {
            toast.info('GRS GRIP processing operation updated')
          } else if (payload.eventType === 'DELETE') {
            toast.info('GRS GRIP processing operation deleted')
          }
        }
      )
      .subscribe()

    return () => {
      logger.log('🔄 Cleaning up GRS GRIP processing real-time subscription')
      supabase.removeChannel(channel)
    }
  }, [enableRealtime, user, queryClient])

  // Mutation for creating GRS GRIP processing operations
  const createMutation = useMutation({
    mutationFn: async (operationData: Partial<GRSGRIPProcessingData>) => {
      if (!user) throw new Error('User not authenticated')
      if (!operationData) throw new Error('Operation data is required')

      const dataWithUser = {
        ...operationData,
        created_by: user.id,
        organization_id: profile?.organization_id || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        processing_started_at: new Date().toISOString(),
      }

      const { data, error } =
        await grsGripProcessingService.createGRSGRIPProcessingOperation(
          dataWithUser
        )
      if (error)
        throw new Error(
          `Failed to create GRS GRIP processing operation: ${error.message}`
        )
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [GRS_GRIP_PROCESSING_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [GRS_GRIP_STATISTICS_QUERY_KEY],
      })
      toast.success('GRS GRIP processing operation created successfully')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to create GRS GRIP processing operation'
      )
    },
  })

  // Mutation for updating GRS GRIP processing operations
  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<GRSGRIPProcessingData>
    }) => {
      const { data, error } =
        await grsGripProcessingService.updateGRSGRIPProcessingOperation(
          id,
          updates
        )
      if (error)
        throw new Error(
          `Failed to update GRS GRIP processing operation: ${error.message}`
        )
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [GRS_GRIP_PROCESSING_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [GRS_GRIP_STATISTICS_QUERY_KEY],
      })
      toast.success('GRS GRIP processing operation updated successfully')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to update GRS GRIP processing operation'
      )
    },
  })

  // Mutation for deleting GRS GRIP processing operations
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { success, error } =
        await grsGripProcessingService.deleteGRSGRIPProcessingOperation(id)
      if (!success)
        throw new Error(
          `Failed to delete GRS GRIP processing operation: ${error?.message || 'Unknown error'}`
        )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [GRS_GRIP_PROCESSING_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [GRS_GRIP_STATISTICS_QUERY_KEY],
      })
      toast.success('GRS GRIP processing operation deleted successfully')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to delete GRS GRIP processing operation'
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
      const importGenerator = grsGripProcessingService.importFromClipboard(
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
            `Import completed! ${successCount} GRS GRIP processing operations imported${hasErrors ? ` (${lastResult.errors.length} errors)` : ''}`,
            { duration: 8000 }
          )

          // Refresh data after successful import
          queryClient.invalidateQueries({
            queryKey: [GRS_GRIP_PROCESSING_QUERY_KEY],
          })
          queryClient.invalidateQueries({
            queryKey: [GRS_GRIP_STATISTICS_QUERY_KEY],
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
    return grsGripProcessingService.exportToCSV(filteredData)
  }, [filteredData])

  // Destructure mutateAsync for stable dependency references
  const { mutateAsync: createMutateAsync } = createMutation
  const { mutateAsync: updateMutateAsync } = updateMutation
  const { mutateAsync: deleteMutateAsync } = deleteMutation

  // CRUD operation wrappers
  const createGRSGRIPProcessingOperation = useCallback(
    async (operationData: Partial<GRSGRIPProcessingData>) => {
      await createMutateAsync(operationData)
    },
    [createMutateAsync]
  )

  const updateGRSGRIPProcessingOperation = useCallback(
    async (id: string, updates: Partial<GRSGRIPProcessingData>) => {
      await updateMutateAsync({ id, updates })
    },
    [updateMutateAsync]
  )

  const deleteGRSGRIPProcessingOperation = useCallback(
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
    createGRSGRIPProcessingOperation,
    updateGRSGRIPProcessingOperation,
    deleteGRSGRIPProcessingOperation,

    // Utility functions
    refreshData,
    exportToCSV,
  }
}
