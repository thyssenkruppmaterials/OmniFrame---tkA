// Created and developed by Jai Singh
import { toast } from 'sonner'
import { RUST_CORE_ENABLED } from '@/lib/rust-core/config'
import { rustMaterialMasterDataService } from '@/lib/rust-core/material-master-data.service'
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'
import type { Tables, TablesInsert } from './database.types'

// Type definitions for Material Master Data using database types
export type MaterialMasterData = Tables<'rr_mlgt_data'>
export type MaterialMasterDataInsert = TablesInsert<'rr_mlgt_data'>

export interface ClipboardData {
  headers: string[]
  rows: string[][]
}

export interface ImportResult {
  success: boolean
  totalRows: number
  insertedRows: number
  updatedRows: number
  skippedRows: number
  errorRows: number
  errors: string[]
}

export interface ImportProgress {
  phase: 'parsing' | 'validating' | 'processing' | 'upserting' | 'completed'
  currentRow: number
  totalRows: number
  processedChunks: number
  totalChunks: number
  insertedRows: number
  updatedRows: number
  skippedRows: number
  errorRows: number
  errors: string[]
  message: string
}

export type ImportProgressCallback = (progress: ImportProgress) => void

export interface ColumnMapping {
  [key: string]: string
}

// Expected column headers for Material Master Data validation
export const EXPECTED_MATERIAL_MASTER_HEADERS = [
  'Material',
  'Warehouse Number',
  'Storage Type',
  'Storage Bin',
]

// Column mapping from Excel headers to database fields
export const MATERIAL_MASTER_COLUMN_MAPPING: ColumnMapping = {
  Material: 'material',
  'Warehouse Number': 'warehouse_number',
  'Storage Type': 'storage_type',
  'Storage Bin': 'storage_bin',
  Length: 'length',
  Width: 'width',
  Height: 'height',
  Weight: 'weight',
  'Min Quantity': 'min_quantity',
  'Max Quantity': 'max_quantity',
  'CRL Status': 'crl_status',
}

export class MaterialMasterDataService {
  private static instance: MaterialMasterDataService

  public static getInstance(): MaterialMasterDataService {
    if (!MaterialMasterDataService.instance) {
      MaterialMasterDataService.instance = new MaterialMasterDataService()
    }
    return MaterialMasterDataService.instance
  }

  /**
   * Check if using Rust service
   */
  isUsingRust(): boolean {
    return RUST_CORE_ENABLED && rustMaterialMasterDataService.isUsingRust()
  }

  /**
   * Fetch all Material Master Data using optimized range query (bypasses 1000 record limit)
   * Uses Rust core service when VITE_RUST_CORE_ENABLED=true
   */
  async fetchMaterialMasterData(): Promise<MaterialMasterData[]> {
    // Use Rust service when enabled
    if (RUST_CORE_ENABLED) {
      logger.log('🦀 Using Rust core service for Material Master data')
      return rustMaterialMasterDataService.fetchMaterialMasterData()
    }

    try {
      logger.log(
        '🚀 Fetching ALL Material Master Data using CONTROLLED SEQUENTIAL chunking to prevent timeouts...'
      )

      // First, get total count
      const { count, error: countError } = await supabase
        .from('rr_mlgt_data')
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
      const allRecords: MaterialMasterData[] = []
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
            .from('rr_mlgt_data')
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
        `✅ CONTROLLED CHUNKED FETCH COMPLETE: ${allRecords.length} total Material Master records fetched`
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
   * Insert new Material Master Data record
   */
  async insertMaterialMasterData(
    data: MaterialMasterDataInsert
  ): Promise<MaterialMasterData> {
    try {
      const { data: result, error } = await supabase
        .from('rr_mlgt_data')
        .insert(data)
        .select()
        .single()

      if (error) throw error
      return result
    } catch (error) {
      logger.error('Error inserting Material Master data:', error)
      throw error
    }
  }

  /**
   * Import data from clipboard with UPSERT logic for large datasets
   * This method checks for existing records and updates them, or inserts new ones
   * Does NOT delete existing data like LX03 import does
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
          updatedRows: 0,
          skippedRows: 0,
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
          updatedRows: 0,
          skippedRows: 0,
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

      // Check if this is a large dataset
      const isLargeDataset = clipboardData.rows.length > 50000
      if (isLargeDataset && progressCallback) {
        logger.warn(`Large dataset detected: ${clipboardData.rows.length} rows`)
      }

      // Phase 3: Process data with UPSERT logic using async generator
      return await this.processLargeDatasetUpsert(
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
        updatedRows: 0,
        skippedRows: 0,
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
    const missingHeaders = EXPECTED_MATERIAL_MASTER_HEADERS.filter(
      (expected) =>
        !normalizedHeaders.some((header) => header === expected.toLowerCase())
    )

    // All 4 basic columns are required for Material Master Data
    const requiredHeaders = [
      'material',
      'warehouse number',
      'storage type',
      'storage bin',
    ]
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
  ): AsyncGenerator<MaterialMasterDataInsert[], void, unknown> {
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
          updatedRows: 0,
          skippedRows: 0,
          errorRows: 0,
          errors: [],
          message: `Processing rows ${i + 1} to ${i + chunk.length} of ${rows.length}...`,
        })
      }

      // Transform the chunk
      const transformedChunk = chunk
        .map((row) => {
          const transformedRow: MaterialMasterDataInsert = {}

          headers.forEach((header, index) => {
            const cleanHeader = header.trim()
            const dbField = MATERIAL_MASTER_COLUMN_MAPPING[cleanHeader]

            if (dbField && row[index] !== undefined) {
              const value = row[index].trim()

              // Handle numeric fields
              if (
                [
                  'length',
                  'width',
                  'height',
                  'weight',
                  'min_quantity',
                  'max_quantity',
                ].includes(dbField)
              ) {
                const numValue = parseFloat(value)
                if (!isNaN(numValue)) {
                  ;(transformedRow as any)[dbField] = numValue
                } else if (value) {
                  // Keep null for empty numeric fields
                  ;(transformedRow as any)[dbField] = null
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
            // Filter out rows missing required fields
            row.material &&
            row.warehouse_number &&
            row.storage_type &&
            row.storage_bin
        )

      // Yield control to prevent UI blocking
      await this.delay(10)

      yield transformedChunk
    }
  }

  /**
   * Process large dataset import with UPSERT logic - checks existing records and updates/inserts accordingly
   */
  async processLargeDatasetUpsert(
    headers: string[],
    rows: string[][],
    progressCallback?: ImportProgressCallback
  ): Promise<ImportResult> {
    const result: ImportResult = {
      success: false,
      totalRows: rows.length,
      insertedRows: 0,
      updatedRows: 0,
      skippedRows: 0,
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
        // Throttle progress updates during upsert - only update every 5 chunks or at completion
        const shouldUpdateProgress =
          processedChunks % 5 === 0 || processedChunks === totalChunks - 1

        // Update progress for upsert phase (throttled to prevent flashing)
        if (progressCallback && shouldUpdateProgress) {
          progressCallback({
            phase: 'upserting',
            currentRow: Math.min(
              (processedChunks + 1) * chunkSize,
              rows.length
            ),
            totalRows: rows.length,
            processedChunks: processedChunks + 1,
            totalChunks,
            insertedRows: result.insertedRows,
            updatedRows: result.updatedRows,
            skippedRows: result.skippedRows,
            errorRows: result.errorRows,
            errors: result.errors,
            message: `Upserting chunk ${processedChunks + 1} of ${totalChunks}...`,
          })
        }

        // Process each record in the chunk for upsert
        if (transformedChunk.length > 0) {
          try {
            // Use PostgreSQL UPSERT (ON CONFLICT DO UPDATE) for efficient handling
            const { error } = await supabase
              .from('rr_mlgt_data')
              .upsert(transformedChunk, {
                onConflict:
                  'material,warehouse_number,storage_type,storage_bin',
              })

            if (error) {
              result.errorRows += transformedChunk.length
              result.errors.push(
                `Chunk ${processedChunks + 1}: ${error.message}`
              )
              logger.error('Chunk upsert error:', error)
            } else {
              // For now, we'll count all as insertedRows since upsert doesn't return info about updates vs inserts
              // In a more sophisticated implementation, we'd check existing records first
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
          updatedRows: result.updatedRows,
          skippedRows: result.skippedRows,
          errorRows: result.errorRows,
          errors: result.errors,
          message: 'Import completed successfully!',
        })
      }

      // Show summary toast
      if (result.success) {
        const message = `✅ Successfully processed ${result.insertedRows.toLocaleString()} records (upserted - new and updated records)`
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
      logger.error('Large dataset upsert error:', error)
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
          updatedRows: 0,
          skippedRows: 0,
          errorRows: rows.length,
          errors: result.errors,
          message: 'Import failed with errors',
        })
      }
    }

    return result
  }

  /**
   * Get Material Master Data statistics using RPC function (bypasses 1000 record limit)
   * Uses Rust core service when VITE_RUST_CORE_ENABLED=true
   */
  async getStatistics(): Promise<{
    total: number
    todayCount: number
    thisWeekCount: number
    uniqueMaterials: number
    uniqueWarehouses: number
    uniqueStorageTypes: number
    uniqueStorageBins: number
    recordsWithCrlStatus: number
    recordsWithDimensions: number
    recordsWithQuantities: number
  }> {
    // Use Rust service when enabled
    if (RUST_CORE_ENABLED) {
      logger.log('🦀 Using Rust core service for Material Master statistics')
      const stats = await rustMaterialMasterDataService.getStatistics()
      return {
        total: stats.total,
        todayCount: stats.todayCount,
        thisWeekCount: 0, // Not available from Rust stats
        uniqueMaterials: stats.uniqueMaterials,
        uniqueWarehouses: stats.uniqueWarehouses,
        uniqueStorageTypes: stats.uniqueStorageTypes,
        uniqueStorageBins: 0, // Not available from Rust stats
        recordsWithCrlStatus: 0, // Not available from Rust stats
        recordsWithDimensions: stats.recordsWithDimensions,
        recordsWithQuantities: stats.recordsWithQuantityLimits,
      }
    }

    try {
      logger.log('🚀 Fetching Material Master statistics using RPC function...')

      // Use RPC function to get accurate statistics from all records
      const { data, error } = await supabase.rpc(
        'get_material_master_statistics'
      )

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
        uniqueWarehouses: 0,
        uniqueStorageTypes: 0,
        uniqueStorageBins: 0,
        recordsWithCrlStatus: 0,
        recordsWithDimensions: 0,
        recordsWithQuantities: 0,
      }

      logger.log(`✅ Material Master Statistics from RPC:`, {
        total: stats.total?.toLocaleString?.() || stats.total,
        todayCount: stats.todayCount,
        thisWeekCount: stats.thisWeekCount,
        uniqueMaterials: stats.uniqueMaterials,
        uniqueWarehouses: stats.uniqueWarehouses,
        uniqueStorageTypes: stats.uniqueStorageTypes,
        uniqueStorageBins: stats.uniqueStorageBins,
        recordsWithCrlStatus: stats.recordsWithCrlStatus,
        recordsWithDimensions: stats.recordsWithDimensions,
        recordsWithQuantities: stats.recordsWithQuantities,
      })

      return {
        total: Number(stats.total) || 0,
        todayCount: Number(stats.todayCount) || 0,
        thisWeekCount: Number(stats.thisWeekCount) || 0,
        uniqueMaterials: Number(stats.uniqueMaterials) || 0,
        uniqueWarehouses: Number(stats.uniqueWarehouses) || 0,
        uniqueStorageTypes: Number(stats.uniqueStorageTypes) || 0,
        uniqueStorageBins: Number(stats.uniqueStorageBins) || 0,
        recordsWithCrlStatus: Number(stats.recordsWithCrlStatus) || 0,
        recordsWithDimensions: Number(stats.recordsWithDimensions) || 0,
        recordsWithQuantities: Number(stats.recordsWithQuantities) || 0,
      }
    } catch (error) {
      logger.error('Error getting Material Master statistics via RPC:', error)
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
    uniqueWarehouses: number
    uniqueStorageTypes: number
    uniqueStorageBins: number
    recordsWithCrlStatus: number
    recordsWithDimensions: number
    recordsWithQuantities: number
  }> {
    try {
      logger.log('📋 Using fallback statistics calculation...')

      const { data, error } = await supabase.from('rr_mlgt_data').select('*')

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

      const uniqueWarehouses = new Set(
        data?.map((item) => item.warehouse_number).filter(Boolean)
      ).size

      const uniqueStorageTypes = new Set(
        data?.map((item) => item.storage_type).filter(Boolean)
      ).size

      const uniqueStorageBins = new Set(
        data?.map((item) => item.storage_bin).filter(Boolean)
      ).size

      const recordsWithCrlStatus =
        data?.filter((item) => item.crl_status).length || 0
      const recordsWithDimensions =
        data?.filter((item) => item.length && item.width && item.height)
          .length || 0
      const recordsWithQuantities =
        data?.filter((item) => item.min_quantity && item.max_quantity).length ||
        0

      return {
        total,
        todayCount,
        thisWeekCount,
        uniqueMaterials,
        uniqueWarehouses,
        uniqueStorageTypes,
        uniqueStorageBins,
        recordsWithCrlStatus,
        recordsWithDimensions,
        recordsWithQuantities,
      }
    } catch (error) {
      logger.error('Fallback statistics also failed:', error)
      throw error
    }
  }

  /**
   * Delete Material Master Data record
   */
  async deleteMaterialMasterData(id: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('rr_mlgt_data')
        .delete()
        .eq('id', id)

      if (error) throw error
    } catch (error) {
      logger.error('Error deleting Material Master data:', error)
      throw error
    }
  }

  /**
   * Query home bin locations for specific part numbers and warehouse
   * Used by MCA processing workflow to show home bin locations
   */
  async getHomeBinLocations(
    partNumbers: string[],
    warehouse: string | null
  ): Promise<
    Array<{
      material: string
      warehouse_number: string
      storage_type: string
      storage_bin: string
    }>
  > {
    try {
      if (!partNumbers.length || !warehouse) {
        logger.warn(
          '❌ Cannot query home bin locations: missing part numbers or warehouse'
        )
        return []
      }

      logger.log(
        `🏠 Querying home bin locations for parts: ${partNumbers.join(', ')} in warehouse: ${warehouse}`
      )

      const { data, error } = await supabase
        .from('rr_mlgt_data')
        .select('material, warehouse_number, storage_type, storage_bin')
        .in('material', partNumbers)
        .eq('warehouse_number', warehouse)
        .order('material')

      if (error) {
        logger.error('❌ Home bin location query error:', error)
        throw error
      }

      logger.log(
        `✅ Found ${data?.length || 0} home bin location records:`,
        data
      )

      return (data || []).filter(
        (item) =>
          item.material &&
          item.warehouse_number &&
          item.storage_type &&
          item.storage_bin
      ) as Array<{
        material: string
        warehouse_number: string
        storage_type: string
        storage_bin: string
      }>
    } catch (error) {
      logger.error('❌ Error querying home bin locations:', error)
      throw error
    }
  }

  /**
   * Clear all Material Master Data (used sparingly)
   */
  async clearAllMaterialMasterData(showToast: boolean = true): Promise<void> {
    try {
      const { error } = await supabase
        .from('rr_mlgt_data')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all records

      if (error) throw error

      if (showToast) {
        toast.success('All Material Master data cleared successfully')
      }
    } catch (error) {
      logger.error('Error clearing Material Master data:', error)
      if (showToast) {
        toast.error('Failed to clear Material Master data')
      }
      throw error
    }
  }
}

// Created and developed by Jai Singh
