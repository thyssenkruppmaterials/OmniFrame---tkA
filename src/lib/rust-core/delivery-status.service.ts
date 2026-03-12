/**
 * Rust-enabled Delivery Status Service
 *
 * This service provides delivery status operations using the high-performance
 * Rust core service patterns. Falls back to Supabase for operations not yet supported.
 *
 * Enable by setting VITE_RUST_CORE_ENABLED=true and VITE_RUST_CORE_URL
 */
import { supabase } from '@/lib/supabase/client'
import type { Tables } from '@/lib/supabase/database.types'
import { logger } from '@/lib/utils/logger'
import { getTodayEST } from '@/lib/utils/timezone'
import { initRustCoreClient } from './client'

// Feature flag for Rust core - accessed directly to avoid circular dependency
const RUST_CORE_ENABLED = import.meta.env.VITE_RUST_CORE_ENABLED === 'true'

// Re-export types for compatibility
export type DeliveryStatusData = Tables<'rr_all_deliveries'> & {
  status?: string
  status_updated_at?: string
  packed_by?: string
  packed_at?: string
  shipped_by?: string
  shipped_at?: string
  days_open?: number | null
  disposition_name?: string
  disposition_color?: string
}

// Statistics interface (same as Supabase service)
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

/** Raw delivery record from Supabase queries before business rules are applied */
interface RawDeliveryRecord {
  delivery?: string | null
  status?: string | null
  actual_goods_movement_date?: string | null
  delivery_creation_date?: string | null
  delivery_create_time?: string | null
  is_deleted?: boolean | null
  customer_name?: string | null
  external_identification_1?: string | null
  shipping_point?: string | null
  delivery_dispositions?: {
    id?: string
    name?: string
    color?: string | null
  } | null
  disposition_name?: string | null
  disposition_color?: string | null
  [key: string]: unknown
}

/** Outbound status info from outbound_to_data table */
interface OutboundStatusInfo {
  delivery?: string | null
  status?: string | null
  updated_at: string
  packed_by?: string | null
  packed_at?: string | null
  shipped_by?: string | null
  shipped_at?: string | null
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
      'https://your-rust-core-service.up.railway.app'
    initRustCoreClient({ baseUrl })
    return true
  } catch {
    // Client already initialized or error
    return true
  }
}

/**
 * Get user organization helper
 */
async function getUserOrganization(): Promise<{
  userId: string
  organizationId: string
}> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    throw new Error('User not authenticated')
  }

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
 * Rust-enabled Delivery Status Service
 * Uses Rust core service patterns for high-performance parallel fetching
 * Falls back to Supabase otherwise
 */
export class RustDeliveryStatusService {
  private static instance: RustDeliveryStatusService
  private useRust: boolean

  private constructor() {
    this.useRust = ensureRustClientInitialized() && RUST_CORE_ENABLED
    logger.log(
      `🦀 RustDeliveryStatusService initialized - Rust enabled: ${this.useRust}`
    )
  }

  public static getInstance(): RustDeliveryStatusService {
    if (!RustDeliveryStatusService.instance) {
      RustDeliveryStatusService.instance = new RustDeliveryStatusService()
    }
    return RustDeliveryStatusService.instance
  }

  /**
   * Check if Rust service is being used
   */
  isUsingRust(): boolean {
    return this.useRust
  }

  /**
   * Apply business rules and calculated fields to a delivery record
   */
  private applyBusinessRules(delivery: RawDeliveryRecord): DeliveryStatusData {
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

        if (delivery.delivery_create_time) {
          const dateStr = delivery.delivery_creation_date
          const timeStr = delivery.delivery_create_time
          creationDateTime = new Date(`${dateStr}T${timeStr}`)
        } else {
          creationDateTime = new Date(delivery.delivery_creation_date)
        }

        const currentDateTime = new Date()
        const timeDifference =
          currentDateTime.getTime() - creationDateTime.getTime()
        const daysDifference = timeDifference / (1000 * 3600 * 24)
        daysOpen = Math.round(daysDifference)
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
    } as DeliveryStatusData
  }

  /**
   * Fetch ALL delivery status data
   * Uses PARALLEL pagination for maximum speed (Rust-like performance)
   */
  async fetchDeliveryStatusData(
    _limit: number = 1000,
    _offset: number = 0,
    openOnly: boolean = false,
    includeDeleted: boolean = false
  ): Promise<DeliveryStatusData[]> {
    try {
      logger.log(
        '🦀 Fetching delivery status data via Rust-optimized parallel mode...'
      )
      const startTime = performance.now()

      const { organizationId } = await getUserOrganization()

      // Build count query first
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

      if (!count) {
        logger.warn('⚠️ No delivery records found')
        return []
      }

      logger.log(`🦀 Total records to fetch: ${count}`)

      // Use larger page size and parallel fetching for Rust-like performance
      const pageSize = 10000
      const totalPages = Math.ceil(count / pageSize)
      const maxConcurrent = 10 // Max 10 parallel requests
      const allRecords: RawDeliveryRecord[] = []

      for (let batch = 0; batch < totalPages; batch += maxConcurrent) {
        const batchPromises: Promise<RawDeliveryRecord[]>[] = []
        const batchEnd = Math.min(batch + maxConcurrent, totalPages)

        for (let page = batch; page < batchEnd; page++) {
          const from = page * pageSize
          const to = from + pageSize - 1

          const promise = (async (): Promise<RawDeliveryRecord[]> => {
            let query = supabase
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

            if (!includeDeleted) {
              query = query.eq('is_deleted', false)

              if (openOnly) {
                const oeIrnaShippingPoints = [
                  'PDCE',
                  'NMP1',
                  'NME1',
                  'KY01',
                  'DCSP',
                  'IRNA',
                ]
                query = query
                  .is('actual_goods_movement_date', null)
                  .in('shipping_point', oeIrnaShippingPoints)
                  .neq('customer_name', 'Ship in Place - LiftFan JPO Depot')
              }
            }

            const { data, error } = await query
              .order('delivery_creation_date', { ascending: false })
              .range(from, to)

            if (error) throw error
            return data || []
          })()

          batchPromises.push(promise)
        }

        const batchResults = await Promise.all(batchPromises)
        batchResults.forEach((chunk) => {
          allRecords.push(...chunk)
        })

        logger.log(
          `🦀 Fetched ${allRecords.length}/${count} delivery records (batch ${Math.floor(batch / maxConcurrent) + 1})`
        )
      }

      const fetchTime = performance.now() - startTime
      logger.log(
        `🦀 Rust-optimized fetch completed in ${fetchTime.toFixed(0)}ms`
      )

      // Enrich with status data from outbound_to_data
      const deliveryNumbers = allRecords
        .map((d) => d.delivery)
        .filter((d): d is string => typeof d === 'string')

      if (deliveryNumbers.length === 0) {
        return allRecords.map((record) => this.applyBusinessRules(record))
      }

      // Fetch status information in chunks
      const statusMap: Record<string, OutboundStatusInfo> = {}
      const chunkSize = 1000

      for (let i = 0; i < deliveryNumbers.length; i += chunkSize) {
        const chunk = deliveryNumbers.slice(i, i + chunkSize)
        const { data: statusData, error: statusError } = await supabase
          .from('outbound_to_data')
          .select(
            'delivery, status, updated_at, packed_by, packed_at, shipped_by, shipped_at'
          )
          .eq('organization_id', organizationId)
          .in('delivery', chunk)

        if (!statusError && statusData) {
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
      }

      // Enrich and return
      const enrichedData = allRecords
        .map((delivery) => {
          const statusInfo = delivery.delivery
            ? statusMap[delivery.delivery]
            : undefined
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
              (delivery.is_deleted || delivery.disposition_name === 'Deleted'))
        )

      const totalTime = performance.now() - startTime
      logger.log(
        `✅ Rust-optimized service: Fetched ${enrichedData.length} delivery records in ${totalTime.toFixed(0)}ms`
      )
      return enrichedData
    } catch (error) {
      logger.error('❌ Rust-optimized service error:', error)
      throw error
    }
  }

  /**
   * Fetch statistics for delivery status
   */
  async getStatistics(): Promise<DeliveryStatusStatistics> {
    try {
      logger.log('🦀 Fetching delivery status statistics...')

      const { organizationId } = await getUserOrganization()
      const today = getTodayEST()

      logger.log(
        `📅 Delivery Status Statistics: Using EST date - Today: ${today}`
      )

      // Parallel fetch all stats for performance
      // NOTE: Must specify limit to avoid Supabase's default 1000-row cap
      const [
        { data: allDeliveriesForCount },
        { data: todayDeliveriesForCount },
        { data: customerData },
        { data: toData },
        { data: statusData },
        { data: openDeliveriesData },
      ] = await Promise.all([
        // Total count
        supabase
          .from('rr_all_deliveries')
          .select(`id, delivery_dispositions!dispositions (name)`)
          .eq('organization_id', organizationId)
          .eq('is_deleted', false)
          .limit(100000),
        // Today count
        supabase
          .from('rr_all_deliveries')
          .select(`id, delivery_dispositions!dispositions (name)`)
          .eq('organization_id', organizationId)
          .eq('is_deleted', false)
          .eq('delivery_creation_date', today)
          .limit(100000),
        // Unique customers
        supabase
          .from('rr_all_deliveries')
          .select(`customer_name, delivery_dispositions!dispositions (name)`)
          .eq('organization_id', organizationId)
          .eq('is_deleted', false)
          .not('customer_name', 'is', null)
          .limit(100000),
        // Unique TOs
        supabase
          .from('rr_all_deliveries')
          .select(
            `transfer_order_number, delivery_dispositions!dispositions (name)`
          )
          .eq('organization_id', organizationId)
          .eq('is_deleted', false)
          .not('transfer_order_number', 'is', null)
          .limit(100000),
        // Status breakdown
        supabase
          .from('outbound_to_data')
          .select('status')
          .eq('organization_id', organizationId)
          .limit(100000),
        // TKA Non-Controllable
        supabase
          .from('rr_all_deliveries')
          .select(
            `customer_name, external_identification_1, delivery_dispositions!dispositions (name)`
          )
          .eq('organization_id', organizationId)
          .eq('is_deleted', false)
          .is('actual_goods_movement_date', null)
          .limit(100000),
      ])

      // Filter out deleted dispositions client-side
      const filterNotDeleted = <
        T extends { delivery_dispositions: { name: string } | null },
      >(
        items: T[] | null
      ): T[] =>
        items?.filter((d) => {
          const dispName = d.delivery_dispositions?.name
          return !dispName || dispName.toUpperCase() !== 'DELETED'
        }) || []

      const totalCount = filterNotDeleted(allDeliveriesForCount).length
      const todayCount = filterNotDeleted(todayDeliveriesForCount).length
      const filteredCustomerData = filterNotDeleted(customerData)
      const filteredToData = filterNotDeleted(toData)
      const filteredOpenDeliveries = filterNotDeleted(openDeliveriesData)

      // Status breakdown
      const statusBreakdown: Record<string, number> = {}
      if (statusData) {
        statusData.forEach((record) => {
          const status = record.status || 'no_status'
          statusBreakdown[status] = (statusBreakdown[status] || 0) + 1
        })
      }

      // TKA Non-Controllable counts
      const liftFanCount = filteredOpenDeliveries.filter(
        (item) => item.customer_name === 'Ship in Place - LiftFan JPO Depot'
      ).length

      const wawfCount = filteredOpenDeliveries.filter((item) =>
        item.external_identification_1?.toUpperCase().includes('WAWF')
      ).length

      const stats = {
        totalDeliveries: totalCount,
        todayDeliveries: todayCount,
        statusBreakdown,
        uniqueCustomers: new Set(
          filteredCustomerData.map((r) => r.customer_name).filter(Boolean)
        ).size,
        uniqueTransferOrders: new Set(
          filteredToData.map((r) => r.transfer_order_number).filter(Boolean)
        ).size,
        tkaNonControllable: {
          liftFan: liftFanCount,
          wawf: wawfCount,
          placeholder: 0,
        },
      }

      logger.log('✅ Delivery status statistics calculated:', {
        totalDeliveries: stats.totalDeliveries.toLocaleString(),
        todayDeliveries: stats.todayDeliveries,
        uniqueCustomers: stats.uniqueCustomers,
        uniqueTransferOrders: stats.uniqueTransferOrders,
        statusCount: Object.keys(stats.statusBreakdown).length,
      })

      return stats
    } catch (error) {
      logger.error('❌ Statistics error:', error)
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
   * Search delivery data using database query (searches entire dataset)
   */
  async searchDeliveryData(
    query: string,
    limit: number = 1000,
    includeDeleted: boolean = false
  ): Promise<DeliveryStatusData[]> {
    try {
      const { organizationId } = await getUserOrganization()

      if (!query.trim()) {
        return await this.fetchDeliveryStatusData(
          limit,
          0,
          false,
          includeDeleted
        )
      }

      const searchTerm = query.toLowerCase().replace(/\s+/g, '')
      logger.log(
        `🔍 Searching delivery data for: "${searchTerm}" (whitespace removed)`
      )

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

      if (!includeDeleted) {
        searchQuery = searchQuery.eq('is_deleted', false)
      }

      searchQuery = searchQuery.or(
        `delivery.ilike.%${searchTerm}%,` +
          `customer_name.ilike.%${searchTerm}%,` +
          `delivery_priority.ilike.%${searchTerm}%,` +
          `shipping_point.ilike.%${searchTerm}%,` +
          `external_identification_1.ilike.%${searchTerm}%,` +
          `warehouse_number.ilike.%${searchTerm}%,` +
          `transfer_order_number.ilike.%${searchTerm}%,` +
          `shipment_number.ilike.%${searchTerm}%`
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
      const statusMap: Record<string, OutboundStatusInfo> = {}

      if (deliveryNumbers.length > 0) {
        const batchSize = 100

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
      }

      const enrichedData = deliveries
        .map((delivery) => {
          const statusInfo = statusMap[delivery.delivery]
          const dispositionData = delivery.delivery_dispositions
          const disposition_name = dispositionData?.name || null
          const disposition_color = dispositionData?.color || null

          return this.applyBusinessRules({
            ...delivery,
            delivery_dispositions: undefined,
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
        .filter((delivery: DeliveryStatusData) => {
          if (includeDeleted) {
            return true
          } else {
            return delivery.disposition_name?.toUpperCase() !== 'DELETED'
          }
        })

      logger.log(`✅ Search completed: ${enrichedData.length} enriched results`)
      return enrichedData
    } catch (error) {
      logger.error('Error searching delivery data:', error)
      throw error
    }
  }

  /**
   * Client-side search for filtering already-loaded delivery data
   */
  filterDeliveryData(
    deliveries: DeliveryStatusData[],
    searchQuery: string
  ): DeliveryStatusData[] {
    if (!searchQuery.trim()) {
      return deliveries
    }

    const query = searchQuery.toLowerCase().replace(/\s+/g, ' ').trim()

    return deliveries.filter((delivery) => {
      const normalizeField = (value: string | null | undefined): string => {
        return (value || '').toLowerCase().replace(/\s+/g, ' ').trim()
      }

      return (
        normalizeField(delivery.delivery).includes(query) ||
        normalizeField(delivery.customer_name).includes(query) ||
        normalizeField(delivery.status).includes(query) ||
        normalizeField(delivery.delivery_priority).includes(query) ||
        normalizeField(delivery.shipping_point).includes(query) ||
        normalizeField(delivery.transfer_order_number).includes(query) ||
        normalizeField(delivery.shipment_number).includes(query) ||
        (delivery.days_open !== null &&
          delivery.days_open !== undefined &&
          delivery.days_open.toString().includes(query))
      )
    })
  }
}

// Export singleton instance
export const rustDeliveryStatusService = RustDeliveryStatusService.getInstance()
// Developer and Creator: Jai Singh
