// Created and developed by Jai Singh
/**
 * OmniFrame Rust Core Service Client
 * High-performance queries via Rust backend
 */
import { supabase } from '@/lib/supabase/client'

export interface CoreConfig {
  baseUrl: string
  token?: string
  timeout?: number
}

export interface InboundScan {
  id: string
  created_at: string | null
  updated_at: string | null
  organization_id: string | null
  scanned_by: string | null
  scanned_at: string | null
  material_number: string | null
  tka_batch_number: string | null
  tracking_number: string | null
  so_line_rma_afa: string | null
  quantity: number | null
  scan_location: string | null
  hot_truck: boolean | null
  notes: string | null
  barcode: string | null
}

export interface TransferOrder {
  id: string
  created_at: string | null
  to_number: string
  delivery_number: string | null
  material_number: string
  material_description: string | null
  requested_quantity: number
  picked_quantity: number | null
  source_storage_type: string | null
  source_storage_bin: string | null
  destination_storage_type: string | null
  destination_storage_bin: string | null
  status: string
  assigned_user: string | null
  completed_at: string | null
}

export interface WarehouseStats {
  inbound_today: number | null
  pending_tos: number | null
  completed_today: number | null
  pending_scans: number | null
  pending_counts: number | null
}

export interface MaterialMaster {
  material_number: string
  description: string | null
  material_group: string | null
  base_uom: string | null
  gross_weight: number | null
  net_weight: number | null
  volume: number | null
}

export interface ValidationResult {
  valid: boolean
  user_id?: string
  email?: string
  role?: string
  permissions?: string[]
  error?: string
  expires_at?: number
}

export interface HealthResponse {
  status: string
  version: string
  timestamp: number
  database?: {
    connected: boolean
    latency_ms: number
    pool_size: number
    idle_connections: number
  }
  redis?: {
    connected: boolean
    latency_ms: number
  }
  uptime_seconds?: number
}

export interface QueryResponse<T = unknown> {
  query_name: string
  data: T
  row_count: number
  execution_time_ms: number
}

export interface InboundScanResponse {
  scans: InboundScan[]
  total: number
  limit: number
  offset: number
}

export interface TransferOrderResponse {
  orders: TransferOrder[]
  limit: number
  offset: number
}

class RustCoreClient {
  private baseUrl: string
  private token?: string
  private timeout: number

  constructor(config: CoreConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.token = config.token
    this.timeout = config.timeout ?? 30000
  }

  setToken(token: string) {
    this.token = token
  }

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

      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      })

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

  // Health
  async healthCheck(): Promise<HealthResponse> {
    return this.fetch('/api/v1/health')
  }

  async detailedHealth(): Promise<HealthResponse> {
    return this.fetch('/api/v1/health/detailed')
  }

  // Auth
  async validateToken(token: string): Promise<ValidationResult> {
    return this.fetch('/api/v1/auth/validate', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  }

  async getPermissions(userId: string): Promise<{
    user_id: string
    permissions: string[]
    roles: Array<{ id: string; name: string; description?: string }>
  }> {
    return this.fetch(`/api/v1/auth/permissions/${encodeURIComponent(userId)}`)
  }

  // Warehouse Queries
  async getInboundScans(params?: {
    limit?: number
    offset?: number
    user_id?: string
    start_date?: string
    end_date?: string
    material_number?: string
    hot_truck_only?: boolean
  }): Promise<InboundScanResponse> {
    const query = new URLSearchParams()
    if (params?.limit) query.set('limit', params.limit.toString())
    if (params?.offset) query.set('offset', params.offset.toString())
    if (params?.user_id) query.set('user_id', params.user_id)
    if (params?.start_date) query.set('start_date', params.start_date)
    if (params?.end_date) query.set('end_date', params.end_date)
    if (params?.material_number)
      query.set('material_number', params.material_number)
    if (params?.hot_truck_only !== undefined)
      query.set('hot_truck_only', String(params.hot_truck_only))

    return this.fetch(`/api/v1/warehouse/inbound-scans?${query}`)
  }

  async getInboundScanByBarcode(barcode: string): Promise<InboundScan | null> {
    return this.fetch(
      `/api/v1/warehouse/inbound-scans/${encodeURIComponent(barcode)}`
    )
  }

  async createInboundScan(scan: Partial<InboundScan>): Promise<InboundScan> {
    return this.fetch('/api/v1/warehouse/inbound-scans', {
      method: 'POST',
      body: JSON.stringify(scan),
    })
  }

  async getTransferOrders(params?: {
    status?: string
    limit?: number
    offset?: number
    assigned_user?: string
    material_number?: string
  }): Promise<TransferOrderResponse> {
    const query = new URLSearchParams()
    if (params?.status) query.set('status', params.status)
    if (params?.limit) query.set('limit', params.limit.toString())
    if (params?.offset) query.set('offset', params.offset.toString())
    if (params?.assigned_user) query.set('assigned_user', params.assigned_user)
    if (params?.material_number)
      query.set('material_number', params.material_number)

    return this.fetch(`/api/v1/warehouse/transfer-orders?${query}`)
  }

  async getTransferOrder(toNumber: string): Promise<TransferOrder | null> {
    return this.fetch(
      `/api/v1/warehouse/transfer-orders/${encodeURIComponent(toNumber)}`
    )
  }

  async updateTransferOrderStatus(
    toNumber: string,
    status: string,
    pickedQuantity?: number
  ): Promise<TransferOrder> {
    return this.fetch(
      `/api/v1/warehouse/transfer-orders/${encodeURIComponent(toNumber)}/status`,
      {
        method: 'PUT',
        body: JSON.stringify({ status, picked_quantity: pickedQuantity }),
      }
    )
  }

  async getWarehouseStats(): Promise<WarehouseStats> {
    return this.fetch('/api/v1/warehouse/stats')
  }

  async searchMaterials(
    query: string,
    limit: number = 20
  ): Promise<MaterialMaster[]> {
    const params = new URLSearchParams({ q: query, limit: limit.toString() })
    return this.fetch(`/api/v1/warehouse/materials/search?${params}`)
  }

  // Cache
  async cacheGet(
    key: string
  ): Promise<{ key: string; value: string | null; found: boolean }> {
    return this.fetch(`/api/v1/cache/${encodeURIComponent(key)}`)
  }

  async cacheSet(
    key: string,
    value: string,
    ttlSeconds?: number
  ): Promise<{ key: string; success: boolean }> {
    return this.fetch(`/api/v1/cache/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value, ttl_seconds: ttlSeconds }),
    })
  }

  async cacheDelete(key: string): Promise<{ key: string; deleted: boolean }> {
    return this.fetch(`/api/v1/cache/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    })
  }

  // Generic query execution
  async executeQuery<T = unknown>(
    queryName: string,
    parameters: Record<string, unknown> = {}
  ): Promise<QueryResponse<T>> {
    return this.fetch('/api/v1/query', {
      method: 'POST',
      body: JSON.stringify({ query_name: queryName, parameters }),
    })
  }
}

// Singleton instance
let clientInstance: RustCoreClient | null = null

export function getRustCoreClient(config?: CoreConfig): RustCoreClient {
  if (!clientInstance && config) {
    clientInstance = new RustCoreClient(config)
  }
  if (!clientInstance) {
    throw new Error('RustCoreClient not initialized. Call with config first.')
  }
  return clientInstance
}

export function initRustCoreClient(config: CoreConfig): RustCoreClient {
  clientInstance = new RustCoreClient(config)
  return clientInstance
}

export { RustCoreClient }

// Created and developed by Jai Singh
