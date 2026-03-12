/**
 * Cycle Count Data Service
 * Handles all cycle count related database operations
 * Follows OmniFrame service patterns and integrates with Supabase
 */
import { logger } from '@/lib/utils/logger'
import { getTodayEST } from '@/lib/utils/timezone'
import { supabase } from './client'
import type { Database, Tables } from './database.types'

export type CycleCountData = Tables<'rr_cyclecount_data'>

// Define the query for fetching cycle count data with user profile joins
// Removed unused cycleCountDataQuery - was using deprecated QueryData type

// CycleCountDataWithUser type - includes user profile data from joins
export type CycleCountDataWithUser = CycleCountData & {
  created_by_user?: { full_name: string; email: string }
  approved_by_user?: { full_name: string; email: string }
  assigned_to_user?: { full_name: string; email: string }
  priority?: CycleCountPriority
  assigned_to?: string
}

// Priority levels for cycle counts
export type CycleCountPriority = 'critical' | 'hot' | 'normal' | 'low'

// Priority breakdown interface
export interface PriorityBreakdown {
  critical: number
  hot: number
  normal: number
  low: number
}

// Statistics interface for cycle count data
export interface CycleCountStatistics {
  totalCounts: number
  pendingCounts: number
  completedCounts: number
  varianceReviewCounts: number
  totalVarianceValue: number
  countsRequiringRecount: number
  myAssignedCounts: number
  unassignedCounts: number
  priorityBreakdown: PriorityBreakdown
  myAssignedByPriority: PriorityBreakdown
}

// Import progress interface
export interface ImportProgress {
  total: number
  processed: number
  errors: string[]
  isComplete: boolean
}

// Service class for cycle count operations
export class CycleCountService {
  private static instance: CycleCountService

  private constructor() {}

  public static getInstance(): CycleCountService {
    if (!CycleCountService.instance) {
      CycleCountService.instance = new CycleCountService()
    }
    return CycleCountService.instance
  }

  // Fetch all cycle count data
  async fetchCycleCountData(): Promise<{
    data: CycleCountDataWithUser[]
    error: any
  }> {
    try {
      const { data, error } = await supabase
        .from('rr_cyclecount_data')
        .select(
          `
          *,
          created_by_user:user_profiles!created_by(
            id,
            full_name,
            email
          ),
          approved_by_user:user_profiles!approved_by(
            id,
            full_name,
            email
          ),
          assigned_to_user:user_profiles!assigned_to(
            id,
            full_name,
            email
          )
        `
        )
        .order('created_at', { ascending: false })

      return { data: (data || []) as any as CycleCountDataWithUser[], error }
    } catch (error) {
      logger.error('Error fetching cycle count data:', error)
      return { data: [] as CycleCountDataWithUser[], error }
    }
  }

  // Fetch statistics for cycle count data
  async fetchStatistics(): Promise<{
    statistics: CycleCountStatistics | null
    error: any
  }> {
    try {
      const { data, error } = await (supabase.rpc as any)(
        'get_cycle_count_statistics'
      )

      if (error) {
        logger.error('Error fetching cycle count statistics:', error)
        return { statistics: null, error }
      }

      return {
        statistics: data as unknown as CycleCountStatistics,
        error: null,
      }
    } catch (error) {
      logger.error('Error fetching cycle count statistics:', error)
      return { statistics: null, error }
    }
  }

  // Create new cycle count entry
  async createCycleCount(
    cycleCountData: Partial<CycleCountData>
  ): Promise<{ success: boolean; data?: any; error: any }> {
    try {
      // Get the current authenticated user's profile
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        throw new Error('User not authenticated')
      }

      // Get user profile to get organization_id
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id, id')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        throw new Error('User profile not found')
      }

      // Set the required fields for RLS
      if (profile.organization_id) {
        cycleCountData.organization_id = profile.organization_id
      }
      cycleCountData.created_by = profile.id

      // Generate count number if not provided
      if (!cycleCountData.count_number) {
        const { data: countNumber, error: countNumberError } = await (
          supabase.rpc as any
        )('generate_count_number')
        if (countNumberError) {
          throw countNumberError
        }
        cycleCountData.count_number = countNumber as string
      }

      // Calculate variance if both quantities are provided
      if (
        cycleCountData.system_quantity != null &&
        cycleCountData.counted_quantity != null
      ) {
        cycleCountData.variance_quantity =
          cycleCountData.counted_quantity - cycleCountData.system_quantity

        // Calculate variance percentage
        if (cycleCountData.system_quantity > 0) {
          cycleCountData.variance_percentage =
            (Math.abs(cycleCountData.variance_quantity) /
              cycleCountData.system_quantity) *
            100
        }

        // Determine if recount is required (e.g., if variance > 5% or absolute variance > 10)
        const varianceThreshold = Math.max(
          cycleCountData.system_quantity * 0.05, // 5% threshold
          10 // Absolute threshold of 10 units
        )
        cycleCountData.requires_recount =
          Math.abs(cycleCountData.variance_quantity) > varianceThreshold
      }

      const { data, error } = await supabase
        .from('rr_cyclecount_data')
        .insert(cycleCountData as any)
        .select()
        .single()

      if (error) {
        throw error
      }

      return { success: true, data, error: null }
    } catch (error) {
      logger.error('Error creating cycle count:', error)
      return { success: false, error }
    }
  }

  // Create multiple cycle counts in batch
  async createMultipleCycleCounts(
    countsData: Array<Partial<CycleCountData>>
  ): Promise<{
    success: boolean
    data?: any[]
    error: any
    successCount?: number
    failureCount?: number
  }> {
    try {
      // Get the current authenticated user's profile
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        throw new Error('User not authenticated')
      }

      // Get user profile to get organization_id
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id, id')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        throw new Error('User profile not found')
      }

      // Generate count numbers sequentially to avoid duplicates
      // Get the starting sequence number
      const { data: startingCountNumber, error: countNumberError } = await (
        supabase.rpc as any
      )('generate_count_number')
      if (countNumberError) {
        throw countNumberError
      }

      // Extract the sequence number from the starting count number (CC-YYYYMMDD-XXXX)
      const startingNumber = startingCountNumber as string
      const parts = startingNumber.split('-')
      const datePrefix = parts[1] // YYYYMMDD
      let sequenceNum = parseInt(parts[2], 10) // Starting sequence number

      // Generate all count numbers sequentially
      const countsToCreate = countsData.map((countData) => {
        const countNumber = `CC-${datePrefix}-${String(sequenceNum).padStart(4, '0')}`
        sequenceNum++ // Increment for next count

        return {
          ...countData,
          organization_id: profile.organization_id,
          created_by: profile.id,
          count_number: countNumber,
          status: 'pending',
          count_date: new Date().toISOString().split('T')[0],
        }
      })

      // Insert all counts in batch
      const { data, error: insertError } = await supabase
        .from('rr_cyclecount_data')
        .insert(countsToCreate as any)
        .select()

      if (insertError) {
        throw insertError
      }

      return {
        success: true,
        data,
        error: null,
        successCount: data?.length || 0,
        failureCount: 0,
      }
    } catch (error) {
      logger.error('Error creating multiple cycle counts:', error)
      return {
        success: false,
        error,
        successCount: 0,
        failureCount: countsData.length,
      }
    }
  }

  // Update existing cycle count entry
  async updateCycleCount(
    id: string,
    updates: Partial<CycleCountData>
  ): Promise<{ success: boolean; data?: any; error: any }> {
    try {
      // If updating quantities, recalculate variance
      const currentData = await this.getCycleCountById(id)
      if (currentData.success && currentData.data) {
        const current = currentData.data
        const systemQty = updates.system_quantity ?? current.system_quantity
        const countedQty = updates.counted_quantity ?? current.counted_quantity

        if (systemQty != null && countedQty != null) {
          updates.variance_quantity = countedQty - systemQty

          // Calculate variance percentage
          if (systemQty > 0) {
            updates.variance_percentage =
              (Math.abs(updates.variance_quantity) / systemQty) * 100
          }

          // Update recount requirement
          const varianceThreshold = Math.max(systemQty * 0.05, 10)
          updates.requires_recount =
            Math.abs(updates.variance_quantity) > varianceThreshold
        }
      }

      updates.updated_at = new Date().toISOString()

      const { data, error } = await supabase
        .from('rr_cyclecount_data')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) {
        throw error
      }

      return { success: true, data, error: null }
    } catch (error) {
      logger.error('Error updating cycle count:', error)
      return { success: false, error }
    }
  }

  // Get cycle count by ID
  async getCycleCountById(
    id: string
  ): Promise<{ success: boolean; data?: CycleCountData; error: any }> {
    try {
      const { data, error } = await supabase
        .from('rr_cyclecount_data')
        .select()
        .eq('id', id)
        .single()

      if (error) {
        throw error
      }

      return { success: true, data, error: null }
    } catch (error) {
      logger.error('Error fetching cycle count by ID:', error)
      return { success: false, error }
    }
  }

  // Delete cycle count entry
  async deleteCycleCount(
    id: string
  ): Promise<{ success: boolean; error: any }> {
    try {
      const { error } = await supabase
        .from('rr_cyclecount_data')
        .delete()
        .eq('id', id)

      if (error) {
        throw error
      }

      return { success: true, error: null }
    } catch (error) {
      logger.error('Error deleting cycle count:', error)
      return { success: false, error }
    }
  }

  // Approve cycle count (for variance review process)
  async approveCycleCount(
    id: string,
    approvalComments?: string
  ): Promise<{ success: boolean; error: any }> {
    try {
      const { error } = await supabase
        .from('rr_cyclecount_data')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          approval_comments: approvalComments,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (error) {
        throw error
      }

      return { success: true, error: null }
    } catch (error) {
      logger.error('Error approving cycle count:', error)
      return { success: false, error }
    }
  }

  // Mark cycle count for recount
  async markForRecount(
    id: string,
    reason?: string
  ): Promise<{ success: boolean; error: any }> {
    try {
      const { error } = await supabase
        .from('rr_cyclecount_data')
        .update({
          requires_recount: true,
          status: 'pending',
          notes: reason ? `Recount required: ${reason}` : 'Recount required',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (error) {
        throw error
      }

      return { success: true, error: null }
    } catch (error) {
      logger.error('Error marking cycle count for recount:', error)
      return { success: false, error }
    }
  }

  // Initiate recount - sets status to recount and unassigns from current counter
  async initiateRecount(
    id: string,
    reason?: string
  ): Promise<{ success: boolean; error: any }> {
    try {
      // Get current authenticated user to check permissions
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { success: false, error: 'User not authenticated' }
      }

      // Get current count data to validate
      const currentData = await this.getCycleCountById(id)
      if (!currentData.success || !currentData.data) {
        return { success: false, error: 'Cycle count not found' }
      }

      const count = currentData.data

      // Check if current user is the original counter (prevent self-recount)
      if (count.created_by === user.id) {
        return {
          success: false,
          error:
            'You cannot initiate a recount on your own count. Please have a supervisor or colleague initiate the recount.',
        }
      }

      // Update count status to pending for recount
      const { error } = await supabase
        .from('rr_cyclecount_data')
        .update({
          status: 'pending',
          requires_recount: true,
          notes: reason
            ? `Recount initiated: ${reason}`
            : 'Recount initiated - requires different counter',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (error) {
        throw error
      }

      return { success: true, error: null }
    } catch (error) {
      logger.error('Error initiating recount:', error)
      return { success: false, error }
    }
  }

  // Complete recount
  async completeRecount(
    id: string,
    newCountedQuantity: number,
    recountBy: string
  ): Promise<{ success: boolean; error: any }> {
    try {
      const currentData = await this.getCycleCountById(id)
      if (!currentData.success || !currentData.data) {
        throw new Error('Cycle count not found')
      }

      const current = currentData.data
      const variance = newCountedQuantity - (current.system_quantity || 0)
      const variancePercentage =
        current.system_quantity && current.system_quantity > 0
          ? (Math.abs(variance) / current.system_quantity) * 100
          : 0

      const { error } = await supabase
        .from('rr_cyclecount_data')
        .update({
          counted_quantity: newCountedQuantity,
          variance_quantity: variance,
          variance_percentage: variancePercentage,
          recount_completed: true,
          recount_by: recountBy,
          recount_date: getTodayEST(), // Date only in EST
          status:
            Math.abs(variance) >
            Math.max((current.system_quantity || 0) * 0.05, 10)
              ? 'variance_review'
              : 'completed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (error) {
        throw error
      }

      return { success: true, error: null }
    } catch (error) {
      logger.error('Error completing recount:', error)
      return { success: false, error }
    }
  }

  // Export data to CSV
  exportToCSV(cycleCountData: CycleCountDataWithUser[]): string {
    const headers = [
      'ID',
      'Count Number',
      'Material Number',
      'Material Description',
      'Location',
      'Warehouse',
      'System Quantity',
      'Counted Quantity',
      'Variance Quantity',
      'Variance %',
      'Unit of Measure',
      'Count Type',
      'Counter Name',
      'Count Date',
      'Count Time',
      'Status',
      'Requires Recount',
      'Recount Completed',
      'Batch Number',
      'Notes',
      'Created By',
      'Created At',
      'Approved By',
      'Approved At',
    ]

    const csvContent = [
      headers.join(','),
      ...cycleCountData.map((cc: CycleCountDataWithUser) =>
        [
          `"${cc.id}"`,
          `"${cc.count_number || ''}"`,
          `"${cc.material_number || ''}"`,
          `"${cc.material_description || ''}"`,
          `"${cc.location || ''}"`,
          `"${cc.warehouse || ''}"`,
          `"${cc.system_quantity || 0}"`,
          `"${cc.counted_quantity || ''}"`,
          `"${cc.variance_quantity || ''}"`,
          `"${cc.variance_percentage || ''}"`,
          `"${cc.unit_of_measure || ''}"`,
          `"${cc.count_type || ''}"`,
          `"${cc.counter_name || ''}"`,
          `"${cc.count_date || ''}"`,
          `"${cc.count_time || ''}"`,
          `"${cc.status || ''}"`,
          `"${cc.requires_recount ? 'Yes' : 'No'}"`,
          `"${cc.recount_completed ? 'Yes' : 'No'}"`,
          `"${cc.batch_number || ''}"`,
          `"${cc.notes || ''}"`,
          `"${cc.created_by_user?.full_name || cc.created_by || ''}"`,
          `"${cc.created_at ? new Date(cc.created_at).toLocaleString() : ''}"`,
          `"${cc.approved_by_user?.full_name || ''}"`,
          `"${cc.approved_at ? new Date(cc.approved_at).toLocaleString() : ''}"`,
        ].join(',')
      ),
    ].join('\n')

    return csvContent
  }

  // Import cycle count data from clipboard/CSV
  async importFromClipboard(
    csvData: string,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = []
    const lines = csvData.trim().split('\n')

    if (lines.length < 2) {
      errors.push('Invalid CSV data: No data rows found')
      return { success: false, errors }
    }

    const headers = lines[0].split(',').map((h) => h.replace(/"/g, '').trim())

    // Create column header mapping to support user-friendly headers
    const headerMappings: { [key: string]: string } = {
      // User-friendly headers -> database fields
      'Storage Bin': 'location',
      'Part Number': 'material_number',
      'System Quantity': 'system_quantity',
      // Original headers (for backwards compatibility)
      material_number: 'material_number',
      location: 'location',
      system_quantity: 'system_quantity',
      material_description: 'material_description',
      warehouse: 'warehouse',
      unit_of_measure: 'unit_of_measure',
      count_type: 'count_type',
      count_reason: 'count_reason',
      batch_number: 'batch_number',
      notes: 'notes',
    }

    // Map headers to database fields
    const mappedHeaders = headers.map(
      (header) => headerMappings[header] || header.toLowerCase()
    )
    const requiredFields = ['material_number', 'location', 'system_quantity']

    // Validate required fields are present (after mapping)
    for (const required of requiredFields) {
      if (!mappedHeaders.includes(required)) {
        const friendlyNames = Object.keys(headerMappings).filter(
          (k) => headerMappings[k] === required
        )
        const expectedHeaders =
          friendlyNames.length > 0 ? friendlyNames.join(' or ') : required
        errors.push(`Missing required header: ${expectedHeaders}`)
      }
    }

    if (errors.length > 0) {
      return { success: false, errors }
    }

    const total = lines.length - 1
    let processed = 0

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = lines[i]
          .split(',')
          .map((v) => v.replace(/"/g, '').trim())
        const rowData: Partial<CycleCountData> = {}

        // Map CSV columns to database fields using mapped headers
        headers.forEach((header, index) => {
          const value = values[index]
          const mappedField = headerMappings[header] || header.toLowerCase()

          if (value && mappedField) {
            switch (mappedField) {
              case 'material_number':
                rowData.material_number = value
                break
              case 'material_description':
                rowData.material_description = value
                break
              case 'location':
                rowData.location = value
                break
              case 'warehouse':
                rowData.warehouse = value
                break
              case 'system_quantity':
                rowData.system_quantity = parseFloat(value)
                break
              case 'unit_of_measure':
                rowData.unit_of_measure = value
                break
              case 'count_type':
                rowData.count_type =
                  value as Database['public']['Enums']['count_type_enum']
                break
              case 'count_reason':
                rowData.count_reason = value
                break
              case 'batch_number':
                rowData.batch_number = value
                break
              case 'notes':
                rowData.notes = value
                break
            }
          }
        })

        const result = await this.createCycleCount(rowData)
        if (!result.success) {
          errors.push(`Row ${i}: ${result.error?.message || 'Unknown error'}`)
        }

        processed++
        onProgress?.({
          total,
          processed,
          errors,
          isComplete: processed === total,
        })
      } catch (error) {
        errors.push(
          `Row ${i}: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
        processed++
      }
    }

    return { success: errors.length === 0, errors }
  }

  // Manually assign cycle count to a specific user
  async assignCountToUser(
    countId: string,
    userId: string
  ): Promise<{ success: boolean; error: any }> {
    try {
      // Create a custom function to handle assignment
      const { data, error } = await (supabase.rpc as any)(
        'assign_cycle_count_to_user',
        {
          count_id: countId,
          user_id: userId,
        }
      )

      if (error) {
        throw error
      }

      // The RPC function returns JSON with success status
      if (data && typeof data === 'object' && 'success' in data) {
        return { success: data.success, error: null }
      } else {
        return {
          success: false,
          error: data?.error || 'Unknown error during assignment',
        }
      }
    } catch (error) {
      logger.error('Error assigning cycle count to user:', error)
      return { success: false, error }
    }
  }

  // Unassign cycle count (make it available to everyone)
  async unassignCount(
    countId: string
  ): Promise<{ success: boolean; error: any }> {
    try {
      const { data, error } = await (supabase.rpc as any)(
        'unassign_cycle_count',
        {
          count_id: countId,
        }
      )

      if (error) {
        throw error
      }

      // The RPC function returns JSON with success status
      if (data && typeof data === 'object' && 'success' in data) {
        return { success: data.success, error: null }
      } else {
        return {
          success: false,
          error: data?.error || 'Unknown error during unassignment',
        }
      }
    } catch (error) {
      logger.error('Error unassigning cycle count:', error)
      return { success: false, error }
    }
  }

  // Get next available cycle count for a user (existing function wrapper)
  async assignNextCount(
    userId: string
  ): Promise<{ success: boolean; data?: unknown; error: unknown }> {
    try {
      const { data, error } = await supabase.rpc(
        'assign_next_cycle_count' as never,
        {
          p_user_id: userId,
        } as never
      )

      if (error) {
        throw error
      }

      if (data && typeof data === 'object') {
        const result = data as Record<string, unknown>
        return {
          success: (result.success as boolean) || false,
          data: result.data || null,
          error: result.error || null,
        }
      }

      return { success: false, data: null, error: 'Invalid response format' }
    } catch (error) {
      logger.error('Error assigning next cycle count:', error)
      return { success: false, error }
    }
  }

  // Update priority of a cycle count
  async updateCycleCountPriority(
    countId: string,
    priority: CycleCountPriority
  ): Promise<{ success: boolean; error: any }> {
    try {
      const { data, error } = await (supabase.rpc as any)(
        'update_cycle_count_priority',
        {
          count_id: countId,
          new_priority: priority,
        }
      )

      if (error) {
        throw error
      }

      // The RPC function returns JSON with success status
      if (data && typeof data === 'object' && 'success' in data) {
        return { success: data.success, error: null }
      } else {
        return {
          success: false,
          error: data?.error || 'Unknown error during priority update',
        }
      }
    } catch (error) {
      logger.error('Error updating cycle count priority:', error)
      return { success: false, error }
    }
  }

  // Get priority label for display
  static getPriorityLabel(priority: CycleCountPriority): string {
    switch (priority) {
      case 'critical':
        return 'Critical'
      case 'hot':
        return 'Hot'
      case 'normal':
        return 'Normal'
      case 'low':
        return 'Low'
      default:
        return 'Normal'
    }
  }

  // Get priority color for UI badges
  static getPriorityColor(priority: CycleCountPriority): string {
    switch (priority) {
      case 'critical':
        return 'bg-red-100 text-red-800 border-red-300 dark:bg-red-950/20 dark:text-red-300 dark:border-red-800'
      case 'hot':
        return 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/20 dark:text-orange-300 dark:border-orange-800'
      case 'normal':
        return 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/20 dark:text-blue-300 dark:border-blue-800'
      case 'low':
        return 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-950/20 dark:text-gray-300 dark:border-gray-800'
      default:
        return 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/20 dark:text-blue-300 dark:border-blue-800'
    }
  }

  // Get priority sort order for frontend sorting
  static getPrioritySortOrder(priority: CycleCountPriority): number {
    switch (priority) {
      case 'critical':
        return 1
      case 'hot':
        return 2
      case 'normal':
        return 3
      case 'low':
        return 4
      default:
        return 3
    }
  }
}

// Export singleton instance
export const cycleCountService = CycleCountService.getInstance()
// Developer and Creator: Jai Singh
