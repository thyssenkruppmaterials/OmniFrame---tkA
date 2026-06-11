// Created and developed by Jai Singh
import { toast } from 'sonner'
import { RUST_CORE_ENABLED } from '@/lib/rust-core/config'
import { rustLX03DataService } from '@/lib/rust-core/lx03-data.service'
import { logger } from '@/lib/utils/logger'
import { supabase, supabaseRead } from './client'
import type { TablesInsert } from './database.types'

export interface LX03Data {
  id: string
  organization_id: string
  storage_type: string | null
  plant: string | null
  storage_bin: string
  storage_location: string | null
  material: string
  stock_category: string | null
  special_stock: string | null
  storage_type_2: string | null
  total_stock: number
  available_stock: number
  stock_for_putaway: number | null
  pick_quantity: number | null
  last_movement: string | null
  last_movement_2: string | null
  last_inventory: string | null
  special_stock_number: string | null
  batch: string | null
  inventory_active: string | null
  stock_removal_block: string | null
  putaway_block: string | null
  delivery: string | null
  inventory_record: string | null
  inventory_record_2: string | null
  warehouse: string | null
  created_at: string | null
  updated_at: string | null
}

export type LX03DataInsert = TablesInsert<'rr_lx03_data'>

export interface AggregatedLX03Data {
  storage_bin: string
  material: string
  total_stock: number
  storage_location: string | null
  warehouse: string | null // Now matches database column
  storage_type?: string | null // Added for storage type filtering
  storage_area?: string | null // Added for storage area categorization (Racks/Shelves/Kardex)
  record_count: number // Number of records aggregated
}

export interface ClipboardData {
  headers: string[]
  rows: string[][]
}

// Import-related interfaces for compatibility with existing code
export interface ImportProgress {
  phase:
    | 'parsing'
    | 'validating'
    | 'clearing'
    | 'processing'
    | 'inserting'
    | 'completed'
  processed: number
  total: number
  errors: string[]
  successful: number
  currentRow?: number
  totalRows?: number
  processedChunks?: number
  totalChunks?: number
  insertedRows?: number
  duplicateRows?: number
  errorRows?: number
  message?: string
}

export interface ImportResult {
  success: boolean
  totalRows: number
  insertedRows: number
  duplicateRows: number
  errorRows: number
  imported: number
  errors: string[]
  message: string
}

export type ImportProgressCallback = (progress: ImportProgress) => void

export interface ColumnMapping {
  [key: string]: string
}

// Expected column headers for LX03 data validation (supports both SAP short codes and full English names)
export const EXPECTED_LX03_HEADERS = [
  // SAP Short Codes Format
  'STyp',
  'Plnt',
  'Storage Bin',
  'SLoc',
  'Material',
  'S',
  'SpSt',
  'Styp',
  'Total stck',
  'Available',
  'StPut',
  'PkQty',
  'LMov',
  'LMov.',
  'LInv',
  'SpSt no.',
  'Batch',
  'Inv.act.',
  'SRB',
  'PB',
  'Delivery',
  'InvRc',
  'InvRc.',
  'Warehouse',
  // Full English Names Format (also supported)
  'Storage Type',
  'Plant',
  'Storage Location',
  'Stock Category',
  'Special Stock',
  'Total Stock',
  'Available Stock',
  'Stock for putaway',
  'Pick quantity',
  'Last movement',
  'Last inventory',
  'Special Stock Number',
  'Inventory active',
  'Stock Removal Block',
  'Putaway block',
  'Inventory record',
]

// Column mapping from Excel headers to database fields (supports both formats)
export const LX03_COLUMN_MAPPING: ColumnMapping = {
  // SAP Short Code Format
  STyp: 'storage_type',
  Plnt: 'plant',
  'Storage Bin': 'storage_bin',
  SLoc: 'storage_location',
  Material: 'material',
  S: 'stock_category',
  SpSt: 'special_stock',
  Styp: 'storage_type_2',
  'Total stck': 'total_stock',
  Available: 'available_stock',
  StPut: 'stock_for_putaway',
  PkQty: 'pick_quantity',
  LMov: 'last_movement',
  'LMov.': 'last_movement_2',
  LInv: 'last_inventory',
  'SpSt no.': 'special_stock_number',
  Batch: 'batch',
  'Inv.act.': 'inventory_active',
  SRB: 'stock_removal_block',
  PB: 'putaway_block',
  Delivery: 'delivery',
  InvRc: 'inventory_record',
  'InvRc.': 'inventory_record_2',
  Warehouse: 'warehouse',
  // Full English Names Format (alternate mapping)
  'Storage Type': 'storage_type',
  Plant: 'plant',
  'Storage Location': 'storage_location',
  'Stock Category': 'stock_category',
  'Special Stock': 'special_stock',
  'Total Stock': 'total_stock',
  'Available Stock': 'available_stock',
  'Stock for putaway': 'stock_for_putaway',
  'Pick quantity': 'pick_quantity',
  'Last movement': 'last_movement',
  'Last inventory': 'last_inventory',
  'Special Stock Number': 'special_stock_number',
  'Inventory active': 'inventory_active',
  'Stock Removal Block': 'stock_removal_block',
  'Putaway block': 'putaway_block',
  'Inventory record': 'inventory_record',
}

export class LX03DataService {
  private static instance: LX03DataService

  /**
   * Get singleton instance (for compatibility with existing code)
   */
  static getInstance(): LX03DataService {
    if (!LX03DataService.instance) {
      LX03DataService.instance = new LX03DataService()
    }
    return LX03DataService.instance
  }

  /**
   * Check if using Rust service
   */
  isUsingRust(): boolean {
    return RUST_CORE_ENABLED && rustLX03DataService.isUsingRust()
  }

  /**
   * Get aggregated inventory data by storage bins
   * Groups by storage_bin and material, sums total_stock
   */
  static async getInventoryByLocations(
    storageBins: string[]
  ): Promise<{ data: AggregatedLX03Data[]; error: Error | null }> {
    try {
      // Read replica safe — pure aggregation RPC, no writes.
      const { data, error } = await (supabaseRead.rpc as any)(
        'get_lx03_inventory_by_locations',
        {
          location_bins: storageBins,
        }
      )

      if (error) throw error

      return { data: (data || []) as AggregatedLX03Data[], error: null }
    } catch (error) {
      logger.error('Error fetching LX03 inventory by locations:', error)
      return { data: [], error: error as Error }
    }
  }

  /**
   * Get aggregated inventory data by storage bin range
   * Groups by storage_bin and material, sums total_stock
   */
  static async getInventoryByRange(
    startBin: string,
    endBin: string
  ): Promise<{ data: AggregatedLX03Data[]; error: Error | null }> {
    try {
      const { data, error } = await (supabaseRead.rpc as any)(
        'get_lx03_inventory_by_range',
        {
          start_bin: startBin,
          end_bin: endBin,
        }
      )

      if (error) throw error

      return { data: (data || []) as AggregatedLX03Data[], error: null }
    } catch (error) {
      logger.error('Error fetching LX03 inventory by range:', error)
      return { data: [], error: error as Error }
    }
  }

  /**
   * Get aggregated inventory data by part numbers
   * Groups by storage_bin and material, sums total_stock
   */
  static async getInventoryByPartNumbers(
    partNumbers: string[]
  ): Promise<{ data: AggregatedLX03Data[]; error: Error | null }> {
    try {
      const { data, error } = await (supabaseRead.rpc as any)(
        'get_lx03_inventory_by_parts',
        {
          part_numbers: partNumbers,
        }
      )

      if (error) throw error

      return { data: (data || []) as AggregatedLX03Data[], error: null }
    } catch (error) {
      logger.error('Error fetching LX03 inventory by part numbers:', error)
      return { data: [], error: error as Error }
    }
  }

  /**
   * Search for storage bins (autocomplete)
   */
  static async searchStorageBins(
    query: string,
    limit: number = 50
  ): Promise<string[]> {
    try {
      const { data, error } = await supabaseRead
        .from('rr_lx03_data')
        .select('storage_bin')
        .ilike('storage_bin', `%${query}%`)
        .not('material', 'eq', '<<empty>>')
        .order('storage_bin')
        .limit(limit)

      if (error) throw error

      // Get unique storage bins
      const uniqueBins = [
        ...new Set(data?.map((item) => item.storage_bin) || []),
      ]
      return uniqueBins.filter((bin): bin is string => Boolean(bin))
    } catch (error) {
      logger.error('Error searching storage bins:', error)
      return []
    }
  }

  /**
   * Search for part numbers (autocomplete)
   */
  static async searchPartNumbers(
    query: string,
    limit: number = 50
  ): Promise<string[]> {
    try {
      const { data, error } = await supabaseRead
        .from('rr_lx03_data')
        .select('material')
        .ilike('material', `%${query}%`)
        .not('material', 'eq', '<<empty>>')
        .order('material')
        .limit(limit)

      if (error) throw error

      // Get unique materials
      const uniqueMaterials = [
        ...new Set(data?.map((item) => item.material) || []),
      ]
      return uniqueMaterials.filter((material): material is string =>
        Boolean(material)
      )
    } catch (error) {
      logger.error('Error searching part numbers:', error)
      return []
    }
  }

  /**
   * Get list of unique warehouses (for dropdown selection)
   */
  static async getWarehouses(): Promise<string[]> {
    try {
      const { data, error } = await (supabaseRead.rpc as any)(
        'get_lx03_warehouses'
      )

      if (error) throw error

      return (data || []).map((item: any) => item.warehouse).filter(Boolean)
    } catch (error) {
      logger.error('Error fetching warehouses:', error)
      return []
    }
  }

  /**
   * Get list of unique storage types (for dropdown selection)
   */
  static async getStorageTypes(): Promise<string[]> {
    try {
      const { data, error } = await (supabaseRead.rpc as any)(
        'get_lx03_storage_types'
      )

      if (error) throw error

      return (data || []).map((item: any) => item.storage_type).filter(Boolean)
    } catch (error) {
      logger.error('Error fetching storage types:', error)
      return []
    }
  }

  /**
   * Get empty bins filtered by warehouse, storage type, and storage area
   * Storage areas: 'Racks', 'Shelves', 'Kardex', 'Other'
   */
  static async getEmptyBinsByFilters(
    warehouse: string | null = null,
    storageType: string | null = null,
    storageArea: string | null = null
  ): Promise<{ data: AggregatedLX03Data[]; error: Error | null }> {
    try {
      const { data, error } = await (supabaseRead.rpc as any)(
        'get_lx03_empty_bins_by_filters',
        {
          filter_warehouse: warehouse,
          filter_storage_type: storageType,
          filter_storage_area: storageArea,
        }
      )

      if (error) throw error

      return { data: (data || []) as AggregatedLX03Data[], error: null }
    } catch (error) {
      logger.error('Error fetching empty bins:', error)
      return { data: [], error: error as Error }
    }
  }

  /**
   * Get all unique storage bins (for range selection)
   */
  static async getAllStorageBins(): Promise<string[]> {
    try {
      const { data, error } = await supabaseRead
        .from('rr_lx03_data')
        .select('storage_bin')
        .not('material', 'eq', '<<empty>>')
        .order('storage_bin')

      if (error) throw error

      // Get unique storage bins
      const uniqueBins = [
        ...new Set(data?.map((item) => item.storage_bin) || []),
      ]
      return uniqueBins.filter((bin): bin is string => Boolean(bin)).sort()
    } catch (error) {
      logger.error('Error fetching all storage bins:', error)
      return []
    }
  }

  /**
   * Fetch LX03 data - limited to last 1000 records for table display
   * Search queries will query the entire database
   * Uses Rust core service when VITE_RUST_CORE_ENABLED=true
   */
  async fetchLX03Data(searchQuery?: string): Promise<LX03Data[]> {
    // Use Rust service when enabled
    if (RUST_CORE_ENABLED) {
      logger.log('🦀 Using Rust core service for LX03 data')
      return rustLX03DataService.fetchLX03Data(searchQuery)
    }

    try {
      let query = supabaseRead.from('rr_lx03_data').select('*')

      // If there's a search query, search across all columns in entire database
      if (searchQuery && searchQuery.trim()) {
        const searchTerm = searchQuery.trim().toLowerCase()
        query = query.or(
          `storage_bin.ilike.%${searchTerm}%,material.ilike.%${searchTerm}%,storage_location.ilike.%${searchTerm}%,plant.ilike.%${searchTerm}%,delivery.ilike.%${searchTerm}%,batch.ilike.%${searchTerm}%,stock_category.ilike.%${searchTerm}%`
        )
      }

      // Order by created_at descending and limit to 1000 for performance
      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(1000)

      if (error) throw error

      logger.log(
        `📊 LX03 Service: Fetched ${data?.length || 0} records ${searchQuery ? `(searched: "${searchQuery}")` : '(last 1000)'}`
      )
      return (data || []) as LX03Data[]
    } catch (error) {
      logger.error('Error fetching LX03 data:', error)
      return []
    }
  }

  /**
   * Get statistics using RPC function (queries entire database)
   * Uses Rust core service when VITE_RUST_CORE_ENABLED=true
   */
  async getStatistics(): Promise<{
    total: number
    todayCount: number
    uniqueMaterials: number
    uniqueLocations: number
    uniquePlants: number
    totalStock: number
    totalAvailableStock: number
    recordsWithStock: number
    emptyLocations: number
  }> {
    // Use Rust service when enabled
    if (RUST_CORE_ENABLED) {
      logger.log('🦀 Using Rust core service for LX03 statistics')
      return rustLX03DataService.getStatistics()
    }

    try {
      logger.log('📈 LX03 Service: Fetching statistics via RPC...')

      // Use RPC function to get accurate statistics from ALL records
      const { data, error } = await (supabaseRead.rpc as any)(
        'get_lx03_statistics'
      )

      if (error) {
        logger.error('❌ Statistics RPC error:', error)
        throw error
      }

      logger.log('✅ LX03 Statistics from RPC:', data)

      // Handle the JSON result from RPC function
      const stats = (data as any) || {}

      return {
        total: Number(stats.total) || 0,
        todayCount: Number(stats.todayCount) || 0,
        uniqueMaterials: Number(stats.uniqueMaterials) || 0,
        uniqueLocations: Number(stats.uniqueLocations) || 0,
        uniquePlants: Number(stats.uniquePlants) || 0,
        totalStock: Number(stats.totalStock) || 0,
        totalAvailableStock: Number(stats.totalAvailableStock) || 0,
        recordsWithStock: Number(stats.recordsWithStock) || 0,
        emptyLocations: Number(stats.emptyLocations) || 0,
      }
    } catch (error) {
      logger.error('❌ Error getting LX03 statistics:', error)
      // Return zeros on error rather than null
      return {
        total: 0,
        todayCount: 0,
        uniqueMaterials: 0,
        uniqueLocations: 0,
        uniquePlants: 0,
        totalStock: 0,
        totalAvailableStock: 0,
        recordsWithStock: 0,
        emptyLocations: 0,
      }
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
          processed: 0,
          total: 0,
          successful: 0,
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
          processed: 0,
          total: clipboardData.rows.length,
          successful: 0,
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
          `Missing required columns: ${validation.missingHeaders.join(', ')}. Please ensure your LX03 export includes the Warehouse column.`
        )
      }

      // Phase 3: Clear existing data
      if (progressCallback) {
        progressCallback({
          phase: 'clearing',
          processed: 0,
          total: clipboardData.rows.length,
          successful: 0,
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

      logger.log('Clearing existing LX03 data before import...')
      await this.clearAllLX03Data(false) // Don't show toast during import

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
        imported: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        message: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
   * Validate headers against expected columns (flexible validation - supports both SAP codes and English names)
   */
  private validateHeaders(headers: string[]): {
    isValid: boolean
    missingHeaders: string[]
  } {
    const normalizedHeaders = headers.map((h) => h.trim().toLowerCase())

    // Required headers can be in either format (SAP short codes OR English names)
    const requiredHeaderOptions = [
      ['storage bin'], // Always required
      ['material'], // Always required
      ['plnt', 'plant'], // Either SAP code OR English name
      ['warehouse'], // Warehouse is required (new field)
    ]

    const criticalMissing: string[] = []

    for (const options of requiredHeaderOptions) {
      const hasAnyOption = options.some((option) =>
        normalizedHeaders.some((header) => header === option.toLowerCase())
      )

      if (!hasAnyOption) {
        criticalMissing.push(options.join(' or '))
      }
    }

    logger.log('Headers received:', headers)
    logger.log('Normalized headers:', normalizedHeaders)
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
    chunkSize: number = 100,
    progressCallback?: ImportProgressCallback
  ): AsyncGenerator<LX03DataInsert[], void, unknown> {
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
          processed: i + chunk.length,
          total: rows.length,
          successful: 0,
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
          const transformedRow: LX03DataInsert = {}

          headers.forEach((header, index) => {
            const cleanHeader = header.trim()
            const dbField = LX03_COLUMN_MAPPING[cleanHeader]

            if (dbField && row[index] !== undefined) {
              const value = row[index].trim()

              // Handle numeric fields
              if (
                [
                  'total_stock',
                  'available_stock',
                  'stock_for_putaway',
                  'pick_quantity',
                ].includes(dbField)
              ) {
                const numValue = parseFloat(value)
                if (!isNaN(numValue)) {
                  ;(transformedRow as any)[dbField] = numValue
                } else if (value) {
                  ;(transformedRow as any)[dbField] = 0
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
            // Include ALL rows - only filter out rows with no storage_bin (per user request)
            row.storage_bin
        )

      // Yield control to prevent UI blocking
      await this.delay(10)

      yield transformedChunk
    }
  }

  /**
   * Process large dataset import via BACKEND API to avoid browser timeouts
   * Transforms data client-side, sends to FastAPI backend for server-side insertion
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
      imported: 0,
      errors: [],
      message: '',
    }

    try {
      // Phase 1: Transform all data client-side (fast, no DB calls)
      if (progressCallback) {
        progressCallback({
          phase: 'processing',
          processed: 0,
          total: rows.length,
          successful: 0,
          currentRow: 0,
          totalRows: rows.length,
          processedChunks: 0,
          totalChunks: 1,
          insertedRows: 0,
          duplicateRows: 0,
          errorRows: 0,
          errors: [],
          message: `Transforming ${rows.length.toLocaleString()} rows for backend upload...`,
        })
      }

      // Transform all rows to database format
      const transformedData: any[] = []
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const transformedRow: any = {}

        headers.forEach((header, index) => {
          const cleanHeader = header.trim()
          const dbField = LX03_COLUMN_MAPPING[cleanHeader]

          if (dbField && row[index] !== undefined) {
            const value = row[index].trim()

            // Handle numeric fields
            if (
              [
                'total_stock',
                'available_stock',
                'stock_for_putaway',
                'pick_quantity',
              ].includes(dbField)
            ) {
              const numValue = parseFloat(value)
              if (!isNaN(numValue)) {
                transformedRow[dbField] = numValue
              } else if (value) {
                transformedRow[dbField] = 0
              }
            } else {
              // Handle text fields
              transformedRow[dbField] = value || null
            }
          }
        })

        // Include ALL rows - do not filter empty locations (per user request)
        if (transformedRow.storage_bin) {
          transformedData.push(transformedRow)
        }

        // Update progress every 10,000 rows
        if (i > 0 && i % 10000 === 0 && progressCallback) {
          progressCallback({
            phase: 'processing',
            processed: i,
            total: rows.length,
            successful: 0,
            currentRow: i,
            totalRows: rows.length,
            processedChunks: 0,
            totalChunks: 1,
            insertedRows: 0,
            duplicateRows: 0,
            errorRows: 0,
            errors: [],
            message: `Transformed ${i.toLocaleString()} of ${rows.length.toLocaleString()} rows...`,
          })
        }
      }

      logger.log(
        `✅ Transformed ${transformedData.length} valid rows (filtered from ${rows.length} total)`
      )

      // Phase 2: Send to backend API for insertion
      if (progressCallback) {
        progressCallback({
          phase: 'inserting',
          processed: 0,
          total: transformedData.length,
          successful: 0,
          currentRow: 0,
          totalRows: transformedData.length,
          processedChunks: 0,
          totalChunks: 1,
          insertedRows: 0,
          duplicateRows: 0,
          errorRows: 0,
          errors: [],
          message: `Uploading ${transformedData.length.toLocaleString()} rows to server... Backend is processing (this may take 10-20 minutes for large datasets)`,
        })
      }

      // Start a progress simulation timer to show activity while backend processes
      let simulatedProgress = 0
      const progressInterval = setInterval(() => {
        if (simulatedProgress < 90 && progressCallback) {
          simulatedProgress += 2
          progressCallback({
            phase: 'inserting',
            processed: Math.floor(
              (simulatedProgress / 100) * transformedData.length
            ),
            total: transformedData.length,
            successful: 0,
            currentRow: Math.floor(
              (simulatedProgress / 100) * transformedData.length
            ),
            totalRows: transformedData.length,
            processedChunks: 0,
            totalChunks: 1,
            insertedRows: Math.floor(
              (simulatedProgress / 100) * transformedData.length
            ),
            duplicateRows: 0,
            errorRows: 0,
            errors: [],
            message: `Backend server processing... ${simulatedProgress}% (estimated progress)`,
          })
        }
      }, 3000) // Update every 3 seconds

      // Get auth token for backend API
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('No active session - please log in')
      }

      // Call backend API
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'

      // Validate API URL in production to prevent hitting the wrong server
      if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
        logger.error('❌ VITE_API_URL is not set in production environment')
        throw new Error(
          'API server not configured. Please contact your administrator to set VITE_API_URL environment variable.'
        )
      }

      logger.log(`📡 LX03 Import: Calling API at ${apiUrl}/api/lx03/import`)

      let response: Response
      let backendResult

      try {
        response = await fetch(`${apiUrl}/api/lx03/import`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            data: transformedData,
            clear_existing: true,
          }),
        })

        // Clear the progress simulation timer
        clearInterval(progressInterval)

        if (!response.ok) {
          // Handle specific error codes with helpful messages
          if (response.status === 405) {
            logger.error(
              '❌ 405 Method Not Allowed - API endpoint not configured correctly'
            )
            throw new Error(
              'Import endpoint not available (405 Method Not Allowed). ' +
                'This usually means VITE_API_URL is not set correctly. ' +
                'Please ensure the API server URL is configured in environment variables.'
            )
          }

          const errorData = await response
            .json()
            .catch(() => ({ detail: response.statusText }))
          throw new Error(
            errorData.detail || `Backend API error: ${response.status}`
          )
        }

        backendResult = await response.json()
      } catch (fetchError) {
        // Clear the progress simulation timer on error
        clearInterval(progressInterval)
        throw fetchError
      }

      // Map backend result to our format
      result.success = backendResult.success
      result.insertedRows = backendResult.inserted_rows
      result.errorRows = backendResult.error_rows
      result.imported = backendResult.inserted_rows
      result.errors = backendResult.errors || []
      result.message = backendResult.message

      // Final progress update
      if (progressCallback) {
        progressCallback({
          phase: 'completed',
          processed: result.insertedRows,
          total: transformedData.length,
          successful: result.insertedRows,
          currentRow: transformedData.length,
          totalRows: transformedData.length,
          processedChunks: 1,
          totalChunks: 1,
          insertedRows: result.insertedRows,
          duplicateRows: 0,
          errorRows: result.errorRows,
          errors: result.errors,
          message: result.message,
        })
      }

      if (result.success) {
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }

      return result
    } catch (error) {
      logger.error('Large dataset import error:', error)
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      result.errors.push(errorMessage)
      result.message = `Import failed: ${errorMessage}`
      toast.error(result.message)

      // Show final error state in progress dialog
      if (progressCallback) {
        progressCallback({
          phase: 'completed',
          processed: 0,
          total: rows.length,
          successful: 0,
          currentRow: 0,
          totalRows: rows.length,
          processedChunks: 0,
          totalChunks: 1,
          insertedRows: 0,
          duplicateRows: 0,
          errorRows: rows.length,
          errors: [errorMessage],
          message: `Import failed: ${errorMessage}`,
        })
      }

      return result
    }
  }

  /**
   * DEPRECATED: Old client-side chunked import (kept for reference)
   * Use processLargeDatasetImport which calls backend API instead
   * @deprecated
   */
  // @ts-expect-error - Deprecated method kept for reference
  private async processLargeDatasetImportClientSide(
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
      imported: 0,
      errors: [],
      message: '',
    }

    try {
      const chunkSize = 100 // Reduced from 500 to 100 to avoid Supabase timeouts on very large datasets (138K+ rows)
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
            processed: result.insertedRows,
            total: rows.length,
            successful: result.insertedRows,
            currentRow: result.insertedRows + transformedChunk.length,
            totalRows: rows.length,
            processedChunks,
            totalChunks,
            insertedRows: result.insertedRows,
            duplicateRows: result.duplicateRows,
            errorRows: result.errorRows,
            errors: result.errors,
            message: `Inserting batch ${processedChunks + 1}/${totalChunks}...`,
          })
        }

        // Insert chunk into database with retry logic for connection errors
        let retryCount = 0
        const maxRetries = 3
        let chunkInserted = false

        while (!chunkInserted && retryCount < maxRetries) {
          try {
            const { data, error } = await supabase
              .from('rr_lx03_data')
              .insert(transformedChunk)
              .select()

            if (error) {
              // Check if it's a connection error that we should retry
              if (
                error.message?.includes('Failed to fetch') ||
                error.message?.includes('CONNECTION') ||
                error.message?.includes('timeout')
              ) {
                retryCount++
                if (retryCount < maxRetries) {
                  logger.warn(
                    `Chunk ${processedChunks + 1} connection error, retrying (${retryCount}/${maxRetries})...`
                  )
                  await this.delay(2000 * retryCount) // Exponential backoff: 2s, 4s, 6s
                  continue
                } else {
                  logger.error(
                    `Chunk ${processedChunks + 1} failed after ${maxRetries} retries:`,
                    error
                  )
                  result.errorRows += transformedChunk.length
                  result.errors.push(
                    `Chunk ${processedChunks + 1}: Failed after ${maxRetries} retries - ${error.message}`
                  )
                  chunkInserted = true // Exit retry loop
                }
              } else {
                // Non-connection error - don't retry
                logger.error(
                  `Chunk ${processedChunks + 1} insert error:`,
                  error
                )
                result.errorRows += transformedChunk.length
                result.errors.push(
                  `Chunk ${processedChunks + 1}: ${error.message}`
                )
                chunkInserted = true
              }
            } else {
              result.insertedRows += data?.length || 0
              chunkInserted = true
              if (retryCount > 0) {
                logger.log(
                  `✅ Chunk ${processedChunks + 1} succeeded after ${retryCount} ${retryCount === 1 ? 'retry' : 'retries'}`
                )
              }
            }
          } catch (insertError) {
            // Check if it's a connection exception that we should retry
            const errorMessage =
              insertError instanceof Error
                ? insertError.message
                : 'Unknown error'
            if (
              errorMessage.includes('Failed to fetch') ||
              errorMessage.includes('CONNECTION') ||
              errorMessage.includes('timeout')
            ) {
              retryCount++
              if (retryCount < maxRetries) {
                logger.warn(
                  `Chunk ${processedChunks + 1} connection exception, retrying (${retryCount}/${maxRetries})...`
                )
                await this.delay(2000 * retryCount) // Exponential backoff
                continue
              } else {
                logger.error(
                  `Chunk ${processedChunks + 1} exception after ${maxRetries} retries:`,
                  insertError
                )
                result.errorRows += transformedChunk.length
                result.errors.push(
                  `Chunk ${processedChunks + 1}: Failed after ${maxRetries} retries - ${errorMessage}`
                )
                chunkInserted = true
              }
            } else {
              // Non-connection exception - don't retry
              logger.error(
                `Chunk ${processedChunks + 1} insert exception:`,
                insertError
              )
              result.errorRows += transformedChunk.length
              result.errors.push(
                `Chunk ${processedChunks + 1}: ${errorMessage}`
              )
              chunkInserted = true
            }
          }
        }

        processedChunks++

        // Shorter delay between chunks for faster processing (reduced from 50ms to 25ms with smaller chunks)
        await this.delay(25)
      }

      // Final phase: Completed
      result.success = result.insertedRows > 0
      result.imported = result.insertedRows
      result.message = result.success
        ? `Successfully imported ${result.insertedRows} records${result.errorRows > 0 ? ` (${result.errorRows} errors)` : ''}`
        : `Import failed: ${result.errors[0] || 'Unknown error'}`

      if (progressCallback) {
        progressCallback({
          phase: 'completed',
          processed: result.insertedRows,
          total: rows.length,
          successful: result.insertedRows,
          currentRow: rows.length,
          totalRows: rows.length,
          processedChunks: totalChunks,
          totalChunks,
          insertedRows: result.insertedRows,
          duplicateRows: result.duplicateRows,
          errorRows: result.errorRows,
          errors: result.errors,
          message: result.message,
        })
      }

      if (result.success) {
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }

      return result
    } catch (error) {
      logger.error('Large dataset import error:', error)
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      result.errors.push(errorMessage)
      result.message = `Import failed: ${errorMessage}`
      toast.error(result.message)
      return result
    }
  }

  /**
   * Delete LX03 data record
   */
  async deleteLX03Data(id: string): Promise<{ success: boolean; error: any }> {
    try {
      const { error } = await supabase
        .from('rr_lx03_data')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { success: true, error: null }
    } catch (error) {
      logger.error('Error deleting LX03 data:', error)
      return { success: false, error }
    }
  }

  /**
   * Clear all LX03 data
   */
  async clearAllLX03Data(
    showToast: boolean = true
  ): Promise<{ success: boolean; error: any }> {
    try {
      logger.log('🗑️ Clearing all LX03 data...')

      // Delete all records for the current organization
      const { error } = await supabase
        .from('rr_lx03_data')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all records (using impossible UUID to match all)

      if (error) throw error

      if (showToast) {
        toast.success('All LX03 data cleared successfully')
      }

      logger.log('✅ LX03 data cleared successfully')
      return { success: true, error: null }
    } catch (error) {
      logger.error('❌ Error clearing LX03 data:', error)
      if (showToast) {
        toast.error('Failed to clear LX03 data')
      }
      return { success: false, error }
    }
  }
}

// Created and developed by Jai Singh
