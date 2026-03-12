import { logger } from '@/lib/utils/logger'
import { supabase } from './client'
import { locationQueryService } from './location-query.service'

export interface LocationValidationResult {
  isValid: boolean
  exists: boolean
  source?: 'lx03' | 'sq01' | 'both'
  message?: string
  suggestions?: string[]
}

export interface LocationSuggestion {
  location: string
  source: 'lx03' | 'sq01' | 'both'
  materialCount: number
}

/**
 * Location Validation Service
 * Validates warehouse locations against LX03 and SQ01 data tables
 * Provides autocomplete suggestions for location entry
 */
export class LocationValidationService {
  private static instance: LocationValidationService

  public static getInstance(): LocationValidationService {
    if (!LocationValidationService.instance) {
      LocationValidationService.instance = new LocationValidationService()
    }
    return LocationValidationService.instance
  }

  /**
   * Validate if a location exists in the warehouse system
   * Checks both LX03 (storage_bin) and SQ01 (conf_cert_ref) tables
   */
  async validateLocationExists(
    location: string
  ): Promise<LocationValidationResult> {
    try {
      if (!location || location.trim() === '') {
        return {
          isValid: false,
          exists: false,
          message: 'Location is required',
        }
      }

      const trimmedLocation = location.trim()

      // Use our existing location query service to check both tables
      const queryResult =
        await locationQueryService.queryLocation(trimmedLocation)

      if (!queryResult.success) {
        return {
          isValid: false,
          exists: false,
          message: queryResult.error || 'Failed to validate location',
        }
      }

      // Determine source
      let source: 'lx03' | 'sq01' | 'both' | undefined
      if (queryResult.lx03Count > 0 && queryResult.sq01Count > 0) {
        source = 'both'
      } else if (queryResult.lx03Count > 0) {
        source = 'lx03'
      } else if (queryResult.sq01Count > 0) {
        source = 'sq01'
      }

      const exists = queryResult.totalCount > 0

      return {
        isValid: exists,
        exists,
        source,
        message: exists
          ? `Location verified (${queryResult.totalCount} material${queryResult.totalCount > 1 ? 's' : ''} found)`
          : 'Location not found in warehouse system',
      }
    } catch (error: unknown) {
      logger.error('Error validating location:', error)
      return {
        isValid: false,
        exists: false,
        message:
          (error instanceof Error ? error.message : String(error)) ||
          'Location validation failed',
      }
    }
  }

  /**
   * Get location suggestions based on partial input
   * Returns unique locations from both LX03 and SQ01 tables
   */
  async getSuggestedLocations(
    query: string,
    limit: number = 10
  ): Promise<LocationSuggestion[]> {
    try {
      if (!query || query.trim().length < 2) {
        return []
      }

      const searchPattern = `%${query.trim()}%`
      const suggestions: LocationSuggestion[] = []

      // Query LX03 locations
      const { data: lx03Data, error: lx03Error } = await supabase
        .from('rr_lx03_data')
        .select('storage_bin')
        .ilike('storage_bin', searchPattern)
        .not('storage_bin', 'is', null)
        .limit(limit)

      if (!lx03Error && lx03Data) {
        // Group by location and count materials
        const lx03Grouped = lx03Data.reduce(
          (acc: Record<string, number>, item) => {
            const location = item.storage_bin as string
            acc[location] = (acc[location] || 0) + 1
            return acc
          },
          {}
        )

        Object.entries(lx03Grouped).forEach(([location, count]) => {
          suggestions.push({
            location,
            source: 'lx03',
            materialCount: count,
          })
        })
      }

      // Query SQ01 locations
      const { data: sq01Data, error: sq01Error } = await supabase
        .from('rr_sq01_data')
        .select('conf_cert_ref')
        .ilike('conf_cert_ref', searchPattern)
        .not('conf_cert_ref', 'is', null)
        .limit(limit)

      if (!sq01Error && sq01Data) {
        // Group by location and count materials
        const sq01Grouped = sq01Data.reduce(
          (acc: Record<string, number>, item) => {
            const location = item.conf_cert_ref as string
            acc[location] = (acc[location] || 0) + 1
            return acc
          },
          {}
        )

        Object.entries(sq01Grouped).forEach(([location, count]) => {
          // Check if already added from LX03
          const existing = suggestions.find((s) => s.location === location)
          if (existing) {
            existing.source = 'both'
            existing.materialCount += count
          } else {
            suggestions.push({
              location,
              source: 'sq01',
              materialCount: count,
            })
          }
        })
      }

      // Sort by material count (descending) and return top results
      return suggestions
        .sort((a, b) => b.materialCount - a.materialCount)
        .slice(0, limit)
    } catch (error: unknown) {
      logger.error('Error getting location suggestions:', error)
      return []
    }
  }

  /**
   * Get all unique locations from warehouse system
   * Useful for dropdown/select components
   */
  async getAllLocations(limit: number = 100): Promise<string[]> {
    try {
      const locations = new Set<string>()

      // Get LX03 locations
      const { data: lx03Data } = await supabase
        .from('rr_lx03_data')
        .select('storage_bin')
        .not('storage_bin', 'is', null)
        .limit(limit)

      if (lx03Data) {
        lx03Data.forEach((item) => {
          if (item.storage_bin) locations.add(item.storage_bin)
        })
      }

      // Get SQ01 locations
      const { data: sq01Data } = await supabase
        .from('rr_sq01_data')
        .select('conf_cert_ref')
        .not('conf_cert_ref', 'is', null)
        .limit(limit)

      if (sq01Data) {
        sq01Data.forEach((item) => {
          if (item.conf_cert_ref) locations.add(item.conf_cert_ref)
        })
      }

      return Array.from(locations).sort()
    } catch (error: unknown) {
      logger.error('Error getting all locations:', error)
      return []
    }
  }
}

// Export singleton instance
export const locationValidationService = LocationValidationService.getInstance()
// Developer and Creator: Jai Singh
