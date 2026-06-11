// Created and developed by Jai Singh
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
 * One row returned to the operator when a scanned Kit PO maps to more
 * than one active kit. The form renders a picker over these so the
 * operator commits to a specific kit_serial_number before any
 * subsequent pick mutations.
 */
export interface KitDisambiguationOption {
  kit_serial_number: string
  kit_number: string
  kit_build_status: string
  kit_build_number: string | null
  total_lines: number
  picked_count: number
}

export interface VerifyKitForPickingResult {
  /** Loaded kit data when verification resolved to a single kit. */
  data: KittingPickData | null
  /** Operator-facing error message if verification failed. */
  error: string | null
  /**
   * Populated only when more than one active kit shares the scanned PO
   * and no kit_serial_number was supplied. Caller must present a picker
   * (or short-circuit if length === 1) and re-call verifyKitForPicking
   * with the chosen kit_serial_number.
   */
  kits?: KitDisambiguationOption[]
}

/**
 * RF Kitting Picking Service Class
 * Handles picking operations for Kit PO items
 */
class RFKittingPickingService {
  private static readonly TABLE_NAME = 'RR_Kitting_DATA'

  /**
   * Verify a Kit PO Number exists and is ready for picking.
   *
   * Two scoping modes:
   * - Pass `kitPoNumber` only — legacy / fallback scan path. If exactly
   *   one active kit exists for the PO, returns its data. If two or
   *   more active kits share the PO (e.g. C47E/4 Gear Box 1 + 2),
   *   returns a `kits` list and the caller must present a picker.
   * - Pass `kitPoNumber` + `kitSerialNumber` — used after the operator
   *   selects a specific kit from the picker. Identification is by
   *   serial; PO is verified for sanity but does not affect filtering.
   *
   * Operators who scan a `kit_serial_number` directly should call
   * {@link verifyKitForPickingBySerialNumber} instead — that path skips
   * the PO-meta lookup and never returns a `kits` disambiguation list
   * because the serial is already globally unique.
   *
   * Valid statuses for picking: 'pending', 'printed', 'in_progress'.
   */
  async verifyKitForPicking(
    kitPoNumber: string,
    kitSerialNumber?: string
  ): Promise<VerifyKitForPickingResult> {
    try {
      logger.log(
        '🔍 RF Kitting Picking: Verifying kit for picking (PO path):',
        kitPoNumber,
        kitSerialNumber ? `(serial: ${kitSerialNumber})` : ''
      )

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: null, error: 'User not authenticated' }
      }

      // First: resolve which kit serial(s) sit under this PO. Only when
      // we have a single serial may we proceed without disambiguation.
      // Filtering downstream uses kit_serial_number — a PO-scoped query
      // would silently merge unrelated kits' floor / rack lists.
      let resolvedSerial: string | null = kitSerialNumber?.trim() || null

      if (!resolvedSerial) {
        const { data: kitMeta, error: kitMetaError } = await (supabase
          .from(RFKittingPickingService.TABLE_NAME as any)
          .select(
            'kit_serial_number, kit_number, kit_build_status, kit_build_number, transfer_order_number, kit_to_line_picked_date_time'
          )
          .eq('kit_po_number', kitPoNumber) as any)

        if (kitMetaError) {
          logger.error(
            '❌ RF Kitting Picking: Database error (PO lookup):',
            kitMetaError
          )
          return { data: null, error: kitMetaError.message }
        }

        const metaRows = (kitMeta ?? []) as Array<{
          kit_serial_number: string | null
          kit_number: string | null
          kit_build_status: string | null
          kit_build_number: string | null
          transfer_order_number: string | null
          kit_to_line_picked_date_time: string | null
        }>

        if (metaRows.length === 0) {
          return { data: null, error: `Kit PO ${kitPoNumber} not found` }
        }

        const validStatuses = new Set(['pending', 'printed', 'in_progress'])
        const perSerial = new Map<
          string,
          KitDisambiguationOption & { _hasValidStatus: boolean }
        >()

        for (const row of metaRows) {
          if (!row.kit_serial_number) continue
          const existing = perSerial.get(row.kit_serial_number)
          const hasValidStatus = validStatuses.has(
            row.kit_build_status?.toLowerCase() || ''
          )
          if (!existing) {
            perSerial.set(row.kit_serial_number, {
              kit_serial_number: row.kit_serial_number,
              kit_number: row.kit_number || '',
              kit_build_status: row.kit_build_status || '',
              kit_build_number: row.kit_build_number,
              total_lines: row.transfer_order_number ? 1 : 0,
              picked_count: row.kit_to_line_picked_date_time ? 1 : 0,
              _hasValidStatus: hasValidStatus,
            })
          } else {
            if (row.transfer_order_number) existing.total_lines += 1
            if (row.kit_to_line_picked_date_time) existing.picked_count += 1
          }
        }

        const activeKits = Array.from(perSerial.values()).filter(
          (k) => k._hasValidStatus
        )

        if (activeKits.length === 0) {
          // Surface the status of the first kit so the operator knows
          // why the kit cannot be picked (matches the prior single-kit
          // behaviour).
          const firstStatus =
            Array.from(perSerial.values())[0]?.kit_build_status ?? 'unknown'
          return {
            data: null,
            error: `Kit ${kitPoNumber} is not ready for picking. Current status: ${firstStatus}`,
          }
        }

        if (activeKits.length > 1) {
          // Strip the internal helper field before returning to the UI.
          const kits = activeKits.map(
            ({ _hasValidStatus: _ignored, ...rest }) => rest
          )
          return {
            data: null,
            error: null,
            kits,
          }
        }

        resolvedSerial = activeKits[0].kit_serial_number
      }

      return this.loadKitPayloadBySerial(resolvedSerial)
    } catch (error: unknown) {
      logger.error('❌ RF Kitting Picking: Unexpected error:', error)
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Direct-by-serial entry point for the RF Kit Picking scan input.
   *
   * `kit_serial_number` is the globally unique PK on `RR_Kitting_DATA`
   * (format `KIT-YYYYMMDD-NNN`) so this path never needs the PO-meta
   * disambiguation pre-flight done by {@link verifyKitForPicking}. The
   * operator drops straight into picking even when the underlying PO
   * covers multiple kits.
   *
   * The Black Hat check inside {@link loadKitPayloadBySerial} still
   * keys on `kit_serial_number` first and falls back to legacy
   * PO-scoped flag rows, identical to the PO-path behaviour — so
   * Black-Hat-blocked sibling kits do not bleed across.
   *
   * Valid statuses for picking: 'pending', 'printed', 'in_progress'.
   */
  async verifyKitForPickingBySerialNumber(
    kitSerialNumber: string
  ): Promise<VerifyKitForPickingResult> {
    try {
      const serial = kitSerialNumber.trim()
      logger.log(
        '🔍 RF Kitting Picking: Verifying kit for picking (serial path):',
        serial
      )

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: null, error: 'User not authenticated' }
      }

      if (!serial) {
        return { data: null, error: 'Kit serial number is required' }
      }

      return this.loadKitPayloadBySerial(serial)
    } catch (error: unknown) {
      logger.error(
        '❌ RF Kitting Picking: Unexpected error (serial path):',
        error
      )
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Shared loader: fetch every TO row for a `kit_serial_number`, run
   * the Black Hat gate, and assemble the {@link KittingPickData}
   * payload. Single source of truth so the PO-path and serial-path
   * entry points behave identically once a serial is resolved.
   */
  private async loadKitPayloadBySerial(
    resolvedSerial: string
  ): Promise<VerifyKitForPickingResult> {
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
      .eq('kit_serial_number', resolvedSerial)
      .order('source_storage_bin', { ascending: true })
      .order('material', { ascending: true }) as any)

    if (error) {
      logger.error('❌ RF Kitting Picking: Database error:', error)
      return { data: null, error: error.message }
    }

    if (!kitItems || kitItems.length === 0) {
      logger.log(
        `❌ RF Kitting Picking: No kit rows found for serial ${resolvedSerial}`
      )
      return {
        data: null,
        error: `Kit serial ${resolvedSerial} not found`,
      }
    }

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

    // Sanity check: the chosen kit must still be pickable. (Status can
    // change between picker and submit.)
    const validStatuses = ['pending', 'printed', 'in_progress']
    if (
      !validStatuses.includes(firstRecord.kit_build_status?.toLowerCase() || '')
    ) {
      logger.log(
        `❌ RF Kitting Picking: Kit status not valid for picking: ${firstRecord.kit_build_status}`
      )
      return {
        data: null,
        error: `Kit ${firstRecord.kit_serial_number} is not ready for picking. Current status: ${firstRecord.kit_build_status}`,
      }
    }

    // Check for active Black Hat flag (blocks picking due to missing
    // BOM materials). Probe per-kit-serial first; fall back to a
    // PO-scoped probe for legacy flag rows whose serial column was
    // never backfilled. Sibling kits sharing a PO will not block each
    // other once their flag rows are serial-scoped.
    try {
      let blockingNote: string | null | undefined

      const { data: serialFlags } = await supabase
        .from('kit_build_flags')
        .select('id, notes')
        .eq('kit_serial_number', firstRecord.kit_serial_number)
        .eq('flag_type', 'black')
        .eq('is_active', true)
        .limit(1)

      if (serialFlags && (serialFlags as { id: string }[]).length > 0) {
        blockingNote = (
          serialFlags as { id: string; notes: string | null }[]
        )[0].notes
      } else {
        const { data: legacyPoFlags } = await supabase
          .from('kit_build_flags')
          .select('id, notes')
          .eq('kit_po_number', firstRecord.kit_po_number)
          .is('kit_serial_number', null)
          .eq('flag_type', 'black')
          .eq('is_active', true)
          .limit(1)

        if (legacyPoFlags && (legacyPoFlags as { id: string }[]).length > 0) {
          blockingNote = (
            legacyPoFlags as { id: string; notes: string | null }[]
          )[0].notes
        }
      }

      if (blockingNote !== undefined) {
        logger.log(
          `❌ RF Kitting Picking: Kit blocked by Black Hat flag: ${firstRecord.kit_serial_number}`
        )
        return {
          data: null,
          error: `Kit ${firstRecord.kit_serial_number} is blocked from picking — missing BOM materials.${blockingNote ? ` (${blockingNote})` : ''} Resolve the Black Hat flag before picking.`,
        }
      }
    } catch {
      // Fallback: check legacy flag field on the record
      if (firstRecord.kit_flag_type === 'black') {
        return {
          data: null,
          error: `Kit ${firstRecord.kit_serial_number} is blocked from picking due to a Black Hat flag. Resolve it before picking.`,
        }
      }
    }

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

    // Floor picks: bins starting with K or S. Rack picks: bins
    // starting with R.
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
      `✅ RF Kitting Picking: Found kit ${firstRecord.kit_serial_number} (PO ${firstRecord.kit_po_number}) with ${allItems.length} items`
    )
    logger.log(
      `   Floor picks: ${floorPickItems.length} (${floorPickedCount} picked)`
    )
    logger.log(
      `   Rack picks: ${rackPickItems.length} (${rackPickedCount} picked)`
    )

    return { data: pickData, error: null }
  }

  /**
   * Get the next item to pick for a specific pick type (floor or rack).
   * @param kitPoNumber - Scanned Kit PO Number (used for the multi-kit
   * disambiguation check inside verifyKitForPicking).
   * @param pickType - 'floor' or 'rack'
   * @param kitSerialNumber - Required when the PO maps to multiple kits.
   */
  async getNextPickItem(
    kitPoNumber: string,
    pickType: 'floor' | 'rack',
    kitSerialNumber?: string
  ): Promise<{ data: KittingPickItem | null; error: string | null }> {
    const {
      data: kitData,
      error,
      kits,
    } = await this.verifyKitForPicking(kitPoNumber, kitSerialNumber)

    if (kits && kits.length > 1) {
      return {
        data: null,
        error:
          'Multiple active kits share this Kit PO — pick a specific kit serial first.',
      }
    }

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
   * Validate scanned material matches expected part number.
   * Strips common barcode label prefixes (e.g. "P/N R ") before comparing.
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

    const scanned = cleanScannedPartNumber(scannedMaterial).toUpperCase()
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

      // Look up the kit identity for this line so we can sync the kanban
      // task per-serial (PO-only sync would aggregate across sibling
      // kits sharing the PO).
      const { data: lineData, error: lineError } = (await (supabase
        .from(RFKittingPickingService.TABLE_NAME as any)
        .select('kit_po_number, kit_serial_number')
        .eq('id', itemId)
        .single() as any)) as {
        data: {
          kit_po_number: string
          kit_serial_number: string | null
        } | null
        error: any
      }

      if (lineError || !lineData) {
        logger.error('❌ RF Kitting Picking: Could not find line:', lineError)
        return { success: false, error: 'Could not find the TO line' }
      }

      const { kit_po_number: kitPoNumber, kit_serial_number: kitSerialNumber } =
        lineData
      const now = new Date().toISOString()

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

      if (kitSerialNumber) {
        await KitKanbanService.syncKitProgressFromSerial(kitSerialNumber)
      } else {
        await KitKanbanService.syncKitProgressFromData(kitPoNumber)
      }

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
   * Update kit status to 'in_progress' if it's currently 'pending' or
   * 'printed'. Called when first pick is made. Filtered by
   * kit_serial_number — a PO-only update would flip both kits sharing
   * a PO into in_progress simultaneously (regression fix:
   * 2026-05-12 KIT-001 / KIT-002).
   */
  async updateKitStatusToInProgress(kitSerialNumber: string): Promise<void> {
    try {
      const { data: firstRecord } = (await (supabase
        .from(RFKittingPickingService.TABLE_NAME as any)
        .select('kit_build_status')
        .eq('kit_serial_number', kitSerialNumber)
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
          .eq('kit_serial_number', kitSerialNumber) as any)

        logger.log(
          `✅ RF Kitting Picking: Kit ${kitSerialNumber} status updated to 'in_progress'`
        )
      }
    } catch (error) {
      logger.error('⚠️ RF Kitting Picking: Error updating kit status:', error)
      // Non-critical error, don't throw
    }
  }

  /**
   * Check if all picking is complete for a single kit and report which
   * pick types are done. The verify call is scoped by kit_serial_number
   * so sibling kits sharing a PO can finish independently.
   */
  async checkAndUpdateKitPickingStatus(
    kitPoNumber: string,
    kitSerialNumber: string
  ): Promise<{
    allFloorPicked: boolean
    allRackPicked: boolean
    allPicked: boolean
  }> {
    const { data: kitData, error } = await this.verifyKitForPicking(
      kitPoNumber,
      kitSerialNumber
    )

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

      // 2. Update the TO line with missing part information. Pull the
      //    kit_serial_number back so all the per-kit fan-out below
      //    (status flip, kanban sync, purple flag) stays scoped to this
      //    specific kit instead of every kit sharing the PO.
      const { data: updatedRow, error: updateError } = (await (supabase
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
        .eq('id', itemId)
        .select('kit_serial_number')
        .single() as any)) as {
        data: { kit_serial_number: string | null } | null
        error: any
      }

      if (updateError) {
        logger.error('❌ RF Kitting Picking: Error updating line:', updateError)
        return { success: false, error: updateError.message }
      }

      const kitSerialNumber = updatedRow?.kit_serial_number ?? null

      // 3. Add purple hat flag — scoped to the specific kit serial.
      await this.addPurpleHatFlag(
        kitPoNumber,
        user.id,
        `Missing part reported for item ${itemId}`,
        kitSerialNumber
      )

      // 4. Update kit status to in_progress if needed (per serial).
      if (kitSerialNumber) {
        await this.updateKitStatusToInProgress(kitSerialNumber)
        await KitKanbanService.syncKitProgressFromSerial(kitSerialNumber)
      } else {
        // Legacy fallback for any pre-2026-05-12 row without a serial.
        await KitKanbanService.syncKitProgressFromData(kitPoNumber)
      }

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
   * Add a purple hat flag to a kit (Inventory Issue). Scoped to a
   * specific kit_serial_number so two kits sharing a PO can carry
   * independent flags. The PO is still recorded for legacy join paths
   * and forensic reporting.
   */
  private async addPurpleHatFlag(
    kitPoNumber: string,
    userId: string,
    notes: string,
    kitSerialNumber: string | null
  ): Promise<void> {
    try {
      const now = new Date().toISOString()

      const insertPayload: Record<string, unknown> = {
        kit_po_number: kitPoNumber,
        flag_type: 'purple',
        set_by_user: userId,
        set_date_time: now,
        notes: notes,
        is_active: true,
      }
      if (kitSerialNumber) {
        insertPayload.kit_serial_number = kitSerialNumber
      }

      const { error: flagError } = await (
        supabase.from('kit_build_flags') as any
      ).insert(insertPayload)

      if (flagError) {
        // If table doesn't exist or other error, try updating legacy
        // flag on RR_Kitting_DATA. Scope by serial when we have one so
        // legacy fallback also stays per-kit.
        logger.log(
          '⚠️ kit_build_flags insert failed, trying legacy update:',
          flagError.message
        )

        const update = supabase
          .from(RFKittingPickingService.TABLE_NAME as any)
          .update({
            kit_flag_type: 'purple',
            kit_flag_set_by_user: userId,
            kit_flag_set_date_time: now,
            updated_at: now,
          }) as any

        if (kitSerialNumber) {
          await update.eq('kit_serial_number', kitSerialNumber)
        } else {
          await update.eq('kit_po_number', kitPoNumber)
        }
      }

      logger.log(
        `✅ RF Kitting Picking: Purple hat flag added for kit ${kitSerialNumber ?? kitPoNumber}`
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
 * Clean a scanned part number by stripping common barcode label prefixes.
 * Warehouse barcodes may encode leading text such as "P/N R ", "P/N ", "PN ", etc.
 * before the actual part number. This normalizes the scan so it matches the
 * material number stored in the kit build plan.
 */
export function cleanScannedPartNumber(scannedValue: string): string {
  if (!scannedValue) return ''

  let cleaned = scannedValue.trim()

  // Strip known barcode label prefixes (case-insensitive, longest match first)
  const prefixPatterns = [
    /^P\/N\s*R\s+/i,
    /^P\/N\s*:\s*/i,
    /^P\/N\s+/i,
    /^PN\s*:\s*/i,
    /^PN\s+/i,
    /^PART\s+NO\.?\s*:?\s*/i,
    /^PART\s*#?\s*:?\s*/i,
    /^MAT(?:ERIAL)?\s*#?\s*:?\s*/i,
  ]

  for (const pattern of prefixPatterns) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, '')
      break
    }
  }

  return cleaned.trim()
}

/**
 * Detect a scanned `kit_serial_number` by its canonical prefix.
 *
 * Kit serials are generated by `RRKittingDataService.createKitBuildPlan`
 * with the format `KIT-YYYYMMDD-NNN` (e.g. `KIT-20260515-001`), so a
 * `KIT-` prefix is the simplest reliable smart-detect for the RF scan
 * input. Case-insensitive to tolerate uppercased scanner input.
 *
 * Returns `false` for the bare `KIT` token (without a hyphen) so that
 * legacy PO labels like `KIT12345` continue to route through the
 * PO path inside {@link isPotentialKitPoNumber}.
 */
export function isPotentialKitSerialNumber(inputValue: string): boolean {
  if (!inputValue || inputValue.trim().length === 0) {
    return false
  }
  return inputValue.trim().toUpperCase().startsWith('KIT-')
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
 * Validate the scan input for the RF Kit Picking entry step. The
 * input is permissive — it accepts EITHER a `kit_serial_number`
 * (`KIT-YYYYMMDD-NNN`) OR a `kit_po_number`. The detection of which
 * shape was scanned is the caller's responsibility (see
 * {@link isPotentialKitSerialNumber}); this validator just guards
 * against empty / impossibly short input.
 *
 * Retains the historical name so external callers that imported it
 * before the serial-number entry path was added keep working.
 *
 * @param kitIdentifier - The scanned / entered kit identifier.
 */
export function validateKitPoNumber(kitIdentifier: string): {
  isValid: boolean
  message?: string
} {
  if (!kitIdentifier || kitIdentifier.trim().length === 0) {
    return { isValid: false, message: 'Kit serial number or PO is required' }
  }

  const trimmed = kitIdentifier.trim()

  // Minimum 6 chars — short enough to let an early-typed serial like
  // `KIT-20…` start the auto-advance debounce, long enough to reject
  // obvious mis-scans.
  if (trimmed.length < 6) {
    return {
      isValid: false,
      message: 'Kit serial number or PO must be at least 6 characters',
    }
  }

  return { isValid: true }
}

// Export singleton instance
export const rfKittingPickingService = new RFKittingPickingService()

// Created and developed by Jai Singh
