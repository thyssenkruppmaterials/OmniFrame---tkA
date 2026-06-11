// Created and developed by Jai Singh
/**
 * CubiScan React Query Hook
 * Provides paginated search, statistics, device listing, mutations,
 * and org-scoped realtime invalidation for the CubiScan workspace.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type {
  CubiScanSearchParams,
  CubiScanPaginatedResult,
  CubiScanStatistics,
  CubiScanDevice,
  CubiScanMeasurement,
  MeasurementStatus,
  ReconciliationStatus,
  ReconciliationActionType,
  CubiScanQuickView,
} from '@/lib/cubiscan/types'
import { supabase } from '@/lib/supabase/client'
import { cubiscanService } from '@/lib/supabase/cubiscan.service'

export const CUBISCAN_MEASUREMENTS_KEY = 'cubiscan-measurements'
export const CUBISCAN_STATISTICS_KEY = 'cubiscan-statistics'
export const CUBISCAN_DEVICES_KEY = 'cubiscan-devices'

const INVALIDATION_DEBOUNCE_MS = 2000
const MIN_INVALIDATION_INTERVAL_MS = 5000

export interface UseCubiScanProps {
  enableRealtime?: boolean
  initialPage?: number
  pageSize?: number
}

export interface UseCubiScanReturn {
  measurements: CubiScanMeasurement[]
  totalRecords: number
  currentPage: number
  totalPages: number
  pageSize: number
  setCurrentPage: (page: number) => void

  statistics: CubiScanStatistics | null
  devices: CubiScanDevice[]

  searchQuery: string
  setSearchQuery: (q: string) => void
  measurementStatusFilter: MeasurementStatus | undefined
  setMeasurementStatusFilter: (s: MeasurementStatus | undefined) => void
  reconciliationStatusFilter: ReconciliationStatus | undefined
  setReconciliationStatusFilter: (s: ReconciliationStatus | undefined) => void
  deviceFilter: string | undefined
  setDeviceFilter: (d: string | undefined) => void
  quickView: CubiScanQuickView
  setQuickView: (v: CubiScanQuickView) => void

  isLoading: boolean
  isFetching: boolean
  isPageTransition: boolean
  isLoadingStatistics: boolean
  error: Error | null

  reconcile: (
    measurementId: string,
    actionType: ReconciliationActionType,
    reason?: string
  ) => Promise<void>
  isReconciling: boolean

  refetch: () => void
}

export function useCubiScan({
  enableRealtime = false,
  initialPage = 1,
  pageSize: initialPageSize = 25,
}: UseCubiScanProps = {}): UseCubiScanReturn {
  const { authState } = useUnifiedAuth()
  const profile = authState?.profile
  const orgId = profile?.organization_id
  const queryClient = useQueryClient()

  const [currentPage, setCurrentPage] = useState(initialPage)
  const [pageSize] = useState(initialPageSize)
  const [searchQuery, setSearchQuery] = useState('')
  const [measurementStatusFilter, setMeasurementStatusFilter] = useState<
    MeasurementStatus | undefined
  >()
  const [reconciliationStatusFilter, setReconciliationStatusFilter] = useState<
    ReconciliationStatus | undefined
  >()
  const [deviceFilter, setDeviceFilter] = useState<string | undefined>()
  const [quickView, setQuickViewState] = useState<CubiScanQuickView>('all')

  const lastInvalidation = useRef(0)
  const invalidationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(
    null
  )

  const setQuickView = useCallback((view: CubiScanQuickView) => {
    setQuickViewState(view)
    setCurrentPage(1)
    switch (view) {
      case 'needs_review':
        setReconciliationStatusFilter('pending' as ReconciliationStatus)
        setMeasurementStatusFilter(undefined)
        break
      case 'failed':
        setMeasurementStatusFilter('parse_failed' as MeasurementStatus)
        setReconciliationStatusFilter(undefined)
        break
      case 'all':
      default:
        setMeasurementStatusFilter(undefined)
        setReconciliationStatusFilter(undefined)
        break
    }
  }, [])

  const searchParams: CubiScanSearchParams = useMemo(
    () => ({
      page: currentPage,
      pageSize,
      search: searchQuery || undefined,
      measurement_status: measurementStatusFilter,
      reconciliation_status: reconciliationStatusFilter,
      device_id: deviceFilter,
    }),
    [
      currentPage,
      pageSize,
      searchQuery,
      measurementStatusFilter,
      reconciliationStatusFilter,
      deviceFilter,
    ]
  )

  const measurementsQuery = useQuery({
    queryKey: [CUBISCAN_MEASUREMENTS_KEY, orgId, searchParams],
    queryFn: () => cubiscanService.searchMeasurements(searchParams),
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })

  const statisticsQuery = useQuery({
    queryKey: [CUBISCAN_STATISTICS_KEY, orgId],
    queryFn: () => cubiscanService.getStatistics(),
    enabled: !!orgId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  })

  const devicesQuery = useQuery({
    queryKey: [CUBISCAN_DEVICES_KEY, orgId],
    queryFn: () => cubiscanService.listDevices(),
    enabled: !!orgId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const reconcileMutation = useMutation({
    mutationFn: ({
      measurementId,
      actionType,
      reason,
    }: {
      measurementId: string
      actionType: ReconciliationActionType
      reason?: string
    }) => cubiscanService.reconcile(measurementId, actionType, reason),
    onSuccess: () => {
      toast.success('Reconciliation action completed')
      queryClient.invalidateQueries({
        queryKey: [CUBISCAN_MEASUREMENTS_KEY],
        refetchType: 'none',
      })
      queryClient.invalidateQueries({
        queryKey: [CUBISCAN_STATISTICS_KEY],
        refetchType: 'none',
      })
      measurementsQuery.refetch()
      statisticsQuery.refetch()
    },
    onError: (err: Error) => {
      toast.error(`Reconciliation failed: ${err.message}`)
    },
  })

  const { refetch: refetchMeasurements } = measurementsQuery
  const { refetch: refetchStatistics } = statisticsQuery

  const debouncedInvalidate = useCallback(() => {
    const now = Date.now()
    if (now - lastInvalidation.current < MIN_INVALIDATION_INTERVAL_MS) return

    if (invalidationTimeout.current) clearTimeout(invalidationTimeout.current)
    invalidationTimeout.current = setTimeout(() => {
      lastInvalidation.current = Date.now()
      queryClient.invalidateQueries({
        queryKey: [CUBISCAN_MEASUREMENTS_KEY],
        refetchType: 'none',
      })
      queryClient.invalidateQueries({
        queryKey: [CUBISCAN_STATISTICS_KEY],
        refetchType: 'none',
      })
      refetchMeasurements()
      refetchStatistics()
    }, INVALIDATION_DEBOUNCE_MS)
  }, [queryClient, refetchMeasurements, refetchStatistics])

  useEffect(() => {
    if (!enableRealtime || !orgId) return

    const channel = supabase
      .channel(`cubiscan-measurements-${orgId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'cubiscan_measurements',
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          debouncedInvalidate()
        }
      )
      .subscribe()

    subscriptionRef.current = channel

    return () => {
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current)
        subscriptionRef.current = null
      }
      if (invalidationTimeout.current) {
        clearTimeout(invalidationTimeout.current)
      }
    }
  }, [enableRealtime, orgId, debouncedInvalidate])

  const result = measurementsQuery.data as CubiScanPaginatedResult | undefined

  return {
    measurements: result?.data ?? [],
    totalRecords: result?.total ?? 0,
    currentPage: result?.page ?? currentPage,
    totalPages: result?.totalPages ?? 0,
    pageSize,
    setCurrentPage,

    statistics: (statisticsQuery.data as CubiScanStatistics) ?? null,
    devices: (devicesQuery.data as CubiScanDevice[]) ?? [],

    searchQuery,
    setSearchQuery: (q: string) => {
      setSearchQuery(q)
      setCurrentPage(1)
    },
    measurementStatusFilter,
    setMeasurementStatusFilter: (s) => {
      setMeasurementStatusFilter(s)
      setCurrentPage(1)
    },
    reconciliationStatusFilter,
    setReconciliationStatusFilter: (s) => {
      setReconciliationStatusFilter(s)
      setCurrentPage(1)
    },
    deviceFilter,
    setDeviceFilter: (d) => {
      setDeviceFilter(d)
      setCurrentPage(1)
    },
    quickView,
    setQuickView,

    isLoading: measurementsQuery.isLoading,
    isFetching: measurementsQuery.isFetching,
    isPageTransition: measurementsQuery.isPlaceholderData,
    isLoadingStatistics: statisticsQuery.isLoading,
    error: measurementsQuery.error as Error | null,

    reconcile: async (
      measurementId: string,
      actionType: ReconciliationActionType,
      reason?: string
    ) => {
      await reconcileMutation.mutateAsync({
        measurementId,
        actionType,
        reason,
      })
    },
    isReconciling: reconcileMutation.isPending,

    refetch: () => {
      measurementsQuery.refetch()
      statisticsQuery.refetch()
      devicesQuery.refetch()
    },
  }
}

// Created and developed by Jai Singh
