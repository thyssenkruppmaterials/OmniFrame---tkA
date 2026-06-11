// Created and developed by Jai Singh
/**
 * Rust Core SmartSheet Service
 *
 * High-performance SmartSheet operations via Rust backend.
 * Provides 10x faster data fetching and transformation compared to Python.
 */
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import { RUST_CORE_ENABLED, RUST_CORE_URL } from './config'

// ==================== TYPES ====================

export interface SmartsheetHealthResponse {
  success: boolean
  connection_status: string
  user_email?: string
  user_id?: number
  error?: string
}

export interface SheetSummary {
  id: number
  name: string
  access_level?: string
  created_at?: string
  modified_at?: string
  permalink?: string
  version?: number
  total_row_count?: number
}

export interface SheetListResponse {
  success: boolean
  message?: string
  sheets: SheetSummary[]
  page_number?: number
  page_size?: number
  total_pages?: number
  total_count?: number
}

export interface ColumnData {
  id: number
  index?: number
  title: string
  type: string
  primary: boolean
  validation: boolean
  width?: number
  locked: boolean
  locked_for_user: boolean
}

export interface CellData {
  column_id: number
  value?: unknown
  display_value?: string
  hyperlink?: unknown
  link_in_from_cell?: unknown
}

export interface UserData {
  id?: number
  email?: string
  name?: string
}

export interface RowData {
  id: number
  row_number?: number
  parent_id?: number
  sibling_id?: number
  cells: CellData[]
  created_at?: string
  created_by?: UserData
  modified_at?: string
  modified_by?: UserData
}

export interface SheetData {
  id: number
  name: string
  access_level?: string
  columns: ColumnData[]
  rows: RowData[]
  total_row_count?: number
  created_at?: string
  modified_at?: string
  permalink?: string
  version?: number
}

export interface SheetResponse {
  success: boolean
  message?: string
  sheet: SheetData
}

export interface OutboundImportData {
  headers: string[]
  rows: string[][]
  sheet_id: number
  sheet_name: string
  total_rows: number
  columns_count: number
}

export interface OutboundImportResponse {
  success: boolean
  message: string
  data: OutboundImportData
}

export interface SheetStatistics {
  sheet_id: number
  sheet_name: string
  total_rows: number
  total_columns: number
  non_empty_cells: number
  last_modified?: string
  version?: number
}

export interface ApiResponse<T> {
  success: boolean
  message?: string
  error?: string
  data?: T
  execution_time_ms?: number
}

// ==================== WRITE OPERATION TYPES ====================

export interface CellUpdate {
  column_id: number
  value: unknown
  hyperlink?: {
    url?: string
    report_id?: number
    sheet_id?: number
  }
  clear_hyperlink?: boolean
}

export interface UpdateCellsResponse {
  success: boolean
  message: string
  updated_cells: number
  row_id: number
  result?: unknown
}

export interface NewCellData {
  column_id: number
  value: unknown
}

export interface NewRowData {
  cells: NewCellData[]
}

export interface AddRowsResponse {
  success: boolean
  message: string
  rows_added: number
  result?: unknown
}

export interface DeleteRowsResponse {
  success: boolean
  message: string
  rows_deleted: number
  result?: unknown
}

// ==================== ATTACHMENT TYPES ====================

export interface AttachmentData {
  id: number
  name: string
  attachment_type?: string
  mime_type?: string
  size_in_kb?: number
  created_at?: string
  created_by?: UserData
  url?: string
  url_expires_in_millis?: number
}

export interface AttachmentsResponse {
  data: AttachmentData[]
  page_number?: number
  page_size?: number
  total_pages?: number
  total_count?: number
}

export interface AttachmentResponse {
  result: AttachmentData
}

// ==================== DISCUSSION TYPES ====================

export interface CommentData {
  id: number
  text: string
  created_at?: string
  created_by?: UserData
  modified_at?: string
}

export interface DiscussionData {
  id: number
  title?: string
  created_at?: string
  created_by?: UserData
  modified_at?: string
  comment_count?: number
  comments: CommentData[]
}

export interface DiscussionsResponse {
  data: DiscussionData[]
  page_number?: number
  page_size?: number
  total_pages?: number
  total_count?: number
}

export interface DiscussionResponse {
  result: DiscussionData
}

export interface DiscussionDetailData {
  id: number
  title?: string
  created_at?: string
  created_by?: UserData
  modified_at?: string
  comment_count?: number
  comments: CommentData[]
  parent_id?: number
  parent_type?: string
}

export interface CommentResponseData {
  result: CommentData
}

export interface DeleteResponse {
  message: string
  result_code?: number
}

export interface AttachmentDetailData {
  id: number
  name: string
  attachment_type?: string
  mime_type?: string
  size_in_kb?: number
  created_at?: string
  created_by?: UserData
  url?: string
  url_expires_in_millis?: number
}

// ==================== DASHBOARD STATS TYPES ====================

export interface SmartsheetDashboardStats {
  total_activities: number
  successful_activities: number
  unique_sheets_accessed: number
  active_connections: number
  recent_sync_jobs: number
}

export interface DashboardStatsResponse {
  success: boolean
  message?: string
  data: SmartsheetDashboardStats
}

// ==================== SERVICE CLASS ====================

class RustSmartsheetService {
  private baseUrl: string
  private token?: string
  private timeout: number

  constructor() {
    this.baseUrl = `${RUST_CORE_URL}/api/v1/smartsheet`
    this.timeout = 60000 // 60 seconds for large sheets
  }

  /**
   * Set authentication token
   */
  setToken(token: string) {
    this.token = token
  }

  /**
   * Check if Rust service is available
   */
  isEnabled(): boolean {
    return RUST_CORE_ENABLED
  }

  /**
   * Make HTTP request to Rust service
   */
  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const headers: Record<string, string> = {
        ...(options.headers as Record<string, string>),
      }

      // Only set Content-Type when a request body is present (avoids unnecessary CORS preflights on GET)
      if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json'
      }

      // Auto-resolve auth token: use manually set token, or fetch from Supabase session
      let authToken = this.token
      if (!authToken) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession()
          authToken = session?.access_token
        } catch {
          // Silently continue without token if session fetch fails
        }
      }

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`
      }

      const startTime = performance.now()

      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      })

      const endTime = performance.now()
      const duration = Math.round(endTime - startTime)

      if (import.meta.env.MODE === 'development') {
        logger.log(
          `🦀 Rust SmartSheet [${duration}ms]: ${options.method || 'GET'} ${path}`
        )
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        throw new Error(
          errorBody.error ||
            `API error: ${response.status} ${response.statusText}`
        )
      }

      return response.json()
    } finally {
      clearTimeout(timeoutId)
    }
  }

  // ==================== API METHODS ====================

  /**
   * Health check for SmartSheet connection
   */
  async healthCheck(): Promise<SmartsheetHealthResponse> {
    return this.fetch('/health')
  }

  /**
   * Get current SmartSheet user
   */
  async getCurrentUser(): Promise<
    ApiResponse<{
      id: number
      email: string
      first_name?: string
      last_name?: string
    }>
  > {
    return this.fetch('/user')
  }

  /**
   * List all accessible sheets
   */
  async listSheets(params?: {
    include_all?: boolean
    page_size?: number
  }): Promise<SheetListResponse> {
    const query = new URLSearchParams()
    if (params?.include_all !== undefined) {
      query.set('include_all', String(params.include_all))
    }
    if (params?.page_size) {
      query.set('page_size', String(params.page_size))
    }

    const queryString = query.toString()
    return this.fetch(`/sheets${queryString ? `?${queryString}` : ''}`)
  }

  /**
   * Get sheet with full details
   */
  async getSheet(
    sheetId: number,
    params?: {
      level?: number
      include?: string
      use_cache?: boolean
      cache_ttl?: number
    }
  ): Promise<SheetResponse> {
    const query = new URLSearchParams()
    if (params?.level !== undefined) {
      query.set('level', String(params.level))
    }
    if (params?.include) {
      query.set('include', params.include)
    }
    if (params?.use_cache !== undefined) {
      query.set('use_cache', String(params.use_cache))
    }
    if (params?.cache_ttl) {
      query.set('cache_ttl', String(params.cache_ttl))
    }

    const queryString = query.toString()
    return this.fetch(
      `/sheets/${sheetId}${queryString ? `?${queryString}` : ''}`
    )
  }

  /**
   * Get sheet statistics
   */
  async getSheetStatistics(
    sheetId: number
  ): Promise<ApiResponse<SheetStatistics>> {
    return this.fetch(`/sheets/${sheetId}/statistics`)
  }

  /**
   * Import outbound data from SmartSheet (high-performance)
   * This is the main method for fast data fetching
   */
  async importOutboundData(params?: {
    sheet_id?: number
    use_cache?: boolean
    cache_ttl?: number
  }): Promise<OutboundImportResponse> {
    const query = new URLSearchParams()
    if (params?.sheet_id) {
      query.set('sheet_id', String(params.sheet_id))
    }
    if (params?.use_cache !== undefined) {
      query.set('use_cache', String(params.use_cache))
    }
    if (params?.cache_ttl) {
      query.set('cache_ttl', String(params.cache_ttl))
    }

    const queryString = query.toString()
    return this.fetch(
      `/import/outbound-data${queryString ? `?${queryString}` : ''}`
    )
  }

  /**
   * Clear SmartSheet cache
   */
  async clearCache(pattern: string): Promise<ApiResponse<void>> {
    return this.fetch(`/cache/${encodeURIComponent(pattern)}`, {
      method: 'DELETE',
    })
  }

  // ==================== WRITE OPERATIONS ====================

  /**
   * Update cells in a row
   */
  async updateCells(
    sheetId: number,
    rowId: number,
    cellUpdates: CellUpdate[]
  ): Promise<UpdateCellsResponse> {
    return this.fetch(`/sheets/${sheetId}/rows/${rowId}/cells`, {
      method: 'PUT',
      body: JSON.stringify({ cell_updates: cellUpdates }),
    })
  }

  /**
   * Add rows to a sheet
   */
  async addRows(
    sheetId: number,
    rowsData: NewRowData[],
    location?: 'toTop' | 'toBottom'
  ): Promise<AddRowsResponse> {
    return this.fetch(`/sheets/${sheetId}/rows`, {
      method: 'POST',
      body: JSON.stringify({
        rows_data: rowsData,
        location: location || 'toBottom',
      }),
    })
  }

  /**
   * Delete rows from a sheet
   */
  async deleteRows(
    sheetId: number,
    rowIds: number[],
    ignoreNotFound?: boolean
  ): Promise<DeleteRowsResponse> {
    return this.fetch(`/sheets/${sheetId}/rows`, {
      method: 'DELETE',
      body: JSON.stringify({
        row_ids: rowIds,
        ignore_not_found: ignoreNotFound ?? false,
      }),
    })
  }

  // ==================== ATTACHMENT OPERATIONS ====================

  /**
   * List row attachments
   */
  async listRowAttachments(
    sheetId: number,
    rowId: number
  ): Promise<ApiResponse<AttachmentsResponse>> {
    return this.fetch(`/sheets/${sheetId}/rows/${rowId}/attachments`)
  }

  /**
   * Attach URL to row
   */
  async attachUrlToRow(
    sheetId: number,
    rowId: number,
    url: string,
    name: string
  ): Promise<ApiResponse<AttachmentResponse>> {
    return this.fetch(`/sheets/${sheetId}/rows/${rowId}/attachments/url`, {
      method: 'POST',
      body: JSON.stringify({ url, name }),
    })
  }

  // ==================== ATTACHMENT EXTENDED OPERATIONS ====================

  /**
   * List sheet attachments
   */
  async listSheetAttachments(
    sheetId: number
  ): Promise<ApiResponse<AttachmentsResponse>> {
    return this.fetch(`/sheets/${sheetId}/attachments`)
  }

  /**
   * Get attachment details (includes download URL)
   */
  async getAttachment(
    sheetId: number,
    attachmentId: number
  ): Promise<ApiResponse<AttachmentDetailData>> {
    return this.fetch(`/sheets/${sheetId}/attachments/${attachmentId}`)
  }

  /**
   * Delete attachment
   */
  async deleteAttachment(
    sheetId: number,
    attachmentId: number
  ): Promise<ApiResponse<DeleteResponse>> {
    return this.fetch(`/sheets/${sheetId}/attachments/${attachmentId}`, {
      method: 'DELETE',
    })
  }

  // ==================== DISCUSSION OPERATIONS ====================

  /**
   * List row discussions
   */
  async listRowDiscussions(
    sheetId: number,
    rowId: number
  ): Promise<ApiResponse<DiscussionsResponse>> {
    return this.fetch(`/sheets/${sheetId}/rows/${rowId}/discussions`)
  }

  /**
   * Create row discussion
   */
  async createRowDiscussion(
    sheetId: number,
    rowId: number,
    comment: string
  ): Promise<ApiResponse<DiscussionResponse>> {
    return this.fetch(`/sheets/${sheetId}/rows/${rowId}/discussions`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    })
  }

  /**
   * Get a specific discussion with all comments
   */
  async getDiscussion(
    sheetId: number,
    discussionId: number
  ): Promise<ApiResponse<DiscussionDetailData>> {
    return this.fetch(`/sheets/${sheetId}/discussions/${discussionId}`)
  }

  /**
   * Add comment to discussion
   */
  async addCommentToDiscussion(
    sheetId: number,
    discussionId: number,
    text: string
  ): Promise<ApiResponse<CommentResponseData>> {
    return this.fetch(
      `/sheets/${sheetId}/discussions/${discussionId}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({ text }),
      }
    )
  }

  /**
   * Update comment
   */
  async updateComment(
    sheetId: number,
    commentId: number,
    text: string
  ): Promise<ApiResponse<CommentResponseData>> {
    return this.fetch(`/sheets/${sheetId}/comments/${commentId}`, {
      method: 'PUT',
      body: JSON.stringify({ text }),
    })
  }

  /**
   * Delete comment
   */
  async deleteComment(
    sheetId: number,
    commentId: number
  ): Promise<ApiResponse<DeleteResponse>> {
    return this.fetch(`/sheets/${sheetId}/comments/${commentId}`, {
      method: 'DELETE',
    })
  }

  /**
   * Delete discussion
   */
  async deleteDiscussion(
    sheetId: number,
    discussionId: number
  ): Promise<ApiResponse<DeleteResponse>> {
    return this.fetch(`/sheets/${sheetId}/discussions/${discussionId}`, {
      method: 'DELETE',
    })
  }

  // ==================== DASHBOARD OPERATIONS ====================

  /**
   * Get dashboard statistics
   */
  async getDashboardStats(): Promise<DashboardStatsResponse> {
    return this.fetch('/dashboard/stats')
  }
}

// ==================== SINGLETON INSTANCE ====================

export const rustSmartsheetService = new RustSmartsheetService()

// ==================== HYBRID SERVICE ====================

/**
 * Hybrid SmartSheet service that uses Rust when available, falls back to Python
 */
export class HybridSmartsheetService {
  private rustService: RustSmartsheetService
  private pythonApiUrl: string

  constructor() {
    this.rustService = rustSmartsheetService
    this.pythonApiUrl = this.getPythonApiUrl()
  }

  private getPythonApiUrl(): string {
    if (typeof window !== 'undefined') {
      if (window.location.origin === 'http://localhost:5173') {
        return 'http://localhost:8000'
      }
      return window.location.origin
    }
    return 'http://localhost:8000'
  }

  /**
   * Import outbound data with automatic fallback
   */
  async importOutboundData(
    token: string,
    params?: {
      sheet_id?: number
      use_cache?: boolean
    }
  ): Promise<{
    success: boolean
    data: {
      headers: string[]
      rows: string[][]
      sheet_id: number
      sheet_name: string
      total_rows: number
      columns_count: number
    }
    message: string
    source: 'rust' | 'python'
    execution_time_ms?: number
  }> {
    const startTime = performance.now()

    // Try Rust service first if enabled
    if (this.rustService.isEnabled()) {
      try {
        this.rustService.setToken(token)
        const result = await this.rustService.importOutboundData({
          sheet_id: params?.sheet_id,
          use_cache: params?.use_cache ?? true,
        })

        const endTime = performance.now()

        return {
          success: result.success,
          data: result.data,
          message: result.message,
          source: 'rust',
          execution_time_ms: Math.round(endTime - startTime),
        }
      } catch (error) {
        logger.warn('🦀 Rust SmartSheet failed, falling back to Python:', error)
      }
    }

    // Fallback to Python
    const response = await fetch(
      `${this.pythonApiUrl}/api/smartsheet/import/outbound-data${
        params?.sheet_id ? `?sheet_id=${params.sheet_id}` : ''
      }`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Python API error: ${response.status} - ${errorText}`)
    }

    const result = await response.json()
    const endTime = performance.now()

    return {
      success: result.success,
      data: result.data,
      message: result.message,
      source: 'python',
      execution_time_ms: Math.round(endTime - startTime),
    }
  }

  /**
   * Health check for both services
   */
  async healthCheck(): Promise<{
    rust: SmartsheetHealthResponse | null
    python: { connected: boolean; error?: string }
  }> {
    let rustHealth: SmartsheetHealthResponse | null = null
    let pythonHealth: { connected: boolean; error?: string } = {
      connected: false,
    }

    // Check Rust service
    if (this.rustService.isEnabled()) {
      try {
        rustHealth = await this.rustService.healthCheck()
      } catch (error) {
        logger.warn('Rust SmartSheet health check failed:', error)
      }
    }

    // Check Python service
    try {
      const response = await fetch(`${this.pythonApiUrl}/api/smartsheet/health`)
      pythonHealth = { connected: response.ok }
    } catch (error) {
      pythonHealth = { connected: false, error: String(error) }
    }

    return { rust: rustHealth, python: pythonHealth }
  }
}

export const hybridSmartsheetService = new HybridSmartsheetService()

export default rustSmartsheetService

// Created and developed by Jai Singh
