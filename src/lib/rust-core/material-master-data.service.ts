/**
 * Rust-enabled Material Master Data Service
 *
 * This service provides Material Master data operations using the high-performance
 * Rust core service. Falls back to Supabase for operations not yet supported.
 *
 * Enable by setting VITE_RUST_CORE_ENABLED=true and VITE_RUST_CORE_URL
 */
import { supabase } from '@/lib/supabase/client'
import type { Tables } from '@/lib/supabase/database.types'
import { logger } from '@/lib/utils/logger'
import { getRustCoreClient, initRustCoreClient } from './client'
import {
  RUST_CORE_ENABLED,
  RUST_CORE_URL,
  SUPPORTED_RUST_QUERIES,
} from './config'

// Re-export type from database types for compatibility
export type MaterialMasterData = Tables<'rr_mlgt_data'>

// Statistics interface
export interface MaterialMasterStatistics {
  total: number
  todayCount: number
  uniqueMaterials: number
  uniqueWarehouses: number
  uniqueStorageTypes: number
  recordsWithDimensions: number
  recordsWithWeight: number
  recordsWithQuantityLimits: number
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
 * Rust-enabled Material Master Data Service
 * Uses Rust core service when enabled, falls back to Supabase otherwise
 */
export class RustMaterialMasterDataService {
  private static instance: RustMaterialMasterDataService
  private useRust: boolean

  private constructor() {
    this.useRust = ensureRustClientInitialized() && RUST_CORE_ENABLED
    logger.log(
      `🦀 RustMaterialMasterDataService initialized - Rust enabled: ${this.useRust}`
    )
  }

  public static getInstance(): RustMaterialMasterDataService {
    if (!RustMaterialMasterDataService.instance) {
      RustMaterialMasterDataService.instance =
        new RustMaterialMasterDataService()
    }
    return RustMaterialMasterDataService.instance
  }

  /**
   * Check if Rust service is being used
   */
  isUsingRust(): boolean {
    return this.useRust
  }

  /**
   * Fetch Material Master data with optional search
   * Uses Rust service via generic query endpoint when enabled
   */
  async fetchMaterialMasterData(
    searchQuery?: string
  ): Promise<MaterialMasterData[]> {
    if (!this.useRust || !SUPPORTED_RUST_QUERIES.has('material_master_data')) {
      return this.fetchMaterialMasterDataSupabase(searchQuery)
    }

    try {
      logger.log('🦀 Fetching Material Master data via Rust core service...')
      const client = getRustCoreClient()
      const startTime = performance.now()

      // Use generic query endpoint for Material Master data
      const response = await client.executeQuery<MaterialMasterData[]>(
        'material_master_data',
        {
          search_query: searchQuery || '',
          limit: 1000,
        }
      )

      const fetchTime = performance.now() - startTime
      logger.log(
        `✅ Rust service: Fetched ${response.data.length} Material Master records in ${fetchTime.toFixed(0)}ms`
      )

      return response.data
    } catch (error) {
      logger.error('❌ Rust service error, falling back to Supabase:', error)
      return this.fetchMaterialMasterDataSupabase(searchQuery)
    }
  }

  /**
   * Supabase fallback for fetching Material Master data
   */
  private async fetchMaterialMasterDataSupabase(
    searchQuery?: string
  ): Promise<MaterialMasterData[]> {
    try {
      logger.log('📦 Fetching Material Master data via Supabase (fallback)...')

      let query = supabase.from('rr_mlgt_data').select('*')

      // If there's a search query, search across all columns
      if (searchQuery && searchQuery.trim()) {
        const searchTerm = searchQuery.trim().toLowerCase()
        query = query.or(
          `material.ilike.%${searchTerm}%,warehouse_number.ilike.%${searchTerm}%,storage_type.ilike.%${searchTerm}%,storage_bin.ilike.%${searchTerm}%,crl_status.ilike.%${searchTerm}%`
        )
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(1000)

      if (error) throw error

      return (data || []) as MaterialMasterData[]
    } catch (error) {
      logger.error('Error fetching Material Master data:', error)
      return []
    }
  }

  /**
   * Fetch statistics for Material Master data
   * Uses Rust service when enabled
   */
  async getStatistics(): Promise<MaterialMasterStatistics> {
    if (
      !this.useRust ||
      !SUPPORTED_RUST_QUERIES.has('material_master_statistics')
    ) {
      return this.getStatisticsSupabase()
    }

    try {
      logger.log(
        '🦀 Fetching Material Master statistics via Rust core service...'
      )
      const client = getRustCoreClient()

      const response = await client.executeQuery<MaterialMasterStatistics>(
        'material_master_statistics',
        {}
      )

      logger.log('✅ Rust service: Fetched Material Master statistics')
      return response.data
    } catch (error) {
      logger.error('❌ Rust statistics error, falling back to Supabase:', error)
      return this.getStatisticsSupabase()
    }
  }

  /**
   * Supabase fallback for statistics
   */
  private async getStatisticsSupabase(): Promise<MaterialMasterStatistics> {
    try {
      logger.log(
        '📦 Fetching Material Master statistics via Supabase (fallback)...'
      )

      // Get total count
      const { count: totalCount } = await supabase
        .from('rr_mlgt_data')
        .select('*', { count: 'exact', head: true })

      // Get today's count
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const { count: todayCount } = await supabase
        .from('rr_mlgt_data')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today.toISOString())

      // Get unique materials
      const { data: materialData } = await supabase
        .from('rr_mlgt_data')
        .select('material')
        .not('material', 'is', null)

      // Get unique warehouses
      const { data: warehouseData } = await supabase
        .from('rr_mlgt_data')
        .select('warehouse_number')
        .not('warehouse_number', 'is', null)

      // Get unique storage types
      const { data: storageTypeData } = await supabase
        .from('rr_mlgt_data')
        .select('storage_type')
        .not('storage_type', 'is', null)

      // Get records with dimensions (length, width, height)
      const { count: withDimensionsCount } = await supabase
        .from('rr_mlgt_data')
        .select('*', { count: 'exact', head: true })
        .not('length', 'is', null)
        .not('width', 'is', null)
        .not('height', 'is', null)

      // Get records with weight
      const { count: withWeightCount } = await supabase
        .from('rr_mlgt_data')
        .select('*', { count: 'exact', head: true })
        .not('weight', 'is', null)

      // Get records with quantity limits
      const { count: withQuantityLimitsCount } = await supabase
        .from('rr_mlgt_data')
        .select('*', { count: 'exact', head: true })
        .or('min_quantity.not.is.null,max_quantity.not.is.null')

      return {
        total: totalCount || 0,
        todayCount: todayCount || 0,
        uniqueMaterials: materialData
          ? new Set(materialData.map((r) => r.material).filter(Boolean)).size
          : 0,
        uniqueWarehouses: warehouseData
          ? new Set(
              warehouseData.map((r) => r.warehouse_number).filter(Boolean)
            ).size
          : 0,
        uniqueStorageTypes: storageTypeData
          ? new Set(storageTypeData.map((r) => r.storage_type).filter(Boolean))
              .size
          : 0,
        recordsWithDimensions: withDimensionsCount || 0,
        recordsWithWeight: withWeightCount || 0,
        recordsWithQuantityLimits: withQuantityLimitsCount || 0,
      }
    } catch (error) {
      logger.error('❌ Error getting Material Master statistics:', error)
      return {
        total: 0,
        todayCount: 0,
        uniqueMaterials: 0,
        uniqueWarehouses: 0,
        uniqueStorageTypes: 0,
        recordsWithDimensions: 0,
        recordsWithWeight: 0,
        recordsWithQuantityLimits: 0,
      }
    }
  }

  /**
   * Search Material Master data
   * Client-side filtering for already loaded data
   */
  filterData(
    data: MaterialMasterData[],
    searchQuery: string
  ): MaterialMasterData[] {
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
        normalizeField(item.warehouse_number).includes(query) ||
        normalizeField(item.storage_type).includes(query) ||
        normalizeField(item.storage_bin).includes(query) ||
        normalizeField(item.crl_status).includes(query)
      )
    })
  }

  /**
   * Delete Material Master record
   */
  async deleteRecord(
    id: string
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      const { error } = await supabase
        .from('rr_mlgt_data')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { success: true, error: null }
    } catch (error) {
      logger.error('Error deleting Material Master data:', error)
      return { success: false, error }
    }
  }

  /**
   * Clear all Material Master data
   */
  async clearAllData(
    _showToast: boolean = true
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      logger.log('🗑️ Clearing all Material Master data...')

      const { error } = await supabase
        .from('rr_mlgt_data')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000')

      if (error) throw error

      logger.log('✅ Material Master data cleared successfully')
      return { success: true, error: null }
    } catch (error) {
      logger.error('❌ Error clearing Material Master data:', error)
      return { success: false, error }
    }
  }
}

// Export singleton instance
export const rustMaterialMasterDataService =
  RustMaterialMasterDataService.getInstance()
// Developer and Creator: Jai Singh
