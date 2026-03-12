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
import { supabase } from './client'
import { KitKanbanService } from './kit-kanban.service'

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

  // Part Expedite Fields
  part_expedite_part_number?: string
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
  }>
  // BOM linkage
  kitDefinitionId?: string
  bomCoverage?: {
    matched: Array<{
      materialNumber: string
      materialDescription: string
      requiredQuantity: number
    }>
    unmatched: Array<{
      materialNumber: string
      materialDescription: string
      requiredQuantity: number
    }>
    isComplete: boolean
  }
}

// Type-safe wrapper for the supabase client to handle tables not in generated types
const db = supabase as ReturnType<(typeof supabase)['from']> & {
  from: (table: string) => ReturnType<(typeof supabase)['from']>
}

export class RRKittingDataService {
  private static readonly TABLE_NAME = 'RR_Kitting_DATA'

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
    // Get the current user
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const userId = user?.id

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
      authorized_ship_short_items:
        input.authorizedShipShortItems &&
        input.authorizedShipShortItems.length > 0
          ? input.authorizedShipShortItems
          : [],
    }

    if (input.kitDefinitionId) {
      baseRecord.kit_definition_id = input.kitDefinitionId
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
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .insert(records as unknown[])
        .select('id')

      if (error) {
        logger.error('Error inserting kit build plan records:', error)
        return { success: false, recordCount: 0, error: error.message }
      }

      // Get the first record ID for kanban linking
      if (data && (data as { id: string }[]).length > 0) {
        firstRecordId = (data as { id: string }[])[0].id
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

      // Update the records with the kanban task ID
      if (kanbanResult.success && kanbanResult.taskId && firstRecordId) {
        await (
          db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
        )
          .update({ kanban_task_id: kanbanResult.taskId } as Record<
            string,
            unknown
          >)
          .eq('kit_po_number', input.kitPoNumber)
      } else if (!kanbanResult.success) {
        // Log kanban task creation failure but don't fail the overall operation
        // The kit build plan records are already saved
        logger.warn(
          `[KittingService] Kanban task creation failed for kit ${input.kitPoNumber}: ${kanbanResult.error}`
        )
      }

      // Auto-flag Black Hat if BOM coverage is incomplete
      if (
        input.bomCoverage &&
        !input.bomCoverage.isComplete &&
        input.bomCoverage.unmatched.length > 0
      ) {
        const missingList = input.bomCoverage.unmatched
          .map((m) => `${m.materialNumber} (${m.materialDescription})`)
          .join(', ')
        await this.addFlag(
          input.kitPoNumber,
          'black',
          `Auto-flagged: Missing BOM materials — ${missingList}`
        )
        logger.log(
          `[KittingService] Auto-flagged Black Hat for kit ${input.kitPoNumber}: ${input.bomCoverage.unmatched.length} missing materials`
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
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .insert([baseRecord] as unknown[])
        .select('id')

      if (error) {
        logger.error('Error inserting kit build plan record:', error)
        return { success: false, recordCount: 0, error: error.message }
      }

      // Get the record ID for kanban linking
      if (data && (data as { id: string }[]).length > 0) {
        firstRecordId = (data as { id: string }[])[0].id
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
          db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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

      // Auto-flag Black Hat if BOM coverage is incomplete
      if (
        input.bomCoverage &&
        !input.bomCoverage.isComplete &&
        input.bomCoverage.unmatched.length > 0
      ) {
        const missingList = input.bomCoverage.unmatched
          .map((m) => `${m.materialNumber} (${m.materialDescription})`)
          .join(', ')
        await this.addFlag(
          input.kitPoNumber,
          'black',
          `Auto-flagged: Missing BOM materials — ${missingList}`
        )
        logger.log(
          `[KittingService] Auto-flagged Black Hat for kit ${input.kitPoNumber}: ${input.bomCoverage.unmatched.length} missing materials`
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
      db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
    )
      .select('kit_serial_number')
      .like('kit_serial_number', `${prefix}%`)
      .order('kit_serial_number', { ascending: false })
      .limit(1)

    let nextNumber = 1
    if (data && (data as { kit_serial_number: string }[]).length > 0) {
      const lastSerial = (data as { kit_serial_number: string }[])[0]
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
      db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
    )
      .select('kit_priority')
      .not('kit_priority', 'is', null)
      .order('kit_priority', { ascending: false })
      .limit(1)

    if (data && (data as { kit_priority: number }[]).length > 0) {
      return (data as { kit_priority: number }[])[0].kit_priority + 1
    }

    return 1
  }

  /**
   * Get all kit build plan records
   */
  static async getAll(): Promise<RRKittingDataRecord[]> {
    const { data, error } = await (
      db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
    )
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      logger.error('Error fetching kit build plan records:', error)
      return []
    }

    return (data as RRKittingDataRecord[]) || []
  }

  /**
   * Get records by kit build number
   */
  static async getByKitBuildNumber(
    kitBuildNumber: string
  ): Promise<RRKittingDataRecord[]> {
    const { data, error } = await (
      db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
    )
      .select('*')
      .eq('kit_build_number', kitBuildNumber)
      .order('created_at', { ascending: false })

    if (error) {
      logger.error('Error fetching records by kit build number:', error)
      return []
    }

    return (data as RRKittingDataRecord[]) || []
  }

  /**
   * Update kit build status
   */
  static async updateStatus(
    id: string,
    status: string
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await (
      db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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
      db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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
      db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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
   * Get statistics for the dashboard
   */
  static async getStatistics(): Promise<{
    totalRecords: number
    pendingCount: number
    inProgressCount: number
    completedCount: number
  }> {
    const { data, error } = await (
      db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
    ).select('kit_build_status')

    if (error) {
      logger.error('Error fetching statistics:', error)
      return {
        totalRecords: 0,
        pendingCount: 0,
        inProgressCount: 0,
        completedCount: 0,
      }
    }

    const records = (data as Array<{ kit_build_status: string | null }>) || []
    return {
      totalRecords: records.length,
      pendingCount: records.filter((r) => r.kit_build_status === 'pending')
        .length,
      inProgressCount: records.filter(
        (r) => r.kit_build_status === 'in_progress'
      ).length,
      completedCount: records.filter((r) => r.kit_build_status === 'completed')
        .length,
    }
  }

  /**
   * Get unique kit records for grid display (grouped by kit_po_number)
   * Records are ordered by kit_priority (ascending), with priority being the row position
   */
  static async getKitGridData(): Promise<KitGridRecord[]> {
    // Fetch main kitting data
    const { data, error } = await (
      db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
    )
      .select('*')
      .order('kit_added_create_date_time', { ascending: false })

    if (error) {
      logger.error('Error fetching kit grid data:', error)
      return []
    }

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
      // Kit Flag fields (legacy)
      kit_flag_type?: 'purple' | 'orange' | 'red' | 'black' | null
      kit_flag_set_by_user?: string | null
      kit_flag_set_date_time?: string | null
      kit_flag_cleared_by_user?: string | null
      kit_flag_cleared_date_time?: string | null
    }

    const records = (data as RawKitRecord[]) || []

    logger.log('[KittingService] Fetched records:', records.length)

    // Group by kit_serial_number (unique identifier for each kit build)
    // This ensures each kit build is treated as its own entity, even with same PO number
    const uniqueBySerialNumber = new Map<string, RawKitRecord>()
    for (const record of records) {
      // Use kit_serial_number as the unique key - it's generated uniquely for each kit build
      const serialNumber =
        record.kit_serial_number || `__no_serial_${record.id}`
      if (!uniqueBySerialNumber.has(serialNumber)) {
        uniqueBySerialNumber.set(serialNumber, record)
      }
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
            db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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
          db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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
    // INCORA and Ship Short items
    incoraItems: Array<{ lineNumber: number; value: string }>
    authorizedShipShortItems: Array<{
      lineNumber: number
      partNumber: string
      description: string
    }>
  } | null> {
    // Build query - filter by kit_po_number and optionally by kit_number for unique identification
    let query = (
      db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
    )
      .select('*')
      .eq('kit_po_number', kitPoNumber)

    // If kit_number is provided, filter by it to get the specific kit
    // This is critical when multiple kits share the same PO number
    if (kitNumber) {
      query = query.eq('kit_number', kitNumber)
    }

    const { data, error } = await query.order('created_at', { ascending: true })

    if (error || !data || (data as RRKittingDataRecord[]).length === 0) {
      logger.error('Error fetching kit build plan details:', error)
      return null
    }

    const records = data as RRKittingDataRecord[]
    const firstRecord = records[0]

    // Calculate position-based priority to match Kitting Data Manager display
    // Fetch all unique kits sorted by kit_priority to determine position
    let positionPriority = 1
    try {
      const { data: allKits } = await (
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .select('kit_po_number, kit_number, kit_priority')
        .not('kit_priority', 'is', null)
        .order('kit_priority', { ascending: true })

      if (allKits) {
        // Group by PO + Kit Number to get unique kits
        const seenKits = new Set<string>()
        const sortedUniqueKits: string[] = []
        for (const kit of allKits as Array<{
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
      }))

    // Calculate stage progress
    const totalLines = toLines.length || 1
    const pickedCount = toLines.filter((t) => t.picked).length
    const kittedCount = toLines.filter((t) => t.kitted).length
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
    incoraItems: Array<{ lineNumber: number; value: string }>
    authorizedShipShortItems: Array<{
      lineNumber: number
      partNumber: string
      description: string
    }>
  } | null> {
    // Query by kit_serial_number - unique identifier for each kit build
    const { data, error } = await (
      db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
    )
      .select('*')
      .eq('kit_serial_number', kitSerialNumber)
      .order('created_at', { ascending: true })

    if (error || !data || (data as RRKittingDataRecord[]).length === 0) {
      logger.error(
        'Error fetching kit build plan details by serial number:',
        error
      )
      return null
    }

    const records = data as RRKittingDataRecord[]
    const firstRecord = records[0]

    // Calculate position-based priority
    let positionPriority = 1
    try {
      const { data: allKits } = await (
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .select('kit_serial_number, kit_priority')
        .not('kit_priority', 'is', null)
        .order('kit_priority', { ascending: true })

      if (allKits) {
        const seenSerials = new Set<string>()
        const sortedUniqueKits: string[] = []
        for (const kit of allKits as Array<{
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
      }))

    // Calculate stages
    const totalLines = toLines.length || 1
    const pickedCount = toLines.filter((t) => t.picked).length
    const kittedCount = toLines.filter((t) => t.kitted).length
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

      if (existing && (existing as { id: string }[]).length > 0) {
        return {
          success: false,
          error: `${flagType} flag already exists for this kit`,
        }
      }

      // Get the kit_po_number for this kit (for backward compatibility)
      const { data: kitData } = await (
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .select('kit_po_number')
        .eq('kit_serial_number', kitSerialNumber)
        .limit(1)
        .single()

      const kitPoNumber =
        (kitData as { kit_po_number: string } | null)?.kit_po_number || ''

      const { data, error } = await (
        db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
      )
        .insert({
          kit_serial_number: kitSerialNumber,
          kit_po_number: kitPoNumber,
          flag_type: flagType,
          is_active: true,
          set_by_user: userId,
          set_date_time: new Date().toISOString(),
          notes: notes || null,
        } as unknown)
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
          db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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
          db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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

      const record = data as {
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

      if (existing && (existing as { id: string }[]).length > 0) {
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
   * Clear all active flags of a specific type for a kit
   * @param kitPoNumber - The kit PO number
   * @param flagType - The type of flag to clear
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
          db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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
          db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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

  // ==================== BUILD KIT TOOL METHODS ====================

  /**
   * Verify a Kit PO Number exists and is ready for kitting
   * @param kitPoNumber - The Kit PO number to verify
   * @returns Kit data if found, with TO lines and their kitting status
   */
  static async verifyKitForBuild(kitPoNumber: string): Promise<{
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
  }> {
    try {
      const { data, error } = await (
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .select('*')
        .eq('kit_po_number', kitPoNumber.trim())
        .order('created_at', { ascending: true })

      if (error) {
        logger.error('[BuildKit] Error verifying kit:', error)
        return { exists: false, error: error.message }
      }

      if (!data || (data as RRKittingDataRecord[]).length === 0) {
        return { exists: false, error: 'Kit PO Number not found' }
      }

      const records = data as RRKittingDataRecord[]
      const firstRecord = records[0]

      // Check if kit is in a valid status for building (printed or in_progress)
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

      // Get user names for kitted by users
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
          quantity: parseFloat(r.source_target_qty || '0'),
          kitted: !!r.kit_to_line_kitted_date_time,
          kittedBy: r.kit_to_line_kitted_by_user
            ? userNameMap.get(r.kit_to_line_kitted_by_user) || null
            : null,
          kittedAt: r.kit_to_line_kitted_date_time || null,
        }))

      const kittedLines = toLines.filter((t) => t.kitted).length

      return {
        exists: true,
        kitData: {
          kitPoNumber: firstRecord.kit_po_number,
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
    } catch (err) {
      logger.error('[BuildKit] Error verifying kit:', err)
      return {
        exists: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
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

      // First, get the kit_po_number for this line so we can sync the kanban task
      const { data: lineData, error: lineError } = await (
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .select('kit_po_number')
        .eq('id', lineId)
        .single()

      if (lineError || !lineData) {
        logger.error('[BuildKit] Could not find line:', lineError)
        return { success: false, error: 'Could not find the TO line' }
      }

      const kitPoNumber = (lineData as { kit_po_number: string }).kit_po_number

      const { error } = await (
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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

      // Sync progress to the kanban board
      await KitKanbanService.syncKitProgressFromData(kitPoNumber)

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
      // First, get the kit_po_number for this line so we can sync the kanban task
      const { data: lineData, error: lineError } = await (
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .select('kit_po_number')
        .eq('id', lineId)
        .single()

      if (lineError || !lineData) {
        logger.error('[BuildKit] Could not find line:', lineError)
        return { success: false, error: 'Could not find the TO line' }
      }

      const kitPoNumber = (lineData as { kit_po_number: string }).kit_po_number

      const { error } = await (
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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

      // Sync progress to the kanban board
      await KitKanbanService.syncKitProgressFromData(kitPoNumber)

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
    quantity: number
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
      // Find the TO line for this material that hasn't been kitted yet
      const { data, error: fetchError } = await (
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .select('*')
        .eq('kit_po_number', kitPoNumber)
        .eq('material', material.trim())
        .is('kit_to_line_kitted_date_time', null)
        .limit(1)
        .single()

      if (fetchError || !data) {
        // Check if all lines for this material are already kitted
        const { data: kittedData } = await (
          db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
        )
          .select('*')
          .eq('kit_po_number', kitPoNumber)
          .eq('material', material.trim())

        if (kittedData && (kittedData as RRKittingDataRecord[]).length > 0) {
          const allKitted = (kittedData as RRKittingDataRecord[]).every(
            (r) => r.kit_to_line_kitted_date_time !== null
          )
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

      const record = data as RRKittingDataRecord

      // Verify quantity matches (with tolerance for string parsing)
      const expectedQty = parseFloat(record.source_target_qty || '0')
      if (Math.abs(expectedQty - quantity) > 0.01) {
        return {
          success: false,
          error: `Quantity mismatch: expected ${expectedQty}, scanned ${quantity}`,
        }
      }

      // Mark the line as kitted
      const markResult = await this.markLineAsKitted(record.id!)
      if (!markResult.success) {
        return { success: false, error: markResult.error }
      }

      // Check if all lines for this kit are now kitted
      const { data: allLines } = await (
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .select('kit_to_line_kitted_date_time')
        .eq('kit_po_number', kitPoNumber)
        .not('transfer_order_number', 'is', null)

      const allLinesKitted =
        allLines &&
        (
          allLines as Array<{ kit_to_line_kitted_date_time: string | null }>
        ).every((line) => line.kit_to_line_kitted_date_time !== null)

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
   * Complete the kit build - sets status to 'kit_built'
   * @param kitPoNumber - The Kit PO number to complete
   * @returns Success status
   */
  static async completeKitBuild(
    kitPoNumber: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // First verify all lines are kitted
      const { data: allLines, error: fetchError } = await (
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .select('kit_to_line_kitted_date_time, transfer_order_number')
        .eq('kit_po_number', kitPoNumber)
        .not('transfer_order_number', 'is', null)

      if (fetchError) {
        return { success: false, error: fetchError.message }
      }

      const lines = allLines as Array<{
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

      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id

      // Update all records for this kit to 'kit_built' status
      const { error } = await (
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .update({
          kit_build_status: 'kit_built',
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('kit_po_number', kitPoNumber)

      if (error) {
        logger.error('[BuildKit] Error completing kit build:', error)
        return { success: false, error: error.message }
      }

      logger.log(
        `[BuildKit] Completed kit build for ${kitPoNumber} by user ${userId}`
      )
      return { success: true }
    } catch (err) {
      logger.error('[BuildKit] Error completing kit build:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Set kit status to in_progress when building starts
   * @param kitPoNumber - The Kit PO number
   * @returns Success status
   */
  static async startKitBuild(
    kitPoNumber: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await (
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .update({
          kit_build_status: 'in_progress',
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('kit_po_number', kitPoNumber)

      if (error) {
        logger.error('[BuildKit] Error starting kit build:', error)
        return { success: false, error: error.message }
      }

      logger.log(`[BuildKit] Started kit build for ${kitPoNumber}`)
      return { success: true }
    } catch (err) {
      logger.error('[BuildKit] Error starting kit build:', err)
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
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .select('*')
        .eq('kit_po_number', kitPoNumber.trim())
        .order('created_at', { ascending: true })

      if (error) {
        logger.error('[InspectKit] Error verifying kit:', error)
        return { exists: false, error: error.message }
      }

      if (!data || (data as RRKittingDataRecord[]).length === 0) {
        return { exists: false, error: 'Kit PO Number not found' }
      }

      const records = data as RRKittingDataRecord[]
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
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .select('kit_inspection_completion_date_time, transfer_order_number')
        .eq('kit_po_number', kitPoNumber)
        .not('transfer_order_number', 'is', null)

      if (fetchError) {
        return { success: false, error: fetchError.message }
      }

      const lines = allLines as Array<{
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
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
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
   * Recheck BOM coverage for an existing kit and auto-manage Black Hat flag.
   * Queries all TO rows for the kit, compares against the linked kit_definition BOM,
   * and sets or clears the Black Hat flag accordingly.
   */
  static async recheckBomCoverage(
    kitPoNumber: string,
    kitDefinitionId: string
  ): Promise<{ success: boolean; isComplete: boolean; error?: string }> {
    try {
      // Load BOM from kit_definitions
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

      const bom = ((defData as { required_components: unknown })
        .required_components ?? []) as Array<{
        materialNumber: string
        materialDescription: string
        requiredQuantity: number
      }>

      if (bom.length === 0) {
        return { success: true, isComplete: true }
      }

      // Load all TO material numbers for this kit
      const { data: kitRows, error: kitError } = await (
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .select('material')
        .eq('kit_po_number', kitPoNumber)
        .not('transfer_order_number', 'is', null)

      if (kitError) {
        return { success: false, isComplete: false, error: kitError.message }
      }

      const toMaterials = new Set(
        ((kitRows ?? []) as { material: string | null }[])
          .map((r) => (r.material ?? '').trim().toUpperCase())
          .filter(Boolean)
      )

      const unmatched = bom.filter(
        (c) => !toMaterials.has(c.materialNumber.trim().toUpperCase())
      )

      if (unmatched.length > 0) {
        const missingList = unmatched
          .map((m) => `${m.materialNumber} (${m.materialDescription})`)
          .join(', ')
        await this.addFlag(
          kitPoNumber,
          'black',
          `Auto-flagged: Missing BOM materials — ${missingList}`
        )
        return { success: true, isComplete: false }
      } else {
        // All covered — clear Black Hat if active
        await this.clearFlagByType(kitPoNumber, 'black')
        return { success: true, isComplete: true }
      }
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
   * Append additional TOs to an existing kit build plan, then recheck BOM coverage.
   */
  static async appendTOsToKit(
    kitPoNumber: string,
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
      if (importedTOs.length === 0) {
        return { success: false, insertedCount: 0, error: 'No TOs provided' }
      }

      // Get existing kit metadata
      const { data: existingData, error: existingError } = await (
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .select(
          'kit_build_number, kit_number, engine_program, deliver_to_plant, due_date, kit_serial_number, kit_priority, kit_definition_id, kit_added_by_user, incora_items, authorized_ship_short_items, kanban_task_id'
        )
        .eq('kit_po_number', kitPoNumber)
        .limit(1)

      if (
        existingError ||
        !existingData ||
        (existingData as unknown[]).length === 0
      ) {
        return { success: false, insertedCount: 0, error: 'Kit not found' }
      }

      const first = (existingData as Record<string, unknown>[])[0]

      // Get existing TO numbers to skip duplicates
      const { data: existingTOs } = await (
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      )
        .select('transfer_order_number')
        .eq('kit_po_number', kitPoNumber)
        .not('transfer_order_number', 'is', null)

      const existingTONumbers = new Set(
        ((existingTOs ?? []) as { transfer_order_number: string }[]).map(
          (r) => r.transfer_order_number
        )
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
        kit_serial_number: first.kit_serial_number,
        kit_priority: first.kit_priority,
        kit_definition_id: first.kit_definition_id,
        kit_added_by_user: first.kit_added_by_user,
        kit_added_create_date_time: new Date().toISOString(),
        kit_build_status: 'pending',
        kit_priority_change_count: 0,
        incora_items: first.incora_items ?? [],
        authorized_ship_short_items: first.authorized_ship_short_items ?? [],
        kanban_task_id: first.kanban_task_id,
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
        db.from(this.TABLE_NAME) as ReturnType<(typeof supabase)['from']>
      ).insert(records as unknown[])

      if (insertError) {
        logger.error(
          '[KittingService] appendTOsToKit insert error:',
          insertError
        )
        return { success: false, insertedCount: 0, error: insertError.message }
      }

      // Resync kanban totals
      await KitKanbanService.syncKitProgressFromData(kitPoNumber)

      // Recheck BOM coverage if linked to a definition
      let bomCoverageComplete: boolean | undefined
      const defId = first.kit_definition_id as string | null
      if (defId) {
        const coverageResult = await this.recheckBomCoverage(kitPoNumber, defId)
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
}
// Developer and Creator: Jai Singh
