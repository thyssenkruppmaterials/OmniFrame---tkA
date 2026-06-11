// Created and developed by Jai Singh
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck - Legacy hook with complex type requirements
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getCurrentOrgId } from '@/lib/auth/unified-auth-provider'
import {
  LX03DataService,
  type LX03Data,
  type ImportResult,
  type ImportProgress,
  type ImportProgressCallback,
} from '@/lib/supabase/lx03-data.service'
import { logger } from '@/lib/utils/logger'
import type { WsEvent, WsEventHandler } from '@/lib/work-service'
import { workServiceWs } from '@/lib/work-service/websocket'

interface UseLX03DataOptions {
  enableRealtime?: boolean
  searchQuery?: string
}

export function useLX03Data({
  enableRealtime = true,
  searchQuery = '',
}: UseLX03DataOptions = {}) {
  const queryClient = useQueryClient()
  const [isImporting, setIsImporting] = useState(false)
  const [searchQueryState, setSearchQueryState] = useState(searchQuery)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null
  )
  const [showProgressDialog, setShowProgressDialog] = useState(false)

  const lx03Service = LX03DataService.getInstance()

  // Main data query - optimized for large datasets (last 1000 records, search queries entire DB)
  const {
    data: rawData = [],
    isLoading,
    error,
    refetch: refreshData,
  } = useQuery({
    queryKey: ['lx03-data-controlled', searchQueryState], // Include search in cache key
    queryFn: async () => {
      logger.log(
        `🔄 HOOK: Executing LX03 data fetch... ${searchQueryState ? `(Search: "${searchQueryState}")` : '(Last 1000)'}`
      )
      const result = await lx03Service.fetchLX03Data(searchQueryState)
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
    queryKey: ['lx03-statistics-controlled'], // v8 cache key - controlled sequential chunking
    queryFn: async () => {
      logger.log('📈 HOOK: Executing LX03 statistics calculation...')
      const result = await lx03Service.getStatistics()
      logger.log(`📊 HOOK: Received statistics:`, result)
      return result
    },
    refetchInterval: enableRealtime ? 60000 : false, // Refetch every minute
    staleTime: 30000, // Statistics can be a bit more stale
  })

  // Set up realtime subscription.
  //
  // 2026-05-06 — Tier 1 deferred-channel migration. Replaces the
  // unfiltered `supabase.channel('lx03-data-changes')` listener with
  // a typed `WsEvent::Lx03DataChanged` push through
  // `WorkServiceWebSocket`.
  //
  //   - DB:   migration 274 adds the NOTIFY trigger on rr_lx03_data.
  //           `organization_id` is NULLABLE in the schema; the trigger
  //           emits whatever the row carries.
  //   - Rust: `lx03_listener` consumes `LISTEN lx03_data_changed`.
  //           Rows with `organization_id IS NULL` broadcast as
  //           "system-wide" events that reach every connected client
  //           — preserving the pre-migration behaviour of the
  //           unfiltered Supabase channel.
  //   - FE:   THIS effect registers a single handler on the singleton
  //           and DEFENDS-IN-DEPTH by ignoring events whose
  //           `organization_id` doesn't match the user's org. (NULL-
  //           org events are still treated as "global" and re-invalidate
  //           the query — same as before.)
  useEffect(() => {
    if (!enableRealtime) return
    const orgId = getCurrentOrgId()
    if (!orgId) {
      // No signed-in user / no org_id — skip the WS subscription.
      // The TanStack Query `refetchInterval: 60000` keeps the table
      // fresh on its own.
      return
    }

    const handler: WsEventHandler = (event: WsEvent) => {
      if (event.type !== 'Lx03DataChanged') return
      // Belt-and-braces org check. Rows whose organization_id is null
      // are treated as system-wide (same as the unfiltered channel
      // pre-migration); rows with a non-matching org are dropped.
      if (event.organization_id && event.organization_id !== orgId) return
      logger.log('LX03 data changed (WS push):', event.row_id, event.op)
      queryClient.invalidateQueries({ queryKey: ['lx03-data-rpc-final'] })
      queryClient.invalidateQueries({
        queryKey: ['lx03-statistics-rpc-final'],
      })
      switch (event.op) {
        case 'INSERT':
          toast.success('New LX03 record added')
          break
        case 'UPDATE':
          toast.info('LX03 record updated')
          break
        case 'DELETE':
          toast.info('LX03 record deleted')
          break
      }
    }

    try {
      workServiceWs.connect(orgId, handler)
    } catch {
      /* WS setup failure — fall back to safety-net polling only. */
    }

    // Safety-net poll: re-invalidate every 5 min if the WS isn't
    // currently in `connected` state. The query's existing
    // `refetchInterval: 60000` is the primary background refresh; this
    // covers the case where the WS push gets dropped / lagged.
    const SAFETY_NET_INTERVAL_MS = 5 * 60_000
    const safetyNet = setInterval(() => {
      if (workServiceWs.getConnectionState() === 'connected') return
      queryClient.invalidateQueries({ queryKey: ['lx03-data-rpc-final'] })
      queryClient.invalidateQueries({
        queryKey: ['lx03-statistics-rpc-final'],
      })
    }, SAFETY_NET_INTERVAL_MS)

    return () => {
      clearInterval(safetyNet)
      try {
        workServiceWs.removeHandler(handler)
      } catch {
        /* ignore */
      }
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
      (item: LX03Data) =>
        item.material?.toLowerCase().includes(query) ||
        item.plant?.toLowerCase().includes(query) ||
        item.storage_location?.toLowerCase().includes(query) ||
        item.delivery?.toLowerCase().includes(query) ||
        item.batch?.toLowerCase().includes(query) ||
        item.storage_bin?.toLowerCase().includes(query) ||
        item.stock_category?.toLowerCase().includes(query)
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
      const result = await lx03Service.importFromClipboard(handleImportProgress)

      if (result.success) {
        // Refresh data after successful import
        await queryClient.invalidateQueries({
          queryKey: ['lx03-data-rpc-final'],
        })
        await queryClient.invalidateQueries({
          queryKey: ['lx03-statistics-rpc-final'],
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
  }, [lx03Service, queryClient, handleImportProgress])

  // Delete record
  const deleteRecord = useCallback(
    async (id: string) => {
      try {
        await lx03Service.deleteLX03Data(id)
        toast.success('Record deleted successfully')

        // Refresh data
        queryClient.invalidateQueries({ queryKey: ['lx03-data-rpc-final'] })
        queryClient.invalidateQueries({
          queryKey: ['lx03-statistics-rpc-final'],
        })
      } catch (error) {
        logger.error('Delete failed:', error)
        toast.error('Failed to delete record')
        throw error
      }
    },
    [lx03Service, queryClient]
  )

  // Clear all data
  const clearAllData = useCallback(async () => {
    try {
      await lx03Service.clearAllLX03Data(true) // Show toast for manual clear

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['lx03-data-rpc-final'] })
      queryClient.invalidateQueries({ queryKey: ['lx03-statistics-rpc-final'] })
    } catch (error) {
      logger.error('Clear all failed:', error)
      throw error
    }
  }, [lx03Service, queryClient])

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
    isUsingRust: lx03Service.isUsingRust(),
  }
}

// Created and developed by Jai Singh
