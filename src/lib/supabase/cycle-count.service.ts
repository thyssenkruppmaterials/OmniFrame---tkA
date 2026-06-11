// Created and developed by Jai Singh
/**
 * Cycle Count Data Service
 * Handles all cycle count related database operations
 * Follows OmniFrame service patterns and integrates with Supabase
 */
import { logger } from '@/lib/utils/logger'
import { getTodayEST } from '@/lib/utils/timezone'
import { supabase, supabaseRead } from './client'
import type { Tables } from './database.types'
import {
  attachUserProfiles,
  type UserProfileSummary,
} from './enrich-with-user-profiles'

export type CycleCountData = Tables<'rr_cyclecount_data'>

// CycleCountDataWithUser — raw row PLUS the three user-profile summaries
// the Manual Counts dashboard renders. Previously the user data was
// loaded via a PostgREST embed (`user_profiles!created_by(…)` etc.) that
// expanded to a LEFT JOIN LATERAL per row + per-row RLS on `user_profiles`.
// At 18k rows × paginated 1000-row chunks the planner picked nested-loop
// LATERAL and mean execution time on pg_stat_statements was ~2.98s.
// We now fetch the rows planar-only and stitch profiles in via
// `attachUserProfiles` (one IN-list lookup against user_profiles). See
// Debug/Fix-Slow-PostgREST-LATERAL-Embeds-2026-05-20.md.
export type CycleCountDataWithUser = CycleCountData & {
  created_by_user?: UserProfileSummary | null
  approved_by_user?: UserProfileSummary | null
  assigned_to_user?: UserProfileSummary | null
  active_defer?: Array<{
    user_id: string
    defer_reason: string | null
    deferred_at: string
    is_active: boolean
  }>
  priority?: CycleCountPriority
  assigned_to?: string
}

export type AssignmentHistoryRecord = {
  id: string
  count_id: string
  previous_counter_id: string | null
  previous_counter_name: string | null
  previous_counted_quantity: number | null
  previous_status: string | null
  new_counter_id: string
  new_counter_name: string | null
  reassigned_by: string | null
  reassigned_at: string
  reassigned_by_user?: { full_name: string; email: string } | null
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
      // Reads go through the load-balanced read client.
      // `cycle_count_operator_deferred_counts` is a small 1-to-many child
      // table — its embed isn't the slow one, and it's not against
      // `user_profiles`, so it stays inline. The three `user_profiles`
      // embeds (created/approved/assigned) are removed and replaced
      // with the two-query enrichment after all chunks land.
      const db = supabaseRead as any

      const selectColumns = `
          *,
          active_defer:cycle_count_operator_deferred_counts(
            user_id,
            defer_reason,
            deferred_at,
            is_active
          )
        `

      const { count, error: countError } = await db
        .from('rr_cyclecount_data')
        .select('*', { count: 'exact', head: true })

      if (countError) {
        logger.error('❌ Cycle count total-count query error:', countError)
        return { data: [], error: countError }
      }

      if (!count) {
        return { data: [], error: null }
      }

      const chunkSize = 1000
      const totalChunks = Math.ceil(count / chunkSize)
      const concurrentLimit = 5
      const delayBetweenBatches = 100
      const allRecords: CycleCountDataWithUser[] = []

      logger.log(
        `🔢 Fetching cycle counts in ${totalChunks} chunk(s) of ${chunkSize} (total ${count})`
      )

      // Phase 1 — fetch rows WITHOUT the three user_profiles LATERAL
      // joins. Previously this query mean was ~2.98s in pg_stat_statements
      // (95k+ calls, ~283k seconds total). Removing the user joins drops
      // it to a straight index-range scan on `created_at`.
      for (let i = 0; i < totalChunks; i += concurrentLimit) {
        const batchEnd = Math.min(i + concurrentLimit, totalChunks)
        const batchPromises: Array<Promise<CycleCountDataWithUser[]>> = []

        for (let j = i; j < batchEnd; j++) {
          const from = j * chunkSize
          const to = from + chunkSize - 1

          batchPromises.push(
            db
              .from('rr_cyclecount_data')
              .select(selectColumns)
              .order('created_at', { ascending: false })
              .order('id', { ascending: false })
              .range(from, to)
              .then(({ data, error }: { data: any; error: any }) => {
                if (error) throw error
                return (data || []) as CycleCountDataWithUser[]
              })
          )
        }

        const batchResults = await Promise.all(batchPromises)
        batchResults.forEach((chunk) => {
          allRecords.push(...chunk)
        })

        if (batchEnd < totalChunks) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayBetweenBatches)
          )
        }
      }

      // Phase 2 — one IN-list lookup on user_profiles covers all three
      // FK columns at once (created_by, approved_by, assigned_to). With
      // 18k rows and typically <300 distinct user ids, this is a fast
      // primary-key scan.
      await attachUserProfiles(
        allRecords as unknown as Array<Record<string, unknown>>,
        [
          ['created_by', 'created_by_user'],
          ['approved_by', 'approved_by_user'],
          ['assigned_to', 'assigned_to_user'],
        ]
      )

      return { data: allRecords, error: null }
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
        )('generate_count_number', {
          p_organization_id: profile.organization_id,
        })
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

        // requires_recount is computed by the DB trigger (auto_calculate_cycle_count_variance)
        // using per-row review_threshold_pct / review_threshold_abs (defaults: 10% / 10 units)
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

      // Reserve all count numbers atomically via a single RPC call
      const { data: countNumbers, error: countNumberError } = await (
        supabase.rpc as any
      )('generate_count_numbers', {
        p_organization_id: profile.organization_id,
        p_count: countsData.length,
      })
      if (countNumberError) {
        throw countNumberError
      }

      const numbers = countNumbers as string[]
      const countsToCreate = countsData.map((countData, index) => ({
        ...countData,
        organization_id: profile.organization_id,
        created_by: profile.id,
        count_number: numbers[index],
        status: 'pending',
        count_date: getTodayEST(),
      }))

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

          // requires_recount is computed by the DB trigger using per-row thresholds
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

  async approveCycleCount(
    id: string,
    approvalComments?: string
  ): Promise<{ success: boolean; error: any }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      const { error } = await supabase
        .from('rr_cyclecount_data')
        .update({
          status: 'approved',
          approved_by: user?.id ?? null,
          approved_at: new Date().toISOString(),
          approval_comments: approvalComments,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', id)

      if (error) {
        throw error
      }

      // Clear any active defer records — the count is approved/done
      await (supabase as any)
        .from('cycle_count_operator_deferred_counts')
        .update({
          is_active: false,
          cleared_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('count_id', id)
        .eq('is_active', true)

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
          recount_completed: false,
          status: 'recount' as any,
          assigned_to: null,
          assigned_at: null,
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

  async initiateRecount(
    id: string,
    reason?: string
  ): Promise<{ success: boolean; error: any }> {
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { success: false, error: 'User not authenticated' }
      }

      const currentData = await this.getCycleCountById(id)
      if (!currentData.success || !currentData.data) {
        return { success: false, error: 'Cycle count not found' }
      }

      const count = currentData.data

      if (count.assigned_to === user.id || count.counter_name === user.email) {
        return {
          success: false,
          error:
            'You cannot initiate a recount on a count you performed. Please have a supervisor or colleague initiate the recount.',
        }
      }

      const { data, error } = await (supabase.rpc as any)(
        'initiate_recount_with_history',
        {
          p_count_id: id,
          p_recount_reason: reason || 'Recount initiated',
          p_initiated_by: user.id,
        }
      )

      if (error) {
        throw error
      }

      if (data && typeof data === 'object' && !data.success) {
        return {
          success: false,
          error: data.error || 'Failed to initiate recount',
        }
      }

      return { success: true, error: null }
    } catch (error) {
      logger.error('Error initiating recount:', error)
      return { success: false, error }
    }
  }

  async completeRecount(
    id: string,
    newCountedQuantity: number,
    recountBy: string
  ): Promise<{ success: boolean; error: any }> {
    try {
      const { data, error } = await (supabase.rpc as any)(
        'complete_recount_with_history',
        {
          p_count_id: id,
          p_recount_quantity: newCountedQuantity,
          p_recount_counter_name: recountBy,
          p_recount_notes: null,
        }
      )

      if (error) {
        throw error
      }

      if (data && typeof data === 'object' && !data.success) {
        return {
          success: false,
          error: data.error || 'Failed to complete recount',
        }
      }

      return { success: true, error: null }
    } catch (error) {
      logger.error('Error completing recount:', error)
      return { success: false, error }
    }
  }

  async getRecountComparison(
    countId: string
  ): Promise<{ success: boolean; data?: any; error: any }> {
    try {
      const { data, error } = await (supabase.rpc as any)(
        'get_recount_comparison',
        { p_count_id: countId }
      )
      if (error) throw error

      if (data && typeof data === 'object' && !data.success) {
        return { success: false, error: data.error }
      }

      return { success: true, data, error: null }
    } catch (error) {
      logger.error('Error fetching recount comparison:', error)
      return { success: false, error }
    }
  }

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
      'Destination Location',
      'Qty Picked',
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
          `"${cc.transfer_destination_location || ''}"`,
          `"${cc.transfer_source_quantity ?? ''}"`,
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
    onProgress?: (progress: ImportProgress) => void,
    defaultCountType?: string
  ): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = []
    const lines = csvData.trim().split('\n')

    if (lines.length < 2) {
      errors.push('Invalid CSV data: No data rows found')
      return { success: false, errors }
    }

    // Auto-detect delimiter: tabs (spreadsheet copy-paste) vs commas (CSV)
    const firstLine = lines[0]
    const delimiter = firstLine.includes('\t') ? '\t' : ','

    const headers = firstLine
      .split(delimiter)
      .map((h) => h.replace(/"/g, '').trim())

    // Case-insensitive lookup map built from all recognized header variants.
    // Keys are lowercased; values are the canonical database field names.
    const headerMappingsLower: { [key: string]: string } = {
      // Export-style friendly headers (must match exportToCSV output)
      'material number': 'material_number',
      'material description': 'material_description',
      location: 'location',
      warehouse: 'warehouse',
      'system quantity': 'system_quantity',
      'unit of measure': 'unit_of_measure',
      'count type': 'count_type',
      'batch number': 'batch_number',
      notes: 'notes',
      'counted quantity': 'counted_quantity',
      'count number': 'count_number',
      'counter name': 'counter_name',
      'count date': 'count_date',
      'count time': 'count_time',
      // Alternate friendly headers
      'storage bin': 'location',
      'part number': 'material_number',
      'count reason': 'count_reason',
      // Found Part Transfer (migration 222 + 223) — friendly aliases.
      //
      // Semantics:
      //   `Location` (= `location` column)                = SOURCE (A)
      //   `Destination Location` (= new column)           = DESTINATION (B)
      //   `System Quantity`                               = expected qty
      //                                                     at source (A)
      //   `Qty Picked` (optional, operator-captured)      = how many were
      //                                                     actually moved
      //   `Counted Quantity` (optional)                   = final count
      //                                                     at destination
      'source location': 'location',
      'from location': 'location',
      'pick from': 'location',
      'destination location': 'transfer_destination_location',
      'to location': 'transfer_destination_location',
      'deliver to': 'transfer_destination_location',
      'transfer destination location': 'transfer_destination_location',
      'destination qty': 'counted_quantity',
      'destination quantity': 'counted_quantity',
      'final qty at destination': 'counted_quantity',
      'final destination quantity': 'counted_quantity',
      'qty picked': 'transfer_source_quantity',
      'quantity picked': 'transfer_source_quantity',
      'qty moved': 'transfer_source_quantity',
      'quantity moved': 'transfer_source_quantity',
      'transfer source quantity': 'transfer_source_quantity',
      'transfer source qty': 'transfer_source_quantity',
      'transferred quantity': 'transfer_source_quantity',
      // Raw database column names
      material_number: 'material_number',
      material_description: 'material_description',
      system_quantity: 'system_quantity',
      unit_of_measure: 'unit_of_measure',
      count_type: 'count_type',
      count_reason: 'count_reason',
      batch_number: 'batch_number',
      counted_quantity: 'counted_quantity',
      count_number: 'count_number',
      counter_name: 'counter_name',
      count_date: 'count_date',
      count_time: 'count_time',
      transfer_destination_location: 'transfer_destination_location',
      transfer_source_quantity: 'transfer_source_quantity',
    }

    const resolveHeader = (raw: string): string => {
      const key = raw.toLowerCase().trim()
      return headerMappingsLower[key] ?? key.replace(/\s+/g, '_')
    }

    const mappedHeaders = headers.map(resolveHeader)
    const requiredFields = ['material_number', 'location', 'system_quantity']

    for (const required of requiredFields) {
      if (!mappedHeaders.includes(required)) {
        const accepted = Object.entries(headerMappingsLower)
          .filter(([, v]) => v === required)
          .map(([k]) => k)
        const hint =
          accepted.length > 0
            ? `Accepted headers: ${accepted.join(', ')}`
            : required
        errors.push(`Missing required column "${required}". ${hint}`)
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
          .split(delimiter)
          .map((v) => v.replace(/"/g, '').trim())

        if (values.every((v) => !v)) {
          processed++
          continue
        }

        const rowData: Partial<CycleCountData> = {}

        headers.forEach((header, index) => {
          const value = values[index]
          const mappedField = resolveHeader(header)

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
                rowData.count_type = value
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
              case 'count_date':
                rowData.count_date = value
                break
              case 'count_time':
                rowData.count_time = value
                break
              case 'transfer_destination_location':
                rowData.transfer_destination_location = value
                break
              case 'transfer_source_quantity': {
                const n = parseFloat(value)
                if (!Number.isNaN(n)) {
                  rowData.transfer_source_quantity = n
                }
                break
              }
              case 'counted_quantity': {
                const n = parseFloat(value)
                if (!Number.isNaN(n)) {
                  rowData.counted_quantity = n
                }
                break
              }
            }
          }
        })

        if (defaultCountType && !rowData.count_type) {
          rowData.count_type = defaultCountType
        }

        // Convenience: if transfer columns are populated but count_type
        // is still missing or wrong, default to `found_part_transfer`.
        if (
          (rowData.transfer_destination_location ||
            rowData.transfer_source_quantity != null) &&
          (!rowData.count_type || rowData.count_type === 'quantity_check')
        ) {
          rowData.count_type = 'found_part_transfer'
        }

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

      if (data && typeof data === 'object' && 'success' in data) {
        if (!data.success) {
          return {
            success: false,
            error: { message: data.error || 'Assignment failed' },
          }
        }
        return { success: true, error: null }
      }
      return {
        success: false,
        error: { message: 'Unknown error during assignment' },
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

  async fetchAssignmentHistory(
    countId: string
  ): Promise<{ data: AssignmentHistoryRecord[]; error: any }> {
    try {
      const db = supabase as any
      const { data, error } = await db
        .from('cycle_count_assignment_history')
        .select(
          `
          *,
          reassigned_by_user:user_profiles!reassigned_by(
            full_name,
            email
          )
        `
        )
        .eq('count_id', countId)
        .order('reassigned_at', { ascending: false })

      if (error) throw error
      return { data: (data || []) as AssignmentHistoryRecord[], error: null }
    } catch (error) {
      logger.error('Error fetching assignment history:', error)
      return { data: [], error }
    }
  }

  /** @deprecated Use workServiceClient.claimNext() instead — this legacy RPC
   *  does not support path-aware ordering or deferred-count logic. */
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

// Created and developed by Jai Singh
