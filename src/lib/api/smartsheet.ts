// Created and developed by Jai Singh
/**
 * Smartsheet API client for OmniFrame Logistics.
 * Provides comprehensive interface to the FastAPI Smartsheet backend.
 */
import axios, {
  AxiosInstance,
  AxiosResponse,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

// Extend Axios request config to include metadata
declare module 'axios' {
  interface InternalAxiosRequestConfig {
    metadata?: {
      startTime: number
    }
  }
}

// Types
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  message?: string
  error?: string
  result_code?: number
}

export interface PaginatedResponse {
  success: boolean
  message?: string
  error?: string
  result_code?: number
  page_number?: number
  page_size?: number
  total_pages?: number
  total_count?: number
}

// Smartsheet-specific response types that match backend models
export interface SheetListResponse extends PaginatedResponse {
  sheets: SheetSummary[]
}

export interface SheetResponse {
  success: boolean
  message?: string
  error?: string
  result_code?: number
  sheet?: SheetData
}

export interface RowsResponse extends PaginatedResponse {
  rows: RowData[]
}

export interface SheetSummary {
  id: number
  name: string
  access_level: string
  created_at?: string
  modified_at?: string
  permalink?: string
  version?: number
  total_row_count?: number
}

export interface SheetData {
  id: number
  name: string
  access_level: string
  columns: ColumnData[]
  rows: RowData[]
  total_row_count?: number
  created_at?: string
  modified_at?: string
  permalink?: string
  version?: number
  workspace?: any
}

export interface ColumnData {
  id?: number
  index?: number
  title: string
  type: string
  primary?: boolean
  validation?: boolean
  width?: number
  locked?: boolean
  locked_for_user?: boolean
}

export interface CellData {
  column_id: number
  value?: any
  display_value?: string
  hyperlink?: any
  link_in_from_cell?: any
}

export interface RowData {
  id?: number
  row_number?: number
  parent_id?: number
  sibling_id?: number
  cells: CellData[]
  created_at?: string
  created_by?: any
  modified_at?: string
  modified_by?: any
}

export interface CreateSheetRequest {
  name: string
  columns: Array<{
    title: string
    type?: string
    primary?: boolean
    width?: number
  }>
  workspace_id?: number
  folder_id?: number
}

export interface UpdateSheetRequest {
  name?: string
  user_settings?: any
  project_settings?: any
}

export interface SearchSheetsRequest {
  query: string
  scope?: string
  location?: string
}

export interface SearchResult {
  sheets: SheetSummary[]
  query: string
  total_count: number
}

export interface DashboardStats {
  total_activities: number
  successful_activities: number
  failed_activities: number
  unique_sheets_accessed: number
  active_connections: number
  recent_sync_jobs: number
  cache_entries: number
}

export interface ConnectionData {
  id: string
  connection_name: string
  api_base_url: string
  is_active: boolean
  last_tested_at?: string
  last_test_status?: string
  rate_limit_per_second: number
  connection_metadata: any
  created_at: string
  updated_at: string
}

export interface SyncJobData {
  id: string
  job_name: string
  job_type: 'import' | 'export' | 'sync'
  source_sheet_id?: number
  target_sheet_id?: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress_percentage: number
  records_processed: number
  records_total: number
  sync_config: any
  error_details?: any
  started_at?: string
  completed_at?: string
  created_at: string
  updated_at: string
}

// Configuration
const API_BASE_URL = (() => {
  // Auto-detect based on environment
  if (typeof window !== 'undefined') {
    const currentOrigin = window.location.origin

    // In development (localhost:5173), use separate backend
    if (currentOrigin === 'http://localhost:5173') {
      return 'http://localhost:8000'
    }

    // In production (Railway or any other deployment), use same origin (unified deployment)
    return currentOrigin
  }

  // Check for explicit API URL as fallback
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }

  // Final fallback for SSR
  return 'http://localhost:8000'
})()
const REQUEST_TIMEOUT = 30000 // 30 seconds
const FILE_UPLOAD_TIMEOUT = 300000 // 5 minutes for file uploads
const MAX_FILE_SIZE_MB = 30 // Smartsheet API limit is 30 MB
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
const MAX_RETRIES = 3
const RETRY_DELAY = 1000 // 1 second

// Custom error class
export class SmartsheetApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseData?: any
  ) {
    super(message)
    this.name = 'SmartsheetApiError'
  }
}

/**
 * Smartsheet API client class
 */
export class SmartsheetApiClient {
  private api: AxiosInstance
  private authToken: string | null = null

  constructor() {
    this.api = axios.create({
      baseURL: `${API_BASE_URL}/api/smartsheet`,
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Name': 'OmniFrame-Frontend',
        'X-Client-Version': '1.0.0',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    })

    this.setupInterceptors()
  }

  private setupInterceptors() {
    // Request interceptor
    this.api.interceptors.request.use(
      async (config) => {
        // Get JWT token from Supabase session
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession()

          if (session?.access_token) {
            config.headers.Authorization = `Bearer ${session.access_token}`
          } else if (this.authToken) {
            // Fallback to manually set token
            config.headers.Authorization = `Bearer ${this.authToken}`
          }
        } catch (error) {
          logger.warn('Failed to get Supabase session for API request:', error)
          // Continue with request - might work without auth for some endpoints
        }

        // Add request timestamp for debugging
        config.metadata = { startTime: Date.now() }

        // Log request in development
        if (import.meta.env.MODE === 'development') {
          logger.log(
            `🚀 Smartsheet API Request: ${config.method?.toUpperCase()} ${config.url}`
          )
        }

        return config
      },
      (error) => {
        logger.error('Request interceptor error:', error)
        return Promise.reject(error)
      }
    )

    // Response interceptor
    this.api.interceptors.response.use(
      (response: AxiosResponse) => {
        // Log response time in development
        if (
          import.meta.env.MODE === 'development' &&
          response.config.metadata
        ) {
          const duration = Date.now() - response.config.metadata.startTime
          logger.log(
            `✅ Smartsheet API Response: ${response.config.method?.toUpperCase()} ${response.config.url} (${duration}ms)`
          )
        }

        return response
      },
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & {
          _retry?: boolean
          _retryCount?: number
        }

        // Log error in development
        if (import.meta.env.MODE === 'development') {
          logger.error(
            `❌ Smartsheet API Error: ${originalRequest?.method?.toUpperCase()} ${originalRequest?.url}`,
            error
          )
        }

        // Handle authentication errors
        if (error.response?.status === 401) {
          // Clear auth token and redirect to login if needed
          this.authToken = null
          toast.error('Authentication failed. Please log in again.')
          // Could dispatch a logout action here
          return Promise.reject(
            new SmartsheetApiError(
              'Authentication failed',
              401,
              error.response?.data
            )
          )
        }

        // Handle rate limiting with exponential backoff
        if (error.response?.status === 429 && !originalRequest._retry) {
          originalRequest._retry = true
          const retryAfter =
            parseInt(error.response.headers?.['retry-after'] as string) || 1

          toast.warning(
            `Rate limit reached. Retrying in ${retryAfter} seconds...`
          )

          await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000))
          return this.api(originalRequest)
        }

        // Handle network errors with retry logic
        if (!error.response && !originalRequest._retry) {
          originalRequest._retry = true
          originalRequest._retryCount = (originalRequest._retryCount || 0) + 1

          if (originalRequest._retryCount <= MAX_RETRIES) {
            toast.warning(
              `Network error. Retrying... (${originalRequest._retryCount}/${MAX_RETRIES})`
            )

            const retryCount = originalRequest._retryCount || 1
            await new Promise((resolve) =>
              setTimeout(resolve, RETRY_DELAY * retryCount)
            )
            return this.api(originalRequest)
          }
        }

        // Convert to custom error
        const errorMessage =
          (error.response?.data as any)?.error ||
          error.message ||
          'An unexpected error occurred'
        const statusCode = error.response?.status

        return Promise.reject(
          new SmartsheetApiError(errorMessage, statusCode, error.response?.data)
        )
      }
    )
  }

  /**
   * Set authentication token
   */
  setAuthToken(token: string) {
    this.authToken = token
  }

  /**
   * Clear authentication token
   */
  clearAuthToken() {
    this.authToken = null
  }

  // ==================== CONNECTION & HEALTH ====================

  async healthCheck(): Promise<ApiResponse> {
    const response = await this.api.get('/health')
    return response.data
  }

  async getCurrentUser(): Promise<ApiResponse> {
    const response = await this.api.get('/user')
    return response.data
  }

  // ==================== SHEETS OPERATIONS ====================

  async listSheets(params?: {
    include_all?: boolean
    page_size?: number
  }): Promise<SheetListResponse> {
    const response = await this.api.get('/sheets', { params })
    return response.data
  }

  async getSheet(
    sheetId: number,
    params?: {
      level?: number
      include?: string
    }
  ): Promise<SheetResponse> {
    const response = await this.api.get(`/sheets/${sheetId}`, { params })
    return response.data
  }

  async createSheet(
    data: CreateSheetRequest
  ): Promise<ApiResponse<{ sheet: SheetData }>> {
    const response = await this.api.post('/sheets', data)
    return response.data
  }

  async updateSheet(
    sheetId: number,
    data: UpdateSheetRequest
  ): Promise<ApiResponse<{ sheet: SheetData }>> {
    const response = await this.api.put(`/sheets/${sheetId}`, data)
    return response.data
  }

  async deleteSheet(sheetId: number): Promise<ApiResponse> {
    const response = await this.api.delete(`/sheets/${sheetId}`)
    return response.data
  }

  // ==================== ROW OPERATIONS ====================

  async getRows(
    sheetId: number,
    params?: {
      page_size?: number
      page?: number
    }
  ): Promise<RowsResponse> {
    const response = await this.api.get(`/sheets/${sheetId}/rows`, { params })
    return response.data
  }

  async updateRows(
    sheetId: number,
    data: {
      rows: any[]
    }
  ): Promise<ApiResponse> {
    const response = await this.api.put(`/sheets/${sheetId}/rows`, data)
    return response.data
  }

  async deleteRows(
    sheetId: number,
    data: {
      row_ids: number[]
      ignore_rows_not_found?: boolean
    }
  ): Promise<ApiResponse> {
    const response = await this.api.delete(`/sheets/${sheetId}/rows`, { data })
    return response.data
  }

  // ==================== SEARCH OPERATIONS ====================

  async searchSheets(
    query: string,
    params?: {
      scope?: string
    }
  ): Promise<ApiResponse<SearchResult>> {
    const response = await this.api.get('/search', {
      params: { q: query, ...params },
    })
    return response.data
  }

  // ==================== STATISTICS & DASHBOARD ====================

  async getSheetStatistics(sheetId: number): Promise<ApiResponse<any>> {
    const response = await this.api.get(`/sheets/${sheetId}/statistics`)
    return response.data
  }

  async getDashboardStats(): Promise<
    ApiResponse<{ statistics: DashboardStats }>
  > {
    const response = await this.api.get('/dashboard/stats')
    return response.data
  }

  // ==================== CONNECTION MANAGEMENT ====================

  async listConnections(): Promise<
    ApiResponse<{ connections: ConnectionData[] }>
  > {
    const response = await this.api.get('/connections')
    return response.data
  }

  async testConnection(connectionId: string): Promise<ApiResponse> {
    const response = await this.api.post(`/connections/${connectionId}/test`)
    return response.data
  }

  async createConnection(data: {
    connection_name: string
    access_token: string
    api_base_url?: string
    rate_limit_per_second?: number
  }): Promise<ApiResponse<{ connection: ConnectionData }>> {
    const response = await this.api.post('/connections', data)
    return response.data
  }

  async updateConnection(
    connectionId: string,
    data: Partial<{
      connection_name: string
      access_token: string
      api_base_url: string
      is_active: boolean
      rate_limit_per_second: number
    }>
  ): Promise<ApiResponse<{ connection: ConnectionData }>> {
    const response = await this.api.put(`/connections/${connectionId}`, data)
    return response.data
  }

  async deleteConnection(connectionId: string): Promise<ApiResponse> {
    const response = await this.api.delete(`/connections/${connectionId}`)
    return response.data
  }

  // ==================== SYNC JOBS ====================

  async listSyncJobs(): Promise<ApiResponse<{ jobs: SyncJobData[] }>> {
    const response = await this.api.get('/sync/jobs')
    return response.data
  }

  async getSyncJob(jobId: string): Promise<ApiResponse<{ job: SyncJobData }>> {
    const response = await this.api.get(`/sync/jobs/${jobId}`)
    return response.data
  }

  async createSyncJob(data: {
    job_name: string
    job_type: 'import' | 'export' | 'sync'
    source_sheet_id?: number
    target_sheet_id?: number
    sync_config?: any
  }): Promise<ApiResponse<{ job: SyncJobData }>> {
    const response = await this.api.post('/sync/jobs', data)
    return response.data
  }

  async startSyncJob(jobId: string): Promise<ApiResponse> {
    const response = await this.api.post(`/sync/jobs/${jobId}/start`)
    return response.data
  }

  async cancelSyncJob(jobId: string): Promise<ApiResponse> {
    const response = await this.api.post(`/sync/jobs/${jobId}/cancel`)
    return response.data
  }

  async deleteSyncJob(jobId: string): Promise<ApiResponse> {
    const response = await this.api.delete(`/sync/jobs/${jobId}`)
    return response.data
  }

  // ==================== EXPORT OPERATIONS ====================

  async exportSheet(
    sheetId: number,
    format: 'xlsx' | 'pdf' | 'csv' = 'xlsx'
  ): Promise<
    ApiResponse<{
      download_url: string
      file_name: string
      expires_at: string
    }>
  > {
    const response = await this.api.get(`/sheets/${sheetId}/export`, {
      params: { format },
    })
    return response.data
  }

  // ==================== WEBHOOK OPERATIONS ====================

  async listWebhooks(): Promise<ApiResponse<{ webhooks: any[] }>> {
    const response = await this.api.get('/webhooks')
    return response.data
  }

  async createWebhook(data: {
    name: string
    callback_url: string
    scope: string
    scope_object_id: number
    events?: string[]
    version?: number
  }): Promise<ApiResponse> {
    const response = await this.api.post('/webhooks', data)
    return response.data
  }

  async deleteWebhook(webhookId: number): Promise<ApiResponse> {
    const response = await this.api.delete(`/webhooks/${webhookId}`)
    return response.data
  }

  // ==================== CELL EDITING OPERATIONS ====================

  async updateCells(
    sheetId: number,
    rowId: number,
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
  ): Promise<ApiResponse> {
    const response = await this.api.put(
      `/sheets/${sheetId}/rows/${rowId}/cells`,
      cellUpdates
    )
    return response.data
  }

  async addRows(
    sheetId: number,
    rowsData: Array<{
      cells: Array<{
        column_id: number
        value: any
      }>
    }>,
    location: 'toTop' | 'toBottom' = 'toBottom'
  ): Promise<ApiResponse> {
    const response = await this.api.post(`/sheets/${sheetId}/rows`, rowsData, {
      params: { location },
    })
    return response.data
  }

  // ==================== ATTACHMENT OPERATIONS ====================

  async listSheetAttachments(sheetId: number): Promise<
    ApiResponse<{
      attachments: Array<{
        id: number
        name: string
        attachment_type: string
        mime_type: string
        size_in_kb: number
        parent_type: string
        parent_id: number
        created_at: string
        created_by: any
        url: string
        url_expires_in_millis: number
      }>
    }>
  > {
    const response = await this.api.get(`/sheets/${sheetId}/attachments`)
    return response.data
  }

  async listRowAttachments(
    sheetId: number,
    rowId: number
  ): Promise<
    ApiResponse<{
      attachments: Array<{
        id: number
        name: string
        attachment_type: string
        mime_type: string
        size_in_kb: number
        created_at: string
        created_by: any
        url: string
        url_expires_in_millis: number
      }>
    }>
  > {
    const response = await this.api.get(
      `/sheets/${sheetId}/rows/${rowId}/attachments`
    )
    return response.data
  }

  async attachUrlToRow(
    sheetId: number,
    rowId: number,
    url: string,
    name: string
  ): Promise<ApiResponse> {
    const response = await this.api.post(
      `/sheets/${sheetId}/rows/${rowId}/attachments/url`,
      {
        url,
        name,
      }
    )
    return response.data
  }

  async uploadFileToRow(
    sheetId: number,
    rowId: number,
    file: File
  ): Promise<
    ApiResponse<{
      attachment: {
        id: number
        name: string
        attachment_type: string
        mime_type: string
        size_in_kb: number
        created_at: string
        created_by: any
      }
    }>
  > {
    // Validate file size (Smartsheet API limit is 30 MB)
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new SmartsheetApiError(
        `File size (${(file.size / 1024 / 1024).toFixed(2)} MB) exceeds Smartsheet API limit of ${MAX_FILE_SIZE_MB} MB`,
        413
      )
    }

    const formData = new FormData()
    formData.append('file', file)

    // Set Content-Type to undefined to remove default application/json header
    // This lets the browser set multipart/form-data with proper boundary
    // Use extended timeout and size limits for file uploads
    const response = await this.api.post(
      `/sheets/${sheetId}/rows/${rowId}/attachments/file`,
      formData,
      {
        headers: {
          'Content-Type': undefined,
        },
        timeout: FILE_UPLOAD_TIMEOUT,
        maxContentLength: MAX_FILE_SIZE_BYTES,
        maxBodyLength: MAX_FILE_SIZE_BYTES,
      }
    )
    return response.data
  }

  async uploadFileToSheet(
    sheetId: number,
    file: File
  ): Promise<
    ApiResponse<{
      attachment: {
        id: number
        name: string
        attachment_type: string
        mime_type: string
        size_in_kb: number
        created_at: string
        created_by: any
      }
    }>
  > {
    // Validate file size (Smartsheet API limit is 30 MB)
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new SmartsheetApiError(
        `File size (${(file.size / 1024 / 1024).toFixed(2)} MB) exceeds Smartsheet API limit of ${MAX_FILE_SIZE_MB} MB`,
        413
      )
    }

    const formData = new FormData()
    formData.append('file', file)

    // Set Content-Type to undefined to remove default application/json header
    // This lets the browser set multipart/form-data with proper boundary
    // Use extended timeout and size limits for file uploads
    const response = await this.api.post(
      `/sheets/${sheetId}/attachments`,
      formData,
      {
        headers: {
          'Content-Type': undefined,
        },
        timeout: FILE_UPLOAD_TIMEOUT,
        maxContentLength: MAX_FILE_SIZE_BYTES,
        maxBodyLength: MAX_FILE_SIZE_BYTES,
      }
    )
    return response.data
  }

  async uploadFileToComment(
    sheetId: number,
    commentId: number,
    file: File
  ): Promise<
    ApiResponse<{
      attachment: {
        id: number
        name: string
        attachment_type: string
        mime_type: string
        size_in_kb: number
        created_at: string
        created_by: any
      }
    }>
  > {
    // Validate file size (Smartsheet API limit is 30 MB)
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new SmartsheetApiError(
        `File size (${(file.size / 1024 / 1024).toFixed(2)} MB) exceeds Smartsheet API limit of ${MAX_FILE_SIZE_MB} MB`,
        413
      )
    }

    const formData = new FormData()
    formData.append('file', file)

    // Set Content-Type to undefined to remove default application/json header
    // This lets the browser set multipart/form-data with proper boundary
    // Use extended timeout and size limits for file uploads
    const response = await this.api.post(
      `/sheets/${sheetId}/comments/${commentId}/attachments`,
      formData,
      {
        headers: {
          'Content-Type': undefined,
        },
        timeout: FILE_UPLOAD_TIMEOUT,
        maxContentLength: MAX_FILE_SIZE_BYTES,
        maxBodyLength: MAX_FILE_SIZE_BYTES,
      }
    )
    return response.data
  }

  async getAttachmentDownloadUrl(
    sheetId: number,
    attachmentId: number
  ): Promise<
    ApiResponse<{
      attachment: {
        id: number
        name: string
        url: string
        url_expires_in_millis: number
        mime_type: string
        size_in_kb: number
      }
    }>
  > {
    const response = await this.api.get(
      `/sheets/${sheetId}/attachments/${attachmentId}/download`
    )
    return response.data
  }

  async deleteAttachment(
    sheetId: number,
    attachmentId: number
  ): Promise<ApiResponse> {
    const response = await this.api.delete(
      `/sheets/${sheetId}/attachments/${attachmentId}`
    )
    return response.data
  }

  // ==================== DISCUSSION OPERATIONS ====================

  async listRowDiscussions(
    sheetId: number,
    rowId: number
  ): Promise<
    ApiResponse<{
      discussions: Array<{
        id: number
        title: string
        created_at: string
        created_by: any
        modified_at: string
        comment_count: number
        comments: Array<{
          id: number
          text: string
          created_at: string
          created_by: any
          modified_at: string
          attachments?: Array<{
            id: number
            name: string
            attachment_type: string
            mime_type: string
            size_in_kb: number
            url: string
          }>
        }>
      }>
    }>
  > {
    const response = await this.api.get(
      `/sheets/${sheetId}/rows/${rowId}/discussions`
    )
    return response.data
  }

  async getDiscussion(
    sheetId: number,
    discussionId: number
  ): Promise<
    ApiResponse<{
      discussion: {
        id: number
        title: string
        created_at: string
        created_by: any
        modified_at: string
        comment_count: number
        comments: Array<{
          id: number
          text: string
          created_at: string
          created_by: any
          modified_at: string
          attachments?: Array<{
            id: number
            name: string
            attachment_type: string
            mime_type: string
            size_in_kb: number
            url: string
          }>
        }>
      }
    }>
  > {
    const response = await this.api.get(
      `/sheets/${sheetId}/discussions/${discussionId}`
    )
    return response.data
  }

  async createRowDiscussion(
    sheetId: number,
    rowId: number,
    title: string,
    comment: string
  ): Promise<ApiResponse> {
    const response = await this.api.post(
      `/sheets/${sheetId}/rows/${rowId}/discussions`,
      {
        title,
        comment,
      }
    )
    return response.data
  }

  async addCommentToDiscussion(
    sheetId: number,
    discussionId: number,
    text: string
  ): Promise<ApiResponse> {
    const response = await this.api.post(
      `/sheets/${sheetId}/discussions/${discussionId}/comments`,
      {
        text,
      }
    )
    return response.data
  }

  async updateComment(
    sheetId: number,
    commentId: number,
    text: string
  ): Promise<
    ApiResponse<{
      comment: {
        id: number
        text: string
        created_at: string
        created_by: any
        modified_at: string
      }
    }>
  > {
    const response = await this.api.put(
      `/sheets/${sheetId}/comments/${commentId}`,
      {
        text,
      }
    )
    return response.data
  }

  async deleteComment(
    sheetId: number,
    commentId: number
  ): Promise<ApiResponse> {
    const response = await this.api.delete(
      `/sheets/${sheetId}/comments/${commentId}`
    )
    return response.data
  }

  async deleteDiscussion(
    sheetId: number,
    discussionId: number
  ): Promise<ApiResponse> {
    const response = await this.api.delete(
      `/sheets/${sheetId}/discussions/${discussionId}`
    )
    return response.data
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Check if the API is available
   */
  async isApiAvailable(): Promise<boolean> {
    try {
      await this.healthCheck()
      return true
    } catch (error) {
      logger.warn('Smartsheet API is not available:', error)
      return false
    }
  }

  /**
   * Get API base URL
   */
  getBaseUrl(): string {
    return this.api.defaults.baseURL || ''
  }
}

// Export singleton instance
export const smartsheetApi = new SmartsheetApiClient()

// Export default
export default smartsheetApi

// Created and developed by Jai Singh
