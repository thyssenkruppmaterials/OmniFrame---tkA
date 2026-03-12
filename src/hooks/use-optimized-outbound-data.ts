import { useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import {
  OutboundTODataService,
  type OutboundTOData,
  type ImportResult,
} from '@/lib/supabase/outbound-to-data.service'
import { logger } from '@/lib/utils/logger'

const service = OutboundTODataService.getInstance()

interface UseOptimizedOutboundTODataOptions {
  searchQuery?: string
  enableRealtime?: boolean
}

/**
 * Optimized hook for managing outbound TO data with performance enhancements
 * Prevents cascade invalidations and implements intelligent caching
 */
export function useOptimizedOutboundTOData(
  options: UseOptimizedOutboundTODataOptions = {}
) {
  const { searchQuery = '', enableRealtime = true } = options
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const { profile } = authState

  // Performance optimization refs
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null)
  const lastInvalidation = useRef<number>(0)
  const invalidationThrottle = useRef<NodeJS.Timeout | null>(null)
  const toastThrottle = useRef<NodeJS.Timeout | null>(null)
  const isComponentVisible = useRef(true)
  const lastToastTime = useRef<Map<string, number>>(new Map())

  // Visibility tracking for performance optimization
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        isComponentVisible.current = entry.isIntersecting
        logger.log('Outbound data component visibility:', entry.isIntersecting)
      },
      { threshold: 0.1 }
    )

    // Observe the document body as a proxy for component visibility
    observer.observe(document.body)

    return () => {
      observer.disconnect()
    }
  }, [])

  // Heavily debounced query invalidation to prevent cascade invalidations
  const debouncedInvalidateQueries = useCallback(() => {
    const now = Date.now()

    // Only invalidate if component is visible and enough time has passed
    if (!isComponentVisible.current) {
      logger.log('Skipping invalidation - component not visible')
      return
    }

    const timeSinceLastInvalidation = now - lastInvalidation.current
    if (timeSinceLastInvalidation < 5000) {
      // 5 seconds minimum between invalidations
      logger.log(
        'Invalidation throttled - last was',
        timeSinceLastInvalidation,
        'ms ago'
      )
      return
    }

    // Clear existing timeout
    if (invalidationThrottle.current) {
      clearTimeout(invalidationThrottle.current)
    }

    // Set new timeout for batched invalidation
    invalidationThrottle.current = setTimeout(() => {
      logger.log('Performing batched query invalidation')
      lastInvalidation.current = Date.now()

      // Only invalidate specific queries to minimize performance impact
      queryClient.invalidateQueries({
        queryKey: ['outbound-data'],
        refetchType: 'none', // Don't automatically refetch, let components decide
      })

      // Only invalidate stats if they're actively being viewed
      if (document.querySelector('[data-testid="outbound-stats"]')) {
        queryClient.invalidateQueries({
          queryKey: ['outbound-data-stats'],
          refetchType: 'none',
        })
      }
    }, 2000) // 2 second debounce for batched invalidation
  }, [queryClient])

  // Optimized toast notifications with heavy throttling
  const showThrottledToast = useCallback(
    (message: string, type: 'info' | 'success' | 'error' = 'info') => {
      const now = Date.now()
      const lastTime = lastToastTime.current.get(message) || 0

      // Only show toast if 10 seconds have passed since last identical message
      if (now - lastTime < 10000) {
        return
      }

      lastToastTime.current.set(message, now)

      // Clear old entries to prevent memory leaks
      if (lastToastTime.current.size > 50) {
        const entries = Array.from(lastToastTime.current.entries())
        entries.sort((a, b) => b[1] - a[1])
        lastToastTime.current = new Map(entries.slice(0, 25))
      }

      switch (type) {
        case 'success':
          toast.success(message)
          break
        case 'error':
          toast.error(message)
          break
        default:
          toast.info(message)
      }
    },
    []
  )

  // Main data query with optimized caching
  const {
    data: outboundData = [],
    isLoading: isLoadingData,
    error: dataError,
    refetch,
  } = useQuery({
    queryKey: ['outbound-data', profile?.organization_id, searchQuery],
    queryFn: () => service.searchOutboundData(searchQuery),
    enabled: !!profile?.organization_id,
    staleTime: 5 * 60 * 1000, // 5 minutes stale time
    gcTime: 10 * 60 * 1000, // 10 minutes garbage collection
    refetchOnWindowFocus: false, // Disable auto-refetch on focus
    refetchInterval: false, // Disable interval-based refetching
    retry: (failureCount, error) => {
      // Only retry network errors, not permission errors
      return failureCount < 2 && !error.message.includes('permission')
    },
  })

  // Statistics query with even more aggressive caching
  const {
    data: stats,
    isLoading: isLoadingStats,
    error: statsError,
  } = useQuery({
    queryKey: ['outbound-data-stats', profile?.organization_id],
    queryFn: () => service.getStatistics(),
    enabled: !!profile?.organization_id,
    staleTime: 10 * 60 * 1000, // 10 minutes stale time for stats
    gcTime: 30 * 60 * 1000, // 30 minutes garbage collection
    refetchOnWindowFocus: false,
    refetchInterval: false,
  })

  // Optimized delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => service.deleteOutboundData(id),
    onSuccess: () => {
      showThrottledToast('Record deleted successfully', 'success')
      // Use gentle invalidation instead of immediate refetch
      setTimeout(() => {
        debouncedInvalidateQueries()
      }, 1000)
    },
    onError: (error) => {
      logger.error('Delete failed:', error)
      showThrottledToast('Failed to delete record', 'error')
    },
  })

  // Optimized import mutation
  const importMutation = useMutation({
    mutationFn: () => service.importFromClipboard(),
    onSuccess: (result: ImportResult) => {
      if (result.success) {
        showThrottledToast('Import completed successfully', 'success')
      } else {
        showThrottledToast('Import failed', 'error')
      }

      // Delayed invalidation to prevent immediate performance hit
      setTimeout(() => {
        debouncedInvalidateQueries()
      }, 2000)
    },
    onError: (error) => {
      logger.error('Import failed:', error)
      showThrottledToast('Import failed', 'error')
    },
  })

  // Intelligent real-time subscription with visibility controls
  useEffect(() => {
    if (!enableRealtime || !profile?.organization_id) return

    // Clean up any existing subscription
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe()
      subscriptionRef.current = null
    }

    // Only enable real-time when component is visible and user is active
    if (!isComponentVisible.current) {
      logger.log(
        'Component not visible - skipping real-time subscription setup'
      )
      return
    }

    logger.log('Setting up optimized real-time subscription')

    // Set up subscription with intelligent invalidation
    subscriptionRef.current = supabase
      .channel('optimized_outbound_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'outbound_to_data',
          filter: `organization_id=eq.${profile.organization_id}`,
        },
        (payload) => {
          logger.log('Received real-time change:', payload.eventType)

          // Only process changes if component is visible
          if (!isComponentVisible.current) {
            logger.log('Component not visible - ignoring real-time change')
            return
          }

          // Use heavily debounced invalidation
          debouncedInvalidateQueries()

          // Show throttled toast for changes made by other users
          const currentUserId = profile?.id
          const newRecord = payload.new as OutboundTOData | null

          if (newRecord && newRecord.uploaded_by !== currentUserId) {
            const eventType = payload.eventType
            const delivery = newRecord.delivery || 'Unknown'
            const message = `Delivery ${delivery} ${eventType.toLowerCase()} by another user`

            showThrottledToast(message, 'info')
          }
        }
      )
      .subscribe((status) => {
        logger.log('Real-time subscription status:', status)
      })

    // Cleanup on unmount or dependency change
    return () => {
      if (subscriptionRef.current) {
        logger.log('Cleaning up real-time subscription')
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = null
      }
    }
  }, [
    enableRealtime,
    profile?.organization_id,
    profile?.id,
    debouncedInvalidateQueries,
    showThrottledToast,
  ])

  // Cleanup timeouts on unmount
  useEffect(() => {
    const currentToastThrottle = toastThrottle.current
    return () => {
      if (invalidationThrottle.current)
        clearTimeout(invalidationThrottle.current)
      if (currentToastThrottle) clearTimeout(currentToastThrottle)
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = null
      }
    }
  }, [])

  // Manual refresh function
  const refreshData = useCallback(() => {
    logger.log('Manual data refresh triggered')
    debouncedInvalidateQueries()
  }, [debouncedInvalidateQueries])

  return {
    // Data
    outboundData,
    stats,

    // Loading states
    isLoading: isLoadingData || isLoadingStats,
    isLoadingData,
    isLoadingStats,

    // Errors
    error: dataError || statsError,
    dataError,
    statsError,

    // Mutations
    deleteMutation,
    importMutation,

    // Utility functions
    refetch,
    refreshData,

    // Performance monitoring
    isRealTimeEnabled: enableRealtime && isComponentVisible.current,
    cacheStatus: {
      invalidationCount: lastInvalidation.current > 0 ? 1 : 0,
      lastInvalidation: lastInvalidation.current,
      isVisible: isComponentVisible.current,
    },
  }
}
