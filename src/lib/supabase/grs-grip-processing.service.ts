// Created and developed by Jai Singh
import type { QueryData } from '@supabase/supabase-js'
import { logger } from '@/lib/utils/logger'
import { getTodayEST } from '@/lib/utils/timezone'
import { supabase } from './client'
import type { Tables } from './database.types'

// Define the table row type for GRS GRIP processing operations
export type GRSGRIPProcessingData = Tables<'rr_grsgrip_processing'>

// Define the query for fetching GRS GRIP processing operations with user profile joins
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const grsGripProcessingQuery = supabase.from('rr_grsgrip_processing').select(`
    *,
    created_by_user:user_profiles!created_by(
      id,
      full_name,
      email
    )
  `)

export type GRSGRIPProcessingWithUser = QueryData<typeof grsGripProcessingQuery>

// Statistics interface for GRS GRIP processing operations
export interface GRSGRIPProcessingStatistics {
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

// Service class for GRS GRIP processing operations
export class GRSGRIPProcessingService {
  private static instance: GRSGRIPProcessingService

  private constructor() {}

  public static getInstance(): GRSGRIPProcessingService {
    if (!GRSGRIPProcessingService.instance) {
      GRSGRIPProcessingService.instance = new GRSGRIPProcessingService()
    }
    return GRSGRIPProcessingService.instance
  }

  // Fetch all GRS GRIP processing operations
  async fetchGRSGRIPProcessingOperations(): Promise<{
    data: GRSGRIPProcessingWithUser
    error: any
  }> {
    try {
      const { data, error } = await supabase
        .from('rr_grsgrip_processing')
        .select(
          `
          *,
          created_by_user:user_profiles!created_by(
            id,
            full_name,
            email
          )
        `
        )
        .order('created_at', { ascending: false })

      return { data: data || [], error }
    } catch (error) {
      logger.error('Error fetching GRS GRIP processing operations:', error)
      return { data: [], error }
    }
  }

  // Fetch statistics for GRS GRIP processing operations
  async fetchStatistics(): Promise<{
    statistics: GRSGRIPProcessingStatistics | null
    error: any
  }> {
    try {
      // Use RPC function for optimized statistics calculation
      const { data, error } = await supabase.rpc(
        'get_grs_grip_processing_statistics'
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
      const stats: GRSGRIPProcessingStatistics = {
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
    statistics: GRSGRIPProcessingStatistics | null
    error: any
  }> {
    try {
      const { data, error } = await supabase
        .from('rr_grsgrip_processing')
        .select('*')

      if (error || !data) {
        return { statistics: null, error }
      }

      // Use EST timezone for accurate "today" calculation
      const today = getTodayEST()
      logger.log(`📅 GRS GRIP Statistics: Using EST date - Today: ${today}`)

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

      // GRS GRIP stage breakdown
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

      const statistics: GRSGRIPProcessingStatistics = {
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

      // Column mapping - flexible header matching for GRS GRIP processing operations
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
        const batch = batches[batchIndex]
        const gripProcessingData: Partial<GRSGRIPProcessingData>[] = []

        for (const row of batch) {
          const columns = row.split('\t')

          try {
            const gripOperation: Partial<GRSGRIPProcessingData> = {}

            // Map columns to GRS GRIP processing fields
            if (columnMapping.materialNumber !== -1)
              gripOperation.material_number =
                columns[columnMapping.materialNumber]?.trim() || null
            if (columnMapping.batchNumber !== -1)
              gripOperation.batch_number =
                columns[columnMapping.batchNumber]?.trim() || null
            if (columnMapping.warehouseNumber !== -1)
              gripOperation.warehouse_number =
                columns[columnMapping.warehouseNumber]?.trim() || null
            if (columnMapping.processingLocation !== -1)
              gripOperation.processing_location =
                columns[columnMapping.processingLocation]?.trim() || null
            if (columnMapping.processedBy !== -1)
              gripOperation.processed_by =
                columns[columnMapping.processedBy]?.trim() || null
            if (columnMapping.processingType !== -1)
              gripOperation.processing_type =
                columns[columnMapping.processingType]?.trim() || null
            if (columnMapping.processingStatus !== -1)
              gripOperation.processing_status =
                columns[columnMapping.processingStatus]?.trim() || 'Pending'
            if (columnMapping.isQualityHold !== -1) {
              const holdValue = columns[columnMapping.isQualityHold]
                ?.trim()
                .toUpperCase()
              gripOperation.is_quality_hold =
                holdValue === 'TRUE' || holdValue === 'YES' || holdValue === '1'
            }
            if (columnMapping.qualityHoldReason !== -1)
              gripOperation.quality_hold_reason =
                columns[columnMapping.qualityHoldReason]?.trim() || null
            if (columnMapping.receivedQuantity !== -1) {
              const qty = columns[columnMapping.receivedQuantity]?.trim()
              gripOperation.received_quantity = qty ? parseFloat(qty) : null
            }
            if (columnMapping.processedQuantity !== -1) {
              const qty = columns[columnMapping.processedQuantity]?.trim()
              gripOperation.processed_quantity = qty ? parseFloat(qty) : null
            }
            if (columnMapping.rejectedQuantity !== -1) {
              const qty = columns[columnMapping.rejectedQuantity]?.trim()
              gripOperation.rejected_quantity = qty ? parseFloat(qty) : null
            }
            if (columnMapping.unitOfMeasure !== -1)
              gripOperation.unit_of_measure =
                columns[columnMapping.unitOfMeasure]?.trim() || null
            if (columnMapping.gripWorkflowType !== -1)
              gripOperation.grip_workflow_type =
                columns[columnMapping.gripWorkflowType]?.trim() || null
            if (columnMapping.gripStage !== -1)
              gripOperation.grip_stage =
                columns[columnMapping.gripStage]?.trim() || null
            if (columnMapping.gripPriority !== -1)
              gripOperation.grip_priority =
                columns[columnMapping.gripPriority]?.trim() || 'NORMAL'
            if (columnMapping.supplierBatchInfo !== -1)
              gripOperation.supplier_batch_info =
                columns[columnMapping.supplierBatchInfo]?.trim() || null
            if (columnMapping.notes !== -1)
              gripOperation.notes = columns[columnMapping.notes]?.trim() || null

            gripProcessingData.push(gripOperation)
          } catch (rowError) {
            const errorMessage =
              rowError instanceof Error ? rowError.message : String(rowError)
            errors.push(`Row ${processedCount + 1}: ${errorMessage}`)
          }

          processedCount++
        }

        // Insert batch into database
        if (gripProcessingData.length > 0) {
          const { error: insertError } = await supabase
            .from('rr_grsgrip_processing')
            .insert(gripProcessingData as any)

          if (insertError) {
            errors.push(`Batch ${batchIndex + 1}: ${insertError.message}`)
          }
        }

        // Update progress
        const progressPercentage =
          Math.round((processedCount / totalRows) * 60) + 40
        onProgress?.({
          phase: 'Inserting data',
          current: 3,
          total: 5,
          percentage: progressPercentage,
          message: `Processed ${processedCount} of ${totalRows} rows...`,
        })

        yield {
          success: errors.length === 0,
          processed: processedCount,
          total: totalRows,
          errors,
        }
      }

      // Phase 5: Complete
      onProgress?.({
        phase: 'Import complete',
        current: 5,
        total: 5,
        percentage: 100,
        message: `Successfully imported ${processedCount} GRS GRIP processing operations`,
      })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      errors.push(`Import failed: ${errorMessage}`)
      yield {
        success: false,
        processed: 0,
        total: 0,
        errors,
      }
    }
  }

  // Helper method to create flexible column mapping
  private createColumnMapping(headers: string[]) {
    const normalizedHeaders = headers.map((h) =>
      h.toLowerCase().replace(/[^a-z0-9]/g, '')
    )

    const mapping = {
      materialNumber: -1,
      batchNumber: -1,
      warehouseNumber: -1,
      processingLocation: -1,
      processedBy: -1,
      processingType: -1,
      processingStatus: -1,
      isQualityHold: -1,
      qualityHoldReason: -1,
      receivedQuantity: -1,
      processedQuantity: -1,
      rejectedQuantity: -1,
      unitOfMeasure: -1,
      gripWorkflowType: -1,
      gripStage: -1,
      gripPriority: -1,
      supplierBatchInfo: -1,
      notes: -1,
    }

    // Find column indices - flexible matching
    normalizedHeaders.forEach((header, index) => {
      if (header.includes('material') && header.includes('number'))
        mapping.materialNumber = index
      else if (
        header.includes('batch') &&
        (header.includes('number') || header.includes('no'))
      )
        mapping.batchNumber = index
      else if (header.includes('warehouse') || header.includes('whse'))
        mapping.warehouseNumber = index
      else if (header.includes('location') || header.includes('loc'))
        mapping.processingLocation = index
      else if (header.includes('processed') && header.includes('by'))
        mapping.processedBy = index
      else if (header.includes('processing') && header.includes('type'))
        mapping.processingType = index
      else if (header.includes('status')) mapping.processingStatus = index
      else if (header.includes('quality') && header.includes('hold'))
        mapping.isQualityHold = index
      else if (header.includes('hold') && header.includes('reason'))
        mapping.qualityHoldReason = index
      else if (header.includes('received') && header.includes('qty'))
        mapping.receivedQuantity = index
      else if (header.includes('processed') && header.includes('qty'))
        mapping.processedQuantity = index
      else if (header.includes('rejected') && header.includes('qty'))
        mapping.rejectedQuantity = index
      else if (header.includes('unit') || header.includes('uom'))
        mapping.unitOfMeasure = index
      else if (header.includes('workflow')) mapping.gripWorkflowType = index
      else if (header.includes('stage')) mapping.gripStage = index
      else if (header.includes('priority')) mapping.gripPriority = index
      else if (
        header.includes('supplier') ||
        (header.includes('batch') && header.includes('info'))
      )
        mapping.supplierBatchInfo = index
      else if (header.includes('note') || header.includes('comment'))
        mapping.notes = index
    })

    return mapping
  }

  // Create a new GRS GRIP processing operation
  async createGRSGRIPProcessingOperation(
    data: Partial<GRSGRIPProcessingData>
  ): Promise<{ data: GRSGRIPProcessingData | null; error: any }> {
    try {
      const { data: newOperation, error } = await supabase
        .from('rr_grsgrip_processing')
        .insert(data as any)
        .select()
        .single()

      return { data: newOperation, error }
    } catch (error) {
      logger.error('Error creating GRS GRIP processing operation:', error)
      return { data: null, error }
    }
  }

  // Update a GRS GRIP processing operation
  async updateGRSGRIPProcessingOperation(
    id: string,
    data: Partial<GRSGRIPProcessingData>
  ): Promise<{ data: GRSGRIPProcessingData | null; error: any }> {
    try {
      const { data: updatedOperation, error } = await supabase
        .from('rr_grsgrip_processing')
        .update(data)
        .eq('id', id)
        .select()
        .single()

      return { data: updatedOperation, error }
    } catch (error) {
      logger.error('Error updating GRS GRIP processing operation:', error)
      return { data: null, error }
    }
  }

  // Delete a GRS GRIP processing operation
  async deleteGRSGRIPProcessingOperation(
    id: string
  ): Promise<{ success: boolean; error: any }> {
    try {
      const { error } = await supabase
        .from('rr_grsgrip_processing')
        .delete()
        .eq('id', id)

      return { success: !error, error }
    } catch (error) {
      logger.error('Error deleting GRS GRIP processing operation:', error)
      return { success: false, error }
    }
  }

  // Search GRS GRIP processing operations with filters
  searchGRSGRIPProcessingOperations(
    data: GRSGRIPProcessingWithUser,
    searchQuery: string
  ): GRSGRIPProcessingWithUser {
    if (!searchQuery.trim()) return data

    const query = searchQuery.toLowerCase()

    return data.filter((operation) => {
      return (
        operation.material_number?.toLowerCase().includes(query) ||
        operation.batch_number?.toLowerCase().includes(query) ||
        operation.warehouse_number?.toLowerCase().includes(query) ||
        operation.processing_location?.toLowerCase().includes(query) ||
        operation.processed_by?.toLowerCase().includes(query) ||
        operation.processing_type?.toLowerCase().includes(query) ||
        operation.processing_status?.toLowerCase().includes(query) ||
        operation.grip_stage?.toLowerCase().includes(query) ||
        operation.grip_priority?.toLowerCase().includes(query) ||
        operation.supplier_batch_info?.toLowerCase().includes(query) ||
        operation.notes?.toLowerCase().includes(query)
      )
    })
  }

  // Export data to CSV
  exportToCSV(data: GRSGRIPProcessingWithUser): string {
    if (data.length === 0) return ''

    // Define CSV headers
    const headers = [
      'Processing Date',
      'Material Number',
      'Batch Number',
      'Warehouse',
      'Location',
      'Processed By',
      'Processing Type',
      'Status',
      'Quality Hold',
      'Hold Reason',
      'Received Qty',
      'Processed Qty',
      'Rejected Qty',
      'UOM',
      'Workflow Type',
      'Stage',
      'Priority',
      'Supplier Info',
      'Notes',
      'Created By',
    ]

    // Create CSV content
    const rows = data.map((op) => [
      op.created_at ? new Date(op.created_at).toLocaleString() : '',
      op.material_number || '',
      op.batch_number || '',
      op.warehouse_number || '',
      op.processing_location || '',
      op.processed_by || '',
      op.processing_type || '',
      op.processing_status || '',
      op.is_quality_hold ? 'Yes' : 'No',
      op.quality_hold_reason || '',
      op.received_quantity?.toString() || '',
      op.processed_quantity?.toString() || '',
      op.rejected_quantity?.toString() || '',
      op.unit_of_measure || '',
      op.grip_workflow_type || '',
      op.grip_stage || '',
      op.grip_priority || '',
      op.supplier_batch_info || '',
      op.notes || '',
      op.created_by_user?.full_name || '',
    ])

    // Combine headers and rows
    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n')

    return csvContent
  }
}

// Export singleton instance
export const grsGripProcessingService = GRSGRIPProcessingService.getInstance()

// Created and developed by Jai Singh
