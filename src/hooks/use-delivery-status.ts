// Created and developed by Jai Singh
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import {
  deliveryStatusService,
  type DeliveryStatusData,
  type DeliveryStatusInsert,
  type DeliveryStatusStatistics,
  type ImportResult,
  type ImportProgress,
  type ImportProgressCallback,
} from '@/lib/supabase/delivery-status.service'
import { logger } from '@/lib/utils/logger'

// Rust core enabled flag
const RUST_CORE_ENABLED = import.meta.env.VITE_RUST_CORE_ENABLED === 'true'

interface UseDeliveryStatusOptions {
  enableRealtime?: boolean
  searchQuery?: string
  openOnly?: boolean
  includeDeleted?: boolean // Show only deleted deliveries (November 9, 2025)
}

interface UseDeliveryStatusReturn {
  data: DeliveryStatusData[]
  isLoading: boolean
  error: Error | null
  statistics: DeliveryStatusStatistics | null
  importFromClipboard: (
    progressCallback?: ImportProgressCallback
  ) => Promise<ImportResult>
  refreshData: () => void
  isImporting: boolean
  importProgress: ImportProgress | null
  searchQuery: string
  setSearchQuery: (query: string) => void
  updateDeliveryData: (data: {
    id: string
    updates: Partial<DeliveryStatusInsert>
  }) => Promise<void>
  deleteDeliveryData: (id: string) => Promise<void>
  isUsingRust: boolean
}

export function useDeliveryStatus(
  options: UseDeliveryStatusOptions = {}
): UseDeliveryStatusReturn {
  const {
    enableRealtime = true,
    searchQuery: initialSearchQuery = '',
    openOnly = false,
    includeDeleted = false,
  } = options
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const { profile } = authState

  const [searchQuery, setSearchQuery] = useState(initialSearchQuery)
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null
  )

  // Refs for debouncing progress updates
  const latestProgressRef = useRef<ImportProgress | null>(null)
  const progressUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Main data query
  const {
    data: rawData = [],
    isLoading,
    error,
    refetch: refreshData,
  } = useQuery({
    queryKey: [
      'delivery-status',
      searchQuery,
      openOnly,
      includeDeleted,
      profile?.organization_id,
    ],
    queryFn: () => {
      if (searchQuery.trim()) {
        return deliveryStatusService.searchDeliveryData(
          searchQuery,
          100000,
          includeDeleted
        )
      }
      return deliveryStatusService.fetchDeliveryStatusData(
        100000,
        0,
        openOnly,
        includeDeleted
      )
    },
    enabled: !!profile?.organization_id,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: enableRealtime ? 60 * 1000 : false, // Refresh every minute if real-time enabled
  })

  // Statistics query
  const { data: statistics = null } = useQuery({
    queryKey: ['delivery-status-stats', profile?.organization_id],
    queryFn: () => deliveryStatusService.getStatistics(),
    enabled: !!profile?.organization_id,
    staleTime: 2 * 60 * 1000, // 2 minutes
  })

  // Real-time subscription
  useEffect(() => {
    if (!enableRealtime || !profile?.organization_id) return

    let subscription: { unsubscribe: () => void } | null = null

    const setupSubscription = async () => {
      subscription = await deliveryStatusService.subscribeToChanges(
        (payload) => {
          logger.log('Delivery status change:', payload)

          // Invalidate and refetch queries
          queryClient.invalidateQueries({
            queryKey: ['delivery-status'],
          })
          queryClient.invalidateQueries({
            queryKey: ['delivery-status-stats'],
          })

          toast.info('Delivery data updated', {
            description: 'New changes detected and refreshed automatically',
          })
        }
      )
    }

    setupSubscription()

    return () => {
      subscription?.unsubscribe()
    }
  }, [enableRealtime, profile?.organization_id, queryClient])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (progressUpdateTimeoutRef.current) {
        clearTimeout(progressUpdateTimeoutRef.current)
      }
    }
  }, [])

  // Import from clipboard mutation
  const importMutation = useMutation({
    mutationFn: (progressCallback?: ImportProgressCallback) =>
      deliveryStatusService.importFromClipboard(progressCallback),
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({
          queryKey: ['delivery-status'],
        })
        queryClient.invalidateQueries({
          queryKey: ['delivery-status-stats'],
        })
      }
    },
    onError: (error) => {
      toast.error('Import failed', {
        description:
          error instanceof Error ? error.message : 'Unknown error occurred',
      })
    },
    onSettled: () => {
      setIsImporting(false)
      setImportProgress(null)
    },
  })

  // Update delivery mutation
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<DeliveryStatusInsert>
    }) => deliveryStatusService.updateDeliveryData(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['delivery-status'],
      })
      toast.success('Delivery updated successfully')
    },
    onError: (error) => {
      toast.error('Failed to update delivery', {
        description:
          error instanceof Error ? error.message : 'Unknown error occurred',
      })
    },
  })

  // Delete delivery mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deliveryStatusService.deleteDeliveryData(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['delivery-status'],
      })
      queryClient.invalidateQueries({
        queryKey: ['delivery-status-stats'],
      })
      toast.success('Delivery deleted successfully')
    },
    onError: (error) => {
      toast.error('Failed to delete delivery', {
        description:
          error instanceof Error ? error.message : 'Unknown error occurred',
      })
    },
  })

  // Destructure mutateAsync for stable dependency references
  const { mutateAsync: importMutateAsync } = importMutation
  const { mutateAsync: updateMutateAsync } = updateMutation
  const { mutateAsync: deleteMutateAsync } = deleteMutation

  // Import from clipboard function with progress tracking
  const importFromClipboard = useCallback(
    async (
      progressCallback?: ImportProgressCallback
    ): Promise<ImportResult> => {
      setIsImporting(true)
      setImportProgress(null)

      try {
        // Create a progress callback that updates state with debouncing
        const handleProgress = (progress: ImportProgress) => {
          latestProgressRef.current = progress

          // Clear existing timeout
          if (progressUpdateTimeoutRef.current) {
            clearTimeout(progressUpdateTimeoutRef.current)
          }

          // For critical phases, update immediately
          if (
            progress.phase === 'parsing' ||
            progress.phase === 'validating' ||
            progress.phase === 'completed'
          ) {
            setImportProgress(progress)
          } else {
            // For processing/inserting phases, debounce updates to prevent flashing
            progressUpdateTimeoutRef.current = setTimeout(() => {
              if (latestProgressRef.current) {
                setImportProgress(latestProgressRef.current)
              }
            }, 150) // 150ms debounce for smooth updates without flashing
          }

          if (progressCallback) {
            progressCallback(progress)
          }
        }

        const result = await importMutateAsync(handleProgress)
        return result
      } catch (error) {
        const errorResult: ImportResult = {
          success: false,
          totalRows: 0,
          insertedRows: 0,
          duplicateRows: 0,
          errorRows: 0,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
        }
        return errorResult
      }
    },
    [importMutateAsync]
  )

  // Update delivery data function
  const updateDeliveryData = useCallback(
    async (data: { id: string; updates: Partial<DeliveryStatusInsert> }) => {
      await updateMutateAsync(data)
    },
    [updateMutateAsync]
  )

  // Delete delivery data function
  const deleteDeliveryData = useCallback(
    async (id: string) => {
      await deleteMutateAsync(id)
    },
    [deleteMutateAsync]
  )

  // Memoize the final data to prevent unnecessary re-renders
  const data = useMemo(() => rawData || [], [rawData])

  return {
    data,
    isLoading,
    error,
    statistics,
    importFromClipboard,
    refreshData,
    isImporting,
    importProgress,
    searchQuery,
    setSearchQuery,
    updateDeliveryData,
    deleteDeliveryData,
    isUsingRust: RUST_CORE_ENABLED,
  }
}

// Created and developed by Jai Singh
