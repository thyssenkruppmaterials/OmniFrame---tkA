// Created and developed by Jai Singh
/**
 * Rust-enabled Inbound Scan Service
 *
 * This service provides inbound scan operations using the high-performance
 * Rust core service. Falls back to Supabase for operations not yet supported.
 *
 * Enable by setting VITE_RUST_CORE_ENABLED=true and VITE_RUST_CORE_URL
 */
import type { QueryData } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import type { Tables } from '@/lib/supabase/database.types'
import { logger } from '@/lib/utils/logger'
import {
  getRustCoreClient,
  initRustCoreClient,
  type InboundScan,
  type InboundScanResponse,
  RUST_CORE_ENABLED,
} from './index'

// Re-export types for compatibility
export type InboundScanData = Tables<'rr_inbound_scans'>

// User profile join query for Supabase fallback
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const inboundScansWithUserQuery = supabase.from('rr_inbound_scans').select(`
    *,
    scanned_by_profile:user_profiles!rr_inbound_scans_scanned_by_fkey(
      full_name,
      email
    )
  `)

export type InboundScansWithUser = QueryData<typeof inboundScansWithUserQuery>

// Statistics interface (same as Supabase service)
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

// Report statistics interface (returned by get_inbound_scan_report_stats RPC)
export interface ReportStats {
  daily_counts: Array<{ date: string; count: number }>
  summary: {
    total_scans: number
    total_days: number
    average_per_day: number
    peak_day: { date: string; count: number }
    first_week_avg: number
    last_week_avg: number
    trend: number
  }
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
 * Convert Rust InboundScan to InboundScansWithUser format
 * Note: Rust service doesn't include user profile, so we add null profile
 */
function rustScanToWithUser(scan: InboundScan): InboundScansWithUser[0] {
  // Cast to unknown first to handle the type mismatch between Rust and Supabase types
  // The scanned_by_profile will be enriched later via enrichWithUserProfiles()
  return {
    id: scan.id,
    created_at: scan.created_at,
    updated_at: scan.updated_at,
    organization_id: scan.organization_id as string, // Rust may return null, Supabase expects string
    scanned_by: scan.scanned_by as string, // Rust may return null, Supabase expects string
    scanned_at: scan.scanned_at,
    material_number: scan.material_number,
    tka_batch_number: scan.tka_batch_number,
    tracking_number: scan.tracking_number,
    so_line_rma_afa: scan.so_line_rma_afa,
    quantity: scan.quantity,
    scan_location: scan.scan_location,
    hot_truck: scan.hot_truck,
    notes: scan.notes,
    barcode: scan.barcode,
    scanned_by_profile: null as unknown, // Will be enriched by enrichWithUserProfiles()
  } as InboundScansWithUser[0]
}

/**
 * Rust-enabled Inbound Scan Service
 * Uses Rust core service when enabled, falls back to Supabase otherwise
 */
export class RustInboundScanService {
  private static instance: RustInboundScanService
  private useRust: boolean
  private userProfileCache: Map<
    string,
    { full_name: string | null; email: string | null }
  > = new Map()

  private constructor() {
    this.useRust = ensureRustClientInitialized() && RUST_CORE_ENABLED
    logger.log(
      `🦀 RustInboundScanService initialized - Rust enabled: ${this.useRust}`
    )
  }

  public static getInstance(): RustInboundScanService {
    if (!RustInboundScanService.instance) {
      RustInboundScanService.instance = new RustInboundScanService()
    }
    return RustInboundScanService.instance
  }

  /**
   * Check if Rust service is being used
   */
  isUsingRust(): boolean {
    return this.useRust
  }

  /**
   * Fetch user profiles for a list of user IDs
   * Caches results to avoid repeated lookups
   */
  private async fetchUserProfiles(userIds: string[]): Promise<void> {
    const uncachedIds = userIds.filter(
      (id) => id && !this.userProfileCache.has(id)
    )

    if (uncachedIds.length === 0) return

    const { data } = await supabase
      .from('user_profiles')
      .select('id, full_name, email')
      .in('id', uncachedIds)

    if (data) {
      data.forEach((profile) => {
        this.userProfileCache.set(profile.id, {
          full_name: profile.full_name,
          email: profile.email,
        })
      })
    }
  }

  /**
   * Enrich Rust scans with user profile data
   */
  private async enrichWithUserProfiles(
    scans: InboundScan[]
  ): Promise<InboundScansWithUser> {
    // Collect unique user IDs
    const userIds = [
      ...new Set(scans.map((s) => s.scanned_by).filter(Boolean)),
    ] as string[]

    // Fetch any missing profiles
    await this.fetchUserProfiles(userIds)

    // Map scans with profile data
    return scans.map((scan) => {
      const profile = scan.scanned_by
        ? this.userProfileCache.get(scan.scanned_by)
        : null
      return {
        ...rustScanToWithUser(scan),
        scanned_by_profile: profile || null,
      } as InboundScansWithUser[0]
    })
  }

  /**
   * Fetch inbound scans with server-side pagination (FAST - < 300ms)
   * Only fetches the requested page instead of all records
   *
   * Note: When search is provided, uses Supabase for multi-field search capability.
   * Rust is used for non-search pagination (faster for browsing).
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
    error: unknown
  }> {
    const page = options.page || 1
    const pageSize = options.pageSize || 25
    const search = options.search?.trim() || ''
    const offset = (page - 1) * pageSize

    // Use Supabase for search queries (multi-field search support)
    // Rust is used for non-search pagination (faster browsing)
    if (!this.useRust || search) {
      if (search) {
        logger.log(`🔍 Using Supabase for multi-field search: "${search}"`)
      }
      return this.fetchInboundScansPaginatedSupabase({ page, pageSize, search })
    }

    try {
      const startTime = performance.now()
      logger.log(`🦀 Fetching page ${page} (${pageSize} records) via Rust...`)
      const client = getRustCoreClient()

      // Fetch just the requested page (no search - Rust is faster for pagination)
      const response = await client.getInboundScans({
        limit: pageSize,
        offset,
      })

      const fetchTime = performance.now() - startTime

      // Enrich with user profiles (only for the small page of records)
      const enrichedScans = await this.enrichWithUserProfiles(response.scans)

      const totalTime = performance.now() - startTime
      logger.log(
        `✅ Rust paginated fetch: ${enrichedScans.length} records in ${totalTime.toFixed(0)}ms (fetch: ${fetchTime.toFixed(0)}ms)`
      )

      return {
        data: enrichedScans,
        total: response.total,
        page,
        pageSize,
        totalPages: Math.ceil(response.total / pageSize),
        error: null,
      }
    } catch (error) {
      logger.error(
        '❌ Rust paginated fetch error, falling back to Supabase:',
        error
      )
      return this.fetchInboundScansPaginatedSupabase({ page, pageSize, search })
    }
  }

  /**
   * Supabase fallback for paginated fetching with multi-field search
   */
  private async fetchInboundScansPaginatedSupabase(options: {
    page: number
    pageSize: number
    search: string
  }): Promise<{
    data: InboundScansWithUser
    total: number
    page: number
    pageSize: number
    totalPages: number
    error: unknown
  }> {
    const { page, pageSize, search } = options
    const offset = (page - 1) * pageSize

    try {
      logger.log(
        `📦 Fetching page ${page} via Supabase...${search ? ` search: "${search}"` : ''}`
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
      return { data: [], total: 0, page, pageSize, totalPages: 0, error }
    }
  }

  /**
   * Fetch ALL inbound scans (legacy method - use fetchInboundScansPaginated for better performance)
   * Uses Rust service with PARALLEL pagination for maximum speed
   * @deprecated Use fetchInboundScansPaginated() for better performance
   */
  async fetchInboundScans(): Promise<{
    data: InboundScansWithUser
    error: unknown
  }> {
    if (!this.useRust) {
      return this.fetchInboundScansSupabase()
    }

    try {
      logger.log(
        '🦀 Fetching ALL inbound scans via Rust core service (parallel mode)...'
      )
      const client = getRustCoreClient()
      const startTime = performance.now()

      // First, get total count with a small request
      const initialResponse = await client.getInboundScans({
        limit: 1,
        offset: 0,
      })
      const total = initialResponse.total
      logger.log(`🦀 Total records to fetch: ${total}`)

      // Use larger page size for fewer requests
      const pageSize = 10000
      const totalPages = Math.ceil(total / pageSize)

      // Fetch all pages in parallel (max 10 concurrent)
      const maxConcurrent = 10
      const allScans: InboundScan[] = []

      for (let batch = 0; batch < totalPages; batch += maxConcurrent) {
        const batchPromises: Promise<InboundScanResponse>[] = []
        const batchEnd = Math.min(batch + maxConcurrent, totalPages)

        for (let page = batch; page < batchEnd; page++) {
          batchPromises.push(
            client.getInboundScans({
              limit: pageSize,
              offset: page * pageSize,
            })
          )
        }

        const batchResults = await Promise.all(batchPromises)
        batchResults.forEach((response) => {
          allScans.push(...response.scans)
        })

        logger.log(
          `🦀 Fetched ${allScans.length}/${total} scans (batch ${Math.floor(batch / maxConcurrent) + 1})`
        )
      }

      const fetchTime = performance.now() - startTime
      logger.log(`🦀 Rust fetch completed in ${fetchTime.toFixed(0)}ms`)

      // Enrich with user profiles
      const enrichedScans = await this.enrichWithUserProfiles(allScans)

      const totalTime = performance.now() - startTime
      logger.log(
        `✅ Rust service: Fetched ${enrichedScans.length} inbound scans in ${totalTime.toFixed(0)}ms`
      )
      return { data: enrichedScans, error: null }
    } catch (error) {
      logger.error('❌ Rust service error, falling back to Supabase:', error)
      return this.fetchInboundScansSupabase()
    }
  }

  /**
   * Supabase fallback for fetching inbound scans
   */
  private async fetchInboundScansSupabase(): Promise<{
    data: InboundScansWithUser
    error: unknown
  }> {
    try {
      logger.log('📦 Fetching inbound scans via Supabase (fallback)...')

      const { count, error: countError } = await supabase
        .from('rr_inbound_scans')
        .select('*', { count: 'exact', head: true })

      if (countError) {
        return { data: [], error: countError }
      }

      if (!count) {
        return { data: [], error: null }
      }

      const chunkSize = 1000
      const totalChunks = Math.ceil(count / chunkSize)
      const allRecords: InboundScansWithUser = []

      for (let i = 0; i < totalChunks; i++) {
        const from = i * chunkSize
        const to = from + chunkSize - 1

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
          .order('scanned_at', { ascending: false })
          .range(from, to)

        if (error) {
          return { data: allRecords, error }
        }

        if (data) {
          allRecords.push(...data)
        }
      }

      return { data: allRecords, error: null }
    } catch (error) {
      return { data: [], error }
    }
  }

  /**
   * Fetch statistics for inbound scans
   * Always uses Supabase RPC function for comprehensive statistics
   * (Rust core service doesn't have complete statistics implementation)
   */
  async fetchStatistics(): Promise<{
    statistics: InboundScanStatistics | null
    error: unknown
  }> {
    // Always use Supabase RPC for statistics - it has comprehensive data
    // including weeklyAverage, dayOfWeekAverage, hotTruckScans, etc.
    // The Rust service doesn't have these statistics implemented
    return this.fetchStatisticsSupabase()
  }

  /**
   * Supabase fallback for statistics
   */
  private async fetchStatisticsSupabase(): Promise<{
    statistics: InboundScanStatistics | null
    error: unknown
  }> {
    try {
      const { data, error } = await supabase.rpc('get_inbound_scan_statistics')

      if (error) {
        logger.warn('RPC function not found, returning basic stats')
        // Return basic statistics
        const { count } = await supabase
          .from('rr_inbound_scans')
          .select('*', { count: 'exact', head: true })

        const now = new Date()
        const dayOfWeekName = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          weekday: 'long',
        }).format(now)

        return {
          statistics: {
            totalScans: count || 0,
            todayScans: 0,
            uniqueMaterials: 0,
            uniqueLocations: 0,
            hotTruckScans: 0,
            averageQuantity: null,
            weeklyAverage: 0,
            dayOfWeekAverage: 0,
            dayOfWeekName,
            statusBreakdown: { total: count || 0 },
          },
          error: null,
        }
      }

      return {
        statistics: data as unknown as InboundScanStatistics,
        error: null,
      }
    } catch (error) {
      return { statistics: null, error }
    }
  }

  /**
   * Create a new inbound scan
   * Uses Rust service when enabled
   */
  async createScan(
    scanData: Partial<InboundScanData>
  ): Promise<{ data: InboundScanData | null; error: unknown }> {
    if (!this.useRust) {
      return this.createScanSupabase(scanData)
    }

    try {
      logger.log('🦀 Creating inbound scan via Rust core service...')
      const client = getRustCoreClient()

      const rustScan = await client.createInboundScan({
        organization_id: scanData.organization_id || null,
        scanned_by: scanData.scanned_by || null,
        scanned_at: scanData.scanned_at || new Date().toISOString(),
        material_number: scanData.material_number || null,
        tka_batch_number: scanData.tka_batch_number || null,
        tracking_number: scanData.tracking_number || null,
        so_line_rma_afa: scanData.so_line_rma_afa || null,
        quantity: scanData.quantity || null,
        scan_location: scanData.scan_location || null,
        hot_truck: scanData.hot_truck || null,
        notes: scanData.notes || null,
        barcode: scanData.barcode || null,
      })

      logger.log('✅ Rust service: Created inbound scan')
      return {
        data: rustScan as unknown as InboundScanData,
        error: null,
      }
    } catch (error) {
      logger.error('❌ Rust create error, falling back to Supabase:', error)
      return this.createScanSupabase(scanData)
    }
  }

  /**
   * Supabase fallback for creating scans
   */
  private async createScanSupabase(
    scanData: Partial<InboundScanData>
  ): Promise<{ data: InboundScanData | null; error: unknown }> {
    try {
      const { data, error } = await supabase
        .from('rr_inbound_scans')
        .insert(scanData as Tables<'rr_inbound_scans'>)
        .select()
        .single()

      return { data, error }
    } catch (error) {
      return { data: null, error }
    }
  }

  /**
   * Update an existing scan
   * Note: Rust service doesn't support updates yet, always uses Supabase
   */
  async updateScan(
    id: string,
    updates: Partial<InboundScanData>
  ): Promise<{ data: InboundScanData | null; error: unknown }> {
    // Rust service doesn't support updates yet
    try {
      const { data, error } = await supabase
        .from('rr_inbound_scans')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      return { data, error }
    } catch (error) {
      return { data: null, error }
    }
  }

  /**
   * Delete a scan
   * Note: Rust service doesn't support deletes yet, always uses Supabase
   */
  async deleteScan(id: string): Promise<{ success: boolean; error: unknown }> {
    // Rust service doesn't support deletes yet
    try {
      const { error } = await supabase
        .from('rr_inbound_scans')
        .delete()
        .eq('id', id)

      return { success: !error, error }
    } catch (error) {
      return { success: false, error }
    }
  }

  /**
   * Client-side search for filtering already-loaded scans
   */
  filterScans(
    scans: InboundScansWithUser,
    searchQuery: string
  ): InboundScansWithUser {
    if (!searchQuery.trim()) {
      return scans
    }

    const query = searchQuery.toLowerCase().replace(/\s+/g, ' ').trim()

    return scans.filter((scan) => {
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
        normalizeField(scan.scanned_at).includes(query) ||
        normalizeField(scan.quantity?.toString()).includes(query) ||
        (scan.hot_truck === true && 'hot'.includes(query)) ||
        (scan.hot_truck === false && 'normal'.includes(query))
      )
    })
  }

  /**
   * Import from clipboard functionality
   * Uses Rust for batch inserts when enabled
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
          // Use Supabase for batch inserts (Rust doesn't support batch yet)
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

  private mapRowToScanData(
    values: string[],
    mapping: Record<string, number>
  ): Partial<InboundScanData> | null {
    try {
      const scanData: Partial<InboundScanData> = {
        organization_id: '',
        scanned_by: '',
        created_at: new Date().toISOString(),
      }

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
              ;(scanData as Record<string, unknown>)[field] = value
          }
        }
      }

      const hasIdentifier =
        scanData.barcode ||
        scanData.material_number ||
        scanData.tka_batch_number ||
        scanData.tracking_number

      if (!hasIdentifier) {
        throw new Error('Missing required identifier')
      }

      return scanData
    } catch {
      return null
    }
  }

  /**
   * Fetch scans for last N days
   */
  async fetchScansForLastDays(
    days: number = 30
  ): Promise<{ data: InboundScansWithUser; error: unknown }> {
    if (!this.useRust) {
      return this.fetchScansForLastDaysSupabase(days)
    }

    try {
      logger.log(`🦀 Fetching inbound scans for last ${days} days via Rust...`)
      const client = getRustCoreClient()

      const startDate = new Date()
      startDate.setDate(startDate.getDate() - days)

      const allScans: InboundScan[] = []
      const pageSize = 1000
      let offset = 0
      let hasMore = true

      while (hasMore) {
        const response = await client.getInboundScans({
          limit: pageSize,
          offset,
          start_date: startDate.toISOString(),
        })

        allScans.push(...response.scans)
        offset += pageSize
        hasMore = response.scans.length === pageSize
      }

      const enrichedScans = await this.enrichWithUserProfiles(allScans)
      return { data: enrichedScans, error: null }
    } catch (error) {
      logger.error('❌ Rust service error, falling back to Supabase:', error)
      return this.fetchScansForLastDaysSupabase(days)
    }
  }

  private async fetchScansForLastDaysSupabase(
    days: number
  ): Promise<{ data: InboundScansWithUser; error: unknown }> {
    const daysAgo = new Date()
    daysAgo.setDate(daysAgo.getDate() - days)
    const startDate = daysAgo.toISOString()

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
        return { data: allData, error }
      }

      if (data && data.length > 0) {
        allData = [...allData, ...data]
        hasMore = data.length === PAGE_SIZE
        page++
      } else {
        hasMore = false
      }
    }

    return { data: allData, error: null }
  }

  /**
   * Fetch aggregated report statistics (FAST - uses database aggregation)
   * Returns pre-computed daily counts and summary stats instead of all raw records
   * This is ~100x faster than fetching all records for reports
   */
  async fetchReportStats(days: number = 30): Promise<{
    data: ReportStats | null
    error: unknown
  }> {
    try {
      logger.log(`📊 Fetching aggregated report stats for last ${days} days...`)
      const startTime = performance.now()

      const rpcResult = await supabase.rpc('get_inbound_scan_report_stats', {
        days_back: days,
      })
      const { error } = rpcResult
      const data = rpcResult.data as ReportStats | null

      const elapsed = performance.now() - startTime

      if (error) {
        logger.error('❌ Failed to fetch report stats:', error)
        return { data: null, error }
      }

      logger.log(
        `✅ Report stats fetched in ${elapsed.toFixed(0)}ms (${data?.daily_counts?.length || 0} days, ${data?.summary?.total_scans || 0} total scans)`
      )
      return { data, error: null }
    } catch (error) {
      logger.error('❌ Error fetching report stats:', error)
      return { data: null, error }
    }
  }

  /**
   * Export data to CSV
   */
  exportToCSV(scans: InboundScansWithUser): string {
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
        let date = ''
        let time = ''
        if (scan.scanned_at) {
          const scannedDate = new Date(scan.scanned_at)
          date = scannedDate.toLocaleDateString('en-US')
          time = scannedDate.toLocaleTimeString('en-US')
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
}

// Export singleton instance
export const rustInboundScanService = RustInboundScanService.getInstance()

// Created and developed by Jai Singh
