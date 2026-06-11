// Created and developed by Jai Singh
/**
 * Rust-enabled Putaway Log Service
 *
 * This service provides putaway log operations using the high-performance
 * Rust core service patterns. Falls back to Supabase for operations not yet supported.
 *
 * Enable by setting VITE_RUST_CORE_ENABLED=true and VITE_RUST_CORE_URL
 */
import { supabase, supabaseRead } from '@/lib/supabase/client'
import type { Tables } from '@/lib/supabase/database.types'
import {
  attachUserProfiles,
  type UserProfileSummary,
} from '@/lib/supabase/enrich-with-user-profiles'
import { logger } from '@/lib/utils/logger'
import { getTodayEST } from '@/lib/utils/timezone'
import { initRustCoreClient } from './client'

// Feature flag for Rust core - accessed directly to avoid circular dependency
const RUST_CORE_ENABLED = import.meta.env.VITE_RUST_CORE_ENABLED === 'true'

// Re-export types for compatibility
export type PutawayOperationData = Tables<'rf_putaway_operations'>

// Same shape that `src/lib/supabase/putaway-log.service.ts` exports. The
// previous `QueryData<…>` inference relied on a LATERAL embed that was
// measured at ~2.1s mean per call in pg_stat_statements; we now build
// the shape via the two-query `attachUserProfiles` pattern.
export type PutawayOperationRow = PutawayOperationData & {
  confirmed_by_user?: UserProfileSummary | null
  mca_processed_by_user?: UserProfileSummary | null
}

export type PutawayOperationsWithUser = PutawayOperationRow[]

// Statistics interface (same as Supabase service)
export interface PutawayLogStatistics {
  totalPutaways: number
  todayPutaways: number
  uniqueMaterials: number
  uniqueDrivers: number
  averagePerDriver: number
  mcaPutaways: number
  completedPutaways: number
  pendingConfirms: number
  averageCompletionTime: number | null
  statusBreakdown: Record<string, number>
  warehouseDistribution: Record<string, number>
}

// Import progress interface
export interface ImportProgress {
  phase: string
  current: number
  total: number
  percentage: number
  message: string
}

/**
 * Initialize Rust client if not already done
 */
function ensureRustClientInitialized(): boolean {
  if (!RUST_CORE_ENABLED) {
    return false
  }

  try {
    const baseUrl =
      import.meta.env.VITE_RUST_CORE_URL ||
      'https://rust-core-service-production.up.railway.app'
    initRustCoreClient({ baseUrl })
    return true
  } catch {
    // Client already initialized or error
    return true
  }
}

/**
 * Rust-enabled Putaway Log Service
 * Uses Rust core service patterns for high-performance parallel fetching
 * Falls back to Supabase otherwise
 */
export class RustPutawayLogService {
  private static instance: RustPutawayLogService
  private useRust: boolean

  private constructor() {
    this.useRust = ensureRustClientInitialized() && RUST_CORE_ENABLED
    logger.log(
      `🦀 RustPutawayLogService initialized - Rust enabled: ${this.useRust}`
    )
  }

  public static getInstance(): RustPutawayLogService {
    if (!RustPutawayLogService.instance) {
      RustPutawayLogService.instance = new RustPutawayLogService()
    }
    return RustPutawayLogService.instance
  }

  /**
   * Check if Rust service is being used
   */
  isUsingRust(): boolean {
    return this.useRust
  }

  /**
   * Fetch ALL putaway operations
   * Uses PARALLEL pagination for maximum speed (Rust-like performance)
   */
  async fetchPutawayOperations(): Promise<{
    data: PutawayOperationsWithUser
    error: unknown
  }> {
    try {
      logger.log(
        '🦀 Fetching putaway operations via Rust-optimized parallel mode...'
      )
      const startTime = performance.now()

      // Read-replica routing for the count query and all subsequent
      // chunked fetches. The previous LATERAL embed on this call site
      // averaged 2.1s mean over 625k calls in pg_stat_statements; we now
      // fetch planar rows + one `user_profiles WHERE id IN (…)` lookup.
      const { count, error: countError } = await supabaseRead
        .from('rf_putaway_operations')
        .select('*', { count: 'exact', head: true })

      if (countError) {
        logger.error('❌ Count query error:', countError)
        return { data: [], error: countError }
      }

      if (!count) {
        logger.warn('⚠️ No records found in database')
        return { data: [], error: null }
      }

      logger.log(`🦀 Total records to fetch: ${count}`)

      // Use Supabase's default page size limit (1000) with parallel fetching for performance
      // NOTE: Supabase has a default row limit of 1000 per request - do NOT exceed this
      const pageSize = 1000
      const totalPages = Math.ceil(count / pageSize)
      const maxConcurrent = 10 // Max 10 parallel requests
      const allRecords: PutawayOperationRow[] = []

      for (let batch = 0; batch < totalPages; batch += maxConcurrent) {
        const batchPromises: Promise<PutawayOperationRow[]>[] = []
        const batchEnd = Math.min(batch + maxConcurrent, totalPages)

        for (let page = batch; page < batchEnd; page++) {
          const from = page * pageSize
          const to = from + pageSize - 1

          const promise = (async (): Promise<PutawayOperationRow[]> => {
            const { data, error } = await supabaseRead
              .from('rf_putaway_operations')
              .select('*')
              .order('created_at', { ascending: false })
              .range(from, to)

            if (error) throw error
            return (data ?? []) as PutawayOperationRow[]
          })()

          batchPromises.push(promise)
        }

        const batchResults = await Promise.all(batchPromises)
        batchResults.forEach((chunk) => {
          allRecords.push(...chunk)
        })

        logger.log(
          `🦀 Fetched ${allRecords.length}/${count} putaway operations (batch ${Math.floor(batch / maxConcurrent) + 1})`
        )
      }

      // Two-query enrichment: one IN-list lookup against user_profiles
      // replaces ~N LATERAL subqueries from the planner's perspective.
      await attachUserProfiles(allRecords, [
        ['confirmed_by', 'confirmed_by_user'],
        ['mca_processed_by', 'mca_processed_by_user'],
      ])

      // Re-sort all records by created_at descending to ensure correct order after parallel fetching
      // This is critical because parallel requests may return in different orders
      allRecords.sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
        return dateB - dateA // Descending order (newest first)
      })

      const totalTime = performance.now() - startTime
      logger.log(
        `✅ Rust-optimized service: Fetched ${allRecords.length} putaway operations in ${totalTime.toFixed(0)}ms`
      )
      return { data: allRecords, error: null }
    } catch (error) {
      logger.error(
        '❌ Rust-optimized service error, falling back to sequential:',
        error
      )
      return this.fetchPutawayOperationsSupabase()
    }
  }

  /**
   * Supabase fallback for fetching putaway operations
   */
  private async fetchPutawayOperationsSupabase(): Promise<{
    data: PutawayOperationsWithUser
    error: unknown
  }> {
    try {
      logger.log('📦 Fetching putaway operations via Supabase (fallback)...')

      const { count, error: countError } = await supabaseRead
        .from('rf_putaway_operations')
        .select('*', { count: 'exact', head: true })

      if (countError) {
        return { data: [], error: countError }
      }

      if (!count) {
        return { data: [], error: null }
      }

      const chunkSize = 1000
      const totalChunks = Math.ceil(count / chunkSize)
      const allRecords: PutawayOperationRow[] = []

      for (let i = 0; i < totalChunks; i++) {
        const from = i * chunkSize
        const to = from + chunkSize - 1

        const { data, error } = await supabaseRead
          .from('rf_putaway_operations')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, to)

        if (error) {
          return { data: allRecords, error }
        }

        if (data) {
          allRecords.push(...(data as PutawayOperationRow[]))
        }
      }

      // Same two-query enrichment as the parallel path.
      await attachUserProfiles(allRecords, [
        ['confirmed_by', 'confirmed_by_user'],
        ['mca_processed_by', 'mca_processed_by_user'],
      ])

      // Re-sort to ensure correct date order after all fetches
      allRecords.sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
        return dateB - dateA // Descending order (newest first)
      })

      return { data: allRecords, error: null }
    } catch (error) {
      return { data: [], error }
    }
  }

  /**
   * Fetch statistics for putaway operations
   */
  async fetchStatistics(): Promise<{
    statistics: PutawayLogStatistics | null
    error: unknown
  }> {
    try {
      logger.log('🦀 Fetching putaway log statistics...')

      // Try RPC function first
      const { data, error } = await supabase.rpc('get_putaway_log_statistics')

      if (error) {
        // Fallback to client-side calculation if RPC function doesn't exist
        logger.warn(
          'RPC function not found, calculating statistics client-side'
        )
        return this.calculateStatisticsClientSide()
      }

      return {
        statistics: data as unknown as PutawayLogStatistics,
        error: null,
      }
    } catch (error) {
      logger.error('❌ Statistics error:', error)
      return { statistics: null, error }
    }
  }

  /**
   * Fallback statistics calculation using optimized COUNT queries
   */
  private async calculateStatisticsClientSide(): Promise<{
    statistics: PutawayLogStatistics | null
    error: unknown
  }> {
    try {
      logger.log(
        '📊 Calculating putaway log statistics from entire database...'
      )

      // Use EST timezone for accurate "today" calculation
      const today = getTodayEST()

      logger.log(`📅 Putaway Log Statistics: Using EST date - Today: ${today}`)

      // Get total count (entire database)
      const { count: totalCount } = await supabaseRead
        .from('rf_putaway_operations')
        .select('*', { count: 'exact', head: true })

      // Get today's putaways by fetching all and filtering client-side
      const { data: allPutaways } = await supabaseRead
        .from('rf_putaway_operations')
        .select('created_at')

      // Filter to today's date in EST
      const todayCount =
        allPutaways?.filter((record) => {
          if (!record.created_at) return false

          // Convert UTC timestamp to EST date
          const estDate = new Date(record.created_at).toLocaleDateString(
            'en-US',
            {
              timeZone: 'America/New_York',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }
          )

          // Format to match YYYY-MM-DD
          const [month, day, year] = estDate.split('/')
          const recordDateEST = `${year}-${month}-${day}`

          return recordDateEST === today
        }).length || 0

      // Get PENDING MCA workflow count (only from Jan 14, 2026 onwards)
      // Only count MCA operations that haven't been processed yet (excludes MCA Confirmed and MCA Processed)
      const { count: mcaCount } = await supabaseRead
        .from('rf_putaway_operations')
        .select('*', { count: 'exact', head: true })
        .eq('is_mca_workflow', true)
        .not('to_status', 'in', '("MCA Confirmed","MCA Processed")')
        .gte('created_at', '2026-01-14T00:00:00.000Z')

      // Get completed count
      const { count: completedCount } = await supabaseRead
        .from('rf_putaway_operations')
        .select('*', { count: 'exact', head: true })
        .eq('to_status', 'Completed')

      // Get pending confirms count (TOs awaiting TO Confirmation in SAP, from Jan 1, 2026 onwards)
      // 'Completed' status = putaway done on RF but TO not yet confirmed in SAP (IS pending)
      // Date filter excludes stale historical data from before TO confirmation workflow
      const { count: pendingConfirmsCount } = await supabaseRead
        .from('rf_putaway_operations')
        .select('*', { count: 'exact', head: true })
        .not(
          'to_status',
          'in',
          '("TO Confirmed","MCA Confirmed","MCA Processed")'
        )
        .or('is_mca_workflow.is.null,is_mca_workflow.eq.false')
        .gte('created_at', '2026-01-01T00:00:00.000Z')

      // Get unique materials
      const { data: materialData } = await supabaseRead
        .from('rf_putaway_operations')
        .select('material_number')
        .not('material_number', 'is', null)

      // Get all drivers and created_at for calculations
      const { data: driverData } = await supabaseRead
        .from('rf_putaway_operations')
        .select('putaway_driver, created_at')
        .not('putaway_driver', 'is', null)

      // Calculate unique drivers (all time)
      const uniqueDrivers = driverData
        ? new Set(driverData.map((r) => r.putaway_driver).filter(Boolean)).size
        : 0

      // Calculate drivers who worked today in EST
      const driversToday = driverData
        ? new Set(
            driverData
              .filter((record) => {
                if (!record.created_at) return false
                const estDate = new Date(record.created_at).toLocaleDateString(
                  'en-US',
                  {
                    timeZone: 'America/New_York',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                  }
                )
                const [month, day, year] = estDate.split('/')
                const recordDateEST = `${year}-${month}-${day}`
                return recordDateEST === today
              })
              .map((r) => r.putaway_driver)
              .filter(Boolean)
          ).size
        : 0

      // Get status data for breakdown
      const { data: statusData } = await supabaseRead
        .from('rf_putaway_operations')
        .select('to_status')

      // Get warehouse data for distribution
      const { data: warehouseData } = await supabaseRead
        .from('rf_putaway_operations')
        .select('warehouse')

      // Calculate unique materials
      const uniqueMaterials = materialData
        ? new Set(materialData.map((r) => r.material_number).filter(Boolean))
            .size
        : 0

      // Calculate daily average per driver
      const averagePerDriver =
        driversToday > 0 ? Math.round((todayCount || 0) / driversToday) : 0

      // Status breakdown
      const statusBreakdown: Record<string, number> = {}
      if (statusData) {
        statusData.forEach((op) => {
          const status = op.to_status || 'Unknown'
          statusBreakdown[status] = (statusBreakdown[status] || 0) + 1
        })
      }

      // Warehouse distribution
      const warehouseDistribution: Record<string, number> = {}
      if (warehouseData) {
        warehouseData.forEach((op) => {
          const warehouse = op.warehouse || 'Unknown'
          warehouseDistribution[warehouse] =
            (warehouseDistribution[warehouse] || 0) + 1
        })
      }

      const statistics: PutawayLogStatistics = {
        totalPutaways: totalCount || 0,
        todayPutaways: todayCount || 0,
        uniqueMaterials,
        uniqueDrivers,
        averagePerDriver,
        mcaPutaways: mcaCount || 0,
        completedPutaways: completedCount || 0,
        pendingConfirms: pendingConfirmsCount || 0,
        averageCompletionTime: null, // Complex calculation, skip for now
        statusBreakdown,
        warehouseDistribution,
      }

      logger.log('✅ Putaway log statistics calculated:', {
        totalPutaways: statistics.totalPutaways.toLocaleString(),
        todayPutaways: statistics.todayPutaways,
        uniqueMaterials: statistics.uniqueMaterials,
        uniqueDrivers: statistics.uniqueDrivers,
        mcaPutaways: statistics.mcaPutaways,
      })

      return { statistics, error: null }
    } catch (error) {
      logger.error('Error calculating statistics:', error)
      return { statistics: null, error }
    }
  }

  /**
   * Create a new putaway operation
   */
  async createPutawayOperation(
    operationData: Partial<PutawayOperationData>
  ): Promise<{ data: PutawayOperationData | null; error: unknown }> {
    try {
      const { data, error } = await supabase
        .from('rf_putaway_operations')
        .insert(operationData as Tables<'rf_putaway_operations'>)
        .select()
        .single()

      return { data, error }
    } catch (error) {
      logger.error('Error creating putaway operation:', error)
      return { data: null, error }
    }
  }

  /**
   * Update an existing putaway operation
   */
  async updatePutawayOperation(
    id: string,
    updates: Partial<PutawayOperationData>
  ): Promise<{ data: PutawayOperationData | null; error: unknown }> {
    try {
      const { data, error } = await supabase
        .from('rf_putaway_operations')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      return { data, error }
    } catch (error) {
      logger.error('Error updating putaway operation:', error)
      return { data: null, error }
    }
  }

  /**
   * Delete a putaway operation
   */
  async deletePutawayOperation(
    id: string
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      const { error } = await supabase
        .from('rf_putaway_operations')
        .delete()
        .eq('id', id)

      return { success: !error, error }
    } catch (error) {
      logger.error('Error deleting putaway operation:', error)
      return { success: false, error }
    }
  }

  /**
   * Client-side search for filtering already-loaded putaway operations
   */
  filterPutawayOperations(
    operations: PutawayOperationsWithUser,
    searchQuery: string
  ): PutawayOperationsWithUser {
    if (!searchQuery.trim()) {
      return operations
    }

    const query = searchQuery.toLowerCase().replace(/\s+/g, ' ').trim()

    return operations.filter((op) => {
      const normalizeField = (value: string | null | undefined): string => {
        return (value || '').toLowerCase().replace(/\s+/g, ' ').trim()
      }

      return (
        normalizeField(op.material_number).includes(query) ||
        normalizeField(op.to_number).includes(query) ||
        normalizeField(op.to_location).includes(query) ||
        normalizeField(op.shelf_location).includes(query) ||
        normalizeField(op.putaway_driver).includes(query) ||
        normalizeField(op.warehouse).includes(query) ||
        normalizeField(op.to_status).includes(query) ||
        normalizeField(op.mca_reason).includes(query) ||
        normalizeField(op.created_by).includes(query) ||
        // Also search in formatted date
        normalizeField(op.created_at).includes(query) ||
        normalizeField(op.putaway_date).includes(query) ||
        // Search in confirmed by user
        normalizeField(op.confirmed_by_user?.full_name).includes(query) ||
        normalizeField(op.confirmed_by_user?.email).includes(query)
      )
    })
  }

  /**
   * Import from clipboard functionality
   */
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

      onProgress?.({
        phase: 'Validating data structure',
        current: 1,
        total: 5,
        percentage: 20,
        message: 'Validating column headers...',
      })

      const headers = lines[0].split('\t').map((h) => h.trim())
      const dataRows = lines.slice(1).filter((line) => line.trim())
      const columnMapping = this.createColumnMapping(headers)

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

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        onProgress?.({
          phase: 'Inserting data',
          current: 3,
          total: 5,
          percentage: 60 + (batchIndex / batches.length) * 30,
          message: `Inserting batch ${batchIndex + 1} of ${batches.length}...`,
        })

        const batch = batches[batchIndex]
        const batchData: Partial<PutawayOperationData>[] = []

        for (const row of batch) {
          try {
            const values = row.split('\t')
            const putawayData = this.mapRowToPutawayData(values, columnMapping)
            if (putawayData) {
              batchData.push(putawayData)
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
            .from('rf_putaway_operations')
            .insert(batchData as Tables<'rf_putaway_operations'>[])

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
      to_number: ['to number', 'to_number', 'transfer order', 'to'],
      to_location: ['to location', 'to_location', 'location'],
      shelf_location: ['shelf location', 'shelf_location', 'shelf', 'bin'],
      putaway_driver: [
        'driver',
        'putaway_driver',
        'putaway driver',
        'operator',
      ],
      warehouse: ['warehouse', 'wh'],
      to_status: ['status', 'to_status'],
      is_mca_workflow: ['mca', 'is_mca_workflow', 'mca workflow'],
      mca_reason: ['mca reason', 'mca_reason', 'reason'],
      putaway_date: ['date', 'putaway_date', 'putaway date'],
      putaway_time: ['time', 'putaway_time', 'putaway time'],
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

  private mapRowToPutawayData(
    values: string[],
    mapping: Record<string, number>
  ): Partial<PutawayOperationData> | null {
    try {
      const now = new Date()
      const utcISOString = now.toISOString()

      const putawayData: Partial<PutawayOperationData> = {
        organization_id: '',
        created_by: '',
        created_at: utcISOString,
      }

      for (const [field, columnIndex] of Object.entries(mapping)) {
        if (columnIndex < values.length && values[columnIndex]?.trim()) {
          const value = values[columnIndex].trim()

          switch (field) {
            case 'is_mca_workflow':
              putawayData.is_mca_workflow = ['true', 'yes', '1', 'y'].includes(
                value.toLowerCase()
              )
              break
            case 'putaway_date':
              // eslint-disable-next-line no-case-declarations
              const date = new Date(value)
              if (!isNaN(date.getTime())) {
                putawayData.putaway_date = date.toISOString().split('T')[0]
              }
              break
            default:
              ;(putawayData as Record<string, unknown>)[field] = value
          }
        }
      }

      const hasRequiredFields =
        putawayData.material_number &&
        putawayData.to_number &&
        putawayData.putaway_driver

      if (!hasRequiredFields) {
        throw new Error(
          'Missing required fields (material_number, to_number, or putaway_driver)'
        )
      }

      return putawayData
    } catch {
      return null
    }
  }

  /**
   * Export data to CSV
   */
  exportToCSV(operations: PutawayOperationsWithUser): string {
    const headers = [
      '"ID"',
      '"Material Number"',
      '"TO Number"',
      '"TO Location"',
      '"Shelf Location"',
      '"Putaway Driver"',
      '"Warehouse"',
      '"Status"',
      '"MCA Workflow"',
      '"MCA Reason"',
      '"Putaway Date"',
      '"Putaway Time"',
      '"Created By"',
      '"Created At"',
    ]

    const csvContent = [
      headers.join(','),
      ...operations.map((op) =>
        [
          `"${op.id}"`,
          `"${op.material_number || ''}"`,
          `"${op.to_number || ''}"`,
          `"${op.to_location || ''}"`,
          `"${op.shelf_location || ''}"`,
          `"${op.putaway_driver || ''}"`,
          `"${op.warehouse || ''}"`,
          `"${op.to_status || ''}"`,
          `"${op.is_mca_workflow ? 'Yes' : 'No'}"`,
          `"${op.mca_reason || ''}"`,
          `"${op.putaway_date || ''}"`,
          `"${op.putaway_time || ''}"`,
          `"${op.created_by || ''}"`,
          `"${op.created_at ? new Date(op.created_at).toLocaleString() : ''}"`,
        ].join(',')
      ),
    ].join('\n')

    return csvContent
  }
}

// Export singleton instance
export const rustPutawayLogService = RustPutawayLogService.getInstance()

// Created and developed by Jai Singh
