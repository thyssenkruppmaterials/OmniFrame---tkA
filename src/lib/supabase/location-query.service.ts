import { logger } from '@/lib/utils/logger'
import { supabase } from './client'
import type { Tables } from './database.types'

// Type definitions
export type LX03Data = Tables<'rr_lx03_data'>
export type SQ01Data = Tables<'rr_sq01_data'>

export interface LocationQueryResult {
  source: 'lx03' | 'sq01'
  material: string
  material_description?: string
  plant: string
  location: string // storage_bin or conf_cert_ref
  batch?: string
  total_stock?: number
  available_stock?: number
  unrestricted?: number
  blocked?: number
  in_qual_insp?: number
  last_movement?: string
  last_gr?: string
  storage_type?: string
  storage_location?: string
  stock_category?: string
  created_on?: string
  shelf_life_exp_date?: string
}

export interface LocationQueryResponse {
  success: boolean
  location: string
  results: LocationQueryResult[]
  lx03Count: number
  sq01Count: number
  totalCount: number
  error?: string
}

export class LocationQueryService {
  private static instance: LocationQueryService

  public static getInstance(): LocationQueryService {
    if (!LocationQueryService.instance) {
      LocationQueryService.instance = new LocationQueryService()
    }
    return LocationQueryService.instance
  }

  /**
   * Query location from both LX03 and SQ01 tables simultaneously
   * @param location - The location code to search for (exact match)
   * @returns Combined results from both tables
   */
  async queryLocation(location: string): Promise<LocationQueryResponse> {
    try {
      logger.log('🔍 Querying location:', location)

      if (!location || location.trim() === '') {
        return {
          success: false,
          location: '',
          results: [],
          lx03Count: 0,
          sq01Count: 0,
          totalCount: 0,
          error: 'Location is required',
        }
      }

      const trimmedLocation = location.trim()

      // Query both tables simultaneously using Promise.all for better performance
      const [lx03Response, sq01Response] = await Promise.all([
        this.queryLX03(trimmedLocation),
        this.querySQ01(trimmedLocation),
      ])

      // Combine results
      const combinedResults: LocationQueryResult[] = [
        ...lx03Response.results,
        ...sq01Response.results,
      ]

      const response: LocationQueryResponse = {
        success: true,
        location: trimmedLocation,
        results: combinedResults,
        lx03Count: lx03Response.count,
        sq01Count: sq01Response.count,
        totalCount: combinedResults.length,
      }

      logger.log('✅ Location query complete:', {
        location: trimmedLocation,
        lx03Count: lx03Response.count,
        sq01Count: sq01Response.count,
        totalCount: combinedResults.length,
      })

      return response
    } catch (error: unknown) {
      logger.error('❌ Error querying location:', error)
      return {
        success: false,
        location,
        results: [],
        lx03Count: 0,
        sq01Count: 0,
        totalCount: 0,
        error:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to query location',
      }
    }
  }

  /**
   * Query LX03 data table by storage_bin (exact match)
   */
  private async queryLX03(
    location: string
  ): Promise<{ results: LocationQueryResult[]; count: number }> {
    try {
      const { data, error } = await supabase
        .from('rr_lx03_data')
        .select('*')
        .eq('storage_bin', location)
        .order('material', { ascending: true })

      if (error) {
        logger.error('❌ LX03 query error:', error)
        return { results: [], count: 0 }
      }

      if (!data || data.length === 0) {
        logger.log('📦 No LX03 results found for location:', location)
        return { results: [], count: 0 }
      }

      // Transform LX03 data to LocationQueryResult format
      const results: LocationQueryResult[] = data.map((item: LX03Data) => ({
        source: 'lx03',
        material: item.material || '',
        material_description: undefined, // LX03 doesn't have material description
        plant: item.plant || '',
        location: item.storage_bin || '',
        batch: item.batch || undefined,
        total_stock: item.total_stock || undefined,
        available_stock: item.available_stock || undefined,
        last_movement: item.last_movement || undefined,
        storage_type: item.storage_type || undefined,
        storage_location: item.storage_location || undefined,
        stock_category: item.stock_category || undefined,
      }))

      logger.log(`✅ Found ${results.length} LX03 results`)
      return { results, count: results.length }
    } catch (error: unknown) {
      logger.error('❌ Exception in queryLX03:', error)
      return { results: [], count: 0 }
    }
  }

  /**
   * Query SQ01 data table by conf_cert_ref (exact match)
   */
  private async querySQ01(
    location: string
  ): Promise<{ results: LocationQueryResult[]; count: number }> {
    try {
      const { data, error } = await supabase
        .from('rr_sq01_data')
        .select('*')
        .eq('conf_cert_ref', location)
        .order('material', { ascending: true })

      if (error) {
        logger.error('❌ SQ01 query error:', error)
        return { results: [], count: 0 }
      }

      if (!data || data.length === 0) {
        logger.log('📦 No SQ01 results found for location:', location)
        return { results: [], count: 0 }
      }

      // Transform SQ01 data to LocationQueryResult format
      const results: LocationQueryResult[] = data.map((item: SQ01Data) => ({
        source: 'sq01',
        material: item.material || '',
        material_description: item.material_description || undefined,
        plant: item.plant || '',
        location: item.conf_cert_ref || '',
        batch: item.batch || undefined,
        unrestricted: item.unrestricted || undefined,
        blocked: item.blocked || undefined,
        in_qual_insp: item.in_qual_insp || undefined,
        last_gr: item.last_gr || undefined,
        created_on: item.created_on || undefined,
        shelf_life_exp_date: item.shelf_life_exp_date || undefined,
      }))

      logger.log(`✅ Found ${results.length} SQ01 results`)
      return { results, count: results.length }
    } catch (error: unknown) {
      logger.error('❌ Exception in querySQ01:', error)
      return { results: [], count: 0 }
    }
  }
}

// Export singleton instance
export const locationQueryService = LocationQueryService.getInstance()
// Developer and Creator: Jai Singh
