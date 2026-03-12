/**
 * Nefab PFC Trace API Service
 *
 * Frontend service for kit cart tracking integration.
 * Communicates with FastAPI backend endpoints.
 *
 * @author Jai Singh
 * @date December 17, 2025
 * @version 1.0.0
 */
import { supabase } from '@/lib/supabase/client'

// ==================== TYPES ====================

export interface NefabItemType {
  Id: number
  Name: string
}

export interface NefabTracker {
  Id: number
  ExternalId?: string
  LastUpdate?: string
  Battery?: number
  LocationTime?: string
  Lat?: number
  Lng?: number
  Radius?: number
  LocationSourceId?: number
  LocationSourceName?: string
}

export interface NefabWarehouse {
  Id: number
  Name: string
  TypeId?: number
  TypeName?: string
}

export interface NefabLocation {
  Id?: number
  Name?: string
}

export interface NefabItem {
  Id: number
  Name: string
  Description?: string
  ItemType?: NefabItemType // Made optional - some items may not have ItemType
  LastUpdate?: string
  Trackers?: NefabTracker[]
  StatusId?: number
  StatusName?: string
  StatusWarehouse?: NefabWarehouse
  Cycles?: number
  Trips?: number
  Location?: NefabLocation
  FreeField1Name?: string
  FreeField2Name?: string
}

export interface NefabItemsResponse {
  success: boolean
  message?: string
  items: NefabItem[]
  total_count: number
  item_type_filter?: number
  cached: boolean
  cache_age_seconds?: number
  last_updated?: string
}

export interface NefabStatisticsResponse {
  success: boolean
  message?: string
  total_items: number
  by_item_type: Record<string, number>
  by_status: Record<string, number>
  by_warehouse: Record<string, number>
  cached: boolean
}

export interface NefabItemTypesResponse {
  success: boolean
  message?: string
  item_types: NefabItemType[]
}

export interface NefabServiceResponse {
  success: boolean
  message?: string
  error?: string
  data?: unknown
  cached?: boolean
  cache_age_seconds?: number
}

// ==================== API CLIENT ====================

/**
 * Get the base API URL from environment or fallback to localhost
 * Uses import.meta.env.VITE_API_URL for production deployments
 */
const getApiBaseUrl = (): string => {
  // Check for explicit API URL from environment
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }

  // Local development detection
  if (
    typeof window !== 'undefined' &&
    window.location.origin === 'http://localhost:5173'
  ) {
    return 'http://localhost:8000'
  }

  // Fallback for local development
  return 'http://localhost:8000'
}

class NefabApiService {
  private baseUrl: string

  constructor() {
    this.baseUrl = `${getApiBaseUrl()}/api/nefab`
  }

  private async getAuthHeaders(
    includeContentType: boolean = false
  ): Promise<HeadersInit> {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token) {
      throw new Error('Authentication required')
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.access_token}`,
    }

    // Only set Content-Type when a request body will be sent (avoids unnecessary CORS preflights on GET)
    if (includeContentType) {
      headers['Content-Type'] = 'application/json'
    }

    return headers
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage: string

      try {
        const errorData = JSON.parse(errorText)
        errorMessage =
          errorData.detail || errorData.message || `HTTP ${response.status}`
      } catch {
        errorMessage =
          errorText || `HTTP ${response.status}: ${response.statusText}`
      }

      throw new Error(errorMessage)
    }

    return response.json()
  }

  /**
   * Check Nefab API connection health
   */
  async healthCheck(): Promise<NefabServiceResponse> {
    const headers = await this.getAuthHeaders()
    const response = await fetch(`${this.baseUrl}/health`, { headers })
    return this.handleResponse<NefabServiceResponse>(response)
  }

  /**
   * Get all items from Nefab PFC Trace
   */
  async getAllItems(options?: {
    itemTypeId?: number
    useCache?: boolean
  }): Promise<NefabItemsResponse> {
    const headers = await this.getAuthHeaders()

    const params = new URLSearchParams()
    if (options?.itemTypeId) {
      params.append('item_type_id', options.itemTypeId.toString())
    }
    if (options?.useCache !== undefined) {
      params.append('use_cache', options.useCache.toString())
    }

    const url = `${this.baseUrl}/items${params.toString() ? `?${params}` : ''}`
    const response = await fetch(url, { headers })
    return this.handleResponse<NefabItemsResponse>(response)
  }

  /**
   * Get kit cart items only
   */
  async getKitCarts(useCache: boolean = true): Promise<NefabItemsResponse> {
    const headers = await this.getAuthHeaders()
    const url = `${this.baseUrl}/kit-carts?use_cache=${useCache}`
    const response = await fetch(url, { headers })
    return this.handleResponse<NefabItemsResponse>(response)
  }

  /**
   * Get items filtered by specific item type
   */
  async getItemsByType(
    itemTypeId: number,
    useCache: boolean = true
  ): Promise<NefabItemsResponse> {
    const headers = await this.getAuthHeaders()
    const url = `${this.baseUrl}/items/by-type/${itemTypeId}?use_cache=${useCache}`
    const response = await fetch(url, { headers })
    return this.handleResponse<NefabItemsResponse>(response)
  }

  /**
   * Get available item types
   */
  async getItemTypes(
    kitCartsOnly: boolean = false
  ): Promise<NefabItemTypesResponse> {
    const headers = await this.getAuthHeaders()
    const url = `${this.baseUrl}/item-types?kit_carts_only=${kitCartsOnly}`
    const response = await fetch(url, { headers })
    return this.handleResponse<NefabItemTypesResponse>(response)
  }

  /**
   * Get statistics about all items
   */
  async getStatistics(
    useCache: boolean = true
  ): Promise<NefabStatisticsResponse> {
    const headers = await this.getAuthHeaders()
    const url = `${this.baseUrl}/statistics?use_cache=${useCache}`
    const response = await fetch(url, { headers })
    return this.handleResponse<NefabStatisticsResponse>(response)
  }

  /**
   * Force refresh items (bypass cache)
   */
  async refreshItems(itemTypeId?: number): Promise<NefabItemsResponse> {
    const headers = await this.getAuthHeaders()
    const params = itemTypeId ? `?item_type_id=${itemTypeId}` : ''
    const url = `${this.baseUrl}/items/refresh${params}`
    const response = await fetch(url, { headers })
    return this.handleResponse<NefabItemsResponse>(response)
  }

  /**
   * Clear the backend cache
   */
  async clearCache(): Promise<NefabServiceResponse> {
    const headers = await this.getAuthHeaders()
    const response = await fetch(`${this.baseUrl}/cache/clear`, {
      method: 'POST',
      headers,
    })
    return this.handleResponse<NefabServiceResponse>(response)
  }
}

// Export singleton instance
export const nefabApiService = new NefabApiService()

// ==================== STATIC DATA ====================

/**
 * Kit cart item type IDs for filtering
 */
export const KIT_CART_ITEM_TYPE_IDS = [
  305, 310, 311, 312, 313, 314, 315, 316, 319,
]

/**
 * All available item types
 */
export const NEFAB_ITEM_TYPES: NefabItemType[] = [
  { Id: 320, Name: 'Banded Stators' },
  { Id: 376, Name: 'Excellence Material Movement' },
  { Id: 403, Name: 'Finished Goods Container' },
  { Id: 307, Name: 'Gateways' },
  { Id: 312, Name: 'Kit Cart 1107 Flow' },
  { Id: 311, Name: 'Kit Cart 2100 Flow' },
  { Id: 313, Name: 'Kit Cart 3007 Flow' },
  { Id: 305, Name: 'Kit Cart AE Common' },
  { Id: 319, Name: 'Kit Cart Industrial' },
  { Id: 310, Name: 'Kit Cart LiftFan' },
  { Id: 316, Name: 'Kit Cart RR300' },
  { Id: 314, Name: 'Kit Cart Series II' },
  { Id: 315, Name: 'Kit Cart Series IV' },
  { Id: 324, Name: 'LiftSystem Flight Case' },
  { Id: 322, Name: 'LiftSystem Tote' },
  { Id: 348, Name: 'MRB' },
  { Id: 332, Name: 'Pelican Case' },
  { Id: 331, Name: 'Plastic Pallet 32 x 38' },
  { Id: 390, Name: 'Plastic Pallet 40x48' },
  { Id: 347, Name: 'PQHC' },
  { Id: 370, Name: 'Production Part' },
  { Id: 308, Name: 'Raw Material Container' },
  { Id: 309, Name: 'Reference tag' },
  { Id: 318, Name: 'RR300' },
  { Id: 351, Name: 'SPARE PART TOTE' },
  { Id: 317, Name: 'Vendor Returnables' },
  { Id: 350, Name: 'Victory Material Movement' },
]

/**
 * Get kit cart item types only
 */
export const getKitCartItemTypes = (): NefabItemType[] => {
  return NEFAB_ITEM_TYPES.filter((type) =>
    KIT_CART_ITEM_TYPE_IDS.includes(type.Id)
  )
}
// Developer and Creator: Jai Singh
