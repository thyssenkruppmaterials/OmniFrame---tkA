// Created and developed by Jai Singh
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

export interface MaterialValidationResult {
  isValid: boolean
  exists: boolean
  material?: string
  description?: string
  source?: 'lx03' | 'sq01' | 'both'
  message?: string
  stockInfo?: {
    totalStock?: number
    availableStock?: number
    unrestricted?: number
    blocked?: number
    locations?: string[]
  }
}

export interface MaterialSuggestion {
  material: string
  description?: string
  source: 'lx03' | 'sq01' | 'both'
  totalLocations: number
  totalStock?: number
}

/**
 * Material Validation Service
 * Validates material numbers against LX03 and SQ01 data tables
 * Provides autocomplete suggestions with descriptions
 */
export class MaterialValidationService {
  private static instance: MaterialValidationService

  public static getInstance(): MaterialValidationService {
    if (!MaterialValidationService.instance) {
      MaterialValidationService.instance = new MaterialValidationService()
    }
    return MaterialValidationService.instance
  }

  /**
   * Validate if a material exists in the warehouse system
   * Checks both LX03 and SQ01 tables and returns stock information
   */
  async validateMaterialExists(
    material: string
  ): Promise<MaterialValidationResult> {
    try {
      if (!material || material.trim() === '') {
        return {
          isValid: false,
          exists: false,
          message: 'Material number is required',
        }
      }

      const trimmedMaterial = material.trim()

      // Query both tables in parallel
      const [lx03Response, sq01Response] = await Promise.all([
        this.queryLX03Material(trimmedMaterial),
        this.querySQ01Material(trimmedMaterial),
      ])

      const exists = lx03Response.exists || sq01Response.exists

      // Determine source
      let source: 'lx03' | 'sq01' | 'both' | undefined
      if (lx03Response.exists && sq01Response.exists) {
        source = 'both'
      } else if (lx03Response.exists) {
        source = 'lx03'
      } else if (sq01Response.exists) {
        source = 'sq01'
      }

      // Compile stock information
      const stockInfo: MaterialValidationResult['stockInfo'] = {
        totalStock: lx03Response.totalStock,
        availableStock: lx03Response.availableStock,
        unrestricted: sq01Response.unrestricted,
        blocked: sq01Response.blocked,
        locations: [
          ...(lx03Response.locations || []),
          ...(sq01Response.locations || []),
        ],
      }

      // Prefer SQ01 description as it typically has better data
      const description = sq01Response.description || lx03Response.description

      return {
        isValid: exists,
        exists,
        material: trimmedMaterial,
        description,
        source,
        message: exists
          ? `Material verified (found in ${stockInfo.locations?.length || 0} location${stockInfo.locations?.length !== 1 ? 's' : ''})`
          : 'Material not found in warehouse system',
        stockInfo: exists ? stockInfo : undefined,
      }
    } catch (error: unknown) {
      logger.error('Error validating material:', error)
      return {
        isValid: false,
        exists: false,
        message:
          (error instanceof Error ? error.message : String(error)) ||
          'Material validation failed',
      }
    }
  }

  /**
   * Query LX03 table for material information
   */
  private async queryLX03Material(material: string): Promise<{
    exists: boolean
    description?: string
    totalStock?: number
    availableStock?: number
    locations?: string[]
  }> {
    try {
      const { data, error } = await supabase
        .from('rr_lx03_data')
        .select('storage_bin, total_stock, available_stock')
        .eq('material', material)

      if (error || !data || data.length === 0) {
        return { exists: false }
      }

      const totalStock = data.reduce(
        (sum, item) => sum + (item.total_stock || 0),
        0
      )
      const availableStock = data.reduce(
        (sum, item) => sum + (item.available_stock || 0),
        0
      )
      const locations = [
        ...new Set(data.map((item) => item.storage_bin).filter(Boolean)),
      ] as string[]

      return {
        exists: true,
        totalStock,
        availableStock,
        locations,
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      return { exists: false }
    }
  }

  /**
   * Query SQ01 table for material information
   */
  private async querySQ01Material(material: string): Promise<{
    exists: boolean
    description?: string
    unrestricted?: number
    blocked?: number
    locations?: string[]
  }> {
    try {
      const { data, error } = await supabase
        .from('rr_sq01_data')
        .select('conf_cert_ref, material_description, unrestricted, blocked')
        .eq('material', material)

      if (error || !data || data.length === 0) {
        return { exists: false }
      }

      const description = data[0]?.material_description || undefined
      const unrestricted = data.reduce(
        (sum, item) => sum + (item.unrestricted || 0),
        0
      )
      const blocked = data.reduce((sum, item) => sum + (item.blocked || 0), 0)
      const locations = [
        ...new Set(data.map((item) => item.conf_cert_ref).filter(Boolean)),
      ] as string[]

      return {
        exists: true,
        description,
        unrestricted,
        blocked,
        locations,
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      return { exists: false }
    }
  }

  /**
   * Get material suggestions based on partial input
   * Returns materials with descriptions from both tables
   */
  async getSuggestedMaterials(
    query: string,
    limit: number = 10
  ): Promise<MaterialSuggestion[]> {
    try {
      if (!query || query.trim().length < 2) {
        return []
      }

      const searchPattern = `%${query.trim()}%`
      const suggestions = new Map<string, MaterialSuggestion>()

      // Query LX03 materials
      const { data: lx03Data } = await supabase
        .from('rr_lx03_data')
        .select('material, storage_bin, total_stock')
        .ilike('material', searchPattern)
        .not('material', 'is', null)
        .limit(limit * 2) // Get more to account for duplicates

      if (lx03Data) {
        const grouped = lx03Data.reduce(
          (
            acc: Record<string, { locations: Set<string>; totalStock: number }>,
            item
          ) => {
            const mat = item.material as string
            if (!acc[mat]) {
              acc[mat] = { locations: new Set(), totalStock: 0 }
            }
            if (item.storage_bin) acc[mat].locations.add(item.storage_bin)
            acc[mat].totalStock += item.total_stock || 0
            return acc
          },
          {}
        )

        Object.entries(grouped).forEach(([material, info]) => {
          suggestions.set(material, {
            material,
            source: 'lx03',
            totalLocations: info.locations.size,
            totalStock: info.totalStock,
          })
        })
      }

      // Query SQ01 materials
      const { data: sq01Data } = await supabase
        .from('rr_sq01_data')
        .select('material, material_description, conf_cert_ref, unrestricted')
        .ilike('material', searchPattern)
        .not('material', 'is', null)
        .limit(limit * 2)

      if (sq01Data) {
        const grouped = sq01Data.reduce(
          (
            acc: Record<
              string,
              {
                description?: string
                locations: Set<string>
                unrestricted: number
              }
            >,
            item
          ) => {
            const mat = item.material as string
            if (!acc[mat]) {
              acc[mat] = {
                description: item.material_description || undefined,
                locations: new Set(),
                unrestricted: 0,
              }
            }
            if (item.conf_cert_ref) acc[mat].locations.add(item.conf_cert_ref)
            acc[mat].unrestricted += item.unrestricted || 0
            return acc
          },
          {}
        )

        Object.entries(grouped).forEach(([material, info]) => {
          const existing = suggestions.get(material)
          if (existing) {
            // Merge with LX03 data
            existing.source = 'both'
            existing.description = info.description
            existing.totalLocations += info.locations.size
          } else {
            suggestions.set(material, {
              material,
              description: info.description,
              source: 'sq01',
              totalLocations: info.locations.size,
              totalStock: info.unrestricted,
            })
          }
        })
      }

      // Convert to array and sort by total stock/locations
      return Array.from(suggestions.values())
        .sort((a, b) => {
          // Prioritize materials with descriptions
          if (a.description && !b.description) return -1
          if (!a.description && b.description) return 1
          // Then by total stock
          const stockA = a.totalStock || 0
          const stockB = b.totalStock || 0
          if (stockA !== stockB) return stockB - stockA
          // Finally by location count
          return b.totalLocations - a.totalLocations
        })
        .slice(0, limit)
    } catch (error: unknown) {
      logger.error('Error getting material suggestions:', error)
      return []
    }
  }

  /**
   * Validate material and location combination
   * Checks if specific material exists at specific location
   */
  async validateMaterialAtLocation(
    material: string,
    location: string
  ): Promise<{
    isValid: boolean
    exists: boolean
    message?: string
    quantity?: number
  }> {
    try {
      if (!material || !location) {
        return {
          isValid: false,
          exists: false,
          message: 'Both material and location are required',
        }
      }

      // Check LX03
      const { data: lx03Data } = await supabase
        .from('rr_lx03_data')
        .select('total_stock, available_stock')
        .eq('material', material.trim())
        .eq('storage_bin', location.trim())
        .maybeSingle()

      if (lx03Data) {
        return {
          isValid: true,
          exists: true,
          message: 'Material found at location (LX03)',
          quantity: lx03Data.total_stock || 0,
        }
      }

      // Check SQ01
      const { data: sq01Data } = await supabase
        .from('rr_sq01_data')
        .select('unrestricted, blocked')
        .eq('material', material.trim())
        .eq('conf_cert_ref', location.trim())
        .maybeSingle()

      if (sq01Data) {
        return {
          isValid: true,
          exists: true,
          message: 'Material found at location (SQ01)',
          quantity: (sq01Data.unrestricted || 0) + (sq01Data.blocked || 0),
        }
      }

      return {
        isValid: false,
        exists: false,
        message: 'Material not found at this location',
      }
    } catch (error: unknown) {
      logger.error('Error validating material at location:', error)
      return {
        isValid: false,
        exists: false,
        message:
          (error instanceof Error ? error.message : String(error)) ||
          'Validation failed',
      }
    }
  }
}

// Export singleton instance
export const materialValidationService = MaterialValidationService.getInstance()

// Created and developed by Jai Singh
