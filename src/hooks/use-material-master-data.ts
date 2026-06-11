// Created and developed by Jai Singh
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import {
  MaterialMasterDataService,
  type MaterialMasterData,
  type ImportResult,
  type ImportProgress,
  type ImportProgressCallback,
} from '@/lib/supabase/material-master-data.service'
import { logger } from '@/lib/utils/logger'

interface UseMaterialMasterDataOptions {
  enableRealtime?: boolean
  searchQuery?: string
}

export function useMaterialMasterData({
  enableRealtime = true,
  searchQuery = '',
}: UseMaterialMasterDataOptions = {}) {
  const queryClient = useQueryClient()
  const [isImporting, setIsImporting] = useState(false)
  const [searchQueryState, setSearchQueryState] = useState(searchQuery)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null
  )
  const [showProgressDialog, setShowProgressDialog] = useState(false)

  const materialMasterService = MaterialMasterDataService.getInstance()

  // Main data query - optimized for large datasets
  const {
    data: rawData = [],
    isLoading,
    error,
    refetch: refreshData,
  } = useQuery({
    queryKey: ['material-master-data-controlled'], // Controlled sequential chunking
    queryFn: async () => {
      logger.log('🔄 HOOK: Executing Material Master data fetch...')
      const result = await materialMasterService.fetchMaterialMasterData()
      logger.log(`🎯 HOOK: Received ${result.length} records from service`)
      logger.log(
        '🔍 HOOK: Sample record structure:',
        result[0] ? Object.keys(result[0]) : 'No records'
      )
      return result
    },
    refetchInterval: enableRealtime ? 60000 : false, // Slower refresh for large datasets (60 seconds)
    staleTime: 30000, // Data stays fresh longer for large datasets (30 seconds)
    retry: 3,
    gcTime: 5 * 60 * 1000, // Keep data cached for 5 minutes to avoid refetching large datasets
  })

  // Statistics query
  const { data: statistics, isLoading: isLoadingStats } = useQuery({
    queryKey: ['material-master-statistics-controlled'], // Controlled sequential chunking
    queryFn: async () => {
      logger.log('📈 HOOK: Executing Material Master statistics calculation...')
      const result = await materialMasterService.getStatistics()
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
      .channel('material-master-data-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rr_mlgt_data',
        },
        (payload) => {
          logger.log('Material Master data changed:', payload)

          // Invalidate and refetch data with new cache keys
          queryClient.invalidateQueries({
            queryKey: ['material-master-data-controlled'],
          })
          queryClient.invalidateQueries({
            queryKey: ['material-master-statistics-controlled'],
          })

          // Show notification based on event type
          switch (payload.eventType) {
            case 'INSERT':
              toast.success('New Material Master record added')
              break
            case 'UPDATE':
              toast.info('Material Master record updated')
              break
            case 'DELETE':
              toast.info('Material Master record deleted')
              break
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [enableRealtime, queryClient])

  // Filter data based on search query
  const data = useMemo(() => {
    logger.log(`🎯 HOOK: Processing rawData with ${rawData.length} records`)
    logger.log(`🔍 HOOK: Search query: "${searchQueryState}"`)

    if (!searchQueryState.trim()) {
      logger.log(`✅ HOOK: No search, returning all ${rawData.length} records`)
      return rawData
    }

    const query = searchQueryState.toLowerCase()
    const filtered = rawData.filter(
      (item: MaterialMasterData) =>
        item.material?.toLowerCase().includes(query) ||
        item.warehouse_number?.toLowerCase().includes(query) ||
        item.storage_type?.toLowerCase().includes(query) ||
        item.storage_bin?.toLowerCase().includes(query) ||
        item.crl_status?.toLowerCase().includes(query)
    )

    logger.log(`📋 HOOK: Filtered to ${filtered.length} records`)
    return filtered
  }, [rawData, searchQueryState])

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
        progress.phase === 'completed'
      ) {
        setImportProgress(progress)
      } else {
        // For processing/upserting phases, debounce updates to prevent flashing
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

  // Import from clipboard with large dataset support and UPSERT logic
  const importFromClipboard = useCallback(async (): Promise<ImportResult> => {
    setIsImporting(true)
    setShowProgressDialog(true)

    try {
      const result =
        await materialMasterService.importFromClipboard(handleImportProgress)

      if (result.success) {
        // Refresh data after successful import
        await queryClient.invalidateQueries({
          queryKey: ['material-master-data-controlled'],
        })
        await queryClient.invalidateQueries({
          queryKey: ['material-master-statistics-controlled'],
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
  }, [materialMasterService, queryClient, handleImportProgress])

  // Delete record
  const deleteRecord = useCallback(
    async (id: string) => {
      try {
        await materialMasterService.deleteMaterialMasterData(id)
        toast.success('Record deleted successfully')

        // Refresh data
        queryClient.invalidateQueries({
          queryKey: ['material-master-data-controlled'],
        })
        queryClient.invalidateQueries({
          queryKey: ['material-master-statistics-controlled'],
        })
      } catch (error) {
        logger.error('Delete failed:', error)
        toast.error('Failed to delete record')
        throw error
      }
    },
    [materialMasterService, queryClient]
  )

  // Clear all data (used sparingly)
  const clearAllData = useCallback(async () => {
    try {
      await materialMasterService.clearAllMaterialMasterData(true) // Show toast for manual clear

      // Refresh data
      queryClient.invalidateQueries({
        queryKey: ['material-master-data-controlled'],
      })
      queryClient.invalidateQueries({
        queryKey: ['material-master-statistics-controlled'],
      })
    } catch (error) {
      logger.error('Clear all failed:', error)
      throw error
    }
  }, [materialMasterService, queryClient])

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
    isUsingRust: materialMasterService.isUsingRust(),
  }
}

// Created and developed by Jai Singh
