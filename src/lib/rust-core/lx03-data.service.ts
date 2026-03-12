/**
 * Rust-enabled LX03 Data Service
 *
 * This service provides LX03 data operations using the high-performance
 * Rust core service. Falls back to Supabase if Rust service is unavailable.
 *
 * Supported Rust queries: lx03_data, lx03_statistics
 * Enable by setting VITE_RUST_CORE_ENABLED=true and VITE_RUST_CORE_URL
 */
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import { getRustCoreClient, initRustCoreClient } from './client'
import { RUST_CORE_ENABLED, RUST_CORE_URL } from './config'

// Type definition matching the supabase service interface exactly
export interface LX03Data {
  id: string
  organization_id: string
  storage_type: string | null
  plant: string | null
  storage_bin: string
  storage_location: string | null
  material: string
  stock_category: string | null
  special_stock: string | null
  storage_type_2: string | null
  total_stock: number
  available_stock: number
  stock_for_putaway: number | null
  pick_quantity: number | null
  last_movement: string | null
  last_movement_2: string | null
  last_inventory: string | null
  special_stock_number: string | null
  batch: string | null
  inventory_active: string | null
  stock_removal_block: string | null
  putaway_block: string | null
  delivery: string | null
  inventory_record: string | null
  inventory_record_2: string | null
  warehouse: string | null
  created_at: string | null
  updated_at: string | null
}

// Statistics interface
export interface LX03Statistics {
  total: number
  todayCount: number
  uniqueMaterials: number
  uniqueLocations: number
  uniquePlants: number
  totalStock: number
  totalAvailableStock: number
  recordsWithStock: number
  emptyLocations: number
}

/**
 * Initialize Rust client if not already done
 */
function ensureRustClientInitialized(): boolean {
  if (!RUST_CORE_ENABLED) {
    return false
  }

  try {
    initRustCoreClient({ baseUrl: RUST_CORE_URL })
    return true
  } catch {
    // Client already initialized or error
    return true
  }
}

/**
 * Rust-enabled LX03 Data Service
 * Uses Rust core service when enabled, falls back to Supabase otherwise
 */
export class RustLX03DataService {
  private static instance: RustLX03DataService
  private useRust: boolean

  private constructor() {
    this.useRust = ensureRustClientInitialized() && RUST_CORE_ENABLED
    logger.log(
      `🦀 RustLX03DataService initialized - Rust enabled: ${this.useRust}`
    )
  }

  public static getInstance(): RustLX03DataService {
    if (!RustLX03DataService.instance) {
      RustLX03DataService.instance = new RustLX03DataService()
    }
    return RustLX03DataService.instance
  }

  /**
   * Check if Rust service is being used
   */
  isUsingRust(): boolean {
    return this.useRust
  }

  /**
   * Fetch LX03 data with optional search
   * Uses Rust service via generic query endpoint when enabled
   */
  async fetchLX03Data(searchQuery?: string): Promise<LX03Data[]> {
    if (!this.useRust) {
      return this.fetchLX03DataSupabase(searchQuery)
    }

    try {
      logger.log('🦀 Fetching LX03 data via Rust core service...')
      const client = getRustCoreClient()
      const startTime = performance.now()

      // Use generic query endpoint for LX03 data
      const response = await client.executeQuery<LX03Data[]>('lx03_data', {
        search_query: searchQuery || '',
        limit: 1000,
      })

      const fetchTime = performance.now() - startTime
      logger.log(
        `✅ Rust service: Fetched ${response.data.length} LX03 records in ${fetchTime.toFixed(0)}ms`
      )

      return response.data
    } catch (error) {
      logger.warn(
        '⚠️ Rust service unavailable, falling back to Supabase:',
        error
      )
      return this.fetchLX03DataSupabase(searchQuery)
    }
  }

  /**
   * Supabase fallback for fetching LX03 data
   */
  private async fetchLX03DataSupabase(
    searchQuery?: string
  ): Promise<LX03Data[]> {
    try {
      logger.log('📦 Fetching LX03 data via Supabase (fallback)...')

      let query = supabase.from('rr_lx03_data').select('*')

      // If there's a search query, search across all columns in entire database
      if (searchQuery && searchQuery.trim()) {
        const searchTerm = searchQuery.trim().toLowerCase()
        query = query.or(
          `storage_bin.ilike.%${searchTerm}%,material.ilike.%${searchTerm}%,storage_location.ilike.%${searchTerm}%,plant.ilike.%${searchTerm}%,delivery.ilike.%${searchTerm}%,batch.ilike.%${searchTerm}%,stock_category.ilike.%${searchTerm}%`
        )
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(1000)

      if (error) throw error

      return (data || []) as LX03Data[]
    } catch (error) {
      logger.error('Error fetching LX03 data:', error)
      return []
    }
  }

  /**
   * Fetch statistics for LX03 data
   * Uses Rust service when enabled
   */
  async getStatistics(): Promise<LX03Statistics> {
    if (!this.useRust) {
      return this.getStatisticsSupabase()
    }

    try {
      logger.log('🦀 Fetching LX03 statistics via Rust core service...')
      const client = getRustCoreClient()

      // Use generic query endpoint for statistics
      const response = await client.executeQuery<LX03Statistics>(
        'lx03_statistics',
        {}
      )

      logger.log('✅ Rust service: Fetched LX03 statistics')
      return response.data
    } catch (error) {
      logger.warn(
        '⚠️ Rust statistics unavailable, falling back to Supabase:',
        error
      )
      return this.getStatisticsSupabase()
    }
  }

  /**
   * Supabase fallback for statistics
   */
  private async getStatisticsSupabase(): Promise<LX03Statistics> {
    try {
      logger.log('📦 Fetching LX03 statistics via Supabase (fallback)...')

      // Use RPC function to get accurate statistics from ALL records
      const { data, error } = await (
        supabase.rpc as (name: string) => ReturnType<typeof supabase.rpc>
      )('get_lx03_statistics')

      if (error) {
        logger.error('❌ Statistics RPC error:', error)
        throw error
      }

      const stats = (data as Record<string, unknown>) || {}

      return {
        total: Number(stats.total) || 0,
        todayCount: Number(stats.todayCount) || 0,
        uniqueMaterials: Number(stats.uniqueMaterials) || 0,
        uniqueLocations: Number(stats.uniqueLocations) || 0,
        uniquePlants: Number(stats.uniquePlants) || 0,
        totalStock: Number(stats.totalStock) || 0,
        totalAvailableStock: Number(stats.totalAvailableStock) || 0,
        recordsWithStock: Number(stats.recordsWithStock) || 0,
        emptyLocations: Number(stats.emptyLocations) || 0,
      }
    } catch (error) {
      logger.error('❌ Error getting LX03 statistics:', error)
      return {
        total: 0,
        todayCount: 0,
        uniqueMaterials: 0,
        uniqueLocations: 0,
        uniquePlants: 0,
        totalStock: 0,
        totalAvailableStock: 0,
        recordsWithStock: 0,
        emptyLocations: 0,
      }
    }
  }

  /**
   * Search LX03 data
   * Client-side filtering for already loaded data
   */
  filterData(data: LX03Data[], searchQuery: string): LX03Data[] {
    if (!searchQuery.trim()) {
      return data
    }

    const query = searchQuery.toLowerCase().replace(/\s+/g, ' ').trim()

    return data.filter((item) => {
      const normalizeField = (value: string | null | undefined): string => {
        return (value || '').toLowerCase().replace(/\s+/g, ' ').trim()
      }

      return (
        normalizeField(item.material).includes(query) ||
        normalizeField(item.plant).includes(query) ||
        normalizeField(item.storage_location).includes(query) ||
        normalizeField(item.warehouse).includes(query) ||
        normalizeField(item.delivery).includes(query) ||
        normalizeField(item.batch).includes(query) ||
        normalizeField(item.storage_bin).includes(query) ||
        normalizeField(item.stock_category).includes(query) ||
        normalizeField(item.storage_type).includes(query)
      )
    })
  }

  /**
   * Delete LX03 record
   */
  async deleteRecord(
    id: string
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      const { error } = await supabase
        .from('rr_lx03_data')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { success: true, error: null }
    } catch (error) {
      logger.error('Error deleting LX03 data:', error)
      return { success: false, error }
    }
  }

  /**
   * Clear all LX03 data
   */
  async clearAllData(
    _showToast: boolean = true
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      logger.log('🗑️ Clearing all LX03 data...')

      const { error } = await supabase
        .from('rr_lx03_data')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000')

      if (error) throw error

      logger.log('✅ LX03 data cleared successfully')
      return { success: true, error: null }
    } catch (error) {
      logger.error('❌ Error clearing LX03 data:', error)
      return { success: false, error }
    }
  }
}

// Export singleton instance
export const rustLX03DataService = RustLX03DataService.getInstance()
// Developer and Creator: Jai Singh
