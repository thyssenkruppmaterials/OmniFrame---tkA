import type { QueryData } from '@supabase/supabase-js'
import { logger } from '@/lib/utils/logger'
import { getTodayEST } from '@/lib/utils/timezone'
import { supabase } from './client'
import type { Tables } from './database.types'

// Define the table row type for GRIP processing operations
export type GRIPProcessingData = Tables<'rr_grip_processing'>

// Define the query for fetching GRIP processing operations with user profile joins
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const gripProcessingQuery = supabase.from('rr_grip_processing').select(`
    *,
    confirmed_by_user:user_profiles!confirmed_by(
      id,
      full_name,
      email
    )
  `)

export type GRIPProcessingWithUser = QueryData<typeof gripProcessingQuery>

// Statistics interface for GRIP processing operations
export interface GRIPProcessingStatistics {
  totalProcessing: number
  todayProcessing: number
  uniqueMaterials: number
  uniqueOperators: number
  qualityHoldProcessing: number
  completedProcessing: number
  averageCompletionTimeHours: number | null
  statusBreakdown: Record<string, number>
  warehouseDistribution: Record<string, number>
  gripStageBreakdown: Record<string, number>
  priorityBreakdown: Record<string, number>
}

// Import progress interface
export interface ImportProgress {
  phase: string
  current: number
  total: number
  percentage: number
  message: string
}

// Service class for GRIP processing operations
export class GRIPProcessingService {
  private static instance: GRIPProcessingService

  private constructor() {}

  public static getInstance(): GRIPProcessingService {
    if (!GRIPProcessingService.instance) {
      GRIPProcessingService.instance = new GRIPProcessingService()
    }
    return GRIPProcessingService.instance
  }

  // Fetch all GRIP processing operations
  async fetchGRIPProcessingOperations(): Promise<{
    data: GRIPProcessingWithUser
    error: any
  }> {
    try {
      const { data, error } = await supabase
        .from('rr_grip_processing')
        .select(
          `
          *,
          confirmed_by_user:user_profiles!confirmed_by(
            id,
            full_name,
            email
          )
        `
        )
        .order('created_at', { ascending: false })

      return { data: data || [], error }
    } catch (error) {
      logger.error('Error fetching GRIP processing operations:', error)
      return { data: [], error }
    }
  }

  // Fetch statistics for GRIP processing operations
  async fetchStatistics(): Promise<{
    statistics: GRIPProcessingStatistics | null
    error: any
  }> {
    try {
      // Use RPC function for optimized statistics calculation
      const { data, error } = await supabase.rpc(
        'get_grip_processing_statistics'
      )

      if (error) {
        // Fallback to client-side calculation if RPC function doesn't exist
        logger.warn(
          'RPC function not found, calculating statistics client-side'
        )
        return this.calculateStatisticsClientSide()
      }

      // Transform the RPC result to match our interface
      const rpcData = data as any
      const stats: GRIPProcessingStatistics = {
        totalProcessing: rpcData?.total_processing || 0,
        todayProcessing: rpcData?.today_processing || 0,
        uniqueMaterials: rpcData?.unique_materials || 0,
        uniqueOperators: rpcData?.unique_operators || 0,
        qualityHoldProcessing: rpcData?.quality_hold_processing || 0,
        completedProcessing: rpcData?.completed_processing || 0,
        averageCompletionTimeHours:
          rpcData?.average_completion_time_hours || null,
        statusBreakdown: rpcData?.status_breakdown || {},
        warehouseDistribution: rpcData?.warehouse_distribution || {},
        gripStageBreakdown: rpcData?.grip_stage_breakdown || {},
        priorityBreakdown: rpcData?.priority_breakdown || {},
      }

      return { statistics: stats, error: null }
    } catch (error) {
      logger.error('Error fetching statistics:', error)
      return { statistics: null, error }
    }
  }

  // Fallback statistics calculation
  private async calculateStatisticsClientSide(): Promise<{
    statistics: GRIPProcessingStatistics | null
    error: any
  }> {
    try {
      const { data, error } = await supabase
        .from('rr_grip_processing')
        .select('*')

      if (error || !data) {
        return { statistics: null, error }
      }

      // Use EST timezone for accurate "today" calculation
      const today = getTodayEST()
      logger.log(`📅 GRIP Statistics: Using EST date - Today: ${today}`)

      const todayProcessing = data.filter(
        (op) => op.created_at && op.created_at.startsWith(today)
      ).length

      const uniqueMaterials = new Set(
        data.filter((op) => op.material_number).map((op) => op.material_number)
      ).size

      const uniqueOperators = new Set(
        data.filter((op) => op.processed_by).map((op) => op.processed_by)
      ).size

      const qualityHoldProcessing = data.filter(
        (op) => op.is_quality_hold === true
      ).length
      const completedProcessing = data.filter(
        (op) => op.processing_status === 'Completed'
      ).length

      // Calculate average completion time in hours
      const completedOps = data.filter(
        (op) => op.processing_completed_at && op.processing_started_at
      )

      let averageCompletionTimeHours: number | null = null
      if (completedOps.length > 0) {
        const totalHours = completedOps.reduce((sum, op) => {
          const start = new Date(op.processing_started_at!).getTime()
          const end = new Date(op.processing_completed_at!).getTime()
          return sum + (end - start) / (1000 * 60 * 60) // Convert to hours
        }, 0)
        averageCompletionTimeHours = totalHours / completedOps.length
      }

      // Status breakdown
      const statusBreakdown: Record<string, number> = {}
      data.forEach((op) => {
        const status = op.processing_status || 'Unknown'
        statusBreakdown[status] = (statusBreakdown[status] || 0) + 1
      })

      // Warehouse distribution
      const warehouseDistribution: Record<string, number> = {}
      data.forEach((op) => {
        const warehouse = op.warehouse_number || 'Unknown'
        warehouseDistribution[warehouse] =
          (warehouseDistribution[warehouse] || 0) + 1
      })

      // GRIP stage breakdown
      const gripStageBreakdown: Record<string, number> = {}
      data.forEach((op) => {
        const stage = op.grip_stage || 'Unknown'
        gripStageBreakdown[stage] = (gripStageBreakdown[stage] || 0) + 1
      })

      // Priority breakdown
      const priorityBreakdown: Record<string, number> = {}
      data.forEach((op) => {
        const priority = op.grip_priority || 'NORMAL'
        priorityBreakdown[priority] = (priorityBreakdown[priority] || 0) + 1
      })

      const statistics: GRIPProcessingStatistics = {
        totalProcessing: data.length,
        todayProcessing,
        uniqueMaterials,
        uniqueOperators,
        qualityHoldProcessing,
        completedProcessing,
        averageCompletionTimeHours,
        statusBreakdown,
        warehouseDistribution,
        gripStageBreakdown,
        priorityBreakdown,
      }

      return { statistics, error: null }
    } catch (error) {
      logger.error('Error calculating statistics:', error)
      return { statistics: null, error }
    }
  }

  // Import from clipboard functionality (adapted from putaway log service)
  async *importFromClipboard(
    onProgress?: (progress: ImportProgress) => void
  ): AsyncGenerator<{
    success: boolean
    processed: number
    total: number
    errors: string[]
  }> {
    const errors: string[] = []

    try {
      // Phase 1: Parse clipboard data
      onProgress?.({
        phase: 'Parsing clipboard data',
        current: 0,
        total: 5,
        percentage: 0,
        message: 'Reading clipboard contents...',
      })

      const clipboardText = await navigator.clipboard.readText()
      if (!clipboardText.trim()) {
        throw new Error('Clipboard is empty')
      }

      const lines = clipboardText.trim().split('\n')
      if (lines.length < 2) {
        throw new Error(
          'Invalid data format: Need at least header and one data row'
        )
      }

      // Phase 2: Validate headers
      onProgress?.({
        phase: 'Validating data structure',
        current: 1,
        total: 5,
        percentage: 20,
        message: 'Validating column headers...',
      })

      const headers = lines[0].split('\t').map((h) => h.trim())
      const dataRows = lines.slice(1).filter((line) => line.trim())

      // Column mapping - flexible header matching for GRIP processing operations
      const columnMapping = this.createColumnMapping(headers)

      // Phase 3: Process data rows
      onProgress?.({
        phase: 'Processing data rows',
        current: 2,
        total: 5,
        percentage: 40,
        message: `Processing ${dataRows.length} rows...`,
      })

      const batchSize = 500
      const batches = []

      for (let i = 0; i < dataRows.length; i += batchSize) {
        batches.push(dataRows.slice(i, i + batchSize))
      }

      let processedCount = 0
      const totalRows = dataRows.length

      // Phase 4: Insert data in batches
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        onProgress?.({
          phase: 'Inserting data',
          current: 3,
          total: 5,
          percentage: 60 + (batchIndex / batches.length) * 30,
          message: `Inserting batch ${batchIndex + 1} of ${batches.length}...`,
        })

        const batch = batches[batchIndex]
        const batchData: Partial<GRIPProcessingData>[] = []

        for (const row of batch) {
          try {
            const values = row.split('\t')
            const gripData = this.mapRowToGRIPData(values, columnMapping)
            if (gripData) {
              batchData.push(gripData)
            }
          } catch (error) {
            errors.push(
              `Row ${processedCount + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`
            )
          }
          processedCount++
        }

        if (batchData.length > 0) {
          const { error } = await supabase
            .from('rr_grip_processing')
            .insert(batchData as Tables<'rr_grip_processing'>[])

          if (error) {
            errors.push(`Batch ${batchIndex + 1}: ${error.message}`)
          }
        }

        yield {
          success: true,
          processed: processedCount,
          total: totalRows,
          errors: [...errors],
        }
      }

      // Phase 5: Complete
      onProgress?.({
        phase: 'Import complete',
        current: 5,
        total: 5,
        percentage: 100,
        message: `Successfully imported ${processedCount - errors.length} records`,
      })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred'
      errors.push(`Import failed: ${errorMessage}`)

      yield {
        success: false,
        processed: 0,
        total: 0,
        errors,
      }
    }
  }

  // Create column mapping for flexible header matching
  private createColumnMapping(headers: string[]): Record<string, number> {
    const mapping: Record<string, number> = {}

    const fieldMappings = {
      material_number: [
        'material number',
        'material_number',
        'material',
        'part number',
        'part_number',
      ],
      batch_number: [
        'batch number',
        'batch_number',
        'batch',
        'lot number',
        'lot_number',
      ],
      warehouse_number: [
        'warehouse',
        'warehouse_number',
        'wh',
        'warehouse number',
      ],
      processing_location: [
        'processing location',
        'processing_location',
        'location',
        'grip location',
      ],
      processed_by: [
        'processed by',
        'processed_by',
        'operator',
        'processor',
        'grip operator',
      ],
      processing_type: [
        'processing type',
        'processing_type',
        'type',
        'grip type',
      ],
      processing_status: ['status', 'processing_status', 'grip status'],
      is_quality_hold: ['quality hold', 'is_quality_hold', 'hold', 'on hold'],
      quality_hold_reason: ['hold reason', 'quality_hold_reason', 'reason'],
      received_quantity: [
        'received qty',
        'received_quantity',
        'received quantity',
        'qty received',
      ],
      processed_quantity: [
        'processed qty',
        'processed_quantity',
        'processed quantity',
        'qty processed',
      ],
      rejected_quantity: [
        'rejected qty',
        'rejected_quantity',
        'rejected quantity',
        'qty rejected',
      ],
      unit_of_measure: ['unit', 'unit_of_measure', 'uom', 'unit of measure'],
      grip_workflow_type: [
        'workflow type',
        'grip_workflow_type',
        'workflow',
        'grip workflow',
      ],
      grip_stage: ['stage', 'grip_stage', 'grip stage', 'processing stage'],
      grip_priority: ['priority', 'grip_priority', 'grip priority'],
      supplier_batch_info: [
        'supplier batch',
        'supplier_batch_info',
        'supplier info',
      ],
      notes: ['notes', 'comments', 'remarks'],
    }

    headers.forEach((header, index) => {
      const normalizedHeader = header.toLowerCase().trim()

      for (const [field, variations] of Object.entries(fieldMappings)) {
        if (
          variations.some(
            (variation) =>
              normalizedHeader === variation ||
              normalizedHeader.includes(variation)
          )
        ) {
          mapping[field] = index
          break
        }
      }
    })

    return mapping
  }

  // Map row data to GRIP processing data object
  private mapRowToGRIPData(
    values: string[],
    mapping: Record<string, number>
  ): Partial<GRIPProcessingData> | null {
    try {
      // Create accurate timestamp - store proper UTC for correct timezone handling
      const now = new Date()
      const utcISOString = now.toISOString()

      logger.log('🕐 GRIP Processing Service: Corrected Timestamp Capture:', {
        utcISOString,
        localTime: now.toLocaleString('en-US', {
          timeZone: 'America/New_York',
        }),
        note: 'Storing proper UTC, database will display in user timezone',
      })

      const gripData: Partial<GRIPProcessingData> = {
        organization_id: '', // This will be set by RLS or application logic
        created_by: '', // This will be set by the application
        created_at: utcISOString,
        processing_started_at: utcISOString,
      }

      // Map values based on column mapping
      for (const [field, columnIndex] of Object.entries(mapping)) {
        if (columnIndex < values.length && values[columnIndex]?.trim()) {
          const value = values[columnIndex].trim()

          switch (field) {
            case 'is_quality_hold':
              gripData.is_quality_hold = ['true', 'yes', '1', 'y'].includes(
                value.toLowerCase()
              )
              break
            case 'received_quantity':
            case 'processed_quantity':
            case 'rejected_quantity':
              // eslint-disable-next-line no-case-declarations
              const numValue = parseFloat(value)
              if (!isNaN(numValue)) {
                ;(gripData as any)[field] = numValue
              }
              break
            default:
              ;(gripData as any)[field] = value
          }
        }
      }

      // Validate required fields
      const hasRequiredFields =
        gripData.material_number &&
        gripData.processing_location &&
        gripData.processed_by

      if (!hasRequiredFields) {
        throw new Error(
          'Missing required fields (material_number, processing_location, or processed_by)'
        )
      }

      return gripData
    } catch (error) {
      logger.error('Error mapping row data:', error)
      return null
    }
  }

  // Search functionality for filtering GRIP processing operations
  searchGRIPProcessingOperations(
    operations: GRIPProcessingWithUser,
    searchQuery: string
  ): GRIPProcessingWithUser {
    if (!searchQuery.trim()) {
      return operations
    }

    const query = searchQuery.toLowerCase()

    return operations.filter((op) => {
      return (
        op.material_number?.toLowerCase().includes(query) ||
        op.batch_number?.toLowerCase().includes(query) ||
        op.warehouse_number?.toLowerCase().includes(query) ||
        op.processing_location?.toLowerCase().includes(query) ||
        op.processed_by?.toLowerCase().includes(query) ||
        op.processing_type?.toLowerCase().includes(query) ||
        op.processing_status?.toLowerCase().includes(query) ||
        op.quality_hold_reason?.toLowerCase().includes(query) ||
        op.grip_workflow_type?.toLowerCase().includes(query) ||
        op.grip_stage?.toLowerCase().includes(query) ||
        op.grip_priority?.toLowerCase().includes(query) ||
        op.supplier_batch_info?.toLowerCase().includes(query) ||
        op.notes?.toLowerCase().includes(query)
      )
    })
  }

  // Create a new GRIP processing operation
  async createGRIPProcessingOperation(
    operationData: Partial<GRIPProcessingData>
  ): Promise<{ data: GRIPProcessingData | null; error: any }> {
    try {
      const { data, error } = await supabase
        .from('rr_grip_processing')
        .insert(operationData as Tables<'rr_grip_processing'>)
        .select()
        .single()

      return { data, error }
    } catch (error) {
      logger.error('Error creating GRIP processing operation:', error)
      return { data: null, error }
    }
  }

  // Update an existing GRIP processing operation
  async updateGRIPProcessingOperation(
    id: string,
    updates: Partial<GRIPProcessingData>
  ): Promise<{ data: GRIPProcessingData | null; error: any }> {
    try {
      const { data, error } = await supabase
        .from('rr_grip_processing')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      return { data, error }
    } catch (error) {
      logger.error('Error updating GRIP processing operation:', error)
      return { data: null, error }
    }
  }

  // Delete a GRIP processing operation
  async deleteGRIPProcessingOperation(
    id: string
  ): Promise<{ success: boolean; error: any }> {
    try {
      const { error } = await supabase
        .from('rr_grip_processing')
        .delete()
        .eq('id', id)

      return { success: !error, error }
    } catch (error) {
      logger.error('Error deleting GRIP processing operation:', error)
      return { success: false, error }
    }
  }

  // Export data to CSV
  exportToCSV(operations: GRIPProcessingWithUser): string {
    const headers = [
      'ID',
      'Material Number',
      'Batch Number',
      'Warehouse Number',
      'Processing Location',
      'Processed By',
      'Processing Type',
      'Status',
      'Quality Hold',
      'Hold Reason',
      'Received Qty',
      'Processed Qty',
      'Rejected Qty',
      'Unit of Measure',
      'Workflow Type',
      'GRIP Stage',
      'Priority',
      'Supplier Batch Info',
      'Notes',
      'Created At',
      'Processing Started',
      'Processing Completed',
    ]

    const csvContent = [
      headers.join(','),
      ...operations.map((op) =>
        [
          `"${op.id}"`,
          `"${op.material_number || ''}"`,
          `"${op.batch_number || ''}"`,
          `"${op.warehouse_number || ''}"`,
          `"${op.processing_location || ''}"`,
          `"${op.processed_by || ''}"`,
          `"${op.processing_type || ''}"`,
          `"${op.processing_status || ''}"`,
          `"${op.is_quality_hold ? 'Yes' : 'No'}"`,
          `"${op.quality_hold_reason || ''}"`,
          `"${op.received_quantity || ''}"`,
          `"${op.processed_quantity || ''}"`,
          `"${op.rejected_quantity || ''}"`,
          `"${op.unit_of_measure || ''}"`,
          `"${op.grip_workflow_type || ''}"`,
          `"${op.grip_stage || ''}"`,
          `"${op.grip_priority || ''}"`,
          `"${op.supplier_batch_info || ''}"`,
          `"${op.notes || ''}"`,
          `"${op.created_at ? new Date(op.created_at).toLocaleString() : ''}"`,
          `"${op.processing_started_at ? new Date(op.processing_started_at).toLocaleString() : ''}"`,
          `"${op.processing_completed_at ? new Date(op.processing_completed_at).toLocaleString() : ''}"`,
        ].join(',')
      ),
    ].join('\n')

    return csvContent
  }
}

// Export singleton instance
export const gripProcessingService = GRIPProcessingService.getInstance()
// Developer and Creator: Jai Singh
