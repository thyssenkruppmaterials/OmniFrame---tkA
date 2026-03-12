/**
 * RF Kitting Picking Operations Service
 * Handles picking workflow for Kit PO items in the RF Terminal
 * Created: December 14, 2025
 *
 * Workflow:
 * 1. Scan Kit PO Number
 * 2. Select Pick Type (Floor: K/S bins, Rack: R bins)
 * 3. Pick items: Go to bin → Scan location → Scan part → Confirm quantity
 * 4. Repeat until all items picked for selected type
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'
import { KitKanbanService } from './kit-kanban.service'

// Types for Kitting Picking workflow
export interface KittingPickItem {
  id: string
  transfer_order_number: string
  material: string
  material_description: string | null
  source_storage_bin: string
  dest_storage_bin: string
  source_target_qty: number
  batch: string | null
  picked: boolean
  picked_by_user: string | null
  picked_by_user_name: string | null
  picked_date_time: string | null
}

export interface KittingPickData {
  kit_po_number: string
  kit_build_number: string
  kit_serial_number: string
  engine_program: string
  kit_number: string
  kit_build_status: string
  due_date: string | null
  total_lines: number
  floor_pick_items: KittingPickItem[] // Bins starting with K or S
  rack_pick_items: KittingPickItem[] // Bins starting with R
  floor_picked_count: number
  rack_picked_count: number
}

export interface KittingPickValidation {
  isValid: boolean
  message?: string
  fieldType?: 'location' | 'material' | 'quantity'
}

/**
 * RF Kitting Picking Service Class
 * Handles picking operations for Kit PO items
 */
class RFKittingPickingService {
  private static readonly TABLE_NAME = 'RR_Kitting_DATA'

  /**
   * Verify a Kit PO Number exists and is ready for picking
   * Valid statuses for picking: 'pending', 'printed', 'in_progress'
   * @param kitPoNumber - The Kit PO number to verify
   * @returns Kit picking data if valid
   */
  async verifyKitForPicking(kitPoNumber: string): Promise<{
    data: KittingPickData | null
    error: string | null
  }> {
    try {
      logger.log(
        '🔍 RF Kitting Picking: Verifying kit for picking:',
        kitPoNumber
      )

      // Get the user's organization ID
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: null, error: 'User not authenticated' }
      }

      // Query RR_Kitting_DATA for kit items
      // Note: Using type assertion as RR_Kitting_DATA may not be in generated types
      const { data: kitItems, error } = await (supabase
        .from(RFKittingPickingService.TABLE_NAME as any)
        .select(
          `
          id,
          kit_po_number,
          kit_build_number,
          kit_serial_number,
          engine_program,
          kit_number,
          kit_build_status,
          due_date,
          transfer_order_number,
          material,
          material_description,
          source_storage_bin,
          dest_storage_bin,
          source_target_qty,
          batch,
          kit_to_line_picked_by_user,
          kit_to_line_picked_date_time,
          kit_flag_type
        `
        )
        .eq('kit_po_number', kitPoNumber)
        .order('source_storage_bin', { ascending: true })
        .order('material', { ascending: true }) as any)

      if (error) {
        logger.error('❌ RF Kitting Picking: Database error:', error)
        return { data: null, error: error.message }
      }

      if (!kitItems || kitItems.length === 0) {
        logger.log(`❌ RF Kitting Picking: No kit found for: ${kitPoNumber}`)
        return { data: null, error: `Kit PO ${kitPoNumber} not found` }
      }

      // Type the records for safe access
      interface KittingRecord {
        id: string
        kit_po_number: string
        kit_build_number: string
        kit_serial_number: string
        engine_program: string
        kit_number: string
        kit_build_status: string
        due_date: string | null
        transfer_order_number: string | null
        material: string | null
        material_description: string | null
        source_storage_bin: string | null
        dest_storage_bin: string | null
        source_target_qty: string | null
        batch: string | null
        kit_to_line_picked_by_user: string | null
        kit_to_line_picked_date_time: string | null
        kit_flag_type: string | null
      }
      const records = kitItems as KittingRecord[]

      const firstRecord = records[0]

      // Check if kit is in a valid status for picking
      const validStatuses = ['pending', 'printed', 'in_progress']
      if (
        !validStatuses.includes(
          firstRecord.kit_build_status?.toLowerCase() || ''
        )
      ) {
        logger.log(
          `❌ RF Kitting Picking: Kit status not valid for picking: ${firstRecord.kit_build_status}`
        )
        return {
          data: null,
          error: `Kit ${kitPoNumber} is not ready for picking. Current status: ${firstRecord.kit_build_status}`,
        }
      }

      // Check for active Black Hat flag (blocks picking due to missing BOM materials)
      try {
        const { data: blackHatFlags, error: flagError } = await supabase
          .from('kit_build_flags')
          .select('id, notes')
          .eq('kit_po_number', kitPoNumber)
          .eq('flag_type', 'black')
          .eq('is_active', true)
          .limit(1)

        if (
          !flagError &&
          blackHatFlags &&
          (blackHatFlags as { id: string }[]).length > 0
        ) {
          const note = (
            blackHatFlags as { id: string; notes: string | null }[]
          )[0].notes
          logger.log(
            `❌ RF Kitting Picking: Kit blocked by Black Hat flag: ${kitPoNumber}`
          )
          return {
            data: null,
            error: `Kit ${kitPoNumber} is blocked from picking — missing BOM materials.${note ? ` (${note})` : ''} Resolve the Black Hat flag before picking.`,
          }
        }
      } catch {
        // Fallback: check legacy flag field on the record
        if (firstRecord.kit_flag_type === 'black') {
          return {
            data: null,
            error: `Kit ${kitPoNumber} is blocked from picking due to a Black Hat flag. Resolve it before picking.`,
          }
        }
      }

      // Get user names for picked_by users
      const pickedByUserIds = new Set<string>()
      records.forEach((r) => {
        if (r.kit_to_line_picked_by_user) {
          pickedByUserIds.add(r.kit_to_line_picked_by_user)
        }
      })

      const userNameMap = new Map<string, string>()
      if (pickedByUserIds.size > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, full_name, first_name, last_name, email')
          .in('id', Array.from(pickedByUserIds))

        if (profiles) {
          for (const profile of profiles) {
            const displayName =
              profile.full_name ||
              `${profile.first_name || ''} ${profile.last_name || ''}`.trim() ||
              profile.email?.split('@')[0] ||
              null
            if (displayName) {
              userNameMap.set(profile.id, displayName)
            }
          }
        }
      }

      // Transform records to pick items and separate by bin type
      const allItems: KittingPickItem[] = records
        .filter((r) => r.transfer_order_number && r.source_storage_bin)
        .map((r) => ({
          id: r.id,
          transfer_order_number: r.transfer_order_number!,
          material: r.material || '',
          material_description: r.material_description || null,
          source_storage_bin: r.source_storage_bin!,
          dest_storage_bin: r.dest_storage_bin || '',
          source_target_qty: parseFloat(r.source_target_qty || '0'),
          batch: r.batch || null,
          picked: !!r.kit_to_line_picked_date_time,
          picked_by_user: r.kit_to_line_picked_by_user || null,
          picked_by_user_name: r.kit_to_line_picked_by_user
            ? userNameMap.get(r.kit_to_line_picked_by_user) || null
            : null,
          picked_date_time: r.kit_to_line_picked_date_time || null,
        }))

      // Separate items by bin type:
      // Floor picks: bins starting with K or S
      // Rack picks: bins starting with R
      const floorPickItems = allItems.filter((item) => {
        const binStart = item.source_storage_bin.charAt(0).toUpperCase()
        return binStart === 'K' || binStart === 'S'
      })

      const rackPickItems = allItems.filter((item) => {
        const binStart = item.source_storage_bin.charAt(0).toUpperCase()
        return binStart === 'R'
      })

      const floorPickedCount = floorPickItems.filter((i) => i.picked).length
      const rackPickedCount = rackPickItems.filter((i) => i.picked).length

      const pickData: KittingPickData = {
        kit_po_number: firstRecord.kit_po_number,
        kit_build_number: firstRecord.kit_build_number,
        kit_serial_number: firstRecord.kit_serial_number || '',
        engine_program: firstRecord.engine_program,
        kit_number: firstRecord.kit_number,
        kit_build_status: firstRecord.kit_build_status,
        due_date: firstRecord.due_date,
        total_lines: allItems.length,
        floor_pick_items: floorPickItems,
        rack_pick_items: rackPickItems,
        floor_picked_count: floorPickedCount,
        rack_picked_count: rackPickedCount,
      }

      logger.log(
        `✅ RF Kitting Picking: Found kit ${kitPoNumber} with ${allItems.length} items`
      )
      logger.log(
        `   Floor picks: ${floorPickItems.length} (${floorPickedCount} picked)`
      )
      logger.log(
        `   Rack picks: ${rackPickItems.length} (${rackPickedCount} picked)`
      )

      return { data: pickData, error: null }
    } catch (error: unknown) {
      logger.error('❌ RF Kitting Picking: Unexpected error:', error)
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Get the next item to pick for a specific pick type (floor or rack)
   * Returns the first unpicked item sorted by bin location
   * @param kitPoNumber - The Kit PO number
   * @param pickType - 'floor' or 'rack'
   */
  async getNextPickItem(
    kitPoNumber: string,
    pickType: 'floor' | 'rack'
  ): Promise<{ data: KittingPickItem | null; error: string | null }> {
    const { data: kitData, error } = await this.verifyKitForPicking(kitPoNumber)

    if (error || !kitData) {
      return { data: null, error: error || 'Kit not found' }
    }

    const items =
      pickType === 'floor' ? kitData.floor_pick_items : kitData.rack_pick_items
    const nextItem = items.find((item) => !item.picked)

    if (!nextItem) {
      return {
        data: null,
        error: `All ${pickType} picks complete for this kit`,
      }
    }

    return { data: nextItem, error: null }
  }

  /**
   * Validate scanned location matches expected bin
   */
  validateLocation(
    scannedLocation: string,
    expectedBin: string
  ): KittingPickValidation {
    if (!scannedLocation || scannedLocation.trim().length === 0) {
      return {
        isValid: false,
        message: 'Location is required',
        fieldType: 'location',
      }
    }

    const scanned = scannedLocation.trim().toUpperCase()
    const expected = expectedBin.trim().toUpperCase()

    if (scanned !== expected) {
      return {
        isValid: false,
        message: `Location mismatch! Expected: ${expected}, Scanned: ${scanned}`,
        fieldType: 'location',
      }
    }

    return { isValid: true, fieldType: 'location' }
  }

  /**
   * Validate scanned material matches expected part number
   */
  validateMaterial(
    scannedMaterial: string,
    expectedMaterial: string
  ): KittingPickValidation {
    if (!scannedMaterial || scannedMaterial.trim().length === 0) {
      return {
        isValid: false,
        message: 'Material scan is required',
        fieldType: 'material',
      }
    }

    const scanned = scannedMaterial.trim().toUpperCase()
    const expected = expectedMaterial.trim().toUpperCase()

    if (scanned !== expected) {
      return {
        isValid: false,
        message: `Material mismatch! Expected: ${expected}, Scanned: ${scanned}`,
        fieldType: 'material',
      }
    }

    return { isValid: true, fieldType: 'material' }
  }

  /**
   * Validate picked quantity matches expected quantity
   */
  validateQuantity(
    pickedQty: number,
    expectedQty: number
  ): KittingPickValidation {
    if (pickedQty < 0) {
      return {
        isValid: false,
        message: 'Quantity cannot be negative',
        fieldType: 'quantity',
      }
    }

    if (pickedQty === 0) {
      return {
        isValid: true,
        message: 'Zero quantity - Item not available',
        fieldType: 'quantity',
      }
    }

    // Use epsilon-based comparison for floating point safety
    const EPSILON = 0.001
    const difference = Math.abs(pickedQty - expectedQty)

    if (difference < EPSILON) {
      return {
        isValid: true,
        message: 'Quantity confirmed',
        fieldType: 'quantity',
      }
    }

    if (pickedQty < expectedQty) {
      return {
        isValid: true,
        message: `Short pick: Expected ${expectedQty}, picked ${pickedQty}`,
        fieldType: 'quantity',
      }
    }

    return {
      isValid: true,
      message: `Over pick: Expected ${expectedQty}, picked ${pickedQty}`,
      fieldType: 'quantity',
    }
  }

  /**
   * Mark a TO line as picked with user and timestamp
   * Updates kit_to_line_picked_by_user and kit_to_line_picked_date_time
   * Also syncs progress to the kanban board
   * @param itemId - The specific TO line record ID to update
   * @param pickedQty - The quantity picked (for audit purposes)
   * @param visuallyVerified - Whether the part was visually verified instead of scanned (no barcode label)
   */
  async markLinePicked(
    itemId: string,
    _pickedQty: number,
    visuallyVerified: boolean = false
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      logger.log(
        '📦 RF Kitting Picking: Marking line as picked:',
        itemId,
        visuallyVerified ? '(visually verified)' : '(scanned)'
      )

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { success: false, error: 'User not authenticated' }
      }

      // First, get the kit_po_number for this line so we can sync the kanban task
      const { data: lineData, error: lineError } = (await (supabase
        .from(RFKittingPickingService.TABLE_NAME as any)
        .select('kit_po_number')
        .eq('id', itemId)
        .single() as any)) as {
        data: { kit_po_number: string } | null
        error: any
      }

      if (lineError || !lineData) {
        logger.error('❌ RF Kitting Picking: Could not find line:', lineError)
        return { success: false, error: 'Could not find the TO line' }
      }

      const kitPoNumber = lineData.kit_po_number
      const now = new Date().toISOString()

      // Update the specific TO line record
      // Note: Using type assertion as RR_Kitting_DATA may not be in generated types
      const { error: updateError } = await (supabase
        .from(RFKittingPickingService.TABLE_NAME as any)
        .update({
          kit_to_line_picked_by_user: user.id,
          kit_to_line_picked_date_time: now,
          visual_pick_verification_flag: visuallyVerified,
          updated_at: now,
        })
        .eq('id', itemId) as any)

      if (updateError) {
        logger.error('❌ RF Kitting Picking: Error updating line:', updateError)
        return { success: false, error: updateError.message }
      }

      logger.log(
        `✅ RF Kitting Picking: Line ${itemId} marked as picked${visuallyVerified ? ' (visual verification)' : ''}`
      )

      // Sync progress to the kanban board
      await KitKanbanService.syncKitProgressFromData(kitPoNumber)

      return { success: true, error: null }
    } catch (error: unknown) {
      logger.error(
        '❌ RF Kitting Picking: Unexpected error marking line as picked:',
        error
      )
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Update kit status to 'in_progress' if it's currently 'pending' or 'printed'
   * Called when first pick is made
   */
  async updateKitStatusToInProgress(kitPoNumber: string): Promise<void> {
    try {
      // Note: Using type assertion as RR_Kitting_DATA may not be in generated types
      const { data: firstRecord } = (await (supabase
        .from(RFKittingPickingService.TABLE_NAME as any)
        .select('kit_build_status')
        .eq('kit_po_number', kitPoNumber)
        .limit(1)
        .single() as any)) as { data: { kit_build_status: string } | null }

      if (
        firstRecord &&
        ['pending', 'printed'].includes(
          firstRecord.kit_build_status?.toLowerCase() || ''
        )
      ) {
        await (supabase
          .from(RFKittingPickingService.TABLE_NAME as any)
          .update({
            kit_build_status: 'in_progress',
            updated_at: new Date().toISOString(),
          })
          .eq('kit_po_number', kitPoNumber) as any)

        logger.log(
          `✅ RF Kitting Picking: Kit ${kitPoNumber} status updated to 'in_progress'`
        )
      }
    } catch (error) {
      logger.error('⚠️ RF Kitting Picking: Error updating kit status:', error)
      // Non-critical error, don't throw
    }
  }

  /**
   * Check if all picking is complete for a kit and update status accordingly
   * If all TO lines are picked, status could advance (but kitting still needs to happen)
   */
  async checkAndUpdateKitPickingStatus(kitPoNumber: string): Promise<{
    allFloorPicked: boolean
    allRackPicked: boolean
    allPicked: boolean
  }> {
    const { data: kitData, error } = await this.verifyKitForPicking(kitPoNumber)

    if (error || !kitData) {
      return { allFloorPicked: false, allRackPicked: false, allPicked: false }
    }

    const allFloorPicked =
      kitData.floor_pick_items.length === 0 ||
      kitData.floor_pick_items.every((item) => item.picked)
    const allRackPicked =
      kitData.rack_pick_items.length === 0 ||
      kitData.rack_pick_items.every((item) => item.picked)
    const allPicked = allFloorPicked && allRackPicked

    return { allFloorPicked, allRackPicked, allPicked }
  }

  /**
   * Report a missing part during picking
   * - Uploads photo to storage
   * - Updates the TO line with missing part info
   * - Marks the line as picked (zero quantity)
   * - Adds a purple hat flag to the kit
   * @param itemId - The specific TO line record ID
   * @param kitPoNumber - The Kit PO number for flag purposes
   * @param photoBase64 - Base64 encoded photo of the empty bin
   * @param notes - Optional notes about the missing part
   */
  async reportMissingPart(
    itemId: string,
    kitPoNumber: string,
    photoBase64: string,
    notes?: string
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      logger.log('🔴 RF Kitting Picking: Reporting missing part:', itemId)

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { success: false, error: 'User not authenticated' }
      }

      const now = new Date().toISOString()

      // 1. Upload photo to storage
      let photoUrl: string | null = null
      if (photoBase64) {
        try {
          // Extract base64 data (remove data:image/...;base64, prefix)
          const parts = photoBase64.split(',')
          const base64Data = parts[1] || parts[0]

          // Parse mime type more carefully
          let mimeType = 'image/jpeg'
          let extension = 'jpg'
          if (parts[0] && parts[0].includes(':') && parts[0].includes(';')) {
            const mimeMatch = parts[0].match(/data:([^;]+);/)
            if (mimeMatch && mimeMatch[1]) {
              mimeType = mimeMatch[1]
              // Map common mime types to extensions
              const extMap: Record<string, string> = {
                'image/jpeg': 'jpg',
                'image/jpg': 'jpg',
                'image/png': 'png',
                'image/webp': 'webp',
              }
              extension = extMap[mimeType] || 'jpg'
            }
          }

          logger.log(
            '📷 RF Kitting Picking: Processing photo, mime:',
            mimeType,
            'ext:',
            extension
          )

          // Convert base64 to blob
          const byteCharacters = atob(base64Data)
          const byteNumbers = new Array(byteCharacters.length)
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i)
          }
          const byteArray = new Uint8Array(byteNumbers)
          const blob = new Blob([byteArray], { type: mimeType })

          logger.log('📷 RF Kitting Picking: Blob size:', blob.size, 'bytes')

          // Generate unique filename - use a simpler path structure
          const timestamp = Date.now()
          const filename = `${kitPoNumber}/${itemId}_${timestamp}.${extension}`

          logger.log('📷 RF Kitting Picking: Uploading to path:', filename)

          // Upload to storage with upsert enabled to avoid conflicts
          const { data: uploadData, error: uploadError } =
            await supabase.storage
              .from('missing-part-photos')
              .upload(filename, blob, {
                contentType: mimeType,
                upsert: true, // Allow overwriting if file exists
              })

          if (uploadError) {
            logger.error(
              '⚠️ RF Kitting Picking: Photo upload failed:',
              uploadError.message,
              uploadError
            )
            // Continue without photo - not a critical failure
          } else if (uploadData) {
            // Get public URL
            const { data: urlData } = supabase.storage
              .from('missing-part-photos')
              .getPublicUrl(uploadData.path)
            photoUrl = urlData?.publicUrl || null
            logger.log(
              '✅ RF Kitting Picking: Photo uploaded successfully:',
              photoUrl
            )
          }
        } catch (photoError: unknown) {
          logger.error(
            '⚠️ RF Kitting Picking: Photo processing error:',
            (photoError instanceof Error
              ? photoError.message
              : String(photoError)) || photoError
          )
          // Continue without photo
        }
      }

      // 2. Update the TO line with missing part information
      const { error: updateError } = await (supabase
        .from(RFKittingPickingService.TABLE_NAME as any)
        .update({
          // Mark as picked with zero quantity
          kit_to_line_picked_by_user: user.id,
          kit_to_line_picked_date_time: now,
          // Missing part flags
          missing_part_flag: true,
          missing_part_verified_adjacent_bins: true,
          missing_part_photo_url: photoUrl,
          missing_part_reported_at: now,
          missing_part_reported_by_user: user.id,
          missing_part_notes: notes || null,
          updated_at: now,
        })
        .eq('id', itemId) as any)

      if (updateError) {
        logger.error('❌ RF Kitting Picking: Error updating line:', updateError)
        return { success: false, error: updateError.message }
      }

      // 3. Add purple hat flag to the kit
      await this.addPurpleHatFlag(
        kitPoNumber,
        user.id,
        `Missing part reported for item ${itemId}`
      )

      // 4. Update kit status to in_progress if needed
      await this.updateKitStatusToInProgress(kitPoNumber)

      // 5. Sync progress to the kanban board
      await KitKanbanService.syncKitProgressFromData(kitPoNumber)

      logger.log(
        `✅ RF Kitting Picking: Missing part reported for line ${itemId}`
      )
      return { success: true, error: null }
    } catch (error: unknown) {
      logger.error(
        '❌ RF Kitting Picking: Unexpected error reporting missing part:',
        error
      )
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Add a purple hat flag to a kit (Inventory Issue)
   * @param kitPoNumber - The Kit PO number
   * @param userId - The user adding the flag
   * @param notes - Notes about the flag
   */
  private async addPurpleHatFlag(
    kitPoNumber: string,
    userId: string,
    notes: string
  ): Promise<void> {
    try {
      const now = new Date().toISOString()

      // Check if kit_build_flags table exists and add flag
      // First, try to insert into kit_build_flags table
      const { error: flagError } = await supabase
        .from('kit_build_flags')
        .insert({
          kit_po_number: kitPoNumber,
          flag_type: 'purple',
          set_by_user: userId,
          set_date_time: now,
          notes: notes,
          is_active: true,
        })

      if (flagError) {
        // If table doesn't exist or other error, try updating legacy flag on RR_Kitting_DATA
        logger.log(
          '⚠️ kit_build_flags insert failed, trying legacy update:',
          flagError.message
        )

        await (supabase
          .from(RFKittingPickingService.TABLE_NAME as any)
          .update({
            kit_flag_type: 'purple',
            kit_flag_set_by_user: userId,
            kit_flag_set_date_time: now,
            updated_at: now,
          })
          .eq('kit_po_number', kitPoNumber) as any)
      }

      logger.log(
        `✅ RF Kitting Picking: Purple hat flag added for kit ${kitPoNumber}`
      )
    } catch (error) {
      logger.error(
        '⚠️ RF Kitting Picking: Error adding purple hat flag:',
        error
      )
      // Non-critical error, don't throw
    }
  }
}

/**
 * Check if a scanned number could be a Kit PO Number (vs a delivery number)
 * Kit PO numbers typically start with specific prefixes or patterns
 * @param inputValue - The scanned/entered value to check
 */
export function isPotentialKitPoNumber(inputValue: string): boolean {
  if (!inputValue || inputValue.trim().length === 0) {
    return false
  }

  const value = inputValue.trim().toUpperCase()

  // Kit PO patterns (customize based on your actual Kit PO number format):
  // - Typically longer alphanumeric strings
  // - May contain specific prefixes
  // Examples: "KIT-XXXXXX", "4500XXXXXX", etc.

  // Pattern 1: Starts with 'KIT-' or 'KIT'
  if (value.startsWith('KIT-') || value.startsWith('KIT')) {
    return true
  }

  // Pattern 2: Standard SAP PO format (10 digits starting with 45)
  if (/^45\d{8}$/.test(value)) {
    return true
  }

  // Pattern 3: Contains alpha characters mixed with numbers (not pure numeric delivery)
  // Delivery numbers are typically 8-12 pure digits
  if (value.length >= 8 && /[A-Z]/.test(value) && /\d/.test(value)) {
    return true
  }

  return false
}

/**
 * Validate Kit PO Number format
 * @param kitPoNumber - The Kit PO number to validate
 */
export function validateKitPoNumber(kitPoNumber: string): {
  isValid: boolean
  message?: string
} {
  if (!kitPoNumber || kitPoNumber.trim().length === 0) {
    return { isValid: false, message: 'Kit PO number is required' }
  }

  const trimmed = kitPoNumber.trim()

  // Kit PO validation - minimum 6 characters
  if (trimmed.length < 6) {
    return {
      isValid: false,
      message: 'Kit PO number must be at least 6 characters',
    }
  }

  return { isValid: true }
}

// Export singleton instance
export const rfKittingPickingService = new RFKittingPickingService()
// Developer and Creator: Jai Singh
