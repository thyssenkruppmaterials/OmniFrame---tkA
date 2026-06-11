// Created and developed by Jai Singh
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import {
  inboundScanService,
  type InboundScanWithTransfer,
  type InboundScanStatistics,
  type ImportProgress,
  type InboundScanData,
} from '@/lib/supabase/inbound-scan.service'
import { logger } from '@/lib/utils/logger'

export interface UseInboundScansProps {
  enableRealtime?: boolean
  searchQuery?: string
  /** Initial page number (1-based) */
  initialPage?: number
  /** Records per page (default: 25) */
  pageSize?: number
}

export interface UseInboundScansReturn {
  // Data
  data: InboundScanWithTransfer[]
  filteredData: InboundScanWithTransfer[]
  statistics: InboundScanStatistics | null

  // Pagination info (NEW)
  totalRecords: number
  currentPage: number
  totalPages: number
  pageSize: number
  setCurrentPage: (page: number) => void

  // Loading states
  isLoading: boolean
  isFetching: boolean // True when fetching new data (including page changes)
  isPageTransition: boolean // True when showing old data while fetching new page
  isLoadingStatistics: boolean
  isImporting: boolean
  isExporting: boolean // True when exporting all data

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
  createScan: (scanData: Partial<InboundScanData>) => Promise<void>
  updateScan: (id: string, updates: Partial<InboundScanData>) => Promise<void>
  deleteScan: (id: string) => Promise<void>

  // Utility functions
  refreshData: () => void
  exportToCSV: () => string
  exportAllToCSV: () => Promise<{ csv: string; count: number } | null> // Export ALL records (not just current page)

  // Rust service status
  isUsingRust: boolean
}

// Query keys for React Query
const INBOUND_SCANS_QUERY_KEY = 'inbound-scans'
const INBOUND_SCANS_PAGINATED_QUERY_KEY = 'inbound-scans-paginated'
const INBOUND_STATISTICS_QUERY_KEY = 'inbound-statistics'

export function useInboundScans({
  enableRealtime = true,
  searchQuery: initialSearchQuery = '',
  initialPage = 1,
  pageSize: initialPageSize = 25,
}: UseInboundScansProps = {}): UseInboundScansReturn {
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const { user, profile } = authState

  // State for search, pagination, import, and export
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery)
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [pageSize] = useState(initialPageSize)
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null
  )
  const [isExporting, setIsExporting] = useState(false)

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery])

  // Query for fetching inbound scans with SERVER-SIDE pagination (FAST)
  const {
    data: paginatedResult,
    isLoading,
    isFetching, // True when fetching (including background refetches)
    isPlaceholderData, // True when showing previous data while fetching new
    error,
    refetch: refetchScans,
  } = useQuery({
    queryKey: [
      INBOUND_SCANS_PAGINATED_QUERY_KEY,
      user?.id,
      currentPage,
      pageSize,
      searchQuery,
    ],
    queryFn: async () => {
      const startTime = performance.now()

      // Use the paginated method for fast server-side pagination
      const result = await inboundScanService.fetchInboundScansPaginated({
        page: currentPage,
        pageSize,
        search: searchQuery,
      })

      const elapsed = performance.now() - startTime
      logger.log(
        `⚡ Inbound scans fetched in ${elapsed.toFixed(0)}ms (page ${currentPage}, ${result.data.length} records)`
      )

      if (result.error) {
        throw new Error(
          `Failed to fetch inbound scans: ${result.error.message}`
        )
      }
      return result
    },
    enabled: !!user,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    // Keep showing previous data while fetching new page (smoother UX)
    placeholderData: keepPreviousData,
  })

  // Extract data from paginated result
  const rawData = useMemo<InboundScanWithTransfer[]>(
    () => (paginatedResult?.data || []) as InboundScanWithTransfer[],
    [paginatedResult]
  )
  const totalRecords = paginatedResult?.total || 0
  const totalPages = paginatedResult?.totalPages || 0

  // Query for fetching statistics (fetched in PARALLEL, non-blocking)
  const {
    data: statistics = null,
    isLoading: isLoadingStatistics,
    error: statisticsError,
    refetch: refetchStatistics,
  } = useQuery({
    queryKey: [INBOUND_STATISTICS_QUERY_KEY, user?.id],
    queryFn: async () => {
      const { statistics, error } = await inboundScanService.fetchStatistics()
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

  // filteredData is now the same as rawData since filtering is done server-side
  const filteredData = rawData

  // Real-time subscription effect
  useEffect(() => {
    if (!enableRealtime || !user) return

    logger.log('🔄 Setting up real-time subscription for inbound scans')

    const invalidateAll = () => {
      queryClient.invalidateQueries({ queryKey: [INBOUND_SCANS_QUERY_KEY] })
      queryClient.invalidateQueries({
        queryKey: [INBOUND_SCANS_PAGINATED_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [INBOUND_STATISTICS_QUERY_KEY],
      })
    }

    const channel = supabase
      .channel('inbound-scans-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rr_inbound_scans',
        },
        (payload) => {
          logger.log('📡 Inbound scan real-time update:', payload)

          invalidateAll()

          if (payload.eventType === 'INSERT') {
            toast.success('New inbound scan added')
          } else if (payload.eventType === 'UPDATE') {
            toast.info('Inbound scan updated')
          } else if (payload.eventType === 'DELETE') {
            toast.info('Inbound scan deleted')
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rr_inbound_part_transfers',
        },
        (payload) => {
          logger.log('📡 Inbound part transfer real-time update:', payload)
          invalidateAll()
        }
      )
      .subscribe()

    return () => {
      logger.log('🔄 Cleaning up inbound scans real-time subscription')
      supabase.removeChannel(channel)
    }
  }, [enableRealtime, user, queryClient])

  // Mutation for creating scans
  const createMutation = useMutation({
    mutationFn: async (scanData: Partial<InboundScanData>) => {
      if (!user) throw new Error('User not authenticated')

      const dataWithUser = {
        ...scanData,
        scanned_by: user.id,
        organization_id: profile?.organization_id || '',
        scanned_at: new Date().toISOString(),
      }

      const { data, error } = await inboundScanService.createScan(dataWithUser)
      if (error) throw new Error(`Failed to create scan: ${error.message}`)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [INBOUND_SCANS_QUERY_KEY] })
      queryClient.invalidateQueries({
        queryKey: [INBOUND_SCANS_PAGINATED_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [INBOUND_STATISTICS_QUERY_KEY],
      })
      toast.success('Inbound scan created successfully')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create scan'
      )
    },
  })

  // Mutation for updating scans
  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<InboundScanData>
    }) => {
      const { data, error } = await inboundScanService.updateScan(id, updates)
      if (error) throw new Error(`Failed to update scan: ${error.message}`)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [INBOUND_SCANS_QUERY_KEY] })
      queryClient.invalidateQueries({
        queryKey: [INBOUND_SCANS_PAGINATED_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [INBOUND_STATISTICS_QUERY_KEY],
      })
      toast.success('Inbound scan updated successfully')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update scan'
      )
    },
  })

  // Mutation for deleting scans
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { success, error } = await inboundScanService.deleteScan(id)
      if (!success)
        throw new Error(
          `Failed to delete scan: ${error?.message || 'Unknown error'}`
        )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [INBOUND_SCANS_QUERY_KEY] })
      queryClient.invalidateQueries({
        queryKey: [INBOUND_SCANS_PAGINATED_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [INBOUND_STATISTICS_QUERY_KEY],
      })
      toast.success('Inbound scan deleted successfully')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to delete scan'
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
      const importGenerator = inboundScanService.importFromClipboard(
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
            `Import completed! ${successCount} scans imported${hasErrors ? ` (${lastResult.errors.length} errors)` : ''}`,
            { duration: 8000 }
          )

          // Refresh data after successful import
          queryClient.invalidateQueries({ queryKey: [INBOUND_SCANS_QUERY_KEY] })
          queryClient.invalidateQueries({
            queryKey: [INBOUND_SCANS_PAGINATED_QUERY_KEY],
          })
          queryClient.invalidateQueries({
            queryKey: [INBOUND_STATISTICS_QUERY_KEY],
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
    refetchScans()
    refetchStatistics()
  }, [refetchScans, refetchStatistics])

  const exportToCSV = useCallback(() => {
    return inboundScanService.exportToCSV(filteredData)
  }, [filteredData])

  // Export ALL records (not just current page) with optional search filter
  const exportAllToCSV = useCallback(async (): Promise<{
    csv: string
    count: number
  } | null> => {
    setIsExporting(true)
    try {
      // Fetch ALL data matching the current search query
      const { data, total, error } = await inboundScanService.fetchAllForExport(
        searchQuery || undefined
      )

      if (error) {
        toast.error('Failed to fetch data for export')
        logger.error('Export fetch error:', error)
        return null
      }

      if (data.length === 0) {
        toast.warning('No data to export')
        return null
      }

      const csv = inboundScanService.exportToCSV(data)
      return { csv, count: total }
    } catch (error) {
      toast.error('Export failed')
      logger.error('Export error:', error)
      return null
    } finally {
      setIsExporting(false)
    }
  }, [searchQuery])

  // Destructure mutateAsync for stable dependency references
  const { mutateAsync: createMutateAsync } = createMutation
  const { mutateAsync: updateMutateAsync } = updateMutation
  const { mutateAsync: deleteMutateAsync } = deleteMutation

  // CRUD operation wrappers
  const createScan = useCallback(
    async (scanData: Partial<InboundScanData>) => {
      await createMutateAsync(scanData)
    },
    [createMutateAsync]
  )

  const updateScan = useCallback(
    async (id: string, updates: Partial<InboundScanData>) => {
      await updateMutateAsync({ id, updates })
    },
    [updateMutateAsync]
  )

  const deleteScan = useCallback(
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

    // Pagination info (NEW - for server-side pagination)
    totalRecords,
    currentPage,
    totalPages,
    pageSize,
    setCurrentPage,

    // Loading states
    isLoading,
    isFetching, // True when any fetch is in progress
    isPageTransition: isFetching && isPlaceholderData, // True when showing old data while fetching new
    isLoadingStatistics,
    isImporting,
    isExporting,

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
    createScan,
    updateScan,
    deleteScan,

    // Utility functions
    refreshData,
    exportToCSV,
    exportAllToCSV,

    // Rust service status
    isUsingRust: inboundScanService.isUsingRust(),
  }
}

// Created and developed by Jai Singh
