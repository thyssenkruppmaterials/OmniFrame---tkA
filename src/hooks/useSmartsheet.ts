/**
 * React Query hooks for Smartsheet operations.
 * Uses Rust backend for high-performance operations.
 */
import { useEffect, useCallback } from 'react'
import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import smartsheetApi, {
  type CreateSheetRequest,
  type UpdateSheetRequest,
  SmartsheetApiError,
} from '@/lib/api/smartsheet'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import {
  rustSmartsheetService,
  type CellUpdate,
  type NewRowData,
} from '@/lib/rust-core/smartsheet.service'
import { supabase } from '@/lib/supabase/client'

// Query Keys
export const SMARTSHEET_QUERY_KEYS = {
  all: ['smartsheet'] as const,
  health: () => [...SMARTSHEET_QUERY_KEYS.all, 'health'] as const,
  user: () => [...SMARTSHEET_QUERY_KEYS.all, 'user'] as const,
  sheets: () => [...SMARTSHEET_QUERY_KEYS.all, 'sheets'] as const,
  sheetsList: (params?: any) =>
    [...SMARTSHEET_QUERY_KEYS.sheets(), 'list', params] as const,
  sheet: (id: number) => [...SMARTSHEET_QUERY_KEYS.sheets(), id] as const,
  sheetDetails: (id: number, params?: any) =>
    [...SMARTSHEET_QUERY_KEYS.sheet(id), 'details', params] as const,
  sheetRows: (id: number, params?: any) =>
    [...SMARTSHEET_QUERY_KEYS.sheet(id), 'rows', params] as const,
  sheetStats: (id: number) =>
    [...SMARTSHEET_QUERY_KEYS.sheet(id), 'statistics'] as const,
  search: (query: string) =>
    [...SMARTSHEET_QUERY_KEYS.all, 'search', query] as const,
  dashboard: () => [...SMARTSHEET_QUERY_KEYS.all, 'dashboard'] as const,
  dashboardStats: () =>
    [...SMARTSHEET_QUERY_KEYS.dashboard(), 'stats'] as const,
  connections: () => [...SMARTSHEET_QUERY_KEYS.all, 'connections'] as const,
  connection: (id: string) =>
    [...SMARTSHEET_QUERY_KEYS.connections(), id] as const,
  syncJobs: () => [...SMARTSHEET_QUERY_KEYS.all, 'sync', 'jobs'] as const,
  syncJob: (id: string) => [...SMARTSHEET_QUERY_KEYS.syncJobs(), id] as const,
  webhooks: () => [...SMARTSHEET_QUERY_KEYS.all, 'webhooks'] as const,
} as const

// Configuration
const DEFAULT_STALE_TIME = 5 * 60 * 1000 // 5 minutes
const REALTIME_STALE_TIME = 30 * 1000 // 30 seconds

// ==================== HEALTH & CONNECTION HOOKS ====================

/**
 * Check Smartsheet API health (uses Rust service)
 */
export function useSmartsheetHealth() {
  return useQuery({
    queryKey: SMARTSHEET_QUERY_KEYS.health(),
    queryFn: async () => {
      const result = await rustSmartsheetService.healthCheck()
      return { success: result.success, data: result }
    },
    staleTime: REALTIME_STALE_TIME,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })
}

/**
 * Get current Smartsheet user info (uses Rust service)
 */
export function useSmartsheetCurrentUser() {
  const { authState } = useUnifiedAuth()
  const user = authState.user

  return useQuery({
    queryKey: SMARTSHEET_QUERY_KEYS.user(),
    queryFn: async () => {
      const result = await rustSmartsheetService.getCurrentUser()
      return result
    },
    enabled: !!user,
    staleTime: DEFAULT_STALE_TIME,
    retry: (failureCount, error) => {
      // Don't retry on authentication errors
      if (error instanceof Error && error.message.includes('401')) {
        return false
      }
      return failureCount < 2
    },
    throwOnError: false,
  })
}

// ==================== SHEETS HOOKS ====================

/**
 * List all sheets with optional pagination (uses Rust service)
 */
export function useSmartsheetSheets(params?: {
  include_all?: boolean
  page_size?: number
  enabled?: boolean
}) {
  const { authState } = useUnifiedAuth()
  const user = authState.user
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: SMARTSHEET_QUERY_KEYS.sheetsList(params),
    queryFn: async () => {
      const result = await rustSmartsheetService.listSheets({
        include_all: params?.include_all,
        page_size: params?.page_size,
      })
      return result
    },
    enabled: !!user && (params?.enabled ?? true),
    staleTime: DEFAULT_STALE_TIME,
    placeholderData: (previousData) => previousData,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes('401')) {
        return false
      }
      return failureCount < 2
    },
    throwOnError: false,
  })

  // Set up real-time subscription for sheet changes
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel('smartsheet-activity-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'smartsheet_activity_log',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (
            payload.eventType === 'INSERT' &&
            payload.new.action?.includes('sheet')
          ) {
            queryClient.invalidateQueries({
              queryKey: SMARTSHEET_QUERY_KEYS.sheets(),
            })

            if (payload.new.status === 'success') {
              toast.success(`Sheet operation completed: ${payload.new.action}`)
            }
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, queryClient])

  return query
}

/**
 * Get sheet details (uses Rust service)
 */
export function useSmartsheetSheet(
  sheetId: number,
  params?: {
    level?: number
    include?: string
    enabled?: boolean
    /** Optional polling interval in ms.  When set, React Query will
     *  automatically refetch the sheet on this cadence. */
    refetchInterval?: number
    /** Whether to keep polling when the browser tab is in the background.
     *  Defaults to `false` (pauses when hidden). */
    refetchIntervalInBackground?: boolean
  }
) {
  const { authState } = useUnifiedAuth()
  const user = authState.user

  return useQuery({
    queryKey: SMARTSHEET_QUERY_KEYS.sheetDetails(sheetId, params),
    queryFn: async () => {
      const result = await rustSmartsheetService.getSheet(sheetId, {
        level: params?.level,
        include: params?.include,
        use_cache: false, // Disable cache to get fresh data after edits
      })
      return result
    },
    enabled: !!user && !!sheetId && (params?.enabled ?? true),
    staleTime: DEFAULT_STALE_TIME,
    refetchInterval: params?.refetchInterval,
    refetchIntervalInBackground: params?.refetchIntervalInBackground ?? false,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes('404')) {
        return false
      }
      return failureCount < 3
    },
  })
}

/**
 * Get sheet rows with pagination
 */
export function useSmartsheetSheetRows(
  sheetId: number,
  params?: {
    page_size?: number
    enabled?: boolean
  }
) {
  const { authState } = useUnifiedAuth()
  const user = authState.user

  return useInfiniteQuery({
    queryKey: SMARTSHEET_QUERY_KEYS.sheetRows(sheetId, params),
    queryFn: async ({ pageParam = 1 }) => {
      const result = await smartsheetApi.getRows(sheetId, {
        ...params,
        page: pageParam,
      })
      return result
    },
    enabled: !!user && !!sheetId && (params?.enabled ?? true),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (!lastPage.success || !lastPage.page_number || !lastPage.total_pages) {
        return undefined
      }
      return lastPage.page_number < lastPage.total_pages
        ? lastPage.page_number + 1
        : undefined
    },
    staleTime: DEFAULT_STALE_TIME,
  })
}

/**
 * Get sheet statistics
 */
export function useSmartsheetSheetStats(sheetId: number, enabled = true) {
  const { authState } = useUnifiedAuth()
  const user = authState.user

  return useQuery({
    queryKey: SMARTSHEET_QUERY_KEYS.sheetStats(sheetId),
    queryFn: () => smartsheetApi.getSheetStatistics(sheetId),
    enabled: !!user && !!sheetId && enabled,
    staleTime: DEFAULT_STALE_TIME,
  })
}

// ==================== SHEET MUTATION HOOKS ====================

/**
 * Create a new sheet
 */
export function useCreateSheet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateSheetRequest) => smartsheetApi.createSheet(data),
    onSuccess: (response) => {
      // Invalidate sheets list
      queryClient.invalidateQueries({
        queryKey: SMARTSHEET_QUERY_KEYS.sheets(),
      })

      if (response.success) {
        toast.success('Sheet created successfully')
      }
    },
    onError: (error: SmartsheetApiError) => {
      toast.error(`Failed to create sheet: ${error.message}`)
    },
  })
}

/**
 * Update a sheet
 */
export function useUpdateSheet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      sheetId,
      data,
    }: {
      sheetId: number
      data: UpdateSheetRequest
    }) => smartsheetApi.updateSheet(sheetId, data),
    onSuccess: (response, { sheetId }) => {
      // Invalidate specific sheet and sheets list
      queryClient.invalidateQueries({
        queryKey: SMARTSHEET_QUERY_KEYS.sheet(sheetId),
      })
      queryClient.invalidateQueries({
        queryKey: SMARTSHEET_QUERY_KEYS.sheets(),
      })

      if (response.success) {
        toast.success('Sheet updated successfully')
      }
    },
    onError: (error: SmartsheetApiError) => {
      toast.error(`Failed to update sheet: ${error.message}`)
    },
  })
}

/**
 * Delete a sheet
 */
export function useDeleteSheet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (sheetId: number) => smartsheetApi.deleteSheet(sheetId),
    onSuccess: (response, sheetId) => {
      // Remove specific sheet from cache and invalidate sheets list
      queryClient.removeQueries({
        queryKey: SMARTSHEET_QUERY_KEYS.sheet(sheetId),
      })
      queryClient.invalidateQueries({
        queryKey: SMARTSHEET_QUERY_KEYS.sheets(),
      })

      if (response.success) {
        toast.success('Sheet deleted successfully')
      }
    },
    onError: (error: SmartsheetApiError) => {
      toast.error(`Failed to delete sheet: ${error.message}`)
    },
  })
}

// ==================== SEARCH HOOKS ====================

/**
 * Search sheets
 */
export function useSearchSheets(query: string, params?: { scope?: string }) {
  const { authState } = useUnifiedAuth()
  const user = authState.user

  return useQuery({
    queryKey: [...SMARTSHEET_QUERY_KEYS.search(query), params],
    queryFn: () => smartsheetApi.searchSheets(query, params),
    enabled: !!user && !!query.trim(),
    staleTime: REALTIME_STALE_TIME,
    placeholderData: (previousData) => previousData,
  })
}

// ==================== DASHBOARD HOOKS ====================

/**
 * Get dashboard statistics (uses Rust service)
 */
export function useSmartsheetDashboardStats() {
  const { authState } = useUnifiedAuth()
  const user = authState.user

  return useQuery({
    queryKey: SMARTSHEET_QUERY_KEYS.dashboardStats(),
    queryFn: async () => {
      const result = await rustSmartsheetService.getDashboardStats()
      return { success: result.success, data: { statistics: result.data } }
    },
    enabled: !!user,
    staleTime: REALTIME_STALE_TIME,
    refetchInterval: 30000,
  })
}

// ==================== CONNECTION HOOKS ====================

/**
 * List connections
 */
export function useSmartsheetConnections() {
  const { authState } = useUnifiedAuth()
  const user = authState.user

  return useQuery({
    queryKey: SMARTSHEET_QUERY_KEYS.connections(),
    queryFn: () => smartsheetApi.listConnections(),
    enabled: !!user,
    staleTime: DEFAULT_STALE_TIME,
  })
}

/**
 * Test connection
 */
export function useTestConnection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (connectionId: string) =>
      smartsheetApi.testConnection(connectionId),
    onSuccess: (response) => {
      // Invalidate connections
      queryClient.invalidateQueries({
        queryKey: SMARTSHEET_QUERY_KEYS.connections(),
      })

      if (response.success) {
        toast.success('Connection test successful')
      }
    },
    onError: (error: SmartsheetApiError) => {
      toast.error(`Connection test failed: ${error.message}`)
    },
  })
}

/**
 * Create connection
 */
export function useCreateConnection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      connection_name: string
      access_token: string
      api_base_url?: string
      rate_limit_per_second?: number
    }) => smartsheetApi.createConnection(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({
        queryKey: SMARTSHEET_QUERY_KEYS.connections(),
      })

      if (response.success) {
        toast.success('Connection created successfully')
      }
    },
    onError: (error: SmartsheetApiError) => {
      toast.error(`Failed to create connection: ${error.message}`)
    },
  })
}

/**
 * Update connection
 */
export function useUpdateConnection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      connectionId,
      data,
    }: {
      connectionId: string
      data: Partial<{
        connection_name: string
        access_token: string
        api_base_url: string
        is_active: boolean
        rate_limit_per_second: number
      }>
    }) => smartsheetApi.updateConnection(connectionId, data),
    onSuccess: (response, { connectionId }) => {
      queryClient.invalidateQueries({
        queryKey: SMARTSHEET_QUERY_KEYS.connection(connectionId),
      })
      queryClient.invalidateQueries({
        queryKey: SMARTSHEET_QUERY_KEYS.connections(),
      })

      if (response.success) {
        toast.success('Connection updated successfully')
      }
    },
    onError: (error: SmartsheetApiError) => {
      toast.error(`Failed to update connection: ${error.message}`)
    },
  })
}

/**
 * Delete connection
 */
export function useDeleteConnection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (connectionId: string) =>
      smartsheetApi.deleteConnection(connectionId),
    onSuccess: (response, connectionId) => {
      queryClient.removeQueries({
        queryKey: SMARTSHEET_QUERY_KEYS.connection(connectionId),
      })
      queryClient.invalidateQueries({
        queryKey: SMARTSHEET_QUERY_KEYS.connections(),
      })

      if (response.success) {
        toast.success('Connection deleted successfully')
      }
    },
    onError: (error: SmartsheetApiError) => {
      toast.error(`Failed to delete connection: ${error.message}`)
    },
  })
}

// ==================== SYNC JOBS HOOKS ====================

/**
 * List sync jobs
 */
export function useSmartsheetSyncJobs() {
  const { authState } = useUnifiedAuth()
  const user = authState.user

  return useQuery({
    queryKey: SMARTSHEET_QUERY_KEYS.syncJobs(),
    queryFn: () => smartsheetApi.listSyncJobs(),
    enabled: !!user,
    staleTime: REALTIME_STALE_TIME,
    refetchInterval: 5000, // Refetch every 5 seconds for job status updates
  })
}

/**
 * Get specific sync job
 */
export function useSmartsheetSyncJob(jobId: string, enabled = true) {
  const { authState } = useUnifiedAuth()
  const user = authState.user

  return useQuery({
    queryKey: SMARTSHEET_QUERY_KEYS.syncJob(jobId),
    queryFn: () => smartsheetApi.getSyncJob(jobId),
    enabled: !!user && !!jobId && enabled,
    staleTime: REALTIME_STALE_TIME,
    refetchInterval: (query) => {
      // Refetch more frequently if job is running
      // Use type assertion to access data property
      const queryWithData = query as any
      const status = queryWithData.data?.data?.job?.status
      return status === 'running' || status === 'pending' ? 2000 : 10000
    },
  })
}

/**
 * Create sync job
 */
export function useCreateSyncJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      job_name: string
      job_type: 'import' | 'export' | 'sync'
      source_sheet_id?: number
      target_sheet_id?: number
      sync_config?: any
    }) => smartsheetApi.createSyncJob(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({
        queryKey: SMARTSHEET_QUERY_KEYS.syncJobs(),
      })

      if (response.success) {
        toast.success('Sync job created successfully')
      }
    },
    onError: (error: SmartsheetApiError) => {
      toast.error(`Failed to create sync job: ${error.message}`)
    },
  })
}

// ==================== CELL EDITING HOOKS ====================

/**
 * Update cells in a row (uses Rust service)
 */
export function useUpdateCells() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      sheetId,
      rowId,
      cellUpdates,
    }: {
      sheetId: number
      rowId: number
      cellUpdates: Array<{
        column_id: number
        value: any
        hyperlink?: {
          url?: string
          report_id?: number
          sheet_id?: number
        }
        clear_hyperlink?: boolean
      }>
    }) => {
      const result = await rustSmartsheetService.updateCells(
        sheetId,
        rowId,
        cellUpdates as CellUpdate[]
      )
      return result
    },
    onSuccess: (response, { sheetId }) => {
      // Invalidate all queries for this sheet to ensure fresh data
      queryClient.invalidateQueries({
        queryKey: SMARTSHEET_QUERY_KEYS.sheet(sheetId),
      })

      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey
          return (
            Array.isArray(key) &&
            key[0] === 'smartsheet' &&
            key.some((k) => k === sheetId || k === sheetId.toString())
          )
        },
      })

      // Force immediate refetch
      queryClient.refetchQueries({
        queryKey: SMARTSHEET_QUERY_KEYS.sheet(sheetId),
        exact: false,
      })

      if (response.success) {
        toast.success('Cells updated successfully')
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to update cells: ${error.message}`)
    },
  })
}

/**
 * Add rows to a sheet (uses Rust service)
 */
export function useAddRows() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      sheetId,
      rowsData,
      location,
    }: {
      sheetId: number
      rowsData: Array<{
        cells: Array<{
          column_id: number
          value: any
        }>
      }>
      location?: 'toTop' | 'toBottom'
    }) => {
      const result = await rustSmartsheetService.addRows(
        sheetId,
        rowsData as NewRowData[],
        location
      )
      return result
    },
    onSuccess: (response, { sheetId }) => {
      // Invalidate all queries for this sheet
      queryClient.invalidateQueries({
        queryKey: SMARTSHEET_QUERY_KEYS.sheet(sheetId),
      })

      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey
          return (
            Array.isArray(key) &&
            key[0] === 'smartsheet' &&
            key.some((k) => k === sheetId || k === sheetId.toString())
          )
        },
      })

      // Force immediate refetch
      queryClient.refetchQueries({
        queryKey: SMARTSHEET_QUERY_KEYS.sheet(sheetId),
        exact: false,
      })

      if (response.success) {
        toast.success('Rows added successfully')
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to add rows: ${error.message}`)
    },
  })
}

// ==================== ATTACHMENT HOOKS ====================

/**
 * List all sheet attachments (uses Rust service)
 */
export function useSheetAttachments(sheetId: number, enabled = true) {
  const { authState } = useUnifiedAuth()
  const user = authState.user

  return useQuery({
    queryKey: [...SMARTSHEET_QUERY_KEYS.sheet(sheetId), 'attachments'],
    queryFn: async () => {
      const result = await rustSmartsheetService.listSheetAttachments(sheetId)
      return { success: true, data: { attachments: result.data?.data || [] } }
    },
    enabled: !!user && !!sheetId && enabled,
    staleTime: DEFAULT_STALE_TIME,
  })
}

/**
 * List row attachments (uses Rust service)
 */
export function useRowAttachments(
  sheetId: number,
  rowId: number,
  enabled = true
) {
  const { authState } = useUnifiedAuth()
  const user = authState.user

  return useQuery({
    queryKey: [
      ...SMARTSHEET_QUERY_KEYS.sheet(sheetId),
      'row',
      rowId,
      'attachments',
    ],
    queryFn: async () => {
      const result = await rustSmartsheetService.listRowAttachments(
        sheetId,
        rowId
      )
      // Return flat structure for easier access
      return { success: true, attachments: result.data?.data || [] }
    },
    enabled: !!user && !!sheetId && !!rowId && enabled,
    staleTime: DEFAULT_STALE_TIME,
  })
}

/**
 * Attach URL to row (uses Rust service)
 */
export function useAttachUrlToRow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      sheetId,
      rowId,
      url,
      name,
    }: {
      sheetId: number
      rowId: number
      url: string
      name: string
    }) => {
      const result = await rustSmartsheetService.attachUrlToRow(
        sheetId,
        rowId,
        url,
        name
      )
      return { success: result.success }
    },
    onSuccess: (response, { sheetId, rowId }) => {
      queryClient.invalidateQueries({
        queryKey: [
          ...SMARTSHEET_QUERY_KEYS.sheet(sheetId),
          'row',
          rowId,
          'attachments',
        ],
      })
      queryClient.invalidateQueries({
        queryKey: [...SMARTSHEET_QUERY_KEYS.sheet(sheetId), 'attachments'],
      })

      if (response.success) {
        toast.success('URL attached successfully')
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to attach URL: ${error.message}`)
    },
  })
}

/**
 * Upload file to row
 */
export function useUploadFileToRow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      sheetId,
      rowId,
      file,
    }: {
      sheetId: number
      rowId: number
      file: File
    }) => smartsheetApi.uploadFileToRow(sheetId, rowId, file),
    onSuccess: (response, { sheetId, rowId }) => {
      queryClient.invalidateQueries({
        queryKey: [
          ...SMARTSHEET_QUERY_KEYS.sheet(sheetId),
          'row',
          rowId,
          'attachments',
        ],
      })
      queryClient.invalidateQueries({
        queryKey: [...SMARTSHEET_QUERY_KEYS.sheet(sheetId), 'attachments'],
      })

      if (response.success) {
        toast.success('File uploaded successfully')
      }
    },
    onError: (error: SmartsheetApiError) => {
      toast.error(`Failed to upload file: ${error.message}`)
    },
  })
}

/**
 * Upload file to sheet
 */
export function useUploadFileToSheet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ sheetId, file }: { sheetId: number; file: File }) =>
      smartsheetApi.uploadFileToSheet(sheetId, file),
    onSuccess: (response, { sheetId }) => {
      queryClient.invalidateQueries({
        queryKey: [...SMARTSHEET_QUERY_KEYS.sheet(sheetId), 'attachments'],
      })

      if (response.success) {
        toast.success('File uploaded to sheet successfully')
      }
    },
    onError: (error: SmartsheetApiError) => {
      toast.error(`Failed to upload file to sheet: ${error.message}`)
    },
  })
}

/**
 * Upload file to comment
 */
export function useUploadFileToComment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      sheetId,
      commentId,
      file,
    }: {
      sheetId: number
      commentId: number
      file: File
    }) => smartsheetApi.uploadFileToComment(sheetId, commentId, file),
    onSuccess: (response, { sheetId }) => {
      queryClient.invalidateQueries({
        queryKey: [...SMARTSHEET_QUERY_KEYS.sheet(sheetId), 'discussions'],
      })
      queryClient.invalidateQueries({
        queryKey: [...SMARTSHEET_QUERY_KEYS.sheet(sheetId), 'attachments'],
      })

      if (response.success) {
        toast.success('File attached to comment successfully')
      }
    },
    onError: (error: SmartsheetApiError) => {
      toast.error(`Failed to attach file to comment: ${error.message}`)
    },
  })
}

/**
 * Get attachment download URL (uses Rust service)
 */
export function useGetAttachmentDownloadUrl() {
  return useMutation({
    mutationFn: async ({
      sheetId,
      attachmentId,
    }: {
      sheetId: number
      attachmentId: number
    }) => {
      const result = await rustSmartsheetService.getAttachment(
        sheetId,
        attachmentId
      )
      return { success: result.success, data: { attachment: result.data } }
    },
    onSuccess: (response) => {
      if (response.success && response.data?.attachment?.url) {
        // Trigger download
        window.open(response.data.attachment.url, '_blank')
        toast.success('Download started')
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to get download URL: ${error.message}`)
    },
  })
}

/**
 * Delete attachment
 */
export function useDeleteAttachment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      sheetId,
      attachmentId,
    }: {
      sheetId: number
      attachmentId: number
      rowId?: number
    }) => {
      const result = await rustSmartsheetService.deleteAttachment(
        sheetId,
        attachmentId
      )
      return { success: result.success }
    },
    onSuccess: (response, { sheetId, rowId }) => {
      // Invalidate all attachments for the sheet
      queryClient.invalidateQueries({
        queryKey: [...SMARTSHEET_QUERY_KEYS.sheet(sheetId), 'attachments'],
      })

      // If row-specific, also invalidate row attachments
      if (rowId) {
        queryClient.invalidateQueries({
          queryKey: [
            ...SMARTSHEET_QUERY_KEYS.sheet(sheetId),
            'row',
            rowId,
            'attachments',
          ],
        })
      }

      if (response.success) {
        toast.success('Attachment deleted successfully')
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete attachment: ${error.message}`)
    },
  })
}

// ==================== DISCUSSION HOOKS ====================

/**
 * List row discussions (uses Rust service)
 */
export function useRowDiscussions(
  sheetId: number,
  rowId: number,
  enabled = true
) {
  const { authState } = useUnifiedAuth()
  const user = authState.user

  return useQuery({
    queryKey: [
      ...SMARTSHEET_QUERY_KEYS.sheet(sheetId),
      'row',
      rowId,
      'discussions',
    ],
    queryFn: async () => {
      const result = await rustSmartsheetService.listRowDiscussions(
        sheetId,
        rowId
      )
      // Return flat structure for easier access
      return { success: true, discussions: result.data?.data || [] }
    },
    enabled: !!user && !!sheetId && !!rowId && enabled,
    staleTime: DEFAULT_STALE_TIME,
  })
}

/**
 * Get a specific discussion with all comments (uses Rust service)
 */
export function useDiscussion(
  sheetId: number,
  discussionId: number,
  enabled = true
) {
  const { authState } = useUnifiedAuth()
  const user = authState.user

  return useQuery({
    queryKey: [
      ...SMARTSHEET_QUERY_KEYS.sheet(sheetId),
      'discussion',
      discussionId,
    ],
    queryFn: async () => {
      const result = await rustSmartsheetService.getDiscussion(
        sheetId,
        discussionId
      )
      return { success: true, data: { discussion: result.data } }
    },
    enabled: !!user && !!sheetId && !!discussionId && enabled,
    staleTime: DEFAULT_STALE_TIME,
  })
}

/**
 * Create row discussion (uses Rust service)
 */
export function useCreateRowDiscussion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      sheetId,
      rowId,
      title,
      comment,
    }: {
      sheetId: number
      rowId: number
      title: string
      comment: string
    }) => {
      // Rust service only takes comment, title is part of the discussion
      const result = await rustSmartsheetService.createRowDiscussion(
        sheetId,
        rowId,
        `${title}: ${comment}`
      )
      return { success: result.success }
    },
    onSuccess: (response, { sheetId, rowId }) => {
      queryClient.invalidateQueries({
        queryKey: [
          ...SMARTSHEET_QUERY_KEYS.sheet(sheetId),
          'row',
          rowId,
          'discussions',
        ],
      })

      if (response.success) {
        toast.success('Discussion created successfully')
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to create discussion: ${error.message}`)
    },
  })
}

/**
 * Add comment to discussion (uses Rust service)
 */
export function useAddCommentToDiscussion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      sheetId,
      discussionId,
      text,
    }: {
      sheetId: number
      discussionId: number
      text: string
      rowId?: number
    }) => {
      const result = await rustSmartsheetService.addCommentToDiscussion(
        sheetId,
        discussionId,
        text
      )
      return { success: result.success }
    },
    onSuccess: (response, { sheetId, rowId }) => {
      // Invalidate all discussions for the sheet
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey
          return Array.isArray(key) && key.includes('discussions')
        },
      })

      if (rowId) {
        queryClient.invalidateQueries({
          queryKey: [
            ...SMARTSHEET_QUERY_KEYS.sheet(sheetId),
            'row',
            rowId,
            'discussions',
          ],
        })
      }

      if (response.success) {
        toast.success('Comment added successfully')
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to add comment: ${error.message}`)
    },
  })
}

/**
 * Update a comment (uses Rust service)
 */
export function useUpdateComment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      sheetId,
      commentId,
      text,
    }: {
      sheetId: number
      commentId: number
      text: string
    }) => {
      const result = await rustSmartsheetService.updateComment(
        sheetId,
        commentId,
        text
      )
      return { success: result.success }
    },
    onSuccess: (response) => {
      // Invalidate all discussions for the sheet
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey
          return Array.isArray(key) && key.includes('discussions')
        },
      })

      if (response.success) {
        toast.success('Comment updated successfully')
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to update comment: ${error.message}`)
    },
  })
}

/**
 * Delete a comment (uses Rust service)
 */
export function useDeleteComment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      sheetId,
      commentId,
    }: {
      sheetId: number
      commentId: number
    }) => {
      const result = await rustSmartsheetService.deleteComment(
        sheetId,
        commentId
      )
      return { success: result.success }
    },
    onSuccess: (response) => {
      // Invalidate all discussions for the sheet
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey
          return Array.isArray(key) && key.includes('discussions')
        },
      })

      if (response.success) {
        toast.success('Comment deleted successfully')
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete comment: ${error.message}`)
    },
  })
}

/**
 * Delete a discussion (uses Rust service)
 */
export function useDeleteDiscussion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      sheetId,
      discussionId,
    }: {
      sheetId: number
      discussionId: number
    }) => {
      const result = await rustSmartsheetService.deleteDiscussion(
        sheetId,
        discussionId
      )
      return { success: result.success }
    },
    onSuccess: (response) => {
      // Invalidate all discussions for the sheet
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey
          return Array.isArray(key) && key.includes('discussions')
        },
      })

      if (response.success) {
        toast.success('Discussion deleted successfully')
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete discussion: ${error.message}`)
    },
  })
}

// ==================== UTILITY HOOKS ====================

/**
 * Combined hook for Smartsheet integration status (uses Rust service)
 */
export function useSmartsheetStatus() {
  const healthQuery = useSmartsheetHealth()
  const userQuery = useSmartsheetCurrentUser()

  return {
    isHealthy: healthQuery.data?.success ?? false,
    isAuthenticated: healthQuery.data?.success ?? false,
    hasConnections: true, // Rust service has API key configured
    isLoading: healthQuery.isLoading || userQuery.isLoading,
    error: healthQuery.error || userQuery.error,
    user: userQuery.data?.data,
    connections: [],
  }
}

/**
 * Prefetch sheet data
 */
export function usePrefetchSheet() {
  const queryClient = useQueryClient()

  return useCallback(
    (sheetId: number) => {
      queryClient.prefetchQuery({
        queryKey: SMARTSHEET_QUERY_KEYS.sheetDetails(sheetId),
        queryFn: () => smartsheetApi.getSheet(sheetId),
        staleTime: DEFAULT_STALE_TIME,
      })
    },
    [queryClient]
  )
}

/**
 * Export data utilities
 */
export function useSmartsheetExport() {
  return {
    exportSheet: useMutation({
      mutationFn: ({
        sheetId,
        format,
      }: {
        sheetId: number
        format?: 'xlsx' | 'pdf' | 'csv'
      }) => smartsheetApi.exportSheet(sheetId, format),
      onSuccess: (response) => {
        if (response.success && response.data?.download_url) {
          // Trigger download
          const link = document.createElement('a')
          link.href = response.data.download_url
          link.download = response.data.file_name
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)

          toast.success('Export started successfully')
        }
      },
      onError: (error: SmartsheetApiError) => {
        toast.error(`Export failed: ${error.message}`)
      },
    }),
  }
}
