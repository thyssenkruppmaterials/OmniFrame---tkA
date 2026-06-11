// Created and developed by Jai Singh
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/database.types'
import {
  OutboundTODataService,
  type ImportResult,
  type OutboundTOData,
} from '@/lib/supabase/outbound-to-data.service'
import { logger } from '@/lib/utils/logger'

// Rust core enabled flag
const RUST_CORE_ENABLED = import.meta.env.VITE_RUST_CORE_ENABLED === 'true'

const service = OutboundTODataService.getInstance()

interface UseOutboundTODataOptions {
  searchQuery?: string
  enableRealtime?: boolean
}

// ==================== PACK TOOL SPECIFIC HOOKS ====================

/**
 * Hook for pack tool workflow operations
 */
export function usePackTool() {
  const queryClient = useQueryClient()

  // Verify delivery existence
  const verifyDeliveryMutation = useMutation({
    mutationFn: (deliveryId: string) => service.verifyDelivery(deliveryId),
    onSuccess: (data) => {
      if (data.exists) {
        const toMessage = data.requiresTOScanning
          ? ` (${data.toNumbers?.length} TO numbers to scan)`
          : ''
        toast.success(
          `Delivery ${data.deliveryData?.[0]?.delivery} verified successfully${toMessage}`
        )
      } else {
        toast.error(
          'Delivery not found or not ready for packing (must be picked, picked short, or picked bulk)'
        )
      }
    },
    onError: (error) => {
      logger.error('Delivery verification failed:', error)
      toast.error('Failed to verify delivery')
    },
  })

  // Validate TO number
  const validateTOMutation = useMutation({
    mutationFn: ({
      deliveryId,
      toNumber,
    }: {
      deliveryId: string
      toNumber: string
    }) => service.validateTONumber(deliveryId, toNumber),
    onSuccess: (data, { toNumber }) => {
      if (data.isValid) {
        toast.success(`TO number ${toNumber} verified successfully`)
      } else {
        toast.error(`TO number ${toNumber} not found for this delivery`)
      }
    },
    onError: (error) => {
      logger.error('TO validation failed:', error)
      toast.error('Failed to validate TO number')
    },
  })

  // Get delivery items
  const getDeliveryItemsMutation = useMutation({
    mutationFn: (deliveryId: string) => service.getDeliveryItems(deliveryId),
    onError: (error) => {
      logger.error('Failed to fetch delivery items:', error)
      toast.error('Failed to load delivery items')
    },
  })

  // Update packing information
  const updatePackingInfoMutation = useMutation({
    mutationFn: ({
      deliveryId,
      packingData,
    }: {
      deliveryId: string
      packingData: {
        package_length: number
        package_width: number
        package_height: number
        package_weight: number
      }
    }) => service.updatePackingInfo(deliveryId, packingData),
    onSuccess: () => {
      toast.success('Package information saved successfully')
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['outbound-data'] })
    },
    onError: (error) => {
      logger.error('Failed to update packing info:', error)
      toast.error('Failed to save package information')
    },
  })

  // Complete packing process
  const completePackingMutation = useMutation({
    mutationFn: (deliveryId: string) => service.completePacking(deliveryId),
    onSuccess: (data) => {
      toast.success(`Delivery ${data[0]?.delivery} packed successfully!`)
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['outbound-data'] })
      queryClient.invalidateQueries({ queryKey: ['pack-tool-stats'] })
    },
    onError: (error) => {
      logger.error('Failed to complete packing:', error)
      toast.error('Failed to complete packing process')
    },
  })

  // Get pack tool statistics
  const {
    data: packToolStats,
    isLoading: isLoadingStats,
    error: statsError,
  } = useQuery({
    queryKey: ['pack-tool-stats'],
    queryFn: () => service.getPackToolStats(),
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refresh every minute
  })

  return {
    // Mutations
    verifyDelivery: verifyDeliveryMutation.mutate,
    verifyDeliveryAsync: verifyDeliveryMutation.mutateAsync,
    isVerifyingDelivery: verifyDeliveryMutation.isPending,

    validateTO: validateTOMutation.mutate,
    validateTOAsync: validateTOMutation.mutateAsync,
    isValidatingTO: validateTOMutation.isPending,

    getDeliveryItems: getDeliveryItemsMutation.mutate,
    getDeliveryItemsAsync: getDeliveryItemsMutation.mutateAsync,
    isLoadingItems: getDeliveryItemsMutation.isPending,

    updatePackingInfo: updatePackingInfoMutation.mutate,
    updatePackingInfoAsync: updatePackingInfoMutation.mutateAsync,
    isUpdatingPackingInfo: updatePackingInfoMutation.isPending,

    completePacking: completePackingMutation.mutate,
    completePackingAsync: completePackingMutation.mutateAsync,
    isCompletingPacking: completePackingMutation.isPending,

    // Statistics
    packToolStats,
    isLoadingStats,
    statsError,

    // Utils
    refreshStats: () =>
      queryClient.invalidateQueries({ queryKey: ['pack-tool-stats'] }),
  }
}

// ==================== FINAL PACK TOOL SPECIFIC HOOKS ====================

/**
 * Hook for final pack tool workflow operations
 */
export function useFinalPackTool() {
  const queryClient = useQueryClient()

  // Verify delivery for final packing
  const verifyDeliveryMutation = useMutation({
    mutationFn: (deliveryId: string) =>
      service.verifyDeliveryForFinalPack(deliveryId),
    onSuccess: (data) => {
      if (data.exists) {
        toast.success(
          `Delivery ${data.deliveryData?.[0]?.delivery} ready for final packing`
        )
      } else {
        toast.error('Delivery not found or not packed/shipped')
      }
    },
    onError: (error) => {
      logger.error('Delivery verification failed:', error)
      toast.error('Failed to verify delivery')
    },
  })

  // Update final pack information
  const updateFinalPackInfoMutation = useMutation({
    mutationFn: ({
      deliveryId,
      finalPackData,
    }: {
      deliveryId: string
      finalPackData: {
        tracking_number: string
        requires_8130_3: boolean
        has_8130_3: boolean
        is_8130_3_signed: boolean
      }
    }) => service.updateFinalPackInfo(deliveryId, finalPackData),
    onSuccess: () => {
      toast.success('Final pack information saved successfully')
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['outbound-data'] })
      queryClient.invalidateQueries({ queryKey: ['final-pack-stats'] })
    },
    onError: (error) => {
      logger.error('Failed to update final pack info:', error)
      toast.error('Failed to save final pack information')
    },
  })

  // Complete final packing process
  const completeFinalPackingMutation = useMutation({
    mutationFn: (deliveryId: string) =>
      service.completeFinalPacking(deliveryId),
    onSuccess: (data) => {
      toast.success(`Delivery ${data[0]?.delivery} final packed successfully!`)
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['outbound-data'] })
      queryClient.invalidateQueries({ queryKey: ['final-pack-stats'] })
    },
    onError: (error) => {
      logger.error('Failed to complete final packing:', error)
      toast.error('Failed to complete final packing process')
    },
  })

  // Get final pack tool statistics
  const {
    data: finalPackToolStats,
    isLoading: isLoadingStats,
    error: statsError,
  } = useQuery({
    queryKey: ['final-pack-stats'],
    queryFn: () => service.getFinalPackToolStats(),
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refresh every minute
  })

  return {
    // Mutations
    verifyDelivery: verifyDeliveryMutation.mutate,
    verifyDeliveryAsync: verifyDeliveryMutation.mutateAsync,
    isVerifyingDelivery: verifyDeliveryMutation.isPending,

    updateFinalPackInfo: updateFinalPackInfoMutation.mutate,
    updateFinalPackInfoAsync: updateFinalPackInfoMutation.mutateAsync,
    isUpdatingFinalPackInfo: updateFinalPackInfoMutation.isPending,

    completeFinalPacking: completeFinalPackingMutation.mutate,
    completeFinalPackingAsync: completeFinalPackingMutation.mutateAsync,
    isCompletingFinalPacking: completeFinalPackingMutation.isPending,

    // Statistics
    finalPackToolStats,
    isLoadingStats,
    statsError,

    // Utils
    refreshStats: () =>
      queryClient.invalidateQueries({ queryKey: ['final-pack-stats'] }),
  }
}

// ==================== SHIPPER TOOL SPECIFIC HOOKS ====================

/**
 * Hook for shipper tool workflow operations
 */
export function useShipperTool() {
  const queryClient = useQueryClient()

  // Verify delivery for shipping
  const verifyDeliveryMutation = useMutation({
    mutationFn: (deliveryId: string) =>
      service.verifyDeliveryForShipping(deliveryId),
    onSuccess: (data) => {
      if (data.exists) {
        toast.success(
          `Delivery ${data.deliveryData?.[0]?.delivery} ready for shipping`
        )
      } else {
        toast.error('Delivery not found or not yet packed')
      }
    },
    onError: (error) => {
      logger.error('Delivery verification failed:', error)
      toast.error('Failed to verify delivery')
    },
  })

  // Verify delivery for WAWF processing
  const verifyDeliveryForWAWFMutation = useMutation({
    mutationFn: (deliveryId: string) =>
      service.verifyDeliveryForWAWF(deliveryId),
    onSuccess: (data) => {
      if (data.exists) {
        const currentWawf = data.deliveryData?.[0]?.wawf_status
        if (currentWawf) {
          toast.success(
            `Delivery ${data.deliveryData?.[0]?.delivery} found (WAWF: ${currentWawf.replace(/_/g, ' ')})`
          )
        } else {
          toast.success(
            `Delivery ${data.deliveryData?.[0]?.delivery} ready for WAWF processing`
          )
        }
      } else {
        toast.error('Delivery not found or not eligible for WAWF')
      }
    },
    onError: (error) => {
      logger.error('WAWF delivery verification failed:', error)
      toast.error('Failed to verify delivery for WAWF')
    },
  })

  // Update WAWF status (options 1 & 2)
  const updateWAWFStatusMutation = useMutation({
    mutationFn: ({
      deliveryId,
      wawfStatus,
    }: {
      deliveryId: string
      wawfStatus: 'ready_for_nefab' | 'staged_to_nefab'
    }) => service.updateWAWFStatus(deliveryId, wawfStatus),
    onSuccess: (_data, variables) => {
      const label =
        variables.wawfStatus === 'ready_for_nefab'
          ? 'Ready for NeFab'
          : 'Staged to NeFab'
      toast.success(`Delivery WAWF status set to: ${label}`)
      queryClient.invalidateQueries({ queryKey: ['outbound-data'] })
      queryClient.invalidateQueries({ queryKey: ['shipper-stats'] })
    },
    onError: (error) => {
      logger.error('Failed to update WAWF status:', error)
      toast.error('Failed to update WAWF status')
    },
  })

  // Complete WAWF TKA process (option 3)
  const completeWAWFShippingMutation = useMutation({
    mutationFn: (deliveryId: string) =>
      service.completeWAWFShipping(deliveryId),
    onSuccess: (data) => {
      toast.success(
        `Delivery ${data[0]?.delivery} TKA process complete — shipped!`
      )
      queryClient.invalidateQueries({ queryKey: ['outbound-data'] })
      queryClient.invalidateQueries({ queryKey: ['shipper-stats'] })
    },
    onError: (error) => {
      logger.error('Failed to complete WAWF shipping:', error)
      toast.error('Failed to complete TKA process')
    },
  })

  // Update shipping information
  const updateShippingInfoMutation = useMutation({
    mutationFn: ({
      deliveryId,
      shippingData,
    }: {
      deliveryId: string
      shippingData: {
        shipper_type: 'domestic' | 'international' | 'wawf'
      }
    }) => service.updateShippingInfo(deliveryId, shippingData),
    onSuccess: () => {
      toast.success('Shipping information saved successfully')
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['outbound-data'] })
      queryClient.invalidateQueries({ queryKey: ['shipper-stats'] })
    },
    onError: (error) => {
      logger.error('Failed to update shipping info:', error)
      toast.error('Failed to save shipping information')
    },
  })

  // Complete shipping process
  const completeShippingMutation = useMutation({
    mutationFn: (deliveryId: string) => service.completeShipping(deliveryId),
    onSuccess: (data) => {
      toast.success(`Delivery ${data[0]?.delivery} shipped successfully!`)
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['outbound-data'] })
      queryClient.invalidateQueries({ queryKey: ['shipper-stats'] })
    },
    onError: (error) => {
      logger.error('Failed to complete shipping:', error)
      toast.error('Failed to complete shipping process')
    },
  })

  // Get shipper tool statistics
  const {
    data: shipperToolStats,
    isLoading: isLoadingStats,
    error: statsError,
  } = useQuery({
    queryKey: ['shipper-stats'],
    queryFn: () => service.getShipperToolStats(),
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refresh every minute
  })

  return {
    // Mutations
    verifyDelivery: verifyDeliveryMutation.mutate,
    verifyDeliveryAsync: verifyDeliveryMutation.mutateAsync,
    isVerifyingDelivery: verifyDeliveryMutation.isPending,

    updateShippingInfo: updateShippingInfoMutation.mutate,
    updateShippingInfoAsync: updateShippingInfoMutation.mutateAsync,
    isUpdatingShippingInfo: updateShippingInfoMutation.isPending,

    completeShipping: completeShippingMutation.mutate,
    completeShippingAsync: completeShippingMutation.mutateAsync,
    isCompletingShipping: completeShippingMutation.isPending,

    // WAWF
    verifyDeliveryForWAWF: verifyDeliveryForWAWFMutation.mutate,
    verifyDeliveryForWAWFAsync: verifyDeliveryForWAWFMutation.mutateAsync,
    isVerifyingWAWF: verifyDeliveryForWAWFMutation.isPending,

    updateWAWFStatus: updateWAWFStatusMutation.mutate,
    updateWAWFStatusAsync: updateWAWFStatusMutation.mutateAsync,
    isUpdatingWAWF: updateWAWFStatusMutation.isPending,

    completeWAWFShipping: completeWAWFShippingMutation.mutate,
    completeWAWFShippingAsync: completeWAWFShippingMutation.mutateAsync,
    isCompletingWAWF: completeWAWFShippingMutation.isPending,

    // Statistics
    shipperToolStats,
    isLoadingStats,
    statsError,

    // Utils
    refreshStats: () =>
      queryClient.invalidateQueries({ queryKey: ['shipper-stats'] }),
  }
}

// ==================== PUTBACK TOOL SPECIFIC HOOKS ====================

/**
 * Hook for putback tool workflow operations
 */
export function usePutbackTool() {
  const queryClient = useQueryClient()

  // Validate delivery for putback
  const validateDeliveryMutation = useMutation({
    mutationFn: (deliveryId: string) =>
      service.validateDeliveryForPutback(deliveryId),
    onSuccess: (data) => {
      if (data.exists) {
        toast.success(
          `Delivery ${data.deliveryData?.[0]?.delivery} validated for putback`
        )
      } else {
        toast.error('Delivery not found')
      }
    },
    onError: (error) => {
      logger.error('Delivery validation failed:', error)
      toast.error('Failed to validate delivery')
    },
  })

  // Create putback ticket
  const createPutbackTicketMutation = useMutation({
    mutationFn: (putbackData: {
      deliveryId: string
      materialNumber: string
      materialDescription?: string
      quantityReturned: number
      originalStorageBin?: string
      originalDeliveryData?: Record<string, unknown>
    }) => service.createPutbackTicket(putbackData),
    onSuccess: (data) => {
      toast.success(
        `Putback ticket ${data.putback_number} created successfully!`
      )
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['putback-tickets'] })
      queryClient.invalidateQueries({ queryKey: ['putback-stats'] })
    },
    onError: (error) => {
      logger.error('❌ Failed to create putback ticket:', error)

      // Provide detailed error information for debugging
      let errorMessage = 'Failed to create putback ticket'

      if (error instanceof Error) {
        errorMessage = `Failed to create putback ticket: ${error.message}`

        // Add additional error details if available
        const pgError = error as Error & {
          details?: string
          hint?: string
          code?: string
        }
        const errorDetails = pgError.details || pgError.hint || pgError.code
        if (errorDetails) {
          errorMessage += ` (Details: ${errorDetails})`
        }
      }

      toast.error(errorMessage, {
        duration: 6000,
        description: 'Check console for technical details',
      })
    },
  })

  // Get putback tickets
  const {
    data: putbackTickets = [],
    isLoading: isLoadingTickets,
    error: ticketsError,
  } = useQuery({
    queryKey: ['putback-tickets'],
    queryFn: () => service.getPutbackTickets(),
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refresh every minute
  })

  // Get putback statistics
  const {
    data: putbackStats,
    isLoading: isLoadingStats,
    error: statsError,
  } = useQuery({
    queryKey: ['putback-stats'],
    queryFn: () => service.getPutbackStats(),
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refresh every minute
  })

  // Update putback ticket status
  const updateTicketStatusMutation = useMutation({
    mutationFn: ({
      ticketId,
      status,
    }: {
      ticketId: string
      status: Database['public']['Enums']['putback_status']
    }) => service.updatePutbackTicketStatus(ticketId, status),
    onSuccess: (data) => {
      toast.success(
        `Putback ticket ${data.putback_number} status updated to ${data.status}`
      )
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['putback-tickets'] })
      queryClient.invalidateQueries({ queryKey: ['putback-stats'] })
    },
    onError: (error) => {
      logger.error('Failed to update putback ticket status:', error)
      toast.error('Failed to update ticket status')
    },
  })

  return {
    // Mutations
    validateDelivery: validateDeliveryMutation.mutate,
    validateDeliveryAsync: validateDeliveryMutation.mutateAsync,
    isValidatingDelivery: validateDeliveryMutation.isPending,

    createPutbackTicket: createPutbackTicketMutation.mutate,
    createPutbackTicketAsync: createPutbackTicketMutation.mutateAsync,
    isCreatingTicket: createPutbackTicketMutation.isPending,

    updateTicketStatus: updateTicketStatusMutation.mutate,
    updateTicketStatusAsync: updateTicketStatusMutation.mutateAsync,
    isUpdatingStatus: updateTicketStatusMutation.isPending,

    // Data
    putbackTickets,
    isLoadingTickets,
    ticketsError,

    // Statistics
    putbackStats,
    isLoadingStats,
    statsError,

    // Utils
    refreshTickets: () =>
      queryClient.invalidateQueries({ queryKey: ['putback-tickets'] }),
    refreshStats: () =>
      queryClient.invalidateQueries({ queryKey: ['putback-stats'] }),
  }
}

// ==================== ORIGINAL OUTBOUND DATA HOOK ====================

/**
 * Hook for managing outbound TO data with real-time subscriptions
 */
export function useOutboundTOData({
  searchQuery = '',
  enableRealtime = true,
}: UseOutboundTODataOptions = {}) {
  logger.log('🚀 useOutboundTOData Hook: INSTANTIATED with params:', {
    searchQuery,
    enableRealtime,
  })

  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const { profile, isLoading: authLoading, isAuthenticated } = authState

  // Debug the enabled condition values
  useEffect(() => {
    logger.log('🐛 useOutboundTOData Hook Debug:', {
      authLoading,
      isAuthenticated,
      hasProfile: !!profile,
      organizationId: profile?.organization_id,
      organizationIdType: typeof profile?.organization_id,
      organizationIdExists:
        profile?.organization_id !== null &&
        profile?.organization_id !== undefined,
      profileKeys: profile ? Object.keys(profile) : 'no profile',
      enabledCondition:
        !authLoading && isAuthenticated && !!profile?.organization_id,
      queryKey: ['outbound-data', searchQuery, profile?.organization_id],
    })

    // Additional debugging for profile structure
    if (profile) {
      logger.log('🔍 Full Profile Object:', JSON.stringify(profile, null, 2))
    }
  }, [authLoading, isAuthenticated, profile, searchQuery])
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null)
  const [searchQueryState, setSearchQueryState] = useState(searchQuery)
  const [columnOrder, setColumnOrder] = useState<string[]>([])

  // Update search query state when prop changes
  useEffect(() => {
    setSearchQueryState(searchQuery)
  }, [searchQuery])

  // Optimized outbound data query with better caching
  logger.log(
    '🔧 useOutboundTOData: Setting up main data query with enabled condition:',
    !authLoading && isAuthenticated && !!profile?.organization_id
  )

  const {
    data: outboundData = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['outbound-data', searchQuery, profile?.organization_id],
    queryFn: async () => {
      logger.log('🎯 useOutboundTOData: Query function executing!', {
        searchQuery,
      })
      if (searchQuery) {
        return service.searchOutboundData(searchQuery)
      }
      return service.fetchOutboundData()
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - increased for better performance
    gcTime: 10 * 60 * 1000, // 10 minutes garbage collection
    enabled: !authLoading && isAuthenticated && !!profile?.organization_id,
    retry: 2, // Reduce retry attempts
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })

  // Optimized statistics query with longer cache time
  logger.log(
    '📊 useOutboundTOData: Setting up statistics query with enabled condition:',
    !authLoading && isAuthenticated && !!profile?.organization_id
  )

  const { data: statistics, isLoading: isLoadingStats } = useQuery({
    queryKey: ['outbound-data-stats', profile?.organization_id],
    queryFn: () => {
      logger.log('📈 useOutboundTOData: Statistics query function executing!')
      return service.getStatistics()
    },
    staleTime: 10 * 60 * 1000, // 10 minutes - statistics change less frequently
    gcTime: 15 * 60 * 1000, // 15 minutes garbage collection
    enabled: !authLoading && isAuthenticated && !!profile?.organization_id,
    retry: 1, // Reduce retry for stats
  })

  // Import from clipboard mutation
  const importMutation = useMutation({
    mutationFn: () => service.importFromClipboard(),
    onSuccess: (result: ImportResult) => {
      if (result.success) {
        toast.success(
          `Import completed: ${result.insertedRows} inserted, ${result.duplicateRows} duplicates skipped`
        )
        queryClient.invalidateQueries({ queryKey: ['outbound-data'] })
        queryClient.invalidateQueries({ queryKey: ['outbound-data-stats'] })
      } else {
        toast.error(`Import failed: ${result.errors.join(', ')}`)
      }
    },
    onError: (error) => {
      logger.error('Import failed:', error)
      toast.error('Failed to import data from clipboard')
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => service.deleteOutboundData(id),
    onSuccess: () => {
      toast.success('Record deleted successfully')
      queryClient.invalidateQueries({ queryKey: ['outbound-data'] })
      queryClient.invalidateQueries({ queryKey: ['outbound-data-stats'] })
    },
    onError: (error) => {
      logger.error('Delete failed:', error)
      toast.error('Failed to delete record')
    },
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<OutboundTOData>
    }) => service.updateOutboundData(id, updates),
    onSuccess: () => {
      toast.success('Record updated successfully')
      queryClient.invalidateQueries({ queryKey: ['outbound-data'] })
    },
    onError: (error) => {
      logger.error('Update failed:', error)
      toast.error('Failed to update record')
    },
  })

  // Status update mutation
  const updateStatusMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string
      status: Database['public']['Enums']['outbound_status']
    }) => service.updateStatus(id, status),
    onSuccess: (data) => {
      toast.success(`Status updated to ${data.status}`)
      queryClient.invalidateQueries({ queryKey: ['outbound-data'] })
      queryClient.invalidateQueries({ queryKey: ['outbound-data-stats'] })
    },
    onError: (error) => {
      logger.error('Status update failed:', error)
      toast.error('Failed to update status')
    },
  })

  // Debounced query invalidation to prevent cascade invalidations
  const debouncedInvalidateRef = useRef<NodeJS.Timeout | null>(null)

  const debouncedInvalidateQueries = () => {
    // Clear existing timeout
    if (debouncedInvalidateRef.current) {
      clearTimeout(debouncedInvalidateRef.current)
    }

    // Set new timeout for batched invalidation
    debouncedInvalidateRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['outbound-data'] })
      queryClient.invalidateQueries({ queryKey: ['outbound-data-stats'] })
    }, 300) // 300ms debounce
  }

  // Real-time subscription with optimized performance
  useEffect(() => {
    if (!enableRealtime || !profile?.organization_id) return

    // Clean up any existing subscription
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe()
    }

    // Set up new subscription with performance optimizations
    subscriptionRef.current = supabase
      .channel('outbound_to_data_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'outbound_to_data',
          filter: `organization_id=eq.${profile.organization_id}`,
        },
        (payload) => {
          // Use debounced invalidation to prevent cascade invalidations
          debouncedInvalidateQueries()

          // Show toast for changes made by other users (with throttling)
          const currentUserId = profile?.id
          const newRecord = payload.new as OutboundTOData | null
          if (newRecord && newRecord.uploaded_by !== currentUserId) {
            const eventType = payload.eventType
            const delivery = newRecord.delivery || 'Unknown'

            // Throttled toast notifications to prevent spam
            const toastKey = `${eventType}-${delivery}`
            const lastToastTime = sessionStorage.getItem(`toast-${toastKey}`)
            const now = Date.now()

            if (!lastToastTime || now - parseInt(lastToastTime) > 2000) {
              sessionStorage.setItem(`toast-${toastKey}`, now.toString())

              switch (eventType) {
                case 'INSERT':
                  toast.info(`New delivery ${delivery} added by another user`)
                  break
                case 'UPDATE':
                  toast.info(`Delivery ${delivery} updated by another user`)
                  break
                case 'DELETE':
                  toast.info(`Delivery deleted by another user`)
                  break
              }
            }
          }
        }
      )
      .subscribe()

    // Cleanup on unmount
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
      }
      // Clear debounce timeout on cleanup
      if (debouncedInvalidateRef.current) {
        clearTimeout(debouncedInvalidateRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Realtime subscription setup; debouncedInvalidateQueries is a stable ref-based helper, profile?.id is captured in closure
  }, [profile?.organization_id, enableRealtime, queryClient])

  // Save column order function
  const saveColumnOrder = async (newOrder: string[]) => {
    try {
      await service.saveColumnOrder(newOrder)
      setColumnOrder(newOrder)
      toast.success('Column order saved')
    } catch (error) {
      logger.error('Failed to save column order:', error)
      toast.error('Failed to save column order')
    }
  }

  return {
    // Data
    data: outboundData, // Legacy alias
    outboundData,
    statistics,
    isLoading,
    isLoadingStats,
    error,

    // Search functionality
    searchQuery: searchQueryState,
    setSearchQuery: setSearchQueryState,

    // Column management
    columnOrder,
    setColumnOrder,
    saveColumnOrder,

    // Mutations
    importFromClipboard: importMutation.mutate,
    isImporting: importMutation.isPending,
    deleteRecord: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
    updateRecord: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
    updateStatus: updateStatusMutation.mutate,
    isUpdatingStatus: updateStatusMutation.isPending,

    // Utils
    refetch,
    refreshData: () => {
      queryClient.invalidateQueries({ queryKey: ['outbound-data'] })
      queryClient.invalidateQueries({ queryKey: ['outbound-data-stats'] })
    },

    // Rust core status
    isUsingRust: RUST_CORE_ENABLED,
  }
}

// Created and developed by Jai Singh
