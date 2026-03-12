/**
 * Rust-enabled SQ01 Data Service
 *
 * This service provides SQ01 data operations using the high-performance
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
export type SQ01Data = Tables<'rr_sq01_data'>

// Statistics interface
export interface SQ01Statistics {
  total: number
  todayCount: number
  uniqueMaterials: number
  uniquePlants: number
  totalUnrestricted: number
  totalBlocked: number
  totalInQualInsp: number
  scannedRecords: number
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
 * Rust-enabled SQ01 Data Service
 * Uses Rust core service when enabled, falls back to Supabase otherwise
 */
export class RustSQ01DataService {
  private static instance: RustSQ01DataService
  private useRust: boolean

  private constructor() {
    this.useRust = ensureRustClientInitialized() && RUST_CORE_ENABLED
    logger.log(
      `🦀 RustSQ01DataService initialized - Rust enabled: ${this.useRust}`
    )
  }

  public static getInstance(): RustSQ01DataService {
    if (!RustSQ01DataService.instance) {
      RustSQ01DataService.instance = new RustSQ01DataService()
    }
    return RustSQ01DataService.instance
  }

  /**
   * Check if Rust service is being used
   */
  isUsingRust(): boolean {
    return this.useRust
  }

  /**
   * Fetch SQ01 data with optional search
   * Uses Rust service via generic query endpoint when enabled
   */
  async fetchSQ01Data(searchQuery?: string): Promise<SQ01Data[]> {
    if (!this.useRust || !SUPPORTED_RUST_QUERIES.has('sq01_data')) {
      return this.fetchSQ01DataSupabase(searchQuery)
    }

    try {
      logger.log('🦀 Fetching SQ01 data via Rust core service...')
      const client = getRustCoreClient()
      const startTime = performance.now()

      // Use generic query endpoint for SQ01 data
      const response = await client.executeQuery<SQ01Data[]>('sq01_data', {
        search_query: searchQuery || '',
        limit: 1000,
      })

      const fetchTime = performance.now() - startTime
      logger.log(
        `✅ Rust service: Fetched ${response.data.length} SQ01 records in ${fetchTime.toFixed(0)}ms`
      )

      return response.data
    } catch (error) {
      logger.error('❌ Rust service error, falling back to Supabase:', error)
      return this.fetchSQ01DataSupabase(searchQuery)
    }
  }

  /**
   * Supabase fallback for fetching SQ01 data
   */
  private async fetchSQ01DataSupabase(
    searchQuery?: string
  ): Promise<SQ01Data[]> {
    try {
      logger.log('📦 Fetching SQ01 data via Supabase (fallback)...')

      let query = supabase.from('rr_sq01_data').select('*')

      // If there's a search query, search across all columns
      if (searchQuery && searchQuery.trim()) {
        const searchTerm = searchQuery.trim().toLowerCase()
        query = query.or(
          `material.ilike.%${searchTerm}%,plant.ilike.%${searchTerm}%,sloc.ilike.%${searchTerm}%,batch.ilike.%${searchTerm}%,material_description.ilike.%${searchTerm}%,serial_number.ilike.%${searchTerm}%,val_type.ilike.%${searchTerm}%`
        )
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(1000)

      if (error) throw error

      return (data || []) as SQ01Data[]
    } catch (error) {
      logger.error('Error fetching SQ01 data:', error)
      return []
    }
  }

  /**
   * Fetch scanned SQ01 data only
   */
  async fetchScannedSQ01Data(): Promise<SQ01Data[]> {
    if (!this.useRust || !SUPPORTED_RUST_QUERIES.has('sq01_scanned_data')) {
      return this.fetchScannedSQ01DataSupabase()
    }

    try {
      logger.log('🦀 Fetching scanned SQ01 data via Rust core service...')
      const client = getRustCoreClient()
      const startTime = performance.now()

      const response = await client.executeQuery<SQ01Data[]>(
        'sq01_scanned_data',
        {
          limit: 1000,
        }
      )

      const fetchTime = performance.now() - startTime
      logger.log(
        `✅ Rust service: Fetched ${response.data.length} scanned SQ01 records in ${fetchTime.toFixed(0)}ms`
      )

      return response.data
    } catch (error) {
      logger.error('❌ Rust service error, falling back to Supabase:', error)
      return this.fetchScannedSQ01DataSupabase()
    }
  }

  /**
   * Supabase fallback for fetching scanned SQ01 data
   */
  private async fetchScannedSQ01DataSupabase(): Promise<SQ01Data[]> {
    try {
      const { data, error } = await supabase
        .from('rr_sq01_data')
        .select('*')
        .not('grs_location_scan_completed_at', 'is', null)
        .order('grs_location_scan_completed_at', { ascending: false })
        .limit(1000)

      if (error) throw error

      return (data || []) as SQ01Data[]
    } catch (error) {
      logger.error('Error fetching scanned SQ01 data:', error)
      return []
    }
  }

  /**
   * Fetch statistics for SQ01 data
   * Uses Rust service when enabled
   */
  async getStatistics(): Promise<SQ01Statistics> {
    if (!this.useRust || !SUPPORTED_RUST_QUERIES.has('sq01_statistics')) {
      return this.getStatisticsSupabase()
    }

    try {
      logger.log('🦀 Fetching SQ01 statistics via Rust core service...')
      const client = getRustCoreClient()

      const response = await client.executeQuery<SQ01Statistics>(
        'sq01_statistics',
        {}
      )

      logger.log('✅ Rust service: Fetched SQ01 statistics')
      return response.data
    } catch (error) {
      logger.error('❌ Rust statistics error, falling back to Supabase:', error)
      return this.getStatisticsSupabase()
    }
  }

  /**
   * Supabase fallback for statistics
   */
  private async getStatisticsSupabase(): Promise<SQ01Statistics> {
    try {
      logger.log('📦 Fetching SQ01 statistics via Supabase (fallback)...')

      // Get total count
      const { count: totalCount } = await supabase
        .from('rr_sq01_data')
        .select('*', { count: 'exact', head: true })

      // Get today's count
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const { count: todayCount } = await supabase
        .from('rr_sq01_data')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today.toISOString())

      // Get unique materials
      const { data: materialData } = await supabase
        .from('rr_sq01_data')
        .select('material')
        .not('material', 'is', null)

      // Get unique plants
      const { data: plantData } = await supabase
        .from('rr_sq01_data')
        .select('plant')
        .not('plant', 'is', null)

      // Get scanned records count
      const { count: scannedCount } = await supabase
        .from('rr_sq01_data')
        .select('*', { count: 'exact', head: true })
        .not('grs_location_scan_completed_at', 'is', null)

      // Get sum of unrestricted, blocked, and in_qual_insp
      const { data: stockData } = await supabase
        .from('rr_sq01_data')
        .select('unrestricted, blocked, in_qual_insp')

      let totalUnrestricted = 0
      let totalBlocked = 0
      let totalInQualInsp = 0

      if (stockData) {
        stockData.forEach((item) => {
          totalUnrestricted += Number(item.unrestricted) || 0
          totalBlocked += Number(item.blocked) || 0
          totalInQualInsp += Number(item.in_qual_insp) || 0
        })
      }

      return {
        total: totalCount || 0,
        todayCount: todayCount || 0,
        uniqueMaterials: materialData
          ? new Set(materialData.map((r) => r.material).filter(Boolean)).size
          : 0,
        uniquePlants: plantData
          ? new Set(plantData.map((r) => r.plant).filter(Boolean)).size
          : 0,
        totalUnrestricted,
        totalBlocked,
        totalInQualInsp,
        scannedRecords: scannedCount || 0,
      }
    } catch (error) {
      logger.error('❌ Error getting SQ01 statistics:', error)
      return {
        total: 0,
        todayCount: 0,
        uniqueMaterials: 0,
        uniquePlants: 0,
        totalUnrestricted: 0,
        totalBlocked: 0,
        totalInQualInsp: 0,
        scannedRecords: 0,
      }
    }
  }

  /**
   * Search SQ01 data
   * Client-side filtering for already loaded data
   */
  filterData(data: SQ01Data[], searchQuery: string): SQ01Data[] {
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
        normalizeField(item.sloc).includes(query) ||
        normalizeField(item.batch).includes(query) ||
        normalizeField(item.material_description).includes(query) ||
        normalizeField(item.serial_number).includes(query) ||
        normalizeField(item.val_type).includes(query) ||
        normalizeField(item.conf_cert_ref).includes(query) ||
        normalizeField(item.general_info).includes(query)
      )
    })
  }

  /**
   * Delete SQ01 record
   */
  async deleteRecord(
    id: string
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      const { error } = await supabase
        .from('rr_sq01_data')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { success: true, error: null }
    } catch (error) {
      logger.error('Error deleting SQ01 data:', error)
      return { success: false, error }
    }
  }

  /**
   * Clear all SQ01 data
   */
  async clearAllData(
    _showToast: boolean = true
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      logger.log('🗑️ Clearing all SQ01 data...')

      const { error } = await supabase
        .from('rr_sq01_data')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000')

      if (error) throw error

      logger.log('✅ SQ01 data cleared successfully')
      return { success: true, error: null }
    } catch (error) {
      logger.error('❌ Error clearing SQ01 data:', error)
      return { success: false, error }
    }
  }
}

// Export singleton instance
export const rustSQ01DataService = RustSQ01DataService.getInstance()
// Developer and Creator: Jai Singh
