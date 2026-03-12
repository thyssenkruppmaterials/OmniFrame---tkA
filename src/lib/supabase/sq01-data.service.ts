import { toast } from 'sonner'
import { RUST_CORE_ENABLED } from '@/lib/rust-core/config'
import { rustSQ01DataService } from '@/lib/rust-core/sq01-data.service'
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'
import type { Tables, TablesInsert } from './database.types'

// Type definitions for SQ01 data using database types
export type SQ01Data = Tables<'rr_sq01_data'>
export type SQ01DataInsert = TablesInsert<'rr_sq01_data'>

export interface ClipboardData {
  headers: string[]
  rows: string[][]
}

export interface ImportResult {
  success: boolean
  totalRows: number
  insertedRows: number
  duplicateRows: number
  errorRows: number
  errors: string[]
}

export interface ImportProgress {
  phase:
    | 'parsing'
    | 'validating'
    | 'clearing'
    | 'processing'
    | 'inserting'
    | 'completed'
  currentRow: number
  totalRows: number
  processedChunks: number
  totalChunks: number
  insertedRows: number
  duplicateRows: number
  errorRows: number
  errors: string[]
  message: string
}

export type ImportProgressCallback = (progress: ImportProgress) => void

export interface ColumnMapping {
  [key: string]: string
}

// Expected column headers for SQ01 data validation
export const EXPECTED_SQ01_HEADERS = [
  'Plnt',
  'Val. type',
  'SLoc',
  'Conf cert ref',
  'Material',
  'Material description',
  'Batch',
  'Serial number',
  'Unrestricted',
  'Blocked',
  'In qual. insp.',
  'Confirmed yield',
  'Ext MovAvgPrice',
  'Shelf life exp. date',
  'Last GR',
  'Created on',
  'General info',
]

// Column mapping from Excel headers to database fields
export const SQ01_COLUMN_MAPPING: ColumnMapping = {
  Plnt: 'plant',
  'Val. type': 'val_type',
  SLoc: 'sloc',
  'Conf cert ref': 'conf_cert_ref',
  Material: 'material',
  'Material description': 'material_description',
  Batch: 'batch',
  'Serial number': 'serial_number',
  Unrestricted: 'unrestricted',
  Blocked: 'blocked',
  'In qual. insp.': 'in_qual_insp',
  'Confirmed yield': 'confirmed_yield',
  'Ext MovAvgPrice': 'ext_mov_avg_price',
  'Shelf life exp. date': 'shelf_life_exp_date',
  'Last GR': 'last_gr',
  'Created on': 'created_on',
  'General info': 'general_info',
}

export class SQ01DataService {
  private static instance: SQ01DataService

  public static getInstance(): SQ01DataService {
    if (!SQ01DataService.instance) {
      SQ01DataService.instance = new SQ01DataService()
    }
    return SQ01DataService.instance
  }

  /**
   * Check if using Rust service
   */
  isUsingRust(): boolean {
    return RUST_CORE_ENABLED && rustSQ01DataService.isUsingRust()
  }

  /**
   * Fetch scanned SQ01 data only (where grs_scan_status is not null)
   * Optimized for GRS Inventory Manager - significantly reduces data load
   */
  async fetchScannedSQ01Data(): Promise<SQ01Data[]> {
    try {
      logger.log(
        '🚀 Fetching SCANNED SQ01 data only (grs_scan_status IS NOT NULL)...'
      )

      // First, get total count of scanned records
      const { count, error: countError } = await supabase
        .from('rr_sq01_data')
        .select('*', { count: 'exact', head: true })
        .not('grs_scan_status', 'is', null)

      if (countError) {
        logger.error('❌ Count query error:', countError)
        throw countError
      }

      if (!count) {
        logger.warn('⚠️ No scanned records found in database')
        return []
      }

      logger.log(`📊 Total scanned records to fetch: ${count}`)

      // Calculate chunks needed (1000 records per chunk)
      const chunkSize = 1000
      const totalChunks = Math.ceil(count / chunkSize)
      const allRecords: SQ01Data[] = []
      const concurrentLimit = 5 // Max 5 parallel requests to prevent timeouts
      const delayBetweenBatches = 100 // 100ms delay between batches

      logger.log(
        `🔢 Fetching ${totalChunks} chunks of ${chunkSize} scanned records each with controlled concurrency...`
      )

      // Process chunks in batches to prevent overwhelming the database
      for (
        let batchStart = 0;
        batchStart < totalChunks;
        batchStart += concurrentLimit
      ) {
        const batchEnd = Math.min(batchStart + concurrentLimit, totalChunks)
        const batchPromises = []

        logger.log(
          `🔄 Processing batch ${Math.floor(batchStart / concurrentLimit) + 1}: chunks ${batchStart + 1}-${batchEnd}`
        )

        // Create promises for this batch
        for (let i = batchStart; i < batchEnd; i++) {
          const start = i * chunkSize
          const end = start + chunkSize - 1

          const chunkPromise = supabase
            .from('rr_sq01_data')
            .select('*')
            .not('grs_scan_status', 'is', null)
            .order('created_at', { ascending: false })
            .range(start, end)
            .then(({ data, error }) => {
              if (error) {
                logger.error(`❌ Error fetching chunk ${i + 1}:`, error)
                throw error
              }
              logger.log(
                `✅ Chunk ${i + 1}/${totalChunks} completed: ${data?.length || 0} scanned records`
              )
              return data || []
            })

          batchPromises.push(chunkPromise)
        }

        // Wait for this batch to complete
        const batchResults = await Promise.all(batchPromises)
        batchResults.forEach((chunkData) => {
          allRecords.push(...chunkData)
        })

        // Add delay between batches to prevent overwhelming the database
        if (batchEnd < totalChunks) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayBetweenBatches)
          )
        }
      }

      logger.log(
        `✅ Successfully fetched ${allRecords.length} scanned SQ01 records`
      )
      logger.log(
        `⚡ Performance: Reduced from potentially ${count} to ${allRecords.length} records (scanned only)`
      )
      return allRecords
    } catch (error) {
      logger.error('Error fetching scanned SQ01 data:', error)
      throw error
    }
  }

  /**
   * Search scanned SQ01 data across all fields with database-level filtering
   * Optimized for GRS Inventory Manager search functionality
   */
  async searchScannedSQ01Data(searchQuery: string): Promise<SQ01Data[]> {
    try {
      if (!searchQuery.trim()) {
        // If no search query, return all scanned data
        return await this.fetchScannedSQ01Data()
      }

      logger.log(`🔍 Searching SCANNED SQ01 data for: "${searchQuery}"`)

      // Remove whitespace for whitespace-insensitive search
      const searchTerm = searchQuery.toLowerCase().trim()

      // Build search query across all relevant fields
      const { data, error } = await supabase
        .from('rr_sq01_data')
        .select('*')
        .not('grs_scan_status', 'is', null) // Only scanned records (has scan status)
        .or(
          `material.ilike.%${searchTerm}%,` +
            `material_description.ilike.%${searchTerm}%,` +
            `batch.ilike.%${searchTerm}%,` +
            `serial_number.ilike.%${searchTerm}%,` +
            `plant.ilike.%${searchTerm}%,` +
            `sloc.ilike.%${searchTerm}%,` +
            `conf_cert_ref.ilike.%${searchTerm}%,` +
            `val_type.ilike.%${searchTerm}%,` +
            `general_info.ilike.%${searchTerm}%,` +
            `grs_scan_status.ilike.%${searchTerm}%,` +
            `grs_scanned_by_name.ilike.%${searchTerm}%,` +
            `grs_actual_location_found.ilike.%${searchTerm}%,` +
            `grs_notes.ilike.%${searchTerm}%`
        )
        .order('created_at', { ascending: false })
        .limit(1000) // Limit search results for performance

      if (error) {
        logger.error('❌ Search query error:', error)
        throw error
      }

      logger.log(`✅ Found ${data?.length || 0} matching scanned records`)
      return data || []
    } catch (error) {
      logger.error('Error searching scanned SQ01 data:', error)
      throw error
    }
  }

  /**
   * Fetch all SQ01 data using optimized range query (bypasses 1000 record limit)
   * Uses Rust core service when VITE_RUST_CORE_ENABLED=true
   */
  async fetchSQ01Data(): Promise<SQ01Data[]> {
    // Use Rust service when enabled
    if (RUST_CORE_ENABLED) {
      logger.log('🦀 Using Rust core service for SQ01 data')
      return rustSQ01DataService.fetchSQ01Data()
    }

    try {
      logger.log(
        '🚀 Fetching ALL SQ01 data using CONTROLLED SEQUENTIAL chunking to prevent timeouts...'
      )

      // First, get total count
      const { count, error: countError } = await supabase
        .from('rr_sq01_data')
        .select('*', { count: 'exact', head: true })

      if (countError) {
        logger.error('❌ Count query error:', countError)
        throw countError
      }

      if (!count) {
        logger.warn('⚠️ No records found in database')
        return []
      }

      logger.log(`📊 Total records to fetch: ${count}`)

      // Calculate chunks needed (1000 records per chunk)
      const chunkSize = 1000
      const totalChunks = Math.ceil(count / chunkSize)
      const allRecords: SQ01Data[] = []
      const concurrentLimit = 5 // Max 5 parallel requests to prevent timeouts
      const delayBetweenBatches = 100 // 100ms delay between batches

      logger.log(
        `🔢 Fetching ${totalChunks} chunks of ${chunkSize} records each with controlled concurrency...`
      )

      // Process chunks in batches to prevent overwhelming the database
      for (
        let batchStart = 0;
        batchStart < totalChunks;
        batchStart += concurrentLimit
      ) {
        const batchEnd = Math.min(batchStart + concurrentLimit, totalChunks)
        const batchPromises = []

        logger.log(
          `🔄 Processing batch ${Math.floor(batchStart / concurrentLimit) + 1}: chunks ${batchStart + 1}-${batchEnd}`
        )

        // Create promises for this batch
        for (let i = batchStart; i < batchEnd; i++) {
          const start = i * chunkSize
          const end = start + chunkSize - 1

          const chunkPromise = supabase
            .from('rr_sq01_data')
            .select('*')
            .order('created_at', { ascending: false })
            .range(start, end)
            .then(({ data, error }) => {
              if (error) {
                logger.error(`❌ Chunk ${i + 1} error:`, error)
                throw error
              }
              logger.log(
                `✅ Chunk ${i + 1}/${totalChunks}: Fetched ${data?.length || 0} records (${start}-${end})`
              )
              return data || []
            })

          batchPromises.push(chunkPromise)
        }

        // Wait for this batch to complete
        try {
          const batchResults = await Promise.all(batchPromises)
          batchResults.forEach((chunk) => {
            allRecords.push(...chunk)
          })

          logger.log(
            `✅ Batch complete: ${allRecords.length} records fetched so far`
          )

          // Small delay between batches to prevent overwhelming DB
          if (batchEnd < totalChunks) {
            await new Promise((resolve) =>
              setTimeout(resolve, delayBetweenBatches)
            )
          }
        } catch (batchError) {
          logger.error(
            `❌ Batch ${Math.floor(batchStart / concurrentLimit) + 1} failed:`,
            batchError
          )
          throw batchError
        }
      }

      logger.log(
        `✅ CONTROLLED CHUNKED FETCH COMPLETE: ${allRecords.length} total SQ01 records fetched`
      )
      logger.log('First record sample:', allRecords[0])
      logger.log('Data type verification:', {
        isArray: Array.isArray(allRecords),
        length: allRecords.length,
        firstRecordKeys: allRecords[0]
          ? Object.keys(allRecords[0])
          : 'no first record',
      })
      logger.log('Query completed at:', new Date().toISOString())

      return allRecords
    } catch (error) {
      logger.error('❌ Exception in controlled chunked fetch:', error)
      throw error
    }
  }

  /**
   * Insert new SQ01 data record
   */
  async insertSQ01Data(data: SQ01DataInsert): Promise<SQ01Data> {
    try {
      const { data: result, error } = await supabase
        .from('rr_sq01_data')
        .insert(data)
        .select()
        .single()

      if (error) throw error
      return result
    } catch (error) {
      logger.error('Error inserting SQ01 data:', error)
      throw error
    }
  }

  /**
   * Import data from clipboard with chunked processing for large datasets
   */
  async importFromClipboard(
    progressCallback?: ImportProgressCallback
  ): Promise<ImportResult> {
    try {
      // Phase 1: Parse clipboard data
      if (progressCallback) {
        progressCallback({
          phase: 'parsing',
          currentRow: 0,
          totalRows: 0,
          processedChunks: 0,
          totalChunks: 0,
          insertedRows: 0,
          duplicateRows: 0,
          errorRows: 0,
          errors: [],
          message: 'Parsing clipboard data...',
        })
      }

      const clipboardData = await this.parseClipboardData()

      // Phase 2: Validate headers
      if (progressCallback) {
        progressCallback({
          phase: 'validating',
          currentRow: 0,
          totalRows: clipboardData.rows.length,
          processedChunks: 0,
          totalChunks: Math.ceil(clipboardData.rows.length / 500),
          insertedRows: 0,
          duplicateRows: 0,
          errorRows: 0,
          errors: [],
          message: 'Validating column headers...',
        })
      }

      const validation = this.validateHeaders(clipboardData.headers)
      if (!validation.isValid) {
        throw new Error(
          `Missing required columns: ${validation.missingHeaders.join(', ')}`
        )
      }

      // Phase 3: Clear existing data
      if (progressCallback) {
        progressCallback({
          phase: 'clearing',
          currentRow: 0,
          totalRows: clipboardData.rows.length,
          processedChunks: 0,
          totalChunks: Math.ceil(clipboardData.rows.length / 500),
          insertedRows: 0,
          duplicateRows: 0,
          errorRows: 0,
          errors: [],
          message: 'Clearing existing data...',
        })
      }

      logger.log('Clearing existing SQ01 data before import...')
      await this.clearAllSQ01Data(false) // Don't show toast during import

      // Check if this is a large dataset
      const isLargeDataset = clipboardData.rows.length > 50000
      if (isLargeDataset && progressCallback) {
        logger.warn(`Large dataset detected: ${clipboardData.rows.length} rows`)
      }

      // Phase 4: Process data in chunks using async generator
      return await this.processLargeDatasetImport(
        clipboardData.headers,
        clipboardData.rows,
        progressCallback
      )
    } catch (error) {
      logger.error('Clipboard import error:', error)
      toast.error(
        `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      return {
        success: false,
        totalRows: 0,
        insertedRows: 0,
        duplicateRows: 0,
        errorRows: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      }
    }
  }

  /**
   * Parse clipboard data and handle duplicate column names
   */
  private async parseClipboardData(): Promise<ClipboardData> {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        throw new Error('Clipboard is empty')
      }

      const lines = text.trim().split('\n')
      if (lines.length < 2) {
        throw new Error(
          'Clipboard must contain headers and at least one data row'
        )
      }

      const rawHeaders = lines[0].split('\t').map((h) => h.trim())
      const rows = lines
        .slice(1)
        .map((line) => line.split('\t').map((cell) => cell.trim()))

      // Handle duplicate column names by adding _2, _3, etc. suffixes
      const headers = this.processDuplicateHeaders(rawHeaders)

      return { headers, rows }
    } catch (error) {
      throw new Error(
        `Failed to read clipboard: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Process duplicate headers by adding _2, _3 suffixes automatically
   */
  private processDuplicateHeaders(rawHeaders: string[]): string[] {
    const headerCounts: { [key: string]: number } = {}
    const processedHeaders: string[] = []

    rawHeaders.forEach((header) => {
      const cleanHeader = header.trim()

      if (!headerCounts[cleanHeader]) {
        // First occurrence - use original name
        headerCounts[cleanHeader] = 1
        processedHeaders.push(cleanHeader)
      } else {
        // Subsequent occurrences - add _2, _3, etc.
        headerCounts[cleanHeader]++
        const suffix = `_${headerCounts[cleanHeader]}`
        processedHeaders.push(`${cleanHeader}${suffix}`)
      }
    })

    logger.log('Original headers:', rawHeaders)
    logger.log('Processed headers:', processedHeaders)

    return processedHeaders
  }

  /**
   * Validate headers against expected columns (flexible validation)
   */
  private validateHeaders(headers: string[]): {
    isValid: boolean
    missingHeaders: string[]
  } {
    const normalizedHeaders = headers.map((h) => h.trim().toLowerCase())
    const missingHeaders = EXPECTED_SQ01_HEADERS.filter(
      (expected) =>
        !normalizedHeaders.some((header) => header === expected.toLowerCase())
    )

    // For now, we'll be more lenient - as long as we have some key columns, allow import
    const requiredHeaders = ['plnt', 'material', 'sloc']
    const criticalMissing = requiredHeaders.filter(
      (required) =>
        !normalizedHeaders.some((header) => header === required.toLowerCase())
    )

    logger.log('Headers received:', headers)
    logger.log('Missing headers:', missingHeaders)
    logger.log('Critical missing:', criticalMissing)

    return {
      isValid: criticalMissing.length === 0,
      missingHeaders: criticalMissing,
    }
  }

  /**
   * Async delay function to yield control to the browser
   */
  private delay(ms: number = 0): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Process data transformation in chunks to prevent UI blocking
   */
  private async *processDataInChunks(
    headers: string[],
    rows: string[][],
    chunkSize: number = 500,
    progressCallback?: ImportProgressCallback
  ): AsyncGenerator<SQ01DataInsert[], void, unknown> {
    const totalChunks = Math.ceil(rows.length / chunkSize)

    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize)
      const chunkIndex = Math.floor(i / chunkSize)

      // Throttle progress updates - only update every 10 chunks or significant milestones
      const shouldUpdateProgress =
        chunkIndex % 10 === 0 || i + chunk.length >= rows.length

      // Update progress (throttled to reduce flashing)
      if (progressCallback && shouldUpdateProgress) {
        progressCallback({
          phase: 'processing',
          currentRow: i + chunk.length,
          totalRows: rows.length,
          processedChunks: chunkIndex,
          totalChunks,
          insertedRows: 0,
          duplicateRows: 0,
          errorRows: 0,
          errors: [],
          message: `Processing rows ${i + 1} to ${i + chunk.length} of ${rows.length}...`,
        })
      }

      // Transform the chunk
      const transformedChunk = chunk
        .map((row) => {
          const transformedRow: SQ01DataInsert = {}

          headers.forEach((header, index) => {
            const cleanHeader = header.trim()
            const dbField = SQ01_COLUMN_MAPPING[cleanHeader]

            if (dbField && row[index] !== undefined) {
              const value = row[index].trim()

              // Handle numeric fields
              if (
                [
                  'unrestricted',
                  'blocked',
                  'in_qual_insp',
                  'confirmed_yield',
                  'ext_mov_avg_price',
                ].includes(dbField)
              ) {
                const numValue = parseFloat(value)
                if (!isNaN(numValue)) {
                  ;(transformedRow as any)[dbField] = numValue
                } else if (value) {
                  ;(transformedRow as any)[dbField] = 0
                }
              } else if (
                ['shelf_life_exp_date', 'last_gr', 'created_on'].includes(
                  dbField
                )
              ) {
                // Handle date fields
                if (value && value !== '') {
                  const dateValue = new Date(value)
                  if (!isNaN(dateValue.getTime())) {
                    ;(transformedRow as any)[dbField] = dateValue
                      .toISOString()
                      .split('T')[0]
                  }
                }
              } else {
                // Handle text fields
                ;(transformedRow as any)[dbField] = value || null
              }
            }
          })

          return transformedRow
        })
        .filter(
          (row) =>
            // Filter out completely empty rows
            row.material || row.plant || row.sloc
        )

      // Yield control to prevent UI blocking
      await this.delay(10)

      yield transformedChunk
    }
  }

  /**
   * Process large dataset import with chunked processing and progress tracking
   */
  async processLargeDatasetImport(
    headers: string[],
    rows: string[][],
    progressCallback?: ImportProgressCallback
  ): Promise<ImportResult> {
    const result: ImportResult = {
      success: false,
      totalRows: rows.length,
      insertedRows: 0,
      duplicateRows: 0,
      errorRows: 0,
      errors: [],
    }

    try {
      const chunkSize = 500 // Optimal chunk size for large datasets
      const totalChunks = Math.ceil(rows.length / chunkSize)
      let processedChunks = 0

      // Process data in chunks using async generator
      for await (const transformedChunk of this.processDataInChunks(
        headers,
        rows,
        chunkSize,
        progressCallback
      )) {
        // Throttle progress updates during insertion - only update every 5 chunks or at completion
        const shouldUpdateProgress =
          processedChunks % 5 === 0 || processedChunks === totalChunks - 1

        // Update progress for insertion phase (throttled to prevent flashing)
        if (progressCallback && shouldUpdateProgress) {
          progressCallback({
            phase: 'inserting',
            currentRow: Math.min(
              (processedChunks + 1) * chunkSize,
              rows.length
            ),
            totalRows: rows.length,
            processedChunks: processedChunks + 1,
            totalChunks,
            insertedRows: result.insertedRows,
            duplicateRows: result.duplicateRows,
            errorRows: result.errorRows,
            errors: result.errors,
            message: `Inserting chunk ${processedChunks + 1} of ${totalChunks}...`,
          })
        }

        // Insert chunk to database
        if (transformedChunk.length > 0) {
          try {
            const { error } = await supabase
              .from('rr_sq01_data')
              .insert(transformedChunk)

            if (error) {
              result.errorRows += transformedChunk.length
              result.errors.push(
                `Chunk ${processedChunks + 1}: ${error.message}`
              )
              logger.error('Chunk insert error:', error)
            } else {
              result.insertedRows += transformedChunk.length
            }
          } catch (chunkError) {
            result.errorRows += transformedChunk.length
            result.errors.push(
              `Chunk ${processedChunks + 1} failed: ${chunkError}`
            )
            logger.error('Chunk processing error:', chunkError)
          }
        }

        processedChunks++

        // Small delay to keep UI responsive
        await this.delay(10)
      }

      result.success = result.insertedRows > 0

      // Final progress update
      if (progressCallback) {
        progressCallback({
          phase: 'completed',
          currentRow: rows.length,
          totalRows: rows.length,
          processedChunks: totalChunks,
          totalChunks,
          insertedRows: result.insertedRows,
          duplicateRows: result.duplicateRows,
          errorRows: result.errorRows,
          errors: result.errors,
          message: 'Import completed successfully!',
        })
      }

      // Show summary toast
      if (result.success) {
        const message = `✅ Successfully imported ${result.insertedRows.toLocaleString()} records (table cleared and refreshed)`
        if (result.errorRows > 0) {
          toast.success(
            `${message}\n⚠️ ${result.errorRows.toLocaleString()} records had errors`
          )
        } else {
          toast.success(message)
        }
      } else {
        toast.error('Import failed - check console for details')
      }
    } catch (error) {
      logger.error('Large dataset import error:', error)
      result.errors.push(`Import failed: ${error}`)
      toast.error('Import failed - unexpected error occurred')

      if (progressCallback) {
        progressCallback({
          phase: 'completed',
          currentRow: 0,
          totalRows: rows.length,
          processedChunks: 0,
          totalChunks: Math.ceil(rows.length / 500),
          insertedRows: 0,
          duplicateRows: 0,
          errorRows: rows.length,
          errors: result.errors,
          message: 'Import failed with errors',
        })
      }
    }

    return result
  }

  /**
   * Get SQ01 data statistics using RPC function (bypasses 1000 record limit)
   * Uses Rust core service when VITE_RUST_CORE_ENABLED=true
   */
  async getStatistics(): Promise<{
    total: number
    todayCount: number
    thisWeekCount: number
    uniqueMaterials: number
    uniquePlants: number
    totalUnrestricted: number
    scannedCount?: number
    uniqueLocations?: number
    blockedScanned?: number
    qualityHoldScanned?: number
    missingSerialScanned?: number
    locationsScanned?: number
    locationsRemaining?: number
    locationsWithErrors?: number
    qtyWithErrors?: number
    totalScannedQty?: number
  }> {
    // Use Rust service when enabled
    if (RUST_CORE_ENABLED) {
      logger.log('🦀 Using Rust core service for SQ01 statistics')
      const stats = await rustSQ01DataService.getStatistics()
      return {
        total: stats.total,
        todayCount: stats.todayCount,
        thisWeekCount: 0, // Not available from Rust stats
        uniqueMaterials: stats.uniqueMaterials,
        uniquePlants: stats.uniquePlants,
        totalUnrestricted: stats.totalUnrestricted,
        scannedCount: stats.scannedRecords,
      }
    }

    try {
      logger.log('🚀 Fetching SQ01 statistics using RPC function...')

      // Use RPC function to get accurate statistics from all records
      const { data, error } = await supabase.rpc('get_sq01_statistics')

      if (error) {
        logger.error(
          'Statistics RPC error:',
          error,
          'Falling back to direct query...'
        )
        // Fallback to direct query if RPC fails
        return await this.getStatisticsFallback()
      }

      logger.log(`📊 RPC Statistics result:`, data)

      // Handle the JSON result from RPC function
      const stats = (data as any) || {
        total: 0,
        todayCount: 0,
        thisWeekCount: 0,
        uniqueMaterials: 0,
        uniquePlants: 0,
        totalUnrestricted: 0,
      }

      logger.log(`✅ SQ01 Statistics from RPC:`, {
        total: stats.total?.toLocaleString?.() || stats.total,
        todayCount: stats.todayCount,
        thisWeekCount: stats.thisWeekCount,
        uniqueMaterials: stats.uniqueMaterials,
        uniquePlants: stats.uniquePlants,
        totalUnrestricted:
          stats.totalUnrestricted?.toLocaleString?.() ||
          stats.totalUnrestricted,
        scannedCount: stats.scannedCount,
        blockedScanned: stats.blockedScanned,
        qualityHoldScanned: stats.qualityHoldScanned,
        missingSerialScanned: stats.missingSerialScanned,
      })

      return {
        total: Number(stats.total) || 0,
        todayCount: Number(stats.todayCount) || 0,
        thisWeekCount: Number(stats.thisWeekCount) || 0,
        uniqueMaterials: Number(stats.uniqueMaterials) || 0,
        uniquePlants: Number(stats.uniquePlants) || 0,
        totalUnrestricted: Number(stats.totalUnrestricted) || 0,
        scannedCount: Number(stats.scannedCount) || 0,
        uniqueLocations: Number(stats.uniqueLocations) || 0,
        blockedScanned: Number(stats.blockedScanned) || 0,
        qualityHoldScanned: Number(stats.qualityHoldScanned) || 0,
        missingSerialScanned: Number(stats.missingSerialScanned) || 0,
        locationsScanned: Number(stats.locationsScanned) || 0,
        locationsRemaining: Number(stats.locationsRemaining) || 0,
        locationsWithErrors: Number(stats.locationsWithErrors) || 0,
        qtyWithErrors: Number(stats.qtyWithErrors) || 0,
        totalScannedQty: Number(stats.totalScannedQty) || 0,
      }
    } catch (error) {
      logger.error('Error getting SQ01 statistics via RPC:', error)
      logger.log('Attempting fallback statistics...')
      return await this.getStatisticsFallback()
    }
  }

  /**
   * Fallback statistics method using direct query (may be limited)
   */
  private async getStatisticsFallback(): Promise<{
    total: number
    todayCount: number
    thisWeekCount: number
    uniqueMaterials: number
    uniquePlants: number
    totalUnrestricted: number
    scannedCount?: number
    uniqueLocations?: number
    blockedScanned?: number
    qualityHoldScanned?: number
    missingSerialScanned?: number
    locationsScanned?: number
    locationsRemaining?: number
    locationsWithErrors?: number
    qtyWithErrors?: number
    totalScannedQty?: number
  }> {
    try {
      logger.log('📋 Using fallback statistics calculation...')

      const { data, error } = await supabase.from('rr_sq01_data').select('*')

      if (error) throw error

      logger.log(
        `⚠️ Fallback statistics from ${data?.length || 0} records (may be limited)`
      )

      const now = new Date()
      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      )
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

      const total = data?.length || 0
      const todayCount =
        data?.filter(
          (item) => item.created_at && new Date(item.created_at) >= todayStart
        ).length || 0

      const thisWeekCount =
        data?.filter(
          (item) => item.created_at && new Date(item.created_at) >= weekStart
        ).length || 0

      const uniqueMaterials = new Set(
        data?.map((item) => item.material).filter(Boolean)
      ).size

      const uniquePlants = new Set(
        data?.map((item) => item.plant).filter(Boolean)
      ).size

      const totalUnrestricted =
        data?.reduce((sum, item) => sum + (item.unrestricted || 0), 0) || 0

      // GRS-specific statistics
      // Count only items with GRS Scan Status of 'Scanned'
      const scannedCount =
        data?.filter((item) => item.grs_scan_status === 'Scanned').length || 0

      const uniqueLocations = new Set(
        data?.map((item) => item.conf_cert_ref).filter(Boolean)
      ).size

      // Error tracking statistics for scanned items
      const blockedScanned =
        data?.filter(
          (item) =>
            item.grs_scan_status === 'Scanned' && (item.blocked || 0) > 0
        ).length || 0

      const qualityHoldScanned =
        data?.filter(
          (item) =>
            item.grs_scan_status === 'Scanned' && (item.in_qual_insp || 0) > 0
        ).length || 0

      const missingSerialScanned =
        data?.filter(
          (item) =>
            item.grs_scan_status === 'Scanned' &&
            (!item.serial_number || item.serial_number === '')
        ).length || 0

      // Inventory metrics for location and quantity tracking
      const scannedLocations = new Set(
        data
          ?.filter((item) => item.grs_scan_status === 'Scanned')
          .map((item) => item.conf_cert_ref)
          .filter(Boolean)
      )
      const locationsScanned = scannedLocations.size

      const unscannedLocations = new Set(
        data
          ?.filter(
            (item) =>
              !item.grs_scan_status || item.grs_scan_status !== 'Scanned'
          )
          .map((item) => item.conf_cert_ref)
          .filter(Boolean)
      )
      const locationsRemaining = unscannedLocations.size

      const locationsWithErrorsSet = new Set(
        data
          ?.filter(
            (item) =>
              item.grs_scan_status === 'Scanned' &&
              ((item.blocked || 0) > 0 ||
                (item.in_qual_insp || 0) > 0 ||
                !item.serial_number ||
                item.serial_number === '')
          )
          .map((item) => item.conf_cert_ref)
          .filter(Boolean)
      )
      const locationsWithErrors = locationsWithErrorsSet.size

      const qtyWithErrors =
        data
          ?.filter(
            (item) =>
              item.grs_scan_status === 'Scanned' &&
              ((item.blocked || 0) > 0 ||
                (item.in_qual_insp || 0) > 0 ||
                !item.serial_number ||
                item.serial_number === '')
          )
          .reduce(
            (sum, item) =>
              sum +
              (item.unrestricted || 0) +
              (item.blocked || 0) +
              (item.in_qual_insp || 0),
            0
          ) || 0

      const totalScannedQty =
        data
          ?.filter((item) => item.grs_scan_status === 'Scanned')
          .reduce(
            (sum, item) =>
              sum +
              (item.unrestricted || 0) +
              (item.blocked || 0) +
              (item.in_qual_insp || 0),
            0
          ) || 0

      return {
        total,
        todayCount,
        thisWeekCount,
        uniqueMaterials,
        uniquePlants,
        totalUnrestricted,
        scannedCount,
        uniqueLocations,
        blockedScanned,
        qualityHoldScanned,
        missingSerialScanned,
        locationsScanned,
        locationsRemaining,
        locationsWithErrors,
        qtyWithErrors,
        totalScannedQty,
      }
    } catch (error) {
      logger.error('Fallback statistics also failed:', error)
      throw error
    }
  }

  /**
   * Delete SQ01 data record
   */
  async deleteSQ01Data(id: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('rr_sq01_data')
        .delete()
        .eq('id', id)

      if (error) throw error
    } catch (error) {
      logger.error('Error deleting SQ01 data:', error)
      throw error
    }
  }

  /**
   * Clear all SQ01 data
   */
  async clearAllSQ01Data(showToast: boolean = true): Promise<void> {
    try {
      const { error } = await supabase
        .from('rr_sq01_data')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all records

      if (error) throw error

      if (showToast) {
        toast.success('All SQ01 data cleared successfully')
      }
    } catch (error) {
      logger.error('Error clearing SQ01 data:', error)
      if (showToast) {
        toast.error('Failed to clear SQ01 data')
      }
      throw error
    }
  }
}
// Developer and Creator: Jai Singh
