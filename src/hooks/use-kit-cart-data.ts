/**
 * Kit Cart Data Hook with Real-Time Polling
 *
 * Provides real-time kit cart data from Nefab PFC Trace API.
 * Implements polling with visibility awareness and error handling.
 *
 * @author Jai Singh
 * @date December 17, 2025
 * @version 1.0.0
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  nefabApiService,
  type NefabItem,
  type NefabItemType,
} from '@/lib/services/nefab-api.service'
import { logger } from '@/lib/utils/logger'

// ==================== TYPES ====================

export interface KitCartDataState {
  items: NefabItem[]
  isLoading: boolean
  error: string | null
  totalCount: number
  cached: boolean
  cacheAgeSeconds: number | null
  lastUpdated: string | null
  isPolling: boolean
}

export interface KitCartStatistics {
  totalItems: number
  byItemType: Record<string, number>
  byStatus: Record<string, number>
  byWarehouse: Record<string, number>
}

export interface UseKitCartDataOptions {
  /**
   * Polling interval in milliseconds (default: 60000 = 1 minute)
   */
  pollingInterval?: number

  /**
   * Whether to enable real-time polling (default: true)
   */
  enablePolling?: boolean

  /**
   * Filter by specific item type ID
   */
  itemTypeId?: number

  /**
   * Only show kit cart types (default: false for all items)
   */
  kitCartsOnly?: boolean

  /**
   * Search query for filtering
   */
  searchQuery?: string
}

export interface UseKitCartDataReturn extends KitCartDataState {
  refreshData: () => Promise<void>
  statistics: KitCartStatistics | null
  itemTypes: NefabItemType[]
  setItemTypeFilter: (itemTypeId: number | null) => void
  currentFilter: number | null
}

// ==================== HOOK IMPLEMENTATION ====================

export function useKitCartData(
  options: UseKitCartDataOptions = {}
): UseKitCartDataReturn {
  const {
    pollingInterval = 60000, // 1 minute default
    enablePolling = true,
    itemTypeId,
    kitCartsOnly = false,
    searchQuery = '',
  } = options

  // State
  const [state, setState] = useState<KitCartDataState>({
    items: [],
    isLoading: true,
    error: null,
    totalCount: 0,
    cached: false,
    cacheAgeSeconds: null,
    lastUpdated: null,
    isPolling: false,
  })

  const [statistics, setStatistics] = useState<KitCartStatistics | null>(null)
  const [itemTypes, setItemTypes] = useState<NefabItemType[]>([])
  const [currentFilter, setCurrentFilter] = useState<number | null>(
    itemTypeId || null
  )

  // Refs
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isVisibleRef = useRef(true)
  const isMountedRef = useRef(true)

  // Fetch data function
  const fetchData = useCallback(
    async (showLoading: boolean = false) => {
      if (!isMountedRef.current) return

      try {
        if (showLoading) {
          setState((prev) => ({ ...prev, isLoading: true, error: null }))
        } else {
          setState((prev) => ({ ...prev, isPolling: true, error: null }))
        }

        let response

        if (kitCartsOnly) {
          // Get only kit cart types
          response = await nefabApiService.getKitCarts(true)
        } else if (currentFilter) {
          // Get specific item type
          response = await nefabApiService.getItemsByType(currentFilter, true)
        } else {
          // Get all items
          response = await nefabApiService.getAllItems({ useCache: true })
        }

        if (!isMountedRef.current) return

        if (response.success) {
          // Apply search filter on client side
          let filteredItems = response.items

          if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase()
            filteredItems = response.items.filter(
              (item) =>
                item.Name.toLowerCase().includes(query) ||
                item.Description?.toLowerCase().includes(query) ||
                item.ItemType?.Name.toLowerCase().includes(query) ||
                item.StatusName?.toLowerCase().includes(query) ||
                item.StatusWarehouse?.Name.toLowerCase().includes(query) ||
                item.Location?.Name?.toLowerCase().includes(query) ||
                item.FreeField1Name?.toLowerCase().includes(query) ||
                item.FreeField2Name?.toLowerCase().includes(query)
            )
          }

          setState((prev) => ({
            ...prev,
            items: filteredItems,
            isLoading: false,
            isPolling: false,
            error: null,
            totalCount: filteredItems.length,
            cached: response.cached,
            cacheAgeSeconds: response.cache_age_seconds || null,
            lastUpdated: response.last_updated || new Date().toISOString(),
          }))

          // Calculate local statistics
          const stats: KitCartStatistics = {
            totalItems: filteredItems.length,
            byItemType: {},
            byStatus: {},
            byWarehouse: {},
          }

          filteredItems.forEach((item) => {
            // By item type
            const typeName = item.ItemType?.Name || 'Unknown'
            stats.byItemType[typeName] = (stats.byItemType[typeName] || 0) + 1

            // By status
            const status = item.StatusName || 'Unknown'
            stats.byStatus[status] = (stats.byStatus[status] || 0) + 1

            // By warehouse
            const warehouse = item.StatusWarehouse?.Name || 'Unknown'
            stats.byWarehouse[warehouse] =
              (stats.byWarehouse[warehouse] || 0) + 1
          })

          setStatistics(stats)
        } else {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            isPolling: false,
            error: response.message || 'Failed to fetch data',
          }))
        }
      } catch (err) {
        if (!isMountedRef.current) return

        logger.error('Kit cart data fetch error:', err)
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isPolling: false,
          error:
            err instanceof Error ? err.message : 'An unexpected error occurred',
        }))
      }
    },
    [currentFilter, kitCartsOnly, searchQuery]
  )

  // Fetch item types on mount
  useEffect(() => {
    const loadItemTypes = async () => {
      try {
        const response = await nefabApiService.getItemTypes(kitCartsOnly)
        if (response.success) {
          setItemTypes(response.item_types)
        }
      } catch (err) {
        logger.error('Failed to load item types:', err)
      }
    }

    loadItemTypes()
  }, [kitCartsOnly])

  // Initial data fetch
  useEffect(() => {
    isMountedRef.current = true
    fetchData(true)

    return () => {
      isMountedRef.current = false
    }
  }, [fetchData])

  // Visibility-aware polling
  useEffect(() => {
    if (!enablePolling) return

    // Handle visibility change
    const handleVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === 'visible'

      if (isVisibleRef.current && !pollingIntervalRef.current) {
        // Resume polling when visible
        startPolling()
      } else if (!isVisibleRef.current && pollingIntervalRef.current) {
        // Pause polling when hidden
        stopPolling()
      }
    }

    const startPolling = () => {
      if (pollingIntervalRef.current) return

      pollingIntervalRef.current = setInterval(() => {
        if (isVisibleRef.current && isMountedRef.current) {
          fetchData(false)
        }
      }, pollingInterval)
    }

    const stopPolling = () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
    }

    // Add visibility listener
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Start polling if visible
    if (document.visibilityState === 'visible') {
      startPolling()
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopPolling()
    }
  }, [enablePolling, pollingInterval, fetchData])

  // Re-fetch when filter changes
  useEffect(() => {
    fetchData(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchData is stable (useCallback); re-fetch triggered by filter/search changes only
  }, [currentFilter, searchQuery])

  // Manual refresh function
  const refreshData = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }))

    try {
      // Force bypass cache
      if (kitCartsOnly) {
        await nefabApiService.getKitCarts(false)
      } else if (currentFilter) {
        await nefabApiService.getItemsByType(currentFilter, false)
      } else {
        await nefabApiService.refreshItems()
      }

      // Then fetch with cache
      await fetchData(true)
    } catch (err) {
      logger.error('Refresh failed:', err)
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Refresh failed',
      }))
    }
  }, [fetchData, currentFilter, kitCartsOnly])

  // Set item type filter
  const setItemTypeFilter = useCallback((newFilterId: number | null) => {
    setCurrentFilter(newFilterId)
  }, [])

  return {
    ...state,
    refreshData,
    statistics,
    itemTypes,
    setItemTypeFilter,
    currentFilter,
  }
}

// ==================== EXPORTED TYPES ====================

export type { NefabItem, NefabItemType }
// Developer and Creator: Jai Singh
