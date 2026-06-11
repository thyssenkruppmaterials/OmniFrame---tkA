// Created and developed by Jai Singh
import { RUST_CORE_ENABLED } from '@/lib/rust-core'
import { rustPutawayLogService } from '@/lib/rust-core/putaway-log.service'
import { logger } from '@/lib/utils/logger'
import { getTodayEST } from '@/lib/utils/timezone'
import { supabase, supabaseRead } from './client'
import type { Tables } from './database.types'
import {
  attachUserProfiles,
  type UserProfileSummary,
} from './enrich-with-user-profiles'

// Define the table row type for putaway operations
export type PutawayOperationData = Tables<'rf_putaway_operations'>

// Shape of a single putaway-log row as it flows through the UI: the raw
// table row PLUS the two user-profile summaries the dashboard renders.
//
// Previously this type was inferred from a PostgREST embed (`QueryData<…>`)
// that produced a nested LATERAL join — a measured 2.1s per call against
// `pg_stat_statements` (mean across 625k calls, ~367 hours of cumulative
// DB time). We now fetch the rows planar-only and stitch the profiles
// client-side via `attachUserProfiles`. The runtime shape is identical
// so the row-renderer (`src/components/putaway-log-search.tsx`) keeps
// working as-is.
export type PutawayOperationRow = PutawayOperationData & {
  confirmed_by_user?: UserProfileSummary | null
  mca_processed_by_user?: UserProfileSummary | null
}

export type PutawayOperationsWithUser = PutawayOperationRow[]

// Statistics interface for putaway operations
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

// Service class for putaway log operations
export class PutawayLogService {
  private static instance: PutawayLogService

  private constructor() {}

  public static getInstance(): PutawayLogService {
    if (!PutawayLogService.instance) {
      PutawayLogService.instance = new PutawayLogService()
    }
    return PutawayLogService.instance
  }

  /**
   * Check if using Rust service
   */
  isUsingRust(): boolean {
    return RUST_CORE_ENABLED && rustPutawayLogService.isUsingRust()
  }

  /**
   * Fetch ALL putaway operations using optimized chunking to bypass 1000 record limit
   * Uses Rust core service when VITE_RUST_CORE_ENABLED=true
   * Falls back to controlled sequential chunking to prevent timeouts
   */
  async fetchPutawayOperations(): Promise<{
    data: PutawayOperationsWithUser
    error: any
  }> {
    // Use Rust service when enabled
    if (RUST_CORE_ENABLED) {
      logger.log('🦀 Using Rust core service for putaway operations')
      return rustPutawayLogService.fetchPutawayOperations()
    }

    try {
      logger.log(
        '🚀 Fetching ALL putaway operations using two-query pattern (no LATERAL embeds)...'
      )

      // Read-side queries go through the load-balanced read client
      // (`supabaseRead`) per Patterns/Supabase-Read-Replica-Routing.md.
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

      logger.log(`📊 Total records to fetch: ${count}`)

      const chunkSize = 1000
      const totalChunks = Math.ceil(count / chunkSize)
      const allRecords: PutawayOperationRow[] = []
      const concurrentLimit = 5 // Max 5 parallel requests to prevent timeouts
      const delayBetweenBatches = 100 // 100ms delay between batches

      logger.log(
        `🔢 Fetching ${totalChunks} chunks of ${chunkSize} records each with controlled concurrency...`
      )

      // Phase 1 — fetch rows WITHOUT any user_profiles embed. This was
      // the >2s LATERAL-join query in pg_stat_statements; planar select
      // is a fast index range scan instead.
      for (let i = 0; i < totalChunks; i += concurrentLimit) {
        const batchPromises: Array<Promise<PutawayOperationRow[]>> = []
        const batchEnd = Math.min(i + concurrentLimit, totalChunks)

        for (let j = i; j < batchEnd; j++) {
          const from = j * chunkSize
          const to = from + chunkSize - 1

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

        try {
          const batchResults = await Promise.all(batchPromises)
          batchResults.forEach((chunk) => {
            allRecords.push(...chunk)
          })

          logger.log(
            `✅ Fetched batch ${Math.floor(i / concurrentLimit) + 1}: ${allRecords.length}/${count} records`
          )

          if (batchEnd < totalChunks) {
            await new Promise((resolve) =>
              setTimeout(resolve, delayBetweenBatches)
            )
          }
        } catch (error) {
          logger.error(
            `❌ Error fetching batch ${Math.floor(i / concurrentLimit) + 1}:`,
            error
          )
          return { data: allRecords, error }
        }
      }

      // Phase 2 — attach user profiles via a single IN-list lookup. With
      // ~50–200 distinct operators across 47k rows this is one cheap
      // primary-key scan vs N LATERALs.
      await attachUserProfiles(allRecords, [
        ['confirmed_by', 'confirmed_by_user'],
        ['mca_processed_by', 'mca_processed_by_user'],
      ])

      // Re-sort all records by created_at descending to ensure correct order after parallel fetching
      // This is critical because parallel requests may return results in different orders
      allRecords.sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
        return dateB - dateA // Descending order (newest first)
      })

      logger.log(
        `✅ Successfully fetched all ${allRecords.length} putaway operation records`
      )
      return { data: allRecords, error: null }
    } catch (error) {
      logger.error('Error fetching putaway operations:', error)
      return { data: [], error }
    }
  }

  /**
   * Search putaway operations using database query (searches entire dataset)
   * @param query - Search query string
   * @deprecated This method is no longer needed - use fetchPutawayOperations() and filter client-side instead
   */
  async searchPutawayOperations(
    query: string
  ): Promise<{ data: PutawayOperationsWithUser; error: any }> {
    try {
      if (!query.trim()) {
        // If no query, return all data
        return await this.fetchPutawayOperations()
      }

      const searchTerm = query.toLowerCase()
      logger.log(
        `🔍 Searching putaway operations for: "${searchTerm}" (no limit - entire database)`
      )

      // Two-query pattern, same as fetchPutawayOperations: planar SELECT
      // (no LATERAL embed) then a single user_profiles IN-list lookup.
      const allRecords: PutawayOperationRow[] = []
      let offset = 0
      const batchSize = 1000
      let hasMore = true

      while (hasMore) {
        const { data, error } = await supabaseRead
          .from('rf_putaway_operations')
          .select('*')
          .or(
            `material_number.ilike.%${searchTerm}%,to_number.ilike.%${searchTerm}%,to_location.ilike.%${searchTerm}%,shelf_location.ilike.%${searchTerm}%,putaway_driver.ilike.%${searchTerm}%,warehouse.ilike.%${searchTerm}%,to_status.ilike.%${searchTerm}%,mca_reason.ilike.%${searchTerm}%`
          )
          .order('created_at', { ascending: false })
          .range(offset, offset + batchSize - 1)

        if (error) {
          logger.error('Search query error:', error)
          return { data: allRecords, error }
        }

        if (data && data.length > 0) {
          allRecords.push(...(data as PutawayOperationRow[]))
          hasMore = data.length === batchSize
          offset += batchSize
          logger.log(
            `📄 Fetched search batch: ${data.length} operations (total: ${allRecords.length})`
          )
        } else {
          hasMore = false
        }
      }

      await attachUserProfiles(allRecords, [
        ['confirmed_by', 'confirmed_by_user'],
        ['mca_processed_by', 'mca_processed_by_user'],
      ])

      // Re-sort all records by created_at descending to ensure correct date order
      allRecords.sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
        return dateB - dateA // Descending order (newest first)
      })

      logger.log(
        `✅ Found ${allRecords.length} matching putaway operations (entire database searched)`
      )
      return { data: allRecords, error: null }
    } catch (error) {
      logger.error('Error searching putaway operations:', error)
      return { data: [], error }
    }
  }

  // Fetch statistics for putaway operations
  async fetchStatistics(): Promise<{
    statistics: PutawayLogStatistics | null
    error: any
  }> {
    // Use Rust service when enabled
    if (RUST_CORE_ENABLED) {
      logger.log('🦀 Using Rust core service for putaway log statistics')
      return rustPutawayLogService.fetchStatistics()
    }

    try {
      // Use RPC function for optimized statistics calculation
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
      logger.error('Error fetching statistics:', error)
      return { statistics: null, error }
    }
  }

  // Fallback statistics calculation using optimized COUNT queries
  private async calculateStatisticsClientSide(): Promise<{
    statistics: PutawayLogStatistics | null
    error: any
  }> {
    try {
      logger.log(
        '📊 Calculating putaway log statistics from entire database (client-side fallback)...'
      )

      // Use EST timezone for accurate "today" calculation
      const today = getTodayEST()

      logger.log(`📅 Putaway Log Statistics: Using EST date - Today: ${today}`)

      // Get total count (entire database) — read replica is fine for stats
      const { count: totalCount } = await supabaseRead
        .from('rf_putaway_operations')
        .select('*', { count: 'exact', head: true })

      // Get today's putaways by fetching all and filtering client-side
      // This is less efficient but works correctly with timezone conversion
      // Note: In production, the RPC function should be used instead
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

      // Get unique materials (selective field query)
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

      // Calculate daily average per driver (today's putaways / drivers who worked today)
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

  // Import from clipboard functionality (adapted from inbound scan service)
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

      // Column mapping - flexible header matching for putaway operations
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

  // Map row data to putaway operation data object
  private mapRowToPutawayData(
    values: string[],
    mapping: Record<string, number>
  ): Partial<PutawayOperationData> | null {
    try {
      // Create accurate timestamp - store proper UTC for correct timezone handling
      const now = new Date()
      const utcISOString = now.toISOString()

      logger.log('🕐 Putaway Log Service: Corrected Timestamp Capture:', {
        utcISOString,
        localTime: now.toLocaleString('en-US', {
          timeZone: 'America/New_York',
        }),
        note: 'Storing proper UTC, database will display in user timezone',
      })

      const putawayData: Partial<PutawayOperationData> = {
        organization_id: '', // This will be set by RLS or application logic
        created_by: '', // This will be set by the application
        created_at: utcISOString,
      }

      // Map values based on column mapping
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
              // Try to parse date
              // eslint-disable-next-line no-case-declarations
              const date = new Date(value)
              if (!isNaN(date.getTime())) {
                putawayData.putaway_date = date.toISOString().split('T')[0]
              }
              break
            default:
              ;(putawayData as any)[field] = value
          }
        }
      }

      // Validate required fields
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
    } catch (error) {
      logger.error('Error mapping row data:', error)
      return null
    }
  }

  /**
   * Client-side search for filtering already-loaded putaway operations
   * Uses Rust service filter when enabled for consistent behavior
   */
  filterPutawayOperations(
    operations: PutawayOperationsWithUser,
    searchQuery: string
  ): PutawayOperationsWithUser {
    // Use Rust service filter when enabled
    if (RUST_CORE_ENABLED) {
      return rustPutawayLogService.filterPutawayOperations(
        operations,
        searchQuery
      )
    }

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
        normalizeField(op.created_at).includes(query) ||
        normalizeField(op.putaway_date).includes(query) ||
        normalizeField(op.confirmed_by_user?.full_name).includes(query) ||
        normalizeField(op.confirmed_by_user?.email).includes(query) ||
        normalizeField((op as any).stow_cart_number).includes(query) ||
        normalizeField(
          (op as any).cart_stow_assignment?.stowed_by_user?.full_name
        ).includes(query)
      )
    })
  }

  // Create a new putaway operation
  async createPutawayOperation(
    operationData: Partial<PutawayOperationData>
  ): Promise<{ data: PutawayOperationData | null; error: any }> {
    // Use Rust service when enabled
    if (RUST_CORE_ENABLED) {
      logger.log('🦀 Using Rust core service to create putaway operation')
      return rustPutawayLogService.createPutawayOperation(operationData)
    }

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

  // Update an existing putaway operation
  async updatePutawayOperation(
    id: string,
    updates: Partial<PutawayOperationData>
  ): Promise<{ data: PutawayOperationData | null; error: any }> {
    // Use Rust service when enabled
    if (RUST_CORE_ENABLED) {
      logger.log('🦀 Using Rust core service to update putaway operation')
      return rustPutawayLogService.updatePutawayOperation(id, updates)
    }

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

  // Delete a putaway operation
  async deletePutawayOperation(
    id: string
  ): Promise<{ success: boolean; error: any }> {
    // Use Rust service when enabled
    if (RUST_CORE_ENABLED) {
      logger.log('🦀 Using Rust core service to delete putaway operation')
      return rustPutawayLogService.deletePutawayOperation(id)
    }

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

  // Export data to CSV
  exportToCSV(operations: PutawayOperationsWithUser): string {
    const headers = [
      'ID',
      'Material Number',
      'TO Number',
      'TO Location',
      'Shelf Location',
      'Putaway Driver',
      'Warehouse',
      'Status',
      'MCA Workflow',
      'MCA Reason',
      'Putaway Date',
      'Putaway Time',
      'Created By',
      'Created At',
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
export const putawayLogService = PutawayLogService.getInstance()

// Created and developed by Jai Singh
