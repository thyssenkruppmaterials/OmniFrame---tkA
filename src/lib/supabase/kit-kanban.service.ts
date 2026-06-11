// Created and developed by Jai Singh
/**
 * Kit Kanban Service
 * Service for managing kit kanban board tasks and columns in Supabase
 * Created: December 12, 2025
 *
 * Note: This service uses type assertions because kit_kanban_columns and kit_kanban_tasks
 * are not yet in the generated Supabase types. Run `supabase gen types`
 * to regenerate types after the tables are created.
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

// Type-safe wrapper for the supabase client to handle tables not in generated types
const db = supabase as unknown as ReturnType<(typeof supabase)['from']> & {
  from: (table: string) => ReturnType<(typeof supabase)['from']>
}

// Kanban column structure
export interface KanbanColumn {
  id: string
  column_name: string
  column_display_name: string
  column_description: string | null
  column_color: string
  sort_order: number
  is_active: boolean
  is_start_column: boolean
  is_end_column: boolean
}

// Kanban task structure matching database
export interface KanbanTask {
  id: string
  task_title: string
  task_description: string | null
  kit_build_plan_id: string | null
  kit_serial_number: string | null
  kit_po_number: string | null
  kit_number: string | null // Kit Number to uniquely identify kit when same PO has multiple kits
  kit_build_number: string | null
  column_id: string
  position_in_column: number
  priority: number
  total_to_lines: number
  to_lines_picked: number
  to_lines_kitted: number
  current_step: string | null
  current_worker_id: string | null
  current_worker_name: string | null
  last_touched_by_name: string | null
  due_date: string | null
  created_at: string
  updated_at: string
}

// Input for creating a kanban task from a kit build plan
export interface CreateKanbanTaskInput {
  kitSerialNumber: string
  kitPoNumber: string
  kitNumber?: string // Kit Number to uniquely identify kit when same PO has multiple kits
  kitBuildNumber: string
  kitBuildPlanId: string
  priority: number
  totalToLines: number
  dueDate?: string
}

// UI-friendly task format for the kanban board
export interface KitKanbanTask {
  id: string
  title: string // Format: "{Kit Serial Number} - {Kit PO Number}"
  description?: string
  priority: number // The kit priority number
  priorityLabel: string // e.g., "#1", "#2"
  kitSerialNumber: string // PRIMARY KEY: Unique identifier for each kit build
  kitBuildNumber: string
  kitPoNumber: string // Kit PO Number for quick view
  kitNumber?: string // Kit Number (can have duplicates across different kit builds)
  componentsTotal: number
  componentsCompleted: number // TO lines picked/kitted based on step (legacy)
  toLinesPicked: number // Lines that have been picked
  toLinesKitted: number // Lines that have been kitted
  assignee?: {
    name: string
    avatar: string
  }
  lastTouchedByName?: string // Last person who worked on this kit
  dueDate?: string
  currentStep: string // 'planning', 'picking', 'kitting', 'inspection', 'on_dock', 'completed'
  columnId: string
  hasBlackHat?: boolean
  blackHatNote?: string
}

export class KitKanbanService {
  private static readonly COLUMNS_TABLE = 'kit_kanban_columns'
  private static readonly TASKS_TABLE = 'kit_kanban_tasks'

  /**
   * Default kanban columns configuration
   */
  private static readonly DEFAULT_COLUMNS = [
    {
      column_name: 'planning',
      column_display_name: 'Planning',
      column_description: 'Kits being planned and prepared',
      column_color: '#6B7280',
      sort_order: 1,
      is_start_column: true,
      is_end_column: false,
    },
    {
      column_name: 'in_progress',
      column_display_name: 'In Progress',
      column_description: 'Kits currently being assembled',
      column_color: '#F59E0B',
      sort_order: 2,
      is_start_column: false,
      is_end_column: false,
    },
    {
      column_name: 'quality_check',
      column_display_name: 'Quality Check',
      column_description: 'Kits awaiting quality inspection',
      column_color: '#3B82F6',
      sort_order: 3,
      is_start_column: false,
      is_end_column: false,
    },
    {
      column_name: 'completed',
      column_display_name: 'Completed',
      column_description: 'Kits that have been completed',
      column_color: '#10B981',
      sort_order: 4,
      is_start_column: false,
      is_end_column: true,
    },
  ]

  /**
   * Ensure default kanban columns exist
   * Creates them if they don't exist (columns are shared globally, not per-organization)
   */
  static async ensureDefaultColumns(): Promise<{
    success: boolean
    created: boolean
    error?: string
  }> {
    try {
      // Check if columns already exist
      const { data: existingColumns, error: checkError } = await (
        db.from(this.COLUMNS_TABLE) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('id')
        .limit(1)

      if (checkError) {
        logger.error(
          '[KitKanbanService] Error checking existing columns:',
          checkError
        )
        return { success: false, created: false, error: checkError.message }
      }

      // If columns already exist, no need to create
      if (existingColumns && existingColumns.length > 0) {
        return { success: true, created: false }
      }

      logger.log('[KitKanbanService] Creating default kanban columns')

      // Create default columns (no organization_id needed)
      const columnsToInsert = this.DEFAULT_COLUMNS.map((col) => ({
        ...col,
        is_active: true,
      }))

      const { error: insertError } = await (
        db.from(this.COLUMNS_TABLE) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      ).insert(columnsToInsert as never[])

      if (insertError) {
        logger.error(
          '[KitKanbanService] Error creating default columns:',
          insertError
        )
        return { success: false, created: false, error: insertError.message }
      }

      logger.log(
        `[KitKanbanService] Successfully created ${columnsToInsert.length} default columns`
      )
      return { success: true, created: true }
    } catch (err) {
      logger.error('[KitKanbanService] Error in ensureDefaultColumns:', err)
      return {
        success: false,
        created: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Get all kanban columns in order
   * Automatically creates default columns if none exist
   */
  static async getColumns(): Promise<KanbanColumn[]> {
    try {
      // Ensure default columns exist (columns are shared globally)
      await this.ensureDefaultColumns()
    } catch (err) {
      logger.warn('[KitKanbanService] Could not ensure default columns:', err)
    }

    const { data, error } = await (
      db.from(this.COLUMNS_TABLE) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (error) {
      logger.error('Error fetching kanban columns:', error)
      return []
    }

    return (data as unknown as KanbanColumn[]) || []
  }

  /**
   * Get all tasks for the kanban board
   */
  static async getTasks(): Promise<KanbanTask[]> {
    const { data, error } = await (
      db.from(this.TASKS_TABLE) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .select('*')
      .order('position_in_column', { ascending: true })

    if (error) {
      logger.error('Error fetching kanban tasks:', error)
      return []
    }

    return (data as unknown as KanbanTask[]) || []
  }

  /**
   * Get tasks grouped by column for the board UI
   * Priority is calculated based on position across all tasks (sorted by database priority)
   * to ensure consistency with the Kitting Data Manager display
   */
  static async getTasksByColumn(): Promise<Map<string, KitKanbanTask[]>> {
    const tasks = await this.getTasks()
    const columns = await this.getColumns()

    // Batch-fetch active Black Hat flags. Prefer kit_serial_number scope
    // (post 303_kit_build_flags_serial_scope) and fall back to PO scope
    // for any legacy rows whose serial column was never backfilled.
    const kitSerialNumbers = [
      ...new Set(
        tasks.map((t) => t.kit_serial_number).filter((s): s is string => !!s)
      ),
    ]
    const kitPoNumbers = [
      ...new Set(
        tasks.map((t) => t.kit_po_number).filter((s): s is string => !!s)
      ),
    ]
    const blackHatBySerial = new Map<string, string | null>()
    const blackHatByPo = new Map<string, string | null>()

    try {
      if (kitSerialNumbers.length > 0) {
        const { data: serialFlags } = await (
          db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
        )
          .select('kit_serial_number, notes')
          .in('kit_serial_number', kitSerialNumbers)
          .eq('flag_type', 'black')
          .eq('is_active', true)

        if (serialFlags) {
          for (const f of serialFlags as unknown as {
            kit_serial_number: string | null
            notes: string | null
          }[]) {
            if (f.kit_serial_number) {
              blackHatBySerial.set(f.kit_serial_number, f.notes)
            }
          }
        }
      }

      if (kitPoNumbers.length > 0) {
        const { data: poFlags } = await (
          db.from('kit_build_flags') as ReturnType<(typeof supabase)['from']>
        )
          .select('kit_po_number, notes')
          .in('kit_po_number', kitPoNumbers)
          .is('kit_serial_number', null)
          .eq('flag_type', 'black')
          .eq('is_active', true)

        if (poFlags) {
          for (const f of poFlags as unknown as {
            kit_po_number: string | null
            notes: string | null
          }[]) {
            if (f.kit_po_number) {
              blackHatByPo.set(f.kit_po_number, f.notes)
            }
          }
        }
      }
    } catch {
      // Non-fatal: kanban still works without flag data
    }

    // Batch-fetch the human-readable kit number (e.g. "424 Inlet #1")
    // from RR_Kitting_DATA so each kanban card can show what the kit
    // actually is. kit_number is NOT a column on kit_kanban_tasks — it
    // lives only on RR_Kitting_DATA — so we enrich here, keyed by
    // kit_serial_number per [[Kit-Serial-Scoping]] (no PO fallback to
    // avoid mislabelling kits that share a PO).
    const kitNumberBySerial = new Map<string, string>()
    try {
      if (kitSerialNumbers.length > 0) {
        const { data: serialRows } = await (
          db.from('RR_Kitting_DATA') as ReturnType<(typeof supabase)['from']>
        )
          .select('kit_serial_number, kit_number')
          .in('kit_serial_number', kitSerialNumbers)
          .not('kit_number', 'is', null)

        if (serialRows) {
          for (const r of serialRows as unknown as {
            kit_serial_number: string | null
            kit_number: string | null
          }[]) {
            if (
              r.kit_serial_number &&
              r.kit_number &&
              !kitNumberBySerial.has(r.kit_serial_number)
            ) {
              kitNumberBySerial.set(r.kit_serial_number, r.kit_number)
            }
          }
        }
      }
    } catch {
      // Non-fatal: kanban still works without kit-number labels
    }

    // Initialize map with all columns
    const taskMap = new Map<string, KitKanbanTask[]>()
    for (const column of columns) {
      taskMap.set(column.id, [])
    }

    // Sort all tasks by their database priority to maintain order
    // Then assign sequential position-based priorities for display
    const sortedTasks = [...tasks].sort((a, b) => a.priority - b.priority)

    // Transform and group tasks, assigning position-based priority
    sortedTasks.forEach((task, index) => {
      const positionPriority = index + 1
      const uiTask = this.transformToUITask(task, positionPriority)
      // Attach the human-readable kit number sourced above so the card
      // can render "Kit {kit_number}" (e.g. "Kit 424 Inlet #1").
      if (
        task.kit_serial_number &&
        kitNumberBySerial.has(task.kit_serial_number)
      ) {
        uiTask.kitNumber = kitNumberBySerial.get(task.kit_serial_number)
      }
      if (
        task.kit_serial_number &&
        blackHatBySerial.has(task.kit_serial_number)
      ) {
        uiTask.hasBlackHat = true
        uiTask.blackHatNote =
          blackHatBySerial.get(task.kit_serial_number) ?? undefined
      } else if (task.kit_po_number && blackHatByPo.has(task.kit_po_number)) {
        uiTask.hasBlackHat = true
        uiTask.blackHatNote = blackHatByPo.get(task.kit_po_number) ?? undefined
      }
      const columnTasks = taskMap.get(task.column_id) || []
      columnTasks.push(uiTask)
      taskMap.set(task.column_id, columnTasks)
    })

    return taskMap
  }

  /**
   * Transform database task to UI-friendly format
   * @param task - The database task record
   * @param positionPriority - Optional position-based priority (1, 2, 3...) for display
   *                          If not provided, uses the database priority value
   */
  private static transformToUITask(
    task: KanbanTask,
    positionPriority?: number
  ): KitKanbanTask {
    // Calculate completed components based on current step
    let componentsCompleted = 0
    if (
      task.current_step === 'kitting' ||
      task.current_step === 'inspection' ||
      task.current_step === 'on_dock' ||
      task.current_step === 'completed'
    ) {
      componentsCompleted = task.to_lines_kitted
    } else if (task.current_step === 'picking') {
      componentsCompleted = task.to_lines_picked
    }

    // Determine last touched by - use current worker if assigned, otherwise use last_touched_by_name
    const lastTouchedByName =
      task.current_worker_name || task.last_touched_by_name || undefined

    // Use position-based priority for display to match Kitting Data Manager
    const displayPriority = positionPriority ?? task.priority

    return {
      id: task.id,
      title: `${task.kit_serial_number || 'N/A'} - ${task.kit_po_number || 'N/A'}`,
      description: task.task_description || undefined,
      priority: displayPriority,
      priorityLabel: `#${displayPriority}`,
      kitSerialNumber: task.kit_serial_number || '', // PRIMARY KEY: Unique identifier for each kit build
      kitBuildNumber: task.kit_build_number || 'N/A',
      kitPoNumber: task.kit_po_number || '', // For quick view functionality
      kitNumber: task.kit_number || undefined, // Kit Number (can have duplicates across different kit builds)
      componentsTotal: task.total_to_lines,
      componentsCompleted,
      toLinesPicked: task.to_lines_picked,
      toLinesKitted: task.to_lines_kitted,
      assignee: task.current_worker_name
        ? {
            name: task.current_worker_name,
            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(task.current_worker_name)}`,
          }
        : undefined,
      lastTouchedByName,
      dueDate: task.due_date ? this.formatDate(task.due_date) : undefined,
      currentStep: task.current_step || 'planning',
      columnId: task.column_id,
    }
  }

  /**
   * Format date for display
   */
  private static formatDate(dateString: string): string {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  /**
   * Create a new kanban task from a kit build plan
   */
  static async createTask(input: CreateKanbanTaskInput): Promise<{
    success: boolean
    taskId?: string
    error?: string
  }> {
    try {
      // Ensure default columns exist
      const ensureResult = await this.ensureDefaultColumns()
      if (!ensureResult.success) {
        logger.error(
          '[KitKanbanService] createTask: Failed to ensure default columns:',
          ensureResult.error
        )
        return {
          success: false,
          error: `Failed to setup kanban columns: ${ensureResult.error}`,
        }
      }
      if (ensureResult.created) {
        logger.log(
          '[KitKanbanService] createTask: Created default kanban columns'
        )
      }

      // Get the "planning" column (start column)
      const { data: columns, error: colError } = await (
        db.from(this.COLUMNS_TABLE) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('id')
        .eq('column_name', 'planning')
        .limit(1)

      if (colError) {
        logger.error(
          '[KitKanbanService] createTask: Error finding planning column:',
          colError
        )
        return {
          success: false,
          error: `Could not find planning column: ${colError.message}`,
        }
      }

      const columnsArray = columns as unknown as { id: string }[] | null
      if (!columnsArray || columnsArray.length === 0) {
        logger.error('[KitKanbanService] createTask: No planning column found')
        return {
          success: false,
          error:
            'Planning column not found. Please ensure kanban columns are configured.',
        }
      }

      const columnId = columnsArray[0].id

      // Get the next position in the column
      const { data: existingTasks } = await (
        db.from(this.TASKS_TABLE) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('position_in_column')
        .eq('column_id', columnId)
        .order('position_in_column', { ascending: false })
        .limit(1)

      const nextPosition =
        existingTasks &&
        (existingTasks as unknown as { position_in_column: number }[]).length >
          0
          ? (existingTasks as unknown as { position_in_column: number }[])[0]
              .position_in_column + 1
          : 0

      // Create the task (no organization_id needed - tables are shared)
      // Note: kit_number is not stored in kanban_tasks table, only in RR_Kitting_DATA
      const { data: newTask, error: insertError } = await (
        db.from(this.TASKS_TABLE) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .insert({
          task_title: `${input.kitSerialNumber} - ${input.kitPoNumber}`,
          kit_build_plan_id: input.kitBuildPlanId,
          kit_serial_number: input.kitSerialNumber,
          kit_po_number: input.kitPoNumber,
          kit_build_number: input.kitBuildNumber,
          column_id: columnId,
          position_in_column: nextPosition,
          priority: input.priority,
          total_to_lines: input.totalToLines,
          to_lines_picked: 0,
          to_lines_kitted: 0,
          current_step: 'planning',
          due_date: input.dueDate || null,
        } as never)
        .select('id')
        .single()

      if (insertError) {
        logger.error(
          '[KitKanbanService] createTask: Error inserting task:',
          insertError
        )
        return { success: false, error: insertError.message }
      }

      logger.log(
        `[KitKanbanService] createTask: Successfully created kanban task for kit ${input.kitPoNumber}`
      )
      return {
        success: true,
        taskId: (newTask as unknown as { id: string })?.id,
      }
    } catch (err) {
      logger.error('[KitKanbanService] createTask: Unexpected error:', err)
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Unknown error creating kanban task',
      }
    }
  }

  /**
   * Move a task to a different column
   */
  static async moveTask(
    taskId: string,
    targetColumnId: string,
    newPosition: number
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await (
      db.from(this.TASKS_TABLE) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .update({
        column_id: targetColumnId,
        position_in_column: newPosition,
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('id', taskId)

    if (error) {
      logger.error('Error moving kanban task:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  }

  /**
   * Update task progress (TO lines picked/kitted)
   */
  static async updateTaskProgress(
    taskId: string,
    updates: {
      toLinesPicked?: number
      toLinesKitted?: number
      currentStep?: string
      currentWorkerId?: string
      currentWorkerName?: string
    }
  ): Promise<{ success: boolean; error?: string }> {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (updates.toLinesPicked !== undefined) {
      updateData.to_lines_picked = updates.toLinesPicked
    }
    if (updates.toLinesKitted !== undefined) {
      updateData.to_lines_kitted = updates.toLinesKitted
    }
    if (updates.currentStep !== undefined) {
      updateData.current_step = updates.currentStep
    }
    if (updates.currentWorkerId !== undefined) {
      updateData.current_worker_id = updates.currentWorkerId
    }
    if (updates.currentWorkerName !== undefined) {
      updateData.current_worker_name = updates.currentWorkerName
    }

    const { error } = await (
      db.from(this.TASKS_TABLE) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .update(updateData as Record<string, unknown>)
      .eq('id', taskId)

    if (error) {
      logger.error('Error updating kanban task progress:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  }

  /**
   * Update task priority
   * Used when Kit Build Plan priorities are reordered
   */
  static async updateTaskPriority(
    kitBuildPlanId: string,
    newPriority: number
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await (
      db.from(this.TASKS_TABLE) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .update({
        priority: newPriority,
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('kit_build_plan_id', kitBuildPlanId)

    if (error) {
      logger.error('Error updating kanban task priority:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  }

  /**
   * Update task priority by kit_po_number
   * Used when Kit Build Plan priorities are reordered and we don't have kit_build_plan_id
   * @deprecated Use updateTaskPriorityBySerialNumber instead for unique kit identification
   */
  static async updateTaskPriorityByPoNumber(
    kitPoNumber: string,
    newPriority: number
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await (
      db.from(this.TASKS_TABLE) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .update({
        priority: newPriority,
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('kit_po_number', kitPoNumber)

    if (error) {
      logger.error('Error updating kanban task priority by PO number:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  }

  /**
   * Update task priority by kit_serial_number
   * Preferred method for updating priorities as kit_serial_number is unique per kit build
   */
  static async updateTaskPriorityBySerialNumber(
    kitSerialNumber: string,
    newPriority: number
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await (
      db.from(this.TASKS_TABLE) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .update({
        priority: newPriority,
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('kit_serial_number', kitSerialNumber)

    if (error) {
      logger.error(
        'Error updating kanban task priority by serial number:',
        error
      )
      return { success: false, error: error.message }
    }

    return { success: true }
  }

  /**
   * Delete a kanban task
   */
  static async deleteTask(
    taskId: string
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await (
      db.from(this.TASKS_TABLE) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .delete()
      .eq('id', taskId)

    if (error) {
      logger.error('Error deleting kanban task:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  }

  /**
   * Real-time payload type for incremental updates
   */
  static readonly REALTIME_EVENTS = {
    INSERT: 'INSERT',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
  } as const

  /**
   * Subscribe to real-time changes on tasks with payload for incremental updates
   * Instead of triggering a full refetch, this passes the actual change payload
   * so the UI can apply delta updates for sub-second responsiveness
   */
  static subscribeToChanges(
    callback: (payload: {
      eventType: 'INSERT' | 'UPDATE' | 'DELETE'
      new: KanbanTask | null
      old: KanbanTask | null
    }) => void
  ) {
    return supabase
      .channel('kit_kanban_tasks_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: this.TASKS_TABLE },
        (payload) => {
          callback({
            eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
            new: payload.new as KanbanTask | null,
            old: payload.old as KanbanTask | null,
          })
        }
      )
      .subscribe()
  }

  /**
   * Legacy subscription method for backward compatibility
   * @deprecated Use subscribeToChanges with payload handler instead
   */
  static subscribeToChangesLegacy(callback: () => void) {
    return supabase
      .channel('kit_kanban_tasks_changes_legacy')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: this.TASKS_TABLE },
        () => callback()
      )
      .subscribe()
  }

  /**
   * Get task by kit build plan ID
   */
  static async getTaskByKitBuildPlanId(
    kitBuildPlanId: string
  ): Promise<KanbanTask | null> {
    const { data, error } = await (
      db.from(this.TASKS_TABLE) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .select('*')
      .eq('kit_build_plan_id', kitBuildPlanId)
      .single()

    if (error) {
      logger.error('Error fetching kanban task by kit build plan ID:', error)
      return null
    }

    return data as unknown as KanbanTask
  }

  /**
   * Start a kit - moves it from Planning to In Progress column
   * Also updates the current step
   */
  static async startKit(taskId: string): Promise<{
    success: boolean
    targetColumnId?: string
    kitPoNumber?: string
    error?: string
  }> {
    // First get the task to retrieve the kit_po_number
    const { data: taskData, error: taskError } = await (
      db.from(this.TASKS_TABLE) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .select('kit_po_number')
      .eq('id', taskId)
      .single()

    if (taskError || !taskData) {
      logger.error('Error fetching task for start kit:', taskError)
      return { success: false, error: 'Could not find task' }
    }

    const kitPoNumber = (taskData as unknown as { kit_po_number: string })
      .kit_po_number

    // Get the "in_progress" column
    const { data: columns, error: colError } = await (
      db.from(this.COLUMNS_TABLE) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .select('id')
      .eq('column_name', 'in_progress')
      .single()

    if (colError || !columns) {
      logger.error('Error finding in_progress column:', colError)
      return { success: false, error: 'Could not find in_progress column' }
    }

    const targetColumnId = (columns as unknown as { id: string }).id

    // Get the next position in the target column
    const { data: existingTasks } = await (
      db.from(this.TASKS_TABLE) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .select('position_in_column')
      .eq('column_id', targetColumnId)
      .order('position_in_column', { ascending: false })
      .limit(1)

    const nextPosition =
      existingTasks &&
      (existingTasks as unknown as { position_in_column: number }[]).length > 0
        ? (existingTasks as unknown as { position_in_column: number }[])[0]
            .position_in_column + 1
        : 0

    // Update the task: move to in_progress column and update step
    const { error: updateError } = await (
      db.from(this.TASKS_TABLE) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .update({
        column_id: targetColumnId,
        position_in_column: nextPosition,
        current_step: 'picking',
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('id', taskId)

    if (updateError) {
      logger.error('Error starting kit:', updateError)
      return { success: false, error: updateError.message }
    }

    return { success: true, targetColumnId, kitPoNumber }
  }

  /**
   * Get task by kit PO number.
   *
   * @deprecated Multi-kit-per-PO is supported (e.g. C47E/4 Gear Box 1 + 2
   * share a PO) — this returns whichever task happens to come back first
   * and will silently merge unrelated kits. Use
   * {@link getTaskByKitSerialNumber} when identifying a specific kit.
   * Retained for legacy callers operating on a PO group.
   */
  static async getTaskByKitPoNumber(
    kitPoNumber: string
  ): Promise<KanbanTask | null> {
    const { data, error } = await (
      db.from(this.TASKS_TABLE) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .select('*')
      .eq('kit_po_number', kitPoNumber)
      .order('created_at', { ascending: false }) // Get most recent if duplicates exist
      .limit(1)

    if (error) {
      logger.error('Error fetching kanban task by kit PO number:', error)
      return null
    }

    // Handle array result from limit(1)
    const tasks = data as unknown as KanbanTask[]
    return tasks && tasks.length > 0 ? tasks[0] : null
  }

  /**
   * Get task by kit_serial_number (the unique kit identity).
   * Preferred over {@link getTaskByKitPoNumber} for any kit-level lookup
   * where two kits could share a PO.
   */
  static async getTaskByKitSerialNumber(
    kitSerialNumber: string
  ): Promise<KanbanTask | null> {
    const { data, error } = await (
      db.from(this.TASKS_TABLE) as unknown as ReturnType<
        (typeof supabase)['from']
      >
    )
      .select('*')
      .eq('kit_serial_number', kitSerialNumber)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) {
      logger.error('Error fetching kanban task by kit serial number:', error)
      return null
    }

    const tasks = data as unknown as KanbanTask[]
    return tasks && tasks.length > 0 ? tasks[0] : null
  }

  /**
   * Fetch the human-readable kit number (e.g. "424 Inlet #1") for a
   * single kit serial. kit_number lives on RR_Kitting_DATA, not on
   * kit_kanban_tasks, so realtime INSERT payloads don't carry it — this
   * lets the board enrich a freshly-inserted card. Keyed by
   * kit_serial_number per [[Kit-Serial-Scoping]].
   */
  static async getKitNumberBySerial(
    kitSerialNumber: string
  ): Promise<string | null> {
    const { data, error } = await (
      db.from('RR_Kitting_DATA') as ReturnType<(typeof supabase)['from']>
    )
      .select('kit_number')
      .eq('kit_serial_number', kitSerialNumber)
      .not('kit_number', 'is', null)
      .limit(1)

    if (error) {
      logger.error('Error fetching kit number by serial:', error)
      return null
    }

    const rows = data as unknown as { kit_number: string | null }[]
    return rows && rows.length > 0 ? rows[0].kit_number : null
  }

  /**
   * Sync kanban task progress for a single kit identified by its serial.
   * This is the preferred entry point — it never aggregates rows across
   * kits that happen to share a PO, and it updates the kanban task whose
   * `kit_serial_number` matches.
   */
  static async syncKitProgressFromSerial(kitSerialNumber: string): Promise<{
    success: boolean
    toLinesPicked?: number
    toLinesKitted?: number
    totalLines?: number
    currentStep?: string
    error?: string
  }> {
    try {
      logger.log(
        `📊 KitKanbanService: Syncing progress for kit serial ${kitSerialNumber}`
      )

      const { data: kitLines, error: fetchError } = await (
        db.from('RR_Kitting_DATA') as ReturnType<(typeof supabase)['from']>
      )
        .select(
          'kit_to_line_picked_date_time, kit_to_line_kitted_date_time, kit_inspection_completion_date_time, kit_ready_on_dock_date_time, transfer_order_number, cancelled'
        )
        .eq('kit_serial_number', kitSerialNumber)
        .not('transfer_order_number', 'is', null)

      if (fetchError) {
        logger.error('Error fetching kit lines for sync:', fetchError)
        return { success: false, error: fetchError.message }
      }

      if (!kitLines || kitLines.length === 0) {
        logger.log(`⚠️ No kit lines found for ${kitSerialNumber}`)
        return {
          success: true,
          toLinesPicked: 0,
          toLinesKitted: 0,
          totalLines: 0,
        }
      }

      interface KitLine {
        kit_to_line_picked_date_time: string | null
        kit_to_line_kitted_date_time: string | null
        kit_inspection_completion_date_time: string | null
        kit_ready_on_dock_date_time: string | null
        transfer_order_number: string | null
        // migration 325 — cancelled lines are excluded from progress totals
        cancelled?: boolean | null
      }

      const lines = kitLines as unknown as KitLine[]
      const { totalLines, pickedCount, kittedCount, currentStep } =
        this.computeKitProgress(lines)

      const task = await this.getTaskByKitSerialNumber(kitSerialNumber)
      if (!task) {
        logger.log(`⚠️ No kanban task found for kit serial ${kitSerialNumber}`)
        return {
          success: true,
          toLinesPicked: pickedCount,
          toLinesKitted: kittedCount,
          totalLines,
        }
      }

      // When the kit lands on dock (the new
      // [[RF-Dock-Staging-Flow]] terminal step), promote the kanban card
      // to the `completed` lane in the same UPDATE as the progress
      // counters so operators see the move on the next board tick.
      // The criterion is purely `kit_ready_on_dock_date_time IS NOT NULL`
      // (encoded in `currentStep === 'on_dock'`) — that invariant holds
      // regardless of whether the org runs inspections, and it also
      // catches historical rows that landed on-dock via the pre-2026-05-17
      // skip-inspection branch with `kit_dock_location = NULL`.
      const updatePayload: Record<string, unknown> = {
        to_lines_picked: pickedCount,
        to_lines_kitted: kittedCount,
        total_to_lines: totalLines,
        current_step: currentStep,
        updated_at: new Date().toISOString(),
      }

      let targetColumnId: string | null = null
      if (currentStep === 'on_dock' || currentStep === 'completed') {
        const { data: completedColumns } = await (
          db.from(this.COLUMNS_TABLE) as unknown as ReturnType<
            (typeof supabase)['from']
          >
        )
          .select('id')
          .eq('column_name', 'completed')
          .limit(1)

        const completedColumnRows = completedColumns as unknown as
          | { id: string }[]
          | null
        const completedColumnId = completedColumnRows?.[0]?.id ?? null

        if (completedColumnId && task.column_id !== completedColumnId) {
          targetColumnId = completedColumnId

          // Append to the bottom of the completed column to keep newly
          // staged kits visually grouped together.
          const { data: maxPosData } = await (
            db.from(this.TASKS_TABLE) as unknown as ReturnType<
              (typeof supabase)['from']
            >
          )
            .select('position_in_column')
            .eq('column_id', completedColumnId)
            .order('position_in_column', { ascending: false })
            .limit(1)

          const nextPosition =
            maxPosData &&
            (maxPosData as unknown as { position_in_column: number }[]).length >
              0
              ? (maxPosData as unknown as { position_in_column: number }[])[0]
                  .position_in_column + 1
              : 0

          updatePayload.column_id = completedColumnId
          updatePayload.position_in_column = nextPosition
        }
      }

      const { error: updateError } = await (
        db.from(this.TASKS_TABLE) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .update(updatePayload)
        .eq('id', task.id)

      if (updateError) {
        logger.error('Error updating kanban task progress:', updateError)
        return { success: false, error: updateError.message }
      }

      if (targetColumnId) {
        logger.log(
          `🚚 KitKanbanService: Promoted ${kitSerialNumber} to completed lane (kit_ready_on_dock_date_time stamped)`
        )
      }

      logger.log(
        `✅ KitKanbanService: Synced progress for ${kitSerialNumber}: ${pickedCount}/${totalLines} picked, ${kittedCount}/${totalLines} kitted, step: ${currentStep}`
      )
      return {
        success: true,
        toLinesPicked: pickedCount,
        toLinesKitted: kittedCount,
        totalLines,
        currentStep,
      }
    } catch (err) {
      logger.error('Error syncing kit progress by serial:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * PO-scoped sync. Fans out to {@link syncKitProgressFromSerial} for
   * every distinct kit serial under the PO so that multi-kit POs no
   * longer collapse into a single aggregated kanban card.
   *
   * Kept as the public surface for legacy callers that still pass a PO,
   * but every new code path should call {@link syncKitProgressFromSerial}
   * directly with the actual kit serial it is operating on.
   */
  static async syncKitProgressFromData(kitPoNumber: string): Promise<{
    success: boolean
    toLinesPicked?: number
    toLinesKitted?: number
    totalLines?: number
    currentStep?: string
    error?: string
  }> {
    try {
      const { data: rows, error: fetchError } = await (
        db.from('RR_Kitting_DATA') as ReturnType<(typeof supabase)['from']>
      )
        .select('kit_serial_number')
        .eq('kit_po_number', kitPoNumber)
        .not('kit_serial_number', 'is', null)

      if (fetchError) {
        logger.error(
          'Error fetching kit serials for PO-scoped sync:',
          fetchError
        )
        return { success: false, error: fetchError.message }
      }

      const serials = Array.from(
        new Set(
          ((rows ?? []) as unknown as { kit_serial_number: string | null }[])
            .map((r) => r.kit_serial_number)
            .filter((s): s is string => !!s)
        )
      )

      if (serials.length === 0) {
        logger.log(`⚠️ No kit serials found for PO ${kitPoNumber}`)
        return {
          success: true,
          toLinesPicked: 0,
          toLinesKitted: 0,
          totalLines: 0,
        }
      }

      let lastResult: Awaited<
        ReturnType<typeof KitKanbanService.syncKitProgressFromSerial>
      > | null = null
      for (const serial of serials) {
        lastResult = await this.syncKitProgressFromSerial(serial)
        if (!lastResult.success) {
          logger.warn(
            `[KitKanbanService] PO-scoped sync: serial ${serial} failed: ${lastResult.error}`
          )
        }
      }

      // Surface the last per-serial result to keep the existing return
      // shape stable. Callers that actually need per-serial progress
      // should use syncKitProgressFromSerial directly.
      return (
        lastResult ?? {
          success: true,
          toLinesPicked: 0,
          toLinesKitted: 0,
          totalLines: 0,
        }
      )
    } catch (err) {
      logger.error('Error in PO-scoped sync:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Pure helper: compute aggregate progress + workflow step from a set
   * of RR_Kitting_DATA rows. Exported only so the per-serial and the
   * PO-fanout paths can stay in sync.
   */
  private static computeKitProgress(
    lines: Array<{
      kit_to_line_picked_date_time: string | null
      kit_to_line_kitted_date_time: string | null
      kit_inspection_completion_date_time: string | null
      kit_ready_on_dock_date_time: string | null
      // migration 325 — undefined for legacy callers that didn't select
      // the column; treated as not-cancelled.
      cancelled?: boolean | null
    }>
  ): {
    totalLines: number
    pickedCount: number
    kittedCount: number
    currentStep: string
  } {
    // Cancelled lines are excluded from totals so a cancelled TO
    // doesn't keep the kanban card stuck in "Picking 0/N" forever.
    // Inspection / on-dock signals are kept as-is — they're row-level
    // flags on the parent kit, not per-line. See [[Cancel-Kit-TO-Line]].
    const activeLines = lines.filter((l) => !l.cancelled)
    const totalLines = activeLines.length
    const pickedCount = activeLines.filter(
      (l) => l.kit_to_line_picked_date_time !== null
    ).length
    const kittedCount = activeLines.filter(
      (l) => l.kit_to_line_kitted_date_time !== null
    ).length
    const inspected = lines.some(
      (l) => l.kit_inspection_completion_date_time !== null
    )
    const onDock = lines.some((l) => l.kit_ready_on_dock_date_time !== null)

    let currentStep = 'planning'
    if (onDock) {
      currentStep = 'on_dock'
    } else if (inspected) {
      currentStep = 'inspection'
    } else if (
      kittedCount > 0 ||
      (pickedCount === totalLines && pickedCount > 0)
    ) {
      currentStep = 'kitting'
    } else if (pickedCount > 0) {
      currentStep = 'picking'
    }

    return { totalLines, pickedCount, kittedCount, currentStep }
  }

  /**
   * Create missing kanban tasks for existing kit build plans
   * This is a one-time utility to backfill kanban cards for kit build plans
   * that were created before the kanban integration was properly working
   */
  static async createMissingKanbanTasks(): Promise<{
    success: boolean
    created: number
    skipped: number
    errors: string[]
  }> {
    try {
      logger.log(
        '[KitKanbanService] Starting backfill of missing kanban tasks...'
      )

      // Ensure default columns exist
      const ensureResult = await this.ensureDefaultColumns()
      if (!ensureResult.success) {
        return {
          success: false,
          created: 0,
          skipped: 0,
          errors: [`Failed to setup kanban columns: ${ensureResult.error}`],
        }
      }
      if (ensureResult.created) {
        logger.log(
          '[KitKanbanService] createMissingKanbanTasks: Created default kanban columns'
        )
      }

      // Get the planning column
      const { data: columns } = await (
        db.from(this.COLUMNS_TABLE) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('id')
        .eq('column_name', 'planning')
        .limit(1)

      const columnsArray = columns as unknown as { id: string }[] | null
      if (!columnsArray || columnsArray.length === 0) {
        return {
          success: false,
          created: 0,
          skipped: 0,
          errors: ['Planning column not found'],
        }
      }

      const planningColumnId = columnsArray[0].id

      // Get all unique kit build plans from RR_Kitting_DATA
      // Group by kit_po_number + kit_number to get unique kits
      const { data: kitPlans, error: fetchError } = await (
        db.from('RR_Kitting_DATA') as ReturnType<(typeof supabase)['from']>
      )
        .select(
          'id, kit_po_number, kit_number, kit_build_number, kit_serial_number, kit_priority, due_date, transfer_order_number'
        )
        .order('kit_priority', { ascending: true })

      if (fetchError) {
        logger.error('[KitKanbanService] Error fetching kit plans:', fetchError)
        return {
          success: false,
          created: 0,
          skipped: 0,
          errors: [fetchError.message],
        }
      }

      if (!kitPlans || kitPlans.length === 0) {
        logger.log('[KitKanbanService] No kit plans found')
        return { success: true, created: 0, skipped: 0, errors: [] }
      }

      interface KitPlanRecord {
        id: string
        kit_po_number: string | null
        kit_number: string | null
        kit_build_number: string | null
        kit_serial_number: string | null
        kit_priority: number | null
        due_date: string | null
        transfer_order_number: string | null
      }

      const plans = kitPlans as unknown as KitPlanRecord[]

      // Group by kit_serial_number to get unique kits
      // Each unique kit (even with same PO number) has a unique serial number
      const uniqueKits = new Map<
        string,
        {
          id: string
          kitPoNumber: string
          kitNumber: string
          kitBuildNumber: string
          kitSerialNumber: string
          priority: number
          dueDate: string | null
          totalToLines: number
        }
      >()

      for (const plan of plans) {
        if (!plan.kit_po_number || !plan.kit_serial_number) continue

        // Use kit_serial_number as the unique key since it's stored in the kanban tasks table
        const key = plan.kit_serial_number

        if (!uniqueKits.has(key)) {
          uniqueKits.set(key, {
            id: plan.id,
            kitPoNumber: plan.kit_po_number,
            kitNumber: plan.kit_number || '',
            kitBuildNumber: plan.kit_build_number || '',
            kitSerialNumber: plan.kit_serial_number,
            priority: plan.kit_priority || 999,
            dueDate: plan.due_date,
            totalToLines: plan.transfer_order_number ? 1 : 0,
          })
        } else if (plan.transfer_order_number) {
          // Increment TO line count for this kit
          const existing = uniqueKits.get(key)!
          existing.totalToLines++
        }
      }

      logger.log(
        `[KitKanbanService] Found ${uniqueKits.size} unique kit build plans`
      )

      // Get existing kanban tasks to check what's missing
      // Use kit_serial_number since that's the unique identifier stored in the table
      const { data: existingTasks } = await (
        db.from(this.TASKS_TABLE) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      ).select('kit_serial_number')

      const existingTaskKeys = new Set<string>()
      if (existingTasks) {
        for (const task of existingTasks as unknown as {
          kit_serial_number: string | null
        }[]) {
          if (task.kit_serial_number) {
            existingTaskKeys.add(task.kit_serial_number)
          }
        }
      }

      logger.log(
        `[KitKanbanService] Found ${existingTaskKeys.size} existing kanban tasks`
      )

      // Create missing kanban tasks
      let created = 0
      let skipped = 0
      const errors: string[] = []

      // Get current max position in planning column
      const { data: maxPosData } = await (
        db.from(this.TASKS_TABLE) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('position_in_column')
        .eq('column_id', planningColumnId)
        .order('position_in_column', { ascending: false })
        .limit(1)

      let nextPosition =
        maxPosData &&
        (maxPosData as unknown as { position_in_column: number }[]).length > 0
          ? (maxPosData as unknown as { position_in_column: number }[])[0]
              .position_in_column + 1
          : 0

      for (const [serialNumber, kit] of uniqueKits) {
        if (existingTaskKeys.has(serialNumber)) {
          skipped++
          continue
        }

        // Create the missing kanban task (no organization_id or kit_number needed in this table)
        const { error: insertError } = await (
          db.from(this.TASKS_TABLE) as unknown as ReturnType<
            (typeof supabase)['from']
          >
        ).insert({
          task_title: `${kit.kitSerialNumber || 'N/A'} - ${kit.kitPoNumber}`,
          kit_build_plan_id: kit.id,
          kit_serial_number: kit.kitSerialNumber || null,
          kit_po_number: kit.kitPoNumber,
          kit_build_number: kit.kitBuildNumber || null,
          column_id: planningColumnId,
          position_in_column: nextPosition++,
          priority: kit.priority,
          total_to_lines: kit.totalToLines,
          to_lines_picked: 0,
          to_lines_kitted: 0,
          current_step: 'planning',
          due_date: kit.dueDate || null,
        } as never)

        if (insertError) {
          logger.error(
            `[KitKanbanService] Error creating task for ${kit.kitPoNumber}:`,
            insertError
          )
          errors.push(`${kit.kitPoNumber}: ${insertError.message}`)
        } else {
          created++
          logger.log(
            `[KitKanbanService] Created kanban task for kit ${kit.kitPoNumber}`
          )
        }
      }

      logger.log(
        `[KitKanbanService] Backfill complete: ${created} created, ${skipped} skipped, ${errors.length} errors`
      )
      return { success: true, created, skipped, errors }
    } catch (err) {
      logger.error('[KitKanbanService] Error in createMissingKanbanTasks:', err)
      return {
        success: false,
        created: 0,
        skipped: 0,
        errors: [err instanceof Error ? err.message : 'Unknown error'],
      }
    }
  }

  /**
   * Sync all in-progress kanban tasks from RR_Kitting_DATA
   * Call this on board load to reconcile any stale data from tasks
   * that were worked on before the sync mechanism was implemented
   */
  static async syncAllInProgressTasks(): Promise<{
    success: boolean
    synced: number
    errors: number
  }> {
    try {
      logger.log(
        '📊 KitKanbanService: Starting batch sync of all in-progress tasks'
      )

      // Get all tasks that are not in planning or completed steps
      const { data: tasks, error } = await (
        db.from(this.TASKS_TABLE) as unknown as ReturnType<
          (typeof supabase)['from']
        >
      )
        .select('kit_serial_number, current_step')
        .not('current_step', 'eq', 'completed')

      if (error) {
        logger.error('Error fetching tasks for batch sync:', error)
        return { success: false, synced: 0, errors: 1 }
      }

      if (!tasks || tasks.length === 0) {
        logger.log('📊 KitKanbanService: No tasks to sync')
        return { success: true, synced: 0, errors: 0 }
      }

      interface TaskRecord {
        kit_serial_number: string | null
        current_step: string | null
      }

      const taskRecords = tasks as unknown as TaskRecord[]
      let synced = 0
      let errors = 0

      // Sync each task's progress per kit serial so kits sharing a PO
      // do not collapse into a single aggregated card.
      for (const task of taskRecords) {
        if (!task.kit_serial_number) continue

        const result = await this.syncKitProgressFromSerial(
          task.kit_serial_number
        )
        if (result.success) {
          synced++
        } else {
          errors++
          logger.warn(
            `⚠️ Failed to sync task ${task.kit_serial_number}:`,
            result.error
          )
        }
      }

      logger.log(
        `✅ KitKanbanService: Batch sync complete - ${synced} synced, ${errors} errors`
      )
      return { success: true, synced, errors }
    } catch (err) {
      logger.error('Error in batch sync:', err)
      return { success: false, synced: 0, errors: 1 }
    }
  }
}

// Created and developed by Jai Singh
