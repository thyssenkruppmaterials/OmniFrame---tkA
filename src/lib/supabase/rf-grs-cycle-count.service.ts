// Created and developed by Jai Singh
/**
 * RF GRS Cycle Count Service
 *
 * Service for handling GRS (Good Receipt Stock) cycle count operations
 * Manages location-based batch scanning workflow
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

export interface GRSBatchItem {
  id: string
  conf_cert_ref: string // Location
  batch: string
  material: string
  material_description: string
  plant: string
  sloc: string
  unrestricted: number
  blocked: number
  in_qual_insp: number
  shelf_life_exp_date: string | null
  grs_scan_status: string | null
  grs_scanned_at: string | null
  grs_scanned_by: string | null
  grs_scanned_by_name: string | null
  grs_actual_location_found: string | null
}

export interface GRSLocationScanSession {
  location: string
  batches: GRSBatchItem[]
  scannedBatches: Set<string>
  startedAt: string
  userId: string
  userName: string
}

export interface GRSUnknownBatch {
  id?: string
  organization_id?: string
  found_at_location: string
  batch_number: string
  material_number?: string
  serial_number?: string
  grs_notes?: string
  photo_url?: string
  found_by?: string
  found_by_name?: string
}

/**
 * RF GRS Cycle Count Service Class
 */
class RFGRSCycleCountService {
  /**
   * Fetch all batches for a given location
   */
  async fetchBatchesForLocation(location: string): Promise<{
    data: GRSBatchItem[] | null
    error: string | null
  }> {
    try {
      logger.log('🔍 RF GRS Service: Fetching batches for location:', location)

      // Normalize location for search (trim and uppercase)
      const normalizedLocation = location.trim().toUpperCase()

      const { data, error } = await supabase
        .from('rr_sq01_data')
        .select('*')
        .ilike('conf_cert_ref', normalizedLocation)
        .order('batch', { ascending: true })

      if (error) {
        logger.error('❌ RF GRS Service: Error fetching batches:', error)
        return { data: null, error: error.message || 'Failed to fetch batches' }
      }

      if (!data || data.length === 0) {
        return { data: null, error: 'No batches found for this location' }
      }

      logger.log(
        `✅ RF GRS Service: Found ${data.length} batches for location ${normalizedLocation}`
      )
      return { data: data as unknown as GRSBatchItem[], error: null }
    } catch (error: unknown) {
      logger.error(
        '❌ RF GRS Service: Unexpected error fetching batches:',
        error
      )
      return {
        data: null,
        error:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to fetch batches',
      }
    }
  }

  /**
   * Validate location exists in the database
   */
  async validateLocation(location: string): Promise<{
    isValid: boolean
    error: string | null
  }> {
    try {
      const normalizedLocation = location.trim().toUpperCase()

      const { data, error } = await supabase
        .from('rr_sq01_data')
        .select('conf_cert_ref')
        .ilike('conf_cert_ref', normalizedLocation)
        .limit(1)

      if (error) {
        return { isValid: false, error: error.message }
      }

      return { isValid: !!data && data.length > 0, error: null }
    } catch (error: unknown) {
      return {
        isValid: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Find a batch by batch number across all locations
   */
  async findBatchByNumber(batchNumber: string): Promise<{
    data: GRSBatchItem | null
    error: string | null
  }> {
    try {
      const normalizedBatch = batchNumber.trim().toUpperCase()

      const { data, error } = await supabase
        .from('rr_sq01_data')
        .select('*')
        .ilike('batch', normalizedBatch)
        .limit(1)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return { data: null, error: 'Batch not found' }
        }
        return { data: null, error: error.message }
      }

      return { data: data as unknown as GRSBatchItem, error: null }
    } catch (error: unknown) {
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Mark a batch as scanned
   */
  async markBatchAsScanned(
    batchId: string,
    userId: string,
    userName: string
  ): Promise<{
    data: any
    error: string | null
  }> {
    try {
      logger.log('✅ RF GRS Service: Marking batch as scanned:', batchId)

      const { error } = await supabase
        .from('rr_sq01_data')
        .update({
          grs_scan_status: 'Scanned',
          grs_scanned_at: new Date().toISOString(),
          grs_scanned_by: userId,
          grs_scanned_by_name: userName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', batchId)

      if (error) {
        logger.error(
          '❌ RF GRS Service: Error marking batch as scanned:',
          error
        )
        return {
          data: null,
          error: error.message || 'Failed to mark batch as scanned',
        }
      }

      logger.log('✅ RF GRS Service: Batch marked as scanned successfully')
      return { data: { success: true }, error: null }
    } catch (error: unknown) {
      logger.error('❌ RF GRS Service: Unexpected error marking batch:', error)
      return {
        data: null,
        error:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to mark batch as scanned',
      }
    }
  }

  /**
   * Mark a batch as found in a different location
   */
  async markBatchFoundInDifferentLocation(
    batchId: string,
    actualLocation: string,
    userId: string,
    userName: string
  ): Promise<{
    data: any
    error: string | null
  }> {
    try {
      logger.log(
        '⚠️ RF GRS Service: Marking batch as found in different location:',
        batchId
      )

      const { error } = await supabase
        .from('rr_sq01_data')
        .update({
          grs_scan_status: 'Found in Different Location',
          grs_actual_location_found: actualLocation,
          grs_scanned_at: new Date().toISOString(),
          grs_scanned_by: userId,
          grs_scanned_by_name: userName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', batchId)

      if (error) {
        logger.error('❌ RF GRS Service: Error marking batch:', error)
        return { data: null, error: error.message || 'Failed to mark batch' }
      }

      logger.log(
        '✅ RF GRS Service: Batch marked as found in different location'
      )
      return { data: { success: true }, error: null }
    } catch (error: unknown) {
      logger.error('❌ RF GRS Service: Unexpected error marking batch:', error)
      return {
        data: null,
        error:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to mark batch',
      }
    }
  }

  /**
   * Complete location scan and mark unscanned batches
   */
  async completeLocationScan(
    location: string,
    scannedBatchIds: string[]
  ): Promise<{
    data: {
      scannedCount: number
      unscannedCount: number
      totalCount: number
    } | null
    error: string | null
  }> {
    try {
      logger.log('🏁 RF GRS Service: Completing location scan:', location)
      logger.log('Scanned batch IDs:', scannedBatchIds)

      const normalizedLocation = location.trim().toUpperCase()
      const completionTime = new Date().toISOString()

      // Fetch all batches for this location
      const { data: allBatches, error: fetchError } = await supabase
        .from('rr_sq01_data')
        .select('id, batch')
        .ilike('conf_cert_ref', normalizedLocation)

      if (fetchError) {
        return { data: null, error: fetchError.message }
      }

      if (!allBatches || allBatches.length === 0) {
        return { data: null, error: 'No batches found for location' }
      }

      // Identify unscanned batches
      const unscannedBatchIds = allBatches
        .filter((batch) => !scannedBatchIds.includes(batch.id))
        .map((batch) => batch.id)

      logger.log(
        `📊 Total batches: ${allBatches.length}, Scanned: ${scannedBatchIds.length}, Unscanned: ${unscannedBatchIds.length}`
      )

      // Mark unscanned batches
      if (unscannedBatchIds.length > 0) {
        const { error: unscannedError } = await supabase
          .from('rr_sq01_data')
          .update({
            grs_scan_status: 'Not Scanned but Location Complete',
            grs_location_scan_completed_at: completionTime,
            updated_at: completionTime,
          })
          .in('id', unscannedBatchIds)

        if (unscannedError) {
          logger.error(
            '❌ RF GRS Service: Error marking unscanned batches:',
            unscannedError
          )
          return { data: null, error: unscannedError.message }
        }
      }

      // Update location completion timestamp for scanned batches
      if (scannedBatchIds.length > 0) {
        const { error: scannedError } = await supabase
          .from('rr_sq01_data')
          .update({
            grs_location_scan_completed_at: completionTime,
            updated_at: completionTime,
          })
          .in('id', scannedBatchIds)

        if (scannedError) {
          logger.error(
            '❌ RF GRS Service: Error updating scanned batches:',
            scannedError
          )
          return { data: null, error: scannedError.message }
        }
      }

      logger.log('✅ RF GRS Service: Location scan completed successfully')

      return {
        data: {
          scannedCount: scannedBatchIds.length,
          unscannedCount: unscannedBatchIds.length,
          totalCount: allBatches.length,
        },
        error: null,
      }
    } catch (error: unknown) {
      logger.error(
        '❌ RF GRS Service: Unexpected error completing location scan:',
        error
      )
      return {
        data: null,
        error:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to complete location scan',
      }
    }
  }

  /**
   * Get statistics for GRS cycle counts
   */
  async getGRSStatistics(): Promise<{
    data: {
      totalLocations: number
      totalBatches: number
      scannedBatches: number
      unscannedBatches: number
      completedLocations: number
    } | null
    error: string | null
  }> {
    try {
      // Get total unique locations
      const { data: locations, error: locError } = await supabase
        .from('rr_sq01_data')
        .select('conf_cert_ref')
        .not('conf_cert_ref', 'is', null)

      if (locError) {
        return { data: null, error: locError.message }
      }

      const uniqueLocations = new Set(
        locations?.map((l) => l.conf_cert_ref) || []
      )

      // Get batch statistics
      const { data: batches, error: batchError } = await (supabase as any)
        .from('rr_sq01_data')
        .select('grs_scan_status, grs_location_scan_completed_at')

      if (batchError) {
        return { data: null, error: batchError.message }
      }

      const scannedBatches =
        batches?.filter((b: any) => b.grs_scan_status === 'Scanned').length || 0
      const unscannedBatches =
        batches?.filter(
          (b: any) => b.grs_scan_status === 'Not Scanned but Location Complete'
        ).length || 0
      const completedBatches =
        batches?.filter((b: any) => b.grs_location_scan_completed_at !== null)
          .length || 0

      return {
        data: {
          totalLocations: uniqueLocations.size,
          totalBatches: batches?.length || 0,
          scannedBatches,
          unscannedBatches,
          completedLocations: completedBatches, // Approximate based on batches with completion timestamp
        },
        error: null,
      }
    } catch (error: unknown) {
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Reset location scan (for debugging/testing)
   */
  async resetLocationScan(location: string): Promise<{
    data: any
    error: string | null
  }> {
    try {
      const normalizedLocation = location.trim().toUpperCase()

      const { error } = await supabase
        .from('rr_sq01_data')
        .update({
          grs_scan_status: null,
          grs_scanned_at: null,
          grs_scanned_by: null,
          grs_scanned_by_name: null,
          grs_location_scan_completed_at: null,
          grs_notes: null,
          updated_at: new Date().toISOString(),
        })
        .ilike('conf_cert_ref', normalizedLocation)

      if (error) {
        return { data: null, error: error.message }
      }

      return { data: { success: true }, error: null }
    } catch (error: unknown) {
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Upload photo to Supabase storage
   */
  async uploadPhoto(
    file: File,
    batchNumber: string
  ): Promise<{
    data: { path: string; url: string } | null
    error: string | null
  }> {
    try {
      const timestamp = Date.now()
      const fileExt = file.name.split('.').pop()
      const fileName = `${batchNumber}_${timestamp}.${fileExt}`
      const filePath = `unknown-batches/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('grs-photos')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        })

      if (uploadError) {
        logger.error('❌ RF GRS Service: Error uploading photo:', uploadError)
        return { data: null, error: uploadError.message }
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('grs-photos')
        .getPublicUrl(filePath)

      return {
        data: {
          path: filePath,
          url: urlData.publicUrl,
        },
        error: null,
      }
    } catch (error: unknown) {
      logger.error('❌ RF GRS Service: Error uploading photo:', error)
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Create unknown batch record
   */
  async createUnknownBatch(
    unknownBatch: GRSUnknownBatch,
    userId: string,
    userName: string,
    organizationId: string
  ): Promise<{
    data: any
    error: string | null
  }> {
    try {
      logger.log(
        '📝 RF GRS Service: Creating unknown batch record:',
        unknownBatch
      )

      const { data, error } = await (supabase as any)
        .from('grs_unknown_batches')
        .insert({
          organization_id: organizationId,
          found_at_location: unknownBatch.found_at_location,
          batch_number: unknownBatch.batch_number,
          material_number: unknownBatch.material_number || null,
          serial_number: unknownBatch.serial_number || null,
          grs_notes: unknownBatch.grs_notes || null,
          photo_url: unknownBatch.photo_url || null,
          found_by: userId,
          found_by_name: userName,
          found_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (error) {
        logger.error('❌ RF GRS Service: Error creating unknown batch:', error)
        return { data: null, error: error.message }
      }

      logger.log('✅ RF GRS Service: Unknown batch record created successfully')
      return { data, error: null }
    } catch (error: unknown) {
      logger.error(
        '❌ RF GRS Service: Unexpected error creating unknown batch:',
        error
      )
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

// Export singleton instance
export const rfGRSCycleCountService = new RFGRSCycleCountService()

// Created and developed by Jai Singh
