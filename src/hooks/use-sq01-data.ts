// Created and developed by Jai Singh
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import {
  SQ01DataService,
  type SQ01Data,
  type ImportResult,
  type ImportProgress,
  type ImportProgressCallback,
} from '@/lib/supabase/sq01-data.service'
import { logger } from '@/lib/utils/logger'

interface UseSQ01DataOptions {
  enableRealtime?: boolean
  searchQuery?: string
  scannedOnly?: boolean // Only fetch records with grs_location_scan_completed_at
}

export function useSQ01Data({
  enableRealtime = true,
  searchQuery = '',
  scannedOnly = false,
}: UseSQ01DataOptions = {}) {
  const queryClient = useQueryClient()
  const [isImporting, setIsImporting] = useState(false)
  const [searchQueryState, setSearchQueryState] = useState(searchQuery)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null
  )
  const [showProgressDialog, setShowProgressDialog] = useState(false)

  const sq01Service = SQ01DataService.getInstance()

  // Main data query - optimized for large datasets
  const {
    data: rawData = [],
    isLoading,
    error,
    refetch: refreshData,
  } = useQuery({
    queryKey: ['sq01-data', scannedOnly, searchQuery],
    queryFn: async () => {
      if (scannedOnly) {
        // If search query exists, use database-level search
        if (searchQuery && searchQuery.trim()) {
          logger.log('🔄 HOOK: Executing SCANNED SQ01 data SEARCH...')
          const result = await sq01Service.searchScannedSQ01Data(searchQuery)
          logger.log(
            `🎯 HOOK: Received ${result.length} matching scanned records from search`
          )
          return result
        } else {
          logger.log('🔄 HOOK: Executing SCANNED SQ01 data fetch...')
          const result = await sq01Service.fetchScannedSQ01Data()
          logger.log(
            `🎯 HOOK: Received ${result.length} scanned records from service`
          )
          logger.log(
            '🔍 HOOK: Sample record structure:',
            result[0] ? Object.keys(result[0]) : 'No records'
          )
          return result
        }
      } else {
        logger.log('🔄 HOOK: Executing ALL SQ01 data fetch...')
        const result = await sq01Service.fetchSQ01Data()
        logger.log(`🎯 HOOK: Received ${result.length} records from service`)
        logger.log(
          '🔍 HOOK: Sample record structure:',
          result[0] ? Object.keys(result[0]) : 'No records'
        )
        return result
      }
    },
    refetchInterval: enableRealtime ? 60000 : false, // Slower refresh for large datasets (60 seconds)
    staleTime: 30000, // Data stays fresh longer for large datasets (30 seconds)
    retry: 3,
    gcTime: 5 * 60 * 1000, // Keep data cached for 5 minutes to avoid refetching large datasets
  })

  // Statistics query
  const { data: statistics, isLoading: isLoadingStats } = useQuery({
    queryKey: ['sq01-statistics-controlled'], // v8 cache key - controlled sequential chunking
    queryFn: async () => {
      logger.log('📈 HOOK: Executing SQ01 statistics calculation...')
      const result = await sq01Service.getStatistics()
      logger.log(`📊 HOOK: Received statistics:`, result)
      return result
    },
    refetchInterval: enableRealtime ? 60000 : false, // Refetch every minute
    staleTime: 30000, // Statistics can be a bit more stale
  })

  // Set up realtime subscription
  useEffect(() => {
    if (!enableRealtime) return

    const channel = supabase
      .channel('sq01-data-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rr_sq01_data',
        },
        (payload) => {
          logger.log('SQ01 data changed:', payload)

          // Invalidate and refetch data with new cache keys
          queryClient.invalidateQueries({ queryKey: ['sq01-data-controlled'] })
          queryClient.invalidateQueries({ queryKey: ['sq01-data-scanned'] })
          queryClient.invalidateQueries({
            queryKey: ['sq01-statistics-controlled'],
          })

          // Show notification based on event type
          switch (payload.eventType) {
            case 'INSERT':
              toast.success('New SQ01 record added')
              break
            case 'UPDATE':
              toast.info('SQ01 record updated')
              break
            case 'DELETE':
              toast.info('SQ01 record deleted')
              break
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [enableRealtime, queryClient])

  // For scannedOnly mode, search is done at database level, so no client-side filtering needed
  // For all data mode, still use client-side filtering for backward compatibility
  const data = useMemo(() => {
    logger.log(`🎯 HOOK: Processing rawData with ${rawData.length} records`)
    logger.log(`🔍 HOOK: Search query: "${searchQueryState}"`)
    logger.log(`🔍 HOOK: Scanned only mode: ${scannedOnly}`)

    // If scannedOnly is true, search is already done at database level
    if (scannedOnly) {
      logger.log(
        `✅ HOOK: Scanned-only mode - using database-level search results (${rawData.length} records)`
      )
      return rawData
    }

    // For all data mode, use client-side filtering
    if (!searchQueryState.trim()) {
      logger.log(`✅ HOOK: No search, returning all ${rawData.length} records`)
      return rawData
    }

    const query = searchQueryState.toLowerCase()
    const filtered = rawData.filter(
      (item: SQ01Data) =>
        item.material?.toLowerCase().includes(query) ||
        item.plant?.toLowerCase().includes(query) ||
        item.sloc?.toLowerCase().includes(query) ||
        item.batch?.toLowerCase().includes(query) ||
        item.material_description?.toLowerCase().includes(query) ||
        item.serial_number?.toLowerCase().includes(query) ||
        item.val_type?.toLowerCase().includes(query) ||
        item.conf_cert_ref?.toLowerCase().includes(query) ||
        item.general_info?.toLowerCase().includes(query)
    )

    logger.log(`📋 HOOK: Filtered to ${filtered.length} records`)
    return filtered
  }, [rawData, searchQueryState, scannedOnly])

  // Ref to store the latest progress update for debouncing
  const latestProgressRef = useRef<ImportProgress | null>(null)
  const progressUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Progress callback for large dataset imports - debounced to prevent flashing
  const handleImportProgress = useCallback<ImportProgressCallback>(
    (progress) => {
      latestProgressRef.current = progress

      // Clear existing timeout
      if (progressUpdateTimeoutRef.current) {
        clearTimeout(progressUpdateTimeoutRef.current)
      }

      // For critical phases, update immediately
      if (
        progress.phase === 'parsing' ||
        progress.phase === 'validating' ||
        progress.phase === 'clearing' ||
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

      // Auto-close progress dialog after completion
      if (progress.phase === 'completed') {
        setTimeout(() => {
          setShowProgressDialog(false)
          setImportProgress(null)
        }, 3000) // Show completed state for 3 seconds
      }
    },
    []
  )

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (progressUpdateTimeoutRef.current) {
        clearTimeout(progressUpdateTimeoutRef.current)
      }
    }
  }, [])

  // Import from clipboard with large dataset support
  const importFromClipboard = useCallback(async (): Promise<ImportResult> => {
    setIsImporting(true)
    setShowProgressDialog(true)

    try {
      const result = await sq01Service.importFromClipboard(handleImportProgress)

      if (result.success) {
        // Refresh data after successful import
        await queryClient.invalidateQueries({
          queryKey: ['sq01-data-controlled'],
        })
        await queryClient.invalidateQueries({
          queryKey: ['sq01-statistics-controlled'],
        })
      }

      return result
    } catch (error) {
      logger.error('Import failed:', error)
      toast.error(
        `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      setShowProgressDialog(false)
      setImportProgress(null)
      throw error
    } finally {
      setIsImporting(false)
    }
  }, [sq01Service, queryClient, handleImportProgress])

  // Delete record
  const deleteRecord = useCallback(
    async (id: string) => {
      try {
        await sq01Service.deleteSQ01Data(id)
        toast.success('Record deleted successfully')

        // Refresh data
        queryClient.invalidateQueries({ queryKey: ['sq01-data-controlled'] })
        queryClient.invalidateQueries({
          queryKey: ['sq01-statistics-controlled'],
        })
      } catch (error) {
        logger.error('Delete failed:', error)
        toast.error('Failed to delete record')
        throw error
      }
    },
    [sq01Service, queryClient]
  )

  // Clear all data
  const clearAllData = useCallback(async () => {
    try {
      await sq01Service.clearAllSQ01Data(true) // Show toast for manual clear

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['sq01-data-controlled'] })
      queryClient.invalidateQueries({
        queryKey: ['sq01-statistics-controlled'],
      })
    } catch (error) {
      logger.error('Clear all failed:', error)
      throw error
    }
  }, [sq01Service, queryClient])

  // Update search query
  const setSearchQuery = useCallback((query: string) => {
    setSearchQueryState(query)
  }, [])

  return {
    data,
    isLoading,
    error,
    statistics,
    isLoadingStats,
    isImporting,
    importProgress,
    showProgressDialog,
    setShowProgressDialog,
    refreshData,
    importFromClipboard,
    deleteRecord,
    clearAllData,
    searchQuery: searchQueryState,
    setSearchQuery,
    // Rust service status
    isUsingRust: sq01Service.isUsingRust(),
  }
}

// Created and developed by Jai Singh
