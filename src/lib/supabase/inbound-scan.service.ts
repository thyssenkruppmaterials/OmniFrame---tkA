import type { QueryData } from '@supabase/supabase-js'
import { RUST_CORE_ENABLED } from '@/lib/rust-core'
import { rustInboundScanService } from '@/lib/rust-core/inbound-scan.service'
import { logger } from '@/lib/utils/logger'
import {
  getTodayEST,
  getStartOfTodayEST,
  getEndOfTodayEST,
  getDaysAgoEST,
} from '@/lib/utils/timezone'
import { supabase } from './client'
import type { Tables } from './database.types'

// Define the table row type for inbound scans
export type InboundScanData = Tables<'rr_inbound_scans'>

// Define the query for fetching inbound scans with user profile information
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const inboundScansWithUserQuery = supabase.from('rr_inbound_scans').select(`
    *,
    scanned_by_profile:user_profiles!rr_inbound_scans_scanned_by_fkey(
      full_name,
      email
    )
  `)

export type InboundScansWithUser = QueryData<typeof inboundScansWithUserQuery>

// Statistics interface
export interface InboundScanStatistics {
  totalScans: number
  todayScans: number
  uniqueMaterials: number
  uniqueLocations: number
  hotTruckScans: number
  averageQuantity: number | null
  weeklyAverage: number
  dayOfWeekAverage: number
  dayOfWeekName: string
  statusBreakdown: Record<string, number>
}

// Import progress interface
export interface ImportProgress {
  phase: string
  current: number
  total: number
  percentage: number
  message: string
}

// Service class for inbound scan operations
export class InboundScanService {
  private static instance: InboundScanService

  private constructor() {}

  public static getInstance(): InboundScanService {
    if (!InboundScanService.instance) {
      InboundScanService.instance = new InboundScanService()
    }
    return InboundScanService.instance
  }

  /**
   * Check if using Rust service
   */
  isUsingRust(): boolean {
    return RUST_CORE_ENABLED && rustInboundScanService.isUsingRust()
  }

  /**
   * Fetch ALL inbound scans using optimized chunking to bypass 1000 record limit
   * Uses Rust core service when VITE_RUST_CORE_ENABLED=true
   * Falls back to controlled sequential chunking to prevent timeouts
   */
  async fetchInboundScans(): Promise<{
    data: InboundScansWithUser
    error: any
  }> {
    // Use Rust service when enabled
    if (RUST_CORE_ENABLED) {
      logger.log('🦀 Using Rust core service for inbound scans')
      return rustInboundScanService.fetchInboundScans()
    }

    try {
      logger.log(
        '🚀 Fetching ALL inbound scans using CONTROLLED SEQUENTIAL chunking to prevent timeouts...'
      )

      // First, get total count
      const { count, error: countError } = await supabase
        .from('rr_inbound_scans')
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

      // Calculate chunks needed (1000 records per chunk)
      const chunkSize = 1000
      const totalChunks = Math.ceil(count / chunkSize)
      const allRecords: InboundScansWithUser = []
      const concurrentLimit = 5 // Max 5 parallel requests to prevent timeouts
      const delayBetweenBatches = 100 // 100ms delay between batches

      logger.log(
        `🔢 Fetching ${totalChunks} chunks of ${chunkSize} records each with controlled concurrency...`
      )

      // Process chunks in batches to prevent overwhelming the database
      for (let i = 0; i < totalChunks; i += concurrentLimit) {
        const batchPromises = []
        const batchEnd = Math.min(i + concurrentLimit, totalChunks)

        for (let j = i; j < batchEnd; j++) {
          const from = j * chunkSize
          const to = from + chunkSize - 1

          const promise = supabase
            .from('rr_inbound_scans')
            .select(
              `
              *,
              scanned_by_profile:user_profiles!rr_inbound_scans_scanned_by_fkey(
                full_name,
                email
              )
            `
            )
            .order('scanned_at', { ascending: false })
            .range(from, to)
            .then(({ data, error }) => {
              if (error) throw error
              return data || []
            })

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

          // Add delay between batches to prevent rate limiting
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

      logger.log(
        `✅ Successfully fetched all ${allRecords.length} inbound scan records`
      )
      return { data: allRecords, error: null }
    } catch (error) {
      logger.error('Error fetching inbound scans:', error)
      return { data: [], error }
    }
  }

  /**
   * Fetch inbound scans with SERVER-SIDE pagination (FAST - target < 300ms)
   * Uses Rust core service when VITE_RUST_CORE_ENABLED=true
   * Only fetches the requested page instead of all records
   */
  async fetchInboundScansPaginated(
    options: {
      page?: number
      pageSize?: number
      search?: string
    } = {}
  ): Promise<{
    data: InboundScansWithUser
    total: number
    page: number
    pageSize: number
    totalPages: number
    error: any
  }> {
    // Use Rust service when enabled (delegates to rustInboundScanService)
    if (RUST_CORE_ENABLED) {
      logger.log('🦀 Using Rust core service for paginated inbound scans')
      return rustInboundScanService.fetchInboundScansPaginated(options)
    }

    // Supabase fallback with server-side pagination
    const page = options.page || 1
    const pageSize = options.pageSize || 25
    const search = options.search?.trim() || ''
    const offset = (page - 1) * pageSize

    try {
      const startTime = performance.now()
      logger.log(
        `📦 Fetching page ${page} via Supabase (${pageSize} records)...${search ? ` search: "${search}"` : ''}`
      )

      let query = supabase.from('rr_inbound_scans').select(
        `
          *,
          scanned_by_profile:user_profiles!rr_inbound_scans_scanned_by_fkey(
            full_name,
            email
          )
        `,
        { count: 'exact' }
      )

      // Apply search filter FIRST (before pagination) for correct results
      if (search) {
        query = query.or(
          `material_number.ilike.%${search}%,` +
            `tka_batch_number.ilike.%${search}%,` +
            `tracking_number.ilike.%${search}%,` +
            `so_line_rma_afa.ilike.%${search}%`
        )
      }

      // Then apply ordering and pagination
      query = query
        .order('scanned_at', { ascending: false })
        .range(offset, offset + pageSize - 1)

      const { data, error, count } = await query

      const elapsed = performance.now() - startTime
      logger.log(
        `⚡ Supabase paginated fetch: ${data?.length || 0} records in ${elapsed.toFixed(0)}ms`
      )

      if (error) {
        return { data: [], total: 0, page, pageSize, totalPages: 0, error }
      }

      return {
        data: data || [],
        total: count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count || 0) / pageSize),
        error: null,
      }
    } catch (error) {
      logger.error('Error in paginated fetch:', error)
      return { data: [], total: 0, page, pageSize, totalPages: 0, error }
    }
  }

  /**
   * Search inbound scans using database query (searches entire dataset)
   * @param query - Search query string
   * @deprecated This method is no longer needed - use fetchInboundScans() and filter client-side instead
   */
  async searchInboundScans(
    query: string
  ): Promise<{ data: InboundScansWithUser; error: any }> {
    try {
      if (!query.trim()) {
        // If no query, return all data
        return await this.fetchInboundScans()
      }

      const searchTerm = query.toLowerCase()
      logger.log(
        `🔍 Searching inbound scans for: "${searchTerm}" (no limit - entire database)`
      )

      // Fetch all matching records without limit using chunking
      const allRecords: InboundScansWithUser = []
      let offset = 0
      const batchSize = 1000
      let hasMore = true

      while (hasMore) {
        const { data, error } = await supabase
          .from('rr_inbound_scans')
          .select(
            `
            *,
            scanned_by_profile:user_profiles!rr_inbound_scans_scanned_by_fkey(
              full_name,
              email
            )
          `
          )
          .or(
            `material_number.ilike.%${searchTerm}%,tka_batch_number.ilike.%${searchTerm}%,tracking_number.ilike.%${searchTerm}%,so_line_rma_afa.ilike.%${searchTerm}%,notes.ilike.%${searchTerm}%,scan_location.ilike.%${searchTerm}%`
          )
          .order('scanned_at', { ascending: false })
          .range(offset, offset + batchSize - 1)

        if (error) {
          logger.error('Search query error:', error)
          return { data: allRecords, error }
        }

        if (data && data.length > 0) {
          allRecords.push(...data)
          hasMore = data.length === batchSize
          offset += batchSize
          logger.log(
            `📄 Fetched search batch: ${data.length} scans (total: ${allRecords.length})`
          )
        } else {
          hasMore = false
        }
      }

      logger.log(
        `✅ Found ${allRecords.length} matching inbound scans (entire database searched)`
      )
      return { data: allRecords, error: null }
    } catch (error) {
      logger.error('Error searching inbound scans:', error)
      return { data: [], error }
    }
  }

  // Fetch statistics for inbound scans
  async fetchStatistics(): Promise<{
    statistics: InboundScanStatistics | null
    error: any
  }> {
    // Use Rust service when enabled
    if (RUST_CORE_ENABLED) {
      logger.log('🦀 Using Rust core service for inbound scan statistics')
      return rustInboundScanService.fetchStatistics()
    }

    try {
      // Use RPC function for optimized statistics calculation
      const { data, error } = await supabase.rpc('get_inbound_scan_statistics')

      if (error) {
        // Fallback to client-side calculation if RPC function doesn't exist
        logger.warn(
          'RPC function not found, calculating statistics client-side'
        )
        return this.calculateStatisticsClientSide()
      }

      return {
        statistics: data as unknown as InboundScanStatistics,
        error: null,
      }
    } catch (error) {
      logger.error('Error fetching statistics:', error)
      return { statistics: null, error }
    }
  }

  // Fallback statistics calculation using optimized COUNT queries
  private async calculateStatisticsClientSide(): Promise<{
    statistics: InboundScanStatistics | null
    error: any
  }> {
    try {
      logger.log(
        '📊 Calculating inbound scan statistics from entire database...'
      )

      // Use EST timezone for accurate "today" calculation
      const today = getTodayEST()
      const startOfToday = getStartOfTodayEST()
      const endOfToday = getEndOfTodayEST()

      logger.log(`📅 Inbound Scan Statistics: Using EST date - Today: ${today}`)

      // Get total count (entire database)
      const { count: totalCount } = await supabase
        .from('rr_inbound_scans')
        .select('*', { count: 'exact', head: true })

      // Get today's scans count using EST boundaries
      // NOTE: This client-side fallback may have timezone conversion issues
      // The RPC function get_inbound_scan_statistics() uses proper timezone() conversion
      const { count: todayCount } = await supabase
        .from('rr_inbound_scans')
        .select('*', { count: 'exact', head: true })
        .gte('scanned_at', startOfToday)
        .lte('scanned_at', endOfToday)

      // Get hot truck scans count
      const { count: hotTruckCount } = await supabase
        .from('rr_inbound_scans')
        .select('*', { count: 'exact', head: true })
        .eq('hot_truck', true)

      // Get unique materials (selective field query)
      const { data: materialData } = await supabase
        .from('rr_inbound_scans')
        .select('material_number')
        .not('material_number', 'is', null)

      // Get unique locations (selective field query)
      const { data: locationData } = await supabase
        .from('rr_inbound_scans')
        .select('scan_location')
        .not('scan_location', 'is', null)

      // Get quantity data for averages (selective field query)
      const { data: quantityData } = await supabase
        .from('rr_inbound_scans')
        .select('quantity')
        .not('quantity', 'is', null)

      // Calculate weekly average using EST timezone
      const now = new Date()
      const sevenDaysAgoEST = getDaysAgoEST(7)

      const { count: weekCount } = await supabase
        .from('rr_inbound_scans')
        .select('*', { count: 'exact', head: true })
        .gte('scanned_at', `${sevenDaysAgoEST}T00:00:00`)

      const weeklyAverage = weekCount ? Math.round(weekCount / 7) : 0

      // Calculate averages
      const totalQuantity =
        quantityData?.reduce(
          (sum, scan) => sum + (Number(scan.quantity) || 0),
          0
        ) || 0
      const averageQuantity =
        quantityData && quantityData.length > 0
          ? totalQuantity / quantityData.length
          : null

      // Day of week info using EST timezone
      const estFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'long',
      })
      const dayOfWeekName = estFormatter.format(now)

      // Calculate day-of-week average (e.g., average for all Thursdays)
      // Get all scans for this day of week in the database
      const dayOfWeek = new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York',
        weekday: 'long',
      })

      // Fetch all scans with their dates to calculate day-of-week average
      const { data: allScansForDayCalc } = await supabase
        .from('rr_inbound_scans')
        .select('created_at')
        .not('created_at', 'is', null)

      // Calculate which scans fall on the same day of week
      let dayOfWeekCount = 0
      if (allScansForDayCalc) {
        allScansForDayCalc.forEach((scan) => {
          if (!scan.created_at) return
          const scanDate = new Date(scan.created_at)
          const scanDayOfWeek = scanDate.toLocaleString('en-US', {
            timeZone: 'America/New_York',
            weekday: 'long',
          })
          if (scanDayOfWeek === dayOfWeek) {
            dayOfWeekCount++
          }
        })
      }

      // Calculate number of occurrences of this day of week in our data
      const lastScan =
        allScansForDayCalc && allScansForDayCalc.length > 0
          ? allScansForDayCalc[allScansForDayCalc.length - 1]
          : null
      const firstScanDate = lastScan?.created_at
        ? new Date(lastScan.created_at)
        : new Date()

      const daysSinceFirstScan = Math.floor(
        (now.getTime() - firstScanDate.getTime()) / (1000 * 60 * 60 * 24)
      )
      const weeksOfData = Math.max(Math.floor(daysSinceFirstScan / 7), 1)

      const dayOfWeekAverage =
        dayOfWeekCount > 0 ? Math.round(dayOfWeekCount / weeksOfData) : 0

      // Get scans with notes count
      const { count: withNotesCount } = await supabase
        .from('rr_inbound_scans')
        .select('*', { count: 'exact', head: true })
        .not('notes', 'is', null)

      const statistics: InboundScanStatistics = {
        totalScans: totalCount || 0,
        todayScans: todayCount || 0,
        uniqueMaterials: materialData
          ? new Set(materialData.map((r) => r.material_number).filter(Boolean))
              .size
          : 0,
        uniqueLocations: locationData
          ? new Set(locationData.map((r) => r.scan_location).filter(Boolean))
              .size
          : 0,
        hotTruckScans: hotTruckCount || 0,
        averageQuantity,
        weeklyAverage,
        dayOfWeekAverage,
        dayOfWeekName,
        statusBreakdown: {
          total: totalCount || 0,
          with_notes: withNotesCount || 0,
          hot_truck: hotTruckCount || 0,
        },
      }

      logger.log('✅ Inbound scan statistics calculated:', {
        totalScans: statistics.totalScans.toLocaleString(),
        todayScans: statistics.todayScans,
        uniqueMaterials: statistics.uniqueMaterials,
        uniqueLocations: statistics.uniqueLocations,
        hotTruckScans: statistics.hotTruckScans,
        weeklyAverage: statistics.weeklyAverage,
        dayOfWeekAverage: statistics.dayOfWeekAverage,
        dayOfWeekName: statistics.dayOfWeekName,
      })

      return { statistics, error: null }
    } catch (error) {
      logger.error('Error calculating statistics:', error)
      return { statistics: null, error }
    }
  }

  // Import from clipboard functionality
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

      // Column mapping - flexible header matching
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
        const batchData: Partial<InboundScanData>[] = []

        for (const row of batch) {
          try {
            const values = row.split('\t')
            const scanData = this.mapRowToScanData(values, columnMapping)
            if (scanData) {
              batchData.push(scanData)
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
            .from('rr_inbound_scans')
            .insert(batchData as Tables<'rr_inbound_scans'>[])

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
      barcode: ['barcode', 'bar code', 'bar_code'],
      material_number: [
        'material number',
        'material_number',
        'material',
        'part number',
        'part_number',
      ],
      quantity: ['quantity', 'qty'],
      tka_batch_number: ['tka batch', 'tka_batch', 'batch number', 'batch'],
      tracking_number: ['tracking number', 'tracking_number', 'tracking'],
      scan_location: ['location', 'scan location', 'scan_location'],
      so_line_rma_afa: ['so line', 'so_line', 'rma', 'afa', 'so_line_rma_afa'],
      hot_truck: ['hot truck', 'hot_truck', 'hot'],
      notes: ['notes', 'comments'],
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

  // Map row data to scan data object
  private mapRowToScanData(
    values: string[],
    mapping: Record<string, number>
  ): Partial<InboundScanData> | null {
    try {
      const scanData: Partial<InboundScanData> = {
        organization_id: '', // This will be set by RLS or application logic
        scanned_by: '', // This will be set by the application
        created_at: new Date().toISOString(), // UTC OK for system timestamps
      }

      // Map values based on column mapping
      for (const [field, columnIndex] of Object.entries(mapping)) {
        if (columnIndex < values.length && values[columnIndex]?.trim()) {
          const value = values[columnIndex].trim()

          switch (field) {
            case 'quantity':
              // eslint-disable-next-line no-case-declarations
              const qty = parseFloat(value)
              if (!isNaN(qty)) {
                scanData.quantity = qty
              }
              break
            case 'hot_truck':
              scanData.hot_truck = ['true', 'yes', '1', 'y'].includes(
                value.toLowerCase()
              )
              break
            default:
              ;(scanData as any)[field] = value
          }
        }
      }

      // Validate required fields (at least one identifier should be present)
      const hasIdentifier =
        scanData.barcode ||
        scanData.material_number ||
        scanData.tka_batch_number ||
        scanData.tracking_number

      if (!hasIdentifier) {
        throw new Error(
          'Missing required identifier (barcode, material number, TKA batch, or tracking number)'
        )
      }

      return scanData
    } catch (error) {
      logger.error('Error mapping row data:', error)
      return null
    }
  }

  /**
   * Fetch all inbound scans for the last N days (for reports/analytics)
   * Uses Rust core service when VITE_RUST_CORE_ENABLED=true
   * Falls back to pagination to bypass 1000-row Supabase limit
   * @param days - Number of days to fetch (default: 30)
   */
  async fetchScansForLastDays(
    days: number = 30
  ): Promise<{ data: InboundScansWithUser; error: any }> {
    // Use Rust service when enabled
    if (RUST_CORE_ENABLED) {
      logger.log(
        `🦀 Using Rust core service for last ${days} days of inbound scans`
      )
      return rustInboundScanService.fetchScansForLastDays(days)
    }

    try {
      const daysAgo = new Date()
      daysAgo.setDate(daysAgo.getDate() - days)
      const startDate = daysAgo.toISOString()

      logger.log(
        `📊 Fetching ALL inbound scans for last ${days} days (since ${startDate})...`
      )

      // Fetch all scans using pagination (Supabase has 1000-row default limit)
      const PAGE_SIZE = 1000
      let allData: InboundScansWithUser = []
      let page = 0
      let hasMore = true

      while (hasMore) {
        const from = page * PAGE_SIZE
        const to = from + PAGE_SIZE - 1

        const { data, error } = await supabase
          .from('rr_inbound_scans')
          .select(
            `
            *,
            scanned_by_profile:user_profiles!rr_inbound_scans_scanned_by_fkey(
              full_name,
              email
            )
          `
          )
          .gte('scanned_at', startDate)
          .order('scanned_at', { ascending: false })
          .range(from, to)

        if (error) {
          logger.error(
            `❌ Error fetching ${days}-day scan data page ${page + 1}:`,
            error
          )
          return { data: allData, error }
        }

        if (data && data.length > 0) {
          allData = [...allData, ...data]
          logger.log(
            `📄 Fetched page ${page + 1}: ${data.length} scans (total: ${allData.length})`
          )
          hasMore = data.length === PAGE_SIZE
          page++
        } else {
          hasMore = false
        }
      }

      logger.log(`✅ Fetched ${allData.length} scans from last ${days} days`)
      return { data: allData, error: null }
    } catch (error) {
      logger.error(`Error fetching scans for last ${days} days:`, error)
      return { data: [], error }
    }
  }

  /**
   * Client-side search for filtering already-loaded scans
   * @deprecated Use searchInboundScans(query, limit) for database search instead
   */
  filterScans(
    scans: InboundScansWithUser,
    searchQuery: string
  ): InboundScansWithUser {
    if (!searchQuery.trim()) {
      return scans
    }

    // Normalize query by removing extra whitespace and converting to lowercase
    const query = searchQuery.toLowerCase().replace(/\s+/g, ' ').trim()

    return scans.filter((scan) => {
      // Helper function to normalize field values for comparison
      const normalizeField = (value: string | null | undefined): string => {
        return (value || '').toLowerCase().replace(/\s+/g, ' ').trim()
      }

      return (
        normalizeField(scan.material_number).includes(query) ||
        normalizeField(scan.tka_batch_number).includes(query) ||
        normalizeField(scan.tracking_number).includes(query) ||
        normalizeField(scan.so_line_rma_afa).includes(query) ||
        normalizeField(scan.notes).includes(query) ||
        normalizeField(scan.scanned_by_profile?.full_name).includes(query) ||
        normalizeField(scan.scanned_by_profile?.email).includes(query) ||
        // Also search in formatted date
        normalizeField(scan.scanned_at).includes(query) ||
        // Search in quantity as string
        normalizeField(scan.quantity?.toString()).includes(query) ||
        // Search in hot truck status
        (scan.hot_truck === true && 'hot'.includes(query)) ||
        (scan.hot_truck === false && 'normal'.includes(query))
      )
    })
  }

  // Create a new inbound scan
  async createScan(
    scanData: Partial<InboundScanData>
  ): Promise<{ data: InboundScanData | null; error: any }> {
    // Use Rust service when enabled
    if (RUST_CORE_ENABLED) {
      logger.log('🦀 Using Rust core service to create inbound scan')
      return rustInboundScanService.createScan(scanData)
    }

    try {
      const { data, error } = await supabase
        .from('rr_inbound_scans')
        .insert(scanData as Tables<'rr_inbound_scans'>)
        .select()
        .single()

      return { data, error }
    } catch (error) {
      logger.error('Error creating scan:', error)
      return { data: null, error }
    }
  }

  // Update an existing scan
  async updateScan(
    id: string,
    updates: Partial<InboundScanData>
  ): Promise<{ data: InboundScanData | null; error: any }> {
    try {
      const { data, error } = await supabase
        .from('rr_inbound_scans')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      return { data, error }
    } catch (error) {
      logger.error('Error updating scan:', error)
      return { data: null, error }
    }
  }

  // Delete a scan
  async deleteScan(id: string): Promise<{ success: boolean; error: any }> {
    try {
      const { error } = await supabase
        .from('rr_inbound_scans')
        .delete()
        .eq('id', id)

      return { success: !error, error }
    } catch (error) {
      logger.error('Error deleting scan:', error)
      return { success: false, error }
    }
  }

  // Export data to CSV with specified headers and format
  exportToCSV(scans: InboundScansWithUser): string {
    // Headers with proper quoting for CSV format
    const headers = [
      '"Date"',
      '"Time"',
      '"TKA Batch Number"',
      '"SO/Line, RMA/AFA #"',
      '"Tracking Number"',
      '"Material Number"',
      '"Quantity"',
      '"Scanned By"',
      '"Priority"',
      '"Unique ID"',
    ]

    const csvContent = [
      headers.join(','),
      ...scans.map((scan) => {
        // Split scanned_at into Date and Time
        let date = ''
        let time = ''
        if (scan.scanned_at) {
          const scannedDate = new Date(scan.scanned_at)
          date = scannedDate.toLocaleDateString('en-US') // MM/DD/YYYY format
          time = scannedDate.toLocaleTimeString('en-US') // HH:MM:SS AM/PM format
        }

        return [
          `"${date}"`,
          `"${time}"`,
          `"${scan.tka_batch_number || ''}"`,
          `"${scan.so_line_rma_afa || ''}"`,
          `"${scan.tracking_number || ''}"`,
          `"${scan.material_number || ''}"`,
          `"${scan.quantity || ''}"`,
          `"${scan.scanned_by_profile?.full_name || scan.scanned_by_profile?.email || ''}"`,
          `"${scan.hot_truck ? 'Hot Truck' : 'Normal'}"`,
          `"${scan.id}"`,
        ].join(',')
      }),
    ].join('\n')

    return csvContent
  }

  /**
   * Fetch ALL inbound scans for export with optional search filter
   * Bypasses pagination to get complete dataset
   */
  async fetchAllForExport(
    search?: string
  ): Promise<{ data: InboundScansWithUser; total: number; error: any }> {
    try {
      logger.log(
        `📦 Fetching ALL scans for export...${search ? ` search: "${search}"` : ''}`
      )
      const startTime = performance.now()

      // First, get total count
      let countQuery = supabase
        .from('rr_inbound_scans')
        .select('*', { count: 'exact', head: true })

      // Apply search filter if provided
      if (search) {
        countQuery = countQuery.or(
          `material_number.ilike.%${search}%,` +
            `tka_batch_number.ilike.%${search}%,` +
            `tracking_number.ilike.%${search}%,` +
            `so_line_rma_afa.ilike.%${search}%`
        )
      }

      const { count, error: countError } = await countQuery

      if (countError) {
        logger.error('❌ Count query error:', countError)
        return { data: [], total: 0, error: countError }
      }

      if (!count) {
        logger.warn('⚠️ No records found to export')
        return { data: [], total: 0, error: null }
      }

      logger.log(`📊 Total records to export: ${count}`)

      // Fetch all records in chunks
      const chunkSize = 1000
      const totalChunks = Math.ceil(count / chunkSize)
      const allRecords: InboundScansWithUser = []
      const concurrentLimit = 5
      const delayBetweenBatches = 100

      for (let i = 0; i < totalChunks; i += concurrentLimit) {
        const batchPromises = []
        const batchEnd = Math.min(i + concurrentLimit, totalChunks)

        for (let j = i; j < batchEnd; j++) {
          const from = j * chunkSize
          const to = from + chunkSize - 1

          let query = supabase.from('rr_inbound_scans').select(`
              *,
              scanned_by_profile:user_profiles!rr_inbound_scans_scanned_by_fkey(
                full_name,
                email
              )
            `)

          // Apply search filter if provided
          if (search) {
            query = query.or(
              `material_number.ilike.%${search}%,` +
                `tka_batch_number.ilike.%${search}%,` +
                `tracking_number.ilike.%${search}%,` +
                `so_line_rma_afa.ilike.%${search}%`
            )
          }

          const promise = query
            .order('scanned_at', { ascending: false })
            .range(from, to)
            .then(({ data, error }) => {
              if (error) throw error
              return data || []
            })

          batchPromises.push(promise)
        }

        try {
          const batchResults = await Promise.all(batchPromises)
          batchResults.forEach((chunk) => {
            allRecords.push(...chunk)
          })

          logger.log(
            `✅ Export batch ${Math.floor(i / concurrentLimit) + 1}: ${allRecords.length}/${count} records`
          )

          if (batchEnd < totalChunks) {
            await new Promise((resolve) =>
              setTimeout(resolve, delayBetweenBatches)
            )
          }
        } catch (error) {
          logger.error(`❌ Error fetching export batch:`, error)
          return { data: allRecords, total: allRecords.length, error }
        }
      }

      const elapsed = performance.now() - startTime
      logger.log(
        `✅ Export fetch complete: ${allRecords.length} records in ${elapsed.toFixed(0)}ms`
      )

      return { data: allRecords, total: allRecords.length, error: null }
    } catch (error) {
      logger.error('Error fetching data for export:', error)
      return { data: [], total: 0, error }
    }
  }
}

// Export singleton instance
export const inboundScanService = InboundScanService.getInstance()
// Developer and Creator: Jai Singh
