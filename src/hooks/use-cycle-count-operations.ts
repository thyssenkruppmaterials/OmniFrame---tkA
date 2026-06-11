// Created and developed by Jai Singh
import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import {
  cycleCountService,
  type CycleCountData,
  type CycleCountDataWithUser,
  type CycleCountPriority,
  type CycleCountStatistics,
  type ImportProgress,
} from '@/lib/supabase/cycle-count.service'
import { logger } from '@/lib/utils/logger'
import type { WsEvent, WsEventHandler } from '@/lib/work-service'
import { workServiceWs } from '@/lib/work-service/websocket'
import {
  ACTIVE_ZONES_QUERY_KEY,
  ZONE_ASSIGNMENTS_QUERY_KEY,
} from '@/hooks/use-zone-rules'

export interface UseCycleCountOperationsProps {
  enableRealtime?: boolean
  searchQuery?: string
}

export interface UseCycleCountOperationsReturn {
  // Data
  data: CycleCountDataWithUser[]
  filteredData: CycleCountDataWithUser[]
  statistics: CycleCountStatistics | null

  // Loading states
  isLoading: boolean
  isLoadingStatistics: boolean
  isImporting: boolean

  // Error states
  error: Error | null
  statisticsError: Error | null

  // Import functionality
  importProgress: ImportProgress | null
  importFromClipboard: (countType?: string) => Promise<void>

  // Search functionality
  searchQuery: string
  setSearchQuery: (query: string) => void

  // CRUD operations
  createCycleCount: (cycleCountData: Partial<CycleCountData>) => Promise<void>
  createMultipleCycleCounts: (
    countsData: Array<Partial<CycleCountData>>
  ) => Promise<void>
  updateCycleCount: (
    id: string,
    updates: Partial<CycleCountData>
  ) => Promise<void>
  deleteCycleCount: (id: string) => Promise<void>
  approveCycleCount: (id: string, approvalComments?: string) => Promise<void>
  markForRecount: (id: string, reason?: string) => Promise<void>
  initiateRecount: (id: string, reason?: string) => Promise<void>
  completeRecount: (
    id: string,
    newCountedQuantity: number,
    recountBy: string
  ) => Promise<void>

  // Assignment operations.
  // Migration 253 review: pass `{ silent: true }` from a bulk caller to
  // suppress the per-row success toast. Default false preserves the
  // single-row dashboard behavior.
  assignCountToUser: (
    countId: string,
    userId: string,
    options?: { silent?: boolean }
  ) => Promise<void>
  unassignCount: (
    countId: string,
    options?: { silent?: boolean }
  ) => Promise<void>
  assignNextCount: (
    userId: string
  ) => Promise<{ success: boolean; data?: unknown; error: unknown }>

  // Priority operations
  updateCycleCountPriority: (
    countId: string,
    priority: CycleCountPriority,
    options?: { silent?: boolean }
  ) => Promise<void>

  // Utility functions
  refreshData: () => void
  exportToCSV: () => string
}

// Query keys for React Query (exported for use in WebSocket invalidation)
export const CYCLE_COUNT_OPERATIONS_QUERY_KEY = 'cycle-count-operations'
export const CYCLE_COUNT_STATISTICS_QUERY_KEY = 'cycle-count-statistics'

export function useCycleCountOperations({
  enableRealtime = true,
  searchQuery: initialSearchQuery = '',
}: UseCycleCountOperationsProps = {}): UseCycleCountOperationsReturn {
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null
  )
  const [isImporting, setIsImporting] = useState(false)

  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()

  // Fetch cycle count operations
  const {
    data: rawData = [],
    isLoading,
    error,
    refetch: refetchOperations,
  } = useQuery({
    queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
    queryFn: async () => {
      const result = await cycleCountService.fetchCycleCountData()
      if (result.error) {
        throw new Error(
          result.error.message || 'Failed to fetch cycle count data'
        )
      }
      return result.data
    },
    staleTime: 30000, // 30 seconds
    refetchInterval: enableRealtime ? 60000 : false, // 1 minute if real-time enabled
  })

  // Fetch statistics
  const {
    data: statistics = null,
    isLoading: isLoadingStatistics,
    error: statisticsError,
    refetch: refetchStatistics,
  } = useQuery({
    queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
    queryFn: async () => {
      const result = await cycleCountService.fetchStatistics()
      if (result.error) {
        throw new Error(
          result.error.message || 'Failed to fetch cycle count statistics'
        )
      }
      return result.statistics
    },
    staleTime: 60000, // 1 minute
    refetchInterval: enableRealtime ? 300000 : false, // 5 minutes if real-time enabled
  })

  // Real-time subscription for cycle count data.
  //
  // 2026-05-06 — Tier 1 deferred-channel migration. Replaces the
  // org-filtered `supabase.channel('cycle-count-changes-{orgId}')`
  // listener with a typed `WsEvent::CycleCountOperationChanged` push
  // through `WorkServiceWebSocket`.
  //
  //   - DB:   migration 273 adds the NOTIFY trigger on
  //           rr_cyclecount_data.
  //   - Rust: `cycle_count_listener` consumes
  //           `LISTEN cycle_count_data_changed`.
  //   - FE:   THIS effect registers a single handler on the singleton.
  //           Each push invalidates the same TanStack queries the
  //           previous channel did. The 5-min safety-net poll fires
  //           ONLY when the WS isn't currently connected, so the happy
  //           path is zero round-trips.
  useEffect(() => {
    if (!enableRealtime || !authState.user) return
    const userOrgId = authState.profile?.organization_id
    if (!userOrgId) {
      logger.warn(
        '⚠️ No organization ID found for user, skipping real-time subscription'
      )
      return
    }

    const invalidate = () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
    }

    const handler: WsEventHandler = (event: WsEvent) => {
      if (event.type !== 'CycleCountOperationChanged') return
      // Belt-and-braces org check — defence-in-depth on top of the
      // Rust send-loop's deny-by-default org filter.
      if (event.organization_id && event.organization_id !== userOrgId) return
      logger.log(
        '🔄 Cycle count data change detected (WS push):',
        event.row_id,
        event.op
      )
      invalidate()
    }

    try {
      workServiceWs.connect(userOrgId, handler)
    } catch {
      /* WS setup failure — fall back to safety-net polling only. */
    }

    // Safety-net poll: re-invalidate every 5 min if the WS isn't
    // currently in `connected` state. Combined with TanStack Query's
    // own `refetchInterval: 60000` for the underlying queries, this is
    // a backstop, not the primary refresh path.
    const SAFETY_NET_INTERVAL_MS = 5 * 60_000
    const safetyNet = setInterval(() => {
      if (workServiceWs.getConnectionState() === 'connected') return
      invalidate()
    }, SAFETY_NET_INTERVAL_MS)

    return () => {
      clearInterval(safetyNet)
      try {
        workServiceWs.removeHandler(handler)
      } catch {
        /* ignore */
      }
    }
  }, [
    enableRealtime,
    authState.user,
    authState.profile?.organization_id,
    queryClient,
  ])

  const filteredData = rawData.filter((item: CycleCountData) => {
    if (!searchQuery) return true

    const searchTerm = searchQuery.trim().toLowerCase()
    if (!searchTerm) return true

    // Match any string-ish field (substring, case-insensitive).
    const s = (v: string | number | null | undefined) =>
      v != null && String(v).toLowerCase().includes(searchTerm)

    // Match any of the string items in an array field.
    const sArr = (arr: unknown) =>
      Array.isArray(arr) && arr.some((v) => typeof v === 'string' && s(v))

    // scanned_parts is a JSONB array of
    // `{ part_number, quantity, method, captured_at }` entries captured
    // during Part Verification. Search every part number inside it so
    // supervisors can find a specific part variance by its FOUND part
    // number (e.g. user types "23031780" to locate a Part Variance row).
    const sScannedParts = (raw: unknown) => {
      if (!Array.isArray(raw)) return false
      for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue
        const asObj = entry as Record<string, unknown>
        if (
          s(asObj.part_number as string | number | null | undefined) ||
          s(asObj.material_number as string | number | null | undefined) ||
          s(asObj.quantity as string | number | null | undefined) ||
          s(asObj.method as string | null | undefined)
        ) {
          return true
        }
      }
      return false
    }

    // Numeric exact-match: supervisors sometimes search "+10" or "10" to
    // find counts with a specific variance / counted qty.
    const asNumber = Number(searchTerm)
    const sNum = (v: number | null | undefined) =>
      !Number.isNaN(asNumber) && v != null && v === asNumber

    // Prefix match on UUID (first 8 chars shown in UI).
    const sId = (v: string | null | undefined) =>
      !!v && v.toLowerCase().startsWith(searchTerm)

    return (
      // Identifiers
      s(item.count_number) ||
      sId(item.id) ||
      // Part identity
      s(item.material_number) ||
      s(item.material_description) ||
      s(item.batch_number) ||
      // Part verification / multi-part capture
      s(
        (item as Record<string, unknown>).scanned_material_number as
          | string
          | null
          | undefined
      ) ||
      sScannedParts((item as Record<string, unknown>).scanned_parts) ||
      sArr((item as Record<string, unknown>).serial_numbers) ||
      // Location
      s(item.location) ||
      s((item as Record<string, unknown>).zone as string | null | undefined) ||
      s(
        (item as Record<string, unknown>).resolved_zone as
          | string
          | null
          | undefined
      ) ||
      s(
        (item as Record<string, unknown>).resolved_aisle as
          | string
          | null
          | undefined
      ) ||
      s(
        (item as Record<string, unknown>).transfer_destination_location as
          | string
          | null
          | undefined
      ) ||
      s(item.warehouse) ||
      // People + workflow
      s(item.counter_name) ||
      s(item.count_type) ||
      s(item.status) ||
      s(
        (item as Record<string, unknown>).priority as string | null | undefined
      ) ||
      s(
        (item as Record<string, unknown>).resolution_source as
          | string
          | null
          | undefined
      ) ||
      s((item as any).assigned_to_user?.full_name) ||
      s((item as any).assigned_to_user?.email) ||
      s((item as any).created_by_user?.full_name) ||
      s((item as any).approved_by_user?.full_name) ||
      // Free text
      s(item.notes as string | null | undefined) ||
      // Dates (formatted as stored strings)
      s(item.count_date) ||
      s(
        (item as Record<string, unknown>).assigned_at as
          | string
          | null
          | undefined
      ) ||
      s(
        (item as Record<string, unknown>).completed_at as
          | string
          | null
          | undefined
      ) ||
      // Numeric exact matches
      sNum(item.counted_quantity as number | null | undefined) ||
      sNum(item.system_quantity as number | null | undefined) ||
      sNum(
        (item as Record<string, unknown>).variance_quantity as
          | number
          | null
          | undefined
      ) ||
      sNum(
        (item as Record<string, unknown>).transfer_source_quantity as
          | number
          | null
          | undefined
      )
    )
  })

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (cycleCountData: Partial<CycleCountData>) => {
      const result = await cycleCountService.createCycleCount(cycleCountData)
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to create cycle count')
      }
      return result.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
      toast.success('Cycle count created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create cycle count: ${error.message}`)
    },
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<CycleCountData>
    }) => {
      const result = await cycleCountService.updateCycleCount(id, updates)
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to update cycle count')
      }
      return result.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
      toast.success('Cycle count updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update cycle count: ${error.message}`)
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const result = await cycleCountService.deleteCycleCount(id)
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to delete cycle count')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
      toast.success('Cycle count deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete cycle count: ${error.message}`)
    },
  })

  // Approval mutation
  const approveMutation = useMutation({
    mutationFn: async ({
      id,
      approvalComments,
    }: {
      id: string
      approvalComments?: string
    }) => {
      const result = await cycleCountService.approveCycleCount(
        id,
        approvalComments
      )
      if (!result.success) {
        throw new Error(
          result.error?.message || 'Failed to approve cycle count'
        )
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
      toast.success('Cycle count approved successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to approve cycle count: ${error.message}`)
    },
  })

  // Mark for recount mutation
  const recountMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const result = await cycleCountService.markForRecount(id, reason)
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to mark for recount')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
      toast.success('Marked for recount successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to mark for recount: ${error.message}`)
    },
  })

  // Initiate recount mutation
  const initiateRecountMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const result = await cycleCountService.initiateRecount(id, reason)
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to initiate recount')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
      toast.success('Recount initiated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to initiate recount: ${error.message}`)
    },
  })

  // Complete recount mutation
  const completeRecountMutation = useMutation({
    mutationFn: async ({
      id,
      newCountedQuantity,
      recountBy,
    }: {
      id: string
      newCountedQuantity: number
      recountBy: string
    }) => {
      const result = await cycleCountService.completeRecount(
        id,
        newCountedQuantity,
        recountBy
      )
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to complete recount')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
      })
      toast.success('Recount completed successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to complete recount: ${error.message}`)
    },
  })

  // Import from clipboard functionality
  const importFromClipboard = useCallback(
    async (countType?: string) => {
      try {
        setIsImporting(true)
        setImportProgress({
          total: 0,
          processed: 0,
          errors: [],
          isComplete: false,
        })

        const clipboardText = await navigator.clipboard.readText()
        if (!clipboardText.trim()) {
          toast.error('Clipboard is empty')
          return
        }

        const result = await cycleCountService.importFromClipboard(
          clipboardText,
          setImportProgress,
          countType
        )

        if (result.success) {
          toast.success('Data imported successfully')
          refetchOperations()
          refetchStatistics()
        } else {
          toast.error(`Import failed with ${result.errors.length} errors`)
          logger.error('Import errors:', result.errors)
        }
      } catch (error) {
        toast.error('Failed to import data')
        logger.error('Import error:', error)
      } finally {
        setIsImporting(false)
        setTimeout(() => setImportProgress(null), 3000) // Clear progress after 3 seconds
      }
    },
    [refetchOperations, refetchStatistics]
  )

  // Utility functions
  const refreshData = useCallback(() => {
    refetchOperations()
    refetchStatistics()
  }, [refetchOperations, refetchStatistics])

  const exportToCSV = useCallback(() => {
    return cycleCountService.exportToCSV(filteredData)
  }, [filteredData])

  // Destructure mutateAsync from mutations for stable dependency references
  const { mutateAsync: createMutateAsync } = createMutation
  const { mutateAsync: updateMutateAsync } = updateMutation
  const { mutateAsync: deleteMutateAsync } = deleteMutation
  const { mutateAsync: approveMutateAsync } = approveMutation
  const { mutateAsync: recountMutateAsync } = recountMutation
  const { mutateAsync: initiateRecountMutateAsync } = initiateRecountMutation
  const { mutateAsync: completeRecountMutateAsync } = completeRecountMutation

  // CRUD operation wrappers
  const createCycleCount = useCallback(
    async (cycleCountData: Partial<CycleCountData>) => {
      await createMutateAsync(cycleCountData)
    },
    [createMutateAsync]
  )

  const createMultipleCycleCounts = useCallback(
    async (countsData: Array<Partial<CycleCountData>>) => {
      const result =
        await cycleCountService.createMultipleCycleCounts(countsData)
      if (result.success) {
        toast.success(
          `Successfully created ${result.successCount} cycle counts`
        )
        queryClient.invalidateQueries({
          queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
        })
        queryClient.invalidateQueries({
          queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
        })
      } else {
        toast.error(
          `Failed to create cycle counts: ${result.error?.message || 'Unknown error'}`
        )
        throw result.error
      }
    },
    [queryClient]
  )

  const updateCycleCount = useCallback(
    async (id: string, updates: Partial<CycleCountData>) => {
      await updateMutateAsync({ id, updates })
    },
    [updateMutateAsync]
  )

  const deleteCycleCount = useCallback(
    async (id: string) => {
      await deleteMutateAsync(id)
    },
    [deleteMutateAsync]
  )

  const approveCycleCount = useCallback(
    async (id: string, approvalComments?: string) => {
      await approveMutateAsync({ id, approvalComments })
    },
    [approveMutateAsync]
  )

  const markForRecount = useCallback(
    async (id: string, reason?: string) => {
      await recountMutateAsync({ id, reason })
    },
    [recountMutateAsync]
  )

  const initiateRecount = useCallback(
    async (id: string, reason?: string) => {
      await initiateRecountMutateAsync({ id, reason })
    },
    [initiateRecountMutateAsync]
  )

  const completeRecount = useCallback(
    async (id: string, newCountedQuantity: number, recountBy: string) => {
      await completeRecountMutateAsync({
        id,
        newCountedQuantity,
        recountBy,
      })
    },
    [completeRecountMutateAsync]
  )

  // Assignment mutations.
  //
  // Migration 253 review: ALSO invalidate ACTIVE_ZONES + ZONE_ASSIGNMENTS
  // query keys — assigning/unassigning a count changes the zone-holder
  // graph, and the dashboard's "active zones" / "zone assignments"
  // panels (and the Push panel's preflight) must reflect that without
  // waiting for the next periodic refetch.
  //
  // The `silent` option suppresses the per-row toast. Bulk callers
  // (e.g. mass-assign in manual-counts-search) pass `{ silent: true }`
  // so the user sees one aggregate toast instead of N per-row toasts.
  const invalidateAssignmentQueries = () => {
    queryClient.invalidateQueries({
      queryKey: [CYCLE_COUNT_OPERATIONS_QUERY_KEY],
    })
    queryClient.invalidateQueries({
      queryKey: [CYCLE_COUNT_STATISTICS_QUERY_KEY],
    })
    queryClient.invalidateQueries({ queryKey: ACTIVE_ZONES_QUERY_KEY })
    queryClient.invalidateQueries({ queryKey: ZONE_ASSIGNMENTS_QUERY_KEY })
  }

  const assignCountMutation = useMutation({
    mutationFn: async ({
      countId,
      userId,
    }: {
      countId: string
      userId: string
      silent?: boolean
    }) => {
      const result = await cycleCountService.assignCountToUser(countId, userId)
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to assign count')
      }
      return result
    },
    onSuccess: (_data, variables) => {
      invalidateAssignmentQueries()
      if (!variables.silent) {
        toast.success('Cycle count assigned successfully')
      }
    },
    onError: (error: Error, variables) => {
      if (!variables.silent) {
        toast.error(`Failed to assign count: ${error.message}`)
      }
    },
  })

  const unassignCountMutation = useMutation({
    mutationFn: async ({ countId }: { countId: string; silent?: boolean }) => {
      const result = await cycleCountService.unassignCount(countId)
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to unassign count')
      }
      return result
    },
    onSuccess: (_data, variables) => {
      invalidateAssignmentQueries()
      if (!variables.silent) {
        toast.success('Cycle count unassigned successfully')
      }
    },
    onError: (error: Error, variables) => {
      if (!variables.silent) {
        toast.error(`Failed to unassign count: ${error.message}`)
      }
    },
  })

  const { mutateAsync: assignCountMutateAsync } = assignCountMutation
  const { mutateAsync: unassignCountMutateAsync } = unassignCountMutation

  const assignCountToUser = useCallback(
    async (countId: string, userId: string, options?: { silent?: boolean }) => {
      await assignCountMutateAsync({
        countId,
        userId,
        silent: options?.silent ?? false,
      })
    },
    [assignCountMutateAsync]
  )

  const unassignCount = useCallback(
    async (countId: string, options?: { silent?: boolean }) => {
      await unassignCountMutateAsync({
        countId,
        silent: options?.silent ?? false,
      })
    },
    [unassignCountMutateAsync]
  )

  const assignNextCount = useCallback(async (userId: string) => {
    return await cycleCountService.assignNextCount(userId)
  }, [])

  // Priority mutations.
  // Migration 253 review: invalidate ACTIVE_ZONES too — a priority bump
  // changes the dashboard ordering and the Pull Next preview, both of
  // which read off the active-zone view indirectly through the work
  // queue.
  const updatePriorityMutation = useMutation({
    mutationFn: async ({
      countId,
      priority,
    }: {
      countId: string
      priority: CycleCountPriority
      silent?: boolean
    }) => {
      const result = await cycleCountService.updateCycleCountPriority(
        countId,
        priority
      )
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to update priority')
      }
      return result
    },
    onSuccess: (_data, variables) => {
      invalidateAssignmentQueries()
      if (!variables.silent) {
        toast.success('Cycle count priority updated successfully')
      }
    },
    onError: (error: Error, variables) => {
      if (!variables.silent) {
        toast.error(`Failed to update priority: ${error.message}`)
      }
    },
  })

  const { mutateAsync: updatePriorityMutateAsync } = updatePriorityMutation

  const updateCycleCountPriority = useCallback(
    async (
      countId: string,
      priority: CycleCountPriority,
      options?: { silent?: boolean }
    ) => {
      await updatePriorityMutateAsync({
        countId,
        priority,
        silent: options?.silent ?? false,
      })
    },
    [updatePriorityMutateAsync]
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
    createCycleCount,
    createMultipleCycleCounts,
    updateCycleCount,
    deleteCycleCount,
    approveCycleCount,
    markForRecount,
    initiateRecount,
    completeRecount,

    // Assignment operations
    assignCountToUser,
    unassignCount,
    assignNextCount,

    // Priority operations
    updateCycleCountPriority,

    // Utility functions
    refreshData,
    exportToCSV,
  }
}

// Created and developed by Jai Singh
