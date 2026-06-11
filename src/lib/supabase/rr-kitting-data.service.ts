// Created and developed by Jai Singh
/**
 * RR_Kitting_DATA Service
 * Service for managing kit build plan data in Supabase
 * Created: December 11, 2025
 *
 * Note: This service uses type assertions because RR_Kitting_DATA
 * is not yet in the generated Supabase types. Run `supabase gen types`
 * to regenerate types after the table is created.
 */
import { logger } from '@/lib/utils/logger'
import {
  getDaysAgoEST,
  getStartOfDayEST,
  getTodayEST,
} from '@/lib/utils/timezone'
import { supabase } from './client'
import { KitKanbanService } from './kit-kanban.service'

// Expedite delivery time priority — matches CHECK constraint on
// RR_Kitting_DATA.part_expedite_delivery_time
export type ExpediteDeliveryTime = 'critical' | '24_hour' | '2_day'

// Shape returned by the Build Kit verification entry points.
// `kitSerialNumber` is exposed so the form can pass it through to the
// downstream Build Kit mutations (`startKitBuild`, `kitMaterial`,
// `completeKitBuild`) and avoid the multi-kit-per-PO aggregation bug
// documented in `Debug/Fix-Build-Kit-Completion-Multi-Kit-PO.md`.
export interface BuildKitVerifyResult {
  exists: boolean
  kitData?: {
    kitPoNumber: string
    kitSerialNumber: string | null
    kitBuildNumber: string
    kitNumber: string
    engineProgram: string
    deliverToPlant: string
    dueDate: string | null
    status: string
    totalLines: number
    kittedLines: number
    toLines: Array<{
      id: string
      transferOrderNumber: string
      material: string
      materialDescription: string
      sourceStorageBin: string
      destStorageBin: string
      quantity: number
      kitted: boolean
      kittedBy: string | null
      kittedAt: string | null
    }>
  }
  error?: string
}

export const EXPEDITE_DELIVERY_TIMES: Array<{
  value: ExpediteDeliveryTime
  label: string
  description: string
}> = [
  {
    value: 'critical',
    label: 'Critical',
    description: 'Highest priority — needed ASAP.',
  },
  {
    value: '24_hour',
    label: '24 Hours',
    description: 'Required within 24 hours.',
  },
  {
    value: '2_day',
    label: '2-Day',
    description: 'Required within 2 days.',
  },
]

// Database record structure matching the RR_Kitting_DATA table
export interface RRKittingDataRecord {
  id?: string

  // Transfer Order Fields (from Excel Import)
  dest_storage_bin?: string
  transfer_order_number?: string
  source_storage_type?: string
  warehouse_number?: string
  dest_storage_type?: string
  movement_type_im?: string
  movement_type_wm?: string
  source_storage_bin?: string
  plant?: string
  storage_location?: string
  material?: string
  material_description?: string
  batch?: string
  source_target_qty?: string
  creation_date?: string
  creation_time?: string
  user?: string
  printer?: string
  special_stock_number?: string

  // Kit Build Plan Fields
  kit_build_number: string
  kit_po_number: string
  // Globally unique kit identity (`KIT-YYYYMMDD-NNN`). Optional on the
  // raw record type because legacy rows pre-dating `createKitBuildPlan`
  // may have NULL — modern inserts always populate it. See
  // `memorybank/OmniFrame/Patterns/Kit-Serial-Scoping.md`.
  kit_serial_number?: string | null
  engine_program: string
  kit_number: string
  deliver_to_plant: string
  due_date?: string

  // Kit Added Tracking
  kit_added_by_user?: string
  kit_added_create_date_time?: string

  // Kit Printed Tracking
  kit_printed_by_user?: string
  kit_printed_date_time?: string

  // Kit TO Line Picked Tracking
  kit_to_line_picked_by_user?: string
  kit_to_line_picked_date_time?: string

  // Kit TO Line Kitted Tracking
  kit_to_line_kitted_by_user?: string
  kit_to_line_kitted_date_time?: string

  // Kit Inspection Tracking
  kit_inspection_by_user?: string
  kit_inspection_completion_date_time?: string

  // Kit Ready On Dock Tracking
  kit_ready_on_dock_by_user?: string
  kit_ready_on_dock_date_time?: string
  // Operator-scanned dock location stamped by the RF Dock Staging flow.
  // Nullable; legacy rows (and kits that reached on-dock via the
  // pre-2026-05-17 completeKitBuild skip-inspection path) carry NULL.
  // Validated client-side against `kitting_dropdown_options` rows where
  // `option_group = 'dock_location'`. See
  // `memorybank/OmniFrame/Implementations/RF-Dock-Staging-Flow.md`.
  kit_dock_location?: string | null

  // Kit Status and Priority
  kit_build_status?: string
  kit_priority?: number
  kit_priority_change_count?: number
  kit_priority_set_by_user?: string

  // Kit Priority Flag Tracking
  kit_flag_type?: 'purple' | 'orange' | 'red' | 'black' | null
  kit_flag_set_by_user?: string
  kit_flag_set_date_time?: string
  kit_flag_cleared_by_user?: string
  kit_flag_cleared_date_time?: string

  // Per-line cancellation (migration 325). When `cancelled = true` the
  // line is excluded from the picking/kitting stage gate and from BOM
  // coverage matching, but remains visible in the Kit Build Audit
  // Trail's TO Lines table for audit history. The four columns are
  // populated together — DB CHECK constraint
  // `rr_kitting_data_cancellation_invariants` enforces the all-or-
  // nothing invariant. See [[Cancel-Kit-TO-Line]].
  cancelled?: boolean
  cancelled_at?: string | null
  cancelled_by_user?: string | null
  cancelled_reason?: string | null

  // INCORA and Ship Short Items (JSON arrays)
  incora_items?: Array<{ lineNumber: number; value: string }>
  authorized_ship_short_items?: Array<{
    lineNumber: number
    partNumber: string
    description: string
  }>
  shortage_items?: Array<{
    lineNumber: number
    toNumber: string
    shortageDescription: string
  }>

  // Kit Cart Color (hex, e.g. '#22c55e')
  kit_cart_color?: string
  kit_container_type?: string
  charge_code?: string

  // Part Expedite Fields
  part_expedite_part_number?: string
  part_expedite_description?: string
  part_expedite_quantity?: number
  part_expedite_delivery_time?: ExpediteDeliveryTime
  part_expedite_request_by_user?: string
  part_expedite_requested_by_date?: string
  part_expedite_request_create_date_time?: string
  part_expedite_request_reason_code?: string

  // Audit Fields
  created_at?: string
  updated_at?: string
}

// Active flag structure for grid display
export interface ActiveFlagRecord {
  id: string
  flagType: 'purple' | 'orange' | 'red' | 'black'
  setByUserName: string | null
  setDateTime: string | null
  notes: string | null
}

// Grid display record structure
export interface KitGridRecord {
  id: string
  kit_serial_number: string // PRIMARY KEY: Unique identifier for each kit build (format: KIT-YYYYMMDD-XXX)
  kit_po_number: string
  kit_number: string // Kit Number (can have duplicates across different kits)
  kit_priority: number
  kit_priority_change_count: number
  due_date: string | null
  kit_added_by_user: string | null
  kit_added_by_user_name: string | null
  kit_added_create_date_time: string | null
  kit_build_status: string | null
  // Derived granular stage (picking / picking_complete / kitting / kit_built /
  // kit_inspected / completed, else the raw status) computed from per-line
  // progress. Display-only — raw kit_build_status drives tab/search logic.
  kit_stage_status: string | null
  // Engine program. Stand-alone single-part expedites are stamped 'EXPEDITE'
  // (see addExpediteToKit mode 2) — the grid uses this to split them into
  // their own tab.
  engine_program: string | null
  // Authorized to Ship Short part numbers attached to this kit (negate the
  // auto-Black-Hat for the matching BOM line). Surfaced on the grid so the
  // queue shows at a glance which kits carry a ship-short authorization.
  authorized_ship_short_items: Array<{
    lineNumber: number
    partNumber: string
    description: string
  }>
  // Multiple flags support
  active_flags: ActiveFlagRecord[]
  // Legacy single flag fields (for backward compatibility)
  kit_flag_type: 'purple' | 'orange' | 'red' | 'black' | null
  kit_flag_set_by_user: string | null
  kit_flag_set_by_user_name: string | null
  kit_flag_set_date_time: string | null
  kit_flag_cleared_by_user: string | null
  kit_flag_cleared_by_user_name: string | null
  kit_flag_cleared_date_time: string | null
}

// Input structure for creating kit build plan entries
export interface CreateKitBuildPlanInput {
  kitBuildNumber: string
  kitPoNumber: string
  engineProgram: string
  kitNumber: string
  deliverToPlant: string
  dueDate?: Date
  importedTOs: Array<{
    destStorageBin: string
    transferOrderNumber: string
    sourceStorageType: string
    warehouseNumber: string
    destStorageType: string
    movementTypeIM: string
    movementTypeWM: string
    sourceStorageBin: string
    plant: string
    storageLocation: string
    material: string
    materialDescription: string
    batch: string
    sourceTargetQty: string
    creationDate: string
    creationTime: string
    user: string
    printer: string
    specialStockNumber: string
  }>
  // INCORA items for the kit build sheet
  incoraItems?: Array<{ lineNumber: number; value: string }>
  // Authorized to Ship Short items
  authorizedShipShortItems?: Array<{
    lineNumber: number
    partNumber: string
    description: string
    // Display name of the operator who authorized the ship-short (stamped
    // server-side at write time; see migration 101 format). Optional on input.
    authorizedBy?: string | null
  }>
  // Kit cart color designator (hex, e.g. '#22c55e')
  kitCartColor?: string
  // Kit container type snapshot (kit_cart | pallet | flight_case)
  kitContainerType?: string
  // Charge code snapshot for the build sheet
  chargeCode?: string
  // BOM linkage
  kitDefinitionId?: string
  bomCoverage?: {
    matched: Array<{
      componentType?: 'material' | 'incora_sub_kit' | 'incora_component'
      materialNumber: string
      materialDescription: string
      requiredQuantity: number
      incoraReference?: string
    }>
    unmatched: Array<{
      componentType?: 'material' | 'incora_sub_kit' | 'incora_component'
      materialNumber: string
      materialDescription: string
      requiredQuantity: number
      incoraReference?: string
    }>
    isComplete: boolean
  }
}

// Type-safe wrapper for the supabase client to handle tables not in generated types
const db = supabase as unknown as ReturnType<(typeof supabase)['from']> & {
  from: (table: string) => ReturnType<(typeof supabase)['from']>
}

const HEX_COLOR_REGEX = /^#[0-9A-F]{6}$/i

function formatBomCoverageLabel(component: {
  componentType?: 'material' | 'incora_sub_kit' | 'incora_component'
  materialNumber: string
  materialDescription: string
  incoraReference?: string
}) {
  let identifier: string
  if (component.componentType === 'incora_sub_kit') {
    identifier = `INCORA: ${component.incoraReference || 'Unknown'}`
  } else if (component.componentType === 'incora_component') {
    const matPart = component.materialNumber || ''
    const refPart = component.incoraReference
      ? `INCORA: ${component.incoraReference}`
      : ''
    identifier =
      matPart && refPart
        ? `${matPart} / ${refPart}`
        : matPart || refPart || 'Unknown'
  } else {
    identifier = component.materialNumber
  }

  return `${identifier} (${component.materialDescription})`
}

function validateOptionalHexColor(color?: string) {
  if (!color) return null
  if (!HEX_COLOR_REGEX.test(color)) {
    return 'Kit cart color must be a valid 6-digit hex value like #22C55E'
  }
  return null
}

export class RRKittingDataService {
  private static readonly TABLE_NAME = 'RR_Kitting_DATA'

  /**
   * Resolve the current signed-in user's display name (full name → first/last
   * → email local-part). Used to stamp `authorizedBy` on ship-short items so
   * the Kit Build Sheet can show who authorized each part. Returns null when
   * unauthenticated or the profile can't be resolved.
   */
  private static async getCurrentUserDisplayName(): Promise<string | null> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return null

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('full_name, first_name, last_name, email')
        .eq('id', user.id)
        .single()

      if (!profile) return null
      return (
        profile.full_name?.trim() ||
        `${profile.first_name?.trim() || ''} ${profile.last_name?.trim() || ''}`.trim() ||
        profile.email?.split('@')[0] ||
        null
      )
    } catch {
      return null
    }
  }

  /**
   * Create kit build plan entries from form data
   * Creates one record per imported TO, or one record if no TOs imported
   * Also creates a linked kanban task for the Kit Assembly Board
   */
  static async createKitBuildPlan(input: CreateKitBuildPlanInput): Promise<{
    success: boolean
    recordCount: number
    kanbanTaskId?: string
    kanbanError?: string // Error message if kanban task creation failed
    error?: string
  }> {
    const colorError = validateOptionalHexColor(input.kitCartColor)
    if (colorError) {
      return { success: false, recordCount: 0, error: colorError }
    }

    // Get the current user
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const userId = user?.id

    // Resolve the creator's display name to stamp as the ship-short authorizer
    // for any items entered at creation time (preserves an explicit authorizedBy
    // if the caller already provided one).
    const creatorName = await this.getCurrentUserDisplayName()
    const shipShortItems =
      input.authorizedShipShortItems &&
      input.authorizedShipShortItems.length > 0
        ? input.authorizedShipShortItems.map((item) => ({
            ...item,
            authorizedBy: item.authorizedBy ?? creatorName ?? null,
          }))
        : []

    // Format due date for database
    const formattedDueDate = input.dueDate
      ? input.dueDate.toISOString().split('T')[0]
      : null

    // Generate a kit serial number (format: KIT-YYYYMMDD-XXX)
    const kitSerialNumber = await this.generateKitSerialNumber()

    // Get the next priority (position) for this kit
    const nextPriority = await this.getNextPriority()

    // Base record data from the form
    const baseRecord: Record<string, unknown> = {
      kit_build_number: input.kitBuildNumber,
      kit_po_number: input.kitPoNumber,
      engine_program: input.engineProgram,
      kit_number: input.kitNumber,
      deliver_to_plant: input.deliverToPlant,
      due_date: formattedDueDate,
      kit_added_by_user: userId,
      kit_added_create_date_time: new Date().toISOString(),
      kit_build_status: 'pending',
      kit_serial_number: kitSerialNumber,
      kit_priority: nextPriority,
      kit_priority_change_count: 0,
      // INCORA and Ship Short items (stored as JSON)
      incora_items:
        input.incoraItems && input.incoraItems.length > 0
          ? input.incoraItems
          : [],
      authorized_ship_short_items: shipShortItems,
    }

    if (input.kitDefinitionId) {
      baseRecord.kit_definition_id = input.kitDefinitionId
    }

    if (input.kitCartColor) {
      baseRecord.kit_cart_color = input.kitCartColor
    }

    if (input.kitContainerType) {
      baseRecord.kit_container_type = input.kitContainerType
    }

    if (input.chargeCode) {
      baseRecord.charge_code = input.chargeCode
    }

    // Track first record ID to link kanban task
    let firstRecordId: string | null = null

    // If there are imported TOs, create one record per TO
    if (input.importedTOs.length > 0) {
      const records = input.importedTOs.map((to) => ({
        ...baseRecord,
        dest_storage_bin: to.destStorageBin,
        transfer_order_number: to.transferOrderNumber,
        source_storage_type: to.sourceStorageType,
        warehouse_number: to.warehouseNumber,
        dest_storage_type: to.destStorageType,
        movement_type_im: to.movementTypeIM,
        movement_type_wm: to.movementTypeWM,
        source_storage_bin: to.sourceStorageBin,
        plant: to.plant,
        storage_location: to.storageLocation,
        material: to.material,
        material_description: to.materialDescription,
        batch: to.batch,
        source_target_qty: to.sourceTargetQty,
        creation_date: to.creationDate,
        creation_time: to.creationTime,
        user: to.user,
        printer: to.printer,
        special_stock_number: to.specialStockNumber,
      }))

      const { data, error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .insert(records as never[])
        .select('id')

      if (error) {
        logger.error('Error inserting kit build plan records:', error)
        return { success: false, recordCount: 0, error: error.message }
      }

      // Get the first record ID for kanban linking
      if (data && (data as unknown as { id: string }[]).length > 0) {
        firstRecordId = (data as unknown as { id: string }[])[0].id
      }

      // Create kanban task for the Kit Assembly Board
      const kanbanResult = await KitKanbanService.createTask({
        kitSerialNumber,
        kitPoNumber: input.kitPoNumber,
        kitNumber: input.kitNumber, // Pass kit number for unique kit identification
        kitBuildNumber: input.kitBuildNumber,
        kitBuildPlanId: firstRecordId || '',
        priority: nextPriority,
        totalToLines: input.importedTOs.length,
        dueDate: formattedDueDate || undefined,
      })

      // Update the records with the kanban task ID. Scope by
      // kit_serial_number — keying by kit_po_number would clobber the
      // kanban link of any existing kit that happens to share this PO
      // (regression fix: 2026-05-12 KIT-001 / KIT-002 cross-link).
      if (kanbanResult.success && kanbanResult.taskId && firstRecordId) {
        await (
          db.from(this.TABLE_NAME) as unknown as ReturnType<
            (typeof supabase)['from']
          >
        )
          .update({ kanban_task_id: kanbanResult.taskId } as Record<
            string,
            unknown
          >)
          .eq('kit_serial_number', kitSerialNumber)
      } else if (!kanbanResult.success) {
        // Log kanban task creation failure but don't fail the overall operation
        // The kit build plan records are already saved
        logger.warn(
          `[KittingService] Kanban task creation failed for kit ${input.kitPoNumber}: ${kanbanResult.error}`
        )
      }

      // Auto-flag Black Hat if BOM coverage is incomplete. Scope by
      // kit_serial_number so two kits sharing a PO each carry their own
      // flag.
      if (
        input.bomCoverage &&
        !input.bomCoverage.isComplete &&
        input.bomCoverage.unmatched.length > 0
      ) {
        const missingList = input.bomCoverage.unmatched
          .map((m) => formatBomCoverageLabel(m))
          .join(', ')
        await this.addFlagBySerialNumber(
          kitSerialNumber,
          'black',
          `Auto-flagged: Missing BOM components — ${missingList}`
        )
        logger.log(
          `[KittingService] Auto-flagged Black Hat for kit ${kitSerialNumber}: ${input.bomCoverage.unmatched.length} missing components`
        )
      }

      return {
        success: true,
        recordCount: records.length,
        kanbanTaskId: kanbanResult.taskId,
        kanbanError: kanbanResult.success ? undefined : kanbanResult.error,
      }
    } else {
      // No TOs imported, create a single record with just the form data
      const { data, error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .insert([baseRecord] as never[])
        .select('id')

      if (error) {
        logger.error('Error inserting kit build plan record:', error)
        return { success: false, recordCount: 0, error: error.message }
      }

      // Get the record ID for kanban linking
      if (data && (data as unknown as { id: string }[]).length > 0) {
        firstRecordId = (data as unknown as { id: string }[])[0].id
      }

      // Create kanban task for the Kit Assembly Board (0 TO lines if no TOs imported)
      const kanbanResult = await KitKanbanService.createTask({
        kitSerialNumber,
        kitPoNumber: input.kitPoNumber,
        kitNumber: input.kitNumber, // Pass kit number for unique kit identification
        kitBuildNumber: input.kitBuildNumber,
        kitBuildPlanId: firstRecordId || '',
        priority: nextPriority,
        totalToLines: 0,
        dueDate: formattedDueDate || undefined,
      })

      // Update the record with the kanban task ID
      if (kanbanResult.success && kanbanResult.taskId && firstRecordId) {
        await (
          db.from(this.TABLE_NAME) as unknown as ReturnType<
            (typeof supabase)['from']
          >
        )
          .update({ kanban_task_id: kanbanResult.taskId } as Record<
            string,
            unknown
          >)
          .eq('id', firstRecordId)
      } else if (!kanbanResult.success) {
        // Log kanban task creation failure but don't fail the overall operation
        logger.warn(
          `[KittingService] Kanban task creation failed for kit ${input.kitPoNumber}: ${kanbanResult.error}`
        )
      }

      // Auto-flag Black Hat if BOM coverage is incomplete (per kit
      // serial — see rationale on the with-TOs branch above).
      if (
        input.bomCoverage &&
        !input.bomCoverage.isComplete &&
        input.bomCoverage.unmatched.length > 0
      ) {
        const missingList = input.bomCoverage.unmatched
          .map((m) => formatBomCoverageLabel(m))
          .join(', ')
        await this.addFlagBySerialNumber(
          kitSerialNumber,
          'black',
          `Auto-flagged: Missing BOM components — ${missingList}`
        )
        logger.log(
          `[KittingService] Auto-flagged Black Hat for kit ${kitSerialNumber}: ${input.bomCoverage.unmatched.length} missing components`
        )
      }

      return {
        success: true,
        recordCount: 1,
        kanbanTaskId: kanbanResult.taskId,
        kanbanError: kanbanResult.success ? undefined : kanbanResult.error,
      }
    }
  }

  /**
   * Generate a unique kit serial number
   * Format: KIT-YYYYMMDD-XXX where XXX is a sequential number
   */
  private static async generateKitSerialNumber(): Promise<string> {
    const today = new Date()
    const datePrefix = today.toISOString().split('T')[0].replace(/-/g, '')
    const prefix = `KIT-${datePrefix}-`

    // Find existing serials with today's prefix
    const { data } = await (
      db.from(this.TABLE_NAME) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .select('kit_serial_number')
      .like('kit_serial_number', `${prefix}%`)
      .order('kit_serial_number', { ascending: false })
      .limit(1)

    let nextNumber = 1
    if (
      data &&
      (data as unknown as { kit_serial_number: string }[]).length > 0
    ) {
      const lastSerial = (data as unknown as { kit_serial_number: string }[])[0]
        .kit_serial_number
      const lastNumber = parseInt(lastSerial.replace(prefix, ''), 10)
      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1
      }
    }

    return `${prefix}${String(nextNumber).padStart(3, '0')}`
  }

  /**
   * Get the next priority number for a new kit build plan
   */
  private static async getNextPriority(): Promise<number> {
    const { data } = await (
      db.from(this.TABLE_NAME) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .select('kit_priority')
      .not('kit_priority', 'is', null)
      .order('kit_priority', { ascending: false })
      .limit(1)

    if (data && (data as unknown as { kit_priority: number }[]).length > 0) {
      return (data as unknown as { kit_priority: number }[])[0].kit_priority + 1
    }

    return 1
  }

  /**
   * Get all kit build plan records
   */
  static async getAll(): Promise<RRKittingDataRecord[]> {
    const { data, error } = await (
      db.from(this.TABLE_NAME) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      logger.error('Error fetching kit build plan records:', error)
      return []
    }

    return (data as unknown as RRKittingDataRecord[]) || []
  }

  /**
   * Get records by kit build number
   */
  static async getByKitBuildNumber(
    kitBuildNumber: string
  ): Promise<RRKittingDataRecord[]> {
    const { data, error } = await (
      db.from(this.TABLE_NAME) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .select('*')
      .eq('kit_build_number', kitBuildNumber)
      .order('created_at', { ascending: false })

    if (error) {
      logger.error('Error fetching records by kit build number:', error)
      return []
    }

    return (data as unknown as RRKittingDataRecord[]) || []
  }

  /**
   * Update kit build status
   */
  static async updateStatus(
    id: string,
    status: string
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await (
      db.from(this.TABLE_NAME) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .update({ kit_build_status: status } as Record<string, unknown>)
      .eq('id', id)

    if (error) {
      logger.error('Error updating kit build status:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  }

  /**
   * Update multiple records by kit build number
   */
  static async updateByKitBuildNumber(
    kitBuildNumber: string,
    updates: Partial<RRKittingDataRecord>
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await (
      db.from(this.TABLE_NAME) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .update(updates as Record<string, unknown>)
      .eq('kit_build_number', kitBuildNumber)

    if (error) {
      logger.error('Error updating records:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  }

  /**
   * Delete a kit build plan record
   */
  static async delete(
    id: string
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await (
      db.from(this.TABLE_NAME) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .delete()
      .eq('id', id)

    if (error) {
      logger.error('Error deleting kit build plan record:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  }

  /**
   * Delete an entire kit from the build plan by serial number.
   * Wipes RR_Kitting_DATA rows, kit_build_flags, and the kit_kanban_tasks
   * card (which cascade-deletes kit_kanban_task_history).
   */
  static async deleteKitBySerialNumber(
    kitSerialNumber: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 1. Look up kit_po_number and kanban_task_id from the first row
      const { data: rows, error: lookupError } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('id, kit_po_number, kanban_task_id')
        .eq('kit_serial_number', kitSerialNumber)

      if (lookupError) {
        logger.error('Error looking up kit for deletion:', lookupError)
        return { success: false, error: lookupError.message }
      }

      const typedRows =
        (rows as unknown as
          | {
              id: string
              kit_po_number: string
              kanban_task_id: string | null
            }[]
          | null) ?? []

      if (typedRows.length === 0) {
        return { success: false, error: 'Kit not found' }
      }

      const kitPoNumber = typedRows[0].kit_po_number
      const rowIds = typedRows.map((r) => r.id)
      const kanbanTaskId = typedRows.find(
        (r) => r.kanban_task_id
      )?.kanban_task_id

      // 2. Delete kit_build_flags (no FK — must be explicit)
      //    Try by kit_serial_number first, fall back to kit_po_number
      const { error: flagSerialErr } = await (
        db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
      )
        .delete()
        .eq('kit_serial_number', kitSerialNumber)

      if (flagSerialErr) {
        logger.warn(
          'Falling back to kit_po_number for flag deletion:',
          flagSerialErr.message
        )
        const { error: flagPoErr } = await (
          db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
        )
          .delete()
          .eq('kit_po_number', kitPoNumber)

        if (flagPoErr) {
          logger.error('Error deleting kit_build_flags:', flagPoErr)
        }
      }

      // 3. Delete kit_kanban_tasks (cascades to kit_kanban_task_history)
      //    Try by kit_serial_number on the tasks table
      const { error: kanbanErr } = await (
        db.from('kit_kanban_tasks') as ReturnType<(typeof supabase)['from']>
      )
        .delete()
        .eq('kit_serial_number', kitSerialNumber)

      if (kanbanErr) {
        logger.warn(
          'Kanban delete by serial failed, trying by task ID:',
          kanbanErr.message
        )
        if (kanbanTaskId) {
          await KitKanbanService.deleteTask(kanbanTaskId)
        }
      }

      // 4. Delete all RR_Kitting_DATA rows by their specific IDs
      //    Using .in('id', [...]) avoids silent RLS no-ops on kit_serial_number
      const { error: dataErr } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .delete()
        .in('id', rowIds)

      if (dataErr) {
        logger.error('Error deleting RR_Kitting_DATA rows:', dataErr)
        return { success: false, error: dataErr.message }
      }

      // 5. Verify the rows are actually gone
      const { data: remaining } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('id')
        .eq('kit_serial_number', kitSerialNumber)
        .limit(1)

      if (remaining && (remaining as unknown as { id: string }[]).length > 0) {
        logger.error(
          'Kit rows still exist after delete — likely blocked by RLS policy'
        )
        return {
          success: false,
          error:
            'Delete was blocked by database permissions. Contact an administrator.',
        }
      }

      logger.log(`Kit ${kitSerialNumber} fully deleted from build plan`)
      return { success: true }
    } catch (err) {
      logger.error('Unexpected error deleting kit:', err)
      return { success: false, error: 'Unexpected error during kit deletion' }
    }
  }

  /**
   * Get statistics for the dashboard
   */
  static async getStatistics(): Promise<{
    totalRecords: number
    pendingCount: number
    inProgressCount: number
    completedCount: number
    completedTodayCount: number
    completedYesterdayCount: number
    completedThisWeekCount: number
  }> {
    // Supabase caps a single select at 1000 rows. RR_Kitting_DATA has one row
    // per TO line, so a large queue easily exceeds that — page through in
    // 1000-row batches (ordered by the unique `id` so pages don't skip/dup)
    // until a short page, the same pattern the inbound-scan / putaway-log
    // services use to pull the full dataset.
    const PAGE_SIZE = 1000
    const records: Array<{
      kit_serial_number: string | null
      kit_build_status: string | null
      kit_ready_on_dock_date_time: string | null
    }> = []
    let page = 0
    let hasMore = true

    while (hasMore) {
      const from = page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1
      const { data, error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select(
          'kit_serial_number, kit_build_status, kit_ready_on_dock_date_time'
        )
        .order('id', { ascending: true })
        .range(from, to)

      if (error) {
        logger.error('Error fetching statistics:', error)
        // First page failed → nothing usable; otherwise compute from what we
        // already paged in (best-effort rather than reporting zeros).
        if (page === 0) {
          return {
            totalRecords: 0,
            pendingCount: 0,
            inProgressCount: 0,
            completedCount: 0,
            completedTodayCount: 0,
            completedYesterdayCount: 0,
            completedThisWeekCount: 0,
          }
        }
        break
      }

      const batch =
        (data as unknown as Array<{
          kit_serial_number: string | null
          kit_build_status: string | null
          kit_ready_on_dock_date_time: string | null
        }>) || []
      records.push(...batch)
      hasMore = batch.length === PAGE_SIZE
      page++
    }

    // RR_Kitting_DATA holds one row per TO line (i.e. per part), so counting
    // rows would report parts, not kits. The status is snapshot-replicated
    // across a kit's rows, so count DISTINCT kit_serial_number per state.
    //
    // "Completed" follows the canonical on-dock = done invariant: a kit is
    // completed if it's on dock OR stored 'completed' (some on-dock kits sit
    // at a stale 'printed' status — e.g. a cover-sheet reprint regressed it),
    // matching the Completed Kits tab. Pending / In Progress exclude any kit
    // that's completed.
    const completedSerials = new Set<string>()
    for (const r of records) {
      if (
        r.kit_serial_number &&
        (r.kit_ready_on_dock_date_time != null ||
          r.kit_build_status === 'completed')
      ) {
        completedSerials.add(r.kit_serial_number)
      }
    }
    const countOpenKitsByStatus = (status: string): number => {
      const serials = new Set<string>()
      for (const r of records) {
        if (
          r.kit_serial_number &&
          r.kit_build_status === status &&
          !completedSerials.has(r.kit_serial_number)
        ) {
          serials.add(r.kit_serial_number)
        }
      }
      return serials.size
    }

    // Date-scoped completion buckets (Today / Yesterday / Last 7 days),
    // mirroring the outbound data manager's EST-based "today" metrics.
    // The dock timestamp is the completion moment — stageKitToDock stamps
    // kit_ready_on_dock_date_time on every row of the kit when it reaches
    // the dock. Kits stored as 'completed' without a dock timestamp
    // (legacy rows) can't be dated, so they only count toward the
    // all-time total above.
    const dockDateBySerial = new Map<string, string>()
    for (const r of records) {
      if (
        r.kit_serial_number &&
        r.kit_ready_on_dock_date_time &&
        !dockDateBySerial.has(r.kit_serial_number)
      ) {
        // EST calendar date (YYYY-MM-DD) of the UTC dock timestamp
        dockDateBySerial.set(
          r.kit_serial_number,
          getStartOfDayEST(new Date(r.kit_ready_on_dock_date_time)).slice(0, 10)
        )
      }
    }
    const todayEST = getTodayEST()
    const yesterdayEST = getDaysAgoEST(1)
    // Rolling 7-day window including today — same convention as the
    // outbound statistics' getDaysAgoEST(7) week metric.
    const weekAgoEST = getDaysAgoEST(7)
    let completedTodayCount = 0
    let completedYesterdayCount = 0
    let completedThisWeekCount = 0
    for (const date of dockDateBySerial.values()) {
      if (date === todayEST) completedTodayCount++
      if (date === yesterdayEST) completedYesterdayCount++
      if (date >= weekAgoEST) completedThisWeekCount++
    }

    return {
      // totalRecords stays a row count — the "Total kit records" card reports
      // total line items, not kits (the "Kit PO Numbers" card shows kit count).
      totalRecords: records.length,
      pendingCount: countOpenKitsByStatus('pending'),
      inProgressCount: countOpenKitsByStatus('in_progress'),
      completedCount: completedSerials.size,
      completedTodayCount,
      completedYesterdayCount,
      completedThisWeekCount,
    }
  }

  /**
   * Get unique kit records for grid display (grouped by kit_po_number)
   * Records are ordered by kit_priority (ascending), with priority being the row position
   */
  static async getKitGridData(): Promise<KitGridRecord[]> {
    type RawKitRecord = {
      id: string
      kit_serial_number?: string | null // PRIMARY KEY: Unique identifier for each kit build
      kit_po_number?: string | null
      kit_number?: string | null
      kit_priority?: number | null
      kit_priority_change_count?: number | null
      due_date?: string | null
      kit_added_by_user?: string | null
      kit_added_create_date_time?: string | null
      kit_build_status?: string | null
      engine_program?: string | null
      // Per-line + kit-level progress, used to derive the real current stage
      // (Picking / Picking Complete / Kitting / …) for the Status column.
      kit_to_line_picked_date_time?: string | null
      kit_to_line_kitted_date_time?: string | null
      kit_inspection_completion_date_time?: string | null
      kit_ready_on_dock_date_time?: string | null
      cancelled?: boolean | null
      authorized_ship_short_items?: Array<{
        lineNumber: number
        partNumber: string
        description: string
      }> | null
      // Kit Flag fields (legacy)
      kit_flag_type?: 'purple' | 'orange' | 'red' | 'black' | null
      kit_flag_set_by_user?: string | null
      kit_flag_set_date_time?: string | null
      kit_flag_cleared_by_user?: string | null
      kit_flag_cleared_date_time?: string | null
    }

    // Fetch main kitting data. Supabase caps a select at 1000 rows and
    // RR_Kitting_DATA has one row per TO line, so page through in 1000-row
    // batches until a short page (mirrors the inbound-scan / putaway-log
    // fetch-all pattern). Secondary sort on the unique `id` keeps pages stable
    // when many rows share the same kit_added_create_date_time.
    const PAGE_SIZE = 1000
    const records: RawKitRecord[] = []
    let page = 0
    let hasMore = true

    while (hasMore) {
      const from = page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1
      const { data, error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('*')
        .order('kit_added_create_date_time', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)

      if (error) {
        logger.error('Error fetching kit grid data:', error)
        if (page === 0) return []
        break
      }

      const batch = (data as RawKitRecord[]) || []
      records.push(...batch)
      hasMore = batch.length === PAGE_SIZE
      page++
    }

    logger.log('[KittingService] Fetched records:', records.length)

    // Group by kit_serial_number (unique identifier for each kit build)
    // This ensures each kit build is treated as its own entity, even with same PO number.
    // While grouping we also AGGREGATE the per-line picked/kitted progress (one
    // RR_Kitting_DATA row per TO line) + kit-level inspection / on-dock flags so
    // we can derive the real current stage for the Status column instead of the
    // coarse stored kit_build_status (which sits on "in_progress" through both
    // picking and kitting). Mirrors the stage math in getKitBuildPlanDetails*.
    type StageAgg = {
      total: number
      picked: number
      kitted: number
      inspected: boolean
      onDock: boolean
    }
    const uniqueBySerialNumber = new Map<string, RawKitRecord>()
    const aggBySerialNumber = new Map<string, StageAgg>()
    for (const record of records) {
      // Use kit_serial_number as the unique key - it's generated uniquely for each kit build
      const serialNumber =
        record.kit_serial_number || `__no_serial_${record.id}`
      if (!uniqueBySerialNumber.has(serialNumber)) {
        uniqueBySerialNumber.set(serialNumber, record)
      }

      const agg = aggBySerialNumber.get(serialNumber) ?? {
        total: 0,
        picked: 0,
        kitted: 0,
        inspected: false,
        onDock: false,
      }
      // Cancelled lines don't count toward picking/kitting completion.
      if (!record.cancelled) {
        agg.total += 1
        if (record.kit_to_line_picked_date_time) agg.picked += 1
        if (record.kit_to_line_kitted_date_time) agg.kitted += 1
      }
      if (record.kit_inspection_completion_date_time) agg.inspected = true
      if (record.kit_ready_on_dock_date_time) agg.onDock = true
      aggBySerialNumber.set(serialNumber, agg)
    }

    // Derive the granular current stage from aggregated progress. Falls back to
    // the stored status (pending / printed) when nothing has been picked yet.
    const deriveStage = (
      agg: StageAgg | undefined,
      rawStatus: string | null | undefined
    ): string => {
      if (agg) {
        if (agg.onDock || rawStatus === 'completed') return 'completed'
        if (agg.inspected) return 'kit_inspected'
        if (agg.total > 0 && agg.kitted === agg.total) return 'kit_built'
        if (agg.kitted > 0) return 'kitting'
        if (agg.total > 0 && agg.picked === agg.total) return 'picking_complete'
        if (agg.picked > 0) return 'picking'
      }
      return rawStatus ?? 'pending'
    }

    logger.log(
      '[KittingService] Unique records after grouping by kit_serial_number:',
      uniqueBySerialNumber.size
    )

    // Sort by priority if available, otherwise by creation date
    const uniqueRecords = Array.from(uniqueBySerialNumber.values()).sort(
      (a, b) => {
        if (a.kit_priority != null && b.kit_priority != null) {
          return a.kit_priority - b.kit_priority
        }
        if (a.kit_priority != null) return -1
        if (b.kit_priority != null) return 1
        const dateA = a.kit_added_create_date_time
          ? new Date(a.kit_added_create_date_time).getTime()
          : 0
        const dateB = b.kit_added_create_date_time
          ? new Date(b.kit_added_create_date_time).getTime()
          : 0
        return dateB - dateA
      }
    )

    // Fetch all active flags from kit_build_flags table
    // Use kit_serial_number for flag lookup (preferred) or fall back to kit_po_number
    const kitSerialNumbers = uniqueRecords
      .map((r) => r.kit_serial_number)
      .filter((sn): sn is string => sn !== null && sn !== undefined)

    const kitPoNumbers = uniqueRecords
      .map((r) => r.kit_po_number)
      .filter((po): po is string => po !== null && po !== undefined)

    type RawFlagRecord = {
      id: string
      kit_serial_number: string | null
      kit_po_number: string
      flag_type: 'purple' | 'orange' | 'red' | 'black'
      set_by_user: string | null
      set_date_time: string | null
      notes: string | null
    }

    let allFlags: RawFlagRecord[] = []
    // Fetch flags by kit_serial_number (preferred) with fallback to kit_po_number
    if (kitSerialNumbers.length > 0) {
      const { data: flagsData, error: flagsError } = await (
        db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
      )
        .select(
          'id, kit_serial_number, kit_po_number, flag_type, set_by_user, set_date_time, notes'
        )
        .in('kit_serial_number', kitSerialNumbers)
        .eq('is_active', true)
        .order('set_date_time', { ascending: false })

      if (flagsError) {
        // If kit_serial_number column doesn't exist, fall back to kit_po_number
        if (
          flagsError.message?.includes('kit_serial_number') ||
          flagsError.code === '42703'
        ) {
          logger.warn(
            '[KittingService] kit_build_flags table does not have kit_serial_number column, fetching by PO'
          )
          if (kitPoNumbers.length > 0) {
            const { data: fallbackData, error: fallbackError } = await (
              db.from('kit_build_flags') as ReturnType<
                (typeof supabase)['from']
              >
            )
              .select(
                'id, kit_po_number, flag_type, set_by_user, set_date_time, notes'
              )
              .in('kit_po_number', kitPoNumbers)
              .eq('is_active', true)
              .order('set_date_time', { ascending: false })

            if (!fallbackError && fallbackData) {
              allFlags = (fallbackData as unknown as RawFlagRecord[]) || []
            }
          }
        } else {
          logger.error('Error fetching active flags:', flagsError)
        }
      } else {
        allFlags = (flagsData as unknown as RawFlagRecord[]) || []
      }
    }

    // Group flags by kit_serial_number (preferred) or kit_po_number (fallback)
    const flagsBySerialNumber = new Map<string, RawFlagRecord[]>()
    const flagsByPO = new Map<string, RawFlagRecord[]>()
    for (const flag of allFlags) {
      // Prefer kit_serial_number for grouping
      if (flag.kit_serial_number) {
        const existing = flagsBySerialNumber.get(flag.kit_serial_number) || []
        existing.push(flag)
        flagsBySerialNumber.set(flag.kit_serial_number, existing)
      } else {
        // Fallback to kit_po_number
        const existing = flagsByPO.get(flag.kit_po_number) || []
        existing.push(flag)
        flagsByPO.set(flag.kit_po_number, existing)
      }
    }

    // Collect unique user IDs to fetch names (including flag users)
    const userIds = [
      ...new Set(
        [
          ...uniqueRecords.map((r) => r.kit_added_by_user),
          ...uniqueRecords.map((r) => r.kit_flag_set_by_user),
          ...uniqueRecords.map((r) => r.kit_flag_cleared_by_user),
          ...allFlags.map((f) => f.set_by_user),
        ].filter((id): id is string => id !== null && id !== undefined)
      ),
    ]

    // Fetch user names in bulk
    const userNameMap = new Map<string, string>()
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, full_name, first_name, last_name, email')
        .in('id', userIds)

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

    // Map records with user names and active flags
    return uniqueRecords.map((record, index) => {
      const kitSerialNumber =
        record.kit_serial_number || `N/A-${record.id.slice(0, 8)}`
      const kitPoNumber = record.kit_po_number || `N/A-${record.id.slice(0, 8)}`
      const kitNumber = record.kit_number || ''

      // Get flags by kit_serial_number first, then fall back to kit_po_number
      let flags: RawFlagRecord[] = []
      if (record.kit_serial_number) {
        flags = flagsBySerialNumber.get(record.kit_serial_number) || []
      }
      if (flags.length === 0 && record.kit_po_number) {
        flags = flagsByPO.get(record.kit_po_number) || []
      }

      return {
        id: record.id,
        kit_serial_number: kitSerialNumber, // PRIMARY KEY: Unique identifier for each kit build
        kit_po_number: kitPoNumber,
        kit_number: kitNumber,
        kit_priority: record.kit_priority ?? index + 1,
        kit_priority_change_count: record.kit_priority_change_count ?? 0,
        due_date: record.due_date ?? null,
        kit_added_by_user: record.kit_added_by_user ?? null,
        kit_added_by_user_name: record.kit_added_by_user
          ? userNameMap.get(record.kit_added_by_user) || null
          : null,
        kit_added_create_date_time: record.kit_added_create_date_time ?? null,
        kit_build_status: record.kit_build_status ?? null,
        // Derived current stage (Picking / Picking Complete / Kitting / …) for
        // the Status column. Raw kit_build_status is kept for tab/search logic.
        kit_stage_status: deriveStage(
          aggBySerialNumber.get(
            record.kit_serial_number || `__no_serial_${record.id}`
          ),
          record.kit_build_status
        ),
        engine_program: record.engine_program ?? null,
        authorized_ship_short_items: record.authorized_ship_short_items ?? [],
        // Multiple active flags
        active_flags: flags.map((f) => ({
          id: f.id,
          flagType: f.flag_type,
          setByUserName: f.set_by_user
            ? userNameMap.get(f.set_by_user) || null
            : null,
          setDateTime: f.set_date_time,
          notes: f.notes,
        })),
        // Legacy single flag fields (for backward compatibility)
        kit_flag_type: record.kit_flag_type ?? null,
        kit_flag_set_by_user: record.kit_flag_set_by_user ?? null,
        kit_flag_set_by_user_name: record.kit_flag_set_by_user
          ? userNameMap.get(record.kit_flag_set_by_user) || null
          : null,
        kit_flag_set_date_time: record.kit_flag_set_date_time ?? null,
        kit_flag_cleared_by_user: record.kit_flag_cleared_by_user ?? null,
        kit_flag_cleared_by_user_name: record.kit_flag_cleared_by_user
          ? userNameMap.get(record.kit_flag_cleared_by_user) || null
          : null,
        kit_flag_cleared_date_time: record.kit_flag_cleared_date_time ?? null,
      }
    })
  }

  /**
   * Update priorities using direct SQL increment (without RPC)
   * @param reorderedRows - Array of rows in new order (must include kit_serial_number for unique identification)
   * Note: This will fail silently if the kit_priority column doesn't exist yet
   */
  static async updatePrioritiesSimple(
    reorderedRows: Array<{
      id: string
      kit_serial_number: string
      kit_po_number: string
      kit_number: string
      kit_priority: number
    }>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get current user for tracking who changed the priority
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id

      // Find rows that actually changed position
      const changedRows = reorderedRows.filter((row, index) => {
        const newPriority = index + 1
        return row.kit_priority !== newPriority
      })

      if (changedRows.length === 0) {
        return { success: true } // No changes needed
      }

      // Update each changed record
      for (let i = 0; i < reorderedRows.length; i++) {
        const row = reorderedRows[i]
        const newPriority = i + 1
        const priorityChanged = row.kit_priority !== newPriority

        // First try to get current change count (might not exist)
        // Use kit_serial_number as the unique identifier
        let currentCount = 0
        try {
          const { data: currentData } = await (
            db.from(this.TABLE_NAME) as unknown as ReturnType<
              (typeof supabase)['from']
            >
          )
            .select('kit_priority_change_count')
            .eq('kit_serial_number', row.kit_serial_number)
            .limit(1)
            .single()

          currentCount =
            (currentData as { kit_priority_change_count?: number | null })
              ?.kit_priority_change_count ?? 0
        } catch {
          // Column might not exist, continue with count of 0
        }

        // Update all records with this kit_serial_number
        // This ensures we only update records for this specific kit build
        const updateData: Record<string, unknown> = {
          kit_priority: newPriority,
        }

        // Add optional fields if they might exist
        if (userId) {
          updateData.kit_priority_set_by_user = userId
        }

        // Only increment change count if priority actually changed
        if (priorityChanged) {
          updateData.kit_priority_change_count = currentCount + 1
        }

        // Use kit_serial_number as the unique identifier for this specific kit build
        const { error } = await (
          db.from(this.TABLE_NAME) as unknown as ReturnType<
            (typeof supabase)['from']
          >
        )
          .update(updateData)
          .eq('kit_serial_number', row.kit_serial_number)

        if (error) {
          // If the error is about missing columns, log but don't fail
          if (error.message?.includes('column') || error.code === '42703') {
            logger.warn('Priority columns may not exist yet:', error.message)
            return { success: true } // Treat as success since rows are reordered locally
          }
          logger.error(
            'Error updating priority for kit_serial_number:',
            row.kit_serial_number,
            error
          )
          return { success: false, error: error.message }
        }

        // Also update the corresponding Kanban task priority to keep in sync
        // Use kit_serial_number which is stored in the kanban tasks table
        if (row.kit_serial_number) {
          await KitKanbanService.updateTaskPriorityBySerialNumber(
            row.kit_serial_number,
            newPriority
          )
        }
      }

      return { success: true }
    } catch (err) {
      logger.error('Error in updatePrioritiesSimple:', err)
      return { success: true } // Return success to not block UI reordering
    }
  }

  /**
   * Subscribe to real-time changes on the table and kit_build_flags
   */
  static subscribeToChanges(callback: () => void) {
    return supabase
      .channel('rr_kitting_data_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: this.TABLE_NAME },
        () => callback()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'kit_build_flags' },
        () => callback()
      )
      .subscribe()
  }

  /**
   * Get detailed kit build plan data with all TO lines for production tracking
   * @param kitPoNumber - The Kit PO number
   * @param kitNumber - Optional Kit Number to uniquely identify kit when same PO has multiple kits
   */
  static async getKitBuildPlanDetails(
    kitPoNumber: string,
    kitNumber?: string
  ): Promise<{
    kitPoNumber: string
    kitBuildNumber: string
    kitSerialNumber: string
    engineProgram: string
    kitNumber: string
    deliverToPlant: string
    dueDate: string | null
    status: string
    priority: number
    addedBy: string | null
    addedAt: string | null
    toLines: Array<{
      id: string
      transferOrderNumber: string
      material: string
      materialDescription: string
      sourceStorageBin: string
      destStorageBin: string
      quantity: string
      picked: boolean
      pickedBy: string | null
      pickedAt: string | null
      kitted: boolean
      kittedBy: string | null
      kittedAt: string | null
      // Missing part tracking
      missingPartFlag: boolean
      missingPartPhotoUrl: string | null
      missingPartNotes: string | null
      // Per-line cancellation (migration 325)
      cancelled: boolean
      cancelledAt: string | null
      cancelledBy: string | null
      cancelledReason: string | null
    }>
    stages: Array<{
      id: string
      name: string
      status: 'pending' | 'in-progress' | 'completed'
      progress: number
      completedCount: number
      totalCount: number
    }>
    // Kit Flag fields
    flagType: 'purple' | 'orange' | 'red' | 'black' | null
    flagSetByUser: string | null
    flagSetByUserName: string | null
    flagSetDateTime: string | null
    flagClearedByUser: string | null
    flagClearedByUserName: string | null
    flagClearedDateTime: string | null
    // Kit cart color designator
    kitCartColor: string | null
    // Kit container type snapshot
    kitContainerType: string | null
    // Charge code snapshot
    chargeCode: string | null
    // INCORA and Ship Short items
    incoraItems: Array<{ lineNumber: number; value: string }>
    authorizedShipShortItems: Array<{
      lineNumber: number
      partNumber: string
      description: string
      authorizedBy?: string | null
    }>
  } | null> {
    // Build query - filter by kit_po_number and optionally by kit_number for unique identification
    let query = (
      db.from(this.TABLE_NAME) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .select('*')
      .eq('kit_po_number', kitPoNumber)

    // If kit_number is provided, filter by it to get the specific kit
    // This is critical when multiple kits share the same PO number
    if (kitNumber) {
      query = query.eq('kit_number', kitNumber)
    }

    const { data, error } = await query.order('created_at', { ascending: true })

    if (
      error ||
      !data ||
      (data as unknown as RRKittingDataRecord[]).length === 0
    ) {
      logger.error('Error fetching kit build plan details:', error)
      return null
    }

    const records = data as unknown as RRKittingDataRecord[]
    const firstRecord = records[0]

    // Calculate position-based priority to match Kitting Data Manager display
    // Fetch all unique kits sorted by kit_priority to determine position
    let positionPriority = 1
    try {
      const { data: allKits } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('kit_po_number, kit_number, kit_priority')
        .not('kit_priority', 'is', null)
        .order('kit_priority', { ascending: true })

      if (allKits) {
        // Group by PO + Kit Number to get unique kits
        const seenKits = new Set<string>()
        const sortedUniqueKits: string[] = []
        for (const kit of allKits as unknown as Array<{
          kit_po_number: string
          kit_number: string
          kit_priority: number
        }>) {
          const key = `${kit.kit_po_number}::${kit.kit_number || ''}`
          if (!seenKits.has(key)) {
            seenKits.add(key)
            sortedUniqueKits.push(key)
          }
        }
        // Find this kit's position (1-indexed)
        // Use the provided kitNumber if available, otherwise fall back to firstRecord.kit_number
        const targetKitNumber = kitNumber || firstRecord.kit_number || ''
        const thisKitKey = `${kitPoNumber}::${targetKitNumber}`
        const foundIndex = sortedUniqueKits.indexOf(thisKitKey)
        if (foundIndex >= 0) {
          positionPriority = foundIndex + 1
        }
      }
    } catch {
      // Fall back to database value if calculation fails
      positionPriority = firstRecord.kit_priority || 1
    }

    // Get user names for who added, picked, kitted, and flag operations
    const userIds = new Set<string>()
    records.forEach((r) => {
      if (r.kit_added_by_user) userIds.add(r.kit_added_by_user)
      if (r.kit_to_line_picked_by_user)
        userIds.add(r.kit_to_line_picked_by_user)
      if (r.kit_to_line_kitted_by_user)
        userIds.add(r.kit_to_line_kitted_by_user)
      if (r.kit_flag_set_by_user) userIds.add(r.kit_flag_set_by_user)
      if (r.kit_flag_cleared_by_user) userIds.add(r.kit_flag_cleared_by_user)
      if (r.cancelled_by_user) userIds.add(r.cancelled_by_user)
    })

    const userNameMap = new Map<string, string>()
    if (userIds.size > 0) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, full_name, first_name, last_name, email')
        .in('id', Array.from(userIds))

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

    // Build TO lines from records
    const toLines = records
      .filter((r) => r.transfer_order_number)
      .map((r) => ({
        id: r.id!,
        transferOrderNumber: r.transfer_order_number!,
        material: r.material || '',
        materialDescription: r.material_description || '',
        sourceStorageBin: r.source_storage_bin || '',
        destStorageBin: r.dest_storage_bin || '',
        quantity: r.source_target_qty || '0',
        picked: !!r.kit_to_line_picked_date_time,
        pickedBy: r.kit_to_line_picked_by_user
          ? userNameMap.get(r.kit_to_line_picked_by_user) || null
          : null,
        pickedAt: r.kit_to_line_picked_date_time || null,
        kitted: !!r.kit_to_line_kitted_date_time,
        kittedBy: r.kit_to_line_kitted_by_user
          ? userNameMap.get(r.kit_to_line_kitted_by_user) || null
          : null,
        kittedAt: r.kit_to_line_kitted_date_time || null,
        // Missing part tracking
        missingPartFlag: !!(r as any).missing_part_flag,
        missingPartPhotoUrl: (r as any).missing_part_photo_url || null,
        missingPartNotes: (r as any).missing_part_notes || null,
        // Per-line cancellation (migration 325). Cancelled lines stay
        // visible in the audit-trail TO Lines table but are excluded
        // from picking/kitting/total stage counts below.
        cancelled: !!r.cancelled,
        cancelledAt: r.cancelled_at || null,
        cancelledBy: r.cancelled_by_user
          ? userNameMap.get(r.cancelled_by_user) || null
          : null,
        cancelledReason: r.cancelled_reason || null,
      }))

    // Calculate stage progress — cancelled lines are excluded from
    // totals so a cancelled TO doesn't block the kit from advancing.
    // See [[Cancel-Kit-TO-Line]].
    const activeToLines = toLines.filter((t) => !t.cancelled)
    const totalLines = activeToLines.length || 1
    const pickedCount = activeToLines.filter((t) => t.picked).length
    const kittedCount = activeToLines.filter((t) => t.kitted).length
    const inspected = !!firstRecord.kit_inspection_completion_date_time
    const onDock = !!firstRecord.kit_ready_on_dock_date_time

    const getStageStatus = (
      completed: boolean,
      inProgress: boolean
    ): 'pending' | 'in-progress' | 'completed' => {
      if (completed) return 'completed'
      if (inProgress) return 'in-progress'
      return 'pending'
    }

    const stages = [
      {
        id: 'planning',
        name: 'Planning',
        status: getStageStatus(true, false),
        progress: 100,
        completedCount: 1,
        totalCount: 1,
      },
      {
        id: 'picking',
        name: 'Picking',
        status: getStageStatus(pickedCount === totalLines, pickedCount > 0),
        progress:
          totalLines > 0 ? Math.round((pickedCount / totalLines) * 100) : 0,
        completedCount: pickedCount,
        totalCount: totalLines,
      },
      {
        id: 'kitting',
        name: 'Kitting',
        status: getStageStatus(
          kittedCount === totalLines,
          kittedCount > 0 && pickedCount === totalLines
        ),
        progress:
          totalLines > 0 ? Math.round((kittedCount / totalLines) * 100) : 0,
        completedCount: kittedCount,
        totalCount: totalLines,
      },
      {
        id: 'inspection',
        name: 'Inspection',
        status: getStageStatus(
          inspected,
          kittedCount === totalLines && !inspected
        ),
        progress: inspected ? 100 : 0,
        completedCount: inspected ? 1 : 0,
        totalCount: 1,
      },
      {
        id: 'on-dock',
        name: 'On Dock',
        status: getStageStatus(onDock, inspected && !onDock),
        progress: onDock ? 100 : 0,
        completedCount: onDock ? 1 : 0,
        totalCount: 1,
      },
    ]

    return {
      kitPoNumber: firstRecord.kit_po_number,
      kitBuildNumber: firstRecord.kit_build_number,
      kitSerialNumber:
        ((firstRecord as unknown as Record<string, unknown>)
          .kit_serial_number as string) || '',
      engineProgram: firstRecord.engine_program,
      kitNumber: firstRecord.kit_number,
      deliverToPlant: firstRecord.deliver_to_plant,
      dueDate: firstRecord.due_date || null,
      status: firstRecord.kit_build_status || 'pending',
      priority: positionPriority,
      addedBy: firstRecord.kit_added_by_user
        ? userNameMap.get(firstRecord.kit_added_by_user) || null
        : null,
      addedAt: firstRecord.kit_added_create_date_time || null,
      toLines,
      stages,
      // Kit Flag fields
      flagType: firstRecord.kit_flag_type || null,
      flagSetByUser: firstRecord.kit_flag_set_by_user || null,
      flagSetByUserName: firstRecord.kit_flag_set_by_user
        ? userNameMap.get(firstRecord.kit_flag_set_by_user) || null
        : null,
      flagSetDateTime: firstRecord.kit_flag_set_date_time || null,
      flagClearedByUser: firstRecord.kit_flag_cleared_by_user || null,
      flagClearedByUserName: firstRecord.kit_flag_cleared_by_user
        ? userNameMap.get(firstRecord.kit_flag_cleared_by_user) || null
        : null,
      flagClearedDateTime: firstRecord.kit_flag_cleared_date_time || null,
      // Kit cart color
      kitCartColor: firstRecord.kit_cart_color || null,
      // Kit container type
      kitContainerType: firstRecord.kit_container_type || null,
      // Charge code
      chargeCode: firstRecord.charge_code || null,
      // INCORA and Ship Short items
      incoraItems:
        (firstRecord.incora_items as Array<{
          lineNumber: number
          value: string
        }>) || [],
      authorizedShipShortItems:
        (firstRecord.authorized_ship_short_items as Array<{
          lineNumber: number
          partNumber: string
          description: string
          authorizedBy?: string | null
        }>) || [],
    }
  }

  /**
   * Get detailed kit build plan data by kit_serial_number (PRIMARY KEY)
   * This is the preferred method as kit_serial_number uniquely identifies each kit build
   * @param kitSerialNumber - The Kit Serial Number (unique identifier)
   */
  static async getKitBuildPlanDetailsBySerialNumber(
    kitSerialNumber: string
  ): Promise<{
    kitPoNumber: string
    kitBuildNumber: string
    kitSerialNumber: string
    engineProgram: string
    kitNumber: string
    deliverToPlant: string
    dueDate: string | null
    status: string
    priority: number
    addedBy: string | null
    addedAt: string | null
    toLines: Array<{
      id: string
      transferOrderNumber: string
      material: string
      materialDescription: string
      sourceStorageBin: string
      destStorageBin: string
      quantity: string
      picked: boolean
      pickedBy: string | null
      pickedAt: string | null
      kitted: boolean
      kittedBy: string | null
      kittedAt: string | null
      missingPartFlag: boolean
      missingPartPhotoUrl: string | null
      missingPartNotes: string | null
      // Per-line cancellation (migration 325)
      cancelled: boolean
      cancelledAt: string | null
      cancelledBy: string | null
      cancelledReason: string | null
    }>
    stages: Array<{
      id: string
      name: string
      status: 'pending' | 'in-progress' | 'completed'
      progress: number
      completedCount: number
      totalCount: number
    }>
    flagType: 'purple' | 'orange' | 'red' | 'black' | null
    flagSetByUser: string | null
    flagSetByUserName: string | null
    flagSetDateTime: string | null
    flagClearedByUser: string | null
    flagClearedByUserName: string | null
    flagClearedDateTime: string | null
    kitCartColor: string | null
    kitContainerType: string | null
    chargeCode: string | null
    incoraItems: Array<{ lineNumber: number; value: string }>
    authorizedShipShortItems: Array<{
      lineNumber: number
      partNumber: string
      description: string
      authorizedBy?: string | null
    }>
  } | null> {
    // Query by kit_serial_number - unique identifier for each kit build
    const { data, error } = await (
      db.from(this.TABLE_NAME) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .select('*')
      .eq('kit_serial_number', kitSerialNumber)
      .order('created_at', { ascending: true })

    if (
      error ||
      !data ||
      (data as unknown as RRKittingDataRecord[]).length === 0
    ) {
      logger.error(
        'Error fetching kit build plan details by serial number:',
        error
      )
      return null
    }

    const records = data as unknown as RRKittingDataRecord[]
    const firstRecord = records[0]

    // Calculate position-based priority
    let positionPriority = 1
    try {
      const { data: allKits } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('kit_serial_number, kit_priority')
        .not('kit_priority', 'is', null)
        .order('kit_priority', { ascending: true })

      if (allKits) {
        const seenSerials = new Set<string>()
        const sortedUniqueKits: string[] = []
        for (const kit of allKits as unknown as Array<{
          kit_serial_number: string
          kit_priority: number
        }>) {
          if (
            kit.kit_serial_number &&
            !seenSerials.has(kit.kit_serial_number)
          ) {
            seenSerials.add(kit.kit_serial_number)
            sortedUniqueKits.push(kit.kit_serial_number)
          }
        }
        const foundIndex = sortedUniqueKits.indexOf(kitSerialNumber)
        if (foundIndex >= 0) {
          positionPriority = foundIndex + 1
        }
      }
    } catch {
      positionPriority = firstRecord.kit_priority || 1
    }

    // Get user names
    const userIds = new Set<string>()
    records.forEach((r) => {
      if (r.kit_added_by_user) userIds.add(r.kit_added_by_user)
      if (r.kit_to_line_picked_by_user)
        userIds.add(r.kit_to_line_picked_by_user)
      if (r.kit_to_line_kitted_by_user)
        userIds.add(r.kit_to_line_kitted_by_user)
      if (r.kit_flag_set_by_user) userIds.add(r.kit_flag_set_by_user)
      if (r.kit_flag_cleared_by_user) userIds.add(r.kit_flag_cleared_by_user)
      if (r.cancelled_by_user) userIds.add(r.cancelled_by_user)
    })

    const userNameMap = new Map<string, string>()
    if (userIds.size > 0) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, full_name, first_name, last_name, email')
        .in('id', Array.from(userIds))

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

    // Build TO lines
    const toLines = records
      .filter((r) => r.transfer_order_number)
      .map((r) => ({
        id: r.id!,
        transferOrderNumber: r.transfer_order_number!,
        material: r.material || '',
        materialDescription: r.material_description || '',
        sourceStorageBin: r.source_storage_bin || '',
        destStorageBin: r.dest_storage_bin || '',
        quantity: r.source_target_qty || '0',
        picked: !!r.kit_to_line_picked_date_time,
        pickedBy: r.kit_to_line_picked_by_user
          ? userNameMap.get(r.kit_to_line_picked_by_user) || null
          : null,
        pickedAt: r.kit_to_line_picked_date_time || null,
        kitted: !!r.kit_to_line_kitted_date_time,
        kittedBy: r.kit_to_line_kitted_by_user
          ? userNameMap.get(r.kit_to_line_kitted_by_user) || null
          : null,
        kittedAt: r.kit_to_line_kitted_date_time || null,
        missingPartFlag: !!(r as any).missing_part_flag,
        missingPartPhotoUrl: (r as any).missing_part_photo_url || null,
        missingPartNotes: (r as any).missing_part_notes || null,
        // Per-line cancellation (migration 325).
        cancelled: !!r.cancelled,
        cancelledAt: r.cancelled_at || null,
        cancelledBy: r.cancelled_by_user
          ? userNameMap.get(r.cancelled_by_user) || null
          : null,
        cancelledReason: r.cancelled_reason || null,
      }))

    // Calculate stages — cancelled lines are excluded from totals so a
    // cancelled TO doesn't block the kit from advancing through Picking
    // → Kitting → On Dock. The cancelled rows are still rendered in the
    // audit-trail table for traceability. See [[Cancel-Kit-TO-Line]].
    const activeToLines = toLines.filter((t) => !t.cancelled)
    const totalLines = activeToLines.length || 1
    const pickedCount = activeToLines.filter((t) => t.picked).length
    const kittedCount = activeToLines.filter((t) => t.kitted).length
    const inspected = !!firstRecord.kit_inspection_completion_date_time
    const onDock = !!firstRecord.kit_ready_on_dock_date_time

    const getStageStatus = (
      completed: boolean,
      inProgress: boolean
    ): 'pending' | 'in-progress' | 'completed' => {
      if (completed) return 'completed'
      if (inProgress) return 'in-progress'
      return 'pending'
    }

    const stages = [
      {
        id: 'planning',
        name: 'Planning',
        status: getStageStatus(true, false),
        progress: 100,
        completedCount: 1,
        totalCount: 1,
      },
      {
        id: 'picking',
        name: 'Picking',
        status: getStageStatus(pickedCount === totalLines, pickedCount > 0),
        progress:
          totalLines > 0 ? Math.round((pickedCount / totalLines) * 100) : 0,
        completedCount: pickedCount,
        totalCount: totalLines,
      },
      {
        id: 'kitting',
        name: 'Kitting',
        status: getStageStatus(
          kittedCount === totalLines,
          kittedCount > 0 && pickedCount === totalLines
        ),
        progress:
          totalLines > 0 ? Math.round((kittedCount / totalLines) * 100) : 0,
        completedCount: kittedCount,
        totalCount: totalLines,
      },
      {
        id: 'inspection',
        name: 'Inspection',
        status: getStageStatus(
          inspected,
          kittedCount === totalLines && !inspected
        ),
        progress: inspected ? 100 : 0,
        completedCount: inspected ? 1 : 0,
        totalCount: 1,
      },
      {
        id: 'on-dock',
        name: 'On Dock',
        status: getStageStatus(onDock, inspected && !onDock),
        progress: onDock ? 100 : 0,
        completedCount: onDock ? 1 : 0,
        totalCount: 1,
      },
    ]

    return {
      kitPoNumber: firstRecord.kit_po_number,
      kitBuildNumber: firstRecord.kit_build_number,
      kitSerialNumber:
        ((firstRecord as unknown as Record<string, unknown>)
          .kit_serial_number as string) || '',
      engineProgram: firstRecord.engine_program,
      kitNumber: firstRecord.kit_number,
      deliverToPlant: firstRecord.deliver_to_plant,
      dueDate: firstRecord.due_date || null,
      status: firstRecord.kit_build_status || 'pending',
      priority: positionPriority,
      addedBy: firstRecord.kit_added_by_user
        ? userNameMap.get(firstRecord.kit_added_by_user) || null
        : null,
      addedAt: firstRecord.kit_added_create_date_time || null,
      toLines,
      stages,
      flagType: firstRecord.kit_flag_type || null,
      flagSetByUser: firstRecord.kit_flag_set_by_user || null,
      flagSetByUserName: firstRecord.kit_flag_set_by_user
        ? userNameMap.get(firstRecord.kit_flag_set_by_user) || null
        : null,
      flagSetDateTime: firstRecord.kit_flag_set_date_time || null,
      flagClearedByUser: firstRecord.kit_flag_cleared_by_user || null,
      flagClearedByUserName: firstRecord.kit_flag_cleared_by_user
        ? userNameMap.get(firstRecord.kit_flag_cleared_by_user) || null
        : null,
      flagClearedDateTime: firstRecord.kit_flag_cleared_date_time || null,
      kitCartColor: firstRecord.kit_cart_color || null,
      kitContainerType: firstRecord.kit_container_type || null,
      chargeCode: firstRecord.charge_code || null,
      incoraItems:
        (firstRecord.incora_items as Array<{
          lineNumber: number
          value: string
        }>) || [],
      authorizedShipShortItems:
        (firstRecord.authorized_ship_short_items as Array<{
          lineNumber: number
          partNumber: string
          description: string
          authorizedBy?: string | null
        }>) || [],
    }
  }

  /**
   * Get active flags by kit_serial_number (PRIMARY KEY)
   * @param kitSerialNumber - The Kit Serial Number (unique identifier)
   */
  static async getActiveFlagsBySerialNumber(kitSerialNumber: string): Promise<
    Array<{
      id: string
      flagType: 'purple' | 'orange' | 'red' | 'black'
      setByUser: string | null
      setByUserName: string | null
      setDateTime: string | null
      notes: string | null
    }>
  > {
    try {
      const { data, error } = await (
        db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
      )
        .select(
          'id, kit_serial_number, flag_type, set_by_user, set_date_time, notes'
        )
        .eq('kit_serial_number', kitSerialNumber)
        .eq('is_active', true)
        .order('set_date_time', { ascending: false })

      if (error) {
        // If kit_serial_number column doesn't exist, return empty array
        if (
          error.message?.includes('kit_serial_number') ||
          error.code === '42703'
        ) {
          logger.warn(
            '[KittingService] kit_build_flags table does not have kit_serial_number column'
          )
          return []
        }
        logger.error('Error getting active flags by serial number:', error)
        return []
      }

      type FlagRecord = {
        id: string
        flag_type: 'purple' | 'orange' | 'red' | 'black'
        set_by_user: string | null
        set_date_time: string | null
        notes: string | null
      }

      const records = (data as unknown as FlagRecord[]) || []

      // Get user names
      const userIds = records
        .map((r) => r.set_by_user)
        .filter((id): id is string => id !== null)
      const userNameMap = new Map<string, string>()

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, full_name, first_name, last_name, email')
          .in('id', userIds)

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

      return records.map((record) => ({
        id: record.id,
        flagType: record.flag_type,
        setByUser: record.set_by_user,
        setByUserName: record.set_by_user
          ? userNameMap.get(record.set_by_user) || null
          : null,
        setDateTime: record.set_date_time,
        notes: record.notes,
      }))
    } catch (err) {
      logger.error('Error getting active flags by serial number:', err)
      return []
    }
  }

  /**
   * Add a flag by kit_serial_number (PRIMARY KEY)
   * @param kitSerialNumber - The Kit Serial Number (unique identifier)
   * @param flagType - The type of flag to add
   * @param notes - Optional notes for the flag
   */
  static async addFlagBySerialNumber(
    kitSerialNumber: string,
    flagType: 'purple' | 'orange' | 'red' | 'black',
    notes?: string
  ): Promise<{ success: boolean; flagId?: string; error?: string }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id

      if (!userId) {
        return { success: false, error: 'User not authenticated' }
      }

      // Check if this flag type already exists and is active
      const { data: existing } = await (
        db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
      )
        .select('id')
        .eq('kit_serial_number', kitSerialNumber)
        .eq('flag_type', flagType)
        .eq('is_active', true)
        .limit(1)

      if (existing && (existing as unknown as { id: string }[]).length > 0) {
        return {
          success: false,
          error: `${flagType} flag already exists for this kit`,
        }
      }

      // Get the kit_po_number for this kit (for backward compatibility)
      const { data: kitData } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('kit_po_number')
        .eq('kit_serial_number', kitSerialNumber)
        .limit(1)
        .single()

      const kitPoNumber =
        (kitData as unknown as { kit_po_number: string } | null)
          ?.kit_po_number || ''

      const { data, error } = await (
        db.from('kit_build_flags') as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .insert({
          kit_serial_number: kitSerialNumber,
          kit_po_number: kitPoNumber,
          flag_type: flagType,
          is_active: true,
          set_by_user: userId,
          set_date_time: new Date().toISOString(),
          notes: notes || null,
        } as never)
        .select('id')
        .single()

      if (error) {
        logger.error('Error adding flag by serial number:', error)
        return { success: false, error: error.message }
      }

      // Sync legacy flag field
      await this.syncLegacyFlagBySerialNumber(kitSerialNumber)

      logger.log(
        `[KittingService] Added ${flagType} flag to kit ${kitSerialNumber}`
      )
      return { success: true, flagId: (data as unknown as { id: string }).id }
    } catch (err) {
      logger.error('Error adding flag by serial number:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Sync legacy flag field for a kit by serial number
   */
  private static async syncLegacyFlagBySerialNumber(
    kitSerialNumber: string
  ): Promise<void> {
    try {
      const { data: activeFlags } = await (
        db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
      )
        .select('flag_type, set_by_user, set_date_time')
        .eq('kit_serial_number', kitSerialNumber)
        .eq('is_active', true)
        .order('set_date_time', { ascending: true })

      type ActiveFlag = {
        flag_type: 'purple' | 'orange' | 'red' | 'black'
        set_by_user: string | null
        set_date_time: string | null
      }

      const flags = (activeFlags as unknown as ActiveFlag[]) || []
      const priorityOrder = ['red', 'black', 'orange', 'purple'] as const
      let primaryFlag: ActiveFlag | null = null

      for (const priority of priorityOrder) {
        const found = flags.find((f) => f.flag_type === priority)
        if (found) {
          primaryFlag = found
          break
        }
      }

      if (primaryFlag) {
        await (
          db.from(this.TABLE_NAME) as unknown as ReturnType<
            (typeof supabase)['from']
          >
        )
          .update({
            kit_flag_type: primaryFlag.flag_type,
            kit_flag_set_by_user: primaryFlag.set_by_user,
            kit_flag_set_date_time: primaryFlag.set_date_time,
            kit_flag_cleared_by_user: null,
            kit_flag_cleared_date_time: null,
          } as Record<string, unknown>)
          .eq('kit_serial_number', kitSerialNumber)
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        await (
          db.from(this.TABLE_NAME) as unknown as ReturnType<
            (typeof supabase)['from']
          >
        )
          .update({
            kit_flag_type: null,
            kit_flag_cleared_by_user: user?.id || null,
            kit_flag_cleared_date_time: new Date().toISOString(),
          } as Record<string, unknown>)
          .eq('kit_serial_number', kitSerialNumber)
      }
    } catch (err) {
      logger.error('Error syncing legacy flag by serial number:', err)
    }
  }

  /**
   * Set a kit priority flag for all records with the given kit PO number
   * @param kitPoNumber - The kit PO number to flag
   * @param flagType - The type of flag to set (purple, orange, red, black)
   */
  static async setKitFlag(
    kitPoNumber: string,
    flagType: 'purple' | 'orange' | 'red' | 'black'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get current user for tracking who set the flag
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id

      if (!userId) {
        return { success: false, error: 'User not authenticated' }
      }

      const { error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .update({
          kit_flag_type: flagType,
          kit_flag_set_by_user: userId,
          kit_flag_set_date_time: new Date().toISOString(),
          // Clear the "cleared" fields when setting a new flag
          kit_flag_cleared_by_user: null,
          kit_flag_cleared_date_time: null,
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('kit_po_number', kitPoNumber)

      if (error) {
        logger.error('Error setting kit flag:', error)
        return { success: false, error: error.message }
      }

      logger.log(
        `[KittingService] Set ${flagType} flag on kit ${kitPoNumber} by user ${userId}`
      )
      return { success: true }
    } catch (err) {
      logger.error('Error setting kit flag:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Clear a kit priority flag for all records with the given kit PO number
   * @param kitPoNumber - The kit PO number to clear the flag from
   */
  static async clearKitFlag(
    kitPoNumber: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get current user for tracking who cleared the flag
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id

      if (!userId) {
        return { success: false, error: 'User not authenticated' }
      }

      const { error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .update({
          kit_flag_type: null,
          kit_flag_cleared_by_user: userId,
          kit_flag_cleared_date_time: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('kit_po_number', kitPoNumber)

      if (error) {
        logger.error('Error clearing kit flag:', error)
        return { success: false, error: error.message }
      }

      logger.log(
        `[KittingService] Cleared flag on kit ${kitPoNumber} by user ${userId}`
      )
      return { success: true }
    } catch (err) {
      logger.error('Error clearing kit flag:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Get the current flag status for a kit PO number
   * @param kitPoNumber - The kit PO number to get flag status for
   */
  static async getKitFlagStatus(kitPoNumber: string): Promise<{
    flagType: 'purple' | 'orange' | 'red' | 'black' | null
    setByUser: string | null
    setByUserName: string | null
    setDateTime: string | null
    clearedByUser: string | null
    clearedByUserName: string | null
    clearedDateTime: string | null
  } | null> {
    try {
      const { data, error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select(
          'kit_flag_type, kit_flag_set_by_user, kit_flag_set_date_time, kit_flag_cleared_by_user, kit_flag_cleared_date_time'
        )
        .eq('kit_po_number', kitPoNumber)
        .limit(1)
        .single()

      if (error || !data) {
        logger.error('Error getting kit flag status:', error)
        return null
      }

      const record = data as unknown as {
        kit_flag_type: 'purple' | 'orange' | 'red' | 'black' | null
        kit_flag_set_by_user: string | null
        kit_flag_set_date_time: string | null
        kit_flag_cleared_by_user: string | null
        kit_flag_cleared_date_time: string | null
      }

      // Fetch user names
      const userIds = [
        record.kit_flag_set_by_user,
        record.kit_flag_cleared_by_user,
      ].filter((id): id is string => id !== null)
      const userNameMap = new Map<string, string>()

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, full_name, first_name, last_name, email')
          .in('id', userIds)

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

      return {
        flagType: record.kit_flag_type,
        setByUser: record.kit_flag_set_by_user,
        setByUserName: record.kit_flag_set_by_user
          ? userNameMap.get(record.kit_flag_set_by_user) || null
          : null,
        setDateTime: record.kit_flag_set_date_time,
        clearedByUser: record.kit_flag_cleared_by_user,
        clearedByUserName: record.kit_flag_cleared_by_user
          ? userNameMap.get(record.kit_flag_cleared_by_user) || null
          : null,
        clearedDateTime: record.kit_flag_cleared_date_time,
      }
    } catch (err) {
      logger.error('Error getting kit flag status:', err)
      return null
    }
  }

  // ==================== MULTIPLE FLAGS SUPPORT ====================

  /**
   * Get all active flags for a kit PO number (from kit_build_flags table)
   * @param kitPoNumber - The kit PO number to get flags for
   * @param kitNumber - Optional Kit Number to uniquely identify kit when same PO has multiple kits
   */
  static async getActiveFlags(
    kitPoNumber: string,
    kitNumber?: string
  ): Promise<
    Array<{
      id: string
      flagType: 'purple' | 'orange' | 'red' | 'black'
      setByUser: string | null
      setByUserName: string | null
      setDateTime: string | null
      notes: string | null
    }>
  > {
    try {
      // Build query for active flags
      let query = (
        db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
      )
        .select('*')
        .eq('kit_po_number', kitPoNumber)
        .eq('is_active', true)

      // Filter by kit_number if provided and if the table supports it
      // Note: kit_build_flags may or may not have a kit_number column
      if (kitNumber) {
        query = query.eq('kit_number', kitNumber)
      }

      const { data, error } = await query.order('set_date_time', {
        ascending: false,
      })

      if (error) {
        // If error is about kit_number column not existing, retry without it
        if (error.message?.includes('kit_number') || error.code === '42703') {
          logger.warn(
            '[KittingService] kit_build_flags table does not have kit_number column, fetching by PO only'
          )
          const { data: fallbackData, error: fallbackError } = await (
            db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
          )
            .select('*')
            .eq('kit_po_number', kitPoNumber)
            .eq('is_active', true)
            .order('set_date_time', { ascending: false })

          if (fallbackError) {
            logger.error('Error getting active flags:', fallbackError)
            return []
          }

          type FlagRecord = {
            id: string
            flag_type: 'purple' | 'orange' | 'red' | 'black'
            set_by_user: string | null
            set_date_time: string | null
            notes: string | null
          }

          const fallbackRecords =
            (fallbackData as unknown as FlagRecord[]) || []

          // Get user names
          const userIds = fallbackRecords
            .map((r) => r.set_by_user)
            .filter((id): id is string => id !== null)

          const userNameMap = new Map<string, string>()
          if (userIds.length > 0) {
            const { data: profiles } = await supabase
              .from('user_profiles')
              .select('id, full_name, first_name, last_name, email')
              .in('id', userIds)

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

          return fallbackRecords.map((record) => ({
            id: record.id,
            flagType: record.flag_type,
            setByUser: record.set_by_user,
            setByUserName: record.set_by_user
              ? userNameMap.get(record.set_by_user) || null
              : null,
            setDateTime: record.set_date_time,
            notes: record.notes,
          }))
        }

        logger.error('Error getting active flags:', error)
        return []
      }

      type FlagRecord = {
        id: string
        flag_type: 'purple' | 'orange' | 'red' | 'black'
        set_by_user: string | null
        set_date_time: string | null
        notes: string | null
      }

      const records = (data as unknown as FlagRecord[]) || []

      // Get user names
      const userIds = records
        .map((r) => r.set_by_user)
        .filter((id): id is string => id !== null)

      const userNameMap = new Map<string, string>()
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, full_name, first_name, last_name, email')
          .in('id', userIds)

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

      return records.map((record) => ({
        id: record.id,
        flagType: record.flag_type,
        setByUser: record.set_by_user,
        setByUserName: record.set_by_user
          ? userNameMap.get(record.set_by_user) || null
          : null,
        setDateTime: record.set_date_time,
        notes: record.notes,
      }))
    } catch (err) {
      logger.error('Error getting active flags:', err)
      return []
    }
  }

  /**
   * Get all flags (active and cleared) for a kit PO number for history display
   * @param kitPoNumber - The kit PO number to get flag history for
   */
  static async getFlagHistory(kitPoNumber: string): Promise<
    Array<{
      id: string
      flagType: 'purple' | 'orange' | 'red' | 'black'
      isActive: boolean
      setByUser: string | null
      setByUserName: string | null
      setDateTime: string | null
      clearedByUser: string | null
      clearedByUserName: string | null
      clearedDateTime: string | null
      notes: string | null
    }>
  > {
    try {
      const { data, error } = await (
        db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
      )
        .select('*')
        .eq('kit_po_number', kitPoNumber)
        .order('set_date_time', { ascending: false })

      if (error) {
        logger.error('Error getting flag history:', error)
        return []
      }

      type FlagRecord = {
        id: string
        flag_type: 'purple' | 'orange' | 'red' | 'black'
        is_active: boolean
        set_by_user: string | null
        set_date_time: string | null
        cleared_by_user: string | null
        cleared_date_time: string | null
        notes: string | null
      }

      const records = (data as unknown as FlagRecord[]) || []

      // Get user names
      const userIds = [
        ...records.map((r) => r.set_by_user),
        ...records.map((r) => r.cleared_by_user),
      ].filter((id): id is string => id !== null)

      const userNameMap = new Map<string, string>()
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, full_name, first_name, last_name, email')
          .in('id', [...new Set(userIds)])

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

      return records.map((record) => ({
        id: record.id,
        flagType: record.flag_type,
        isActive: record.is_active,
        setByUser: record.set_by_user,
        setByUserName: record.set_by_user
          ? userNameMap.get(record.set_by_user) || null
          : null,
        setDateTime: record.set_date_time,
        clearedByUser: record.cleared_by_user,
        clearedByUserName: record.cleared_by_user
          ? userNameMap.get(record.cleared_by_user) || null
          : null,
        clearedDateTime: record.cleared_date_time,
        notes: record.notes,
      }))
    } catch (err) {
      logger.error('Error getting flag history:', err)
      return []
    }
  }

  /**
   * Add a new flag to a kit (multiple flags supported)
   * @param kitPoNumber - The kit PO number to add flag to
   * @param flagType - The type of flag to add
   * @param notes - Optional notes for the flag
   * @param kitNumber - Optional Kit Number for per-kit flag tracking
   */
  static async addFlag(
    kitPoNumber: string,
    flagType: 'purple' | 'orange' | 'red' | 'black',
    notes?: string,
    kitNumber?: string
  ): Promise<{ success: boolean; flagId?: string; error?: string }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id

      if (!userId) {
        return { success: false, error: 'User not authenticated' }
      }

      // Check if this flag type already exists and is active
      let existingQuery = (
        db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
      )
        .select('id')
        .eq('kit_po_number', kitPoNumber)
        .eq('flag_type', flagType)
        .eq('is_active', true)

      if (kitNumber) {
        existingQuery = existingQuery.eq('kit_number', kitNumber)
      }

      const { data: existing } = await existingQuery.limit(1)

      if (existing && (existing as unknown as { id: string }[]).length > 0) {
        return {
          success: false,
          error: `${flagType} flag already exists for this kit`,
        }
      }

      // Prepare insert data - include kit_number if provided
      const insertData: Record<string, unknown> = {
        kit_po_number: kitPoNumber,
        flag_type: flagType,
        is_active: true,
        set_by_user: userId,
        set_date_time: new Date().toISOString(),
        notes: notes || null,
      }

      if (kitNumber) {
        insertData.kit_number = kitNumber
      }

      const { data, error } = await (
        db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
      )
        .insert(insertData)
        .select('id')
        .single()

      if (error) {
        logger.error('Error adding flag:', error)
        return { success: false, error: error.message }
      }

      // Also update the legacy single flag field for backward compatibility (use first/primary flag)
      await this.syncLegacyFlag(kitPoNumber)

      logger.log(
        `[KittingService] Added ${flagType} flag to kit ${kitPoNumber}`
      )
      return { success: true, flagId: (data as unknown as { id: string }).id }
    } catch (err) {
      logger.error('Error adding flag:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Clear (deactivate) a specific flag
   * @param flagId - The ID of the flag to clear
   */
  static async clearFlagById(
    flagId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id

      if (!userId) {
        return { success: false, error: 'User not authenticated' }
      }

      // Get the flag to find kit_po_number for legacy sync
      const { data: flagData } = await (
        db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
      )
        .select('kit_po_number')
        .eq('id', flagId)
        .single()

      const { error } = await (
        db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
      )
        .update({
          is_active: false,
          cleared_by_user: userId,
          cleared_date_time: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('id', flagId)

      if (error) {
        logger.error('Error clearing flag:', error)
        return { success: false, error: error.message }
      }

      // Update legacy flag field
      if (flagData) {
        await this.syncLegacyFlag(
          (flagData as unknown as { kit_po_number: string }).kit_po_number
        )
      }

      logger.log(`[KittingService] Cleared flag ${flagId}`)
      return { success: true }
    } catch (err) {
      logger.error('Error clearing flag:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Clear all active flags of a specific type for a kit (PO scope).
   *
   * @deprecated Use {@link clearFlagByTypeBySerialNumber}. When two kits
   * share a PO this clears flags on both, which is wrong for floor SOP
   * (clearing a Black Hat on Gear Box 1 must NOT clear it on Gear Box 2).
   */
  static async clearFlagByType(
    kitPoNumber: string,
    flagType: 'purple' | 'orange' | 'red' | 'black'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id

      if (!userId) {
        return { success: false, error: 'User not authenticated' }
      }

      const { error } = await (
        db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
      )
        .update({
          is_active: false,
          cleared_by_user: userId,
          cleared_date_time: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('kit_po_number', kitPoNumber)
        .eq('flag_type', flagType)
        .eq('is_active', true)

      if (error) {
        logger.error('Error clearing flag by type:', error)
        return { success: false, error: error.message }
      }

      // Update legacy flag field
      await this.syncLegacyFlag(kitPoNumber)

      logger.log(
        `[KittingService] Cleared ${flagType} flag for kit ${kitPoNumber}`
      )
      return { success: true }
    } catch (err) {
      logger.error('Error clearing flag by type:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Clear all active flags of a specific type for a single kit serial.
   * Preferred over {@link clearFlagByType} — flags are per-kit-serial
   * post 303_kit_build_flags_serial_scope.
   */
  static async clearFlagByTypeBySerialNumber(
    kitSerialNumber: string,
    flagType: 'purple' | 'orange' | 'red' | 'black'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id

      if (!userId) {
        return { success: false, error: 'User not authenticated' }
      }

      const { error } = await (
        db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
      )
        .update({
          is_active: false,
          cleared_by_user: userId,
          cleared_date_time: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('kit_serial_number', kitSerialNumber)
        .eq('flag_type', flagType)
        .eq('is_active', true)

      if (error) {
        logger.error('Error clearing flag by type by serial number:', error)
        return { success: false, error: error.message }
      }

      await this.syncLegacyFlagBySerialNumber(kitSerialNumber)

      logger.log(
        `[KittingService] Cleared ${flagType} flag for kit ${kitSerialNumber}`
      )
      return { success: true }
    } catch (err) {
      logger.error('Error clearing flag by type by serial number:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Sync the legacy single flag field with the first active flag from kit_build_flags
   * This maintains backward compatibility with the original single-flag implementation
   */
  private static async syncLegacyFlag(kitPoNumber: string): Promise<void> {
    try {
      // Get the first active flag (by priority: red > black > orange > purple)
      const { data: activeFlags } = await (
        db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
      )
        .select('flag_type, set_by_user, set_date_time')
        .eq('kit_po_number', kitPoNumber)
        .eq('is_active', true)
        .order('set_date_time', { ascending: true })

      type ActiveFlag = {
        flag_type: 'purple' | 'orange' | 'red' | 'black'
        set_by_user: string | null
        set_date_time: string | null
      }

      const flags = (activeFlags as unknown as ActiveFlag[]) || []

      // Priority order: red > black > orange > purple
      const priorityOrder = ['red', 'black', 'orange', 'purple'] as const
      let primaryFlag: ActiveFlag | null = null

      for (const priority of priorityOrder) {
        const found = flags.find((f) => f.flag_type === priority)
        if (found) {
          primaryFlag = found
          break
        }
      }

      // Update the legacy fields
      if (primaryFlag) {
        await (
          db.from(this.TABLE_NAME) as unknown as ReturnType<
            (typeof supabase)['from']
          >
        )
          .update({
            kit_flag_type: primaryFlag.flag_type,
            kit_flag_set_by_user: primaryFlag.set_by_user,
            kit_flag_set_date_time: primaryFlag.set_date_time,
            kit_flag_cleared_by_user: null,
            kit_flag_cleared_date_time: null,
          } as Record<string, unknown>)
          .eq('kit_po_number', kitPoNumber)
      } else {
        // No active flags, clear the legacy field
        const {
          data: { user },
        } = await supabase.auth.getUser()
        await (
          db.from(this.TABLE_NAME) as unknown as ReturnType<
            (typeof supabase)['from']
          >
        )
          .update({
            kit_flag_type: null,
            kit_flag_cleared_by_user: user?.id || null,
            kit_flag_cleared_date_time: new Date().toISOString(),
          } as Record<string, unknown>)
          .eq('kit_po_number', kitPoNumber)
      }
    } catch (err) {
      logger.error('Error syncing legacy flag:', err)
    }
  }

  /**
   * Update the kit build status for all records with the given kit PO number
   * @param kitPoNumber - The kit PO number to update
   * @param newStatus - The new status value (e.g., 'pending', 'printed', 'in_progress', 'completed')
   */
  static async updateKitBuildStatus(
    kitPoNumber: string,
    newStatus: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .update({
          kit_build_status: newStatus,
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('kit_po_number', kitPoNumber)

      if (error) {
        logger.error('Error updating kit build status:', error)
        return { success: false, error: error.message }
      }

      logger.log(
        `[KittingService] Updated kit ${kitPoNumber} status to "${newStatus}"`
      )
      return { success: true }
    } catch (err) {
      logger.error('Error updating kit build status:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Update the kit printed tracking fields
   * @param kitPoNumber - The kit PO number to update
   */
  static async markKitAsPrinted(
    kitPoNumber: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id

      const { error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .update({
          kit_build_status: 'printed',
          kit_printed_by_user: userId || null,
          kit_printed_date_time: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('kit_po_number', kitPoNumber)

      if (error) {
        logger.error('Error marking kit as printed:', error)
        return { success: false, error: error.message }
      }

      logger.log(
        `[KittingService] Marked kit ${kitPoNumber} as printed by user ${userId}`
      )
      return { success: true }
    } catch (err) {
      logger.error('Error marking kit as printed:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Serial-scoped variant of {@link markKitAsPrinted}. Marks ONLY the
   * kit identified by `kit_serial_number` as printed. Required for
   * multi-kit POs — the PO-scoped variant flips every sibling kit on the
   * same PO to `printed` (see [[Kit-Serial-Scoping]]).
   */
  static async markKitAsPrintedBySerialNumber(
    kitSerialNumber: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id

      const { error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .update({
          kit_build_status: 'printed',
          kit_printed_by_user: userId || null,
          kit_printed_date_time: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('kit_serial_number', kitSerialNumber)

      if (error) {
        logger.error('Error marking kit as printed by serial number:', error)
        return { success: false, error: error.message }
      }

      logger.log(
        `[KittingService] Marked kit ${kitSerialNumber} as printed by user ${userId}`
      )
      return { success: true }
    } catch (err) {
      logger.error('Error marking kit as printed by serial number:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  // ==================== BUILD KIT TOOL METHODS ====================

  /**
   * Shape returned by both build-kit verification entry points.
   * Extracted to a named alias so the legacy PO-keyed
   * {@link verifyKitForBuild} and the new serial-keyed
   * {@link verifyKitForBuildBySerialNumber} stay symmetric, and so
   * the downstream Build Kit mutations
   * (`startKitBuild` / `kitMaterial` / `completeKitBuild`) can scope
   * by `kitSerialNumber` when present — see
   * [[Fix-Build-Kit-Completion-Multi-Kit-PO]] in the omniframe vault
   * for the regression that motivated exposing the serial here.
   */
  static buildKitToLineFromRecord(
    r: RRKittingDataRecord,
    userNameMap: Map<string, string>
  ) {
    return {
      id: r.id!,
      transferOrderNumber: r.transfer_order_number!,
      material: r.material || '',
      materialDescription: r.material_description || '',
      sourceStorageBin: r.source_storage_bin || '',
      destStorageBin: r.dest_storage_bin || '',
      quantity: parseFloat(r.source_target_qty || '0'),
      kitted: !!r.kit_to_line_kitted_date_time,
      kittedBy: r.kit_to_line_kitted_by_user
        ? userNameMap.get(r.kit_to_line_kitted_by_user) || null
        : null,
      kittedAt: r.kit_to_line_kitted_date_time || null,
    }
  }

  /**
   * Verify a Kit PO Number exists and is ready for kitting.
   *
   * Operators who scan a `kit_serial_number` (`KIT-YYYYMMDD-NNN`)
   * directly should call {@link verifyKitForBuildBySerialNumber}
   * instead — that path is a direct PK lookup on `RR_Kitting_DATA`
   * and never aggregates across sibling kits sharing a PO.
   *
   * Valid statuses for building: 'pending', 'printed', 'in_progress'.
   *
   * @param kitPoNumber - The Kit PO number to verify
   * @returns Kit data if found, with TO lines and their kitting status
   */
  static async verifyKitForBuild(
    kitPoNumber: string
  ): Promise<BuildKitVerifyResult> {
    try {
      const { data, error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('*')
        .eq('kit_po_number', kitPoNumber.trim())
        .order('created_at', { ascending: true })

      if (error) {
        logger.error('[BuildKit] Error verifying kit:', error)
        return { exists: false, error: error.message }
      }

      if (!data || (data as unknown as RRKittingDataRecord[]).length === 0) {
        return { exists: false, error: 'Kit PO Number not found' }
      }

      return this.assembleBuildKitPayload(
        data as unknown as RRKittingDataRecord[]
      )
    } catch (err) {
      logger.error('[BuildKit] Error verifying kit:', err)
      return {
        exists: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Direct-by-serial entry point for the RF Build Kit scan input.
   *
   * `kit_serial_number` is the globally unique PK on `RR_Kitting_DATA`
   * (format `KIT-YYYYMMDD-NNN`) so this path never silently aggregates
   * across sibling kits sharing a PO — the load is naturally per-kit.
   * Mirrors {@link RFKittingPickingService.verifyKitForPickingBySerialNumber}
   * shape so the smart-detect UX stays consistent across both RF flows.
   *
   * Valid statuses for building: 'pending', 'printed', 'in_progress'.
   *
   * @param kitSerialNumber - The kit serial number to verify (`KIT-YYYYMMDD-NNN`)
   * @returns Kit data if found, with TO lines and their kitting status
   */
  static async verifyKitForBuildBySerialNumber(
    kitSerialNumber: string
  ): Promise<BuildKitVerifyResult> {
    try {
      const serial = kitSerialNumber.trim()
      if (!serial) {
        return { exists: false, error: 'Kit serial number is required' }
      }

      const { data, error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('*')
        .eq('kit_serial_number', serial)
        .order('created_at', { ascending: true })

      if (error) {
        logger.error('[BuildKit] Error verifying kit by serial:', error)
        return { exists: false, error: error.message }
      }

      if (!data || (data as unknown as RRKittingDataRecord[]).length === 0) {
        return { exists: false, error: `Kit serial ${serial} not found` }
      }

      return this.assembleBuildKitPayload(
        data as unknown as RRKittingDataRecord[]
      )
    } catch (err) {
      logger.error('[BuildKit] Error verifying kit by serial:', err)
      return {
        exists: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Shared payload assembly for the build-kit entry points. Runs the
   * status sanity check, decorates kitted-by user names, and maps
   * records onto the public TO-line shape. Kept as a single source of
   * truth so the PO-path and serial-path behave identically once the
   * raw rows are loaded.
   */
  private static async assembleBuildKitPayload(
    records: RRKittingDataRecord[]
  ): Promise<BuildKitVerifyResult> {
    const firstRecord = records[0]

    const validStatuses = ['printed', 'in_progress', 'pending']
    if (
      firstRecord.kit_build_status &&
      !validStatuses.includes(firstRecord.kit_build_status)
    ) {
      return {
        exists: false,
        error: `Kit is in "${firstRecord.kit_build_status}" status and cannot be built`,
      }
    }

    const userIds = new Set<string>()
    records.forEach((r) => {
      if (r.kit_to_line_kitted_by_user)
        userIds.add(r.kit_to_line_kitted_by_user)
    })

    const userNameMap = new Map<string, string>()
    if (userIds.size > 0) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, full_name, first_name, last_name, email')
        .in('id', Array.from(userIds))

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

    const toLines = records
      .filter((r) => r.transfer_order_number)
      .map((r) => this.buildKitToLineFromRecord(r, userNameMap))

    const kittedLines = toLines.filter((t) => t.kitted).length

    return {
      exists: true,
      kitData: {
        kitPoNumber: firstRecord.kit_po_number,
        // `kit_serial_number` is the globally unique PK on
        // `RR_Kitting_DATA` (format `KIT-YYYYMMDD-NNN`) and is what
        // downstream Build Kit mutations now scope by so multi-kit POs
        // do not cross-link. May be null on legacy rows predating
        // `createKitBuildPlan`; callers fall back to PO-only behaviour
        // when it is missing.
        kitSerialNumber: firstRecord.kit_serial_number ?? null,
        kitBuildNumber: firstRecord.kit_build_number,
        kitNumber: firstRecord.kit_number,
        engineProgram: firstRecord.engine_program,
        deliverToPlant: firstRecord.deliver_to_plant,
        dueDate: firstRecord.due_date || null,
        status: firstRecord.kit_build_status || 'pending',
        totalLines: toLines.length,
        kittedLines,
        toLines,
      },
    }
  }

  /**
   * Mark a TO line as kitted
   * @param lineId - The ID of the TO line record
   * @returns Success status
   */
  static async markLineAsKitted(
    lineId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id

      // Read both kit_po_number and kit_serial_number for this line so
      // we can route the kanban sync through the per-serial path. This
      // mirrors the picking-side convention in
      // `markLinePicked` / `syncKitProgressFromSerial` and avoids
      // collapsing sibling kits sharing a PO into one kanban card.
      const { data: lineData, error: lineError } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('kit_po_number, kit_serial_number')
        .eq('id', lineId)
        .single()

      if (lineError || !lineData) {
        logger.error('[BuildKit] Could not find line:', lineError)
        return { success: false, error: 'Could not find the TO line' }
      }

      const { kit_po_number: kitPoNumber, kit_serial_number: kitSerialNumber } =
        lineData as unknown as {
          kit_po_number: string
          kit_serial_number: string | null
        }

      const { error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .update({
          kit_to_line_kitted_by_user: userId || null,
          kit_to_line_kitted_date_time: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('id', lineId)

      if (error) {
        logger.error('[BuildKit] Error marking line as kitted:', error)
        return { success: false, error: error.message }
      }

      logger.log(`[BuildKit] Marked line ${lineId} as kitted by user ${userId}`)

      if (kitSerialNumber) {
        await KitKanbanService.syncKitProgressFromSerial(kitSerialNumber)
      } else {
        // Legacy fallback for rows that predate the serial backfill.
        await KitKanbanService.syncKitProgressFromData(kitPoNumber)
      }

      return { success: true }
    } catch (err) {
      logger.error('[BuildKit] Error marking line as kitted:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Unmark a TO line as kitted (for corrections)
   * @param lineId - The ID of the TO line record
   * @returns Success status
   */
  static async unmarkLineAsKitted(
    lineId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: lineData, error: lineError } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('kit_po_number, kit_serial_number')
        .eq('id', lineId)
        .single()

      if (lineError || !lineData) {
        logger.error('[BuildKit] Could not find line:', lineError)
        return { success: false, error: 'Could not find the TO line' }
      }

      const { kit_po_number: kitPoNumber, kit_serial_number: kitSerialNumber } =
        lineData as unknown as {
          kit_po_number: string
          kit_serial_number: string | null
        }

      const { error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .update({
          kit_to_line_kitted_by_user: null,
          kit_to_line_kitted_date_time: null,
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('id', lineId)

      if (error) {
        logger.error('[BuildKit] Error unmarking line:', error)
        return { success: false, error: error.message }
      }

      logger.log(`[BuildKit] Unmarked line ${lineId} as kitted`)

      if (kitSerialNumber) {
        await KitKanbanService.syncKitProgressFromSerial(kitSerialNumber)
      } else {
        await KitKanbanService.syncKitProgressFromData(kitPoNumber)
      }

      return { success: true }
    } catch (err) {
      logger.error('[BuildKit] Error unmarking line:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Mark a material as kitted by material number (finds the TO line and marks it)
   * @param kitPoNumber - The Kit PO number
   * @param material - The material number being kitted
   * @param quantity - The quantity being verified
   * @returns The TO line that was kitted or error
   */
  static async kitMaterial(
    kitPoNumber: string,
    material: string,
    quantity: number,
    kitSerialNumber?: string | null
  ): Promise<{
    success: boolean
    kittedLine?: {
      id: string
      transferOrderNumber: string
      material: string
      materialDescription: string
      quantity: number
    }
    allLinesKitted?: boolean
    error?: string
  }> {
    try {
      // Scope by `kit_serial_number` when the caller supplied one — this
      // prevents the lookup from grabbing a same-material row that
      // belongs to a sibling kit sharing the PO (see
      // `Debug/Fix-Build-Kit-Completion-Multi-Kit-PO.md`). The PO
      // filter is retained for defence in depth + index reuse.
      const scopedSerial = kitSerialNumber?.trim() || null
      const trimmedMaterial = material.trim()

      let unkittedBuilder = (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('*')
        .eq('kit_po_number', kitPoNumber)
        .eq('material', trimmedMaterial)
      if (scopedSerial) {
        unkittedBuilder = unkittedBuilder.eq('kit_serial_number', scopedSerial)
      }
      const { data, error: fetchError } = await unkittedBuilder
        .is('kit_to_line_kitted_date_time', null)
        .limit(1)
        .single()

      if (fetchError || !data) {
        let kittedBuilder = (
          db.from(this.TABLE_NAME) as unknown as ReturnType<
            (typeof supabase)['from']
          >
        )
          .select('*')
          .eq('kit_po_number', kitPoNumber)
          .eq('material', trimmedMaterial)
        if (scopedSerial) {
          kittedBuilder = kittedBuilder.eq('kit_serial_number', scopedSerial)
        }
        const { data: kittedData } = await kittedBuilder

        if (
          kittedData &&
          (kittedData as unknown as RRKittingDataRecord[]).length > 0
        ) {
          const allKitted = (
            kittedData as unknown as RRKittingDataRecord[]
          ).every((r) => r.kit_to_line_kitted_date_time !== null)
          if (allKitted) {
            return {
              success: false,
              error: `Material ${material} is already fully kitted`,
            }
          }
        }

        return {
          success: false,
          error: `Material ${material} not found in this kit`,
        }
      }

      const record = data as unknown as RRKittingDataRecord

      const expectedQty = parseFloat(record.source_target_qty || '0')
      if (Math.abs(expectedQty - quantity) > 0.01) {
        return {
          success: false,
          error: `Quantity mismatch: expected ${expectedQty}, scanned ${quantity}`,
        }
      }

      const markResult = await this.markLineAsKitted(record.id!)
      if (!markResult.success) {
        return { success: false, error: markResult.error }
      }

      // `allLinesKitted` must be evaluated against the same kit-scope
      // the caller passed in — otherwise sibling kits sharing a PO
      // would suppress the auto-advance to the Complete screen, or
      // (worse) trigger it prematurely if the sibling happened to be
      // fully kitted.
      let allLinesBuilder = (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('kit_to_line_kitted_date_time')
        .eq('kit_po_number', kitPoNumber)
      if (scopedSerial) {
        allLinesBuilder = allLinesBuilder.eq('kit_serial_number', scopedSerial)
      }
      const { data: allLines } = await allLinesBuilder.not(
        'transfer_order_number',
        'is',
        null
      )

      const allLinesKitted = Boolean(
        allLines &&
        (
          allLines as unknown as Array<{
            kit_to_line_kitted_date_time: string | null
          }>
        ).every((line) => line.kit_to_line_kitted_date_time !== null)
      )

      return {
        success: true,
        kittedLine: {
          id: record.id!,
          transferOrderNumber: record.transfer_order_number!,
          material: record.material!,
          materialDescription: record.material_description || '',
          quantity: expectedQty,
        },
        allLinesKitted,
      }
    } catch (err) {
      logger.error('[BuildKit] Error kitting material:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Complete the kit build - sets status to 'kit_built'.
   *
   * THE FIX (see `Debug/Fix-Build-Kit-Completion-Multi-Kit-PO.md`):
   * when the caller supplies a `kitSerialNumber`, both the
   * "all lines kitted?" pre-check and the final status UPDATE are
   * scoped to that serial. Otherwise the PO-only behaviour is
   * preserved verbatim for backward compatibility with single-kit POs
   * and legacy callers. Operators scanning a serial on the RF form
   * (the common case post 2026-05-17 `verifyKitForBuildBySerialNumber`
   * roll-out) always have a serial in `kitData` — so the regression
   * that blocked the Complete button on PO `2010102616` (two kits,
   * `KIT-20260515-001` fully kitted, `KIT-20260515-002` partly
   * kitted) cannot recur.
   *
   * @param kitPoNumber - The Kit PO number to complete
   * @param kitSerialNumber - Optional kit serial — when present,
   *   restricts both the verification check and the status update to
   *   that single kit.
   * @returns Success status
   */
  static async completeKitBuild(
    kitPoNumber: string,
    kitSerialNumber?: string | null,
    options?: { skipInspection?: boolean }
  ): Promise<{
    success: boolean
    error?: string
    skippedInspection?: boolean
  }> {
    try {
      const scopedSerial = kitSerialNumber?.trim() || null
      const skipInspection = options?.skipInspection === true

      let verifyBuilder = (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('kit_to_line_kitted_date_time, transfer_order_number')
        .eq('kit_po_number', kitPoNumber)
      if (scopedSerial) {
        verifyBuilder = verifyBuilder.eq('kit_serial_number', scopedSerial)
      }
      const { data: allLines, error: fetchError } = await verifyBuilder.not(
        'transfer_order_number',
        'is',
        null
      )

      if (fetchError) {
        return { success: false, error: fetchError.message }
      }

      const lines = allLines as unknown as Array<{
        kit_to_line_kitted_date_time: string | null
        transfer_order_number: string
      }>
      const unkittedLines = lines.filter(
        (line) => line.kit_to_line_kitted_date_time === null
      )

      if (unkittedLines.length > 0) {
        return {
          success: false,
          error: `Cannot complete kit: ${unkittedLines.length} lines still need to be kitted`,
        }
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id

      // When the org has the kit_inspection_required workflow flag
      // OFF, the Inspection stage is bypassed and the kit lands on
      // status `kit_inspected` directly. The actual on-dock stamp
      // (`kit_ready_on_dock_*` + `kit_dock_location`) is now ALWAYS
      // captured by the RF Dock Staging flow regardless of inspection
      // mode — see
      // `memorybank/OmniFrame/Implementations/RF-Dock-Staging-Flow.md`
      // for the correction (decouples on-dock from the inspection
      // bypass that originally co-stamped them in
      // [[Optional-Kit-Inspection-Toggle]]). We still stamp the
      // inspection-completion columns here so the production-tracker
      // stage calculator stays coherent if an admin later flips the
      // workflow flag back on.
      const nowIso = new Date().toISOString()
      const updatePayload: Record<string, unknown> = skipInspection
        ? {
            kit_build_status: 'kit_inspected',
            kit_inspection_by_user: userId ?? null,
            kit_inspection_completion_date_time: nowIso,
            updated_at: nowIso,
          }
        : {
            kit_build_status: 'kit_built',
            updated_at: nowIso,
          }

      let updateBuilder = (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .update(updatePayload)
        .eq('kit_po_number', kitPoNumber)
      if (scopedSerial) {
        updateBuilder = updateBuilder.eq('kit_serial_number', scopedSerial)
      }
      const { error } = await updateBuilder

      if (error) {
        logger.error('[BuildKit] Error completing kit build:', error)
        return { success: false, error: error.message }
      }

      logger.log(
        `[BuildKit] Completed kit build for ${kitPoNumber}${
          scopedSerial ? ` (serial ${scopedSerial})` : ''
        } by user ${userId}${skipInspection ? ' (inspection bypassed; awaiting RF Dock Staging)' : ''}`
      )
      return { success: true, skippedInspection: skipInspection }
    } catch (err) {
      logger.error('[BuildKit] Error completing kit build:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Set kit status to in_progress when building starts.
   *
   * When `kitSerialNumber` is supplied, the UPDATE is scoped to that
   * serial so flipping one kit to `in_progress` cannot drag a sibling
   * kit sharing the PO into the same status. The PO-only fallback is
   * retained for backward compatibility with single-kit POs and
   * pre-serial legacy callers — see
   * `Debug/Fix-Build-Kit-Completion-Multi-Kit-PO.md` for context.
   *
   * @param kitPoNumber - The Kit PO number
   * @param kitSerialNumber - Optional kit serial — restricts the
   *   status flip to a single kit when present.
   * @returns Success status
   */
  static async startKitBuild(
    kitPoNumber: string,
    kitSerialNumber?: string | null
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const scopedSerial = kitSerialNumber?.trim() || null

      let updateBuilder = (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .update({
          kit_build_status: 'in_progress',
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('kit_po_number', kitPoNumber)
      if (scopedSerial) {
        updateBuilder = updateBuilder.eq('kit_serial_number', scopedSerial)
      }
      const { error } = await updateBuilder

      if (error) {
        logger.error('[BuildKit] Error starting kit build:', error)
        return { success: false, error: error.message }
      }

      logger.log(
        `[BuildKit] Started kit build for ${kitPoNumber}${
          scopedSerial ? ` (serial ${scopedSerial})` : ''
        }`
      )
      return { success: true }
    } catch (err) {
      logger.error('[BuildKit] Error starting kit build:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  // ==================== DOCK STAGING TOOL METHODS ====================

  /**
   * Verify a kit is ready to be staged on a dock.
   *
   * Dock-ready predicate:
   * - When the org has `kit_inspection_required = TRUE`, the kit must
   *   carry `kit_inspection_completion_date_time` (an inspector signed
   *   it off).
   * - When `kit_inspection_required = FALSE`, the kit must carry
   *   `kit_built_date_time` — i.e. all materials are kitted (the
   *   skip-inspection branch in {@link completeKitBuild} stamps
   *   `kit_inspection_completion_date_time` on the same UPDATE so this
   *   predicate is uniform across both modes; the on-dock stamp itself
   *   is now the responsibility of {@link stageKitToDock}).
   * - In both cases `kit_ready_on_dock_date_time` must NOT be set —
   *   re-staging an already-staged kit returns a friendly error
   *   pointing the operator at the existing dock location.
   *
   * Identification mirrors the picking/build entry points: pass either
   * `kitSerialNumber` for a direct PK lookup, or `kitPoNumber` for the
   * legacy PO path. When both are absent the call is rejected. When a
   * PO is supplied without a serial AND the PO covers more than one
   * dock-ready kit, the caller receives the same `kits` disambiguation
   * payload the picking flow uses so the form can render a picker.
   */
  static async verifyKitForDockStaging(input: {
    kitSerialNumber?: string | null
    kitPoNumber?: string | null
    kitInspectionRequired: boolean
  }): Promise<{
    success: boolean
    error?: string
    kitData?: {
      kitPoNumber: string
      kitSerialNumber: string
      kitBuildNumber: string
      kitNumber: string
      engineProgram: string
      deliverToPlant: string
      dueDate: string | null
      status: string
      kitDockLocation: string | null
    }
    kits?: Array<{
      kit_serial_number: string
      kit_number: string
      kit_build_status: string
      kit_build_number: string | null
    }>
  }> {
    try {
      const trimmedSerial = input.kitSerialNumber?.trim() || null
      const trimmedPo = input.kitPoNumber?.trim() || null

      if (!trimmedSerial && !trimmedPo) {
        return {
          success: false,
          error: 'Provide a kit serial number or kit PO number',
        }
      }

      // Resolve to a single serial (handle multi-kit-per-PO).
      let resolvedSerial = trimmedSerial

      if (!resolvedSerial && trimmedPo) {
        const { data: poRows, error: poError } = await (
          db.from(this.TABLE_NAME) as unknown as ReturnType<
            (typeof supabase)['from']
          >
        )
          .select(
            'kit_serial_number, kit_number, kit_build_status, kit_build_number'
          )
          .eq('kit_po_number', trimmedPo)

        if (poError) {
          return { success: false, error: poError.message }
        }

        const rows = (
          (poRows ?? []) as unknown as Array<{
            kit_serial_number: string | null
            kit_number: string | null
            kit_build_status: string | null
            kit_build_number: string | null
          }>
        ).filter((r) => r.kit_serial_number)

        if (rows.length === 0) {
          return { success: false, error: `Kit PO ${trimmedPo} not found` }
        }

        // Dedupe by serial — multiple TO rows per kit.
        const perSerial = new Map<
          string,
          {
            kit_serial_number: string
            kit_number: string
            kit_build_status: string
            kit_build_number: string | null
          }
        >()
        for (const r of rows) {
          if (!r.kit_serial_number || perSerial.has(r.kit_serial_number))
            continue
          perSerial.set(r.kit_serial_number, {
            kit_serial_number: r.kit_serial_number,
            kit_number: r.kit_number ?? '',
            kit_build_status: r.kit_build_status ?? '',
            kit_build_number: r.kit_build_number,
          })
        }

        if (perSerial.size > 1) {
          return {
            success: false,
            kits: Array.from(perSerial.values()),
          }
        }

        resolvedSerial = Array.from(perSerial.keys())[0] ?? null
      }

      if (!resolvedSerial) {
        return { success: false, error: 'Could not resolve kit serial number' }
      }

      const { data: rows, error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select(
          'kit_po_number, kit_serial_number, kit_build_number, kit_number, engine_program, deliver_to_plant, due_date, kit_build_status, kit_inspection_completion_date_time, kit_to_line_kitted_date_time, kit_ready_on_dock_date_time, kit_dock_location, transfer_order_number'
        )
        .eq('kit_serial_number', resolvedSerial)
        .order('created_at', { ascending: true })

      if (error) {
        logger.error('[DockStaging] Error verifying kit:', error)
        return { success: false, error: error.message }
      }

      const records = (rows ?? []) as unknown as Array<{
        kit_po_number: string
        kit_serial_number: string
        kit_build_number: string
        kit_number: string
        engine_program: string
        deliver_to_plant: string
        due_date: string | null
        kit_build_status: string | null
        kit_inspection_completion_date_time: string | null
        kit_to_line_kitted_date_time: string | null
        kit_ready_on_dock_date_time: string | null
        kit_dock_location: string | null
        transfer_order_number: string | null
      }>

      if (records.length === 0) {
        return {
          success: false,
          error: `Kit serial ${resolvedSerial} not found`,
        }
      }

      const first = records[0]

      if (first.kit_ready_on_dock_date_time) {
        const where = first.kit_dock_location
          ? `at ${first.kit_dock_location}`
          : 'on the dock'
        return {
          success: false,
          error: `Kit ${resolvedSerial} is already staged ${where}`,
        }
      }

      // Dock-ready predicate.
      if (input.kitInspectionRequired) {
        if (!first.kit_inspection_completion_date_time) {
          return {
            success: false,
            error: `Kit ${resolvedSerial} is not ready for dock staging — inspection has not been completed.`,
          }
        }
      } else {
        // Inspection bypassed for this org — require build completion
        // (every TO line kitted). The skip-inspection branch in
        // completeKitBuild stamps `kit_inspection_completion_date_time`
        // alongside `kit_inspected` status, so checking the inspection
        // column is also a sufficient proxy. We check both for
        // robustness against legacy rows.
        const linesWithTo = records.filter((r) => r.transfer_order_number)
        const hasUnkittedLine = linesWithTo.some(
          (r) => !r.kit_to_line_kitted_date_time
        )
        const buildComplete =
          !!first.kit_inspection_completion_date_time ||
          (linesWithTo.length > 0 && !hasUnkittedLine)
        if (!buildComplete) {
          return {
            success: false,
            error: `Kit ${resolvedSerial} is not ready for dock staging — build is not complete.`,
          }
        }
      }

      return {
        success: true,
        kitData: {
          kitPoNumber: first.kit_po_number,
          kitSerialNumber: first.kit_serial_number,
          kitBuildNumber: first.kit_build_number,
          kitNumber: first.kit_number,
          engineProgram: first.engine_program,
          deliverToPlant: first.deliver_to_plant,
          dueDate: first.due_date,
          status: first.kit_build_status ?? '',
          kitDockLocation: first.kit_dock_location,
        },
      }
    } catch (err) {
      logger.error('[DockStaging] Unexpected error verifying kit:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Stage a kit to a dock location.
   *
   * Single-kit-scoped UPDATE — keys on `kit_serial_number` PK so the
   * multi-kit-per-PO scoping fix from
   * `Debug/Fix-Build-Kit-Completion-Multi-Kit-PO.md` is preserved
   * (a PO-only UPDATE would stamp every sibling kit sharing the PO).
   *
   * Stamps `kit_ready_on_dock_date_time = NOW()`,
   * `kit_ready_on_dock_by_user = auth.uid()`,
   * `kit_dock_location = <scanned>`, and flips `kit_build_status` to
   * `'completed'` so "on dock = done" is the canonical invariant for
   * downstream consumers (the Kit Assembly Board lane derivation in
   * particular — see
   * [[Implementations/Kit-Kanban-Inspection-Aware-Progress-And-Dock-Completion]]).
   * After the UPDATE succeeds we kick the kanban sync helper so the
   * card immediately drops into the Completed lane on every open
   * board client (the kanban subscribes to postgres_changes on
   * `kit_kanban_tasks`, which is grandfathered by the Realtime Policy).
   *
   * Returns success or a typed error.
   */
  static async stageKitToDock(
    kitSerialNumber: string,
    dockLocation: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const serial = kitSerialNumber.trim()
      const location = dockLocation.trim()
      if (!serial) {
        return { success: false, error: 'Kit serial number is required' }
      }
      if (!location) {
        return { success: false, error: 'Dock location is required' }
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id ?? null

      const nowIso = new Date().toISOString()
      const { error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .update({
          kit_ready_on_dock_by_user: userId,
          kit_ready_on_dock_date_time: nowIso,
          kit_dock_location: location,
          kit_build_status: 'completed',
          updated_at: nowIso,
        } as Record<string, unknown>)
        .eq('kit_serial_number', serial)

      if (error) {
        logger.error('[DockStaging] Error staging kit to dock:', error)
        return { success: false, error: error.message }
      }

      logger.log(
        `[DockStaging] Staged kit ${serial} to dock ${location} by user ${userId}`
      )

      // Push the kanban card into the Completed lane immediately. The
      // sync helper is idempotent and serial-scoped — it never collapses
      // sibling kits sharing a PO (per
      // [[Fix-Build-Kit-Completion-Multi-Kit-PO]]).
      try {
        await KitKanbanService.syncKitProgressFromSerial(serial)
      } catch (syncErr) {
        // Non-fatal: the next `syncAllInProgressTasks` on board load will
        // catch up. Operator-visible state is already correct in the DB.
        logger.warn(
          '[DockStaging] kanban sync after stage failed (non-fatal):',
          syncErr
        )
      }

      return { success: true }
    } catch (err) {
      logger.error('[DockStaging] Unexpected error staging kit:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  // ==================== INSPECT KIT TOOL METHODS ====================

  /**
   * Verify a Kit PO Number exists and is ready for inspection
   * Kit must be in 'kit_built' status to be inspected
   * @param kitPoNumber - The Kit PO number to verify
   * @returns Kit data if found, with TO lines and their inspection status
   */
  static async verifyKitForInspection(kitPoNumber: string): Promise<{
    exists: boolean
    kitData?: {
      kitPoNumber: string
      kitBuildNumber: string
      kitNumber: string
      engineProgram: string
      deliverToPlant: string
      dueDate: string | null
      status: string
      totalLines: number
      inspectedLines: number
      toLines: Array<{
        id: string
        transferOrderNumber: string
        material: string
        materialDescription: string
        sourceStorageBin: string
        destStorageBin: string
        quantity: number
        kitted: boolean
        kittedBy: string | null
        kittedAt: string | null
        inspected: boolean
        inspectedBy: string | null
        inspectedAt: string | null
      }>
    }
    error?: string
  }> {
    try {
      const { data, error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('*')
        .eq('kit_po_number', kitPoNumber.trim())
        .order('created_at', { ascending: true })

      if (error) {
        logger.error('[InspectKit] Error verifying kit:', error)
        return { exists: false, error: error.message }
      }

      if (!data || (data as unknown as RRKittingDataRecord[]).length === 0) {
        return { exists: false, error: 'Kit PO Number not found' }
      }

      const records = data as unknown as RRKittingDataRecord[]
      const firstRecord = records[0]

      // Check if kit is in a valid status for inspection (kit_built)
      const validStatuses = ['kit_built', 'inspection_in_progress']
      if (
        firstRecord.kit_build_status &&
        !validStatuses.includes(firstRecord.kit_build_status)
      ) {
        return {
          exists: false,
          error: `Kit is in "${firstRecord.kit_build_status}" status. Kit must be "Kit Built" to be inspected.`,
        }
      }

      // Get user names for kitted by and inspected by users
      const userIds = new Set<string>()
      records.forEach((r) => {
        if (r.kit_to_line_kitted_by_user)
          userIds.add(r.kit_to_line_kitted_by_user)
        // Note: Using kit_inspection_by_user for per-line inspection tracking
        if (r.kit_inspection_by_user) userIds.add(r.kit_inspection_by_user)
      })

      const userNameMap = new Map<string, string>()
      if (userIds.size > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, full_name, first_name, last_name, email')
          .in('id', Array.from(userIds))

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

      // Build TO lines from records with inspection status
      // For inspection tracking per line, we'll use kit_inspection_by_user and kit_inspection_completion_date_time
      // at the record level (each TO line is a record)
      const toLines = records
        .filter((r) => r.transfer_order_number)
        .map((r) => ({
          id: r.id!,
          transferOrderNumber: r.transfer_order_number!,
          material: r.material || '',
          materialDescription: r.material_description || '',
          sourceStorageBin: r.source_storage_bin || '',
          destStorageBin: r.dest_storage_bin || '',
          quantity: parseFloat(r.source_target_qty || '0'),
          kitted: !!r.kit_to_line_kitted_date_time,
          kittedBy: r.kit_to_line_kitted_by_user
            ? userNameMap.get(r.kit_to_line_kitted_by_user) || null
            : null,
          kittedAt: r.kit_to_line_kitted_date_time || null,
          // For inspection, we track at the individual record/line level
          inspected: !!r.kit_inspection_completion_date_time,
          inspectedBy: r.kit_inspection_by_user
            ? userNameMap.get(r.kit_inspection_by_user) || null
            : null,
          inspectedAt: r.kit_inspection_completion_date_time || null,
        }))

      const inspectedLines = toLines.filter((t) => t.inspected).length

      return {
        exists: true,
        kitData: {
          kitPoNumber: firstRecord.kit_po_number,
          kitBuildNumber: firstRecord.kit_build_number,
          kitNumber: firstRecord.kit_number,
          engineProgram: firstRecord.engine_program,
          deliverToPlant: firstRecord.deliver_to_plant,
          dueDate: firstRecord.due_date || null,
          status: firstRecord.kit_build_status || 'kit_built',
          totalLines: toLines.length,
          inspectedLines,
          toLines,
        },
      }
    } catch (err) {
      logger.error('[InspectKit] Error verifying kit:', err)
      return {
        exists: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Mark a TO line as inspected (verified that part is in the kit)
   * @param lineId - The ID of the TO line record
   * @returns Success status
   */
  static async markLineAsInspected(
    lineId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id

      const { error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .update({
          kit_inspection_by_user: userId || null,
          kit_inspection_completion_date_time: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('id', lineId)

      if (error) {
        logger.error('[InspectKit] Error marking line as inspected:', error)
        return { success: false, error: error.message }
      }

      logger.log(
        `[InspectKit] Marked line ${lineId} as inspected by user ${userId}`
      )
      return { success: true }
    } catch (err) {
      logger.error('[InspectKit] Error marking line as inspected:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Unmark a TO line as inspected (for corrections)
   * @param lineId - The ID of the TO line record
   * @returns Success status
   */
  static async unmarkLineAsInspected(
    lineId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .update({
          kit_inspection_by_user: null,
          kit_inspection_completion_date_time: null,
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('id', lineId)

      if (error) {
        logger.error('[InspectKit] Error unmarking line:', error)
        return { success: false, error: error.message }
      }

      logger.log(`[InspectKit] Unmarked line ${lineId} as inspected`)
      return { success: true }
    } catch (err) {
      logger.error('[InspectKit] Error unmarking line:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Complete the kit inspection - sets status to 'kit_inspected'
   * All lines must be inspected before completion
   * @param kitPoNumber - The Kit PO number to complete inspection
   * @returns Success status
   */
  static async completeKitInspection(
    kitPoNumber: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // First verify all lines are inspected
      const { data: allLines, error: fetchError } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('kit_inspection_completion_date_time, transfer_order_number')
        .eq('kit_po_number', kitPoNumber)
        .not('transfer_order_number', 'is', null)

      if (fetchError) {
        return { success: false, error: fetchError.message }
      }

      const lines = allLines as unknown as Array<{
        kit_inspection_completion_date_time: string | null
        transfer_order_number: string
      }>
      const uninspectedLines = lines.filter(
        (line) => line.kit_inspection_completion_date_time === null
      )

      if (uninspectedLines.length > 0) {
        return {
          success: false,
          error: `Cannot complete inspection: ${uninspectedLines.length} lines still need to be verified`,
        }
      }

      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id

      // Update all records for this kit to 'kit_inspected' status
      const { error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .update({
          kit_build_status: 'kit_inspected',
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('kit_po_number', kitPoNumber)

      if (error) {
        logger.error('[InspectKit] Error completing kit inspection:', error)
        return { success: false, error: error.message }
      }

      logger.log(
        `[InspectKit] Completed kit inspection for ${kitPoNumber} by user ${userId}`
      )
      return { success: true }
    } catch (err) {
      logger.error('[InspectKit] Error completing kit inspection:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Set kit status to inspection_in_progress when inspection starts
   * @param kitPoNumber - The Kit PO number
   * @returns Success status
   */
  static async startKitInspection(
    kitPoNumber: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .update({
          kit_build_status: 'inspection_in_progress',
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('kit_po_number', kitPoNumber)

      if (error) {
        logger.error('[InspectKit] Error starting kit inspection:', error)
        return { success: false, error: error.message }
      }

      logger.log(`[InspectKit] Started kit inspection for ${kitPoNumber}`)
      return { success: true }
    } catch (err) {
      logger.error('[InspectKit] Error starting kit inspection:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  // ==================== BOM COVERAGE HELPERS ====================

  /**
   * Returns the structured list of BOM components that are currently
   * driving the Black Hat for a kit — i.e., not yet covered by an
   * imported TO row, INCORA item, or Authorized-to-Ship-Short entry.
   *
   * Used by the inline Black-Hat ship-short authorization panel inside
   * the Kit Build Audit Trail (Quick View) so the operator can see, and
   * authorize, each blocked component line by line instead of having to
   * read the comma-separated list off the flag's notes string.
   *
   * Mirrors the matching logic in `recheckBomCoverageBySerial` (the
   * function that *mutates* the flag) but does not write — pure read.
   * If they ever diverge, this is the bug.
   *
   * Resolves `kit_definition_id` from any TO row of the kit so the
   * caller only needs the kit's serial number. Returns an empty list
   * (with success=true) when the kit has no linked definition — there
   * is nothing to be Black-Hat about in that case.
   */
  static async getMissingBomComponentsBySerial(
    kitSerialNumber: string
  ): Promise<{
    success: boolean
    components: Array<{
      materialNumber: string
      materialDescription: string
      componentType: 'material' | 'incora_sub_kit' | 'incora_component'
      incoraReference: string | null
    }>
    kitDefinitionId: string | null
    error?: string
  }> {
    try {
      if (!kitSerialNumber.trim()) {
        return {
          success: false,
          components: [],
          kitDefinitionId: null,
          error: 'Kit serial number is required',
        }
      }

      const { data: kitRows, error: kitError } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select(
          'material, incora_items, authorized_ship_short_items, kit_definition_id'
        )
        .eq('kit_serial_number', kitSerialNumber)

      if (kitError) {
        return {
          success: false,
          components: [],
          kitDefinitionId: null,
          error: kitError.message,
        }
      }

      const allRows = (kitRows ?? []) as unknown as Array<{
        material: string | null
        incora_items: Array<{ lineNumber: number; value: string }> | null
        authorized_ship_short_items: Array<{
          lineNumber: number
          partNumber: string
          description: string
        }> | null
        kit_definition_id: string | null
      }>

      const firstRow = allRows[0]
      const kitDefinitionId = firstRow?.kit_definition_id ?? null

      if (!kitDefinitionId) {
        // No linked BOM — nothing to be Black-Hat about.
        return { success: true, components: [], kitDefinitionId: null }
      }

      const { data: defData, error: defError } = await (
        db.from('kit_definitions') as ReturnType<(typeof supabase)['from']>
      )
        .select('required_components')
        .eq('id', kitDefinitionId)
        .single()

      if (defError || !defData) {
        return {
          success: false,
          components: [],
          kitDefinitionId,
          error: 'Kit definition not found',
        }
      }

      const bom = ((defData as unknown as { required_components: unknown })
        .required_components ?? []) as Array<{
        componentType?: string
        coverageMode?: string
        materialNumber: string
        materialDescription: string
        requiredQuantity: number
        incoraReference?: string
        deviations?: Array<{
          substituteMaterialNumber: string
          substituteMaterialDescription: string
          notes?: string
        }>
      }>

      if (bom.length === 0) {
        return { success: true, components: [], kitDefinitionId }
      }

      const toMaterials = new Set(
        allRows
          .map((r) => (r.material ?? '').trim().toUpperCase())
          .filter(Boolean)
      )

      const incoraValues = new Set(
        (firstRow?.incora_items ?? [])
          .map((item) => (item.value ?? '').trim().toUpperCase())
          .filter(Boolean)
      )

      const shipShortPartNumbers = new Set(
        (firstRow?.authorized_ship_short_items ?? [])
          .map((item) => (item.partNumber ?? '').trim().toUpperCase())
          .filter(Boolean)
      )

      const unmatched = bom.filter((c) => {
        if (c.coverageMode === 'informational') return false

        if (c.componentType === 'incora_sub_kit') {
          const ref = (c.incoraReference ?? '').trim().toUpperCase()
          return !ref || !incoraValues.has(ref)
        }

        if (c.componentType === 'incora_component') {
          const primary = c.materialNumber.trim().toUpperCase()
          const ref = (c.incoraReference ?? '').trim().toUpperCase()
          const deviationNums = (c.deviations ?? []).map((d) =>
            d.substituteMaterialNumber.trim().toUpperCase()
          )
          const matAccept = [primary, ...deviationNums].filter(Boolean)
          const matMatch = matAccept.some((num) => toMaterials.has(num))
          const refMatch = !!ref && incoraValues.has(ref)
          const shipShortMatch = matAccept.some((num) =>
            shipShortPartNumbers.has(num)
          )
          return !(matMatch || refMatch || shipShortMatch)
        }

        const primary = c.materialNumber.trim().toUpperCase()
        const deviationNums = (c.deviations ?? []).map((d) =>
          d.substituteMaterialNumber.trim().toUpperCase()
        )
        const allAcceptable = [primary, ...deviationNums].filter(Boolean)
        const toMatch = allAcceptable.some((num) => toMaterials.has(num))
        const shipShortMatch = allAcceptable.some((num) =>
          shipShortPartNumbers.has(num)
        )
        return !(toMatch || shipShortMatch)
      })

      return {
        success: true,
        kitDefinitionId,
        components: unmatched.map((c) => ({
          materialNumber: c.materialNumber,
          materialDescription: c.materialDescription,
          componentType:
            (c.componentType as
              | 'material'
              | 'incora_sub_kit'
              | 'incora_component'
              | undefined) ?? 'material',
          incoraReference: c.incoraReference ?? null,
        })),
      }
    } catch (err) {
      logger.error(
        '[KittingService] getMissingBomComponentsBySerial error:',
        err
      )
      return {
        success: false,
        components: [],
        kitDefinitionId: null,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Recheck BOM coverage for an existing kit and auto-manage Black Hat flag.
   * Queries all TO rows for the kit, compares against the linked kit_definition BOM,
   * and sets or clears the Black Hat flag accordingly.
   *
   * Coverage rules:
   * - Informational rows are always treated as covered.
   * - Material rows match on primary materialNumber OR any deviation substitute.
   * - INCORA sub-kit rows match against runtime incora_items values.
   */
  static async recheckBomCoverageBySerial(
    kitSerialNumber: string,
    kitDefinitionId: string
  ): Promise<{ success: boolean; isComplete: boolean; error?: string }> {
    try {
      const { data: defData, error: defError } = await (
        db.from('kit_definitions') as ReturnType<(typeof supabase)['from']>
      )
        .select('required_components')
        .eq('id', kitDefinitionId)
        .single()

      if (defError || !defData) {
        return {
          success: false,
          isComplete: false,
          error: 'Kit definition not found',
        }
      }

      const bom = ((defData as unknown as { required_components: unknown })
        .required_components ?? []) as Array<{
        componentType?: string
        coverageMode?: string
        materialNumber: string
        materialDescription: string
        requiredQuantity: number
        incoraReference?: string
        deviations?: Array<{
          substituteMaterialNumber: string
          substituteMaterialDescription: string
          notes?: string
        }>
      }>

      if (bom.length === 0) {
        return { success: true, isComplete: true }
      }

      // Scope by kit_serial_number — the prior PO-scoped query merged
      // both kits' material lists when two kits shared a PO, so a Gear
      // Box 1 missing part was masked by a Gear Box 2 row that
      // happened to carry that material.
      const { data: kitRows, error: kitError } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select(
          'material, incora_items, authorized_ship_short_items, cancelled'
        )
        .eq('kit_serial_number', kitSerialNumber)

      if (kitError) {
        return { success: false, isComplete: false, error: kitError.message }
      }

      const allRows = (kitRows ?? []) as unknown as Array<{
        material: string | null
        incora_items: Array<{ lineNumber: number; value: string }> | null
        authorized_ship_short_items: Array<{
          lineNumber: number
          partNumber: string
          description: string
        }> | null
        cancelled: boolean | null
      }>

      // Cancelled lines do not deliver their material to the kit, so
      // they're excluded from the coverage set. Cancelling the only TO
      // for a required BOM material correctly leaves it uncovered (the
      // operator then has to re-add a TO via [[Add-TO-To-Clear-Black-Hat]]
      // or authorise it via [[Edit-Ship-Short-Post-Creation-Flow]]).
      const toMaterials = new Set(
        allRows
          .filter((r) => !r.cancelled)
          .map((r) => (r.material ?? '').trim().toUpperCase())
          .filter(Boolean)
      )

      const firstRow = allRows[0]
      const incoraValues = new Set(
        (firstRow?.incora_items ?? [])
          .map((item) => (item.value ?? '').trim().toUpperCase())
          .filter(Boolean)
      )
      // "Authorized to Ship Short" entries on the kit explicitly negate the
      // Black Hat for that BOM line — see add-kit-build-plan-dialog.tsx for
      // the matching frontend logic. Match on partNumber against BOM
      // primary materialNumber or any deviation substitute. Does not
      // apply to incora_sub_kit (no material number on those rows).
      const shipShortPartNumbers = new Set(
        (firstRow?.authorized_ship_short_items ?? [])
          .map((item) => (item.partNumber ?? '').trim().toUpperCase())
          .filter(Boolean)
      )

      const unmatched = bom.filter((c) => {
        if (c.coverageMode === 'informational') return false

        if (c.componentType === 'incora_sub_kit') {
          const ref = (c.incoraReference ?? '').trim().toUpperCase()
          return !ref || !incoraValues.has(ref)
        }

        if (c.componentType === 'incora_component') {
          const primary = c.materialNumber.trim().toUpperCase()
          const ref = (c.incoraReference ?? '').trim().toUpperCase()
          const deviationNums = (c.deviations ?? []).map((d) =>
            d.substituteMaterialNumber.trim().toUpperCase()
          )
          const matAccept = [primary, ...deviationNums].filter(Boolean)
          const matMatch = matAccept.some((num) => toMaterials.has(num))
          const refMatch = !!ref && incoraValues.has(ref)
          const shipShortMatch = matAccept.some((num) =>
            shipShortPartNumbers.has(num)
          )
          return !(matMatch || refMatch || shipShortMatch)
        }

        const primary = c.materialNumber.trim().toUpperCase()
        const deviationNums = (c.deviations ?? []).map((d) =>
          d.substituteMaterialNumber.trim().toUpperCase()
        )
        const allAcceptable = [primary, ...deviationNums].filter(Boolean)
        const toMatch = allAcceptable.some((num) => toMaterials.has(num))
        const shipShortMatch = allAcceptable.some((num) =>
          shipShortPartNumbers.has(num)
        )
        return !(toMatch || shipShortMatch)
      })

      if (unmatched.length > 0) {
        const missingList = unmatched
          .map((m) =>
            formatBomCoverageLabel({
              componentType: m.componentType as
                | 'material'
                | 'incora_sub_kit'
                | 'incora_component'
                | undefined,
              materialNumber: m.materialNumber,
              materialDescription: m.materialDescription,
              incoraReference: m.incoraReference,
            })
          )
          .join(', ')
        await this.addFlagBySerialNumber(
          kitSerialNumber,
          'black',
          `Auto-flagged: Missing BOM components — ${missingList}`
        )
        return { success: true, isComplete: false }
      } else {
        await this.clearFlagByTypeBySerialNumber(kitSerialNumber, 'black')
        return { success: true, isComplete: true }
      }
    } catch (err) {
      logger.error('[KittingService] recheckBomCoverageBySerial error:', err)
      return {
        success: false,
        isComplete: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Recheck BOM coverage scoped by Kit PO Number.
   *
   * @deprecated Use {@link recheckBomCoverageBySerial}. When a single PO
   * maps to multiple kit serials this fans out per-serial, but the call
   * graph should pass the serial directly so coverage state and Black
   * Hat fan-out stay per-kit.
   */
  static async recheckBomCoverage(
    kitPoNumber: string,
    kitDefinitionId: string
  ): Promise<{ success: boolean; isComplete: boolean; error?: string }> {
    try {
      const { data: rows, error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('kit_serial_number')
        .eq('kit_po_number', kitPoNumber)
        .not('kit_serial_number', 'is', null)

      if (error) {
        return { success: false, isComplete: false, error: error.message }
      }

      const serials = Array.from(
        new Set(
          ((rows ?? []) as unknown as { kit_serial_number: string | null }[])
            .map((r) => r.kit_serial_number)
            .filter((s): s is string => !!s)
        )
      )

      if (serials.length === 0) {
        return { success: true, isComplete: true }
      }

      let allComplete = true
      for (const serial of serials) {
        const result = await this.recheckBomCoverageBySerial(
          serial,
          kitDefinitionId
        )
        if (!result.success) {
          return result
        }
        if (!result.isComplete) {
          allComplete = false
        }
      }

      return { success: true, isComplete: allComplete }
    } catch (err) {
      logger.error('[KittingService] recheckBomCoverage error:', err)
      return {
        success: false,
        isComplete: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Append additional TOs to an existing kit build plan, then recheck BOM
   * coverage. Identification is by kit_serial_number (the unique kit
   * identity); a Kit PO Number is no longer sufficient because two
   * separate kits can share a PO (regression fix: 2026-05-12 KIT-001 /
   * KIT-002 cross-link).
   */
  static async appendTOsToKit(
    kitSerialNumber: string,
    importedTOs: Array<{
      destStorageBin: string
      transferOrderNumber: string
      sourceStorageType: string
      warehouseNumber: string
      destStorageType: string
      movementTypeIM: string
      movementTypeWM: string
      sourceStorageBin: string
      plant: string
      storageLocation: string
      material: string
      materialDescription: string
      batch: string
      sourceTargetQty: string
      creationDate: string
      creationTime: string
      user: string
      printer: string
      specialStockNumber: string
    }>
  ): Promise<{
    success: boolean
    insertedCount: number
    bomCoverageComplete?: boolean
    error?: string
  }> {
    try {
      if (!kitSerialNumber.trim()) {
        return {
          success: false,
          insertedCount: 0,
          error: 'Kit serial number is required',
        }
      }

      if (importedTOs.length === 0) {
        return { success: false, insertedCount: 0, error: 'No TOs provided' }
      }

      const { data: existingData, error: existingError } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select(
          'kit_build_number, kit_number, engine_program, deliver_to_plant, due_date, kit_po_number, kit_priority, kit_definition_id, kit_added_by_user, incora_items, authorized_ship_short_items, kanban_task_id, kit_container_type, charge_code'
        )
        .eq('kit_serial_number', kitSerialNumber)
        .limit(1)

      if (
        existingError ||
        !existingData ||
        (existingData as unknown[]).length === 0
      ) {
        return { success: false, insertedCount: 0, error: 'Kit not found' }
      }

      const first = (existingData as unknown as Record<string, unknown>[])[0]
      const kitPoNumber = first.kit_po_number as string

      // Skip TOs that this specific kit already has. Two kits sharing a
      // PO can each carry the same TO from SAP independently — duplicate
      // detection MUST stay scoped to the serial.
      const { data: existingTOs } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('transfer_order_number')
        .eq('kit_serial_number', kitSerialNumber)
        .not('transfer_order_number', 'is', null)

      const existingTONumbers = new Set(
        (
          (existingTOs ?? []) as unknown as { transfer_order_number: string }[]
        ).map((r) => r.transfer_order_number)
      )

      const newTOs = importedTOs.filter(
        (to) => !existingTONumbers.has(to.transferOrderNumber)
      )
      if (newTOs.length === 0) {
        return {
          success: true,
          insertedCount: 0,
          error: 'All TOs already exist for this kit',
        }
      }

      const records = newTOs.map((to) => ({
        kit_build_number: first.kit_build_number,
        kit_po_number: kitPoNumber,
        engine_program: first.engine_program,
        kit_number: first.kit_number,
        deliver_to_plant: first.deliver_to_plant,
        due_date: first.due_date,
        kit_serial_number: kitSerialNumber,
        kit_priority: first.kit_priority,
        kit_definition_id: first.kit_definition_id,
        kit_added_by_user: first.kit_added_by_user,
        kit_added_create_date_time: new Date().toISOString(),
        kit_build_status: 'pending',
        kit_priority_change_count: 0,
        incora_items: first.incora_items ?? [],
        authorized_ship_short_items: first.authorized_ship_short_items ?? [],
        kanban_task_id: first.kanban_task_id,
        kit_container_type: first.kit_container_type ?? null,
        charge_code: first.charge_code ?? null,
        dest_storage_bin: to.destStorageBin,
        transfer_order_number: to.transferOrderNumber,
        source_storage_type: to.sourceStorageType,
        warehouse_number: to.warehouseNumber,
        dest_storage_type: to.destStorageType,
        movement_type_im: to.movementTypeIM,
        movement_type_wm: to.movementTypeWM,
        source_storage_bin: to.sourceStorageBin,
        plant: to.plant,
        storage_location: to.storageLocation,
        material: to.material,
        material_description: to.materialDescription,
        batch: to.batch,
        source_target_qty: to.sourceTargetQty,
        creation_date: to.creationDate,
        creation_time: to.creationTime,
        user: to.user,
        printer: to.printer,
        special_stock_number: to.specialStockNumber,
      }))

      const { error: insertError } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      ).insert(records as never[])

      if (insertError) {
        logger.error(
          '[KittingService] appendTOsToKit insert error:',
          insertError
        )
        return { success: false, insertedCount: 0, error: insertError.message }
      }

      // Resync kanban totals for the specific kit, not the PO group.
      await KitKanbanService.syncKitProgressFromSerial(kitSerialNumber)

      let bomCoverageComplete: boolean | undefined
      const defId = first.kit_definition_id as string | null
      if (defId) {
        const coverageResult = await this.recheckBomCoverageBySerial(
          kitSerialNumber,
          defId
        )
        bomCoverageComplete = coverageResult.isComplete
      }

      return {
        success: true,
        insertedCount: newTOs.length,
        bomCoverageComplete,
      }
    } catch (err) {
      logger.error('[KittingService] appendTOsToKit error:', err)
      return {
        success: false,
        insertedCount: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Lookup helper: every active kit serial currently registered against
   * a Kit PO Number. Used by the Kitting Data Manager when an admin
   * action (e.g. Append TOs) is invoked with a PO and the UI needs to
   * disambiguate before calling a serial-scoped service method.
   */
  static async findKitSerialsByPoNumber(kitPoNumber: string): Promise<
    Array<{
      kitSerialNumber: string
      kitNumber: string | null
      kitBuildNumber: string | null
      kitBuildStatus: string | null
    }>
  > {
    try {
      const { data, error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select(
          'kit_serial_number, kit_number, kit_build_number, kit_build_status'
        )
        .eq('kit_po_number', kitPoNumber)
        .not('kit_serial_number', 'is', null)

      if (error) {
        logger.error('[KittingService] findKitSerialsByPoNumber error:', error)
        return []
      }

      const rows =
        (data as unknown as Array<{
          kit_serial_number: string | null
          kit_number: string | null
          kit_build_number: string | null
          kit_build_status: string | null
        }>) ?? []

      const seen = new Map<
        string,
        {
          kitSerialNumber: string
          kitNumber: string | null
          kitBuildNumber: string | null
          kitBuildStatus: string | null
        }
      >()
      for (const row of rows) {
        if (!row.kit_serial_number) continue
        if (seen.has(row.kit_serial_number)) continue
        seen.set(row.kit_serial_number, {
          kitSerialNumber: row.kit_serial_number,
          kitNumber: row.kit_number,
          kitBuildNumber: row.kit_build_number,
          kitBuildStatus: row.kit_build_status,
        })
      }

      return Array.from(seen.values())
    } catch (err) {
      logger.error('[KittingService] findKitSerialsByPoNumber error:', err)
      return []
    }
  }

  /**
   * Replace the `Authorized to Ship Short` list on an existing kit.
   *
   * - Writes the new array to **every** RR_Kitting_DATA row for the kit
   *   (the value is denormalised onto each TO row — see
   *   `appendTOsToKit` line ~4010 where new rows inherit it).
   * - Re-runs `recheckBomCoverage` if the kit is linked to a kit
   *   definition. Because authorized ship-short part numbers are now
   *   honoured by `recheckBomCoverage`, this can self-clear an
   *   auto-Black-Hat that was previously blocking RF picking.
   *
   * Items are sanitised: empty part numbers are dropped, line numbers
   * are renumbered 1..N, and the list is capped at 7 to match the
   * dialog input limit.
   */
  static async updateAuthorizedShipShortItems(
    kitSerialNumber: string,
    items: Array<{ partNumber: string; description?: string }>
  ): Promise<{
    success: boolean
    bomCoverageComplete?: boolean
    flagCleared?: boolean
    error?: string
  }> {
    try {
      if (!kitSerialNumber.trim()) {
        return { success: false, error: 'Kit serial number is required' }
      }

      // Sanitise + renumber + cap at 7 (matches dialog limit).
      const sanitised = items
        .map((item) => ({
          partNumber: item.partNumber.trim(),
          description: (item.description ?? '').trim(),
        }))
        .filter((item) => item.partNumber.length > 0)
        .slice(0, 7)
        .map((item, idx) => ({
          lineNumber: idx + 1,
          partNumber: item.partNumber,
          description: item.description,
        }))

      // Look up kit_po_number + kit_definition_id from any row for this
      // kit (the columns are snapshot-replicated across every row).
      const { data: existing, error: existingErr } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('kit_po_number, kit_definition_id, authorized_ship_short_items')
        .eq('kit_serial_number', kitSerialNumber)
        .limit(1)

      if (existingErr || !existing || (existing as unknown[]).length === 0) {
        return {
          success: false,
          error: existingErr?.message || 'Kit not found',
        }
      }

      const meta = (
        existing as unknown as Array<{
          kit_po_number: string
          kit_definition_id: string | null
          authorized_ship_short_items: Array<{
            partNumber?: string
            authorizedBy?: string | null
          }> | null
        }>
      )[0]

      // Stamp the authorizer. Preserve the original authorizer for parts that
      // were already on the list (so editing the list doesn't reattribute
      // someone else's authorization); stamp the current operator for any
      // newly-added parts.
      const priorAuthorizers = new Map<string, string | null>()
      for (const prior of meta.authorized_ship_short_items ?? []) {
        if (prior.partNumber?.trim()) {
          priorAuthorizers.set(
            prior.partNumber.trim().toLowerCase(),
            prior.authorizedBy ?? null
          )
        }
      }
      const currentAuthorizer = await this.getCurrentUserDisplayName()
      const sanitisedWithAuthorizer = sanitised.map((item) => ({
        ...item,
        authorizedBy:
          priorAuthorizers.get(item.partNumber.toLowerCase()) ??
          currentAuthorizer ??
          null,
      }))

      // Was a black-hat flag active before we did anything? Scope the
      // before/after probes by kit_serial_number — sibling kits sharing a
      // PO each carry their own flag now (post 303).
      const blackHatBefore = await (
        db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
      )
        .select('id')
        .eq('kit_serial_number', kitSerialNumber)
        .eq('flag_type', 'black')
        .eq('is_active', true)
        .limit(1)

      const { error: updateErr } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .update({
          authorized_ship_short_items: sanitisedWithAuthorizer,
        } as Record<string, unknown>)
        .eq('kit_serial_number', kitSerialNumber)

      if (updateErr) {
        logger.error(
          '[KittingService] updateAuthorizedShipShortItems update error:',
          updateErr
        )
        return { success: false, error: updateErr.message }
      }

      let bomCoverageComplete: boolean | undefined
      if (meta.kit_definition_id) {
        const coverageResult = await this.recheckBomCoverageBySerial(
          kitSerialNumber,
          meta.kit_definition_id
        )
        bomCoverageComplete = coverageResult.isComplete
      }

      const blackHatAfter = await (
        db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
      )
        .select('id')
        .eq('kit_serial_number', kitSerialNumber)
        .eq('flag_type', 'black')
        .eq('is_active', true)
        .limit(1)

      const flagCleared = (blackHatBefore.data as { id: string }[] | null)
        ?.length
        ? !(blackHatAfter.data as { id: string }[] | null)?.length
        : false

      logger.log(
        `[KittingService] Updated ship-short for kit ${kitSerialNumber}: ${sanitised.length} item(s)`
      )

      return {
        success: true,
        bomCoverageComplete,
        flagCleared,
      }
    } catch (err) {
      logger.error(
        '[KittingService] updateAuthorizedShipShortItems error:',
        err
      )
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Add a single expedite line to the kit build plan.
   *
   * Two modes:
   * - **Append to existing kit:** If `kitPoNumber` matches a kit, the expedite
   *   row inherits that kit's serial number / build number / kit number /
   *   kit_definition_id / kanban_task_id and is shown alongside its TO lines.
   * - **Stand-alone expedite:** If no `kitPoNumber` provided (or it does not
   *   match an existing kit), a new RR_Kitting_DATA row is created with its
   *   own kit serial number and a fresh kanban card so the expedite is still
   *   tracked on the Kit Assembly Board.
   */
  static async addExpediteToKit(input: {
    kitPoNumber?: string
    partNumber: string
    description?: string
    quantity?: number
    deliveryTime: ExpediteDeliveryTime
    reasonCode?: string
    requestedByDate?: Date
    // Optional source Transfer Order number (set when the expedite is created
    // from an imported TO row) — stored for traceability.
    transferOrderNumber?: string
  }): Promise<{
    success: boolean
    recordId?: string
    error?: string
  }> {
    try {
      if (!input.partNumber.trim()) {
        return { success: false, error: 'Part number is required' }
      }
      if (!input.deliveryTime) {
        return { success: false, error: 'Delivery time is required' }
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id ?? null

      const formattedRequestedDate = input.requestedByDate
        ? input.requestedByDate.toISOString().split('T')[0]
        : null

      const expediteFields: Record<string, unknown> = {
        part_expedite_part_number: input.partNumber.trim(),
        part_expedite_description: input.description?.trim() || null,
        part_expedite_quantity:
          input.quantity != null && Number.isFinite(input.quantity)
            ? input.quantity
            : null,
        part_expedite_delivery_time: input.deliveryTime,
        part_expedite_request_reason_code: input.reasonCode?.trim() || null,
        part_expedite_request_by_user: userId,
        part_expedite_request_create_date_time: new Date().toISOString(),
        part_expedite_requested_by_date: formattedRequestedDate,
      }

      const targetKitPo = input.kitPoNumber?.trim() || ''

      // Mode 1: Append to existing kit if PO is provided and exists
      if (targetKitPo) {
        const { data: existingData, error: existingError } = await (
          db.from(this.TABLE_NAME) as unknown as ReturnType<
            (typeof supabase)['from']
          >
        )
          .select(
            'kit_build_number, kit_number, engine_program, deliver_to_plant, due_date, kit_serial_number, kit_priority, kit_definition_id, kanban_task_id, kit_container_type, charge_code, kit_cart_color'
          )
          .eq('kit_po_number', targetKitPo)
          .limit(1)

        if (existingError) {
          logger.error(
            '[KittingService] addExpediteToKit lookup error:',
            existingError
          )
          return { success: false, error: existingError.message }
        }

        const existingRows =
          (existingData as unknown as Record<string, unknown>[] | null) ?? []

        if (existingRows.length > 0) {
          const first = existingRows[0]

          const record: Record<string, unknown> = {
            kit_build_number: first.kit_build_number,
            kit_po_number: targetKitPo,
            engine_program: first.engine_program,
            kit_number: first.kit_number,
            deliver_to_plant: first.deliver_to_plant,
            due_date: first.due_date,
            kit_serial_number: first.kit_serial_number,
            kit_priority: first.kit_priority,
            kit_definition_id: first.kit_definition_id,
            kanban_task_id: first.kanban_task_id,
            kit_container_type: first.kit_container_type ?? null,
            charge_code: first.charge_code ?? null,
            kit_cart_color: first.kit_cart_color ?? null,
            kit_added_by_user: userId,
            kit_added_create_date_time: new Date().toISOString(),
            kit_build_status: 'pending',
            kit_priority_change_count: 0,
            material: input.partNumber.trim(),
            material_description: input.description?.trim() || null,
            source_target_qty:
              input.quantity != null && Number.isFinite(input.quantity)
                ? String(input.quantity)
                : null,
            ...expediteFields,
          }

          const { data, error } = await (
            db.from(this.TABLE_NAME) as unknown as ReturnType<
              (typeof supabase)['from']
            >
          )
            .insert([record] as never[])
            .select('id')
            .single()

          if (error) {
            logger.error(
              '[KittingService] addExpediteToKit insert error:',
              error
            )
            return { success: false, error: error.message }
          }

          await KitKanbanService.syncKitProgressFromData(targetKitPo)

          return {
            success: true,
            recordId: (data as unknown as { id: string } | null)?.id,
          }
        }
      }

      // Mode 2: Stand-alone expedite (no matching kit, or no PO supplied).
      // Create a self-contained RR_Kitting_DATA row + kanban card.
      const kitSerialNumber = await this.generateKitSerialNumber()
      const nextPriority = await this.getNextPriority()
      const standalonePoNumber = targetKitPo || `EXP-${kitSerialNumber}`
      const standaloneBuildNumber = `EXP-${kitSerialNumber}`
      const standaloneKitNumber = input.partNumber.trim()

      const standaloneRecord: Record<string, unknown> = {
        kit_build_number: standaloneBuildNumber,
        kit_po_number: standalonePoNumber,
        engine_program: 'EXPEDITE',
        kit_number: standaloneKitNumber,
        deliver_to_plant: 'Expedite Queue',
        due_date: formattedRequestedDate,
        kit_serial_number: kitSerialNumber,
        kit_priority: nextPriority,
        kit_priority_change_count: 0,
        kit_added_by_user: userId,
        kit_added_create_date_time: new Date().toISOString(),
        kit_build_status: 'pending',
        material: input.partNumber.trim(),
        material_description: input.description?.trim() || null,
        transfer_order_number: input.transferOrderNumber?.trim() || null,
        source_target_qty:
          input.quantity != null && Number.isFinite(input.quantity)
            ? String(input.quantity)
            : null,
        incora_items: [],
        authorized_ship_short_items: [],
        ...expediteFields,
      }

      const { data: insertedData, error: insertError } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .insert([standaloneRecord] as never[])
        .select('id')
        .single()

      if (insertError) {
        logger.error(
          '[KittingService] addExpediteToKit standalone insert error:',
          insertError
        )
        return { success: false, error: insertError.message }
      }

      const insertedId =
        (insertedData as unknown as { id: string } | null)?.id ?? ''

      const kanbanResult = await KitKanbanService.createTask({
        kitSerialNumber,
        kitPoNumber: standalonePoNumber,
        kitNumber: standaloneKitNumber,
        kitBuildNumber: standaloneBuildNumber,
        kitBuildPlanId: insertedId,
        priority: nextPriority,
        totalToLines: 1,
        dueDate: formattedRequestedDate || undefined,
      })

      if (kanbanResult.success && kanbanResult.taskId && insertedId) {
        await (
          db.from(this.TABLE_NAME) as unknown as ReturnType<
            (typeof supabase)['from']
          >
        )
          .update({ kanban_task_id: kanbanResult.taskId } as Record<
            string,
            unknown
          >)
          .eq('id', insertedId)
      }

      return { success: true, recordId: insertedId }
    } catch (err) {
      logger.error('[KittingService] addExpediteToKit error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Create one STAND-ALONE expedite per imported Transfer Order row. Each TO
   * row becomes its own expedite part (material → part number, qty → quantity,
   * TO number stored for traceability), sharing the same delivery-time
   * priority / reason / requested-by date. Used by the "Add Expedite Part"
   * dialog's TO-import flow.
   *
   * Reuses `addExpediteToKit` per row (sequentially, so each call's serial
   * generation sees the prior insert). Returns counts so the caller can toast
   * a summary.
   */
  static async addExpeditePartsFromTOs(
    records: Array<{
      material?: string
      materialDescription?: string
      sourceTargetQty?: string
      transferOrderNumber?: string
    }>,
    shared: {
      deliveryTime: ExpediteDeliveryTime
      reasonCode?: string
      requestedByDate?: Date
    }
  ): Promise<{
    success: boolean
    created: number
    failed: number
    error?: string
  }> {
    let created = 0
    let failed = 0
    let firstError: string | undefined

    for (const record of records) {
      const partNumber = record.material?.trim()
      if (!partNumber) {
        failed++
        continue
      }

      const parsedQty = record.sourceTargetQty
        ? Number(record.sourceTargetQty)
        : undefined
      const quantity =
        parsedQty != null && Number.isFinite(parsedQty) ? parsedQty : undefined

      const result = await this.addExpediteToKit({
        partNumber,
        description: record.materialDescription?.trim() || undefined,
        quantity,
        deliveryTime: shared.deliveryTime,
        reasonCode: shared.reasonCode,
        requestedByDate: shared.requestedByDate,
        transferOrderNumber: record.transferOrderNumber?.trim() || undefined,
      })

      if (result.success) {
        created++
      } else {
        failed++
        firstError = firstError ?? result.error
      }
    }

    return {
      success: created > 0,
      created,
      failed,
      error: created === 0 ? firstError : undefined,
    }
  }

  /**
   * Cancel a single Transfer Order line on a kit. Marks the row with
   * `cancelled = true` plus the operator's actor / timestamp / reason
   * so the audit-trail dialog can render the cancellation visibly and
   * the stage-gating + BOM coverage paths can exclude it.
   *
   * The DB CHECK constraint `rr_kitting_data_cancellation_invariants`
   * requires all four cancellation columns be populated together with a
   * non-empty reason — this method enforces that contract on the
   * client side too so a missing-reason call fails fast with a useful
   * error rather than the constraint violation message.
   *
   * Caller is responsible for:
   *   1. Stamping a `kit_notes` system note (event_kind =
   *      'to_line_cancelled') so the cancellation appears in the audit
   *      trail thread. The Kit Build Audit Trail dialog wires this via
   *      its `addSystemNote` hook to keep the message surface
   *      consistent with the existing flag / ship-short events.
   *   2. Re-running BOM coverage / kanban progress sync (caller can
   *      invoke `recheckBomCoverageBySerial` + `KitKanbanService.syncKitProgressFromData`).
   *      Both are intentionally NOT called here so the dialog can decide
   *      whether to surface "Black Hat re-raised because cancelled
   *      material was the only TO" feedback.
   *
   * See migration 325 + [[Cancel-Kit-TO-Line]].
   */
  static async cancelTOLine(
    toLineId: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> {
    const trimmed = reason.trim()
    if (!toLineId) {
      return { success: false, error: 'Missing TO line id' }
    }
    if (!trimmed) {
      return {
        success: false,
        error: 'A cancellation reason is required',
      }
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        return { success: false, error: 'Not authenticated' }
      }

      // Cast through `unknown` so the new columns (added by migration
      // 325 — not yet in `database.types.ts`) type-check. Same pattern
      // used elsewhere in this service for `missing_part_flag` etc.
      const { error } = await (
        db.from(this.TABLE_NAME) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .update({
          cancelled: true,
          cancelled_at: new Date().toISOString(),
          cancelled_by_user: user.id,
          cancelled_reason: trimmed,
        } as unknown as Record<string, unknown>)
        .eq('id', toLineId)

      if (error) {
        logger.error('[KittingService] cancelTOLine error:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (err) {
      logger.error('[KittingService] cancelTOLine exception:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }
}

// Created and developed by Jai Singh
