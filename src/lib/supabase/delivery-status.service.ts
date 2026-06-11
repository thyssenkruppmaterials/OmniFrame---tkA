// Created and developed by Jai Singh
import { toast } from 'sonner'
import { rustDeliveryStatusService } from '@/lib/rust-core/delivery-status.service'
import { logger } from '@/lib/utils/logger'
import { getTodayEST } from '@/lib/utils/timezone'
import { supabase } from './client'
import type { Database, Tables, TablesInsert } from './database.types'

// Rust core integration
const RUST_CORE_ENABLED = import.meta.env.VITE_RUST_CORE_ENABLED === 'true'

// Type definitions for the new table
export type DeliveryStatusData = Tables<'rr_all_deliveries'> & {
  // Extended type that includes status from outbound_to_data
  status?: Database['public']['Enums']['outbound_status']
  status_updated_at?: string
  packed_by?: string
  packed_at?: string
  shipped_by?: string
  shipped_at?: string
  // Calculated field for days open
  days_open?: number | null
  // Disposition details (joined from delivery_dispositions)
  disposition_name?: string
  disposition_color?: string
}

export type DeliveryDisposition = Tables<'delivery_dispositions'>

export type DeliveryStatusInsert = TablesInsert<'rr_all_deliveries'>

export interface DeliveryStatusStatistics {
  totalDeliveries: number
  todayDeliveries: number
  statusBreakdown: Record<string, number>
  uniqueCustomers: number
  uniqueTransferOrders: number
  tkaNonControllable: {
    liftFan: number
    wawf: number
    placeholder: number
  }
}

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

// Expected column headers for validation (matching actual Excel format with forward slashes)
export const EXPECTED_DELIVERY_HEADERS = [
  'Warehouse Number/Warehouse complex',
  'Shipping point/Receiving Point',
  'Sales Organization',
  'Ship to party',
  'Customer Name',
  'Delivery',
  'Delivery Priority',
  'Delivery Block',
  'Delivery creation Date',
  'Delivery Create Time',
  'Delivery created By',
  'Delivery created Name',
  'Transfer Order Number',
  'Transfer Order create Date',
  'Transfer Order create Time',
  'Transfer Order confirm Date',
  'Delivery Change Date',
  'Delivery Change By',
  'Delivery changed By Name',
  'Actual Goods movement date',
  'Goods Movement Status',
  'Shipment Number',
  'Shipment Create Date',
  'Shipment Create By',
  'Shipment created Name',
  'External Identification 1',
]

// Column mapping from headers to database fields (updated for Excel format with forward slashes)
export const DELIVERY_COLUMN_MAPPING: Record<string, string> = {
  'Warehouse Number/Warehouse complex': 'warehouse_number',
  'Shipping point/Receiving Point': 'shipping_point', // Note: This header contains both shipping and receiving point info
  'Sales Organization': 'sales_organization',
  'Ship to party': 'ship_to_party',
  'Customer Name': 'customer_name',
  Delivery: 'delivery',
  'Delivery Priority': 'delivery_priority',
  'Delivery Block': 'delivery_block',
  'Delivery creation Date': 'delivery_creation_date',
  'Delivery Create Time': 'delivery_create_time',
  'Delivery created By': 'delivery_created_by',
  'Delivery created Name': 'delivery_created_name',
  'Transfer Order Number': 'transfer_order_number',
  'Transfer Order create Date': 'transfer_order_create_date',
  'Transfer Order create Time': 'transfer_order_create_time',
  'Transfer Order confirm Date': 'transfer_order_confirm_date',
  'Delivery Change Date': 'delivery_change_date',
  'Delivery Change By': 'delivery_change_by',
  'Delivery changed By Name': 'delivery_changed_by_name',
  'Actual Goods movement date': 'actual_goods_movement_date',
  'Goods Movement Status': 'goods_movement_status',
  'Shipment Number': 'shipment_number',
  'Shipment Create Date': 'shipment_create_date',
  'Shipment Create By': 'shipment_create_by',
  'Shipment created Name': 'shipment_created_name',
  'External Identification 1': 'external_identification_1',
}

export class DeliveryStatusService {
  private static instance: DeliveryStatusService

  public static getInstance(): DeliveryStatusService {
    if (!DeliveryStatusService.instance) {
      DeliveryStatusService.instance = new DeliveryStatusService()
    }
    return DeliveryStatusService.instance
  }

  /**
   * Fetch status data in chunks to handle large delivery lists
   */
  private async fetchStatusDataInChunks(
    deliveryNumbers: string[],
    organizationId: string
  ): Promise<any[]> {
    const chunkSize = 1000
    const chunks = []

    for (let i = 0; i < deliveryNumbers.length; i += chunkSize) {
      chunks.push(deliveryNumbers.slice(i, i + chunkSize))
    }

    logger.log(
      `🔄 Fetching status data for ${deliveryNumbers.length} deliveries in ${chunks.length} chunks...`
    )

    const allStatusData = []
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const { data, error } = await supabase
        .from('outbound_to_data')
        .select(
          'delivery, status, updated_at, packed_by, packed_at, shipped_by, shipped_at'
        )
        .eq('organization_id', organizationId)
        .in('delivery', chunk)

      if (error) {
        logger.error(`❌ Status chunk ${i + 1} error:`, error)
      } else if (data) {
        allStatusData.push(...data)
        logger.log(
          `✅ Status chunk ${i + 1}/${chunks.length}: Fetched ${data.length} status records`
        )
      }
    }

    return allStatusData
  }

  /**
   * Helper method to get current user's organization ID
   */
  private async getUserOrganization(): Promise<{
    userId: string
    organizationId: string
  }> {
    // Get current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      throw new Error('User not authenticated')
    }

    // Get user profile to get organization_id
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile || !profile.organization_id) {
      throw new Error('User organization not found')
    }

    return { userId: user.id, organizationId: profile.organization_id }
  }

  /**
   * Fetch delivery status data with optimized chunking for large datasets
   * @param limit - Maximum number of records to fetch (default: 1000). If > 10000, uses chunking.
   * @param offset - Starting position for pagination (default: 0)
   * @param openOnly - If true, fetch only open deliveries (no actual_goods_movement_date)
   * @param includeDeleted - If true, fetch ONLY deleted deliveries (November 9, 2025)
   */
  async fetchDeliveryStatusData(
    limit: number = 1000,
    offset: number = 0,
    openOnly: boolean = false,
    includeDeleted: boolean = false
  ): Promise<DeliveryStatusData[]> {
    // 🦀 Use Rust-optimized service when enabled
    if (RUST_CORE_ENABLED) {
      try {
        logger.log('🦀 Using Rust-optimized delivery status service...')
        // Cast is safe - Rust service returns compatible data structure
        return (await rustDeliveryStatusService.fetchDeliveryStatusData(
          limit,
          offset,
          openOnly,
          includeDeleted
        )) as unknown as DeliveryStatusData[]
      } catch (error) {
        logger.warn('⚠️ Rust service error, falling back to Supabase:', error)
        // Fall through to Supabase implementation
      }
    }

    try {
      const { organizationId } = await this.getUserOrganization()
      logger.log(
        `🚀 Fetching delivery status data (limit: ${limit}, offset: ${offset}, openOnly: ${openOnly})...`
      )

      // Build base query with disposition join
      let baseQuery = supabase
        .from('rr_all_deliveries')
        .select(
          `
          *,
          delivery_dispositions!dispositions (
            id,
            name,
            color
          )
        `,
          { count: 'exact' }
        )
        .eq('organization_id', organizationId)

      // Show Deleted mode
      if (includeDeleted) {
        logger.log(
          '🗑️ Fetching ALL deliveries (will filter to show only deleted)...'
        )
      } else {
        baseQuery = baseQuery.eq('is_deleted', false)

        if (openOnly) {
          const oeIrnaShippingPoints = [
            'PDCE',
            'NMP1',
            'NME1',
            'KY01',
            'DCSP',
            'IRNA',
          ]
          baseQuery = baseQuery
            .is('actual_goods_movement_date', null)
            .in('shipping_point', oeIrnaShippingPoints)
            .neq('customer_name', 'Ship in Place - LiftFan JPO Depot')
          logger.log(
            '📊 Fetching ONLY open deliveries for OE + IRNA shipping points...'
          )
        }
      }

      // Use chunking for large datasets (limit > 10000)
      if (limit > 10000) {
        logger.log(
          '🔄 Using CONTROLLED SEQUENTIAL CHUNKING for large dataset...'
        )

        // Get total count first - create a separate count query without the join
        let countQuery = supabase
          .from('rr_all_deliveries')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)

        if (!includeDeleted) {
          countQuery = countQuery.eq('is_deleted', false)

          if (openOnly) {
            const oeIrnaShippingPoints = [
              'PDCE',
              'NMP1',
              'NME1',
              'KY01',
              'DCSP',
              'IRNA',
            ]
            countQuery = countQuery
              .is('actual_goods_movement_date', null)
              .in('shipping_point', oeIrnaShippingPoints)
              .neq('customer_name', 'Ship in Place - LiftFan JPO Depot')
          }
        }

        const { count, error: countError } = await countQuery

        if (countError) {
          logger.error('❌ Count query error:', countError)
          throw countError
        }

        const totalRecords = count || 0
        logger.log(`📊 Total records to fetch: ${totalRecords}`)

        if (totalRecords === 0) {
          return []
        }

        // Fetch in chunks
        const chunkSize = 1000
        const totalChunks = Math.ceil(totalRecords / chunkSize)
        const allRecords: any[] = []
        const concurrentLimit = 3 // Conservative limit for large dataset
        const delayBetweenBatches = 200 // 200ms delay between batches

        logger.log(
          `🔢 Fetching ${totalChunks} chunks of ${chunkSize} records...`
        )

        for (
          let batchStart = 0;
          batchStart < totalChunks;
          batchStart += concurrentLimit
        ) {
          const batchEnd = Math.min(batchStart + concurrentLimit, totalChunks)
          const batchPromises = []

          for (let i = batchStart; i < batchEnd; i++) {
            const start = i * chunkSize
            const end = start + chunkSize - 1

            const chunkPromise = baseQuery
              .select(
                `
                *,
                delivery_dispositions!dispositions (
                  id,
                  name,
                  color
                )
              `
              )
              .order('delivery_creation_date', { ascending: false })
              .range(start, end)
              .then(({ data, error }) => {
                if (error) {
                  logger.error(`❌ Chunk ${i + 1} error:`, error)
                  throw error
                }
                logger.log(
                  `✅ Chunk ${i + 1}/${totalChunks}: Fetched ${data?.length || 0} records`
                )
                return data || []
              })

            batchPromises.push(chunkPromise)
          }

          const batchResults = await Promise.all(batchPromises)
          batchResults.forEach((chunk) => {
            allRecords.push(...chunk)
          })

          logger.log(
            `✅ Batch complete: ${allRecords.length}/${totalRecords} records fetched`
          )

          if (batchEnd < totalChunks) {
            await new Promise((resolve) =>
              setTimeout(resolve, delayBetweenBatches)
            )
          }
        }

        logger.log(
          `✅ CHUNKED FETCH COMPLETE: ${allRecords.length} delivery records fetched`
        )

        // Continue with enrichment below
        const deliveries = allRecords

        // Get delivery numbers for status lookup
        const deliveryNumbers = deliveries
          .map((d) => d.delivery)
          .filter(Boolean)

        if (deliveryNumbers.length === 0) {
          return deliveries.map((record) => this.applyBusinessRules(record))
        }

        // Fetch status information (also chunked if needed)
        const statusData = await this.fetchStatusDataInChunks(
          deliveryNumbers,
          organizationId
        )

        // Create status lookup map
        const statusMap: Record<string, any> = {}
        if (statusData) {
          statusData.forEach((status) => {
            if (status.delivery) {
              if (
                !statusMap[status.delivery] ||
                new Date(status.updated_at) >
                  new Date(statusMap[status.delivery].updated_at)
              ) {
                statusMap[status.delivery] = status
              }
            }
          })
        }

        // Enrich and return
        const enrichedData = deliveries
          .map((delivery: any) => {
            const statusInfo = statusMap[delivery.delivery]
            const dispositionData = delivery.delivery_dispositions
            const disposition_name = dispositionData?.name || null
            const disposition_color = dispositionData?.color || null

            return this.applyBusinessRules({
              ...delivery,
              status: statusInfo?.status || 'No Status',
              dispositions: dispositionData?.id || null,
              disposition_name,
              disposition_color,
            })
          })
          .filter(
            (delivery) =>
              !includeDeleted ||
              (includeDeleted &&
                (delivery.is_deleted ||
                  delivery.disposition_name === 'Deleted'))
          )

        logger.log(
          `📦 Returning ${enrichedData.length} enriched delivery records`
        )
        return enrichedData
      }

      // Standard fetch for smaller datasets
      const { data: deliveries, error: deliveryError } =
        openOnly || includeDeleted
          ? await baseQuery.order('delivery_creation_date', {
              ascending: false,
            })
          : await baseQuery
              .order('delivery_creation_date', { ascending: false })
              .range(offset, offset + limit - 1)

      if (deliveryError) {
        logger.error('❌ Delivery query error:', deliveryError)
        throw deliveryError
      }

      if (!deliveries || deliveries.length === 0) {
        logger.warn('⚠️ No delivery records found')
        return []
      }

      logger.log(`📊 Fetched ${deliveries.length} delivery records`)

      // Get delivery numbers for status lookup
      const deliveryNumbers = deliveries.map((d) => d.delivery).filter(Boolean)

      if (deliveryNumbers.length === 0) {
        return deliveries.map((record) => this.applyBusinessRules(record))
      }

      // Fetch status information from outbound_to_data
      const { data: statusData, error: statusError } = await supabase
        .from('outbound_to_data')
        .select(
          'delivery, status, updated_at, packed_by, packed_at, shipped_by, shipped_at'
        )
        .eq('organization_id', organizationId)
        .in('delivery', deliveryNumbers)

      if (statusError) {
        logger.error('Error fetching status data:', statusError)
        // Continue without status data
      }

      // Create status lookup map
      const statusMap: Record<string, any> = {}
      if (statusData) {
        statusData.forEach((status) => {
          if (status.delivery) {
            if (
              !statusMap[status.delivery] ||
              new Date(status.updated_at) >
                new Date(statusMap[status.delivery].updated_at)
            ) {
              statusMap[status.delivery] = status
            }
          }
        })
      }

      // Combine delivery data with status information and flatten disposition data
      const enrichedData = deliveries
        .map((delivery: any) => {
          const statusInfo = statusMap[delivery.delivery]

          // Flatten disposition data from join
          const dispositionData = delivery.delivery_dispositions
          const disposition_name = dispositionData?.name || null
          const disposition_color = dispositionData?.color || null

          const combinedRecord = {
            ...delivery,
            delivery_dispositions: undefined, // Remove nested object
            disposition_name,
            disposition_color,
            status: statusInfo?.status || null,
            outbound_updated_at: statusInfo?.updated_at || null,
            packed_by: statusInfo?.packed_by || null,
            packed_at: statusInfo?.packed_at || null,
            shipped_by: statusInfo?.shipped_by || null,
            shipped_at: statusInfo?.shipped_at || null,
          }

          return this.applyBusinessRules(combinedRecord)
        })
        // Filter based on mode (November 9, 2025)
        // In includeDeleted mode, don't filter - let component handle it
        // In normal mode, exclude deleted deliveries
        .filter((delivery: DeliveryStatusData) => {
          if (includeDeleted) {
            // Show Deleted mode: return ALL deliveries (component will filter)
            return true
          } else {
            // Normal mode: exclude deleted deliveries
            return delivery.disposition_name?.toUpperCase() !== 'DELETED'
          }
        })

      const modeDescription = includeDeleted
        ? '(all deliveries for deleted filtering)'
        : '(excluding "Deleted" dispositions)'
      logger.log(
        `✅ Fetched and enriched ${enrichedData.length} delivery status records ${modeDescription}`
      )
      return enrichedData
    } catch (error) {
      logger.error('Error fetching delivery status data:', error)
      throw error
    }
  }

  /**
   * Fetch open LiftFan rows specifically (the openOnly main fetch excludes
   * `customer_name='Ship in Place - LiftFan JPO Depot'`). Used by the
   * delivery-status-manager component as a *secondary* query so the LiftFan
   * TKA card's drill-down can show LiftFan rows in the table without
   * forcing the main `data` fetch off its stable openOnly path.
   *
   * Mirrors the openOnly contract exactly except for the LiftFan exclusion:
   *   is_deleted=false AND actual_goods_movement_date IS NULL
   *   AND shipping_point IN OE+IRNA
   *   AND customer_name = 'Ship in Place - LiftFan JPO Depot'
   *
   * Disposition is joined and `applyBusinessRules` is run so rows are
   * shape-compatible with the main `data` array (status, days_open,
   * disposition_name, etc.).
   */
  async fetchLiftFanRows(): Promise<DeliveryStatusData[]> {
    try {
      const { organizationId } = await this.getUserOrganization()
      const oeIrnaShippingPoints = [
        'PDCE',
        'NMP1',
        'NME1',
        'KY01',
        'DCSP',
        'IRNA',
      ]
      const { data, error } = await supabase
        .from('rr_all_deliveries')
        .select(
          `
          *,
          delivery_dispositions!dispositions (
            id,
            name,
            color
          )
        `
        )
        .eq('organization_id', organizationId)
        .eq('is_deleted', false)
        .is('actual_goods_movement_date', null)
        .in('shipping_point', oeIrnaShippingPoints)
        .eq('customer_name', 'Ship in Place - LiftFan JPO Depot')
        .order('delivery_creation_date', { ascending: false })
        .limit(10000)

      if (error) {
        logger.error('Error fetching LiftFan rows:', error)
        throw error
      }

      const enriched = (data || []).map((row: any) => {
        const dispositionDetails = row.delivery_dispositions
        return this.applyBusinessRules({
          ...row,
          disposition_name: dispositionDetails?.name,
          disposition_color: dispositionDetails?.color,
        })
      })

      logger.log(`✅ Fetched ${enriched.length} LiftFan rows`)
      return enriched
    } catch (error) {
      logger.error('Error in fetchLiftFanRows:', error)
      return []
    }
  }

  /**
   * Apply business rules and calculated fields to a delivery record
   */
  private applyBusinessRules(delivery: any): DeliveryStatusData {
    let daysOpen: number | null = null
    let finalStatus = delivery.status

    // Business Rule: If delivery has actual goods movement date, status should be 'completed'
    if (delivery.actual_goods_movement_date) {
      finalStatus = 'completed'
    }

    // Only calculate days open if there's no actual goods movement date
    if (
      !delivery.actual_goods_movement_date &&
      delivery.delivery_creation_date
    ) {
      try {
        let creationDateTime: Date

        // Use both date and time for precise calculation when available
        if (delivery.delivery_create_time) {
          // Combine date and time for exact timestamp
          const dateStr = delivery.delivery_creation_date
          const timeStr = delivery.delivery_create_time
          creationDateTime = new Date(`${dateStr}T${timeStr}`)
        } else {
          // Use date only - assume start of day for conservative estimate
          creationDateTime = new Date(delivery.delivery_creation_date)
        }

        const currentDateTime = new Date()

        // Calculate precise difference in milliseconds
        const timeDifference =
          currentDateTime.getTime() - creationDateTime.getTime()

        // Convert to days with more precision
        const daysDifference = timeDifference / (1000 * 3600 * 24)

        // Round to nearest whole day for display
        // Use Math.round instead of Math.floor for more accurate representation
        daysOpen = Math.round(daysDifference)

        // Ensure non-negative value
        daysOpen = Math.max(0, daysOpen)
      } catch (error) {
        logger.warn(
          'Error calculating days open for delivery:',
          delivery.delivery,
          error
        )
        daysOpen = null
      }
    }

    return {
      ...delivery,
      status: finalStatus,
      days_open: daysOpen,
    }
  }

  /**
   * Insert new delivery data
   */
  async insertDeliveryData(
    data: Omit<
      DeliveryStatusInsert,
      'id' | 'created_at' | 'updated_at' | 'organization_id'
    >
  ): Promise<Tables<'rr_all_deliveries'>> {
    try {
      const { organizationId } = await this.getUserOrganization()

      const insertData: DeliveryStatusInsert = {
        ...data,
        organization_id: organizationId,
      }

      const { data: result, error } = await supabase
        .from('rr_all_deliveries')
        .insert(insertData)
        .select()
        .single()

      if (error) throw error
      return result
    } catch (error) {
      logger.error('Error inserting delivery data:', error)
      throw error
    }
  }

  /**
   * Bulk insert delivery data with duplicate detection
   */
  async bulkInsertDeliveryData(
    dataArray: Omit<
      DeliveryStatusInsert,
      'id' | 'created_at' | 'updated_at' | 'organization_id'
    >[]
  ): Promise<ImportResult> {
    const result: ImportResult = {
      success: false,
      totalRows: dataArray.length,
      insertedRows: 0,
      duplicateRows: 0,
      errorRows: 0,
      errors: [],
    }

    try {
      const { organizationId } = await this.getUserOrganization()

      // Check for duplicates
      const existingDeliveries = await this.checkForDuplicateDeliveries(
        dataArray.map((d) => d.delivery).filter(Boolean) as string[],
        organizationId
      )

      // Filter out duplicates
      const uniqueData = dataArray.filter((row) => {
        if (!row.delivery) return false
        const isDuplicate = existingDeliveries.includes(row.delivery)
        if (isDuplicate) {
          result.duplicateRows++
          return false
        }
        return true
      })

      // Prepare insert data
      const insertData: DeliveryStatusInsert[] = uniqueData.map((row) => ({
        ...row,
        organization_id: organizationId!,
      }))

      if (insertData.length > 0) {
        const { data, error } = await supabase
          .from('rr_all_deliveries')
          .insert(insertData)
          .select()

        if (error) {
          result.errors.push(error.message)
          result.errorRows = insertData.length
        } else {
          result.insertedRows = data?.length || 0
          result.success = true
        }
      } else {
        result.success = true // All duplicates, but still "successful"
      }

      return result
    } catch (error) {
      logger.error('Error bulk inserting delivery data:', error)
      result.errors.push(
        error instanceof Error ? error.message : 'Unknown error'
      )
      result.errorRows = dataArray.length
      return result
    }
  }

  /**
   * Check for duplicate deliveries
   */
  private async checkForDuplicateDeliveries(
    deliveryNumbers: string[],
    organizationId: string
  ): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from('rr_all_deliveries')
        .select('delivery')
        .eq('organization_id', organizationId)
        .in('delivery', deliveryNumbers)

      if (error) throw error

      return (data || [])
        .map((record) => record.delivery)
        .filter(Boolean) as string[]
    } catch (error) {
      logger.error('Error checking duplicate deliveries:', error)
      return []
    }
  }

  /**
   * Parse clipboard data (Excel format)
   */
  async parseClipboardData(): Promise<ClipboardData> {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        throw new Error('Clipboard API not available')
      }

      const clipboardText = await navigator.clipboard.readText()

      if (!clipboardText.trim()) {
        throw new Error('Clipboard is empty')
      }

      const lines = clipboardText.trim().split('\n')

      if (lines.length < 2) {
        throw new Error(
          'Clipboard data must contain headers and at least one row'
        )
      }

      const headers = lines[0].split('\t').map((h) => h.trim())
      const rows = lines
        .slice(1)
        .map((line) => line.split('\t').map((cell) => cell.trim()))

      return { headers, rows }
    } catch (error) {
      logger.error('Error parsing clipboard data:', error)
      throw error
    }
  }

  /**
   * Validate headers match expected format (with flexibility for variations)
   */
  validateHeaders(headers: string[]): {
    isValid: boolean
    missingHeaders: string[]
    extraHeaders: string[]
  } {
    // Create a more flexible mapping that handles both old and new formats
    const flexibleHeaderMapping: Record<string, string[]> = {
      'Warehouse Number/Warehouse complex': [
        'warehouse number/warehouse complex',
        'warehouse number',
        'warehouse complex',
      ],
      'Shipping point/Receiving Point': [
        'shipping point/receiving point',
        'shipping point',
        'receiving point',
      ],
      'Sales Organization': ['sales organization'],
      'Ship to party': ['ship to party'],
      'Customer Name': ['customer name'],
      Delivery: ['delivery'],
      'Delivery Priority': ['delivery priority'],
      'Delivery Block': ['delivery block'],
      'Delivery creation Date': [
        'delivery creation date',
        'delivery created date',
      ],
      'Delivery Create Time': [
        'delivery create time',
        'delivery creation time',
      ],
      'Delivery created By': ['delivery created by'],
      'Delivery created Name': ['delivery created name'],
      'Transfer Order Number': ['transfer order number'],
      'Transfer Order create Date': [
        'transfer order create date',
        'transfer order creation date',
      ],
      'Transfer Order create Time': [
        'transfer order create time',
        'transfer order creation time',
      ],
      'Transfer Order confirm Date': [
        'transfer order confirm date',
        'transfer order confirmation date',
      ],
      'Delivery Change Date': ['delivery change date'],
      'Delivery Change By': ['delivery change by'],
      'Delivery changed By Name': ['delivery changed by name'],
      'Actual Goods movement date': ['actual goods movement date'],
      'Goods Movement Status': ['goods movement status'],
      'Shipment Number': ['shipment number'],
      'Shipment Create Date': [
        'shipment create date',
        'shipment creation date',
      ],
      'Shipment Create By': ['shipment create by'],
      'Shipment created Name': ['shipment created name'],
      'External Identification 1': ['external identification 1'],
    }

    const normalizedHeaders = headers.map((h) => h.toLowerCase().trim())

    const missingHeaders = EXPECTED_DELIVERY_HEADERS.filter((expected) => {
      const alternatives = flexibleHeaderMapping[expected] || [
        expected.toLowerCase(),
      ]
      return !alternatives.some((alt) =>
        normalizedHeaders.some(
          (header) => header === alt || header.includes(alt.split('/')[0]) // Handle partial matches for combined headers
        )
      )
    })

    const extraHeaders = headers.filter((header) => {
      const normalizedHeader = header.toLowerCase().trim()
      return !Object.values(flexibleHeaderMapping).some((alternatives) =>
        alternatives.some(
          (alt) =>
            normalizedHeader === alt ||
            normalizedHeader.includes(alt.split('/')[0])
        )
      )
    })

    return {
      isValid: missingHeaders.length === 0,
      missingHeaders,
      extraHeaders,
    }
  }

  /**
   * Get database field name for a given header (flexible matching)
   */
  private getDbFieldForHeader(header: string): string | null {
    const normalizedHeader = header.toLowerCase().trim()

    // Direct mapping first
    if (DELIVERY_COLUMN_MAPPING[header]) {
      return DELIVERY_COLUMN_MAPPING[header]
    }

    // Flexible matching for common variations
    const flexibleMappings: Record<string, string> = {
      'warehouse number': 'warehouse_number',
      'warehouse complex': 'warehouse_number',
      'warehouse number/warehouse complex': 'warehouse_number',
      'shipping point': 'shipping_point',
      'receiving point': 'receiving_point',
      'shipping point/receiving point': 'shipping_point', // Will be handled specially
      'sales organization': 'sales_organization',
      'ship to party': 'ship_to_party',
      'customer name': 'customer_name',
      delivery: 'delivery',
      'delivery priority': 'delivery_priority',
      'delivery block': 'delivery_block',
      'delivery creation date': 'delivery_creation_date',
      'delivery created date': 'delivery_creation_date',
      'delivery create time': 'delivery_create_time',
      'delivery creation time': 'delivery_create_time',
      'delivery created by': 'delivery_created_by',
      'delivery created name': 'delivery_created_name',
      'transfer order number': 'transfer_order_number',
      'transfer order create date': 'transfer_order_create_date',
      'transfer order creation date': 'transfer_order_create_date',
      'transfer order create time': 'transfer_order_create_time',
      'transfer order creation time': 'transfer_order_create_time',
      'transfer order confirm date': 'transfer_order_confirm_date',
      'transfer order confirmation date': 'transfer_order_confirm_date',
      'delivery change date': 'delivery_change_date',
      'delivery change by': 'delivery_change_by',
      'delivery changed by name': 'delivery_changed_by_name',
      'actual goods movement date': 'actual_goods_movement_date',
      'goods movement status': 'goods_movement_status',
      'shipment number': 'shipment_number',
      'shipment create date': 'shipment_create_date',
      'shipment creation date': 'shipment_create_date',
      'shipment create by': 'shipment_create_by',
      'shipment created name': 'shipment_created_name',
      'external identification 1': 'external_identification_1',
    }

    return flexibleMappings[normalizedHeader] || null
  }

  /**
   * Transform clipboard row to database format
   */
  transformRowToDatabase(
    headers: string[],
    row: string[]
  ): Omit<
    DeliveryStatusInsert,
    'id' | 'organization_id' | 'created_at' | 'updated_at'
  > {
    const transformed: any = {}

    headers.forEach((header, index) => {
      const normalizedHeader = header.toLowerCase().trim()
      const dbField = this.getDbFieldForHeader(header)

      if (row[index] !== undefined) {
        const value = row[index]?.trim()

        if (value === '') {
          if (dbField) transformed[dbField] = null
          return
        }

        // Handle special case for combined "Shipping point/Receiving Point" column
        if (
          normalizedHeader.includes('shipping point') &&
          normalizedHeader.includes('receiving point')
        ) {
          // Split the value if it contains a separator, otherwise use the whole value
          const parts = value
            // eslint-disable-next-line no-useless-escape
            .split(/[\/,;|]/)
            .map((part) => part.trim())
            .filter(Boolean)
          if (parts.length >= 2) {
            transformed['shipping_point'] = parts[0]
            transformed['receiving_point'] = parts[1]
          } else {
            // If no separator found, put the value in shipping_point
            transformed['shipping_point'] = value
            transformed['receiving_point'] = null
          }
          return
        }

        if (!dbField) return

        // Handle date fields
        if (dbField.includes('_date') && value) {
          try {
            const date = new Date(value)
            transformed[dbField] = isNaN(date.getTime())
              ? null
              : date.toISOString().split('T')[0]
          } catch {
            transformed[dbField] = null
          }
        }
        // Handle time fields
        else if (dbField.includes('_time') && value) {
          try {
            if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(value)) {
              transformed[dbField] = value.length === 5 ? `${value}:00` : value
            } else {
              transformed[dbField] = null
            }
          } catch {
            transformed[dbField] = null
          }
        }
        // Handle delivery field - remove leading zeros
        else if (dbField === 'delivery' && value) {
          // Remove leading zeros but preserve original if result would be empty
          const withoutLeadingZeros = value.replace(/^0+/, '') || value
          transformed[dbField] = withoutLeadingZeros
        } else {
          transformed[dbField] = value
        }
      }
    })

    return transformed
  }

  /**
   * Utility function to create chunks from array
   */
  private createChunks<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize))
    }
    return chunks
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
  ): AsyncGenerator<
    Array<
      Omit<
        DeliveryStatusInsert,
        'id' | 'organization_id' | 'created_at' | 'updated_at'
      >
    >,
    void,
    unknown
  > {
    const totalChunks = Math.ceil(rows.length / chunkSize)

    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize)
      const chunkIndex = Math.floor(i / chunkSize)

      // Update progress
      if (progressCallback) {
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
      const transformedChunk = chunk.map((row) =>
        this.transformRowToDatabase(headers, row)
      )

      // Yield control to prevent UI blocking
      await this.delay(10)

      yield transformedChunk
    }
  }

  /**
   * Chunked bulk insert with progress tracking
   */
  async bulkInsertDeliveryDataChunked(
    dataArray: Omit<
      DeliveryStatusInsert,
      'id' | 'created_at' | 'updated_at' | 'organization_id'
    >[],
    progressCallback?: ImportProgressCallback
  ): Promise<ImportResult> {
    const result: ImportResult = {
      success: false,
      totalRows: dataArray.length,
      insertedRows: 0,
      duplicateRows: 0,
      errorRows: 0,
      errors: [],
    }

    try {
      const { organizationId } = await this.getUserOrganization()

      const chunkSize = 500 // Optimal chunk size for Supabase
      const chunks = this.createChunks(dataArray, chunkSize)
      const totalChunks = chunks.length

      // Update progress - starting duplicate check
      if (progressCallback) {
        progressCallback({
          phase: 'validating',
          currentRow: 0,
          totalRows: dataArray.length,
          processedChunks: 0,
          totalChunks,
          insertedRows: 0,
          duplicateRows: 0,
          errorRows: 0,
          errors: [],
          message: 'Checking for duplicate deliveries...',
        })
      }

      // Check for duplicates in smaller batches to prevent large queries
      const deliveryNumbers = dataArray
        .map((d) => d.delivery)
        .filter(Boolean) as string[]
      const existingDeliveries = new Set<string>()

      // Process duplicate checking in chunks
      const duplicateCheckChunkSize = 1000
      for (
        let i = 0;
        i < deliveryNumbers.length;
        i += duplicateCheckChunkSize
      ) {
        const deliveryChunk = deliveryNumbers.slice(
          i,
          i + duplicateCheckChunkSize
        )
        const existing = await this.checkForDuplicateDeliveries(
          deliveryChunk,
          organizationId
        )
        existing.forEach((delivery) => existingDeliveries.add(delivery))

        // Yield control
        await this.delay(5)
      }

      // Process each chunk
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex]
        const chunkStartRow = chunkIndex * chunkSize

        // Update progress
        if (progressCallback) {
          progressCallback({
            phase: 'inserting',
            currentRow: chunkStartRow + chunk.length,
            totalRows: dataArray.length,
            processedChunks: chunkIndex + 1,
            totalChunks,
            insertedRows: result.insertedRows,
            duplicateRows: result.duplicateRows,
            errorRows: result.errorRows,
            errors: result.errors,
            message: `Inserting chunk ${chunkIndex + 1} of ${totalChunks}...`,
          })
        }

        // Filter out rows without delivery numbers (invalid data)
        const validChunk = chunk.filter((row) => {
          if (!row.delivery) return false
          return true
        })

        if (validChunk.length > 0) {
          try {
            // Prepare upsert data for this chunk
            // ALL records (new and existing) are sent to upsert
            const upsertData: DeliveryStatusInsert[] = validChunk.map(
              (row) => ({
                ...row,
                organization_id: organizationId!,
              })
            )

            // Use upsert to UPDATE existing records or INSERT new ones
            // This preserves disposition data (not included in import) and other manually-set fields
            // Note: Requires unique constraint on (delivery, organization_id)
            const { data, error } = await supabase
              .from('rr_all_deliveries')
              .upsert(upsertData, {
                onConflict: 'delivery,organization_id',
                ignoreDuplicates: false, // Update existing records, don't skip them
              })
              .select()

            if (error) {
              result.errors.push(`Chunk ${chunkIndex + 1}: ${error.message}`)
              result.errorRows += validChunk.length
            } else {
              // Count actual inserts vs updates for accurate reporting
              const processedCount = data?.length || 0
              result.insertedRows += processedCount

              // Track all processed deliveries
              data?.forEach((record) => {
                if (record.delivery) {
                  // If it was already in existingDeliveries, it was an update
                  if (existingDeliveries.has(record.delivery)) {
                    result.duplicateRows++ // Count as update
                  }
                  existingDeliveries.add(record.delivery)
                }
              })
            }
          } catch (chunkError) {
            const errorMessage =
              chunkError instanceof Error ? chunkError.message : 'Unknown error'
            result.errors.push(`Chunk ${chunkIndex + 1}: ${errorMessage}`)
            result.errorRows += validChunk.length
          }
        }

        // Yield control to browser
        await this.delay(50)
      }

      // Determine overall success
      result.success =
        result.insertedRows > 0 ||
        (result.duplicateRows > 0 && result.errorRows === 0)

      return result
    } catch (error) {
      logger.error('Error in chunked bulk insert:', error)
      result.errors.push(
        error instanceof Error ? error.message : 'Unknown error'
      )
      result.errorRows = dataArray.length
      return result
    }
  }

  /**
   * Import data from clipboard with chunked processing for large datasets
   * Now includes deletion detection (November 9, 2025)
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

      // Show data size warning for large imports
      const totalRows = clipboardData.rows.length
      if (totalRows > 10000) {
        logger.log(
          `⚠️ Large import detected: ${totalRows.toLocaleString()} rows. Using chunked processing...`
        )
      }

      // Phase 3: Process data in chunks (upsert mode - updates existing, inserts new)
      const allTransformedData: Array<
        Omit<
          DeliveryStatusInsert,
          'id' | 'organization_id' | 'created_at' | 'updated_at'
        >
      > = []

      for await (const chunk of this.processDataInChunks(
        clipboardData.headers,
        clipboardData.rows,
        500,
        progressCallback
      )) {
        allTransformedData.push(...chunk)
      }

      // Phase 3.5: Detect deleted deliveries (November 9, 2025) - DISABLED November 25, 2025
      // AUTOMATIC DELETION DETECTION DISABLED BY USER REQUEST
      // This feature was automatically marking deliveries as is_deleted=true when they
      // disappeared from import data. User requested this be disabled.
      /*
      logger.log('🔍 Starting deletion detection...')
      const importedDeliveryNumbers = allTransformedData.map(d => d.delivery).filter(Boolean) as string[]
      logger.log(`📊 Import contains ${importedDeliveryNumbers.length} deliveries`)
      logger.log(`📦 Sample of imported deliveries:`, importedDeliveryNumbers.slice(0, 10))
      
      // Check if specific delivery is in import (for debugging)
      if (importedDeliveryNumbers.includes('64797763')) {
        logger.warn('⚠️ Delivery 64797763 IS in your import data')
      }
      
      const deletionResult = await this.detectAndMarkDeletedDeliveries(importedDeliveryNumbers)
      
      if (deletionResult.marked > 0) {
        logger.log(`🗑️ Marked ${deletionResult.marked} deliveries as deleted`)
      }
      if (deletionResult.reactivated > 0) {
        logger.log(`🔄 Reactivated ${deletionResult.reactivated} deliveries`)
      }
      if (deletionResult.marked === 0 && deletionResult.reactivated === 0) {
        logger.log('✅ No delivery deletions or reactivations detected')
      }
      */
      logger.log('ℹ️ Automatic deletion detection is disabled')

      // Phase 4: Chunked database upsert (update existing, insert new)
      const result = await this.bulkInsertDeliveryDataChunked(
        allTransformedData,
        progressCallback
      )

      // Phase 5: Complete
      if (progressCallback) {
        progressCallback({
          phase: 'completed',
          currentRow: totalRows,
          totalRows,
          processedChunks: Math.ceil(totalRows / 500),
          totalChunks: Math.ceil(totalRows / 500),
          insertedRows: result.insertedRows,
          duplicateRows: result.duplicateRows,
          errorRows: result.errorRows,
          errors: result.errors,
          message: result.success
            ? `Import completed! ${result.insertedRows} records processed.`
            : `Import completed with errors.`,
        })
      }

      // Show final result toast
      if (result.success) {
        const newRecords = result.insertedRows - result.duplicateRows
        const updatedRecords = result.duplicateRows

        toast.success(
          `Import successful! ${result.insertedRows.toLocaleString()} delivery records processed.`,
          {
            description:
              updatedRecords > 0
                ? `${newRecords.toLocaleString()} new records added, ${updatedRecords.toLocaleString()} existing records updated. Dispositions preserved.`
                : `${newRecords.toLocaleString()} new records added. Dispositions preserved.`,
          }
        )
      } else {
        toast.error(`Import failed: ${result.errors.join(', ')}`)
      }

      return result
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      toast.error(`Import failed: ${errorMessage}`)

      return {
        success: false,
        totalRows: 0,
        insertedRows: 0,
        duplicateRows: 0,
        errorRows: 0,
        errors: [errorMessage],
      }
    }
  }

  /**
   * Legacy import method (kept for backward compatibility)
   */
  async importFromClipboardLegacy(): Promise<ImportResult> {
    try {
      const clipboardData = await this.parseClipboardData()

      const validation = this.validateHeaders(clipboardData.headers)
      if (!validation.isValid) {
        throw new Error(
          `Missing required columns: ${validation.missingHeaders.join(', ')}`
        )
      }

      const transformedData = clipboardData.rows.map((row) =>
        this.transformRowToDatabase(clipboardData.headers, row)
      )

      const result = await this.bulkInsertDeliveryData(transformedData)

      if (result.success) {
        toast.success(
          `Import successful! ${result.insertedRows} new delivery records added.`,
          {
            description:
              result.duplicateRows > 0
                ? `${result.duplicateRows} duplicates skipped.`
                : undefined,
          }
        )
      } else {
        toast.error(`Import failed: ${result.errors.join(', ')}`)
      }

      return result
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      toast.error(`Import failed: ${errorMessage}`)

      return {
        success: false,
        totalRows: 0,
        insertedRows: 0,
        duplicateRows: 0,
        errorRows: 0,
        errors: [errorMessage],
      }
    }
  }

  /**
   * Subscribe to real-time changes
   */
  async subscribeToChanges(callback: (payload: any) => void) {
    try {
      const { organizationId } = await this.getUserOrganization()

      const subscription = supabase
        .channel('delivery_status_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'rr_all_deliveries',
            filter: `organization_id=eq.${organizationId}`,
          },
          callback
        )
        .subscribe()

      return subscription
    } catch (error) {
      logger.error('Error subscribing to changes:', error)
      return null
    }
  }

  /**
   * Get delivery status statistics (queries entire database, not limited to 1000)
   */
  async getStatistics(): Promise<DeliveryStatusStatistics> {
    // 🦀 Use Rust-optimized service when enabled
    if (RUST_CORE_ENABLED) {
      try {
        logger.log('🦀 Using Rust-optimized delivery status statistics...')
        return await rustDeliveryStatusService.getStatistics()
      } catch (error) {
        logger.warn(
          '⚠️ Rust statistics error, falling back to Supabase:',
          error
        )
        // Fall through to Supabase implementation
      }
    }

    try {
      const { organizationId } = await this.getUserOrganization()

      // Use EST timezone for accurate "today" calculation
      const today = getTodayEST()

      logger.log(`📊 Fetching delivery statistics from entire database...`)
      logger.log(
        `📅 Delivery Status Statistics: Using EST date - Today: ${today}`
      )

      // Get total count - fetch data and filter client-side to exclude "Deleted" dispositions
      // (can't use .not() on joined fields with nulls)
      // NOTE: Must specify limit to avoid Supabase's default 1000-row cap
      const { data: allDeliveriesForCount } = await supabase
        .from('rr_all_deliveries')
        .select(
          `
          id,
          delivery_dispositions!dispositions (
            name
          )
        `
        )
        .eq('organization_id', organizationId)
        .eq('is_deleted', false)
        .limit(100000)

      const totalCount = allDeliveriesForCount
        ? allDeliveriesForCount.filter((d: any) => {
            const dispName = d.delivery_dispositions?.name
            return !dispName || dispName.toUpperCase() !== 'DELETED'
          }).length
        : 0

      const totalError = null

      if (totalError) {
        logger.error('Error getting total count:', totalError)
      }

      // Get today's deliveries count - fetch and filter client-side
      const { data: todayDeliveriesForCount } = await supabase
        .from('rr_all_deliveries')
        .select(
          `
          id,
          delivery_dispositions!dispositions (
            name
          )
        `
        )
        .eq('organization_id', organizationId)
        .eq('is_deleted', false)
        .eq('delivery_creation_date', today)
        .limit(100000)

      const todayCount = todayDeliveriesForCount
        ? todayDeliveriesForCount.filter((d: any) => {
            const dispName = d.delivery_dispositions?.name
            return !dispName || dispName.toUpperCase() !== 'DELETED'
          }).length
        : 0

      const todayError = null

      if (todayError) {
        logger.error('Error getting today count:', todayError)
      }

      // Get unique customers - fetch and filter client-side
      const { data: customerDataRaw } = await supabase
        .from('rr_all_deliveries')
        .select(
          `
          customer_name,
          delivery_dispositions!dispositions (
            name
          )
        `
        )
        .eq('organization_id', organizationId)
        .eq('is_deleted', false)
        .not('customer_name', 'is', null)
        .limit(100000)

      const customerData = customerDataRaw
        ? customerDataRaw.filter((d: any) => {
            const dispName = d.delivery_dispositions?.name
            return !dispName || dispName.toUpperCase() !== 'DELETED'
          })
        : []

      // Get unique transfer orders - fetch and filter client-side
      const { data: toDataRaw } = await supabase
        .from('rr_all_deliveries')
        .select(
          `
          transfer_order_number,
          delivery_dispositions!dispositions (
            name
          )
        `
        )
        .eq('organization_id', organizationId)
        .eq('is_deleted', false)
        .not('transfer_order_number', 'is', null)
        .limit(100000)

      const toData = toDataRaw
        ? toDataRaw.filter((d: any) => {
            const dispName = d.delivery_dispositions?.name
            return !dispName || dispName.toUpperCase() !== 'DELETED'
          })
        : []

      // Get status breakdown from outbound_to_data
      const { data: statusData, error: statusError } = await supabase
        .from('outbound_to_data')
        .select('status')
        .eq('organization_id', organizationId)
        .limit(100000)

      const statusBreakdown: Record<string, number> = {}
      if (!statusError && statusData) {
        statusData.forEach((record) => {
          const status = record.status || 'no_status'
          statusBreakdown[status] = (statusBreakdown[status] || 0) + 1
        })
      }

      // Calculate TKA Non-Controllable counts (November 9, 2025)
      // Fetch open deliveries and filter client-side.
      //
      // Intentionally NOT scoped to OE+IRNA: this stat is shared with the
      // GRS Apps Delivery Status page, which operates on a different set
      // of shipping points (8109/8209/8309/8409/INCR/IADS/KYCR). Scoping
      // here would silently break that page's cards. Any small mismatch
      // (typically 1 row) between this card count and the OE+IRNA-scoped
      // table on Outbound is acknowledged as out of scope for this page.
      const { data: openDeliveriesDataRaw } = await supabase
        .from('rr_all_deliveries')
        .select(
          `
          customer_name,
          external_identification_1,
          delivery_dispositions!dispositions (
            name
          )
        `
        )
        .eq('organization_id', organizationId)
        .eq('is_deleted', false)
        .is('actual_goods_movement_date', null)
        .limit(100000)

      // Filter out "Deleted" dispositions client-side
      const openDeliveriesData = openDeliveriesDataRaw
        ? openDeliveriesDataRaw.filter((d: any) => {
            const dispName = d.delivery_dispositions?.name
            return !dispName || dispName.toUpperCase() !== 'DELETED'
          })
        : []

      let liftFanCount = 0
      let wawfCount = 0

      if (openDeliveriesData && openDeliveriesData.length > 0) {
        liftFanCount = openDeliveriesData.filter(
          (item: any) =>
            item.customer_name === 'Ship in Place - LiftFan JPO Depot'
        ).length

        wawfCount = openDeliveriesData.filter((item: any) =>
          item.external_identification_1?.toUpperCase().includes('WAWF')
        ).length
      }

      const stats = {
        totalDeliveries: totalCount || 0,
        todayDeliveries: todayCount || 0,
        statusBreakdown,
        uniqueCustomers: customerData
          ? new Set(customerData.map((r) => r.customer_name).filter(Boolean))
              .size
          : 0,
        uniqueTransferOrders: toData
          ? new Set(toData.map((r) => r.transfer_order_number).filter(Boolean))
              .size
          : 0,
        tkaNonControllable: {
          liftFan: liftFanCount,
          wawf: wawfCount,
          placeholder: 0,
        },
      }

      logger.log('✅ Delivery statistics calculated:', {
        totalDeliveries: stats.totalDeliveries.toLocaleString(),
        todayDeliveries: stats.todayDeliveries,
        uniqueCustomers: stats.uniqueCustomers,
        uniqueTransferOrders: stats.uniqueTransferOrders,
        statusCount: Object.keys(stats.statusBreakdown).length,
      })

      return stats
    } catch (error) {
      logger.error('Error getting delivery status statistics:', error)
      return {
        totalDeliveries: 0,
        todayDeliveries: 0,
        statusBreakdown: {},
        uniqueCustomers: 0,
        uniqueTransferOrders: 0,
        tkaNonControllable: {
          liftFan: 0,
          wawf: 0,
          placeholder: 0,
        },
      }
    }
  }

  /**
   * Get count of deliveries with PGI (Post Goods Issue) for a specific date
   * Filters by actual_goods_movement_date matching the provided date
   * ONLY counts OE + IRNA shipping points (November 17, 2025)
   * @param targetDate - Date to filter by (defaults to today)
   * @returns Promise with count of deliveries
   */
  async getDeliveriesPGIForDate(
    targetDate: Date = new Date()
  ): Promise<number> {
    try {
      const { organizationId } = await this.getUserOrganization()

      // Format the date as YYYY-MM-DD in EST timezone (same as database storage)
      const estFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })

      const estParts = estFormatter.formatToParts(targetDate)
      const estYear = estParts.find((part) => part.type === 'year')?.value
      const estMonth = estParts.find((part) => part.type === 'month')?.value
      const estDay = estParts.find((part) => part.type === 'day')?.value
      const dateString = `${estYear}-${estMonth}-${estDay}`

      logger.log(`📊 Fetching deliveries with PGI for EST date: ${dateString}`)

      // OE + IRNA shipping points only (November 17, 2025)
      // OE shipping points: PDCE, NMP1, NME1, KY01, DCSP
      // IRNA shipping point: IRNA
      const oeAndIrnaShippingPoints = [
        'PDCE',
        'NMP1',
        'NME1',
        'KY01',
        'DCSP',
        'IRNA',
      ]

      // Query deliveries where actual_goods_movement_date matches the target date
      // AND shipping_point is in OE + IRNA list
      const { count, error } = await supabase
        .from('rr_all_deliveries')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('is_deleted', false)
        .eq('actual_goods_movement_date', dateString)
        .in('shipping_point', oeAndIrnaShippingPoints)

      if (error) {
        logger.error('Error fetching PGI deliveries:', error)
        throw error
      }

      const pgiCount = count || 0
      logger.log(
        `✅ Found ${pgiCount} deliveries with PGI for ${dateString} (OE + IRNA only)`
      )
      return pgiCount
    } catch (error) {
      logger.error('Error getting PGI deliveries count:', error)
      return 0
    }
  }

  /**
   * Search delivery data using database query (searches entire dataset)
   * @param query - Search query string
   * @param limit - Maximum number of results to return (default: 1000)
   */
  async searchDeliveryData(
    query: string,
    limit: number = 1000,
    includeDeleted: boolean = false
  ): Promise<DeliveryStatusData[]> {
    // 🦀 Use Rust-optimized service when enabled
    if (RUST_CORE_ENABLED) {
      try {
        logger.log('🦀 Using Rust-optimized delivery status search...')
        // Cast is safe - Rust service returns compatible data structure
        return (await rustDeliveryStatusService.searchDeliveryData(
          query,
          limit,
          includeDeleted
        )) as unknown as DeliveryStatusData[]
      } catch (error) {
        logger.warn('⚠️ Rust search error, falling back to Supabase:', error)
        // Fall through to Supabase implementation
      }
    }

    try {
      const { organizationId } = await this.getUserOrganization()

      if (!query.trim()) {
        // If no query, return limited initial data
        return await this.fetchDeliveryStatusData(
          limit,
          0,
          false,
          includeDeleted
        )
      }

      // Remove all whitespace from search term for whitespace-insensitive search
      const searchTerm = query.toLowerCase().replace(/\s+/g, '')
      logger.log(
        `🔍 Searching delivery data for: "${searchTerm}" (whitespace removed)`
      )

      // Build search query using database OR filters for better performance
      // Include disposition join
      let searchQuery = supabase
        .from('rr_all_deliveries')
        .select(
          `
          *,
          delivery_dispositions!dispositions (
            id,
            name,
            color
          )
        `
        )
        .eq('organization_id', organizationId)

      // Apply deletion filtering based on mode
      if (!includeDeleted) {
        searchQuery = searchQuery.eq('is_deleted', false) // Exclude is_deleted=true at database level
        // Note: Client-side filter will handle "Deleted" disposition exclusion (can't use .not() on joins with nulls)
      }

      // Apply comprehensive text search filters across ALL TEXT columns (whitespace-insensitive)
      // Note: Exclude DATE columns as ILIKE doesn't work on date types in PostgreSQL
      searchQuery = searchQuery.or(
        `delivery.ilike.%${searchTerm}%,` +
          `customer_name.ilike.%${searchTerm}%,` +
          `delivery_priority.ilike.%${searchTerm}%,` +
          `shipping_point.ilike.%${searchTerm}%,` +
          `receiving_point.ilike.%${searchTerm}%,` +
          `external_identification_1.ilike.%${searchTerm}%,` +
          `warehouse_number.ilike.%${searchTerm}%,` +
          `sales_organization.ilike.%${searchTerm}%,` +
          `ship_to_party.ilike.%${searchTerm}%,` +
          `delivery_block.ilike.%${searchTerm}%,` +
          `delivery_created_by.ilike.%${searchTerm}%,` +
          `delivery_created_name.ilike.%${searchTerm}%,` +
          `transfer_order_number.ilike.%${searchTerm}%,` +
          `delivery_change_by.ilike.%${searchTerm}%,` +
          `delivery_changed_by_name.ilike.%${searchTerm}%,` +
          `goods_movement_status.ilike.%${searchTerm}%,` +
          `shipment_number.ilike.%${searchTerm}%,` +
          `shipment_create_by.ilike.%${searchTerm}%,` +
          `shipment_created_name.ilike.%${searchTerm}%`
      )

      const { data: deliveries, error } = await searchQuery
        .order('delivery_creation_date', { ascending: false })
        .limit(limit)

      if (error) {
        logger.error('Search query error:', error)
        throw error
      }

      if (!deliveries || deliveries.length === 0) {
        logger.log('No search results found')
        return []
      }

      logger.log(`📊 Found ${deliveries.length} matching deliveries`)

      // Enrich with status data
      const deliveryNumbers = deliveries.map((d) => d.delivery).filter(Boolean)

      if (deliveryNumbers.length === 0) {
        return deliveries.map((record) => this.applyBusinessRules(record))
      }

      // Batch delivery numbers to avoid URL length limits (max 100 per batch)
      const batchSize = 100
      const statusMap: Record<string, any> = {}

      for (let i = 0; i < deliveryNumbers.length; i += batchSize) {
        const batch = deliveryNumbers.slice(i, i + batchSize)

        const { data: statusData } = await supabase
          .from('outbound_to_data')
          .select(
            'delivery, status, updated_at, packed_by, packed_at, shipped_by, shipped_at'
          )
          .eq('organization_id', organizationId)
          .in('delivery', batch)

        if (statusData) {
          statusData.forEach((status) => {
            if (status.delivery) {
              statusMap[status.delivery] = status
            }
          })
        }
      }

      const enrichedData = deliveries
        .map((delivery: any) => {
          const statusInfo = statusMap[delivery.delivery]

          // Flatten disposition data from join
          const dispositionData = delivery.delivery_dispositions
          const disposition_name = dispositionData?.name || null
          const disposition_color = dispositionData?.color || null

          return this.applyBusinessRules({
            ...delivery,
            delivery_dispositions: undefined, // Remove nested object
            disposition_name,
            disposition_color,
            status: statusInfo?.status || null,
            outbound_updated_at: statusInfo?.updated_at || null,
            packed_by: statusInfo?.packed_by || null,
            packed_at: statusInfo?.packed_at || null,
            shipped_by: statusInfo?.shipped_by || null,
            shipped_at: statusInfo?.shipped_at || null,
          })
        })
        // Filter deliveries based on deletion mode (November 9, 2025)
        // In includeDeleted mode, don't filter - let component handle it
        .filter((delivery: DeliveryStatusData) => {
          if (includeDeleted) {
            // Show Deleted mode: return ALL (component will filter)
            return true
          } else {
            // Normal mode: exclude deleted deliveries
            return delivery.disposition_name?.toUpperCase() !== 'DELETED'
          }
        })

      const modeDescription = includeDeleted
        ? '(all deliveries for deleted filtering)'
        : '(excluding "Deleted" dispositions)'
      logger.log(
        `✅ Search completed: ${enrichedData.length} enriched results ${modeDescription}`
      )
      return enrichedData
    } catch (error) {
      logger.error('Error searching delivery data:', error)
      throw error
    }
  }

  /**
   * Delete delivery record
   */
  async deleteDeliveryData(id: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('rr_all_deliveries')
        .delete()
        .eq('id', id)

      if (error) throw error
    } catch (error) {
      logger.error('Error deleting delivery data:', error)
      throw error
    }
  }

  /**
   * Update delivery record
   */
  async updateDeliveryData(
    id: string,
    updates: Partial<DeliveryStatusInsert>
  ): Promise<Tables<'rr_all_deliveries'>> {
    try {
      const { data, error } = await supabase
        .from('rr_all_deliveries')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    } catch (error) {
      logger.error('Error updating delivery data:', error)
      throw error
    }
  }

  /**
   * Clear all delivery data from the database
   * @param showToast - Whether to show a success/error toast notification
   */
  async clearAllDeliveryData(showToast: boolean = true): Promise<void> {
    try {
      const { error } = await supabase
        .from('rr_all_deliveries')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all records

      if (error) throw error

      if (showToast) {
        toast.success('All delivery data cleared successfully')
      }
    } catch (error) {
      logger.error('Error clearing delivery data:', error)
      if (showToast) {
        toast.error('Failed to clear delivery data')
      }
      throw error
    }
  }

  /**
   * Get all dispositions for the current organization
   */
  async getDispositions(
    organizationId: string
  ): Promise<DeliveryDisposition[]> {
    try {
      const { data, error } = await supabase
        .from('delivery_dispositions')
        .select('*')
        .eq('organization_id', organizationId)
        .order('name', { ascending: true })

      if (error) throw error
      return data || []
    } catch (error) {
      logger.error('Error fetching dispositions:', error)
      throw error
    }
  }

  /**
   * Create a new disposition
   */
  async createDisposition(
    disposition: TablesInsert<'delivery_dispositions'>
  ): Promise<DeliveryDisposition> {
    try {
      const { data, error } = await supabase
        .from('delivery_dispositions')
        .insert(disposition)
        .select()
        .single()

      if (error) throw error
      toast.success('Disposition created successfully')
      return data
    } catch (error) {
      logger.error('Error creating disposition:', error)
      toast.error('Failed to create disposition')
      throw error
    }
  }

  /**
   * Update a disposition
   */
  async updateDisposition(
    id: string,
    updates: Partial<TablesInsert<'delivery_dispositions'>>
  ): Promise<DeliveryDisposition> {
    try {
      const { data, error } = await supabase
        .from('delivery_dispositions')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      toast.success('Disposition updated successfully')
      return data
    } catch (error) {
      logger.error('Error updating disposition:', error)
      toast.error('Failed to update disposition')
      throw error
    }
  }

  /**
   * Delete a disposition
   */
  async deleteDisposition(id: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('delivery_dispositions')
        .delete()
        .eq('id', id)

      if (error) throw error
      toast.success('Disposition deleted successfully')
    } catch (error) {
      logger.error('Error deleting disposition:', error)
      toast.error('Failed to delete disposition')
      throw error
    }
  }

  /**
   * Update delivery disposition
   */
  async updateDeliveryDisposition(
    deliveryId: string,
    dispositionId: string | null
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('rr_all_deliveries')
        .update({ dispositions: dispositionId })
        .eq('id', deliveryId)

      if (error) throw error
    } catch (error) {
      logger.error('Error updating delivery disposition:', error)
      toast.error('Failed to update disposition')
      throw error
    }
  }

  /**
   * Ensure required dispositions exist and get their IDs
   * Creates DCMA and WAWF dispositions if they don't exist (November 9, 2025)
   */
  async ensureRequiredDispositions(
    organizationId: string
  ): Promise<{ dcmaId: string | null; wawfId: string | null }> {
    try {
      const dispositions = await this.getDispositions(organizationId)

      let dcmaDisposition = dispositions.find(
        (d) => d.name.toUpperCase() === 'DCMA'
      )
      let wawfDisposition = dispositions.find(
        (d) => d.name.toUpperCase() === 'WAWF'
      )

      // Create DCMA disposition if it doesn't exist
      if (!dcmaDisposition) {
        try {
          dcmaDisposition = await this.createDisposition({
            organization_id: organizationId,
            name: 'DCMA',
            color: 'orange',
          })
          logger.log('✅ Created DCMA disposition')
        } catch (error) {
          logger.error('Error creating DCMA disposition:', error)
        }
      }

      // Create WAWF disposition if it doesn't exist
      if (!wawfDisposition) {
        try {
          wawfDisposition = await this.createDisposition({
            organization_id: organizationId,
            name: 'WAWF',
            color: 'purple',
          })
          logger.log('✅ Created WAWF disposition')
        } catch (error) {
          logger.error('Error creating WAWF disposition:', error)
        }
      }

      return {
        dcmaId: dcmaDisposition?.id || null,
        wawfId: wawfDisposition?.id || null,
      }
    } catch (error) {
      logger.error('Error ensuring required dispositions:', error)
      return { dcmaId: null, wawfId: null }
    }
  }

  /**
   * Standalone method to detect and mark deleted deliveries (November 9, 2025)
   * This can be called manually or during import
   */
  async detectAndMarkDeletedDeliveries(
    importedDeliveryNumbers: string[]
  ): Promise<{ marked: number; reactivated: number }> {
    try {
      const { organizationId } = await this.getUserOrganization()

      // Get all existing delivery numbers (not already marked as deleted)
      const { data: existingDeliveries } = await supabase
        .from('rr_all_deliveries')
        .select('delivery')
        .eq('organization_id', organizationId)
        .eq('is_deleted', false)

      if (!existingDeliveries || existingDeliveries.length === 0) {
        return { marked: 0, reactivated: 0 }
      }

      const existingDeliveryNumbers = new Set(
        existingDeliveries.map((d) => d.delivery).filter(Boolean)
      )
      const importedSet = new Set(importedDeliveryNumbers)

      logger.log(
        `📊 Database has ${existingDeliveryNumbers.size} active deliveries`
      )
      logger.log(`📦 Import has ${importedSet.size} deliveries`)

      // Find deliveries that exist in DB but not in import (these are deleted)
      const deletedDeliveryNumbers = Array.from(existingDeliveryNumbers).filter(
        (delivery) => !importedSet.has(delivery)
      )

      let marked = 0
      let reactivated = 0

      if (deletedDeliveryNumbers.length > 0) {
        logger.log(
          `🗑️ Detected ${deletedDeliveryNumbers.length} deleted deliveries:`,
          deletedDeliveryNumbers.slice(0, 10)
        )

        // Mark these deliveries as deleted
        const { data: markedData, error: deleteError } = await supabase
          .from('rr_all_deliveries')
          .update({ is_deleted: true })
          .eq('organization_id', organizationId)
          .in('delivery', deletedDeliveryNumbers)
          .select('id')

        if (deleteError) {
          logger.error('❌ Error marking deliveries as deleted:', deleteError)
        } else {
          marked = markedData?.length || 0
          logger.log(`✅ Marked ${marked} deliveries as deleted`)
        }
      } else {
        logger.log(
          'ℹ️ No deliveries detected as deleted (all DB deliveries are in import)'
        )
      }

      // Check for reactivations (deliveries that were deleted but are now back)
      const { data: deletedInDb } = await supabase
        .from('rr_all_deliveries')
        .select('delivery')
        .eq('organization_id', organizationId)
        .eq('is_deleted', true)
        .in('delivery', importedDeliveryNumbers)

      if (deletedInDb && deletedInDb.length > 0) {
        const reactivateNumbers = deletedInDb
          .map((d) => d.delivery)
          .filter(Boolean)

        if (reactivateNumbers.length > 0) {
          logger.log(`🔄 Reactivating ${reactivateNumbers.length} deliveries`)

          const { data: reactivatedData, error: reactivateError } =
            await supabase
              .from('rr_all_deliveries')
              .update({ is_deleted: false })
              .eq('organization_id', organizationId)
              .in('delivery', reactivateNumbers)
              .select('id')

          if (!reactivateError) {
            reactivated = reactivatedData?.length || 0
            logger.log(
              `✅ Reactivated ${reactivated} deliveries that returned to source system`
            )
          }
        }
      }

      return { marked, reactivated }
    } catch (error) {
      logger.error('Error in detectAndMarkDeletedDeliveries:', error)
      return { marked: 0, reactivated: 0 }
    }
  }

  /**
   * Auto-assign dispositions to deliveries based on business rules (November 9, 2025)
   * - LiftFan JPO Depot → DCMA
   * - WAWF in External ID 1 → WAWF
   */
  async autoAssignDispositions(): Promise<{
    assigned: number
    errors: number
  }> {
    try {
      const { organizationId } = await this.getUserOrganization()

      // Get required disposition IDs
      const { dcmaId, wawfId } =
        await this.ensureRequiredDispositions(organizationId)

      if (!dcmaId && !wawfId) {
        logger.warn('⚠️ No dispositions available for auto-assignment')
        return { assigned: 0, errors: 0 }
      }

      let assigned = 0
      let errors = 0

      // Auto-assign DCMA to LiftFan JPO Depot deliveries (only those without disposition, not deleted)
      if (dcmaId) {
        const { data: dcmaData, error: dcmaError } = await supabase
          .from('rr_all_deliveries')
          .update({ dispositions: dcmaId })
          .eq('organization_id', organizationId)
          .eq('customer_name', 'Ship in Place - LiftFan JPO Depot')
          .eq('is_deleted', false)
          .is('dispositions', null)
          .select('id')

        if (dcmaError) {
          logger.error('Error auto-assigning DCMA:', dcmaError)
          errors++
        } else {
          const count = dcmaData?.length || 0
          assigned += count
          if (count > 0) {
            logger.log(
              `✅ Auto-assigned DCMA to ${count} LiftFan JPO Depot deliveries`
            )
          }
        }
      }

      // Auto-assign WAWF to deliveries with WAWF in External ID 1 (only those without disposition, not deleted)
      if (wawfId) {
        const { data: wawfData, error: wawfError } = await supabase
          .from('rr_all_deliveries')
          .update({ dispositions: wawfId })
          .eq('organization_id', organizationId)
          .eq('is_deleted', false)
          .ilike('external_identification_1', '%WAWF%')
          .is('dispositions', null)
          .select('id')

        if (wawfError) {
          logger.error('Error auto-assigning WAWF:', wawfError)
          errors++
        } else {
          const count = wawfData?.length || 0
          assigned += count
          if (count > 0) {
            logger.log(
              `✅ Auto-assigned WAWF to ${count} deliveries with WAWF in External ID 1`
            )
          }
        }
      }

      return { assigned, errors }
    } catch (error) {
      logger.error('Error in auto-assign dispositions:', error)
      return { assigned: 0, errors: 1 }
    }
  }
}

// Export singleton instance
export const deliveryStatusService = DeliveryStatusService.getInstance()

// Created and developed by Jai Singh
